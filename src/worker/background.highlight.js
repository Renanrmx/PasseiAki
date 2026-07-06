async function handleCheckVisitedLinks(links, options = {}) {
  const visitedLinks = [];
  const skipFull = options.skipFull === true;
  const skipPartial = options.skipPartial === true;
  const hostCache = new Map();
  const visitCache = new Map();
  const stateByHref = new Map();

  for (const link of links) {
    if (!link || typeof link.href !== "string") {
      continue;
    }
    let state = stateByHref.get(link.href);
    if (state === undefined) {
      state = null;
      const fingerprint = await computeFingerprint(link.href);
      if (fingerprint) {
        const match = await findVisitMatch(fingerprint, { hostCache, visitCache });
        if (match.state === MATCH_STATE.full && !skipFull) {
          state = match.state;
        } else if (match.state === MATCH_STATE.partial && !skipPartial) {
          state = match.state;
        }
      }
      stateByHref.set(link.href, state);
    }
    if (state) {
      visitedLinks.push({ token: link.token, state });
    }
  }

  return { visitedLinks };
}
