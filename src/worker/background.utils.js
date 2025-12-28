const ALLOWED_PROTOCOLS = typeof SUPPORTED_PROTOCOLS !== "undefined"
  ? SUPPORTED_PROTOCOLS
  : new Set(["http:", "https:"]);

function i18n(key, substitutions) {
  if (typeof api !== "undefined" && api?.i18n?.getMessage) {
    const msg = api.i18n.getMessage(key, substitutions);
    if (msg) return msg;
  }
  if (!key) return "";
  if (Array.isArray(substitutions) && substitutions.length) {
    return `${key} ${substitutions.join(" ")}`;
  }
  return key;
}

function decodeComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function normalizeParams(paramString) {
  if (!paramString) {
    return { normalized: "", entries: [] };
  }

  const params = new URLSearchParams(paramString.replace(/^\?/, ""));
  const map = new Map();

  for (const [key, value] of params) {
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(value);
  }

  const sorted = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, values]) =>
      values
        .sort()
        .map((v) => `${key}=${v}`)
    );

  return {
    normalized: sorted.join("&"),
    entries: sorted
  };
}

function normalizeUrlParts(urlString) {
  try {
    const url = new URL(urlString);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      return null;
    }

    const hostDecoded = decodeComponentSafe(url.host.toLowerCase());
    const rawPath = decodeComponentSafe(url.pathname.toLowerCase() || "/");
    // normalize by removing trailing slashes (except root) to avoid /foo and /foo/ counting as different
    let pathDecoded = rawPath.replace(/\/+$/, "");
    if (pathDecoded === "") {
      pathDecoded = "/";
    }
    const params = normalizeParams(url.search);
    return {
      host: hostDecoded,
      path: pathDecoded,
      query: params.normalized,
      queryEntries: params.entries,
      fragment: url.hash.replace(/^#/, "")
    };
  } catch (error) {
    return null;
  }
}

function buildAddressFromRecord(item) {
  const host = item.host || "";
  const path = item.path || "";
  const query = item.query ? `?${item.query}` : "";
  const fragment = item.fragment ? `#${item.fragment}` : "";
  return `${host}${path}${query}${fragment}`;
}

async function buildDownloadUrl(blob, fallbackMime) {
  const urlFactory =
    (typeof self !== "undefined" &&
      self.URL &&
      typeof self.URL.createObjectURL === "function" &&
      self.URL) ||
    (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && URL) ||
    (typeof webkitURL !== "undefined" &&
      typeof webkitURL.createObjectURL === "function" &&
      webkitURL);

  if (urlFactory) {
    const objectUrl = urlFactory.createObjectURL(blob);
    return { url: objectUrl, revoke: () => urlFactory.revokeObjectURL(objectUrl) };
  }

  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const mime = blob.type || fallbackMime || "application/octet-stream";
  return { url: `data:${mime};base64,${base64}`, revoke: null };
}
