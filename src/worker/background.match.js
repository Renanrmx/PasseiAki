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
  const db = await openDatabase();

  // busca exata em ids hash/plain
  const idsToTry = Array.from(
    new Set([fingerprint.id, fingerprint.ids?.hash, fingerprint.ids?.plain].filter(Boolean))
  );

  for (const id of idsToTry) {
    const txExact = db.transaction(VISITS_STORE, "readonly");
    const storeExact = txExact.objectStore(VISITS_STORE);
    const exact = await requestToPromise(storeExact.get(id));
    await waitForTransaction(txExact);
    if (exact) {
      return { state: MATCH_STATE.full, record: exact };
    }
  }

  // busca parcial: mesmo host/path, parametros/fragmento com interseção
  const hostCandidates = Array.from(
    new Set([fingerprint.keys.hash.host, fingerprint.keys.plain.host].filter(Boolean))
  );

  return new Promise((resolve, reject) => {
    const searchNextHost = () => {
      if (hostCandidates.length === 0) {
        resolve({ state: MATCH_STATE.none });
        return;
      }

      const hostKey = hostCandidates.shift();
      const tx = db.transaction(VISITS_STORE, "readonly");
      const store = tx.objectStore(VISITS_STORE);
      const index = store.index("hostHash");
      const range = IDBKeyRange.only(hostKey);
      const cursorReq = index.openCursor(range);

      cursorReq.onsuccess = async (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const value = cursor.value;
          if (isPartialMatch(value, fingerprint)) {
            resolve({ state: MATCH_STATE.partial, record: value });
            return;
          }
          cursor.continue();
        } else {
          try {
            await waitForTransaction(tx);
            searchNextHost();
          } catch (error) {
            reject(error);
          }
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    };

    searchNextHost();
  });
}

async function findPartialMatches(fingerprint, limit = 5) {
  const db = await openDatabase();
  const hostCandidates = Array.from(
    new Set([fingerprint.keys.hash.host, fingerprint.keys.plain.host].filter(Boolean))
  );
  const results = [];

  await Promise.all(
    hostCandidates.map(async (hostKey) => {
      const tx = db.transaction(VISITS_STORE, "readonly");
      const store = tx.objectStore(VISITS_STORE);
      const index = store.index("hostHash");
      const range = IDBKeyRange.only(hostKey);
      const cursorReq = index.openCursor(range);

      await new Promise((resolve, reject) => {
        cursorReq.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const value = cursor.value;
            if (isPartialMatch(value, fingerprint)) {
              results.push(value);
              if (results.length >= limit) {
                resolve();
                return;
              }
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
      await waitForTransaction(tx);
    })
  );

  results.sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
  return results.slice(0, limit);
}
