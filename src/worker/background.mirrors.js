const mirrorGroupsMemory = new Map();
let mirrorGroupsCache = null;
let mirrorGroupsIndexCache = null;
let mirrorMigrationQueue = Promise.resolve();
const MIRROR_MIGRATION_BATCH_SIZE = 250;
const MIRROR_MIGRATION_IDLE_TIMEOUT_MS = 100;
const WWW_NORMALIZATION_META_KEY = "wwwNormalizationVersion";
const WWW_NORMALIZATION_VERSION = 1;
let wwwNormalizationPromise = null;
let wwwNormalizationComplete = false;

function waitForMirrorMigrationIdle() {
  return new Promise((resolve) => {
    if (typeof globalThis.requestIdleCallback === "function") {
      globalThis.requestIdleCallback(() => resolve(), {
        timeout: MIRROR_MIGRATION_IDLE_TIMEOUT_MS
      });
      return;
    }
    setTimeout(resolve, 0);
  });
}

async function maybeYieldMirrorMigration(index) {
  if (index > 0 && index % MIRROR_MIGRATION_BATCH_SIZE === 0) {
    await waitForMirrorMigrationIdle();
  }
}

function withMirrorMigrationLock(work) {
  const run = mirrorMigrationQueue.catch(() => {}).then(work);
  mirrorMigrationQueue = run.catch(() => {});
  return run;
}

async function waitForMirrorMigrationLock() {
  await mirrorMigrationQueue.catch(() => {});
}

function cloneMirrorGroup(group) {
  return {
    canonical: group.canonical,
    aliases: Array.isArray(group.aliases) ? group.aliases.slice() : []
  };
}

function cloneMirrorGroups(groups) {
  return Array.isArray(groups) ? groups.map(cloneMirrorGroup) : [];
}

function resetMirrorGroupsState() {
  mirrorGroupsMemory.clear();
  mirrorGroupsCache = null;
  mirrorGroupsIndexCache = null;
  wwwNormalizationComplete = false;
}

function normalizeMirrorHost(value) {
  const host = getHostFromInput(value);
  return host ? host.toLowerCase() : "";
}

function getMirrorGroupHosts(group) {
  if (!group || typeof group.canonical !== "string") {
    return [];
  }
  return [group.canonical].concat(Array.isArray(group.aliases) ? group.aliases : []);
}

function getRawMirrorGroupHosts(group) {
  if (Array.isArray(group)) {
    return group;
  }
  if (group && Array.isArray(group.hosts)) {
    return group.hosts;
  }
  if (group && typeof group === "object") {
    return [group.canonical].concat(Array.isArray(group.aliases) ? group.aliases : []);
  }
  return [];
}

function normalizeMirrorGroups(groups) {
  if (groups == null) {
    return [];
  }
  if (!Array.isArray(groups)) {
    throw new Error(i18n("mirrorGroupsInvalid"));
  }

  const normalizedGroups = [];
  const seenHosts = new Set();

  groups.forEach((group, index) => {
    const rawHosts = getRawMirrorGroupHosts(group);
    const hosts = [];
    const groupSeen = new Set();

    rawHosts.forEach((value) => {
      const host = normalizeMirrorHost(value);
      if (!host || groupSeen.has(host)) {
        return;
      }
      groupSeen.add(host);
      hosts.push(host);
    });

    if (!hosts.length) {
      return;
    }

    if (hosts.length < 2) {
      throw new Error(i18n("mirrorGroupNeedsTwoDomains", [String(index + 1)]));
    }

    hosts.forEach((host) => {
      if (seenHosts.has(host)) {
        throw new Error(i18n("mirrorDomainDuplicated", [host]));
      }
      seenHosts.add(host);
    });

    normalizedGroups.push({
      canonical: hosts[0],
      aliases: hosts.slice(1)
    });
  });

  return normalizedGroups;
}

