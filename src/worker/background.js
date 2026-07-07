const api = typeof browser !== "undefined" ? browser : chrome;
const actionApi = api.action || api.browserAction;

if (typeof importScripts === "function") {
  importScripts("../shared/messages.js", "../shared/records.js", "../shared/domains.js");
}

const MSG = globalThis.AKI_MESSAGE_TYPES;

const DB_NAME = "passeiAki";
const DB_VERSION = 3;
const VISITS_STORE = "visits";
const META_STORE = "meta";
const PARTIAL_EXCEPTIONS_STORE = "partial_exceptions";
const MATCH_EXCEPTIONS_STORE = "match_exceptions";
const MIRROR_GROUPS_STORE = "mirror_groups";
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

const EXTENSION_PAGE_MESSAGE_TYPES = new Set([
  MSG.CLEAR_VISIT_HISTORY,
  MSG.CREATE_BACKUP,
  MSG.CREATE_BACKUP_DOWNLOAD,
  MSG.DELETE_VISIT,
  MSG.DISMISS_DOWNLOAD_BADGE,
  MSG.EXPORT_VISITS_CSV,
  MSG.EXPORT_VISITS_TXT,
  MSG.GET_DOWNLOAD_BADGE_SETTINGS,
  MSG.GET_DOWNLOAD_BADGE_STATE,
  MSG.GET_ENCRYPTION_ENABLED,
  MSG.GET_MATCH_EXCEPTIONS,
  MSG.GET_MIRROR_GROUPS,
  MSG.GET_PARTIAL_EXCEPTIONS,
  MSG.GET_PARTIAL_MATCHES,
  MSG.GET_PERSISTENCE_STATUS,
  MSG.GET_STATS,
  MSG.GET_SUPPORT_STATUS,
  MSG.GET_VISIT_FOR_URL,
  MSG.IMPORT_ADDRESSES,
  MSG.RESTORE_BACKUP,
  MSG.SEARCH_HISTORY,
  MSG.SET_DOWNLOAD_BADGE_SETTINGS,
  MSG.SET_ENCRYPTION_ENABLED,
  MSG.SET_LINK_COLORS,
  MSG.SET_MATCH_EXCEPTIONS,
  MSG.SET_MIRROR_GROUPS,
  MSG.SET_PARTIAL_EXCEPTIONS,
  MSG.SUPPORT_TAB_OPENED
]);

const CONTENT_SCRIPT_MESSAGE_TYPES = new Set([
  MSG.CHECK_VISITED_LINKS,
  MSG.GET_PAGE_EXCEPTION_FLAGS
]);

const SHARED_CONTEXT_MESSAGE_TYPES = new Set([
  MSG.GET_LINK_COLORS
]);

const EXTENSION_BASE_URL = api?.runtime?.getURL ? api.runtime.getURL("") : "";

function isExtensionDocumentUrl(url) {
  return typeof url === "string" && EXTENSION_BASE_URL && url.startsWith(EXTENSION_BASE_URL);
}

function isOwnExtensionSender(sender) {
  if (!sender) return false;
  if (sender.id && api?.runtime?.id && sender.id !== api.runtime.id) {
    return false;
  }
  return true;
}

function isExtensionPageSender(sender) {
  if (!isOwnExtensionSender(sender)) return false;
  return isExtensionDocumentUrl(sender.url) || isExtensionDocumentUrl(sender.origin);
}

function isContentScriptSender(sender) {
  if (!isOwnExtensionSender(sender) || !sender?.tab) return false;
  const urlString = sender.url || sender.tab.url || "";
  try {
    const url = new URL(urlString);
    return SUPPORTED_PROTOCOLS.has(url.protocol);
  } catch (error) {
    return false;
  }
}

function isAuthorizedMessageSender(type, sender) {
  const fromExtensionPage = isExtensionPageSender(sender);
  const fromContentScript = isContentScriptSender(sender);

  if (SHARED_CONTEXT_MESSAGE_TYPES.has(type)) {
    return fromExtensionPage || fromContentScript;
  }
  if (EXTENSION_PAGE_MESSAGE_TYPES.has(type)) {
    return fromExtensionPage;
  }
  if (CONTENT_SCRIPT_MESSAGE_TYPES.has(type)) {
    return fromContentScript;
  }
  return false;
}

