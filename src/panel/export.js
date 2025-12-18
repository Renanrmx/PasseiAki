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
        const container = document.createElement("div");
        container.innerHTML = html;
        applyI18n(container);
        const styleEl = container.querySelector("style");
        if (styleEl) {
          const styleClone = styleEl.cloneNode(true);
          document.head.appendChild(styleClone);
        }
        const overlay = container.querySelector("#export-choice-overlay");
        if (!overlay) {
          throw new Error("Invalid export modal");
        }
        document.body.appendChild(overlay);
        const cancelBtn = overlay.querySelector("[data-export-cancel]");
        const csvBtn = overlay.querySelector("[data-export-table]");
        const txtBtn = overlay.querySelector("[data-export-text]");
        exportModal = { overlay, cancelBtn, csvBtn, txtBtn };
        return exportModal;
      })();
    }
    return exportModalPromise;
  }

  async function showExportModal() {
    const modal = await ensureExportModal();
    return new Promise((resolve) => {
      modal.overlay.style.display = "flex";
      [modal.cancelBtn, modal.csvBtn, modal.txtBtn].forEach((btn) => btn && btn.blur());
      const cleanup = (result) => {
        modal.overlay.style.display = "none";
        if (modal.cancelBtn) modal.cancelBtn.onclick = null;
        if (modal.csvBtn) modal.csvBtn.onclick = null;
        if (modal.txtBtn) modal.txtBtn.onclick = null;
        resolve(result);
      };
      if (modal.cancelBtn) modal.cancelBtn.onclick = () => cleanup(null);
      if (modal.csvBtn) modal.csvBtn.onclick = () => cleanup("csv");
      if (modal.txtBtn) modal.txtBtn.onclick = () => cleanup("txt");
    });
  }


  async function exportAddresses() {
    try {
      const choice = await showExportModal();
      if (!choice) return;
      const type = choice === "txt" ? "EXPORT_VISITS_TXT" : "EXPORT_VISITS_CSV";

      const response = await apiExport.runtime.sendMessage({ type });
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