function normalizeMirrorGroupsForRead(groups) {
  try {
    return normalizeMirrorGroups(groups);
  } catch (error) {
    const normalizedGroups = [];
    const seenHosts = new Set();

    (Array.isArray(groups) ? groups : []).forEach((group) => {
      const rawHosts = getRawMirrorGroupHosts(group);
      const groupSeen = new Set();
      const hosts = [];

      rawHosts.forEach((value) => {
        const host = normalizeMirrorHost(value);
        if (!host || groupSeen.has(host)) {
          return;
        }
        groupSeen.add(host);
        hosts.push(host);
      });

      if (hosts.length < 2 || seenHosts.has(hosts[0])) {
        return;
      }

      const availableHosts = hosts.filter((host) => !seenHosts.has(host));
      if (availableHosts.length < 2) {
        return;
      }

      availableHosts.forEach((host) => {
        seenHosts.add(host);
      });
      normalizedGroups.push({
        canonical: availableHosts[0],
        aliases: availableHosts.slice(1)
      });
    });

    return normalizedGroups;
  }
}

function buildMirrorIndex(groups) {
  const index = new Map();
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    getMirrorGroupHosts(group).forEach((host) => {
      index.set(host, group);
    });
  });
  return index;
}

function setMirrorGroupsCache(groups) {
  mirrorGroupsCache = cloneMirrorGroups(groups);
  mirrorGroupsIndexCache = buildMirrorIndex(mirrorGroupsCache);
}

function getMirrorGroupsIndex() {
  if (!mirrorGroupsIndexCache) {
    mirrorGroupsIndexCache = buildMirrorIndex(mirrorGroupsCache || []);
  }
  return mirrorGroupsIndexCache;
}

async function readMirrorGroupsFromDb() {
  if (mirrorGroupsCache) {
    return cloneMirrorGroups(mirrorGroupsCache);
  }

  if (isDbWriteBlocked()) {
    setMirrorGroupsCache(normalizeMirrorGroupsForRead(Array.from(mirrorGroupsMemory.values())));
    return cloneMirrorGroups(mirrorGroupsCache);
  }

  try {
    const db = await openDatabase();
    if (!db || !db.objectStoreNames.contains(MIRROR_GROUPS_STORE)) {
      setMirrorGroupsCache(normalizeMirrorGroupsForRead(Array.from(mirrorGroupsMemory.values())));
      return cloneMirrorGroups(mirrorGroupsCache);
    }

    const tx = db.transaction(MIRROR_GROUPS_STORE, "readonly");
    const store = tx.objectStore(MIRROR_GROUPS_STORE);
    const storedGroups = [];
    const cursorRequest = store.openCursor();

    await new Promise((resolve, reject) => {
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (cursor.value) {
          storedGroups.push(cursor.value);
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });

    await waitForTransaction(tx);
    const groups = normalizeMirrorGroupsForRead(storedGroups);
    setMirrorGroupsCache(groups);
    return cloneMirrorGroups(mirrorGroupsCache);
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      setMirrorGroupsCache(normalizeMirrorGroupsForRead(Array.from(mirrorGroupsMemory.values())));
      return cloneMirrorGroups(mirrorGroupsCache);
    }
    throw error;
  }
}

async function getMirrorGroups() {
  return readMirrorGroupsFromDb();
}

async function ensureMirrorGroupsLoaded() {
  if (!mirrorGroupsCache) {
    await readMirrorGroupsFromDb();
  }
  return mirrorGroupsCache || [];
}

async function getAllMirrorGroups() {
  return getMirrorGroups();
}

function applyMirrorGroupsToMemory(groups) {
  mirrorGroupsMemory.clear();
  groups.forEach((group) => {
    mirrorGroupsMemory.set(group.canonical, cloneMirrorGroup(group));
  });
  setMirrorGroupsCache(groups);
}

