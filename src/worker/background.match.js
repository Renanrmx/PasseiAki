const MATCH_STATE = {
  none: "none",
  partial: "partial",
  full: "viewed"
};

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
  const parts = normalizeUrlParts(urlString);
  if (!parts) {
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

  const encryptionEnabled = await getEncryptionEnabled();
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

  return {
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
}

async function findVisitMatch(fingerprint) {
  // exact search in hash/plain ids
  const idsToTry = Array.from(
    new Set([fingerprint.id, fingerprint.ids?.hash, fingerprint.ids?.plain].filter(Boolean))
  );

  for (const id of idsToTry) {
    const exact = await getVisitById(id);
    if (exact) {
      return { state: MATCH_STATE.full, record: exact };
    }
  }

  // partial search: same host/path, params/fragment with intersection
  const hostCandidates = Array.from(
    new Set([fingerprint.keys.hash.host, fingerprint.keys.plain.host].filter(Boolean))
  );

  for (const hostKey of hostCandidates) {
    const matches = await getVisitsByHost(hostKey);
    for (const value of matches) {
      if (isPartialMatch(value, fingerprint)) {
        return { state: MATCH_STATE.partial, record: value };
      }
    }
  }

  return { state: MATCH_STATE.none };
}

async function findPartialMatches(fingerprint, limit = 5) {
  const hostCandidates = Array.from(
    new Set([fingerprint.keys.hash.host, fingerprint.keys.plain.host].filter(Boolean))
  );
  const results = [];

  for (const hostKey of hostCandidates) {
    const matches = await getVisitsByHost(hostKey);
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
