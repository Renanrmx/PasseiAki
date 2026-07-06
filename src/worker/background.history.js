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
  const totals = await getStatsTotals();
  const recentVisits = await getRecentVisits(MAX_STATS_ITEMS);
  const items = buildHistoryItems(recentVisits);

  return {
    totalEntries: totals.totalEntries,
    totalVisits: totals.totalVisits,
    items
  };
}

async function handleSearchHistory(query) {
  const term = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (term.length < 3) {
    return { items: [] };
  }
  const matches = await searchPlainVisits(term, MAX_STATS_ITEMS);
  return { items: buildHistoryItems(matches) };
}
