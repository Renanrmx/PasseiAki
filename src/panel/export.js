(() => {
  const apiExport = window.apiExport || (window.apiExport = (typeof browser !== "undefined" ? browser : chrome));
  const exportButtons = document.querySelectorAll("[data-export-addresses-btn]");
  let exportModal = null;
  let exportModalPromise = null;


  async function ensureExportModal() {
    if (exportModal) return exportModal;
    if (!exportModalPromise) {
      exportModalPromise = (async () => {
        const url = apiExport.runtime.getURL("panel/export-modal.html");
        const res = await fetch(url);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const styleEl = doc.querySelector("style");
        if (styleEl) {
          const styleClone = styleEl.cloneNode(true);
          document.head.appendChild(styleClone);
        }
        const overlay = doc.querySelector("#export-choice-overlay");
        if (!overlay) {
          throw new Error("Invalid export modal");
        }
        applyI18n(overlay);
        document.body.appendChild(overlay);
        const cancelBtn = overlay.querySelector("[data-export-cancel]");
        const csvBtn = overlay.querySelector("[data-export-table]");
        const txtBtn = overlay.querySelector("[data-export-text]");
        const pagesCheckbox = overlay.querySelector("[data-export-pages]");
        const downloadsCheckbox = overlay.querySelector("[data-export-downloads]");
        const validation = overlay.querySelector("[data-export-validation]");
        const clearValidation = () => {
          if (validation) validation.style.display = "none";
        };

        if (pagesCheckbox) pagesCheckbox.addEventListener("change", clearValidation);
        if (downloadsCheckbox) downloadsCheckbox.addEventListener("change", clearValidation);
        
        exportModal = {
          overlay,
          cancelBtn,
          csvBtn,
          txtBtn,
          pagesCheckbox,
          downloadsCheckbox,
          validation
        };
        return exportModal;
      })();
    }
    return exportModalPromise;
  }

  async function showExportModal() {
    const modal = await ensureExportModal();
    return new Promise((resolve) => {
      modal.overlay.style.display = "flex";
      if (modal.pagesCheckbox) modal.pagesCheckbox.checked = true;
      if (modal.downloadsCheckbox) modal.downloadsCheckbox.checked = false;
      if (modal.validation) modal.validation.style.display = "none";
      
      [modal.cancelBtn, modal.csvBtn, modal.txtBtn].forEach((btn) => btn && btn.blur());
      const cleanup = (result) => {
        modal.overlay.style.display = "none";
        if (modal.cancelBtn) modal.cancelBtn.onclick = null;
        if (modal.csvBtn) modal.csvBtn.onclick = null;
        if (modal.txtBtn) modal.txtBtn.onclick = null;
        resolve(result);
      };
      if (modal.cancelBtn) modal.cancelBtn.onclick = () => cleanup(null);
      if (modal.csvBtn) {
        modal.csvBtn.onclick = () =>
          handleChoice("csv", modal, cleanup);
      }
      if (modal.txtBtn) {
        modal.txtBtn.onclick = () =>
          handleChoice("txt", modal, cleanup);
      }
    });
  }

  function handleChoice(format, modal, cleanup) {
    const includePages = modal.pagesCheckbox ? modal.pagesCheckbox.checked : true;
    const includeDownloads = modal.downloadsCheckbox ? modal.downloadsCheckbox.checked : false;
    if (!includePages && !includeDownloads) {
      if (modal.validation) modal.validation.style.display = "block";
      return;
    }
    cleanup({
      format,
      includePages,
      includeDownloads
    });
  }


  async function exportAddresses() {
    try {
      const choice = await showExportModal();
      if (!choice) return;
      const type = choice.format === "txt" ? "EXPORT_VISITS_TXT" : "EXPORT_VISITS_CSV";

      const response = await apiExport.runtime.sendMessage({
        type,
        includePages: choice.includePages,
        includeDownloads: choice.includeDownloads
      });
      if (!response || response.ok === false) {
        throw new Error(response && response.error ? response.error : "Export failed");
      }
      if (response.exported === 0) {
        alert(t("nothingToExport"));
      }
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      if (typeof msg === "string" && msg.toLowerCase().includes("canceled by the user")) {
        return;
      }
      alert(t("exportError", msg));
    }
  }

  if (exportButtons && exportButtons.length) {
    exportButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        exportAddresses();
      });
    });
  }
})();
