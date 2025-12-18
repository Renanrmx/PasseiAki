const apiImport = typeof browser !== "undefined" ? browser : chrome;
const importButtons = document.querySelectorAll("[data-import-addresses]");

let hiddenImportInput = null;
let confirmModal = null;
let modalPromise = null;


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
      const container = document.createElement("div");
      container.innerHTML = html;
      applyI18n(container);
      const styleEl = container.querySelector("style");
      if (styleEl) {
        const styleClone = styleEl.cloneNode(true);
        document.head.appendChild(styleClone);
      }
      const invalidOverlay = container.querySelector("#import-invalid-overlay");
      const successOverlay = container.querySelector("#import-success-overlay");
      if (!invalidOverlay || !successOverlay) {
        throw new Error("Invalid import modal");
      }
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
  try {
    const text = await file.text();

    const preview = await apiImport.runtime.sendMessage({
      type: "IMPORT_ADDRESSES",
      content: text,
      preview: true
    });
    if (!preview || preview.ok === false) {
      throw new Error(preview && preview.error ? preview.error : "Import validation failed");
    }

    const validCount = preview.valid || 0;
    const invalidCount = preview.invalid || 0;
    const total = preview.total || validCount + invalidCount;

    if (total === 0 || validCount === 0) {
      alert(t("noValidUrls"));
      return;
    }

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

    const response = await apiImport.runtime.sendMessage({
      type: "IMPORT_ADDRESSES",
      content: text
    });
    if (!response || response.ok === false) {
      throw new Error(response && response.error ? response.error : "Import failed");
    }
    const msg = t("importCompleteWithCount", response.imported || 0);
    await showSuccessModal(msg);
    if (window.loadHistory) {
      window.loadHistory();
    }
  } catch (error) {
    alert(t("importError", error && error.message ? error.message : error));
  } finally {
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
