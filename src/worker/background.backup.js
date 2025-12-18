async function dumpAllVisits() {
  const db = await openDatabase();
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
}

async function dumpAllMeta() {
  const db = await openDatabase();
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
}

async function createBackup(password) {
  const db = await openDatabase();
  const payload = {
    version: 2,
    visits: await dumpAllVisits(),
    meta: await dumpAllMeta()
  };

  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const envelope = await encryptWithPassword(password, plaintext);
  return envelope;
}

async function restoreBackup(password, envelope) {
  try {
    const plaintext = await decryptWithPassword(password, envelope);
    const decoded = JSON.parse(new TextDecoder().decode(plaintext));
    if (!decoded || !decoded.visits || !Array.isArray(decoded.visits) || !Array.isArray(decoded.meta)) {
      throw new Error("Invalid backup payload");
    }

    const db = await openDatabase();
    // limpar stores
    let tx = db.transaction([VISITS_STORE, META_STORE], "readwrite");
    tx.objectStore(VISITS_STORE).clear();
    tx.objectStore(META_STORE).clear();
    await waitForTransaction(tx);

    // restaurar meta
    tx = db.transaction(META_STORE, "readwrite");
    const metaStore = tx.objectStore(META_STORE);
    decoded.meta.forEach((entry) => {
      if (entry && entry.key) {
        metaStore.put(entry);
      }
    });
    await waitForTransaction(tx);

    // restaurar visitas
    tx = db.transaction(VISITS_STORE, "readwrite");
    const visitStore = tx.objectStore(VISITS_STORE);
    for (const visit of decoded.visits) {
      visitStore.put(visit);
    }
    await waitForTransaction(tx);

    // resetar caches
    pepperKeyPromise = null;
    const encryptionEntry = decoded.meta.find((m) => m && m.key === "encryptionEnabled");
    encryptionEnabledCache = encryptionEntry && typeof encryptionEntry.value === "boolean" ? encryptionEntry.value : null;
    lastSavedByTab.clear();
    lastMatchStateByTab.clear();
    lastPrevVisitByTab.clear();

    // notifica abas para atualizar visual e reprocessar destaques
    try {
      const colors = await getLinkColors();
      api.runtime.sendMessage({ type: "LINK_COLORS_UPDATED", colors });
      if (api.tabs && api.tabs.query) {
        api.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            try {
              api.tabs.sendMessage(tab.id, { type: "LINK_COLORS_UPDATED", colors });
              api.tabs.sendMessage(tab.id, { type: "REFRESH_HIGHLIGHT" });
            } catch (error) {
              // ignore per-tab errors
            }
          });
        });
      }
    } catch (error) {
      // ignore broadcast errors
    }
  } catch (error) {
    console.error("Error restoring data:", error);
    throw error;
  }
}

async function downloadBackup(envelope, filename) {
  const blob = new Blob([JSON.stringify(envelope)], { type: "application/octet-stream" });
  const { url: objectUrl, revoke } = await buildDownloadUrl(blob, "application/octet-stream");
  try {
    if (api && api.downloads && api.downloads.download) {
      await api.downloads.download({
        url: objectUrl,
        filename: filename || `passei-aki-backup-${Date.now()}.bak`,
        saveAs: true
      });
    }
  } finally {
    if (revoke) {
      setTimeout(() => revoke(), 5000);
    }
  }
}
