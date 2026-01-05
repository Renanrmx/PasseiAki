async function handleCheckVisitedLinks(links, options = {}) {
  const visitedLinks = [];
  const skipFull = options.skipFull === true;
  const skipPartial = options.skipPartial === true;

  for (const link of links) {
    const fingerprint = await computeFingerprint(link.href);
    if (!fingerprint) continue;
    const match = await findVisitMatch(fingerprint);
    if (match.state === MATCH_STATE.full && skipFull) {
      continue;
    }
    if (match.state === MATCH_STATE.partial && skipPartial) {
      continue;
    }
    if (match.state !== MATCH_STATE.none) {
      visitedLinks.push({ token: link.token, state: match.state });
    }
  }

  return { visitedLinks };
}
