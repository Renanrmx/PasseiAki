let pepperKeyPromise = null;
let dbPromise = null;
let dbWriteBlocked = false;

const DEFAULT_MATCH_HEX_COLOR = "#0eb378";
const DEFAULT_PARTIAL_HEX_COLOR = "#81c700";

// Fallback for environments where IndexedDB writes are blocked
const memoryVisits = new Map();
const memoryMeta = new Map();

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
    return;
  }

  try {
    const db = await openDatabase();
    if (!db) {
      memoryVisits.clear();
      memoryMeta.clear();
      return;
    }
    const tx = db.transaction([VISITS_STORE, META_STORE], "readwrite");
    tx.objectStore(VISITS_STORE).clear();
    tx.objectStore(META_STORE).clear();
    await waitForTransaction(tx);
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      memoryVisits.clear();
      memoryMeta.clear();
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

  if (stored && typeof stored.value === "boolean") {
    encryptionEnabledCache = stored.value;
  } else {
    encryptionEnabledCache = false;
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

async function getLinkColors() {
  const matchColorEntry = await readMetaEntry("matchHexColor");
  const partialColorEntry = await readMetaEntry("partialHexColor");
  const matchTextEnabledEntry = await readMetaEntry("matchTextEnabled");
  const partialTextEnabledEntry = await readMetaEntry("partialTextEnabled");
  const matchBorderEnabledEntry = await readMetaEntry("matchBorderEnabled");
  const partialBorderEnabledEntry = await readMetaEntry("partialBorderEnabled");

  const matchHexColor = normalizeHexColor(
    matchColorEntry && matchColorEntry.value,
    DEFAULT_MATCH_HEX_COLOR
  );
  const partialHexColor = normalizeHexColor(
    partialColorEntry && partialColorEntry.value,
    DEFAULT_PARTIAL_HEX_COLOR
  );
  const matchTextEnabled = matchTextEnabledEntry && typeof matchTextEnabledEntry.value === "boolean" ? matchTextEnabledEntry.value : true;
  const partialTextEnabled =
    partialTextEnabledEntry && typeof partialTextEnabledEntry.value === "boolean"
      ? partialTextEnabledEntry.value
      : false;
  const matchBorderEnabled =
    matchBorderEnabledEntry && typeof matchBorderEnabledEntry.value === "boolean" ? matchBorderEnabledEntry.value : false;
  const partialBorderEnabled =
    partialBorderEnabledEntry && typeof partialBorderEnabledEntry.value === "boolean" ? partialBorderEnabledEntry.value : false;

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
