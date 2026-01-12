const MAX_STATS_ITEMS = 50;

function mapHistoryItem(value) {
  return {
    id: value.id,
    hostHash: value.hostHash,
    pathHash: value.pathHash,
    query: value.query,
    fragment: value.fragment,
    visitCount: value.visitCount,
    lastVisited: value.lastVisited,
    host: value.host,
    path: value.path,
    hashed: value.hashed !== false ? true : false,
    download: value.download === true
  };
}

function buildHistoryItems(visits) {
  return visits
    .slice()
    .sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0))
    .slice(0, MAX_STATS_ITEMS)
    .map(mapHistoryItem);
}

async function handleGetStats() {
  const visits = await getAllVisits();
  let totalEntries = 0;
  let totalVisits = 0;

  visits.forEach((value) => {
    totalEntries += 1;
    totalVisits += value.visitCount || 0;
  });

  const items = buildHistoryItems(visits);

  return {
    totalEntries,
    totalVisits,
    items
  };
}

async function handleSearchHistory(query) {
  const term = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (term.length < 3) {
    return { items: [] };
  }
  const visits = await getAllVisits();
  const matches = visits.filter((value) => {
    if (value.hashed !== false) {
      return false;
    }
    const address = buildAddressFromRecord(value);
    return address.toLowerCase().includes(term);
  });
  return { items: buildHistoryItems(matches) };
}
