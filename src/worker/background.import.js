async function importAddressesFromText(content) {
  if (!content || typeof content !== "string") {
    return { imported: 0 };
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { imported: 0 };
  }

  const now = Date.now();
  const records = [];

  for (const raw of lines) {
    let urlString = raw;
    if (!/^https?:\/\//i.test(urlString)) {
      urlString = `https://${urlString}`;
    }
    const fingerprint = await computeFingerprint(urlString);
    if (!fingerprint) continue;

    const hashed = fingerprint.storedHashed;
    const keySet = hashed ? fingerprint.keys.hash : fingerprint.keys.plain;
    const recordId = hashed ? fingerprint.ids?.hash || fingerprint.id : fingerprint.ids?.plain || fingerprint.id;

    records.push({
      id: recordId,
      hostHash: keySet.host,
      pathHash: keySet.path,
      queryHash: keySet.query,
      fragmentHash: keySet.fragment,
      queryParamsHash: keySet.params,
      hashed,
      host: fingerprint.parts.host,
      path: fingerprint.parts.path,
      query: fingerprint.parts.query,
      fragment: fingerprint.parts.fragment,
      lastVisited: now,
      visitCount: 1
    });
  }

  if (!records.length) {
    return { imported: 0 };
  }

  const db = await openDatabase();
  const tx = db.transaction(VISITS_STORE, "readwrite");
  const store = tx.objectStore(VISITS_STORE);
  const imported = records.length;

  for (const record of records) {
    store.put(record);
  }

  await waitForTransaction(tx);
  try {
    if (api.runtime && api.runtime.sendMessage) {
      api.runtime.sendMessage({ type: "HISTORY_UPDATED" });
    }
  } catch (error) {
    // ignore broadcast errors
  }

  return { imported };
}
