let pepperKeyPromise = null;
let dbPromise = null;


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
