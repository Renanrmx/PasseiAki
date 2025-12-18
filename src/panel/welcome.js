document.addEventListener("DOMContentLoaded", async () => {
  const placeholder = document.getElementById("highlight-placeholder");

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
      if (typeof applyI18n === "function") {
        applyI18n(document);
      }
      const script = document.createElement("script");
      script.src = "colors.js";
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