function mergeStringArrays(first = [], second = []) {
  const merged = [];
  const seen = new Set();
  first.concat(second).forEach((value) => {
    if (typeof value !== "string" || seen.has(value)) {
      return;
    }
    seen.add(value);
    merged.push(value);
  });
  return merged;
}

function preferNonEmptyString(primary, fallback) {
  return typeof primary === "string" && primary ? primary : (typeof fallback === "string" ? fallback : "");
}

function buildMirrorVisitId(hostKey, pathKey, queryKey, fragmentKey) {
  return `${hostKey}|${pathKey}|${queryKey}|${fragmentKey}`;
}

function parsePlainVisitIdParts(id) {
  const parts = String(id || "").split("|");
  return {
    host: parts[0] || "",
    path: parts[1] || "",
    query: parts[2] || "",
    fragment: parts.slice(3).join("|")
  };
}

function getVisitMigrationHost(record) {
  if (!record || typeof record !== "object") {
    return "";
  }
  if (typeof record.host === "string" && record.host) {
    return record.host;
  }
  if (record.hashed === false) {
    return parsePlainVisitIdParts(record.id).host;
  }
  return "";
}

async function canonicalizeVisitForHost(record, canonical) {
  const hashed = record.hashed !== false;
  const idParts = hashed ? null : parsePlainVisitIdParts(record.id);
  const path = hashed
    ? preferNonEmptyString(record.path, "")
    : preferNonEmptyString(record.path, preferNonEmptyString(idParts.path, record.pathHash || "/"));
  const query = hashed
    ? preferNonEmptyString(record.query, "")
    : preferNonEmptyString(record.query, preferNonEmptyString(idParts.query, ""));
  const fragment = hashed
    ? preferNonEmptyString(record.fragment, "")
    : preferNonEmptyString(record.fragment, preferNonEmptyString(idParts.fragment, ""));
  const hostKey = hashed ? await hashValue(canonical) : canonical;
  const pathKey = hashed
    ? preferNonEmptyString(record.pathHash, "")
    : preferNonEmptyString(record.pathHash, path || "/");
  const queryKey = hashed
    ? preferNonEmptyString(record.queryHash, "")
    : preferNonEmptyString(record.queryHash, query);
  const fragmentKey = hashed
    ? preferNonEmptyString(record.fragmentHash, "")
    : preferNonEmptyString(record.fragmentHash, fragment);
  const idPath = hashed ? pathKey : path || "/";
  const idQuery = hashed ? queryKey : query;
  const idFragment = hashed ? fragmentKey : fragment;

  return {
    ...record,
    id: buildMirrorVisitId(hostKey, idPath, idQuery, idFragment),
    hostHash: hostKey,
    pathHash: pathKey,
    queryHash: queryKey,
    fragmentHash: fragmentKey,
    hashed,
    host: canonical,
    path,
    query,
    fragment,
    queryParamsHash: Array.isArray(record.queryParamsHash) ? record.queryParamsHash.slice() : []
  };
}

async function canonicalizeVisitForMirrorGroup(record, canonical) {
  return canonicalizeVisitForHost(record, canonical);
}

function mergeCanonicalVisit(current, incoming) {
  if (!current) {
    return { ...incoming, queryParamsHash: incoming.queryParamsHash.slice() };
  }

  if ((current.hashed !== false) !== (incoming.hashed !== false)) {
    throw new Error(i18n("mirrorMigrationHashConflict"));
  }

  const currentVisits = Number.isFinite(current.visitCount) ? current.visitCount : 0;
  const incomingVisits = Number.isFinite(incoming.visitCount) ? incoming.visitCount : 0;
  const currentLast = Number.isFinite(current.lastVisited) ? current.lastVisited : 0;
  const incomingLast = Number.isFinite(incoming.lastVisited) ? incoming.lastVisited : 0;

  return {
    ...current,
    ...incoming,
    visitCount: currentVisits + incomingVisits,
    lastVisited: Math.max(currentLast, incomingLast),
    download: current.download === true || incoming.download === true,
    hashed: incoming.hashed !== false,
    queryParamsHash: mergeStringArrays(current.queryParamsHash, incoming.queryParamsHash),
    host: preferNonEmptyString(incoming.host, current.host),
    path: preferNonEmptyString(incoming.path, current.path),
    query: preferNonEmptyString(incoming.query, current.query),
    fragment: preferNonEmptyString(incoming.fragment, current.fragment)
  };
}

