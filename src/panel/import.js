const apiImport = typeof browser !== "undefined" ? browser : chrome;
const importMessages = globalThis.AKI_MESSAGE_TYPES;
const importButtons = document.querySelectorAll("[data-import-addresses]");

let hiddenImportInput = null;
let confirmModal = null;
let modalPromise = null;

function showImportLoading(message) {
  if (typeof window.showPanelLoading === "function") {
    return window.showPanelLoading(message);
  }
  return () => {};
}

function getImportLoadingMessage(key, fallback) {
  if (typeof window.getPanelLoadingMessage === "function") {
    return window.getPanelLoadingMessage(key, fallback);
  }
  return fallback;
}

function ensureImportInput() {
  if (hiddenImportInput) return hiddenImportInput;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,text/plain";
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", onImportFileSelected);
  hiddenImportInput = input;
  return input;
}

async function ensureConfirmModal() {
  if (confirmModal) return confirmModal;
  if (!modalPromise) {
    modalPromise = (async () => {
      const url = apiImport.runtime.getURL("panel/import-modal.html");
      const res = await fetch(url);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const styleEl = doc.querySelector("style");
      if (styleEl) {
        const styleClone = styleEl.cloneNode(true);
        document.head.appendChild(styleClone);
      }
      const invalidOverlay = doc.querySelector("#import-invalid-overlay");
      const successOverlay = doc.querySelector("#import-success-overlay");
      if (!invalidOverlay || !successOverlay) {
        throw new Error(t("invalidImportModal"));
      }
      applyI18n(invalidOverlay);
      applyI18n(successOverlay);
      document.body.appendChild(invalidOverlay);
      document.body.appendChild(successOverlay);
      const cancelBtn = invalidOverlay.querySelector("[data-import-cancel]");
      const proceedBtn = invalidOverlay.querySelector("[data-import-confirm]");
      const successText = successOverlay.querySelector("#import-success-text");
      const successClose = successOverlay.querySelector("[data-import-success-close]");
      confirmModal = {
        overlay: invalidOverlay,
        cancelBtn,
        proceedBtn,
        successOverlay,
        successText,
        successClose
      };
      return confirmModal;
    })();
  }
  return modalPromise;
}

async function showInvalidModal() {
  const modal = await ensureConfirmModal();
  return new Promise((resolve) => {
    modal.overlay.style.display = "flex";
    modal.cancelBtn.blur();
    modal.proceedBtn.blur();
    const cleanup = (result) => {
      modal.overlay.style.display = "none";
      modal.cancelBtn.onclick = null;
      modal.proceedBtn.onclick = null;
      resolve(result);
    };
    modal.cancelBtn.onclick = () => cleanup(false);
    modal.proceedBtn.onclick = () => cleanup(true);
  });
}

async function showSuccessModal(message) {
  const modal = await ensureConfirmModal();
  return new Promise((resolve) => {
    if (modal.successText) {
      modal.successText.textContent = message;
    }
    modal.successOverlay.style.display = "flex";
    modal.successClose.blur();
    const cleanup = () => {
      modal.successOverlay.style.display = "none";
      modal.successClose.onclick = null;
      resolve();
    };
    modal.successClose.onclick = cleanup;
  });
}

async function onImportFileSelected(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;
  let hideLoading = showImportLoading(getImportLoadingMessage("loadingImportAddresses", "Importing addresses..."));
  try {
    const text = await file.text();

    const preview = await apiImport.runtime.sendMessage({
      type: importMessages.IMPORT_ADDRESSES,
      content: text,
      preview: true
    });
    if (!preview || preview.ok === false) {
      throw new Error(preview && preview.error ? preview.error : t("importValidationFailed"));
    }

    const validCount = preview.valid || 0;
    const invalidCount = preview.invalid || 0;
    const total = preview.total || validCount + invalidCount;

    if (total === 0 || validCount === 0) {
      hideLoading();
      hideLoading = null;
      alert(t("noValidUrls"));
      return;
    }

    hideLoading();
    hideLoading = null;

    if (invalidCount > 0) {
      const modal = await ensureConfirmModal();
      if (modal && modal.overlay) {
        const textEl = modal.overlay.querySelector("#import-modal-text");
        if (textEl) {
          textEl.textContent = t("importInvalidWithCount", invalidCount);
        }
      }
      const proceed = await showInvalidModal();
      if (!proceed) return;
    }

    hideLoading = showImportLoading(getImportLoadingMessage("loadingImportAddresses", "Importing addresses..."));
    const response = await apiImport.runtime.sendMessage({
      type: importMessages.IMPORT_ADDRESSES,
      content: text
    });
    if (!response || response.ok === false) {
      throw new Error(response && response.error ? response.error : t("importFailed"));
    }
    hideLoading();
    hideLoading = null;
    const msg = t("importCompleteWithCount", response.imported || 0);
    await showSuccessModal(msg);
    if (window.loadHistory) {
      window.loadHistory();
    }
  } catch (error) {
    if (hideLoading) {
      hideLoading();
      hideLoading = null;
    }
    alert(t("importError", error && error.message ? error.message : error));
  } finally {
    if (hideLoading) {
      hideLoading();
    }
    input.value = "";
  }
}

if (importButtons && importButtons.length) {
  importButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = ensureImportInput();
      input.click();
    });
  });
}
