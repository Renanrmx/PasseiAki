let pepperKeyPromise = null;
let dbPromise = null;
let dbWriteBlocked = false;
let defaultSettingsPromise = null;

// Fallback for environments where IndexedDB writes are blocked
const memoryVisits = new Map();
const memoryMeta = new Map();
const exceptionStores = {};

function getExceptionStoreState(storeName) {
  if (!exceptionStores[storeName]) {
    exceptionStores[storeName] = { memory: new Map(), cache: null };
  }
  return exceptionStores[storeName];
}

function resetExceptionStoreState(storeName) {
  const state = getExceptionStoreState(storeName);
  state.memory.clear();
  state.cache = null;
}

function getRuntimeApi() {
  if (typeof api !== "undefined" && api?.runtime?.getURL) {
    return api;
  }
  if (typeof browser !== "undefined" && browser?.runtime?.getURL) {
    return browser;
  }
  if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
    return chrome;
  }
  return null;
}

async function getDefaultSettings() {
  if (defaultSettingsPromise) {
    return defaultSettingsPromise;
  }

  defaultSettingsPromise = (async () => {
    try {
      const runtimeApi = getRuntimeApi();
      if (!runtimeApi?.runtime?.getURL || typeof fetch !== "function") {
        return {};
      }
      const url = runtimeApi.runtime.getURL("settings.default.json");
      const response = await fetch(url);
      if (!response.ok) {
        return {};
      }
      const payload = await response.json();
      return payload && typeof payload === "object" ? payload : {};
    } catch (error) {
      return {};
    }
  })();

  return defaultSettingsPromise;
}

function isReadOnlyDbError(error) {
  if (!error) return false;
  if (
    error.name === "ReadOnlyError" ||
    error.name === "InvalidStateError" ||
    error.name === "NotAllowedError" ||
    error.name === "SecurityError"
  ) {
    return true;
  }
  return /did not allow mutations|mutation|readonly|not allowed|not permitted|denied|insecure/i.test(
    error.message || ""
  );
}

function markDbWriteBlocked(error) {
  if (isReadOnlyDbError(error)) {
    dbWriteBlocked = true;
    return true;
  }
  return false;
}

function isDbWriteBlocked() {
  return dbWriteBlocked;
}


function openDatabase() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      dbWriteBlocked = true;
      resolve(null);
      return;
    }

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      if (markDbWriteBlocked(error)) {
        resolve(null);
        return;
      }
      reject(error);
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      try {
        if (!db.objectStoreNames.contains(VISITS_STORE)) {
          const store = db.createObjectStore(VISITS_STORE, { keyPath: "id" });
          store.createIndex("hostHash", "hostHash", { unique: false });
          store.createIndex("lastVisited", "lastVisited", { unique: false });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(PARTIAL_EXCEPTIONS_STORE)) {
          db.createObjectStore(PARTIAL_EXCEPTIONS_STORE, { keyPath: "domain" });
        }
        if (!db.objectStoreNames.contains(MATCH_EXCEPTIONS_STORE)) {
          db.createObjectStore(MATCH_EXCEPTIONS_STORE, { keyPath: "domain" });
        }
      } catch (error) {
        if (markDbWriteBlocked(error)) {
          try {
            event.target.transaction.abort();
          } catch (abortError) {
            // ignore abort errors
          }
        } else {
          throw error;
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      if (isDbWriteBlocked() || markDbWriteBlocked(request.error)) {
        resolve(null);
        return;
      }
      reject(request.error || new Error("IndexedDB failed to open"));
    };
  });

  return dbPromise;
}

function waitForTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readMetaEntry(key) {
  if (isDbWriteBlocked()) {
    return memoryMeta.get(key) || null;
  }
  try {
    const db = await openDatabase();
    if (!db) {
      return memoryMeta.get(key) || null;
    }
    const tx = db.transaction(META_STORE, "readonly");
    const store = tx.objectStore(META_STORE);
    const entry = await requestToPromise(store.get(key));
    await waitForTransaction(tx);
    return entry || null;
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      return memoryMeta.get(key) || null;
    }
    throw error;
  }
}

