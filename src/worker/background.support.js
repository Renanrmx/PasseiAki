const SUPPORT_HOST_SUFFIX = "buymeacoffee.com";
const SUPPORT_REQUIRED_MS = 40000;
const SUPPORT_COOLDOWN_DAYS = 50;
const SUPPORT_HIDE_MS = SUPPORT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const SUPPORT_TRACKING_STORAGE_KEY = "supportTrackingState";

let supportTracking = null;
let focusedWindowId = null;
let supportTrackingLoadPromise = null;

function getSupportTrackingStorage() {
  if (api?.storage?.session) {
    return api.storage.session;
  }
  return null;
}

function normalizeSupportTrackingState(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const tabId = typeof raw.tabId === "number" ? raw.tabId : null;
  if (tabId === null) {
    return null;
  }
  const elapsedMs =
    Number.isFinite(raw.elapsedMs) && raw.elapsedMs >= 0 ? raw.elapsedMs : 0;
  const startedAt =
    Number.isFinite(raw.startedAt) && raw.startedAt > 0 ? raw.startedAt : 0;
  return {
    tabId,
    windowId: typeof raw.windowId === "number" ? raw.windowId : null,
    urlValid: raw.urlValid === true,
    elapsedMs,
    active: raw.active === true,
    startedAt,
    timerId: null
  };
}

async function readSupportTrackingState() {
  const storage = getSupportTrackingStorage();
  if (!storage || !storage.get) {
    return null;
  }
  try {
    const result = await storage.get(SUPPORT_TRACKING_STORAGE_KEY);
    return normalizeSupportTrackingState(
      result ? result[SUPPORT_TRACKING_STORAGE_KEY] : null
    );
  } catch (error) {
    return null;
  }
}

async function persistSupportTrackingState() {
  const storage = getSupportTrackingStorage();
  if (!storage || !storage.set) {
    return;
  }
  if (!supportTracking) {
    if (storage.remove) {
      try {
        await storage.remove(SUPPORT_TRACKING_STORAGE_KEY);
      } catch (error) {
        // ignore storage cleanup errors
      }
    }
    return;
  }
  const payload = {
    tabId: supportTracking.tabId,
    windowId: supportTracking.windowId,
    urlValid: supportTracking.urlValid === true,
    elapsedMs: supportTracking.elapsedMs,
    active: supportTracking.active === true,
    startedAt: supportTracking.startedAt
  };
  try {
    await storage.set({ [SUPPORT_TRACKING_STORAGE_KEY]: payload });
  } catch (error) {
    // ignore storage update errors
  }
}

async function ensureSupportTrackingLoaded() {
  if (supportTracking) {
    return true;
  }
  if (supportTrackingLoadPromise) {
    await supportTrackingLoadPromise;
    return Boolean(supportTracking);
  }
  supportTrackingLoadPromise = (async () => {
    const stored = await readSupportTrackingState();
    if (stored) {
      supportTracking = stored;
    }
  })()
    .catch(() => {})
    .finally(() => {
      supportTrackingLoadPromise = null;
    });
  await supportTrackingLoadPromise;
  return Boolean(supportTracking);
}

function isSupportUrl(urlString) {
  if (!urlString) return false;
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    return host === SUPPORT_HOST_SUFFIX || host.endsWith(`.${SUPPORT_HOST_SUFFIX}`);
  } catch (error) {
    return false;
  }
}

async function updateFocusedWindowId() {
  if (!api?.windows?.getLastFocused) return;
  try {
    const win = await api.windows.getLastFocused({ windowTypes: ["normal"] });
    focusedWindowId = win && typeof win.id === "number" ? win.id : null;
  } catch (error) {
    // ignore focus resolution errors
  }
}

async function getWindowFocusState(windowId) {
  if (!api?.windows?.get || typeof windowId !== "number") {
    return null;
  }
  try {
    const win = await api.windows.get(windowId);
    if (win && typeof win.focused === "boolean") {
      return win.focused;
    }
  } catch (error) {
    // ignore window focus errors
  }
  return null;
}

async function shouldTrackSupportTab(tab) {
  if (!supportTracking || !tab) {
    return false;
  }
  supportTracking.windowId = tab.windowId;
  supportTracking.urlValid = isSupportUrl(tab.url);
  if (focusedWindowId === null) {
    await updateFocusedWindowId();
  }
  const windowFocused = await getWindowFocusState(tab.windowId);
  const isFocused =
    windowFocused === null
      ? focusedWindowId === null || focusedWindowId === tab.windowId
      : windowFocused;
  return supportTracking.urlValid && tab.active === true && isFocused;
}

async function getSupportStatus() {
  const supportAt = await getSupportAt();
  if (!supportAt || typeof supportAt !== "number") {
    return { visible: true, supportAt: null };
  }
  const elapsed = Date.now() - supportAt;
  return { visible: elapsed >= SUPPORT_HIDE_MS, supportAt };
}

