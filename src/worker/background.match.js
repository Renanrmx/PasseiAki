const MATCH_STATE = {
  none: "none",
  partial: "partial",
  full: "viewed"
};

const FINGERPRINT_CACHE_MAX = 1500;
const fingerprintCache = new Map();

function readFingerprintCache(key) {
  if (!fingerprintCache.has(key)) {
    return undefined;
  }
  const value = fingerprintCache.get(key);
  fingerprintCache.delete(key);
  fingerprintCache.set(key, value);
  return value;
}

function writeFingerprintCache(key, value) {
  fingerprintCache.set(key, value);
  if (fingerprintCache.size > FINGERPRINT_CACHE_MAX) {
    const oldestKey = fingerprintCache.keys().next().value;
    fingerprintCache.delete(oldestKey);
  }
}

function clearMatchCaches() {
  fingerprintCache.clear();
}

function buildVisitId(hostHash, parts) {
  return `${hostHash}|${parts.path}|${parts.query}|${parts.fragment}`;
}

function countIntersection(a = [], b = []) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  let count = 0;
  for (const item of b) {
    if (setA.has(item)) {
      count += 1;
    }
  }
  return count;
}

function isPartialMatch(record, fingerprint) {
  if (!record || !fingerprint) return false;
  const recordHashed = record.hashed !== false;
  const fpKeys = recordHashed ? fingerprint.keys?.hash : fingerprint.keys?.plain;
  if (!fpKeys) return false;

  if (record.hostHash !== fpKeys.host) return false;
  if (record.pathHash !== fpKeys.path) return false;

  const fragmentDiff =
    record.fragmentHash && fpKeys.fragment
      ? record.fragmentHash !== fpKeys.fragment
      : record.fragmentHash !== fpKeys.fragment;

  const recordParams = record.queryParamsHash || [];
  const fingerprintParams = fpKeys.params || [];
  const intersection = countIntersection(recordParams, fingerprintParams);
  const allParamsEqual =
    (record.queryHash || "") === (fpKeys.query || "") &&
    intersection === recordParams.length &&
    intersection === fingerprintParams.length;
  const paramPartial = intersection > 0 && !allParamsEqual;

  return fragmentDiff || paramPartial;
}

async function computeFingerprint(urlString) {
  const encryptionEnabled = await getEncryptionEnabled();
  const cacheKey = `${encryptionEnabled ? "1" : "0"}|${urlString}`;
  const cached = readFingerprintCache(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const parts = normalizeUrlParts(urlString);
  if (!parts) {
    writeFingerprintCache(cacheKey, null);
    return null;
  }
  const plainKeys = {
    host: parts.host,
    path: parts.path,
    query: parts.query,
    fragment: parts.fragment,
    params: parts.queryEntries || []
  };
  const hashKeys = {
    host: await hashValue(parts.host),
    path: await hashValue(parts.path),
    query: await hashValue(parts.query),
    fragment: await hashValue(parts.fragment),
    params: await Promise.all((parts.queryEntries || []).map((entry) => hashValue(entry)))
  };

  const hashId = buildVisitId(hashKeys.host, {
    path: hashKeys.path,
    query: hashKeys.query,
    fragment: hashKeys.fragment
  });
  const plainId = buildVisitId(plainKeys.host, {
    path: plainKeys.path,
    query: plainKeys.query,
    fragment: plainKeys.fragment
  });

  const selected = encryptionEnabled
    ? hashKeys
    : {
        host: decodeURIComponent(plainKeys.host),
        path: decodeURIComponent(plainKeys.path),
        query: hashKeys.query,
        fragment: hashKeys.fragment,
        params: hashKeys.params
      };
  const selectedId = encryptionEnabled ? hashId : plainId;

  const fingerprint = {
    id: selectedId,
    ids: { hash: hashId, plain: plainId },
    hostHash: selected.host,
    pathHash: selected.path,
    query: parts.query,
    fragment: parts.fragment,
    queryHash: selected.query,
    queryParamsHash: selected.params,
    fragmentHash: selected.fragment,
    storedHashed: encryptionEnabled,
    keys: { hash: hashKeys, plain: plainKeys },
    parts
  };
  writeFingerprintCache(cacheKey, fingerprint);
  return fingerprint;
}

async function getVisitByIdCached(id, cache) {
  if (!cache) {
    return getVisitById(id);
  }
  if (cache.has(id)) {
    return cache.get(id);
  }
  const value = await getVisitById(id);
  cache.set(id, value || null);
  return value || null;
}

async function getVisitsByHostCached(hostKey, cache) {
  if (!cache) {
    return getVisitsByHost(hostKey);
  }
  if (cache.has(hostKey)) {
    return cache.get(hostKey);
  }
  const values = await getVisitsByHost(hostKey);
  cache.set(hostKey, values);
  return values;
}

async function findVisitMatch(fingerprint, options = {}) {
  const skipFullMatch = await isMatchException(fingerprint.parts.host);
  if (!skipFullMatch) {
    // exact search in hash/plain ids
    const idsToTry = Array.from(
      new Set([fingerprint.id, fingerprint.ids?.hash, fingerprint.ids?.plain].filter(Boolean))
    );

    for (const id of idsToTry) {
      const exact = await getVisitByIdCached(id, options.visitCache);
      if (exact) {
        return { state: MATCH_STATE.full, record: exact };
      }
    }
  }

  if (await isPartialException(fingerprint.parts.host)) {
    return { state: MATCH_STATE.none };
  }

  // partial search: same host/path, params/fragment with intersection
  const hostCandidates = Array.from(
    new Set([fingerprint.keys.hash.host, fingerprint.keys.plain.host].filter(Boolean))
  );

  for (const hostKey of hostCandidates) {
    const matches = await getVisitsByHostCached(hostKey, options.hostCache);
    for (const value of matches) {
      if (isPartialMatch(value, fingerprint)) {
        return { state: MATCH_STATE.partial, record: value };
      }
    }
  }

  return { state: MATCH_STATE.none };
}

async function findPartialMatches(fingerprint, limit = 5, options = {}) {
  if (await isPartialException(fingerprint.parts.host)) {
    return [];
  }
  const hostCandidates = Array.from(
    new Set([fingerprint.keys.hash.host, fingerprint.keys.plain.host].filter(Boolean))
  );
  const results = [];

  for (const hostKey of hostCandidates) {
    const matches = await getVisitsByHostCached(hostKey, options.hostCache);
    for (const value of matches) {
      if (isPartialMatch(value, fingerprint)) {
        results.push(value);
        if (results.length >= limit) {
          break;
        }
      }
    }
    if (results.length >= limit) {
      break;
    }
  }

  results.sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
  return results.slice(0, limit);
}
