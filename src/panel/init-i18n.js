document.addEventListener("DOMContentLoaded", () => {
  if (typeof applyI18n === "function") {
    applyI18n();
  }
  const titleEl = document.querySelector("title[data-i18n]");
  if (titleEl && typeof t === "function") {
    const key = titleEl.getAttribute("data-i18n");
    const translated = t(key);
    if (translated) {
      titleEl.textContent = translated;
      document.title = translated;
    }
  }
});