function mergeVisitForCurrentAccess(current, incoming) {
  const base = mergeCanonicalVisit(current, incoming);
  return {
    ...base,
    visitCount: (base.visitCount || 0) + 1,
    lastVisited: incoming.lastVisited
  };
}

function hasCanonicalVisitChanged(current, canonical) {
  if (!current || !canonical) {
    return false;
  }
  return (
    current.id !== canonical.id ||
    current.host !== canonical.host ||
    current.hostHash !== canonical.hostHash ||
    current.pathHash !== canonical.pathHash ||
    current.queryHash !== canonical.queryHash ||
    current.fragmentHash !== canonical.fragmentHash
  );
}

async function buildMirrorMigrationPlan(groups) {
  const mirrorIndex = buildMirrorIndex(groups);
  const visits = await getAllVisits();
  const finalVisits = new Map();
  const affectedIds = new Set();
  const canonicalTargets = new Map();

  visits.forEach((record) => {
    if (record && record.id) {
      finalVisits.set(record.id, record);
    }
  });

  for (let index = 0; index < visits.length; index += 1) {
    await maybeYieldMirrorMigration(index);

    const record = visits[index];
    if (!record || !record.id) {
      continue;
    }
    const sourceHost = normalizeMirrorHost(getVisitMigrationHost(record));
    const group = sourceHost ? mirrorIndex.get(sourceHost) : null;
    if (!group) {
      continue;
    }

    const canonicalRecord = await canonicalizeVisitForMirrorGroup(record, group.canonical);
    affectedIds.add(record.id);
    finalVisits.delete(record.id);

    const targetKey = `${canonicalRecord.hashed !== false ? "hash" : "plain"}|${canonicalRecord.id}`;
    canonicalTargets.set(
      targetKey,
      mergeCanonicalVisit(canonicalTargets.get(targetKey), canonicalRecord)
    );
  }

  const upsertRecords = Array.from(canonicalTargets.values());
  const seenTargetIds = new Map();
  upsertRecords.forEach((record) => {
    const hashed = record.hashed !== false;
    if (seenTargetIds.has(record.id) && seenTargetIds.get(record.id) !== hashed) {
      throw new Error(i18n("mirrorMigrationHashConflict"));
    }
    seenTargetIds.set(record.id, hashed);
    finalVisits.set(record.id, record);
  });

  return {
    deleteIds: Array.from(affectedIds),
    upsertRecords,
    totals: countVisitStats(Array.from(finalVisits.values()))
  };
}