async function writeMetaEntries(entries) {
  if (isDbWriteBlocked()) {
    entries.forEach((entry) => {
      if (entry && entry.key) {
        memoryMeta.set(entry.key, entry);
      }
    });
    return;
  }

  try {
    const db = await openDatabase();
    if (!db) {
      entries.forEach((entry) => {
        if (entry && entry.key) {
          memoryMeta.set(entry.key, entry);
        }
      });
      return;
    }
    const tx = db.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    entries.forEach((entry) => {
      if (entry && entry.key) {
        store.put(entry);
      }
    });
    await waitForTransaction(tx);
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      entries.forEach((entry) => {
        if (entry && entry.key) {
          memoryMeta.set(entry.key, entry);
        }
      });
      return;
    }
    throw error;
  }
}

async function writeMetaEntry(key, value) {
  await writeMetaEntries([{ key, value }]);
}

async function getAllMetaEntries() {
  if (isDbWriteBlocked()) {
    return Array.from(memoryMeta.values());
  }
  try {
    const db = await openDatabase();
    if (!db) {
      return Array.from(memoryMeta.values());
    }
    const tx = db.transaction(META_STORE, "readonly");
    const store = tx.objectStore(META_STORE);
    const all = [];

    const cursorRequest = store.openCursor();
    await new Promise((resolve, reject) => {
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          all.push(cursor.value);
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
    await waitForTransaction(tx);
    return all;
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      return Array.from(memoryMeta.values());
    }
    throw error;
  }
}

async function getAllPartialExceptions() {
  const stored = await getAllExceptions(PARTIAL_EXCEPTIONS_STORE);
  if (stored.length) {
    return stored;
  }
  const defaults = await getDefaultPartialExceptions();
  if (!defaults.length) {
    return stored;
  }
  await setExceptions(PARTIAL_EXCEPTIONS_STORE, defaults);
  return defaults;
}

async function getAllMatchExceptions() {
  return getAllExceptions(MATCH_EXCEPTIONS_STORE);
}

function normalizeExceptionsList(domains) {
  if (!Array.isArray(domains)) return [];
  const result = [];
  const seen = new Set();
  domains.forEach((domain) => {
    const cleaned = String(domain || "").trim();
    const host = getHostFromInput(cleaned);
    if (!host || seen.has(host)) {
      return;
    }
    seen.add(host);
    result.push(host);
  });
  return result;
}

async function getDefaultPartialExceptions() {
  const defaults = await getDefaultSettings();
  if (!defaults || !Array.isArray(defaults.partialExceptions)) {
    return [];
  }
  return normalizeExceptionsList(defaults.partialExceptions);
}

function buildExceptionsKeySet(domains) {
  const set = new Set();
  domains.forEach((domain) => {
    const key = getDomainKeyFromValue(domain);
    if (key) {
      set.add(key);
    }
  });
  return set;
}

async function getAllExceptions(storeName) {
  const state = getExceptionStoreState(storeName);
  if (isDbWriteBlocked()) {
    return Array.from(state.memory.values()).map((entry) => entry.domain);
  }
  try {
    const db = await openDatabase();
    if (!db) {
      return Array.from(state.memory.values()).map((entry) => entry.domain);
    }
    if (!db.objectStoreNames.contains(storeName)) {
      return Array.from(state.memory.values()).map((entry) => entry.domain);
    }
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const all = [];

    const cursorRequest = store.openCursor();
    await new Promise((resolve, reject) => {
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value && cursor.value.domain) {
            all.push(cursor.value.domain);
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
    await waitForTransaction(tx);
    return all;
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      return Array.from(state.memory.values()).map((entry) => entry.domain);
    }
    throw error;
  }
}

async function getExceptionsSet(storeName) {
  const state = getExceptionStoreState(storeName);
  if (state.cache) {
    return state.cache;
  }
  let all = await getAllExceptions(storeName);
  const normalized = normalizeExceptionsList(all);
  const normalizedKey = normalized.join("\n");
  const storedKey = Array.isArray(all) ? all.join("\n") : "";
  if (normalized.length && normalizedKey !== storedKey) {
    await setExceptions(storeName, normalized);
    return getExceptionStoreState(storeName).cache || buildExceptionsKeySet(normalized);
  }
  if (!all.length && storeName === PARTIAL_EXCEPTIONS_STORE) {
    const defaults = await getDefaultPartialExceptions();
    if (defaults.length) {
      await setExceptions(storeName, defaults);
      return getExceptionStoreState(storeName).cache || buildExceptionsKeySet(defaults);
    }
  }
  state.cache = buildExceptionsKeySet(normalized);
  return state.cache;
}

async function setExceptions(storeName, domains) {
  const state = getExceptionStoreState(storeName);
  const normalized = normalizeExceptionsList(domains);
  if (isDbWriteBlocked()) {
    state.memory.clear();
    normalized.forEach((domain) => {
      state.memory.set(domain, { domain });
    });
    state.cache = buildExceptionsKeySet(normalized);
    return normalized;
  }
  try {
    const db = await openDatabase();
    if (!db) {
      state.memory.clear();
      normalized.forEach((domain) => {
        state.memory.set(domain, { domain });
      });
      state.cache = buildExceptionsKeySet(normalized);
      return normalized;
    }
    if (!db.objectStoreNames.contains(storeName)) {
      state.memory.clear();
      normalized.forEach((domain) => {
        state.memory.set(domain, { domain });
      });
      state.cache = buildExceptionsKeySet(normalized);
      return normalized;
    }
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.clear();
    normalized.forEach((domain) => {
      store.put({ domain });
    });
    await waitForTransaction(tx);
    state.cache = buildExceptionsKeySet(normalized);
    return normalized;
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      state.memory.clear();
      normalized.forEach((domain) => {
        state.memory.set(domain, { domain });
      });
      state.cache = buildExceptionsKeySet(normalized);
      return normalized;
    }
    throw error;
  }
}

async function isException(storeName, value) {
  const key = getDomainKeyFromValue(value);
  if (!key) return false;
  const set = await getExceptionsSet(storeName);
  return set.has(key);
}

async function setPartialExceptions(domains) {
  return setExceptions(PARTIAL_EXCEPTIONS_STORE, domains);
}

async function setMatchExceptions(domains) {
  return setExceptions(MATCH_EXCEPTIONS_STORE, domains);
}

async function isPartialException(value) {
  return isException(PARTIAL_EXCEPTIONS_STORE, value);
}

async function isMatchException(value) {
  return isException(MATCH_EXCEPTIONS_STORE, value);
}

async function getVisitById(id) {
  if (isDbWriteBlocked()) {
    return memoryVisits.get(id) || null;
  }
  try {
    const db = await openDatabase();
    if (!db) {
      return memoryVisits.get(id) || null;
    }
    const tx = db.transaction(VISITS_STORE, "readonly");
    const store = tx.objectStore(VISITS_STORE);
    const record = await requestToPromise(store.get(id));
    await waitForTransaction(tx);
    return record || null;
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      return memoryVisits.get(id) || null;
    }
    throw error;
  }
}

