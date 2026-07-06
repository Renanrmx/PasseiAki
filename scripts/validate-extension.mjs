import fs from "node:fs";
import path from "node:path";

const targets = {
  chrome: {
    manifest: "manifest.chrome.json",
    version: 3
  },
  firefox: {
    manifest: "manifest.firefox.json",
    version: 2
  }
};

const target = process.argv[2] || "chrome";
const config = targets[target];

if (!config) {
  console.error(`Unknown target "${target}". Expected one of: ${Object.keys(targets).join(", ")}`);
  process.exit(1);
}

const sourceDir = "src";
const manifestPath = path.join(sourceDir, config.manifest);
const manifest = readJson(manifestPath);
const errors = [];

if (manifest.manifest_version !== config.version) {
  errors.push(`${config.manifest}: expected manifest_version ${config.version}`);
}

checkLocale(manifest);
checkIcons(manifest.icons, "icons");
checkAction(manifest);
checkBackground(manifest);
checkContentScripts(manifest);

if (errors.length) {
  errors.forEach((error) => console.error(error));
  process.exit(1);
}

console.log(`Validated ${target} manifest references`);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`${file}: ${error.message}`);
    process.exit(1);
  }
}

function checkLocale(currentManifest) {
  if (!currentManifest.default_locale) {
    return;
  }
  const localePath = path.join(sourceDir, "_locales", currentManifest.default_locale, "messages.json");
  if (!fs.existsSync(localePath)) {
    errors.push(`${currentManifest.default_locale}: missing default locale file`);
  }
}

function checkIcons(iconMap, label) {
  if (!iconMap || typeof iconMap !== "object") {
    return;
  }
  Object.values(iconMap).forEach((file) => checkFile(file, label));
}

function checkAction(currentManifest) {
  const action = currentManifest.action || currentManifest.browser_action;
  if (!action) {
    errors.push(`${config.manifest}: missing action/browser_action`);
    return;
  }
  if (action.default_popup) {
    checkFile(action.default_popup, "default_popup");
  }
  checkIcons(action.default_icon, "default_icon");
}

function checkBackground(currentManifest) {
  const background = currentManifest.background;
  if (!background) {
    errors.push(`${config.manifest}: missing background`);
    return;
  }

  if (config.version === 3) {
    checkFile(background.service_worker, "background.service_worker");
    return;
  }

  if (!Array.isArray(background.scripts) || !background.scripts.length) {
    errors.push(`${config.manifest}: missing background.scripts`);
    return;
  }
  background.scripts.forEach((file) => checkFile(file, "background.scripts"));
}

function checkContentScripts(currentManifest) {
  (currentManifest.content_scripts || []).forEach((entry, index) => {
    (entry.js || []).forEach((file) => checkFile(file, `content_scripts[${index}].js`));
    (entry.css || []).forEach((file) => checkFile(file, `content_scripts[${index}].css`));
  });
}

function checkFile(file, label) {
  if (!file) {
    errors.push(`${config.manifest}: missing ${label} path`);
    return;
  }
  if (!fs.existsSync(path.join(sourceDir, file))) {
    errors.push(`${config.manifest}: missing ${label} file ${file}`);
  }
}
