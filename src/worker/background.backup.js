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

async function createBackup(password) {
  const db = await openDatabase();
  const metaTx = db.transaction(META_STORE, "readonly");
  const metaStore = metaTx.objectStore(META_STORE);
  const pepperEntry = await requestToPromise(metaStore.get(META_PEPPER_KEY));
  const encEntry = await requestToPromise(metaStore.get("encryptionEnabled"));
  await waitForTransaction(metaTx);

  const payload = {
    version: 1,
    pepper: pepperEntry ? pepperEntry.value : null,
    encryptionEnabled: encEntry ? encEntry.value : false,
    visits: await dumpAllVisits()
  };

  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const envelope = await encryptWithPassword(password, plaintext);
  return envelope;
}

async function restoreBackup(password, envelope) {
  try {
    const plaintext = await decryptWithPassword(password, envelope);
    const decoded = JSON.parse(new TextDecoder().decode(plaintext));
    if (!decoded || !decoded.visits || !Array.isArray(decoded.visits)) {
      throw new Error("Pacote invalido");
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
    if (decoded.pepper) {
      metaStore.put({ key: META_PEPPER_KEY, value: decoded.pepper });
    }
    metaStore.put({
      key: "encryptionEnabled",
      value: Boolean(decoded.encryptionEnabled)
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
    encryptionEnabledCache = decoded.encryptionEnabled ? true : false;
    lastSavedByTab.clear();
    lastMatchStateByTab.clear();
    lastPrevVisitByTab.clear();
  } catch (error) {
    console.error("Erro ao restaurar dados:", error);
    throw error;
  }
}

async function downloadBackup(envelope, filename) {
  const blob = new Blob([JSON.stringify(envelope)], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    if (api && api.downloads && api.downloads.download) {
      await api.downloads.download({
        url: objectUrl,
        filename: filename || `passei-aki-backup-${Date.now()}.bak`,
        saveAs: true
      });
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }
}
