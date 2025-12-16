const ALLOWED_PROTOCOLS = typeof SUPPORTED_PROTOCOLS !== "undefined"
  ? SUPPORTED_PROTOCOLS
  : new Set(["http:", "https:"]);

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
    // normaliza removendo barras finais (exceto raiz) para evitar /foo e /foo/ contarem como diferentes
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