async function getVisitsByHost(hostHash) {
  if (isDbWriteBlocked()) {
    return Array.from(memoryVisits.values()).filter((record) => record.hostHash === hostHash);
  }
  try {
    const db = await openDatabase();
    if (!db) {
      return Array.from(memoryVisits.values()).filter((record) => record.hostHash === hostHash);
    }
    const tx = db.transaction(VISITS_STORE, "readonly");
    const store = tx.objectStore(VISITS_STORE);
    const index = store.index("hostHash");
    const range = IDBKeyRange.only(hostHash);
    const cursorReq = index.openCursor(range);
    const matches = [];

    await new Promise((resolve, reject) => {
      cursorReq.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          matches.push(cursor.value);
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    await waitForTransaction(tx);
    return matches;
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      return Array.from(memoryVisits.values()).filter((record) => record.hostHash === hostHash);
    }
    throw error;
  }
}

async function getAllVisits() {
  if (isDbWriteBlocked()) {
    return Array.from(memoryVisits.values());
  }
  try {
    const db = await openDatabase();
    if (!db) {
      return Array.from(memoryVisits.values());
    }
    const tx = db.transaction(VISITS_STORE, "readonly");
    const store = tx.objectStore(VISITS_STORE);
    const all = [];

    const cursorRequest = store.openCursor();
    await new Promise((resolve, reject) => {
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          all.push(cursor.value);
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
    await waitForTransaction(tx);
    return all;
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      return Array.from(memoryVisits.values());
    }
    throw error;
  }
}

async function putVisit(record) {
  if (isDbWriteBlocked()) {
    memoryVisits.set(record.id, record);
    return;
  }

  try {
    const db = await openDatabase();
    if (!db) {
      memoryVisits.set(record.id, record);
      return;
    }
    const tx = db.transaction(VISITS_STORE, "readwrite");
    const store = tx.objectStore(VISITS_STORE);
    store.put(record);
    await waitForTransaction(tx);
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      memoryVisits.set(record.id, record);
      return;
    }
    throw error;
  }
}

async function putVisits(records) {
  if (isDbWriteBlocked()) {
    records.forEach((record) => {
      if (record && record.id) {
        memoryVisits.set(record.id, record);
      }
    });
    return;
  }

  try {
    const db = await openDatabase();
    if (!db) {
      records.forEach((record) => {
        if (record && record.id) {
          memoryVisits.set(record.id, record);
        }
      });
      return;
    }
    const tx = db.transaction(VISITS_STORE, "readwrite");
    const store = tx.objectStore(VISITS_STORE);
    records.forEach((record) => {
      if (record && record.id) {
        store.put(record);
      }
    });
    await waitForTransaction(tx);
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      records.forEach((record) => {
        if (record && record.id) {
          memoryVisits.set(record.id, record);
        }
      });
      return;
    }
    throw error;
  }
}

