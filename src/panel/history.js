const api = typeof browser !== "undefined" ? browser : chrome;
const historyList = document.getElementById("history-list");
let refreshTimer = null;
const confirmOverlay = document.getElementById("confirm-overlay");
const confirmOk = document.getElementById("confirm-ok");
const confirmCancel = document.getElementById("confirm-cancel");


function formatDate(timestamp, withTime) {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  if (withTime) {
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString();
}

function clearList() {
  while (historyList.firstChild) {
    historyList.removeChild(historyList.firstChild);
  }
}

function renderHistory(items) {
  clearList();
  if (!items || items.length === 0) {
    const li = document.createElement("li");
    li.className = "entry";
    li.textContent = t("noVisits");
    historyList.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "entry";

    const urlDiv = document.createElement("div");
    urlDiv.className = "url";

    const isHashed = item.hashed !== false;
    let fullUrl = "";
    if (isHashed) {
      urlDiv.textContent = "???";
    } else {
      fullUrl = buildAddressFromRecord(item);
      urlDiv.textContent = fullUrl;
    }

    const metaDiv = document.createElement("div");
    metaDiv.className = "meta";
    const metaText = document.createElement("span");
    metaText.textContent = isHashed
      ? t("lastVisitWithDate", formatDate(item.lastVisited, false))
      : t("lastVisitWithDate", formatDate(item.lastVisited, true));

    const metaLeft = document.createElement("div");
    metaLeft.className = "meta-left";
    metaLeft.appendChild(metaText);
    
    if (item.download === true) {
      const downloadLabel = document.createElement("span");
      downloadLabel.className = "download-label";
      downloadLabel.textContent = t("downloadLabel");
      metaLeft.appendChild(downloadLabel);
    }
    metaDiv.appendChild(metaLeft);

    const actionsWrapper = document.createElement("div");
    actionsWrapper.style.display = "flex";
    actionsWrapper.style.gap = "6px";

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.title = t("deleteRecord");
    deleteBtn.textContent = "✖";
    deleteBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const confirmDelete = await confirmDeletion();
      if (!confirmDelete) return;
      try {
        const res = await api.runtime.sendMessage({ type: "DELETE_VISIT", id: item.id });
        if (!res || res.ok === false) {
          throw new Error(res && res.error ? res.error : "Error deleting record");
        }
        await loadHistory();
      } catch (error) {
        alert(error && error.message ? error.message : t("deleteError"));
      }
    });
    actionsWrapper.appendChild(deleteBtn);

    if (!isHashed && fullUrl) {
      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.title = t("copyUrl");
      copyBtn.textContent = "⧉";
      copyBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(fullUrl);
          copyBtn.textContent = "✔";
          setTimeout(() => {
            copyBtn.textContent = "⧉";
          }, 800);
        } catch (_) {
          copyBtn.textContent = "x";
          setTimeout(() => {
            copyBtn.textContent = "⧉";
          }, 800);
        }
      });
      actionsWrapper.appendChild(copyBtn);
    }

    metaDiv.appendChild(actionsWrapper);

    li.appendChild(urlDiv);
    li.appendChild(metaDiv);
    historyList.appendChild(li);
  }
}

async function loadHistory() {
  try {
    const stats = await api.runtime.sendMessage({ type: "GET_STATS" });
    renderHistory(stats.items || []);
  } catch (error) {
    renderHistory([]);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  applyI18n();
  document.title = t("historyPageTitle");
  loadHistory();
});

window.addEventListener("focus", loadHistory);

if (api.runtime && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((message) => {
    if (message && message.type === "HISTORY_UPDATED") {
      loadHistory();
    }
  });
}

window.addEventListener("beforeunload", () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
});

function confirmDeletion() {
  return new Promise((resolve) => {
    if (!confirmOverlay || !confirmOk || !confirmCancel) {
      resolve(false);
      return;
    }
    confirmOverlay.classList.add("active");
    const cleanup = (val) => {
      confirmOverlay.classList.remove("active");
      confirmOk.onclick = null;
      confirmCancel.onclick = null;
      resolve(val);
    };
    confirmOk.onclick = () => cleanup(true);
    confirmCancel.onclick = () => cleanup(false);
  });
}
