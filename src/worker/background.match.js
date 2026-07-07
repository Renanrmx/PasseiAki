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

  const hostCandidates = recordHashed
    ? fingerprint.candidateHosts?.hash || [fpKeys.host]
    : fingerprint.candidateHosts?.plain || [fpKeys.host];
  if (!hostCandidates.includes(record.hostHash)) return false;
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

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === "string" && value)));
}

async function computeFingerprint(urlString) {
  if (typeof ensureWwwNormalizationMigration === "function") {
    await ensureWwwNormalizationMigration();
  }
  const encryptionEnabled = await getEncryptionEnabled();
  const cacheKey = `${encryptionEnabled ? "1" : "0"}|${urlString}`;
  const cached = readFingerprintCache(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const originalParts = normalizeUrlParts(urlString);
  if (!originalParts) {
    writeFingerprintCache(cacheKey, null);
    return null;
  }
  const mirrorResolution =
    typeof getMirrorResolution === "function"
      ? await getMirrorResolution(originalParts.host)
      : { canonical: originalParts.host, hosts: [originalParts.host], hasMirror: false };
  const canonicalHost = mirrorResolution.hasMirror ? mirrorResolution.canonical : originalParts.host;
  const candidatePlainHosts = uniqueStrings(
    [canonicalHost].concat(mirrorResolution.hosts || [], originalParts.host)
  );
  const parts = {
    ...originalParts,
    originalHost: originalParts.host,
    host: canonicalHost,
    mirrorHosts: candidatePlainHosts
  };
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
  const candidateHashHosts = await Promise.all(candidatePlainHosts.map((host) => hashValue(host)));

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
  const candidateIds = {
    hash: uniqueStrings(
      candidateHashHosts.map((host) =>
        buildVisitId(host, {
          path: hashKeys.path,
          query: hashKeys.query,
          fragment: hashKeys.fragment
        })
      )
    ),
    plain: uniqueStrings(
      candidatePlainHosts.map((host) =>
        buildVisitId(host, {
          path: plainKeys.path,
          query: plainKeys.query,
          fragment: plainKeys.fragment
        })
      )
    )
  };

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
    candidateIds,
    candidateHosts: {
      hash: uniqueStrings(candidateHashHosts),
      plain: candidatePlainHosts
    },
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
  const exceptionHosts = fingerprint.parts?.mirrorHosts || [fingerprint.parts.host];
  const skipFullMatch = await isMatchException(fingerprint.parts.host, exceptionHosts);
  if (!skipFullMatch) {
    // exact search in hash/plain ids
    const idsToTry = Array.from(
      new Set(
        []
          .concat(
            fingerprint.id,
            fingerprint.ids?.hash,
            fingerprint.ids?.plain,
            fingerprint.storedHashed ? fingerprint.candidateIds?.hash : fingerprint.candidateIds?.plain,
            fingerprint.storedHashed ? fingerprint.candidateIds?.plain : fingerprint.candidateIds?.hash
          )
          .filter(Boolean)
      )
    );

    for (const id of idsToTry) {
      const exact = await getVisitByIdCached(id, options.visitCache);
      if (exact) {
        return { state: MATCH_STATE.full, record: exact };
      }
    }
  }

  if (await isPartialException(fingerprint.parts.host, exceptionHosts)) {
    return { state: MATCH_STATE.none };
  }

  // partial search: same host/path, params/fragment with intersection
  const hostCandidates = Array.from(
    new Set(
      []
        .concat(fingerprint.candidateHosts?.hash, fingerprint.candidateHosts?.plain)
        .filter(Boolean)
    )
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
  const exceptionHosts = fingerprint.parts?.mirrorHosts || [fingerprint.parts.host];
  if (await isPartialException(fingerprint.parts.host, exceptionHosts)) {
    return [];
  }
  const hostCandidates = Array.from(
    new Set(
      []
        .concat(fingerprint.candidateHosts?.hash, fingerprint.candidateHosts?.plain)
        .filter(Boolean)
    )
  );
  const results = [];
  const seenIds = new Set();

  for (const hostKey of hostCandidates) {
    const matches = await getVisitsByHostCached(hostKey, options.hostCache);
    for (const value of matches) {
      if (value && !seenIds.has(value.id) && isPartialMatch(value, fingerprint)) {
        seenIds.add(value.id);
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
