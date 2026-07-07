(function registerDomainHelpers(root) {
  function cleanDomainHost(host) {
    let text = String(host || "").trim().toLowerCase();
    if (!text) {
      return "";
    }

    text = text.replace(/\.$/, "");
    text = text.replace(/:\d+$/, "");
    text = text.replace(/[^a-z0-9.-]/g, "");
    text = text.replace(/\.{2,}/g, ".");
    text = text.replace(/^\.+|\.+$/g, "");
    text = text.replace(/^-+/, "");
    text = text.replace(/-+$/, "");
    return text;
  }

  function normalizeHostIdentity(host) {
    if (!host) {
      return "";
    }
    const normalized = String(host).trim().toLowerCase().replace(/\.$/, "");
    return normalized.startsWith("www.") ? normalized.slice(4) : normalized;
  }

  function extractDomainInput(value) {
    let text = String(value || "").trim();
    if (!text) {
      return "";
    }

    try {
      text = new URL(text.includes("://") ? text : `https://${text}`).hostname;
    } catch (error) {
      text = text.replace(/^[a-z][a-z\d+.-]*:\/\//i, "");
      text = text.split(/[/?#]/)[0];
    }

    return cleanDomainHost(text);
  }

  function normalizeDomainInput(value) {
    return normalizeHostIdentity(extractDomainInput(value));
  }

  function sanitizeTypedDomainInput(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, "");
  }

  root.AkiDomains = {
    cleanDomainHost,
    extractDomainInput,
    normalizeDomainInput,
    normalizeHostIdentity,
    sanitizeTypedDomainInput
  };
})(globalThis);
