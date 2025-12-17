async function handleCheckVisitedLinks(links) {
  const visitedLinks = [];

  for (const link of links) {
    const fingerprint = await computeFingerprint(link.href);
    if (!fingerprint) continue;
    const match = await findVisitMatch(fingerprint);
    if (match.state !== MATCH_STATE.none) {
      visitedLinks.push({ token: link.token, state: match.state });
    }
  }

  return { visitedLinks };
}
