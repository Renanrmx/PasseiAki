const api = typeof browser !== "undefined" ? browser : chrome;
const MSG = globalThis.AKI_MESSAGE_TYPES;

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);
const VISITED_TEXT_CLASS = "aki-visited-text";
const PARTIAL_TEXT_CLASS = "aki-partial-text";
const VISITED_BORDER_CLASS = "aki-visited-border";
const PARTIAL_BORDER_CLASS = "aki-partial-border";
const STYLE_ID = "aki-style";
const SCAN_DEBOUNCE_MS = 400;

let scanTimer = null;
let pendingFullScan = false;
const pendingAnchors = new Set();
let currentColors = {
  matchHexColor: null,
  partialHexColor: null,
  matchTextEnabled: true,
  partialTextEnabled: true,
  matchBorderEnabled: true,
  partialBorderEnabled: true
};
let pageExceptionFlags = {
  match: false,
  partial: false,
  ready: false
};
let pageExceptionPromise = null;


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
    : "";

  const partialTextRule = partialColor
    ? `
    a.${PARTIAL_TEXT_CLASS} {
      color: ${partialColor} !important;
      text-decoration-color: ${partialColor} !important;
    }`
    : "";

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

  if (options.refreshMarked) {
    refreshMarkedAnchors();
  }
}

function addAnchorToCollection(anchor, urlToAnchors) {
  if (!anchor || !anchor.isConnected) {
    return;
  }
  if (!anchor.matches || !anchor.matches("a[href]")) {
    if (anchor.dataset && anchor.dataset.akiVisited) {
      clearAnchorMark(anchor);
    }
    return;
  }
  try {
    const url = new URL(anchor.href, window.location.href);
    if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
      return;
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

function queueAnchor(anchor) {
  if (!anchor || !anchor.matches || !anchor.matches("a")) {
    return false;
  }
  pendingAnchors.add(anchor);
  return true;
}

function queueAnchorsFromNode(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  let queued = false;
  if (node.matches && node.matches("a")) {
    queued = queueAnchor(node) || queued;
  }
  if (node.querySelectorAll) {
    node.querySelectorAll("a").forEach((anchor) => {
      queued = queueAnchor(anchor) || queued;
    });
  }
  return queued;
}

function collectLinks(options = {}) {
  const urlToAnchors = new Map();
  const anchors = options.full
    ? Array.from(document.querySelectorAll("a[href]"))
    : Array.isArray(options.anchors)
      ? options.anchors
      : [];

  for (const anchor of anchors) {
    addAnchorToCollection(anchor, urlToAnchors);
  }

  return urlToAnchors;
}

function refreshMarkedAnchors() {
  const anchors = document.querySelectorAll("a[data-aki-visited]");
  anchors.forEach((anchor) => {
    const isPartial = anchor.dataset.akiVisited === "partial";
    paintAnchor(anchor, isPartial);
  });
}

function clearAnchorMark(anchor) {
  anchor.classList.remove(
    VISITED_TEXT_CLASS,
    PARTIAL_TEXT_CLASS,
    VISITED_BORDER_CLASS,
    PARTIAL_BORDER_CLASS
  );
  anchor.style.removeProperty("color");
  anchor.style.removeProperty("text-decoration-color");
  anchor.style.outline = "";
  anchor.style.outlineOffset = "";
  anchor.style.borderRadius = "";
  delete anchor.dataset.akiVisited;
}

function paintAnchor(anchor, isPartial) {
  anchor.classList.remove(
    VISITED_TEXT_CLASS,
    PARTIAL_TEXT_CLASS,
    VISITED_BORDER_CLASS,
    PARTIAL_BORDER_CLASS
  );
  anchor.style.removeProperty("color");
  anchor.style.removeProperty("text-decoration-color");
  anchor.style.outline = "";
  anchor.style.outlineOffset = "";
  anchor.style.borderRadius = "";

  if (isPartial) {
    anchor.classList.add(PARTIAL_TEXT_CLASS, PARTIAL_BORDER_CLASS);
    if (currentColors.partialTextEnabled !== false && currentColors.partialHexColor) {
      anchor.style.setProperty("color", currentColors.partialHexColor, "important");
      anchor.style.setProperty("text-decoration-color", currentColors.partialHexColor, "important");
    }
    if (currentColors.partialBorderEnabled !== false && currentColors.partialHexColor) {
      anchor.style.setProperty("outline", `2px solid ${currentColors.partialHexColor}`, "important");
      anchor.style.setProperty("outline-offset", "0px", "important");
      anchor.style.setProperty("border-radius", "3px", "important");
    }
    anchor.dataset.akiVisited = "partial";
  } else {
    anchor.classList.add(VISITED_TEXT_CLASS, VISITED_BORDER_CLASS);
    if (currentColors.matchTextEnabled !== false && currentColors.matchHexColor) {
      anchor.style.setProperty("color", currentColors.matchHexColor, "important");
      anchor.style.setProperty("text-decoration-color", currentColors.matchHexColor, "important");
    }
    if (currentColors.matchBorderEnabled !== false && currentColors.matchHexColor) {
      anchor.style.setProperty("outline", `2px solid ${currentColors.matchHexColor}`, "important");
      anchor.style.setProperty("outline-offset", "0px", "important");
      anchor.style.setProperty("border-radius", "3px", "important");
    }
    anchor.dataset.akiVisited = "true";
  }
}

async function requestVisited(urlToAnchors) {
  const linksPayload = Array.from(urlToAnchors.keys()).map((href) => ({
    href,
    token: href
  }));

  if (linksPayload.length === 0) {
    return [];
  }

  try {
    const response = await api.runtime.sendMessage({
      type: MSG.CHECK_VISITED_LINKS,
      links: linksPayload,
      skipFull: pageExceptionFlags.match === true,
      skipPartial: pageExceptionFlags.partial === true
    });
    return response && Array.isArray(response.visitedLinks) ? response.visitedLinks : [];
  } catch (error) {
    // runtime or permission issue; fail silently
    return [];
  }
}

function scheduleScan(options = {}) {
  if (options.full) {
    pendingFullScan = true;
  }
  if (scanTimer) {
    return;
  }
  scanTimer = setTimeout(() => {
    scanTimer = null;
    const shouldFullScan = pendingFullScan;
    const anchors = Array.from(pendingAnchors);
    pendingFullScan = false;
    pendingAnchors.clear();
    scanAndMark({ full: shouldFullScan, anchors }).catch(() => {});
  }, SCAN_DEBOUNCE_MS);
}

async function refreshPageExceptionFlags(force = false) {
  if (!api?.runtime?.sendMessage) {
    pageExceptionFlags = { match: false, partial: false, ready: true };
    return pageExceptionFlags;
  }
  if (pageExceptionFlags.ready && !force) {
    return pageExceptionFlags;
  }
  if (pageExceptionPromise) {
    return pageExceptionPromise;
  }
  pageExceptionPromise = (async () => {
    try {
      const response = await api.runtime.sendMessage({
        type: MSG.GET_PAGE_EXCEPTION_FLAGS,
        url: window.location.href
      });
      pageExceptionFlags = {
        match: response && response.matchException === true,
        partial: response && response.partialException === true,
        ready: true
      };
    } catch (error) {
      pageExceptionFlags = { match: false, partial: false, ready: true };
    }
    return pageExceptionFlags;
  })();

  try {
    return await pageExceptionPromise;
  } finally {
    pageExceptionPromise = null;
  }
}

async function scanAndMark(options = {}) {
  await refreshPageExceptionFlags();
  const urlToAnchors = collectLinks({
    full: options.full !== false,
    anchors: options.anchors || []
  });
  if (pageExceptionFlags.match && pageExceptionFlags.partial) {
    urlToAnchors.forEach((anchors) => {
      anchors.forEach((anchor) => {
        if (anchor.dataset.akiVisited) {
          clearAnchorMark(anchor);
        }
      });
    });
    return;
  }
  const visitedLinks = await requestVisited(urlToAnchors);
  const visitedByToken = new Map(
    visitedLinks.map((item) => [item.token, item.state])
  );
  urlToAnchors.forEach((anchors, token) => {
    const state = visitedByToken.get(token);
    anchors.forEach((anchor) => {
      if (!state) {
        if (anchor.dataset.akiVisited) {
          clearAnchorMark(anchor);
        }
        return;
      }
      const isPartial = state === "partial";
      const expectedState = isPartial ? "partial" : "true";
      if (anchor.dataset.akiVisited === expectedState) {
        return;
      }
      paintAnchor(anchor, isPartial);
    });
  });
}

function startObservers() {
  const observer = new MutationObserver((mutations) => {
    let queued = false;
    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          queued = queueAnchorsFromNode(node) || queued;
        });
      } else if (mutation.type === "attributes") {
        queued = queueAnchor(mutation.target) || queued;
      }
    });
    if (queued) scheduleScan({ full: false });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"]
  });
}

