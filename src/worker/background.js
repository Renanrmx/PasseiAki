const api = typeof browser !== "undefined" ? browser : chrome;
const actionApi = api.action || api.browserAction;

const DB_NAME = "passeiAki";
const DB_VERSION = 1;
const VISITS_STORE = "visits";
const META_STORE = "meta";
const META_PEPPER_KEY = "pepper";

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);
const ACTION_ICONS = {
  viewed: {
    16: "icons/check-mark-16-viewed.png",
    19: "icons/check-mark-19-viewed.png",
    24: "icons/check-mark-24-viewed.png",
    32: "icons/check-mark-32-viewed.png",
    38: "icons/check-mark-38-viewed.png",
    48: "icons/check-mark-48-viewed.png",
    96: "icons/check-mark-96-viewed.png"
  },
  partial: {
    16: "icons/check-mark-16-partial.png",
    19: "icons/check-mark-19-partial.png",
    24: "icons/check-mark-24-partial.png",
    32: "icons/check-mark-32-partial.png",
    38: "icons/check-mark-38-partial.png",
    48: "icons/check-mark-48-partial.png",
    96: "icons/check-mark-96-partial.png"
  },
  default: {
    16: "icons/check-mark-16.png",
    19: "icons/check-mark-19.png",
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
      const db = await openDatabase();
      const tx = db.transaction(VISITS_STORE, "readwrite");
      tx.objectStore(VISITS_STORE).delete(message.id);
      await waitForTransaction(tx);
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
        const result = await exportPlainVisitsCsv(message.filename);
        return { ok: true, exported: result.exported };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === "EXPORT_VISITS_TXT") {
      return (async () => {
        const result = await exportPlainVisitsTxt(message.filename);
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

  return true; // indica que respondere async
});

api.runtime.onInstalled.addListener(async () => {
  await ensurePepperKey();
  await openDatabase();
});

async function upsertVisit(urlString) {
  const fingerprint = await computeFingerprint(urlString);
  if (!fingerprint) {
    return null;
  }

  const db = await openDatabase();
  const tx = db.transaction(VISITS_STORE, "readwrite");
  const store = tx.objectStore(VISITS_STORE);

  let existing = null;
  const idsToTry = Array.from(
    new Set([fingerprint.id, fingerprint.ids?.hash, fingerprint.ids?.plain].filter(Boolean))
  );
  for (const id of idsToTry) {
    const found = await requestToPromise(store.get(id));
    if (found) {
      existing = found;
      break;
    }
  }

  const now = Date.now();

  const existedBefore = Boolean(existing);
  const hashed = existing ? existing.hashed !== false : fingerprint.storedHashed;
  const keySet = hashed ? fingerprint.keys.hash : fingerprint.keys.plain;
  const recordId = hashed ? fingerprint.ids?.hash || fingerprint.id : fingerprint.ids?.plain || fingerprint.id;
  const paramKeys = hashed ? fingerprint.keys.hash.params : fingerprint.keys.plain.params;

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
    lastVisited: now
  };

  const record = existedBefore
    ? { ...existing, ...baseRecord, visitCount: (existing.visitCount || 0) + 1 }
    : { ...baseRecord, visitCount: 1 };

  store.put(record);
  await waitForTransaction(tx);
  try {
    if (api.runtime && api.runtime.sendMessage) {
      api.runtime.sendMessage({ type: "HISTORY_UPDATED" });
    }
  } catch (error) {
    // ignore broadcast errors
  }
  return { record, existedBefore };
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