async function deleteVisitById(id) {
  if (isDbWriteBlocked()) {
    memoryVisits.delete(id);
    return;
  }

  try {
    const db = await openDatabase();
    if (!db) {
      memoryVisits.delete(id);
      return;
    }
    const tx = db.transaction(VISITS_STORE, "readwrite");
    tx.objectStore(VISITS_STORE).delete(id);
    await waitForTransaction(tx);
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      memoryVisits.delete(id);
      return;
    }
    throw error;
  }
}

async function clearAllData() {
  if (isDbWriteBlocked()) {
    memoryVisits.clear();
    memoryMeta.clear();
    resetExceptionStoreState(PARTIAL_EXCEPTIONS_STORE);
    resetExceptionStoreState(MATCH_EXCEPTIONS_STORE);
    return;
  }

  try {
    const db = await openDatabase();
    if (!db) {
      memoryVisits.clear();
      memoryMeta.clear();
      resetExceptionStoreState(PARTIAL_EXCEPTIONS_STORE);
      resetExceptionStoreState(MATCH_EXCEPTIONS_STORE);
      return;
    }
    const stores = [VISITS_STORE, META_STORE];
    if (db.objectStoreNames.contains(PARTIAL_EXCEPTIONS_STORE)) {
      stores.push(PARTIAL_EXCEPTIONS_STORE);
    }
    if (db.objectStoreNames.contains(MATCH_EXCEPTIONS_STORE)) {
      stores.push(MATCH_EXCEPTIONS_STORE);
    }
    const tx = db.transaction(stores, "readwrite");
    tx.objectStore(VISITS_STORE).clear();
    tx.objectStore(META_STORE).clear();
    if (db.objectStoreNames.contains(PARTIAL_EXCEPTIONS_STORE)) {
      tx.objectStore(PARTIAL_EXCEPTIONS_STORE).clear();
    }
    if (db.objectStoreNames.contains(MATCH_EXCEPTIONS_STORE)) {
      tx.objectStore(MATCH_EXCEPTIONS_STORE).clear();
    }
    await waitForTransaction(tx);
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      memoryVisits.clear();
      memoryMeta.clear();
      resetExceptionStoreState(PARTIAL_EXCEPTIONS_STORE);
      resetExceptionStoreState(MATCH_EXCEPTIONS_STORE);
      return;
    }
    throw error;
  }
}

