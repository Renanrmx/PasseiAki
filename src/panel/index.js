const api = typeof browser !== "undefined" ? browser : chrome;

const totalVisits = document.getElementById("total-visits");
const lastVisitDate = document.getElementById("last-visit-date");
const lastVisitTime = document.getElementById("last-visit-time");
const matchStatusInline = document.getElementById("match-status-inline");
const settingsBtn = document.getElementById("settings-btn");
const historyBtn = document.getElementById("history-btn");
const partialContainer = document.getElementById("partial-container");
const partialList = document.getElementById("partial-list");


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

document.addEventListener("DOMContentLoaded", loadStats);

function updateMatchStatus(url, state) {  
  if (!matchStatusInline) return;
  matchStatusInline.classList.remove("bad", "partial", "full");
  matchStatusInline.style.display = "none";

  const isHttp = typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
  if (!isHttp) return;

  if (state === "viewed") {
    matchStatusInline.textContent = "Já visitado";
    matchStatusInline.classList.add("full");
    matchStatusInline.style.display = "block";
  } else if (state === "partial") {
    matchStatusInline.textContent = "Visitado com parâmetro diferente";
    matchStatusInline.classList.add("partial");
    matchStatusInline.style.display = "block";
  } else {
    matchStatusInline.textContent = "Primeira visita";
    matchStatusInline.classList.add("none");
    matchStatusInline.style.display = "block";
  }
}

window.loadStats = loadStats;

async function loadPartialMatches(url) {
  if (!partialContainer || !partialList) return;
  partialList.innerHTML = "";
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
        ? `Última visita: ${parts.date}`
        : `Última visita: ${parts.date} ${parts.time}`;

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