function applyVisitMirrorStateToMemoryAtomically(options = {}) {
  const groups = options.groups || [];
  const deleteIds = Array.isArray(options.deleteIds) ? options.deleteIds : [];
  const upsertRecords = Array.isArray(options.upsertRecords) ? options.upsertRecords : [];
  const metaEntries = Array.isArray(options.metaEntries) ? options.metaEntries : [];
  const shouldNotify = options.notify !== false;
  const nextVisits = new Map(memoryVisits);
  const nextMeta = new Map(memoryMeta);
  const nextMirrorGroups = new Map();
  const normalizedGroups = cloneMirrorGroups(groups);

  normalizedGroups.forEach((group) => {
    if (!group || typeof group.canonical !== "string" || !group.canonical) {
      throw new Error(i18n("mirrorGroupsInvalid"));
    }
    nextMirrorGroups.set(group.canonical, cloneMirrorGroup(group));
  });

  deleteIds.forEach((id) => {
    if (typeof id === "string" && id) {
      nextVisits.delete(id);
    }
  });

  upsertRecords.forEach((record) => {
    if (!record || typeof record.id !== "string" || !record.id) {
      throw new Error(i18n("mirrorGroupsInvalid"));
    }
    nextVisits.set(record.id, record);
  });

  metaEntries.forEach((entry) => {
    if (!entry || typeof entry.key !== "string" || !entry.key) {
      throw new Error(i18n("mirrorGroupsInvalid"));
    }
    nextMeta.set(entry.key, { key: entry.key, value: entry.value });
  });

  mirrorGroupsMemory.clear();
  nextMirrorGroups.forEach((group, canonical) => {
    mirrorGroupsMemory.set(canonical, cloneMirrorGroup(group));
  });

  memoryVisits.clear();
  nextVisits.forEach((record, id) => {
    memoryVisits.set(id, record);
  });

  memoryMeta.clear();
  nextMeta.forEach((entry, key) => {
    memoryMeta.set(key, entry);
  });

  setMirrorGroupsCache(normalizedGroups);
  if (shouldNotify) {
    notifyVisitDataChanged();
  }
}

function applyMirrorMigrationToMemoryAtomically(groups, migration) {
  const totals = migration?.totals || countVisitStats(Array.from(memoryVisits.values()));
  const totalEntries = Number.isFinite(totals.totalEntries) ? totals.totalEntries : 0;
  const totalVisits = Number.isFinite(totals.totalVisits) ? totals.totalVisits : 0;

  applyVisitMirrorStateToMemoryAtomically({
    groups,
    deleteIds: migration?.deleteIds,
    upsertRecords: migration?.upsertRecords,
    metaEntries: [
      { key: META_STATS_TOTAL_ENTRIES, value: totalEntries },
      { key: META_STATS_TOTAL_VISITS, value: totalVisits }
    ]
  });
}

function applyWwwNormalizationMigrationToMemoryAtomically(migration, groups, metaEntries) {
  applyVisitMirrorStateToMemoryAtomically({
    groups,
    deleteIds: migration?.deleteIds,
    upsertRecords: migration?.upsertRecords,
    metaEntries,
    notify: migration?.changed === true
  });
}

async function writeMirrorGroupsAndApplyMigration(groups, migration) {
  if (isDbWriteBlocked()) {
    applyMirrorMigrationToMemoryAtomically(groups, migration);
    return;
  }

  try {
    const db = await openDatabase();
    if (!db || !db.objectStoreNames.contains(MIRROR_GROUPS_STORE)) {
      applyMirrorMigrationToMemoryAtomically(groups, migration);
      return;
    }

    const tx = db.transaction([MIRROR_GROUPS_STORE, VISITS_STORE, META_STORE], "readwrite");
    const mirrorStore = tx.objectStore(MIRROR_GROUPS_STORE);
    const visitStore = tx.objectStore(VISITS_STORE);
    const metaStore = tx.objectStore(META_STORE);

    mirrorStore.clear();
    groups.forEach((group) => {
      mirrorStore.put(cloneMirrorGroup(group));
    });
    migration.deleteIds.forEach((id) => {
      visitStore.delete(id);
    });
    migration.upsertRecords.forEach((record) => {
      visitStore.put(record);
    });
    metaStore.put({ key: META_STATS_TOTAL_ENTRIES, value: migration.totals.totalEntries });
    metaStore.put({ key: META_STATS_TOTAL_VISITS, value: migration.totals.totalVisits });

    await waitForTransaction(tx);
    setMirrorGroupsCache(groups);
    notifyVisitDataChanged();
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      applyMirrorMigrationToMemoryAtomically(groups, migration);
      return;
    }
    throw error;
  }
}

