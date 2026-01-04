const SUPPORT_HOST_SUFFIX = "buymeacoffee.com";
const SUPPORT_REQUIRED_MS = 40000;
const SUPPORT_COOLDOWN_DAYS = 50;
const SUPPORT_HIDE_MS = SUPPORT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

let supportTracking = null;
let focusedWindowId = null;

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

function pauseSupportTracking() {
  if (!supportTracking || !supportTracking.active) {
    return;
  }
  supportTracking.elapsedMs += Date.now() - supportTracking.startedAt;
  supportTracking.active = false;
  supportTracking.startedAt = 0;
  clearSupportTrackingTimer();
}

function resumeSupportTracking() {
  if (!supportTracking || supportTracking.active) {
    return;
  }
  const remaining = SUPPORT_REQUIRED_MS - supportTracking.elapsedMs;
  if (remaining <= 0) {
    void completeSupportTracking();
    return;
  }
  supportTracking.active = true;
  supportTracking.startedAt = Date.now();
  clearSupportTrackingTimer();
  supportTracking.timerId = setTimeout(() => {
    void completeSupportTracking();
  }, remaining);
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
  await setSupportAt(Date.now());
  const status = await getSupportStatus();
  sendSupportStatusUpdate(status.visible);
}

function stopSupportTracking() {
  if (!supportTracking) {
    return;
  }
  clearSupportTrackingTimer();
  supportTracking = null;
}

function refreshSupportTrackingFromTab(tab) {
  if (!supportTracking || !tab || tab.id !== supportTracking.tabId) {
    return;
  }
  supportTracking.windowId = tab.windowId;
  supportTracking.urlValid = isSupportUrl(tab.url);
  const isFocused = focusedWindowId === null || focusedWindowId === tab.windowId;
  const shouldTrack = supportTracking.urlValid && tab.active === true && isFocused;
  if (shouldTrack) {
    resumeSupportTracking();
  } else {
    pauseSupportTracking();
  }
}

async function refreshSupportTracking() {
  if (!supportTracking || !api?.tabs?.get) {
    return;
  }
  try {
    const tab = await api.tabs.get(supportTracking.tabId);
    refreshSupportTrackingFromTab(tab);
  } catch (error) {
    stopSupportTracking();
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
  await updateFocusedWindowId();
  await refreshSupportTracking();
}

function handleSupportTabRemoved(tabId) {
  if (supportTracking && supportTracking.tabId === tabId) {
    stopSupportTracking();
  }
}

function handleSupportTabComplete(tabId, changeInfo, tab) {
  if (supportTracking && tab && tab.id === supportTracking.tabId) {
    refreshSupportTrackingFromTab(tab);
  }
}

async function handleSupportTabActivated(activeInfo, tab) {
  if (!supportTracking) {
    return;
  }
  if (tab && tab.id === supportTracking.tabId) {
    refreshSupportTrackingFromTab(tab);
    return;
  }
  await refreshSupportTracking();
}

async function handleSupportWindowFocusChanged(windowId) {
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
