(() => {
  const apiDanger = typeof browser !== "undefined" ? browser : chrome;
  const MSG = globalThis.AKI_MESSAGE_TYPES;

  const clearBtn = document.getElementById("clear-visits-btn");
  const overlay = document.getElementById("clear-visits-overlay");
  const form = document.getElementById("clear-visits-form");
  const cancelBtn = document.getElementById("clear-visits-cancel");
  const confirmBtn = document.getElementById("clear-visits-confirm");
  const errorEl = document.getElementById("clear-visits-error");

  function showDangerLoading(message) {
    if (typeof window.showPanelLoading === "function") {
      return window.showPanelLoading(message);
    }
    return () => {};
  }

  function openModal() {
    if (!overlay) return;
    if (errorEl) {
      errorEl.textContent = "";
    }
    overlay.classList.add("active");
    if (cancelBtn) {
      cancelBtn.focus();
      setTimeout(() => cancelBtn.focus(), 20);
    }
  }

  function closeModal() {
    if (!overlay) return;
    overlay.classList.remove("active");
  }

  async function clearVisitHistory() {
    if (!confirmBtn) return;
    if (errorEl) {
      errorEl.textContent = "";
    }
    confirmBtn.disabled = true;
    const hideLoading = showDangerLoading(
      typeof t === "function" ? t("loadingClearVisitHistory") : "Deleting access history..."
    );
    try {
      const response = await apiDanger.runtime.sendMessage({
        type: MSG.CLEAR_VISIT_HISTORY
      });
      if (!response || response.ok === false) {
        throw new Error(response && response.error ? response.error : t("clearVisitsFailed"));
      }
      closeModal();
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = error && error.message ? error.message : String(error);
      }
    } finally {
      hideLoading();
      confirmBtn.disabled = false;
    }
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", openModal);
  }

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      closeModal();
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", closeModal);
  }

  if (confirmBtn) {
    confirmBtn.addEventListener("click", clearVisitHistory);
  }

  if (overlay) {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeModal();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay && overlay.classList.contains("active")) {
      closeModal();
    }
  });
})();