async function setMirrorGroups(groups) {
  return withMirrorMigrationLock(async () => {
    const normalized = normalizeMirrorGroups(groups);
    const migration = await buildMirrorMigrationPlan(normalized);
    await writeMirrorGroupsAndApplyMigration(normalized, migration);
    if (typeof clearMatchCaches === "function") {
      clearMatchCaches();
    }
    return cloneMirrorGroups(normalized);
  });
}

async function queueCanonicalVisit(targets, untouchedVisits, affectedIds, record, canonicalRecord) {
  affectedIds.add(record.id);
  untouchedVisits.delete(record.id);

  const targetKey = `${canonicalRecord.hashed !== false ? "hash" : "plain"}|${canonicalRecord.id}`;
  const existingTarget = untouchedVisits.get(canonicalRecord.id);
  if (existingTarget) {
    if ((existingTarget.hashed !== false) !== (canonicalRecord.hashed !== false)) {
      throw new Error(i18n("mirrorMigrationHashConflict"));
    }
    untouchedVisits.delete(existingTarget.id);
    affectedIds.add(existingTarget.id);
    const targetHost = normalizeHostIdentity(getVisitMigrationHost(existingTarget));
    const canonicalExisting = await canonicalizeVisitForHost(
      existingTarget,
      targetHost || canonicalRecord.host
    );
    targets.set(targetKey, mergeCanonicalVisit(targets.get(targetKey), canonicalExisting));
  }

  targets.set(targetKey, mergeCanonicalVisit(targets.get(targetKey), canonicalRecord));
}

async function buildWwwNormalizationMigrationPlan() {
  const visits = await getAllVisits();
  const untouchedVisits = new Map();
  const affectedIds = new Set();
  const canonicalTargets = new Map();

  visits.forEach((record) => {
    if (record && record.id) {
      untouchedVisits.set(record.id, record);
    }
  });

  for (const record of visits) {
    if (!record || !record.id || affectedIds.has(record.id)) {
      continue;
    }

    const sourceHost = getVisitMigrationHost(record);
    if (!sourceHost) {
      continue;
    }

    const canonicalHost = normalizeHostIdentity(sourceHost);
    if (!canonicalHost) {
      continue;
    }

    const canonicalRecord = await canonicalizeVisitForHost(record, canonicalHost);
    if (!hasCanonicalVisitChanged(record, canonicalRecord)) {
      continue;
    }

    await queueCanonicalVisit(
      canonicalTargets,
      untouchedVisits,
      affectedIds,
      record,
      canonicalRecord
    );
  }

  const upsertRecords = Array.from(canonicalTargets.values());
  const finalVisits = new Map(untouchedVisits);
  upsertRecords.forEach((record) => {
    finalVisits.set(record.id, record);
  });

  return {
    changed: affectedIds.size > 0 || upsertRecords.length > 0,
    deleteIds: Array.from(affectedIds),
    upsertRecords,
    totals: countVisitStats(Array.from(finalVisits.values()))
  };
}

