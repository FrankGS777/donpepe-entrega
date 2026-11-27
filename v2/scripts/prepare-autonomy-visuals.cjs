"use strict";
// Deterministic media-only build: never reads or modifies operational databases.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require(process.env.SHARP_MODULE || "sharp");
const root = path.resolve(__dirname, "../..");
const manifest = require("../core/autonomy-visual-assets.json");

(async () => {
  const generated = [];
  for (const asset of manifest.assets) {
    const original = path.join(root, asset.workspaceSource);
    fs.mkdirSync(path.dirname(original), { recursive: true });
    const metadata = await sharp(original).metadata();
    if (metadata.width !== asset.nativeDimensions.width || metadata.height !== asset.nativeDimensions.height)
      throw new Error("Unexpected source dimensions: " + asset.key);
    const destination = path.join(root, "v2/public", asset.imageUrl);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await sharp(original).webp({ quality: 92, effort: 6 }).toFile(destination);
    generated.push({ key: asset.key, source: asset.workspaceSource, url: asset.imageUrl,
      width: metadata.width, height: metadata.height, bytes: fs.statSync(destination).size,
      native: true });
    if (asset.key === "hero") {
      for (const width of manifest.heroExport.responsiveWidths) {
        const height = width * 9 / 16;
        const target = destination.replace(/\.webp$/, "-" + width + ".webp");
        await sharp(original).resize(width, height, { fit: "cover", kernel: "lanczos3" })
          .webp({ quality: width === 3840 ? 93 : 92, effort: 6 }).toFile(target);
        generated.push({ key: "hero-" + width, url: asset.imageUrl.replace(/\.webp$/, "-" + width + ".webp"),
          width, height, bytes: fs.statSync(target).size, native: false,
          method: "Lanczos3 resampling; no claim of new native detail." });
      }
    }
  }
  const total = generated.reduce((sum, item) => sum + item.bytes, 0);
  process.stdout.write(JSON.stringify({ generated, totalBytes: total }, null, 2) + "\n");
})().catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
