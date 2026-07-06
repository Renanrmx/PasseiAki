const IMPORT_PREVIEW_TTL_MS = 5 * 60 * 1000;
let lastImportPreview = null;

function getCachedImportPlan(content) {
  if (!lastImportPreview) {
    return null;
  }
  if (lastImportPreview.content !== content) {
    return null;
  }
  if (Date.now() - lastImportPreview.createdAt > IMPORT_PREVIEW_TTL_MS) {
    lastImportPreview = null;
    return null;
  }
  return lastImportPreview.plan;
}

function cacheImportPlan(content, plan) {
  lastImportPreview = {
    content,
    plan,
    createdAt: Date.now()
  };
}

async function buildImportPlan(content) {
  if (!content || typeof content !== "string") {
    return { records: [], valid: 0, invalid: 0, total: 0 };
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { records: [], valid: 0, invalid: 0, total: 0 };
  }

  const now = Date.now();
  const records = [];
  const plannedIds = new Set();
  let validCount = 0;

  for (const raw of lines) {
    let urlString = raw;
    if (!/^https?:\/\//i.test(urlString)) {
      urlString = `https://${urlString}`;
    }
    const fingerprint = await computeFingerprint(urlString);
    if (!fingerprint) continue;

    validCount += 1;

    const hashed = fingerprint.storedHashed;
    const keySet = hashed ? fingerprint.keys.hash : fingerprint.keys.plain;
    const recordId = hashed ? fingerprint.ids?.hash || fingerprint.id : fingerprint.ids?.plain || fingerprint.id;

    if (plannedIds.has(recordId)) {
      continue;
    }
    plannedIds.add(recordId);

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

  return {
    records,
    valid: validCount,
    invalid: lines.length - validCount,
    total: lines.length
  };
}

async function filterNewImportRecords(records) {
  const freshRecords = [];
  for (const record of records) {
    if (!record || !record.id) {
      continue;
    }
    const existing = await getVisitById(record.id);
    if (!existing) {
      freshRecords.push(record);
    }
  }
  return freshRecords;
}

async function importAddressesFromText(content, options = {}) {
  const plan = getCachedImportPlan(content) || (await buildImportPlan(content));

  if (options.preview) {
    cacheImportPlan(content, plan);
    return { imported: 0, valid: plan.valid, invalid: plan.invalid, total: plan.total };
  }

  lastImportPreview = null;
  const records = await filterNewImportRecords(plan.records);
  const imported = records.length;

  if (records.length) {
    await putVisits(records);
    await adjustStatsTotals(
      records.length,
      records.reduce((total, record) => total + (record.visitCount || 0), 0)
    );
    sendRuntimeMessageSafe({ type: MSG.HISTORY_UPDATED });
  }

  return { imported, invalid: plan.invalid, total: plan.total };
}
