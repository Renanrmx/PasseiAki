const MAX_STATS_ITEMS = 50;

async function handleGetStats() {
  const visits = await getAllVisits();
  let totalEntries = 0;
  let totalVisits = 0;

  visits.forEach((value) => {
    totalEntries += 1;
    totalVisits += value.visitCount || 0;
  });

  const items = visits
    .slice()
    .sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0))
    .slice(0, MAX_STATS_ITEMS)
    .map((value) => ({
      id: value.id,
      hostHash: value.hostHash,
      pathHash: value.pathHash,
      query: value.query,
      fragment: value.fragment,
      visitCount: value.visitCount,
      lastVisited: value.lastVisited,
      host: value.host,
      path: value.path,
      hashed: value.hashed !== false ? true : false
    }));

  return {
    totalEntries,
    totalVisits,
    items
  };
}
