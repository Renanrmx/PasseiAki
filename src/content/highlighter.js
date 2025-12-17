const api = typeof browser !== "undefined" ? browser : chrome;

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);
const VISITED_CLASS = "passei-aki-visited";
const PARTIAL_CLASS = "passei-aki-partial";
const STYLE_ID = "passei-aki-style";
const SCAN_DEBOUNCE_MS = 400;

let scanTimer = null;
let currentColors = {
  matchHexColor: null,
  partialHexColor: null,
  matchColorEnabled: true,
  partialColorEnabled: true
};


function buildStyleText() {
  const matchColor =
    currentColors.matchColorEnabled !== false && currentColors.matchHexColor
      ? currentColors.matchHexColor
      : null;
  const partialColor =
    currentColors.partialColorEnabled !== false && currentColors.partialHexColor
      ? currentColors.partialHexColor
      : null;

  const matchRule = matchColor
    ? `
    a.${VISITED_CLASS} {
      color: ${matchColor} !important;
      text-decoration-color: ${matchColor} !important;
    }`
    : `
    a.${VISITED_CLASS} {
      color: inherit !important;
      text-decoration-color: inherit !important;
    }`;

  const partialRule = partialColor
    ? `
    a.${PARTIAL_CLASS} {
      color: ${partialColor} !important;
      text-decoration-color: ${partialColor} !important;
    }`
    : `
    a.${PARTIAL_CLASS} {
      color: inherit !important;
      text-decoration-color: inherit !important;
    }`;

  return `
    ${matchRule}
    ${partialRule}
  `;
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = buildStyleText();
  document.head.appendChild(style);
}

function normalizeHexColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().toLowerCase();
  const match = cleaned.match(/^#?[0-9a-f]{6}$/);
  if (!match) return fallback;
  return cleaned.startsWith("#") ? cleaned : `#${cleaned}`;
}

function applyColors(colors = {}) {
  currentColors = {
    matchHexColor: normalizeHexColor(colors.matchHexColor, null),
    partialHexColor: normalizeHexColor(colors.partialHexColor, null),
    matchColorEnabled:
      typeof colors.matchColorEnabled === "boolean" ? colors.matchColorEnabled : true,
    partialColorEnabled:
      typeof colors.partialColorEnabled === "boolean" ? colors.partialColorEnabled : true
  };
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    injectStyle();
    style = document.getElementById(STYLE_ID);
  }
  if (style) {
    style.textContent = buildStyleText();
  }
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
  try {
    api.runtime.sendMessage({ type: "GET_LINK_COLORS" }).then((res) => {
      if (res && res.colors) {
        applyColors(res.colors);
      } else {
        applyColors({});
      }
    });
  } catch (error) {
    applyColors({});
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

if (api.runtime && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((message) => {
    if (message && message.type === "LINK_COLORS_UPDATED" && message.colors) {
      applyColors(message.colors);
    }
  });
}
