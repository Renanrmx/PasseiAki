async function dumpAllVisits() {
  return getAllVisits();
}

async function dumpAllMeta() {
  return getAllMetaEntries();
}

async function createBackup(password) {
  const payload = {
    version: 2,
    visits: await dumpAllVisits(),
    meta: await dumpAllMeta(),
    partialExceptions: await getAllPartialExceptions(),
    matchExceptions: await getAllMatchExceptions()
  };

  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const envelope = await encryptWithPassword(password, plaintext);
  return envelope;
}

function mergePlainVisits(existing = [], incoming = []) {
  const merged = new Map();
  incoming.forEach((record) => {
    if (record && record.id) {
      merged.set(record.id, record);
    }
  });

  existing.forEach((record) => {
    if (!record || !record.id) return;
    const isPlain = record.hashed === false;
    if (!isPlain) return;

    const current = merged.get(record.id);
    if (current && current.hashed === false) {
      const mergedCount = (current.visitCount || 0) + (record.visitCount || 0);
      const mergedLast = Math.max(current.lastVisited || 0, record.lastVisited || 0);
      merged.set(record.id, {
        ...current,
        ...record,
        visitCount: mergedCount,
        lastVisited: mergedLast,
        download: current.download === true || record.download === true,
        hashed: false
      });
      return;
    }

    if (!current) {
      merged.set(record.id, record);
    }
  });

  return Array.from(merged.values());
}

async function restoreBackup(password, envelope, options = {}) {
  try {
    const plaintext = await decryptWithPassword(password, envelope);
    const decoded = JSON.parse(new TextDecoder().decode(plaintext));
    if (!decoded || !decoded.visits || !Array.isArray(decoded.visits) || !Array.isArray(decoded.meta)) {
      throw new Error("Invalid backup payload");
    }

    const shouldMergeVisits = options && options.mergeVisits === true;
    const existingVisits = shouldMergeVisits ? await dumpAllVisits() : [];
    const visitsToRestore = shouldMergeVisits
      ? mergePlainVisits(existingVisits, decoded.visits)
      : decoded.visits;

    await clearAllData();
    await writeMetaEntries(decoded.meta);
    await putVisits(visitsToRestore);
    if (Array.isArray(decoded.partialExceptions)) {
      await setPartialExceptions(decoded.partialExceptions);
    }
    if (Array.isArray(decoded.matchExceptions)) {
      await setMatchExceptions(decoded.matchExceptions);
    }

    // reset caches
    pepperKeyPromise = null;
    const encryptionEntry = decoded.meta.find((m) => m && m.key === "encryptionEnabled");
    encryptionEnabledCache = encryptionEntry && typeof encryptionEntry.value === "boolean" ? encryptionEntry.value : null;
    if (typeof resetDownloadBadgeSettingsCache === "function") {
      resetDownloadBadgeSettingsCache();
    }
    if (typeof clearDownloadBadge === "function") {
      clearDownloadBadge();
    }
    lastSavedByTab.clear();
    lastMatchStateByTab.clear();
    lastPrevVisitByTab.clear();

    // notify tabs to update visuals and reprocess highlights
    try {
      const colors = await getLinkColors();
      if (api.runtime && api.runtime.sendMessage) {
        const result = api.runtime.sendMessage({ type: "LINK_COLORS_UPDATED", colors });
        if (result && typeof result.catch === "function") {
          result.catch(() => {});
        }
      }
      if (api.tabs && api.tabs.query) {
        api.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            try {
              const colorResult = api.tabs.sendMessage(tab.id, {
                type: "LINK_COLORS_UPDATED",
                colors
              });
              if (colorResult && typeof colorResult.catch === "function") {
                colorResult.catch(() => {});
              }
              const refreshResult = api.tabs.sendMessage(tab.id, { type: "REFRESH_HIGHLIGHT" });
              if (refreshResult && typeof refreshResult.catch === "function") {
                refreshResult.catch(() => {});
              }
            } catch (error) {
              // ignore per-tab errors
            }
          });
        });
      }
    } catch (error) {
      // ignore broadcast errors
    }
  } catch (error) {
    console.error("Error restoring data:", error);
    throw error;
  }
}

async function downloadBackup(envelope, filename) {
  const blob = new Blob([JSON.stringify(envelope)], { type: "application/octet-stream" });
  const { url: objectUrl, revoke } = await buildDownloadUrl(blob, "application/octet-stream");
  try {
    if (api && api.downloads && api.downloads.download) {
      await api.downloads.download({
        url: objectUrl,
        filename: filename || `passei-aki_backup-${formatDate(new Date(), "YYYY-MM-DD_HH-mm-ss")}.bak`,
        saveAs: true
      });
    }
  } finally {
    if (revoke) {
      setTimeout(() => revoke(), 5000);
    }
  }
}
