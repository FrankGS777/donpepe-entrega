"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const manifest = require("../core/autonomy-visual-assets.json");
const { AUTONOMY_MEDIA_TYPES, autonomyAssetMedia } = require("../core/autonomy-media");
const root = path.resolve(__dirname, "../..");
function webpSize(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.toString("ascii", 0, 4), "RIFF");
  assert.equal(data.toString("ascii", 8, 12), "WEBP");
  for (let offset = 12; offset + 8 < data.length;) {
    const kind = data.toString("ascii", offset, offset + 4), start = offset + 8;
    const bytes = data.readUInt32LE(offset + 4);
    if (kind === "VP8X") return { width: 1 + data.readUIntLE(start + 4, 3), height: 1 + data.readUIntLE(start + 7, 3) };
    if (kind === "VP8 ") return { width: data.readUInt16LE(start + 6) & 0x3fff, height: data.readUInt16LE(start + 8) & 0x3fff };
    if (kind === "VP8L") { const bits = data.readUInt32LE(start + 1); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }; }
    offset = start + bytes + (bytes % 2);
  }
  throw new Error("No image chunk found in " + file);
}
test("cada clase autónoma tiene una ilustración WebP local registrada", () => {
  assert.equal(manifest.assets.length, 7);
  for (const type of AUTONOMY_MEDIA_TYPES) {
    const asset = manifest.assets.find(row => row.assetType === type);
    assert.ok(asset, type);
    assert.equal(asset.imageUrl, autonomyAssetMedia(type).imageUrl);
    assert.equal(asset.imageKind, "GENERATED_REPRESENTATION");
    assert.deepEqual(webpSize(path.join(root, "v2/public", asset.imageUrl)), { width: 1536, height: 1024 });
  }
});
test("se preservan originales con resolución comprobable y sin depender de rutas externas", () => {
  for (const asset of manifest.assets) {
    const data = fs.readFileSync(path.join(root, asset.workspaceSource));
    assert.equal(data.toString("ascii", 1, 4), "PNG");
    assert.deepEqual({ width: data.readUInt32BE(16), height: data.readUInt32BE(20) }, asset.nativeDimensions);
    assert.ok(asset.workspaceSource.endsWith(".png"));
  }
});
test("acceso sirve variantes responsive y declara 4K como exportación, no generación nativa", () => {
  const hero = manifest.assets.find(row => row.key === "hero");
  assert.deepEqual(webpSize(path.join(root, "v2/public", hero.imageUrl)), hero.nativeDimensions);
  for (const width of manifest.heroExport.responsiveWidths) {
    const url = hero.imageUrl.replace(/\.webp$/, "-" + width + ".webp");
    assert.deepEqual(webpSize(path.join(root, "v2/public", url)), { width, height: width * 9 / 16 });
  }
  assert.match(manifest.heroExport.export4k.method, /not native 4K/);
  const html = fs.readFileSync(path.join(root, "v2/public/login.html"), "utf8");
  assert.match(html, /srcset=/);
  assert.match(html, /donpepe-lima-exterior-v2-3840\.webp 3840w/);
  assert.doesNotMatch(html, /auth-location|Lima, Perú/);
  assert.ok(html.indexOf("login-panel") < html.indexOf('class="login-logo"'));
});
