(() => {
  const apiExceptions =
    window.apiExport || (window.apiExport = typeof browser !== "undefined" ? browser : chrome);
  const MSG = globalThis.AKI_MESSAGE_TYPES;
  const statusEl = document.getElementById("exceptions-status");

  function setStatus(message, type) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.remove("error", "success");
    if (type) {
      statusEl.classList.add(type);
    }
  }

  function setupExceptionsEditor(config) {
    const editor = document.getElementById(config.id);
    if (!editor) {
      return;
    }

    let saveTimer = null;

    async function loadExceptions() {
      const closeLoading =
        typeof showPanelLoading === "function"
          ? showPanelLoading(window.getPanelLoadingMessage("loadingExceptions", "Loading exceptions..."))
          : null;
      try {
        const res = await apiExceptions.runtime.sendMessage({ type: config.getType });
        if (res && res.ok) {
          window.AkiDomainTags.setItems(editor, "exception", res.items || [], scheduleSave);
        }
        setStatus("");
      } catch (error) {
        setStatus(error && error.message ? error.message : t("exceptionsLoadFailed"), "error");
      } finally {
        if (closeLoading) closeLoading();
      }
    }

    async function saveExceptions() {
      try {
        window.AkiDomainTags.commitEditor(editor, "exception");
        const items = window.AkiDomainTags.getItems(editor, "exception");
        const response = await apiExceptions.runtime.sendMessage({
          type: config.setType,
          items
        });
        if (response && response.ok && Array.isArray(response.items)) {
          window.AkiDomainTags.setItems(editor, "exception", response.items, scheduleSave);
        }
        setStatus(t("exceptionsSaved"), "success");
      } catch (error) {
        setStatus(error && error.message ? error.message : t("exceptionsSaveFailed"), "error");
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

    window.AkiDomainTags.setupEditor(editor, {
      prefix: "exception",
      onChange: scheduleSave
    });

    loadExceptions();
  }

  const configs = [
    { id: "match-exceptions", getType: MSG.GET_MATCH_EXCEPTIONS, setType: MSG.SET_MATCH_EXCEPTIONS },
    { id: "partial-exceptions", getType: MSG.GET_PARTIAL_EXCEPTIONS, setType: MSG.SET_PARTIAL_EXCEPTIONS }
  ];

  configs.forEach(setupExceptionsEditor);
})();
