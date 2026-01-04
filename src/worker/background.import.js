async function importAddressesFromText(content, options = {}) {
  if (!content || typeof content !== "string") {
    return { imported: 0, invalid: 0, total: 0 };
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { imported: 0, invalid: 0, total: 0 };
  }

  const now = Date.now();
  const records = [];
  let validCount = 0;
  const existingIds = new Set();
  const missingIds = new Set();

  for (const raw of lines) {
    let urlString = raw;
    if (!/^https?:\/\//i.test(urlString)) {
      urlString = `https://${urlString}`;
    }
    const fingerprint = await computeFingerprint(urlString);
    if (!fingerprint) continue;

    validCount += 1;

    if (options.preview) continue;

    const hashed = fingerprint.storedHashed;
    const keySet = hashed ? fingerprint.keys.hash : fingerprint.keys.plain;
    const recordId = hashed ? fingerprint.ids?.hash || fingerprint.id : fingerprint.ids?.plain || fingerprint.id;

    if (missingIds.has(recordId)) continue;

    if (existingIds.has(recordId)) continue;

    if (!missingIds.has(recordId)) {
      const existing = await getVisitById(recordId);
      if (existing) {
        existingIds.add(recordId);
        continue;
      }
      missingIds.add(recordId);
    }

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

  if (!validCount) {
    return { imported: 0, invalid: lines.length, total: lines.length };
  }

  const invalidCount = lines.length - validCount;

  if (options.preview) {
    return { imported: 0, valid: validCount, invalid: invalidCount, total: lines.length };
  }

  const imported = records.length;

  if (records.length) {
    await putVisits(records);
    try {
      if (api.runtime && api.runtime.sendMessage) {
        const result = api.runtime.sendMessage({ type: "HISTORY_UPDATED" });
        if (result && typeof result.catch === "function") {
          result.catch(() => {});
        }
      }
    } catch (error) {
      // ignore broadcast errors
    }
  }

  return { imported, invalid: invalidCount, total: lines.length };
}