async function getEncryptionEnabled() {
  if (encryptionEnabledCache !== null) {
    return encryptionEnabledCache;
  }

  const stored = await readMetaEntry("encryptionEnabled");
  const defaults = await getDefaultSettings();

  if (stored && typeof stored.value === "boolean") {
    encryptionEnabledCache = stored.value;
  } else {
    encryptionEnabledCache = defaults.encryptionEnabled === true;
  }
  return encryptionEnabledCache;
}

async function setEncryptionEnabled(enabled) {
  await writeMetaEntry("encryptionEnabled", enabled);
  encryptionEnabledCache = enabled;
}

function normalizeHexColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().toLowerCase();
  const match = cleaned.match(/^#?[0-9a-f]{6}$/);
  if (!match) return fallback;
  return cleaned.startsWith("#") ? cleaned : `#${cleaned}`;
}

function normalizeBadgeColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().toLowerCase();
  const match = cleaned.match(/^#?[0-9a-f]{6}([0-9a-f]{2})?$/);
  if (!match) return fallback;
  let hex = cleaned.startsWith("#") ? cleaned : `#${cleaned}`;
  if (hex.length === 7) {
    hex += "ff";
  }
  return hex;
}

function normalizeBadgeDurationMs(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

async function getLinkColors() {
  const matchColorEntry = await readMetaEntry("matchHexColor");
  const partialColorEntry = await readMetaEntry("partialHexColor");
  const matchTextEnabledEntry = await readMetaEntry("matchTextEnabled");
  const partialTextEnabledEntry = await readMetaEntry("partialTextEnabled");
  const matchBorderEnabledEntry = await readMetaEntry("matchBorderEnabled");
  const partialBorderEnabledEntry = await readMetaEntry("partialBorderEnabled");
  const defaults = await getDefaultSettings();

  const matchHexColor = normalizeHexColor(
    matchColorEntry && matchColorEntry.value,
    defaults.matchHexColor
  );
  const partialHexColor = normalizeHexColor(
    partialColorEntry && partialColorEntry.value,
    defaults.partialHexColor
  );
  const matchTextEnabled =
    matchTextEnabledEntry && typeof matchTextEnabledEntry.value === "boolean"
      ? matchTextEnabledEntry.value
      : defaults.matchTextEnabled;
  const partialTextEnabled =
    partialTextEnabledEntry && typeof partialTextEnabledEntry.value === "boolean"
      ? partialTextEnabledEntry.value
      : defaults.partialTextEnabled;
  const matchBorderEnabled =
    matchBorderEnabledEntry && typeof matchBorderEnabledEntry.value === "boolean"
      ? matchBorderEnabledEntry.value
      : defaults.matchBorderEnabled;
  const partialBorderEnabled =
    partialBorderEnabledEntry && typeof partialBorderEnabledEntry.value === "boolean"
      ? partialBorderEnabledEntry.value
      : defaults.partialBorderEnabled;

  // persist defaults on first fetch to avoid undefined in future runs
  if (!matchColorEntry || !partialColorEntry || !matchTextEnabledEntry || !partialTextEnabledEntry) {
    await writeMetaEntries([
      { key: "matchHexColor", value: matchHexColor },
      { key: "partialHexColor", value: partialHexColor },
      { key: "matchTextEnabled", value: matchTextEnabled },
      { key: "partialTextEnabled", value: partialTextEnabled },
      { key: "matchBorderEnabled", value: matchBorderEnabled },
      { key: "partialBorderEnabled", value: partialBorderEnabled }
    ]);
  }

  return {
    matchHexColor,
    partialHexColor,
    matchTextEnabled,
    partialTextEnabled,
    matchBorderEnabled,
    partialBorderEnabled
  };
}

async function setLinkColors(colors = {}) {
  const current = await getLinkColors();
  const next = {
    matchHexColor: normalizeHexColor(colors.matchHexColor, current.matchHexColor),
    partialHexColor: normalizeHexColor(colors.partialHexColor, current.partialHexColor),
    matchTextEnabled:
      typeof colors.matchTextEnabled === "boolean" ? colors.matchTextEnabled : current.matchTextEnabled,
    partialTextEnabled:
      typeof colors.partialTextEnabled === "boolean"
        ? colors.partialTextEnabled
        : current.partialTextEnabled,
    matchBorderEnabled:
      typeof colors.matchBorderEnabled === "boolean" ? colors.matchBorderEnabled : current.matchBorderEnabled,
    partialBorderEnabled:
      typeof colors.partialBorderEnabled === "boolean"
        ? colors.partialBorderEnabled
        : current.partialBorderEnabled
  };

  await writeMetaEntries([
    { key: "matchHexColor", value: next.matchHexColor },
    { key: "partialHexColor", value: next.partialHexColor },
    { key: "matchTextEnabled", value: next.matchTextEnabled },
    { key: "partialTextEnabled", value: next.partialTextEnabled },
    { key: "matchBorderEnabled", value: next.matchBorderEnabled },
    { key: "partialBorderEnabled", value: next.partialBorderEnabled }
  ]);

  return next;
}

async function getDownloadBadgeSettings() {
  const colorEntry = await readMetaEntry("downloadBadgeColor");
  const durationEntry = await readMetaEntry("downloadBadgeDurationMs");
  const enabledEntry = await readMetaEntry("downloadBadgeEnabled");
  const defaults = await getDefaultSettings();

  const downloadBadgeColor = normalizeBadgeColor(
    colorEntry && colorEntry.value,
    defaults.downloadBadgeColor
  );
  const downloadBadgeDurationMs = normalizeBadgeDurationMs(
    durationEntry && durationEntry.value,
    defaults.downloadBadgeDurationMs
  );
  const downloadBadgeEnabled =
    enabledEntry && typeof enabledEntry.value === "boolean"
      ? enabledEntry.value
      : defaults.downloadBadgeEnabled;

  if (!colorEntry || !durationEntry || !enabledEntry) {
    await writeMetaEntries([
      { key: "downloadBadgeColor", value: downloadBadgeColor },
      { key: "downloadBadgeDurationMs", value: downloadBadgeDurationMs },
      { key: "downloadBadgeEnabled", value: downloadBadgeEnabled }
    ]);
  }

  return { downloadBadgeColor, downloadBadgeDurationMs, downloadBadgeEnabled };
}

async function setDownloadBadgeSettings(settings = {}) {
  const current = await getDownloadBadgeSettings();
  const next = {
    downloadBadgeColor: normalizeBadgeColor(
      settings.downloadBadgeColor,
      current.downloadBadgeColor
    ),
    downloadBadgeDurationMs: normalizeBadgeDurationMs(
      settings.downloadBadgeDurationMs,
      current.downloadBadgeDurationMs
    ),
    downloadBadgeEnabled:
      typeof settings.downloadBadgeEnabled === "boolean"
        ? settings.downloadBadgeEnabled
        : current.downloadBadgeEnabled
  };

  await writeMetaEntries([
    { key: "downloadBadgeColor", value: next.downloadBadgeColor },
    { key: "downloadBadgeDurationMs", value: next.downloadBadgeDurationMs },
    { key: "downloadBadgeEnabled", value: next.downloadBadgeEnabled }
  ]);

  return next;
}
