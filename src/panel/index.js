const api = typeof browser !== "undefined" ? browser : chrome;

const totalVisits = document.getElementById("total-visits");
const lastVisitDate = document.getElementById("last-visit-date");
const lastVisitTime = document.getElementById("last-visit-time");
const matchStatusInline = document.getElementById("match-status-inline");
const settingsBtn = document.getElementById("settings-btn");
const historyBtn = document.getElementById("history-btn");
const partialContainer = document.getElementById("partial-container");
const partialList = document.getElementById("partial-list");
const downloadBadgeContainer = document.getElementById("download-badge-container");
const downloadBadgeList = document.getElementById("download-badge-list");
const downloadBadgeDismiss = document.getElementById("download-badge-dismiss");
const supportBtn = document.getElementById("support-btn");
const supportContainer = document.getElementById("support-container");


function normalizeParamsLocal(paramString) {
  if (!paramString) return [];
  const params = new URLSearchParams(paramString.replace(/^\?/, ""));
  const map = new Map();
  for (const [key, value] of params) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, values]) => values.sort().map((v) => `${key}=${v}`));
}

function formatDateParts(timestamp) {
  if (!timestamp) {
    return { date: "—", time: "—" };
  }
  const date = new Date(timestamp);
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  };
}

function applyPanelTexts() {
  applyI18n();
  document.title = t("extensionName");
}

async function loadStats() {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const url = tab ? tab.url : "";
    const tabId = tab ? tab.id : undefined;

    const visitSummary = await api.runtime.sendMessage({
      type: "GET_VISIT_FOR_URL",
      url,
      tabId
    });
    
    totalVisits.textContent = visitSummary.visitCount || 0;
    const parts = formatDateParts(visitSummary.lastVisited);
    lastVisitDate.textContent = parts.date;
    lastVisitTime.textContent = parts.time;
    updateMatchStatus(url, visitSummary.matchState);

    if (visitSummary.matchState === "partial") {
      await loadPartialMatches(url);
    } else if (partialContainer) {
      partialContainer.style.display = "none";
    }

  } catch (error) {
    totalVisits.textContent = "0";
    lastVisitDate.textContent = "—";
    lastVisitTime.textContent = "—";
    updateMatchStatus(url, "none");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  applyPanelTexts();
  loadStats();
  loadDownloadBadgeState();
  loadSupportVisibility();
});

function updateMatchStatus(url, state) {  
  if (!matchStatusInline) return;
  matchStatusInline.classList.remove("bad", "partial", "full");
  matchStatusInline.style.display = "none";

  const isHttp = typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
  if (!isHttp) return;

  if (state === "viewed") {
    matchStatusInline.textContent = t("statusVisited");
    matchStatusInline.classList.add("full");
    matchStatusInline.style.display = "block";
  } else if (state === "partial") {
    matchStatusInline.textContent = t("statusPartial");
    matchStatusInline.classList.add("partial");
    matchStatusInline.style.display = "block";
  } else {
    matchStatusInline.textContent = t("statusFirst");
    matchStatusInline.classList.add("none");
    matchStatusInline.style.display = "block";
  }
}

window.loadStats = loadStats;

function clearDownloadBadgeList() {
  if (!downloadBadgeList) return;
  while (downloadBadgeList.firstChild) {
    downloadBadgeList.removeChild(downloadBadgeList.firstChild);
  }
}

function renderDownloadBadgeList(items, visible) {
  if (!downloadBadgeContainer || !downloadBadgeList) return;
  clearDownloadBadgeList();
  if (!visible || !items || !items.length) {
    downloadBadgeContainer.style.display = "none";
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "entry";

    const pathDiv = document.createElement("div");
    pathDiv.className = "path";
    if (item.hashed !== false) {
      pathDiv.textContent = "???";
    } else {
      pathDiv.textContent = buildAddressFromRecord(item);
    }

    const meta = document.createElement("div");
    meta.className = "download-meta";
    const parts = formatDateParts(item.lastVisited);
    const dateText = t("lastVisitWithDate", `${parts.date} ${parts.time}`);
    const metaText = document.createElement("span");
    metaText.textContent = dateText;

    const badge = document.createElement("span");
    badge.className = "download-label";
    badge.textContent = t("downloadLabel");

    meta.appendChild(metaText);
    meta.appendChild(badge);

    li.appendChild(pathDiv);
    li.appendChild(meta);
    downloadBadgeList.appendChild(li);
  });
  downloadBadgeContainer.style.display = "block";
}

async function loadDownloadBadgeState() {
  try {
    const res = await api.runtime.sendMessage({ type: "GET_DOWNLOAD_BADGE_STATE" });
    if (res && res.ok) {
      renderDownloadBadgeList(res.items || [], res.visible);
    } else {
      renderDownloadBadgeList([], false);
    }
  } catch (error) {
    renderDownloadBadgeList([], false);
  }
}

function setSupportVisibility(visible) {
  if (!supportContainer) return;
  supportContainer.style.display = visible ? "" : "none";
}

