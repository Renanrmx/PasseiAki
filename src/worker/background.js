const api = typeof browser !== "undefined" ? browser : chrome;
const actionApi = api.action || api.browserAction;

const DB_NAME = "passeiAki";
const DB_VERSION = 2;
const VISITS_STORE = "visits";
const META_STORE = "meta";
const PARTIAL_EXCEPTIONS_STORE = "partial_exceptions";
const MATCH_EXCEPTIONS_STORE = "match_exceptions";
const META_PEPPER_KEY = "pepper";

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);
const ACTION_ICONS = {
  viewed: {
    16: "icons/check-mark-16-viewed.png",
    24: "icons/check-mark-24-viewed.png",
    32: "icons/check-mark-32-viewed.png",
    38: "icons/check-mark-38-viewed.png",
    48: "icons/check-mark-48-viewed.png",
    96: "icons/check-mark-96-viewed.png"
  },
  partial: {
    16: "icons/check-mark-16-partial.png",
    24: "icons/check-mark-24-partial.png",
    32: "icons/check-mark-32-partial.png",
    38: "icons/check-mark-38-partial.png",
    48: "icons/check-mark-48-partial.png",
    96: "icons/check-mark-96-partial.png"
  },
  default: {
    16: "icons/check-mark-16.png",
    24: "icons/check-mark-24.png",
    32: "icons/check-mark-32.png",
    38: "icons/check-mark-38.png",
    48: "icons/check-mark-48.png",
    96: "icons/check-mark-96.png"
  }
};

function resolveActionIcons(iconMap) {
  if (!api?.runtime?.getURL) return iconMap;
  const resolved = {};
  Object.entries(iconMap).forEach(([size, path]) => {
    resolved[size] = api.runtime.getURL(path);
  });
  return resolved;
}

const textEncoder = new TextEncoder();
const pendingFirstVisit = new Set();
const lastSavedByTab = new Map();
const lastMatchStateByTab = new Map();
const lastPrevVisitByTab = new Map();
const forcedPartialByTab = new Set();
const firstNavigationUrlByTab = new Map();
let encryptionEnabledCache = null;
let downloadBadgeTimer = null;
let downloadBadgeVisible = false;
let downloadBadgeSettingsCache = null;
let downloadBadgeCount = 0;
let downloadBadgeItems = [];

if (typeof importScripts === "function") {
  importScripts(
    "../vendor/chacha20poly1305.js",
    "../vendor/argon2-bundled.min.js",
    "background.crypto.js",
    "background.hash.js",
    "background.database.js",
    "background.utils.js",
    "background.match.js",
    "background.history.js",
    "background.highlight.js",
    "background.backup.js",
    "background.import.js",
    "background.export.js"
  );
}

api.tabs.onUpdated.addListener(handleTabComplete);
api.tabs.onActivated.addListener(handleTabActivated);
api.windows.onFocusChanged.addListener(handleWindowFocusChanged);
api.tabs.onRemoved.addListener((tabId) => {
  pendingFirstVisit.delete(tabId);
  lastSavedByTab.delete(tabId);
  lastMatchStateByTab.delete(tabId);
  lastPrevVisitByTab.delete(tabId);
  forcedPartialByTab.delete(tabId);
  firstNavigationUrlByTab.delete(tabId);
});

if (api.webNavigation && api.webNavigation.onBeforeNavigate && api.webNavigation.onCommitted) {
  api.webNavigation.onBeforeNavigate.addListener(handleBeforeNavigate);
  api.webNavigation.onCommitted.addListener(handleNavigationCommitted);
}

