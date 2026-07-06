(() => {
  const STYLE_ID = "panel-loading-style";
  let overlay = null;
  let messageEl = null;
  let activeCount = 0;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .panel-loading-overlay {
        position: fixed;
        inset: 0;
        z-index: 5000;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.58);
      }
      .panel-loading-overlay.active {
        display: flex;
      }
      .panel-loading-box {
        width: min(280px, calc(100vw - 32px));
        padding: 18px 16px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: #0f1826;
        color: #e8f1f2;
        box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5);
        box-sizing: border-box;
        text-align: center;
      }
      .panel-loading-spinner {
        width: 34px;
        height: 34px;
        margin: 0 auto 12px;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.18);
        border-top-color: #7ecdc4;
        animation: panel-loading-spin 0.85s linear infinite;
      }
      .panel-loading-message {
        font-size: 13px;
        line-height: 1.35;
        color: #e8f1f2;
      }
      @keyframes panel-loading-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    ensureStyle();
    overlay = document.createElement("div");
    overlay.className = "panel-loading-overlay";
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-busy", "true");
    const box = document.createElement("div");
    box.className = "panel-loading-box";
    box.setAttribute("role", "status");
    const spinner = document.createElement("div");
    spinner.className = "panel-loading-spinner";
    spinner.setAttribute("aria-hidden", "true");
    messageEl = document.createElement("div");
    messageEl.className = "panel-loading-message";
    box.appendChild(spinner);
    box.appendChild(messageEl);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return overlay;
  }

  function getPanelLoadingMessage(key, fallback) {
    if (typeof t === "function") {
      const translated = t(key);
      if (translated && translated !== key) {
        return translated;
      }
    }
    return fallback || (typeof t === "function" ? t("loadingProcessing") : "Processing...");
  }

  function showPanelLoading(message) {
    const loadingOverlay = ensureOverlay();
    activeCount += 1;
    if (messageEl) {
      messageEl.textContent = message || getPanelLoadingMessage("loadingProcessing", "Processing...");
    }
    loadingOverlay.classList.add("active");

    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      activeCount = Math.max(0, activeCount - 1);
      if (activeCount === 0) {
        loadingOverlay.classList.remove("active");
      }
    };
  }

  window.getPanelLoadingMessage = getPanelLoadingMessage;
  window.showPanelLoading = showPanelLoading;
})();
