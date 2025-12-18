let pepperKeyPromise = null;
let dbPromise = null;

const DEFAULT_MATCH_HEX_COLOR = "#0eb378";
const DEFAULT_PARTIAL_HEX_COLOR = "#81c700";


function openDatabase() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(VISITS_STORE)) {
        const store = db.createObjectStore(VISITS_STORE, { keyPath: "id" });
        store.createIndex("hostHash", "hostHash", { unique: false });
        store.createIndex("lastVisited", "lastVisited", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB failed to open"));
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

async function getEncryptionEnabled() {
  if (encryptionEnabledCache !== null) {
    return encryptionEnabledCache;
  }

  const db = await openDatabase();
  const readTx = db.transaction(META_STORE, "readonly");
  const metaStore = readTx.objectStore(META_STORE);
  const stored = await requestToPromise(metaStore.get("encryptionEnabled"));
  await waitForTransaction(readTx);

  if (stored && typeof stored.value === "boolean") {
    encryptionEnabledCache = stored.value;
  } else {
    encryptionEnabledCache = false;
  }
  return encryptionEnabledCache;
}

async function setEncryptionEnabled(enabled) {
  const db = await openDatabase();
  const tx = db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put({ key: "encryptionEnabled", value: enabled });
  await waitForTransaction(tx);
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
  const db = await openDatabase();
  const tx = db.transaction(META_STORE, "readonly");
  const store = tx.objectStore(META_STORE);
  const matchColorEntry = await requestToPromise(store.get("matchHexColor"));
  const partialColorEntry = await requestToPromise(store.get("partialHexColor"));
  const matchTextEnabledEntry = await requestToPromise(store.get("matchTextEnabled"));
  const partialTextEnabledEntry = await requestToPromise(store.get("partialTextEnabled"));
  const matchBorderEnabledEntry = await requestToPromise(store.get("matchBorderEnabled"));
  const partialBorderEnabledEntry = await requestToPromise(store.get("partialBorderEnabled"));
  await waitForTransaction(tx);

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

  // persist defaults on first fetch to avoid undefined in futuras execuções
  if (!matchColorEntry || !partialColorEntry || !matchTextEnabledEntry || !partialTextEnabledEntry) {
    const writeTx = db.transaction(META_STORE, "readwrite");
    const writeStore = writeTx.objectStore(META_STORE);
    writeStore.put({ key: "matchHexColor", value: matchHexColor });
    writeStore.put({ key: "partialHexColor", value: partialHexColor });
    writeStore.put({ key: "matchTextEnabled", value: matchTextEnabled });
    writeStore.put({ key: "partialTextEnabled", value: partialTextEnabled });
    writeStore.put({ key: "matchBorderEnabled", value: matchBorderEnabled });
    writeStore.put({ key: "partialBorderEnabled", value: partialBorderEnabled });
    await waitForTransaction(writeTx);
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

  const db = await openDatabase();
  const tx = db.transaction(META_STORE, "readwrite");
  const store = tx.objectStore(META_STORE);
  store.put({ key: "matchHexColor", value: next.matchHexColor });
  store.put({ key: "partialHexColor", value: next.partialHexColor });
  store.put({ key: "matchTextEnabled", value: next.matchTextEnabled });
  store.put({ key: "partialTextEnabled", value: next.partialTextEnabled });
  store.put({ key: "matchBorderEnabled", value: next.matchBorderEnabled });
  store.put({ key: "partialBorderEnabled", value: next.partialBorderEnabled });
  await waitForTransaction(tx);

  return next;
}
