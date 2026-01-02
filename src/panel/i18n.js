const apiI18n = typeof browser !== "undefined" ? browser : chrome;

function t(key, substitutions) {
  if (apiI18n?.i18n?.getMessage) {
    const msg = apiI18n.i18n.getMessage(key, substitutions);
    if (msg) return msg;
  }
  if (!key) return "";
  if (Array.isArray(substitutions) && substitutions.length) {
    return `${key} ${substitutions.join(" ")}`;
  }
  return key;
}

function applyI18n(root = document) {
  const lang = apiI18n?.i18n?.getUILanguage?.();
  if (lang && root?.documentElement) {
    root.documentElement.lang = lang;
  }
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const targetAttr = el.getAttribute("data-i18n-attr");
    const message = t(key);
    if (!message) return;
    if (targetAttr) {
      targetAttr
        .split(",")
        .map((attr) => attr.trim())
        .filter(Boolean)
        .forEach((attr) => {
          el.setAttribute(attr, message);
        });
    } else if (el.tagName === "INPUT" && el.type === "password") {
      el.setAttribute("placeholder", message);
    } else {
      el.textContent = message;
    }
  });
}

window.t = t;
window.applyI18n = applyI18n;