function isSupportedTabUrl(urlString) {
  if (typeof urlString !== "string") return false;
  try {
    const url = new URL(urlString);
    return SUPPORTED_PROTOCOLS.has(url.protocol);
  } catch (error) {
    return false;
  }
}

async function queryAllTabs() {
  if (!api.tabs || !api.tabs.query) {
    return [];
  }
  try {
    const result = api.tabs.query({});
    if (result && typeof result.then === "function") {
      const tabs = await result;
      return Array.isArray(tabs) ? tabs : [];
    }
  } catch (error) {
    // fall back to callback-style APIs
  }
  return new Promise((resolve) => {
    try {
      api.tabs.query({}, (tabs) => {
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    } catch (error) {
      resolve([]);
    }
  });
}

function sendRuntimeMessageSafe(message) {
  try {
    if (!api.runtime || !api.runtime.sendMessage) {
      return;
    }
    const result = api.runtime.sendMessage(message);
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (error) {
    // ignore broadcast errors
  }
}

function sendTabMessageSafe(tabId, message) {
  try {
    const result = api.tabs.sendMessage(tabId, message);
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (error) {
    // ignore per-tab errors
  }
}

async function broadcastToContentTabs(message) {
  if (!api.tabs || !api.tabs.sendMessage) {
    return;
  }
  const tabs = await queryAllTabs();
  tabs.forEach((tab) => {
    if (!tab || typeof tab.id === "undefined" || !isSupportedTabUrl(tab.url)) {
      return;
    }
    sendTabMessageSafe(tab.id, message);
  });
}

async function broadcastMessagesToContentTabs(messages) {
  if (!api.tabs || !api.tabs.sendMessage || !Array.isArray(messages) || !messages.length) {
    return;
  }
  const tabs = await queryAllTabs();
  tabs.forEach((tab) => {
    if (!tab || typeof tab.id === "undefined" || !isSupportedTabUrl(tab.url)) {
      return;
    }
    messages.forEach((message) => sendTabMessageSafe(tab.id, message));
  });
}

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
    "background.mirrors.js",
    "background.match.js",
    "background.history.js",
    "background.highlight.js",
    "background.downloads.js",
    "background.support.js",
    "background.backup.js",
    "background.import.js",
    "background.export.js",
    "background.init.js"
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
  if (typeof handleSupportTabRemoved === "function") {
    handleSupportTabRemoved(tabId);
  }
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

    if (!isAuthorizedMessageSender(message.type, sender)) {
      return { ok: false, error: "Unauthorized message sender" };
    }

    if (
      message.type !== MSG.RESTORE_BACKUP &&
      typeof ensureWwwNormalizationMigration === "function"
    ) {
      await ensureWwwNormalizationMigration();
    }

    if (message.type === MSG.CHECK_VISITED_LINKS) {
      return handleCheckVisitedLinks(message.links || [], {
        skipFull: message.skipFull === true,
        skipPartial: message.skipPartial === true
      });
    }

    if (message.type === MSG.GET_STATS) {
      return handleGetStats();
    }

    if (message.type === MSG.SEARCH_HISTORY) {
      return handleSearchHistory(message.query || "");
    }

    if (message.type === MSG.GET_PARTIAL_MATCHES) {
      return (async () => {
        const fingerprint = await computeFingerprint(message.url || "");
        if (!fingerprint) return { items: [] };
        const items = await findPartialMatches(fingerprint, 5, { hostCache: new Map() });
        return { items };
      })();
    }

    if (message.type === MSG.DELETE_VISIT) {
      return (async () => {
        await deleteVisitById(message.id);
        sendRuntimeMessageSafe({ type: MSG.HISTORY_UPDATED });
        return { ok: true };
      })().catch((error) => ({ ok: false, error: error?.message || String(error) }));
    }

    if (message.type === MSG.CLEAR_VISIT_HISTORY) {
      return (async () => {
        await clearVisitHistory();
        if (typeof clearDownloadBadge === "function") {
          clearDownloadBadge();
        }
        lastSavedByTab.clear();
        lastMatchStateByTab.clear();
        lastPrevVisitByTab.clear();
        pendingFirstVisit.clear();
        forcedPartialByTab.clear();
        sendRuntimeMessageSafe({ type: MSG.HISTORY_UPDATED });
        await broadcastToContentTabs({ type: MSG.REFRESH_HIGHLIGHT });
        return { ok: true };
      })().catch((error) => ({ ok: false, error: error?.message || String(error) }));
    }

    if (message.type === MSG.GET_VISIT_FOR_URL) {
      if (message.tabId && lastMatchStateByTab.has(message.tabId)) {
        const res = await handleGetVisitForUrl(message.url || "", message.tabId);
        return {
          ...res,
          matchState: lastMatchStateByTab.get(message.tabId) || res.matchState
        };
      }
      return handleGetVisitForUrl(message.url || "", message.tabId);
    }

    if (message.type === MSG.GET_ENCRYPTION_ENABLED) {
      const value = await getEncryptionEnabled();
      return { encryptionEnabled: value };
    }

    if (message.type === MSG.SET_ENCRYPTION_ENABLED) {
      await setEncryptionEnabled(Boolean(message.enabled));
      return { ok: true };
    }

    if (message.type === MSG.CREATE_BACKUP) {
      const envelope = await createBackup(message.password || "", {
        protectWithPassword: message.protectWithPassword !== false
      });
      return { ok: true, envelope };
    }

    if (message.type === MSG.CREATE_BACKUP_DOWNLOAD) {
      const envelope = await createBackup(message.password || "", {
        protectWithPassword: message.protectWithPassword !== false
      });
      await downloadBackup(envelope, message.filename);
      return { ok: true };
    }

    if (message.type === MSG.RESTORE_BACKUP) {
      try {
        await restoreBackup(message.password || "", message.envelope, {
          mergeVisits: message.mergeVisits === true
        });
        return { ok: true };
      } catch (error) {
        console.error("Backup restore failed:", error);
        return { ok: false, error: error && error.message ? error.message : String(error) };
      }
    }

    if (message.type === MSG.EXPORT_VISITS_CSV) {
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

    if (message.type === MSG.EXPORT_VISITS_TXT) {
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

    if (message.type === MSG.GET_LINK_COLORS) {
      return (async () => {
        const colors = await getLinkColors();
        return { ok: true, colors };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.SET_LINK_COLORS) {
      return (async () => {
        const colors = await setLinkColors({
          matchHexColor: message.matchHexColor,
          partialHexColor: message.partialHexColor,
          matchTextEnabled: message.matchTextEnabled,
          partialTextEnabled: message.partialTextEnabled,
          matchBorderEnabled: message.matchBorderEnabled,
          partialBorderEnabled: message.partialBorderEnabled
        });
        sendRuntimeMessageSafe({ type: MSG.LINK_COLORS_UPDATED, colors });
        await broadcastToContentTabs({ type: MSG.LINK_COLORS_UPDATED, colors });
        return { ok: true, colors };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.GET_DOWNLOAD_BADGE_SETTINGS) {
      return (async () => {
        const settings = await getDownloadBadgeSettings();
        return { ok: true, settings };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.GET_PARTIAL_EXCEPTIONS) {
      return (async () => {
        const items = await getAllPartialExceptions();
        return { ok: true, items };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.SET_PARTIAL_EXCEPTIONS) {
      return (async () => {
        const items = await setPartialExceptions(message.items || []);
        await broadcastToContentTabs({ type: MSG.REFRESH_HIGHLIGHT });
        refreshAllTabsMatchState();
        return { ok: true, items };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.GET_MATCH_EXCEPTIONS) {
      return (async () => {
        const items = await getAllMatchExceptions();
        return { ok: true, items };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.GET_MIRROR_GROUPS) {
      return (async () => {
        const groups = await getMirrorGroups();
        return { ok: true, groups };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.SET_MIRROR_GROUPS) {
      return (async () => {
        const groups = await setMirrorGroups(message.groups || []);
        lastSavedByTab.clear();
        lastMatchStateByTab.clear();
        lastPrevVisitByTab.clear();
        pendingFirstVisit.clear();
        forcedPartialByTab.clear();
        sendRuntimeMessageSafe({ type: MSG.HISTORY_UPDATED });
        await broadcastToContentTabs({ type: MSG.REFRESH_HIGHLIGHT });
        refreshAllTabsMatchState();
        return { ok: true, groups };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.GET_PAGE_EXCEPTION_FLAGS) {
      return (async () => {
        const url = message.url || "";
        const matchException = await isMatchException(url);
        const partialException = await isPartialException(url);
        return { ok: true, matchException, partialException };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.SET_MATCH_EXCEPTIONS) {
      return (async () => {
        const items = await setMatchExceptions(message.items || []);
        await broadcastToContentTabs({ type: MSG.REFRESH_HIGHLIGHT });
        refreshAllTabsMatchState();
        return { ok: true, items };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.GET_DOWNLOAD_BADGE_STATE) {
      return (async () => {
        const settings = getDownloadBadgeSettingsCache() || (await getDownloadBadgeSettings());
        setDownloadBadgeSettingsCache(settings);
        if (settings.downloadBadgeEnabled === false) {
          clearDownloadBadge();
          return { ok: true, visible: false, count: 0, items: [] };
        }
        const state = getDownloadBadgeState();
        if (!state.visible || state.count <= 0) {
          return { ok: true, visible: false, count: 0, items: [] };
        }
        return {
          ok: true,
          visible: true,
          count: state.count,
          items: state.items.slice(0, state.count)
        };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.GET_SUPPORT_STATUS) {
      return (async () => {
        const status = await getSupportStatus();
        return { ok: true, visible: status.visible, supportAt: status.supportAt };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.GET_PERSISTENCE_STATUS) {
      return (async () => {
        const status = await getPersistenceStatus();
        return { ok: true, ...status };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.SUPPORT_TAB_OPENED) {
      return (async () => {
        await beginSupportTracking(message.tabId);
        return { ok: true };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.DISMISS_DOWNLOAD_BADGE) {
      clearDownloadBadge();
      return { ok: true };
    }

    if (message.type === MSG.SET_DOWNLOAD_BADGE_SETTINGS) {
      return (async () => {
        const settings = await setDownloadBadgeSettings({
          downloadBadgeColor: message.downloadBadgeColor,
          downloadBadgeDurationMs: message.downloadBadgeDurationMs,
          downloadBadgeEnabled: message.downloadBadgeEnabled
        });
        setDownloadBadgeSettingsCache(settings);
        await updateDownloadBadgeAppearance(settings);
        return { ok: true, settings };
      })().catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    }

    if (message.type === MSG.IMPORT_ADDRESSES) {
      return (async () => {
        if (typeof message.content !== "string") {
          throw new Error("Invalid import content");
        }
        const result = await importAddressesFromText(message.content, {
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
  if (typeof ensureWwwNormalizationMigration === "function") {
    await ensureWwwNormalizationMigration();
  }

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
  if (typeof waitForMirrorMigrationLock === "function") {
    await waitForMirrorMigrationLock();
  }

  const fingerprint = await computeFingerprint(urlString);
  if (!fingerprint) {
    return null;
  }

  const selectedCandidateIds = fingerprint.storedHashed
    ? fingerprint.candidateIds?.hash
    : fingerprint.candidateIds?.plain;
  const alternateCandidateIds = fingerprint.storedHashed
    ? fingerprint.candidateIds?.plain
    : fingerprint.candidateIds?.hash;
  const idsToTry = Array.from(
    new Set(
      []
        .concat(
          fingerprint.id,
          fingerprint.ids?.hash,
          fingerprint.ids?.plain,
          selectedCandidateIds,
          alternateCandidateIds
        )
        .filter(Boolean)
    )
  );
  const existingRecords = [];
  for (const id of idsToTry) {
    const found = await getVisitById(id);
    if (found) {
      existingRecords.push(found);
    }
  }

  const now = Date.now();
  const preferredExisting = existingRecords[0] || null;

  const hashed = preferredExisting ? preferredExisting.hashed !== false : fingerprint.storedHashed;
  const existingSameMode = existingRecords.filter((record) => (record.hashed !== false) === hashed);
  const previousLastVisited = existingSameMode.reduce((latest, record) => {
    const value = Number.isFinite(record.lastVisited) ? record.lastVisited : 0;
    return Math.max(latest || 0, value);
  }, null);

  const existedBefore = existingSameMode.length > 0;
  const keySet = hashed ? fingerprint.keys.hash : fingerprint.keys.plain;
  const recordId = hashed ? fingerprint.ids?.hash || fingerprint.id : fingerprint.ids?.plain || fingerprint.id;
  const paramKeys = hashed ? fingerprint.keys.hash.params : fingerprint.keys.plain.params;
  const download =
    options.download === true || existingSameMode.some((record) => record && record.download === true);

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
    download,
    visitCount: 0
  };

  let mergedExisting = null;
  for (const record of existingSameMode) {
    const canonicalRecord =
      typeof canonicalizeVisitForMirrorGroup === "function"
        ? await canonicalizeVisitForMirrorGroup(record, fingerprint.parts.host)
        : { ...record, ...baseRecord, visitCount: record.visitCount || 0 };
    mergedExisting =
      typeof mergeCanonicalVisit === "function"
        ? mergeCanonicalVisit(mergedExisting, canonicalRecord)
        : canonicalRecord;
  }

  const record =
    typeof mergeVisitForCurrentAccess === "function"
      ? mergeVisitForCurrentAccess(mergedExisting, baseRecord)
      : { ...mergedExisting, ...baseRecord, visitCount: (mergedExisting?.visitCount || 0) + 1 };

  if (existedBefore) {
    await replaceVisits(existingSameMode.map((value) => value.id), [record]);
  } else {
    await putVisit(record);
  }
  await adjustStatsTotals(existedBefore ? 1 - existingSameMode.length : 1, 1);
  sendRuntimeMessageSafe({ type: MSG.HISTORY_UPDATED });
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
    const tabs = await queryAllTabs();
    const hostCache = new Map();
    const visitCache = new Map();
    for (const tab of tabs) {
      if (!tab || typeof tab.id === "undefined" || !isSupportedTabUrl(tab.url)) {
        continue;
      }
      const fingerprint = await computeFingerprint(tab.url);
      if (!fingerprint) {
        await setActionState(tab.id, MATCH_STATE.none);
        continue;
      }
      const match = await findVisitMatch(fingerprint, { hostCache, visitCache });
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

async function handleTabComplete(tabId, changeInfo, tab) {
  if (typeof handleSupportTabComplete === "function") {
    handleSupportTabComplete(tab);
  }
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
  let tab = null;
  try {
    tab = await api.tabs.get(activeInfo.tabId);
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
  } finally {
    if (typeof handleSupportTabActivated === "function") {
      await handleSupportTabActivated(tab);
    }
  }
}

async function handleWindowFocusChanged(windowId) {
  if (typeof handleSupportWindowFocusChanged === "function") {
    await handleSupportWindowFocusChanged(windowId);
  }
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
    if (typeof computeFingerprint !== "function" || typeof findVisitMatch !== "function") {
      return;
    }
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id !== undefined) {
      const fingerprint = await computeFingerprint(tab.url);
      if (!fingerprint) {
        await setActionState(tab.id, MATCH_STATE.none);
        return;
      }
      const match = await findVisitMatch(fingerprint);
      const state = match.state || MATCH_STATE.none;
      lastMatchStateByTab.set(tab.id, state);
      await setActionState(tab.id, state);
    }
  } catch (error) {
    // ignore bootstrap failures
  }
}
