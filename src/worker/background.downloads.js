let downloadBadgeTimer = null;
let downloadBadgeVisible = false;
let downloadBadgeSettingsCache = null;
let downloadBadgeCount = 0;
let downloadBadgeItems = [];

function getDownloadBadgeSettingsCache() {
  return downloadBadgeSettingsCache;
}

function setDownloadBadgeSettingsCache(settings) {
  downloadBadgeSettingsCache = settings;
}

function resetDownloadBadgeSettingsCache() {
  downloadBadgeSettingsCache = null;
}

function getDownloadBadgeState() {
  return {
    visible: downloadBadgeVisible,
    count: downloadBadgeCount,
    items: downloadBadgeItems
  };
}

function parseBadgeColorToRgba(color) {
  if (typeof color !== "string") {
    return [14, 154, 105, 255];
  }
  const cleaned = color.replace("#", "").trim();
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(cleaned)) {
    return [14, 154, 105, 255];
  }
  const hex = cleaned.toLowerCase();
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

async function updateDownloadBadgeAppearance(settings) {
  if (settings.downloadBadgeEnabled === false) {
    clearDownloadBadge();
    return;
  }
  if (!downloadBadgeVisible) {
    return;
  }
  if (actionApi && actionApi.setBadgeBackgroundColor) {
    const color = parseBadgeColorToRgba(settings.downloadBadgeColor);
    actionApi.setBadgeBackgroundColor({ color });
  }
  scheduleDownloadBadgeClear(settings.downloadBadgeDurationMs);
  sendDownloadBadgeUpdate(true);
}

function scheduleDownloadBadgeClear(durationMs) {
  if (downloadBadgeTimer) {
    clearTimeout(downloadBadgeTimer);
    downloadBadgeTimer = null;
  }
  if (!durationMs || durationMs <= 0) {
    return;
  }
  downloadBadgeTimer = setTimeout(() => {
    clearDownloadBadge();
  }, durationMs);
}

function clearDownloadBadge() {
  if (downloadBadgeTimer) {
    clearTimeout(downloadBadgeTimer);
    downloadBadgeTimer = null;
  }
  downloadBadgeVisible = false;
  downloadBadgeCount = 0;
  downloadBadgeItems = [];
  if (actionApi && actionApi.setBadgeText) {
    actionApi.setBadgeText({ text: "" });
  }
  sendDownloadBadgeUpdate(false);
}

async function showDownloadBadge() {
  const settings = downloadBadgeSettingsCache || (await getDownloadBadgeSettings());
  downloadBadgeSettingsCache = settings;
  if (settings.downloadBadgeEnabled === false) {
    clearDownloadBadge();
    return;
  }
  if (downloadBadgeCount <= 0) {
    clearDownloadBadge();
    return;
  }
  if (actionApi && actionApi.setBadgeBackgroundColor) {
    const color = parseBadgeColorToRgba(settings.downloadBadgeColor);
    actionApi.setBadgeBackgroundColor({ color });
  }
  if (actionApi && actionApi.setBadgeText) {
    actionApi.setBadgeText({ text: String(downloadBadgeCount) });
  }
  downloadBadgeVisible = true;
  scheduleDownloadBadgeClear(settings.downloadBadgeDurationMs);
  sendDownloadBadgeUpdate(true);
}

function sendDownloadBadgeUpdate(visible) {
  try {
    if (!api?.runtime?.sendMessage) {
      return;
    }
    if (!visible) {
      const result = api.runtime.sendMessage({
        type: "DOWNLOAD_BADGE_UPDATED",
        visible: false,
        count: 0,
        items: []
      });
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
      return;
    }
    const items = downloadBadgeItems.slice(0, downloadBadgeCount);
    const result = api.runtime.sendMessage({
      type: "DOWNLOAD_BADGE_UPDATED",
      visible: true,
      count: downloadBadgeCount,
      items
    });
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (error) {
    // ignore broadcast errors
  }
}

function registerDuplicateDownload(item) {
  if (!item) return;
  if (!downloadBadgeVisible) {
    downloadBadgeCount = 0;
    downloadBadgeItems = [];
  }
  downloadBadgeCount += 1;
  downloadBadgeItems.unshift(item);
  showDownloadBadge().catch(() => {
    // ignore badge update errors
  });
}

async function handleDownloadCreated(item) {
  try {
    if (!item) return;
    if (item.byExtensionId && api?.runtime?.id && item.byExtensionId === api.runtime.id) {
      return;
    }
    const candidates = [];
    if (typeof item.finalUrl === "string") {
      candidates.push(item.finalUrl);
    }
    if (typeof item.url === "string") {
      candidates.push(item.url);
    }
    const urls = Array.from(new Set(candidates)).filter(
      (url) => !url.startsWith("blob:") && !url.startsWith("data:")
    );
    if (!urls.length) {
      return;
    }
    const tasks = urls.map((url) =>
      upsertVisit(url, { download: true })
        .then((result) => ({ url, result }))
        .catch(() => null)
    );
    if (!tasks.length) {
      return;
    }
    const results = await Promise.all(tasks);
    const repeated = results.find((entry) => entry && entry.result && entry.result.existedBefore);
    if (!repeated) {
      return;
    }
    const record = repeated.result.record;
    const previousLastVisited =
      repeated.result.previousLastVisited || (record ? record.lastVisited : null);
    if (!record) {
      return;
    }
    registerDuplicateDownload({
      id: record.id,
      host: record.host,
      path: record.path,
      query: record.query,
      fragment: record.fragment,
      lastVisited: previousLastVisited,
      hashed: record.hashed !== false
    });
  } catch (error) {
    // ignore badge tracking errors
  }
}

if (typeof api !== "undefined" && api?.downloads?.onCreated) {
  api.downloads.onCreated.addListener(handleDownloadCreated);
}
