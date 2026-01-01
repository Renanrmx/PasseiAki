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
    meta: await dumpAllMeta()
  };

  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const envelope = await encryptWithPassword(password, plaintext);
  return envelope;
}

async function restoreBackup(password, envelope) {
  try {
    const plaintext = await decryptWithPassword(password, envelope);
    const decoded = JSON.parse(new TextDecoder().decode(plaintext));
    if (!decoded || !decoded.visits || !Array.isArray(decoded.visits) || !Array.isArray(decoded.meta)) {
      throw new Error("Invalid backup payload");
    }

    await clearAllData();
    await writeMetaEntries(decoded.meta);
    await putVisits(decoded.visits);

    // reset caches
    pepperKeyPromise = null;
    const encryptionEntry = decoded.meta.find((m) => m && m.key === "encryptionEnabled");
    encryptionEnabledCache = encryptionEntry && typeof encryptionEntry.value === "boolean" ? encryptionEntry.value : null;
    downloadBadgeSettingsCache = null;
    if (typeof clearDownloadBadge === "function") {
      clearDownloadBadge();
    }
    lastSavedByTab.clear();
    lastMatchStateByTab.clear();
    lastPrevVisitByTab.clear();

    // notify tabs to update visuals and reprocess highlights
    try {
      const colors = await getLinkColors();
      api.runtime.sendMessage({ type: "LINK_COLORS_UPDATED", colors });
      if (api.tabs && api.tabs.query) {
        api.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            try {
              api.tabs.sendMessage(tab.id, { type: "LINK_COLORS_UPDATED", colors });
              api.tabs.sendMessage(tab.id, { type: "REFRESH_HIGHLIGHT" });
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
        filename: filename || `passei-aki-backup-${Date.now()}.bak`,
        saveAs: true
      });
    }
  } finally {
    if (revoke) {
      setTimeout(() => revoke(), 5000);
    }
  }
}
