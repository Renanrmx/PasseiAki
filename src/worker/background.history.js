const MAX_STATS_ITEMS = 50;

async function handleGetStats() {
  const db = await openDatabase();
  const tx = db.transaction(VISITS_STORE, "readonly");
  const store = tx.objectStore(VISITS_STORE);
  const index = store.index("lastVisited");

  const items = [];
  let totalEntries = 0;
  let totalVisits = 0;

  const cursorRequest = index.openCursor(null, "prev");

  await new Promise((resolve, reject) => {
    cursorRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const value = cursor.value;
        totalEntries += 1;
        totalVisits += value.visitCount || 0;

        if (items.length < MAX_STATS_ITEMS) {
          items.push({
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
          });
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });

  await waitForTransaction(tx);

  return {
    totalEntries,
    totalVisits,
    items
  };
}