async function handleAnchorActivate(event) {
  if (event.type === "auxclick") {
    // allow only middle-click to trigger marking
    if (event.button !== 1) return;
  } else {
    // for regular clicks, ignore non-primary buttons
    if (typeof event.button === "number" && event.button !== 0) return;
  }
  const anchor = event.target.closest && event.target.closest("a[href]");
  if (!anchor) return;
  try {
    const url = new URL(anchor.href, window.location.href);
    if (!SUPPORTED_PROTOCOLS.has(url.protocol)) return;
    if (!pageExceptionFlags.ready) {
      await refreshPageExceptionFlags();
    }
    if (pageExceptionFlags.match) return;
    paintAnchor(anchor, false);
  } catch (error) {
    // ignore malformed href
  }
}

async function init() {
  if (!SUPPORTED_PROTOCOLS.has(window.location.protocol)) {
    return;
  }
  try {
    api.runtime.sendMessage({ type: MSG.GET_LINK_COLORS }).then((res) => {
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
  await refreshPageExceptionFlags(true);
  scanAndMark({ full: true }).catch(() => {});
  startObservers();
  document.addEventListener("click", handleAnchorActivate, true);
  document.addEventListener("auxclick", handleAnchorActivate, true);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

if (api.runtime && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((message) => {
    if (message && message.type === MSG.LINK_COLORS_UPDATED && message.colors) {
      applyColors(message.colors, { refreshMarked: true });
    }
    if (message && message.type === MSG.REFRESH_HIGHLIGHT) {
      refreshPageExceptionFlags(true).then(() => {
        scanAndMark({ full: true }).catch(() => {});
      });
    }
  });
}
