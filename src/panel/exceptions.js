(() => {
  const apiExceptions =
    window.apiExport || (window.apiExport = typeof browser !== "undefined" ? browser : chrome);
  const textarea = document.getElementById("partial-exceptions");
  if (!textarea) {
    return;
  }

  let saveTimer = null;

  function parseDomains(text) {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const domains = [];
    lines.forEach((line) => {
      const cleaned = line.replace(/;+$/g, "").trim();
      if (!cleaned) {
        return;
      }
      domains.push(cleaned);
    });
    return domains;
  }

  function formatDomains(domains) {
    if (!Array.isArray(domains) || domains.length === 0) {
      return "";
    }
    return domains.map((domain) => `${domain};`).join("\n");
  }

  async function loadExceptions() {
    try {
      const res = await apiExceptions.runtime.sendMessage({ type: "GET_PARTIAL_EXCEPTIONS" });
      if (res && res.ok) {
        textarea.value = formatDomains(res.items || []);
      }
    } catch (error) {
      // ignore load errors
    }
  }

  async function saveExceptions() {
    try {
      const domains = parseDomains(textarea.value);
      await apiExceptions.runtime.sendMessage({
        type: "SET_PARTIAL_EXCEPTIONS",
        items: domains
      });
    } catch (error) {
      // ignore save errors
    }
  }

  function scheduleSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveExceptions();
    }, 400);
  }

  textarea.addEventListener("input", scheduleSave);
  textarea.addEventListener("blur", saveExceptions);

  loadExceptions();
})();