if (api.downloads && api.downloads.onCreated) {
  api.downloads.onCreated.addListener(handleDownloadCreated);
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    if (!message || !message.type) {
      return undefined;
    }

    if (message.type === "CHECK_VISITED_LINKS") {
      return handleCheckVisitedLinks(message.links || []);
  }

  if (message.type === "GET_STATS") {
    return handleGetStats();
  }

  if (message.type === "GET_PARTIAL_MATCHES") {
    return (async () => {
      const fingerprint = await computeFingerprint(message.url || "");
      if (!fingerprint) return { items: [] };
      const items = await findPartialMatches(fingerprint, 5);
      return { items };
    })();
  }

  if (message.type === "DELETE_VISIT") {
    return (async () => {
      await deleteVisitById(message.id);
      try {
        if (api.runtime && api.runtime.sendMessage) {
          api.runtime.sendMessage({ type: "HISTORY_UPDATED" });
        }
      } catch (error) {
        // ignore broadcast errors
      }
      return { ok: true };
    })().catch((error) => ({ ok: false, error: error?.message || String(error) }));
  }

    if (message.type === "GET_VISIT_FOR_URL") {
      if (message.tabId && lastMatchStateByTab.has(message.tabId)) {
        const res = await handleGetVisitForUrl(message.url || "", message.tabId);
        return {
          ...res,
          matchState: lastMatchStateByTab.get(message.tabId) || res.matchState
        };
      }
      return handleGetVisitForUrl(message.url || "", message.tabId);
    }

    if (message.type === "GET_ENCRYPTION_ENABLED") {
      const value = await getEncryptionEnabled();
      return { encryptionEnabled: value };
    }

    if (message.type === "SET_ENCRYPTION_ENABLED") {
      await setEncryptionEnabled(Boolean(message.enabled));
      return { ok: true };
    }

    if (message.type === "CREATE_BACKUP") {
      const envelope = await createBackup(message.password || "");
      return { ok: true, envelope };
    }

    if (message.type === "CREATE_BACKUP_DOWNLOAD") {
      const envelope = await createBackup(message.password || "");
      await downloadBackup(envelope, message.filename);
      return { ok: true };
    }

    if (message.type === "RESTORE_BACKUP") {
      try {
        await restoreBackup(message.password || "", message.envelope);
        return { ok: true };
      } catch (error) {
        console.error("Backup restore fail:", error);
        return { ok: false, error: error && error.message ? error.message : String(error) };
      }
    }

    if (message.type === "EXPORT_VISITS_CSV") {
      return (async () => {
        const result = await exportPlainVisitsCsv(message.filename, {
          includePages: message.includePages,
          includeDownloads: message.includeDownloads
        });
        return { ok: true, exported: result.exported };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === "EXPORT_VISITS_TXT") {
      return (async () => {
        const result = await exportPlainVisitsTxt(message.filename, {
          includePages: message.includePages,
          includeDownloads: message.includeDownloads
        });
        return { ok: true, exported: result.exported };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === "GET_LINK_COLORS") {
      return (async () => {
        const colors = await getLinkColors();
        return { ok: true, colors };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === "SET_LINK_COLORS") {
      return (async () => {
        const colors = await setLinkColors({
          matchHexColor: message.matchHexColor,
          partialHexColor: message.partialHexColor,
          matchTextEnabled: message.matchTextEnabled,
          partialTextEnabled: message.partialTextEnabled,
          matchBorderEnabled: message.matchBorderEnabled,
          partialBorderEnabled: message.partialBorderEnabled
        });
        try {
          api.runtime.sendMessage({ type: "LINK_COLORS_UPDATED", colors });
          if (api.tabs && api.tabs.query) {
            api.tabs.query({}, (tabs) => {
              tabs.forEach((tab) => {
                try {
                  api.tabs.sendMessage(tab.id, { type: "LINK_COLORS_UPDATED", colors });
                } catch (error) {
                  // ignore per-tab errors
                }
              });
            });
          }
        } catch (error) {
          // ignore broadcast error
        }
        return { ok: true, colors };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === "GET_DOWNLOAD_BADGE_SETTINGS") {
      return (async () => {
        const settings = await getDownloadBadgeSettings();
        return { ok: true, settings };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === "GET_PARTIAL_EXCEPTIONS") {
      return (async () => {
        const items = await getAllPartialExceptions();
        return { ok: true, items };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === "SET_PARTIAL_EXCEPTIONS") {
      return (async () => {
        const items = await setPartialExceptions(message.items || []);
        try {
          if (api.tabs && api.tabs.query) {
            api.tabs.query({}, (tabs) => {
              tabs.forEach((tab) => {
                if (!tab || typeof tab.id === "undefined") return;
                try {
                  api.tabs.sendMessage(tab.id, { type: "REFRESH_HIGHLIGHT" });
                } catch (error) {
                  // ignore per-tab errors
                }
              });
            });
          }
        } catch (error) {
          // ignore broadcast error
        }
        refreshAllTabsMatchState();
        return { ok: true, items };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === "GET_MATCH_EXCEPTIONS") {
      return (async () => {
        const items = await getAllMatchExceptions();
        return { ok: true, items };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === "SET_MATCH_EXCEPTIONS") {
      return (async () => {
        const items = await setMatchExceptions(message.items || []);
        try {
          if (api.tabs && api.tabs.query) {
            api.tabs.query({}, (tabs) => {
              tabs.forEach((tab) => {
                if (!tab || typeof tab.id === "undefined") return;
                try {
                  api.tabs.sendMessage(tab.id, { type: "REFRESH_HIGHLIGHT" });
                } catch (error) {
                  // ignore per-tab errors
                }
              });
            });
          }
        } catch (error) {
          // ignore broadcast error
        }
        refreshAllTabsMatchState();
        return { ok: true, items };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === "GET_DOWNLOAD_BADGE_STATE") {
      return (async () => {
        const settings = downloadBadgeSettingsCache || (await getDownloadBadgeSettings());
        downloadBadgeSettingsCache = settings;
        if (settings.downloadBadgeEnabled === false) {
          clearDownloadBadge();
          return { ok: true, visible: false, count: 0, items: [] };
        }
        if (!downloadBadgeVisible || downloadBadgeCount <= 0) {
          return { ok: true, visible: false, count: 0, items: [] };
        }
        return {
          ok: true,
          visible: true,
          count: downloadBadgeCount,
          items: downloadBadgeItems.slice(0, downloadBadgeCount)
        };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === "DISMISS_DOWNLOAD_BADGE") {
      clearDownloadBadge();
      return { ok: true };
    }

    if (message.type === "SET_DOWNLOAD_BADGE_SETTINGS") {
      return (async () => {
        const settings = await setDownloadBadgeSettings({
          downloadBadgeColor: message.downloadBadgeColor,
          downloadBadgeDurationMs: message.downloadBadgeDurationMs,
          downloadBadgeEnabled: message.downloadBadgeEnabled
        });
        downloadBadgeSettingsCache = settings;
        await updateDownloadBadgeAppearance(settings);
        return { ok: true, settings };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === "IMPORT_ADDRESSES") {
      return (async () => {
        const result = await importAddressesFromText(message.content || "", {
          preview: Boolean(message.preview)
        });
        return { ok: true, ...result };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    return undefined;
  };

  Promise.resolve()
    .then(handler)
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error("Error in onMessage handler:", error);
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });

  return true; // indicates it will respond async
});

api.runtime.onInstalled.addListener(async (details) => {
  await ensurePepperKey();
  await openDatabase();

  try {
    if (details && details.reason === "install") {
      api.windows.create({
        url: api.runtime.getURL("panel/welcome.html"),
        type: "popup",
        width: 480,
        height: 600
      });
    }
  } catch (error) {
    // ignore tab creation errors
  }
});

async function upsertVisit(urlString, options = {}) {
  const fingerprint = await computeFingerprint(urlString);
  if (!fingerprint) {
    return null;
  }

  let existing = null;
  const idsToTry = Array.from(
    new Set([fingerprint.id, fingerprint.ids?.hash, fingerprint.ids?.plain].filter(Boolean))
  );
  for (const id of idsToTry) {
    const found = await getVisitById(id);
    if (found) {
      existing = found;
      break;
    }
  }

  const now = Date.now();
  const previousLastVisited = existing ? existing.lastVisited : null;

  const existedBefore = Boolean(existing);
  const hashed = existing ? existing.hashed !== false : fingerprint.storedHashed;
  const keySet = hashed ? fingerprint.keys.hash : fingerprint.keys.plain;
  const recordId = hashed ? fingerprint.ids?.hash || fingerprint.id : fingerprint.ids?.plain || fingerprint.id;
  const paramKeys = hashed ? fingerprint.keys.hash.params : fingerprint.keys.plain.params;
  const download = options.download === true || (existing && existing.download === true);
  
  const baseRecord = {
    id: recordId,
    hostHash: keySet.host,
    pathHash: keySet.path,
    queryHash: keySet.query,
    fragmentHash: keySet.fragment,
    queryParamsHash: paramKeys,
    hashed,
    host: fingerprint.parts.host,
    path: fingerprint.parts.path,
    query: fingerprint.parts.query,
    fragment: fingerprint.parts.fragment,
    lastVisited: now,
    download
  };

  const record = existedBefore
    ? { ...existing, ...baseRecord, visitCount: (existing.visitCount || 0) + 1 }
    : { ...baseRecord, visitCount: 1 };

  await putVisit(record);
  try {
    if (api.runtime && api.runtime.sendMessage) {
      api.runtime.sendMessage({ type: "HISTORY_UPDATED" });
    }
  } catch (error) {
    // ignore broadcast errors
  }
  return { record, existedBefore, previousLastVisited };
}

async function setActionState(tabId, state) {
  try {
    const iconMap =
      state === MATCH_STATE.full
        ? ACTION_ICONS.viewed
        : state === MATCH_STATE.partial
          ? ACTION_ICONS.partial
          : ACTION_ICONS.default;
    const icon = resolveActionIcons(iconMap);
    const titleKey =
      state === MATCH_STATE.full
        ? "actionVisited"
        : state === MATCH_STATE.partial
          ? "actionPartial"
          : "actionNotVisited";
    await actionApi.setIcon({ tabId, path: icon });
    await actionApi.setTitle({
      tabId,
      title: i18n(titleKey)
    });
  } catch (error) {
    console.warn("The icon could not be updated:", error);
  }
}

async function refreshAllTabsMatchState() {
  if (!api.tabs || !api.tabs.query) {
    return;
  }
  try {
    const tabs = await api.tabs.query({});
    for (const tab of tabs) {
      if (!tab || typeof tab.id === "undefined" || !tab.url) {
        continue;
      }
      const fingerprint = await computeFingerprint(tab.url);
      if (!fingerprint) {
        await setActionState(tab.id, MATCH_STATE.none);
        continue;
      }
      const match = await findVisitMatch(fingerprint);
      const state = match.state || MATCH_STATE.none;
      lastMatchStateByTab.set(tab.id, state);
      if (state === MATCH_STATE.partial) {
        forcedPartialByTab.add(tab.id);
      } else {
        forcedPartialByTab.delete(tab.id);
      }
      await setActionState(tab.id, state);
    }
  } catch (error) {
    // ignore refresh errors
  }
}

function parseBadgeColorToRgba(color) {
  if (typeof color !== "string") {
    return [14, 154, 105, 255];
  }
  const cleaned = color.replace("#", "").trim();
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(cleaned)) {
    return [14, 154, 105, 255];
  }
  const hex = cleaned.toLowerCase();
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

async function updateDownloadBadgeAppearance(settings) {
  if (settings.downloadBadgeEnabled === false) {
    clearDownloadBadge();
    return;
  }
  if (!downloadBadgeVisible) {
    return;
  }
  if (actionApi && actionApi.setBadgeBackgroundColor) {
    const color = parseBadgeColorToRgba(settings.downloadBadgeColor);
    actionApi.setBadgeBackgroundColor({ color });
  }
  scheduleDownloadBadgeClear(settings.downloadBadgeDurationMs);
  sendDownloadBadgeUpdate(true);
}

function scheduleDownloadBadgeClear(durationMs) {
  if (downloadBadgeTimer) {
    clearTimeout(downloadBadgeTimer);
    downloadBadgeTimer = null;
  }
  if (!durationMs || durationMs <= 0) {
    return;
  }
  downloadBadgeTimer = setTimeout(() => {
    clearDownloadBadge();
  }, durationMs);
}

function clearDownloadBadge() {
  if (downloadBadgeTimer) {
    clearTimeout(downloadBadgeTimer);
    downloadBadgeTimer = null;
  }
  downloadBadgeVisible = false;
  downloadBadgeCount = 0;
  downloadBadgeItems = [];
  if (actionApi && actionApi.setBadgeText) {
    actionApi.setBadgeText({ text: "" });
  }
  sendDownloadBadgeUpdate(false);
}

async function showDownloadBadge() {
  const settings = downloadBadgeSettingsCache || (await getDownloadBadgeSettings());
  downloadBadgeSettingsCache = settings;
  if (settings.downloadBadgeEnabled === false) {
    clearDownloadBadge();
    return;
  }
  if (downloadBadgeCount <= 0) {
    clearDownloadBadge();
    return;
  }
  if (actionApi && actionApi.setBadgeBackgroundColor) {
    const color = parseBadgeColorToRgba(settings.downloadBadgeColor);
    actionApi.setBadgeBackgroundColor({ color });
  }
  if (actionApi && actionApi.setBadgeText) {
    actionApi.setBadgeText({ text: String(downloadBadgeCount) });
  }
  downloadBadgeVisible = true;
  scheduleDownloadBadgeClear(settings.downloadBadgeDurationMs);
  sendDownloadBadgeUpdate(true);
}

function sendDownloadBadgeUpdate(visible) {
  try {
    if (!api?.runtime?.sendMessage) {
      return;
    }
    if (!visible) {
      api.runtime.sendMessage({ type: "DOWNLOAD_BADGE_UPDATED", visible: false, count: 0, items: [] });
      return;
    }
    const items = downloadBadgeItems.slice(0, downloadBadgeCount);
    api.runtime.sendMessage({
      type: "DOWNLOAD_BADGE_UPDATED",
      visible: true,
      count: downloadBadgeCount,
      items
    });
  } catch (error) {
    // ignore broadcast errors
  }
}

function registerDuplicateDownload(item) {
  if (!item) return;
  if (!downloadBadgeVisible) {
    downloadBadgeCount = 0;
    downloadBadgeItems = [];
  }
  downloadBadgeCount += 1;
  downloadBadgeItems.unshift(item);
  showDownloadBadge().catch(() => {
    // ignore badge update errors
  });
}

async function handleTabComplete(tabId, changeInfo, tab) {
  if (!tab || !tab.url || changeInfo.status !== "complete") {
    return;
  }

  const fingerprint = await computeFingerprint(tab.url);
  if (!fingerprint) {
    await setActionState(tabId, MATCH_STATE.none);
    return;
  }

  const match = await findVisitMatch(fingerprint);

  const lastKey = lastSavedByTab.get(tabId);
  if (lastKey && lastKey === fingerprint.id) {
    let existingState = match.state || MATCH_STATE.none;
    if (pendingFirstVisit.has(tabId)) {
      existingState = MATCH_STATE.none;
    }
    lastMatchStateByTab.set(tabId, existingState);
    if (existingState === MATCH_STATE.partial) {
      forcedPartialByTab.add(tabId);
    } else {
      forcedPartialByTab.delete(tabId);
    }
    await setActionState(tabId, existingState);
    return;
  }

  let state = match.state || MATCH_STATE.none;
  if (state === MATCH_STATE.partial) {
    forcedPartialByTab.add(tabId);
  } else {
    forcedPartialByTab.delete(tabId);
  }
  if (state === MATCH_STATE.full || state === MATCH_STATE.partial) {
    pendingFirstVisit.delete(tabId);
  } else {
    pendingFirstVisit.add(tabId);
  }

  lastMatchStateByTab.set(tabId, state);
  if (match.record && typeof match.record.lastVisited === "number") {
    lastPrevVisitByTab.set(tabId, match.record.lastVisited);
  } else {
    lastPrevVisitByTab.delete(tabId);
  }
  await setActionState(tabId, state);

  await upsertVisit(tab.url);
  lastSavedByTab.set(tabId, fingerprint.id);
}

async function handleTabActivated(activeInfo) {
  try {
    const tab = await api.tabs.get(activeInfo.tabId);
    if (pendingFirstVisit.has(activeInfo.tabId)) {
      await setActionState(tab.id, MATCH_STATE.none);
      return;
    }
    const fingerprint = await computeFingerprint(tab.url);
    if (!fingerprint) {
      await setActionState(tab.id, MATCH_STATE.none);
      return;
    }
    const match = await findVisitMatch(fingerprint);
    let state = match.state || MATCH_STATE.none;
    if (forcedPartialByTab.has(tab.id)) {
      state = MATCH_STATE.partial;
    }
    lastMatchStateByTab.set(tab.id, state);
    await setActionState(tab.id, state);
  } catch (error) {
    console.warn("Could not update tab state:", error);
  }
}

async function handleWindowFocusChanged(windowId) {
  if (windowId === api.windows.WINDOW_ID_NONE) {
    return;
  }
  try {
    const [tab] = await api.tabs.query({ active: true, windowId });
    if (tab) {
      if (pendingFirstVisit.has(tab.id)) {
        await setActionState(tab.id, MATCH_STATE.none);
        return;
      }
      const fingerprint = await computeFingerprint(tab.url);
      if (!fingerprint) {
        await setActionState(tab.id, MATCH_STATE.none);
        return;
      }
      const match = await findVisitMatch(fingerprint);
      let state = match.state || MATCH_STATE.none;
      if (forcedPartialByTab.has(tab.id)) {
        state = MATCH_STATE.partial;
      }
      lastMatchStateByTab.set(tab.id, state);
      await setActionState(tab.id, state);
    }
  } catch (error) {
    console.warn("Could not synchronize window:", error);
  }
}

function handleBeforeNavigate(details) {
  if (!details || details.frameId !== 0 || typeof details.tabId !== "number") {
    return;
  }
  if (!firstNavigationUrlByTab.has(details.tabId)) {
    firstNavigationUrlByTab.set(details.tabId, details.url || "");
  }
}

async function handleNavigationCommitted(details) {
  if (!details || details.frameId !== 0 || typeof details.tabId !== "number") {
    return;
  }

  const initialUrl = firstNavigationUrlByTab.get(details.tabId);
  if (initialUrl && initialUrl !== details.url) {
    try {
      await upsertVisit(initialUrl);
    } catch (error) {
      // ignore redirect tracking errors
    }
  }

  firstNavigationUrlByTab.delete(details.tabId);
}

async function handleDownloadCreated(item) {
  try {
    if (!item) return;
    if (item.byExtensionId && api?.runtime?.id && item.byExtensionId === api.runtime.id) {
      return;
    }
    const candidates = [];
    if (typeof item.finalUrl === "string") {
      candidates.push(item.finalUrl);
    }
    if (typeof item.url === "string") {
      candidates.push(item.url);
    }
    const urls = Array.from(new Set(candidates)).filter(
      (url) => !url.startsWith("blob:") && !url.startsWith("data:")
    );
    if (!urls.length) {
      return;
    }
    const tasks = urls.map((url) =>
      upsertVisit(url, { download: true })
        .then((result) => ({ url, result }))
        .catch(() => null)
    );
    if (!tasks.length) {
      return;
    }
    const results = await Promise.all(tasks);
    const repeated = results.find((entry) => entry && entry.result && entry.result.existedBefore);
    if (!repeated) {
      return;
    }
    const record = repeated.result.record;
    const previousLastVisited =
      repeated.result.previousLastVisited || (record ? record.lastVisited : null);
    if (!record) {
      return;
    }
    registerDuplicateDownload({
      id: record.id,
      host: record.host,
      path: record.path,
      query: record.query,
      fragment: record.fragment,
      lastVisited: previousLastVisited,
      hashed: record.hashed !== false
    });
  } catch (error) {
    // ignore badge tracking errors
  }
}

async function handleGetVisitForUrl(urlString, tabId) {
  const fingerprint = await computeFingerprint(urlString);
  if (!fingerprint) {
    return { visitCount: 0, lastVisited: null, matchState: MATCH_STATE.none };
  }

  const match = await findVisitMatch(fingerprint);
  const record = match.record;

  if (!record) {
    return { visitCount: 0, lastVisited: null, matchState: match.state || MATCH_STATE.none };
  }

  let lastVisited = record.lastVisited || null;
  if (tabId && lastPrevVisitByTab.has(tabId)) {
    lastVisited = lastPrevVisitByTab.get(tabId);
  }

  return {
    visitCount: record.visitCount || 0,
    lastVisited,
    matchState: match.state || MATCH_STATE.none
  };
}

async function bootstrapActiveTab() {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id !== undefined) {
      const visited = await isVisited(tab.url);
      await setActionState(tab.id, visited);
    }
  } catch (error) {
    // ignore bootstrap failures
  }
}

bootstrapActiveTab();
