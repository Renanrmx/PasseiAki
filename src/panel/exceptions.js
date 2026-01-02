(() => {
  const apiExceptions =
    window.apiExport || (window.apiExport = typeof browser !== "undefined" ? browser : chrome);

  function parseDomains(text) {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const domains = [];
    lines.forEach((line) => {
      const cleaned = line.trim();
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
    return domains.map((domain) => String(domain)).join("\n");
  }

  function setupExceptionsTextarea(config) {
    const textarea = document.getElementById(config.id);
    if (!textarea) {
      return;
    }

    let saveTimer = null;

    async function loadExceptions() {
      try {
        const res = await apiExceptions.runtime.sendMessage({ type: config.getType });
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
          type: config.setType,
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
  }

  const configs = [
    { id: "match-exceptions", getType: "GET_MATCH_EXCEPTIONS", setType: "SET_MATCH_EXCEPTIONS" },
    { id: "partial-exceptions", getType: "GET_PARTIAL_EXCEPTIONS", setType: "SET_PARTIAL_EXCEPTIONS" }
  ];

  configs.forEach(setupExceptionsTextarea);
})();