async function loadSupportVisibility() {
  if (!supportContainer) return;
  try {
    const res = await api.runtime.sendMessage({ type: "GET_SUPPORT_STATUS" });
    if (res && res.ok) {
      setSupportVisibility(res.visible !== false);
      return;
    }
  } catch (error) {
    // ignore status errors
  }
  setSupportVisibility(true);
}

async function loadPartialMatches(url) {
  if (!partialContainer || !partialList) return;
  while (partialList.firstChild) {
    partialList.removeChild(partialList.firstChild);
  }
  const currentParamsSet = new Set(normalizeParamsLocal((new URL(url)).search));
  try {
    const res = await api.runtime.sendMessage({
      type: "GET_PARTIAL_MATCHES",
      url
    });
    const items = (res && res.items) || [];
    if (!items.length) {
      partialContainer.style.display = "none";
      return;
    }
    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "entry";
      const isHashed = item.hashed !== false;

      const pathDiv = document.createElement("div");
      pathDiv.className = "path";
      if (isHashed) {
        pathDiv.textContent = "???";
      } else {
        const host = item.host || "";
        const path = item.path || "";
        const fragment = item.fragment ? `#${item.fragment}` : "";
        pathDiv.textContent = `${host}${path}`;
        if (item.query) {
          const querySpan = document.createElement("span");
          querySpan.textContent = "?";
          pathDiv.appendChild(querySpan);
          const paramList = item.query.split("&").filter(Boolean);
          paramList.forEach((param, index) => {
            const span = document.createElement("span");
            span.textContent = param;
            if (currentParamsSet.has(param)) {
              span.classList.add("param-match");
            } else {
              span.classList.add("param-diff");
            }
            pathDiv.appendChild(span);
            if (index < paramList.length - 1) {
              pathDiv.appendChild(document.createTextNode("&"));
            }
          });
        }
        if (fragment) {
          const fragSpan = document.createElement("span");
          fragSpan.textContent = fragment;
          pathDiv.appendChild(fragSpan);
        }
      }

      const meta = document.createElement("div");
      meta.className = "meta";
      const parts = formatDateParts(item.lastVisited);
      meta.textContent = isHashed
        ? t("lastVisitWithDate", parts.date)
        : t("lastVisitWithDate", `${parts.date} ${parts.time}`);

      li.appendChild(pathDiv);
      li.appendChild(meta);
      partialList.appendChild(li);
    });
    partialContainer.style.display = "block";
  } catch (error) {
    partialContainer.style.display = "none";
  }
}

if (settingsBtn) {
  settingsBtn.addEventListener("click", async () => {
    const url = api.runtime.getURL("panel/settings.html");

    try {
      const canWindow = api?.windows?.create;
      const canTabs = api?.tabs?.create;

      if (canWindow) {
        const created = await api.windows.create({
          url,
          type: "popup",
          width: 650,
          height: 600,
          focused: true
        });

        const tabId = created?.tabs?.[0]?.id;
        if (!tabId && canTabs) await api.tabs.create({ url });
      } else if (canTabs) {
        await api.tabs.create({ url });
      } else {
        window.location.href = url;
        return;
      }
    } catch (_) {
      try {
        await api?.tabs?.create?.({ url });
      } catch (_) {
        window.location.href = url;
        return;
      }
    }

    window.close();
  });
}

if (historyBtn) {
  historyBtn.addEventListener("click", async () => {
    const url = api.runtime.getURL("panel/history.html");
    try {
      if (api?.windows?.create) {
        await api.windows.create({
          url,
          type: "popup",
          width: 800,
          height: 600,
          focused: true
        });
      } else if (api?.tabs?.create) {
        await api.tabs.create({ url });
      } else {
        window.location.href = url;
        return;
      }
    } catch (_) {
      try {
        await api?.tabs?.create?.({ url });
      } catch (_) {
        window.location.href = url;
        return;
      }
    }
    window.close();
  });
}

if (api.runtime && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((message) => {
    if (message && message.type === "DOWNLOAD_BADGE_UPDATED") {
      renderDownloadBadgeList(message.items || [], message.visible);
    }
    if (message && message.type === "SUPPORT_STATUS_UPDATED") {
      setSupportVisibility(message.visible !== false);
    }
  });
}

if (downloadBadgeDismiss) {
  downloadBadgeDismiss.addEventListener("click", async () => {
    try {
      await api.runtime.sendMessage({ type: "DISMISS_DOWNLOAD_BADGE" });
    } catch (error) {
      // ignore dismiss errors
    }
  });
}

if (supportBtn) {
  supportBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    const url = supportBtn.getAttribute("href");
    if (!url) {
      window.close();
      return;
    }
    try {
      const created = await api?.tabs?.create?.({ url });
      if (created && typeof created.id === "number") {
        try {
          await api.runtime.sendMessage({ type: "SUPPORT_TAB_OPENED", tabId: created.id });
        } catch (error) {
          // ignore tracking errors
        }
      }
    } catch (error) {
      window.open(url, "_blank", "noopener");
    }
    window.close();
  });
}
