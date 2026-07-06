async function dumpAllVisits() {
  return getAllVisits();
}

async function dumpAllMeta() {
  return getAllMetaEntries();
}

const PLAIN_BACKUP_TYPE = "passei-aki-backup";
const PLAIN_BACKUP_VERSION = 1;

async function buildBackupPayload() {
  return {
    version: 2,
    visits: await dumpAllVisits(),
    meta: await dumpAllMeta(),
    partialExceptions: await getAllPartialExceptions(),
    matchExceptions: await getAllMatchExceptions()
  };
}

function buildPlainBackupEnvelope(payload) {
  return {
    v: PLAIN_BACKUP_VERSION,
    type: PLAIN_BACKUP_TYPE,
    encrypted: false,
    createdAt: Date.now(),
    payload
  };
}

async function createBackup(password, options = {}) {
  const payload = await buildBackupPayload();

  if (options && options.protectWithPassword === false) {
    return buildPlainBackupEnvelope(payload);
  }

  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const envelope = await encryptWithPassword(password, plaintext);
  return envelope;
}

function mergePlainVisits(existing = [], incoming = []) {
  const merged = new Map();
  incoming.forEach((record) => {
    if (record && record.id) {
      merged.set(record.id, record);
    }
  });

  existing.forEach((record) => {
    if (!record || !record.id) return;
    const isPlain = record.hashed === false;
    if (!isPlain) return;

    const current = merged.get(record.id);
    if (current && current.hashed === false) {
      const mergedCount = (current.visitCount || 0) + (record.visitCount || 0);
      const mergedLast = Math.max(current.lastVisited || 0, record.lastVisited || 0);
      merged.set(record.id, {
        ...current,
        ...record,
        visitCount: mergedCount,
        lastVisited: mergedLast,
        download: current.download === true || record.download === true,
        hashed: false
      });
      return;
    }

    if (!current) {
      merged.set(record.id, record);
    }
  });

  return Array.from(merged.values());
}

function requireBackupString(record, field, index) {
  if (typeof record[field] !== "string") {
    throw new Error(`Invalid backup visit at index ${index}: ${field}`);
  }
  return record[field];
}

function optionalBackupString(record, field) {
  return typeof record[field] === "string" ? record[field] : "";
}

function optionalBackupNumber(record, field, fallback, index) {
  if (record[field] == null) {
    return fallback;
  }
  if (!Number.isFinite(record[field]) || record[field] < 0) {
    throw new Error(`Invalid backup visit at index ${index}: ${field}`);
  }
  return record[field];
}

function validateBackupVisit(record, index) {
  if (!isPlainObject(record)) {
    throw new Error(`Invalid backup visit at index ${index}`);
  }

  const queryParamsHash = record.queryParamsHash == null ? [] : record.queryParamsHash;
  if (!Array.isArray(queryParamsHash) || queryParamsHash.some((value) => typeof value !== "string")) {
    throw new Error(`Invalid backup visit at index ${index}: queryParamsHash`);
  }
  if (record.hashed != null && typeof record.hashed !== "boolean") {
    throw new Error(`Invalid backup visit at index ${index}: hashed`);
  }
  if (record.download != null && typeof record.download !== "boolean") {
    throw new Error(`Invalid backup visit at index ${index}: download`);
  }

  return {
    id: requireBackupString(record, "id", index),
    hostHash: requireBackupString(record, "hostHash", index),
    pathHash: requireBackupString(record, "pathHash", index),
    queryHash: requireBackupString(record, "queryHash", index),
    fragmentHash: requireBackupString(record, "fragmentHash", index),
    queryParamsHash: queryParamsHash.slice(),
    hashed: record.hashed !== false,
    host: optionalBackupString(record, "host"),
    path: optionalBackupString(record, "path"),
    query: optionalBackupString(record, "query"),
    fragment: optionalBackupString(record, "fragment"),
    lastVisited: optionalBackupNumber(record, "lastVisited", 0, index),
    visitCount: optionalBackupNumber(record, "visitCount", 1, index),
    download: record.download === true
  };
}

