const api = typeof browser !== "undefined" ? browser : chrome;

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);
const VISITED_TEXT_CLASS = "passei-aki-visited";
const PARTIAL_TEXT_CLASS = "passei-aki-partial";
const VISITED_BORDER_CLASS = "passei-aki-visited-border";
const PARTIAL_BORDER_CLASS = "passei-aki-partial-border";
const STYLE_ID = "passei-aki-style";
const SCAN_DEBOUNCE_MS = 400;

let scanTimer = null;
let currentColors = {
  matchHexColor: null,
  partialHexColor: null,
  matchTextEnabled: true,
  partialTextEnabled: true,
  matchBorderEnabled: true,
  partialBorderEnabled: true
};


function buildStyleText() {
  const matchColor =
    currentColors.matchTextEnabled !== false && currentColors.matchHexColor
      ? currentColors.matchHexColor
      : null;
  const partialColor =
    currentColors.partialTextEnabled !== false && currentColors.partialHexColor
      ? currentColors.partialHexColor
      : null;

  const matchTextRule = matchColor
    ? `
    a.${VISITED_TEXT_CLASS} {
      color: ${matchColor} !important;
      text-decoration-color: ${matchColor} !important;
    }`
    : `
    a.${VISITED_TEXT_CLASS} {
      color: inherit !important;
      text-decoration-color: inherit !important;
    }`;

  const partialTextRule = partialColor
    ? `
    a.${PARTIAL_TEXT_CLASS} {
      color: ${partialColor} !important;
      text-decoration-color: ${partialColor} !important;
    }`
    : `
    a.${PARTIAL_TEXT_CLASS} {
      color: inherit !important;
      text-decoration-color: inherit !important;
    }`;

  const matchBorderRule = `
    a.${VISITED_BORDER_CLASS} {
      outline: 2px solid ${
        currentColors.matchBorderEnabled !== false && currentColors.matchHexColor
          ? currentColors.matchHexColor
          : "transparent"
      } !important;
      outline-offset: 0px;
      border-radius: 3px;
    }`;

  const partialBorderRule = `
    a.${PARTIAL_BORDER_CLASS} {
      outline: 2px solid ${
        currentColors.partialBorderEnabled !== false && currentColors.partialHexColor
          ? currentColors.partialHexColor
          : "transparent"
      } !important;
      outline-offset: 0px;
      border-radius: 3px;
    }`;

  return `
    ${matchTextRule}
    ${partialTextRule}
    ${matchBorderRule}
    ${partialBorderRule}
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

function applyColors(colors = {}, options = {}) {
  currentColors = {
    matchHexColor: normalizeHexColor(colors.matchHexColor, null),
    partialHexColor: normalizeHexColor(colors.partialHexColor, null),
    matchTextEnabled:
      typeof colors.matchTextEnabled === "boolean" ? colors.matchTextEnabled : true,
    partialTextEnabled:
      typeof colors.partialTextEnabled === "boolean" ? colors.partialTextEnabled : true,
    matchBorderEnabled:
      typeof colors.matchBorderEnabled === "boolean" ? colors.matchBorderEnabled : true,
    partialBorderEnabled:
      typeof colors.partialBorderEnabled === "boolean" ? colors.partialBorderEnabled : true
  };
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    injectStyle();
    style = document.getElementById(STYLE_ID);
  }
  if (style) {
    style.textContent = buildStyleText();
  }

  if (options.rescan) {
    scanAndMark();
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
      anchor.classList.remove(VISITED_TEXT_CLASS, PARTIAL_TEXT_CLASS, VISITED_BORDER_CLASS, PARTIAL_BORDER_CLASS);
      anchor.style.color = "";
      anchor.style.textDecorationColor = "";
      anchor.style.outline = "";

      if (item.state === "partial") {
        anchor.classList.add(PARTIAL_TEXT_CLASS);
        anchor.classList.add(PARTIAL_BORDER_CLASS);
        if (currentColors.partialTextEnabled !== false && currentColors.partialHexColor) {
          anchor.style.setProperty("color", currentColors.partialHexColor, "important");
          anchor.style.setProperty("text-decoration-color", currentColors.partialHexColor, "important");
        }
        if (currentColors.partialBorderEnabled !== false && currentColors.partialHexColor) {
          anchor.style.setProperty("outline", `2px solid ${currentColors.partialHexColor}`, "important");
          anchor.style.setProperty("outline-offset", "0px", "important");
          anchor.style.setProperty("border-radius", "3px", "important");
        }
        anchor.dataset.passeiAkiVisited = "partial";
      } else {
        anchor.classList.add(VISITED_TEXT_CLASS);
        anchor.classList.add(VISITED_BORDER_CLASS);
        if (currentColors.matchTextEnabled !== false && currentColors.matchHexColor) {
          anchor.style.setProperty("color", currentColors.matchHexColor, "important");
          anchor.style.setProperty("text-decoration-color", currentColors.matchHexColor, "important");
        }
        if (currentColors.matchBorderEnabled !== false && currentColors.matchHexColor) {
          anchor.style.setProperty("outline", `2px solid ${currentColors.matchHexColor}`, "important");
          anchor.style.setProperty("outline-offset", "0px", "important");
          anchor.style.setProperty("border-radius", "3px", "important");
        }
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
      applyColors(message.colors, { rescan: true });
    }
  });
}
