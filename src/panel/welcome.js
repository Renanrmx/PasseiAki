document.addEventListener("DOMContentLoaded", async () => {
  const placeholder = document.getElementById("highlight-placeholder");
  const backupPlaceholder = document.getElementById("backup-placeholder");

  try {
    const res = await fetch("settings.html");
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const styles = doc.querySelectorAll("style");
    styles.forEach((styleEl) => {
      if (styleEl) {
        document.head.appendChild(styleEl.cloneNode(true));
      }
    });
    const highlightCard = doc.querySelector("#highlight-settings-card");
    if (highlightCard && placeholder) {
      const clone = highlightCard.cloneNode(true);
      placeholder.appendChild(clone);
      const script = document.createElement("script");
      script.src = "colors.js";
      document.body.appendChild(script);
    }

    const backupCard = doc.querySelector("#restore-bkp-btn")?.closest(".card");
    if (backupCard && backupPlaceholder) {
      const clone = backupCard.cloneNode(true);
      const createBtn = clone.querySelector("#create-bkp-btn");
      if (createBtn) {
        createBtn.remove();
      }
      backupPlaceholder.appendChild(clone);
    }

    const passwordOverlay = doc.querySelector("#password-overlay");
    if (passwordOverlay) {
      document.body.appendChild(passwordOverlay.cloneNode(true));
    }

    if (typeof applyI18n === "function") {
      applyI18n(document);
    }

    if (backupCard) {
      const script = document.createElement("script");
      script.src = "backup.js";
      document.body.appendChild(script);
    }
  } catch (error) {
    // ignore failures; welcome text still visible
  }

  const closeBtn = document.getElementById("welcome-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      if (window && typeof window.close === "function") {
        window.close();
      }
    });
  }
});
