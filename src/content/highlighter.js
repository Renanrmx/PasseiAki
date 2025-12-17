const api = typeof browser !== "undefined" ? browser : chrome;

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);
const VISITED_CLASS = "passei-aki-visited";
const PARTIAL_CLASS = "passei-aki-partial";
const STYLE_ID = "passei-aki-style";
const SCAN_DEBOUNCE_MS = 400;

let scanTimer = null;


function injectStyle() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    a.${VISITED_CLASS} {
      color: #0b8a5d !important;
      text-decoration-color: #0b8a5d !important;
    }
    a.${PARTIAL_CLASS} {
      color: #7559ca !important;
      text-decoration-color: #7559ca !important;
    }
  `;
  document.head.appendChild(style);
}

function collectLinks() {
  const urlToAnchors = new Map();
  const anchors = Array.from(document.querySelectorAll("a[href]"));

  for (const anchor of anchors) {
    try {
      const url = new URL(anchor.href, window.location.href);
      if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
        continue;
      }

      const normalized = url.toString();
      if (!urlToAnchors.has(normalized)) {
        urlToAnchors.set(normalized, []);
      }
      urlToAnchors.get(normalized).push(anchor);
    } catch (error) {
      // ignore malformed href
    }
  }

  return urlToAnchors;
}

function markVisited(urlToAnchors, visitedLinks) {
  for (const item of visitedLinks) {
    const anchors = urlToAnchors.get(item.token);
    if (!anchors) continue;
    anchors.forEach((anchor) => {
      anchor.classList.remove(VISITED_CLASS, PARTIAL_CLASS);
      if (item.state === "partial") {
        anchor.classList.add(PARTIAL_CLASS);
        anchor.dataset.passeiAkiVisited = "partial";
      } else {
        anchor.classList.add(VISITED_CLASS);
        anchor.dataset.passeiAkiVisited = "true";
      }
    });
  }
}

async function requestVisited(urlToAnchors) {
  const linksPayload = Array.from(urlToAnchors.keys()).map((href) => ({
    href,
    token: href
  }));

  if (linksPayload.length === 0) {
    return;
  }

  try {
    const response = await api.runtime.sendMessage({
      type: "CHECK_VISITED_LINKS",
      links: linksPayload
    });
    if (response && Array.isArray(response.visitedLinks)) {
      markVisited(urlToAnchors, response.visitedLinks);
    }
  } catch (error) {
    // runtime or permission issue; fail silently
  }
}

function scheduleScan() {
  if (scanTimer) {
    return;
  }
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scanAndMark();
  }, SCAN_DEBOUNCE_MS);
}

function scanAndMark() {
  const urlToAnchors = collectLinks();
  requestVisited(urlToAnchors);
}

function startObservers() {
  const observer = new MutationObserver((mutations) => {
    if (
      mutations.some((mutation) => mutation.addedNodes && mutation.addedNodes.length > 0)
    ) {
      scheduleScan();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function init() {
  if (!SUPPORTED_PROTOCOLS.has(window.location.protocol)) {
    return;
  }
  injectStyle();
  scanAndMark();
  startObservers();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
