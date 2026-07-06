import fs from "node:fs";
import path from "node:path";

const targets = {
  chrome: "manifest.chrome.json",
  firefox: "manifest.firefox.json"
};

const args = process.argv.slice(2);
let target = "firefox";
let distDir = "dist";
const sourceDir = "src";

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--out-dir") {
    distDir = args[index + 1] || distDir;
    index += 1;
  } else if (!arg.startsWith("--")) {
    target = arg;
  }
}

if (!targets[target]) {
  console.error(`Unknown target "${target}". Expected one of: ${Object.keys(targets).join(", ")}`);
  process.exit(1);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.cpSync(sourceDir, distDir, { recursive: true });

["manifest.json", "manifest.chrome.json", "manifest.firefox.json"].forEach((file) => {
  fs.rmSync(path.join(distDir, file), { force: true });
});

fs.copyFileSync(
  path.join(sourceDir, targets[target]),
  path.join(distDir, "manifest.json")
);

console.log(`Prepared ${target} extension in ${distDir}`);
