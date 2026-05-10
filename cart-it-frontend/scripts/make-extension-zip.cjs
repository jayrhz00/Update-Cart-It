/**
 * Packs ../extension into browser-specific zips for extension-install.html.
 * Runs automatically before `react-scripts build` (see package.json prebuild).
 *
 * Windows + OneDrive: if writing to `public/*.zip` fails with UNKNOWN / errno -4094,
 * set `CART_IT_ZIP_OUTPUT_DIR` to a plain local folder (e.g. C:\temp\cart-zips), then
 * copy the three zips into `cart-it-frontend/public/` before `git add` / deploy.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const archiver = require("archiver");

/**
 * Build the zip on the system temp drive first, then copy into `finalPath`.
 * Writing directly into OneDrive/Desktop paths often fails on Windows (UNKNOWN / errno -4094)
 * when sync or another app (e.g. Firefox with the zip loaded) locks the file.
 */
async function writeZipToPath(finalPath, populate) {
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const tmpZip = path.join(
    os.tmpdir(),
    `${path.basename(finalPath, ".zip")}-${process.pid}.zip`
  );
  const output = fs.createWriteStream(tmpZip);
  const archive = archiver("zip", { zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  await populate(archive);
  await archive.finalize();
  await done;
  try {
    try {
      fs.rmSync(finalPath, { force: true });
    } catch {
      /* ignore */
    }
    fs.copyFileSync(tmpZip, finalPath);
  } catch (e) {
    console.error(
      "make-extension-zip: could not write",
      finalPath,
      "- close Firefox if it loaded this zip, pause OneDrive sync, or set CART_IT_ZIP_OUTPUT_DIR to a non-OneDrive folder (see script top comment)."
    );
    throw e;
  } finally {
    try {
      fs.unlinkSync(tmpZip);
    } catch {
      /* ignore */
    }
  }
}

const frontendRoot = path.join(__dirname, "..");
const repoRoot = path.join(frontendRoot, "..");
const extDir = path.join(repoRoot, "extension");
/** Override output folder when OneDrive locks `public/*.zip` (Windows errno -4094). */
const zipOutDir =
  process.env.CART_IT_ZIP_OUTPUT_DIR && String(process.env.CART_IT_ZIP_OUTPUT_DIR).trim() !== ""
    ? path.resolve(String(process.env.CART_IT_ZIP_OUTPUT_DIR).trim())
    : path.join(frontendRoot, "public");
const outChromiumPath = path.join(zipOutDir, "cart-it-extension-chromium.zip");
const outFirefoxPath = path.join(zipOutDir, "cart-it-extension-firefox.zip");
const outLegacyPath = path.join(zipOutDir, "cart-it-extension.zip");

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
  let chromiumBytes = 0;
  let firefoxBytes = 0;

  // Chromium package (Chrome + Edge): use manifest.json and exclude firefox-only manifest file.
  await writeZipToPath(outChromiumPath, async (chromiumArchive) => {
    for (const { full, rel } of files) {
      if (rel === "manifest.firefox.json") continue;
      chromiumArchive.file(full, { name: rel });
    }
  });
  chromiumBytes = fs.statSync(outChromiumPath).size;

  // Firefox package: map manifest.firefox.json -> manifest.json.
  const firefoxManifestPath = path.join(extDir, "manifest.firefox.json");
  const firefoxManifest = fs.readFileSync(firefoxManifestPath, "utf8");
  await writeZipToPath(outFirefoxPath, async (firefoxArchive) => {
    for (const { full, rel } of files) {
      if (rel === "manifest.json" || rel === "manifest.firefox.json") continue;
      firefoxArchive.file(full, { name: rel });
    }
    firefoxArchive.append(firefoxManifest, { name: "manifest.json" });
  });
  firefoxBytes = fs.statSync(outFirefoxPath).size;

  // Legacy path kept so existing links still work.
  fs.copyFileSync(outChromiumPath, outLegacyPath);

  console.log("make-extension-zip: chromium", outChromiumPath, `(${chromiumBytes} bytes)`);
  console.log("make-extension-zip: firefox ", outFirefoxPath, `(${firefoxBytes} bytes)`);
  console.log("make-extension-zip: legacy  ", outLegacyPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