function validateBackupMetaEntry(entry, index) {
  if (!isPlainObject(entry) || typeof entry.key !== "string" || !entry.key.trim()) {
    throw new Error(`Invalid backup meta at index ${index}`);
  }

  const value = entry.value;
  const valueType = typeof value;
  if (
    value !== null &&
    valueType !== "string" &&
    valueType !== "number" &&
    valueType !== "boolean"
  ) {
    throw new Error(`Invalid backup meta at index ${index}: value`);
  }
  if (valueType === "number" && !Number.isFinite(value)) {
    throw new Error(`Invalid backup meta at index ${index}: value`);
  }

  return { key: entry.key, value };
}

function validateBackupExceptions(value, field) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid backup payload: ${field}`);
  }
  return value.slice();
}

function validateBackupPayload(decoded) {
  if (!isPlainObject(decoded)) {
    throw new Error("Invalid backup payload");
  }
  if (!Number.isInteger(decoded.version) || decoded.version < 1 || decoded.version > 2) {
    throw new Error("Unsupported backup payload version");
  }
  if (!Array.isArray(decoded.visits) || !Array.isArray(decoded.meta)) {
    throw new Error("Invalid backup payload");
  }

  return {
    version: decoded.version,
    visits: decoded.visits.map(validateBackupVisit),
    meta: decoded.meta.map(validateBackupMetaEntry),
    partialExceptions: validateBackupExceptions(decoded.partialExceptions, "partialExceptions"),
    matchExceptions: validateBackupExceptions(decoded.matchExceptions, "matchExceptions")
  };
}

function isPlainBackupEnvelope(envelope) {
  return Boolean(
    isPlainObject(envelope) &&
      envelope.v === PLAIN_BACKUP_VERSION &&
      envelope.type === PLAIN_BACKUP_TYPE &&
      envelope.encrypted === false
  );
}

function validatePlainBackupEnvelope(envelope) {
  if (!isPlainBackupEnvelope(envelope)) {
    throw new Error("Invalid plain backup envelope");
  }
  if (!Number.isFinite(envelope.createdAt) || envelope.createdAt < 0) {
    throw new Error("Invalid plain backup envelope: createdAt");
  }
  return validateBackupPayload(envelope.payload);
}

async function decodeBackupPayload(password, envelope) {
  if (isPlainBackupEnvelope(envelope)) {
    return validatePlainBackupEnvelope(envelope);
  }
  const plaintext = await decryptWithPassword(password, envelope);
  return validateBackupPayload(JSON.parse(new TextDecoder().decode(plaintext)));
}

async function restoreBackup(password, envelope, options = {}) {
  try {
    const decoded = await decodeBackupPayload(password, envelope);

    const shouldMergeVisits = options && options.mergeVisits === true;
    const existingVisits = shouldMergeVisits ? await dumpAllVisits() : [];
    const visitsToRestore = shouldMergeVisits
      ? mergePlainVisits(existingVisits, decoded.visits)
      : decoded.visits;

    await clearAllData();
    await writeMetaEntries(decoded.meta);
    await putVisits(visitsToRestore);
    await rebuildStatsTotals(visitsToRestore);
    await setPartialExceptions(decoded.partialExceptions);
    await setMatchExceptions(decoded.matchExceptions);

    // reset caches
    pepperKeyPromise = null;
    if (typeof clearMatchCaches === "function") {
      clearMatchCaches();
    }
    const encryptionEntry = decoded.meta.find((m) => m && m.key === "encryptionEnabled");
    encryptionEnabledCache = encryptionEntry && typeof encryptionEntry.value === "boolean" ? encryptionEntry.value : null;
    if (typeof resetDownloadBadgeSettingsCache === "function") {
      resetDownloadBadgeSettingsCache();
    }
    if (typeof clearDownloadBadge === "function") {
      clearDownloadBadge();
    }
    lastSavedByTab.clear();
    lastMatchStateByTab.clear();
    lastPrevVisitByTab.clear();

    // notify tabs to update visuals and reprocess highlights
    try {
      const colors = await getLinkColors();
      sendRuntimeMessageSafe({ type: MSG.LINK_COLORS_UPDATED, colors });
      await broadcastMessagesToContentTabs([
        { type: MSG.LINK_COLORS_UPDATED, colors },
        { type: MSG.REFRESH_HIGHLIGHT }
      ]);
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
        filename: filename || `passei-aki_backup-${formatDate(new Date(), "YYYY-MM-DD_HH-mm-ss")}.bak`,
        saveAs: true
      });
    }
  } finally {
    if (revoke) {
      setTimeout(() => revoke(), 5000);
    }
  }
}