function sendSupportStatusUpdate(visible) {
  try {
    if (!api?.runtime?.sendMessage) {
      return;
    }
    const result = api.runtime.sendMessage({
      type: "SUPPORT_STATUS_UPDATED",
      visible: Boolean(visible)
    });
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (error) {
    // ignore broadcast errors
  }
}

function clearSupportTrackingTimer() {
  if (supportTracking && supportTracking.timerId) {
    clearTimeout(supportTracking.timerId);
    supportTracking.timerId = null;
  }
}

function scheduleSupportTracking(remainingMs) {
  if (remainingMs <= 0) {
    return;
  }
  if (supportTracking) {
    supportTracking.timerId = setTimeout(() => {
      void handleSupportTimer();
    }, remainingMs);
  }
}

function pauseSupportTracking() {
  if (!supportTracking || !supportTracking.active) {
    return;
  }
  supportTracking.elapsedMs += Date.now() - supportTracking.startedAt;
  supportTracking.active = false;
  supportTracking.startedAt = 0;
  clearSupportTrackingTimer();
  void persistSupportTrackingState();
}

function resumeSupportTracking() {
  if (!supportTracking) {
    return;
  }
  const runningElapsed = supportTracking.active
    ? supportTracking.elapsedMs + (Date.now() - supportTracking.startedAt)
    : supportTracking.elapsedMs;
  const remaining = SUPPORT_REQUIRED_MS - runningElapsed;
  if (remaining <= 0) {
    void completeSupportTracking();
    return;
  }
  supportTracking.elapsedMs = runningElapsed;
  supportTracking.active = true;
  supportTracking.startedAt = Date.now();
  clearSupportTrackingTimer();
  scheduleSupportTracking(remaining);
  void persistSupportTrackingState();
}

async function completeSupportTracking() {
  if (!supportTracking) {
    return;
  }
  if (supportTracking.active) {
    supportTracking.elapsedMs += Date.now() - supportTracking.startedAt;
  }
  clearSupportTrackingTimer();
  supportTracking.active = false;
  supportTracking.startedAt = 0;

  if (supportTracking.elapsedMs < SUPPORT_REQUIRED_MS) {
    return;
  }

  supportTracking = null;
  await persistSupportTrackingState();
  await setSupportAt(Date.now());
  const status = await getSupportStatus();
  sendSupportStatusUpdate(status.visible);
}

async function handleSupportTimer() {
  if (!supportTracking) {
    await ensureSupportTrackingLoaded();
  }
  if (!supportTracking) {
    return;
  }
  try {
    const tab = await api.tabs.get(supportTracking.tabId);
    const shouldTrack = await shouldTrackSupportTab(tab);
    if (!shouldTrack) {
      pauseSupportTracking();
      return;
    }
  } catch (error) {
    stopSupportTracking();
    return;
  }

  const elapsed = supportTracking.elapsedMs + (Date.now() - supportTracking.startedAt);
  if (elapsed >= SUPPORT_REQUIRED_MS) {
    supportTracking.elapsedMs = elapsed;
    supportTracking.startedAt = Date.now();
    await completeSupportTracking();
    return;
  }
  supportTracking.elapsedMs = elapsed;
  supportTracking.startedAt = Date.now();
  clearSupportTrackingTimer();
  scheduleSupportTracking(SUPPORT_REQUIRED_MS - elapsed);
  void persistSupportTrackingState();
}

function stopSupportTracking() {
  if (!supportTracking) {
    return;
  }
  clearSupportTrackingTimer();
  supportTracking = null;
  void persistSupportTrackingState();
}

async function refreshSupportTracking(tab) {
  if (!supportTracking) {
    return;
  }
  let currentTab = tab || null;
  if (currentTab) {
    if (currentTab.id !== supportTracking.tabId) {
      return;
    }
  } else {
    if (!api?.tabs?.get) {
      return;
    }
    try {
      currentTab = await api.tabs.get(supportTracking.tabId);
    } catch (error) {
      stopSupportTracking();
      return;
    }
  }
  const shouldTrack = await shouldTrackSupportTab(currentTab);
  if (shouldTrack) {
    resumeSupportTracking();
  } else {
    pauseSupportTracking();
  }
}

async function beginSupportTracking(tabId) {
  if (typeof tabId !== "number" || !api?.tabs?.get) {
    return;
  }
  stopSupportTracking();
  supportTracking = {
    tabId,
    windowId: null,
    urlValid: false,
    elapsedMs: 0,
    active: false,
    startedAt: 0,
    timerId: null
  };
  void persistSupportTrackingState();
  await updateFocusedWindowId();
  await refreshSupportTracking();
}

async function handleSupportTabRemoved(tabId) {
  try {
    if (!supportTracking) {
      await ensureSupportTrackingLoaded();
    }
    if (supportTracking && supportTracking.tabId === tabId) {
      stopSupportTracking();
    }
  } catch (error) {
    // ignore tab removal errors
  }
}

async function handleSupportTabComplete(tab) {
  try {
    if (!supportTracking) {
      await ensureSupportTrackingLoaded();
    }
    if (supportTracking && tab && tab.id === supportTracking.tabId) {
      await refreshSupportTracking(tab);
    }
  } catch (error) {
    // ignore tab update errors
  }
}

async function handleSupportTabActivated(tab) {
  await ensureSupportTrackingLoaded();
  if (!supportTracking) {
    return;
  }
  if (tab && tab.id === supportTracking.tabId) {
    await refreshSupportTracking(tab);
    return;
  }
  await refreshSupportTracking();
}

async function handleSupportWindowFocusChanged(windowId) {
  await ensureSupportTrackingLoaded();
  if (windowId === api.windows.WINDOW_ID_NONE) {
    focusedWindowId = api.windows.WINDOW_ID_NONE;
    pauseSupportTracking();
    return;
  }
  focusedWindowId = windowId;
  if (supportTracking) {
    await refreshSupportTracking();
  }
}
