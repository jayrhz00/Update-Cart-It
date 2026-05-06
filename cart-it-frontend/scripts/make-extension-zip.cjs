/**
 * Packs ../extension into browser-specific zips for extension-install.html.
 * Runs automatically before `react-scripts build` (see package.json prebuild).
 */
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const frontendRoot = path.join(__dirname, "..");
const repoRoot = path.join(frontendRoot, "..");
const extDir = path.join(repoRoot, "extension");
const outChromiumPath = path.join(frontendRoot, "public", "cart-it-extension-chromium.zip");
const outFirefoxPath = path.join(frontendRoot, "public", "cart-it-extension-firefox.zip");
const outLegacyPath = path.join(frontendRoot, "public", "cart-it-extension.zip");

function collectFiles(dir, base = dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      collectFiles(full, base, acc);
    } else {
      // Never include pre-zipped artifacts in store upload packages.
      if (/\.zip$/i.test(name)) continue;
      acc.push({ full, rel: path.relative(base, full).replace(/\\/g, "/") });
    }
  }
  return acc;
}

async function main() {
  if (!fs.existsSync(extDir)) {
    console.warn("make-extension-zip: no extension folder at", extDir);
    process.exit(0);
  }
  const files = collectFiles(extDir);
  if (files.length === 0) {
    console.warn("make-extension-zip: extension folder empty");
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(outChromiumPath), { recursive: true });

  // Chromium package (Chrome + Edge): use manifest.json and exclude firefox-only manifest file.
  const chromiumOutput = fs.createWriteStream(outChromiumPath);
  const chromiumArchive = archiver("zip", { zlib: { level: 9 } });
  const chromiumDone = new Promise((resolve, reject) => {
    chromiumOutput.on("close", resolve);
    chromiumArchive.on("error", reject);
  });
  chromiumArchive.pipe(chromiumOutput);
  for (const { full, rel } of files) {
    if (rel === "manifest.firefox.json") continue;
    chromiumArchive.file(full, { name: rel });
  }
  await chromiumArchive.finalize();
  await chromiumDone;

  // Firefox package: map manifest.firefox.json -> manifest.json.
  const firefoxManifestPath = path.join(extDir, "manifest.firefox.json");
  const firefoxManifest = fs.readFileSync(firefoxManifestPath, "utf8");
  const firefoxOutput = fs.createWriteStream(outFirefoxPath);
  const firefoxArchive = archiver("zip", { zlib: { level: 9 } });
  const firefoxDone = new Promise((resolve, reject) => {
    firefoxOutput.on("close", resolve);
    firefoxArchive.on("error", reject);
  });
  firefoxArchive.pipe(firefoxOutput);
  for (const { full, rel } of files) {
    if (rel === "manifest.json" || rel === "manifest.firefox.json") continue;
    firefoxArchive.file(full, { name: rel });
  }
  firefoxArchive.append(firefoxManifest, { name: "manifest.json" });
  await firefoxArchive.finalize();
  await firefoxDone;

  // Legacy path kept so existing links still work.
  fs.copyFileSync(outChromiumPath, outLegacyPath);

  console.log("make-extension-zip: chromium", outChromiumPath, `(${chromiumArchive.pointer()} bytes)`);
  console.log("make-extension-zip: firefox ", outFirefoxPath, `(${firefoxArchive.pointer()} bytes)`);
  console.log("make-extension-zip: legacy  ", outLegacyPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