async function writeWwwNormalizationMigration(migration, groups) {
  const normalizedGroups = cloneMirrorGroups(groups || []);
  const metaEntries = [
    { key: META_STATS_TOTAL_ENTRIES, value: migration.totals.totalEntries },
    { key: META_STATS_TOTAL_VISITS, value: migration.totals.totalVisits },
    { key: WWW_NORMALIZATION_META_KEY, value: WWW_NORMALIZATION_VERSION }
  ];

  if (isDbWriteBlocked()) {
    applyWwwNormalizationMigrationToMemoryAtomically(migration, normalizedGroups, metaEntries);
    return;
  }

  try {
    const db = await openDatabase();
    if (!db) {
      applyWwwNormalizationMigrationToMemoryAtomically(migration, normalizedGroups, metaEntries);
      return;
    }

    const stores = [VISITS_STORE, META_STORE];
    if (db.objectStoreNames.contains(MIRROR_GROUPS_STORE)) {
      stores.push(MIRROR_GROUPS_STORE);
    }
    const tx = db.transaction(stores, "readwrite");
    const visitStore = tx.objectStore(VISITS_STORE);
    const metaStore = tx.objectStore(META_STORE);

    migration.deleteIds.forEach((id) => {
      visitStore.delete(id);
    });
    migration.upsertRecords.forEach((record) => {
      visitStore.put(record);
    });
    metaEntries.forEach((entry) => {
      metaStore.put(entry);
    });

    if (db.objectStoreNames.contains(MIRROR_GROUPS_STORE)) {
      const mirrorStore = tx.objectStore(MIRROR_GROUPS_STORE);
      mirrorStore.clear();
      normalizedGroups.forEach((group) => {
        mirrorStore.put(cloneMirrorGroup(group));
      });
    }

    await waitForTransaction(tx);
    setMirrorGroupsCache(normalizedGroups);
    if (migration.changed) {
      notifyVisitDataChanged();
    }
  } catch (error) {
    if (markDbWriteBlocked(error)) {
      applyWwwNormalizationMigrationToMemoryAtomically(migration, normalizedGroups, metaEntries);
      return;
    }
    throw error;
  }
}

async function runWwwNormalizationMigration(force = false) {
  if (!force && wwwNormalizationComplete) {
    return { changed: false };
  }
  if (!force) {
    const stored = await readMetaEntry(WWW_NORMALIZATION_META_KEY);
    if (stored && Number(stored.value) >= WWW_NORMALIZATION_VERSION) {
      wwwNormalizationComplete = true;
      return { changed: false };
    }
  }

  const normalizedGroups = await getMirrorGroups();
  const migration = await buildWwwNormalizationMigrationPlan();
  await writeWwwNormalizationMigration(migration, normalizedGroups);
  wwwNormalizationComplete = true;
  if (typeof clearMatchCaches === "function") {
    clearMatchCaches();
  }
  return { changed: migration.changed };
}

async function ensureWwwNormalizationMigration(options = {}) {
  const force = options && options.force === true;
  if (force) {
    if (wwwNormalizationPromise) {
      await wwwNormalizationPromise;
    }
    return runWwwNormalizationMigration(true);
  }

  if (!wwwNormalizationPromise) {
    wwwNormalizationPromise = runWwwNormalizationMigration(false).finally(() => {
      wwwNormalizationPromise = null;
    });
  }
  return wwwNormalizationPromise;
}

async function getMirrorResolution(hostValue) {
  const host = normalizeMirrorHost(hostValue);
  if (!host) {
    return { canonical: hostValue || "", hosts: hostValue ? [hostValue] : [], hasMirror: false };
  }

  await ensureMirrorGroupsLoaded();
  const group = getMirrorGroupsIndex().get(host);
  if (!group) {
    return { canonical: hostValue || host, hosts: [hostValue || host], hasMirror: false };
  }

  return {
    canonical: group.canonical,
    hosts: getMirrorGroupHosts(group),
    hasMirror: true
  };
}

function getMirrorHostsForRecord(record, groups) {
  if (!record || typeof record.host !== "string") {
    return [];
  }
  const host = normalizeMirrorHost(record.host);
  const mirrorIndex = groups instanceof Map ? groups : buildMirrorIndex(groups || []);
  const group = mirrorIndex.get(host);
  return group ? getMirrorGroupHosts(group) : [record.host];
}

function buildMirrorSearchIndex(groups) {
  return buildMirrorIndex(groups || []);
}

function buildMirrorSearchAddresses(record, groups) {
  if (!record || record.hashed !== false) {
    return [];
  }
  const hosts = getMirrorHostsForRecord(record, groups);
  const addresses = [];
  const seen = new Set();
  hosts.forEach((host) => {
    const address = buildAddressFromRecord({ ...record, host }).toLowerCase();
    if (!seen.has(address)) {
      seen.add(address);
      addresses.push(address);
    }
  });
  return addresses;
}
