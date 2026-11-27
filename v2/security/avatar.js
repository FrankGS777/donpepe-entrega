"use strict";
const { PNG } = require("pngjs");
const crypto = require("node:crypto");
const { problem } = require("./identity");

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MIN_DIMENSION = 64;
const MAX_DIMENSION = 1024;
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// JPEG / WebP / PNG files are decoded, cropped and normalized to PNG by the
// browser before upload. The server independently decodes actual PNG pixels,
// checks CRCs and re-encodes them. Never store an SVG, a URL or an unchecked
// container supplied by a client. Bounded non-interlaced 8-bit input also keeps
// decompression memory predictable (at most 4 MiB of decoded pixel data).
function normalizeAvatar(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl) problem("Selecciona una foto válida desde el formulario.");
  if (dataUrl.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 22) problem("La foto supera 2 MB. Recórtala o utiliza una imagen más pequeña.", 413);
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) problem("Envía una foto JPEG, PNG o WebP desde el selector; el navegador debe normalizarla a PNG.");
  const encoded = dataUrl.slice(22);
  if (encoded.length % 4 !== 0) problem("La foto no tiene una codificación válida.");
  const input = Buffer.from(encoded, "base64");
  if (input.length > MAX_AVATAR_BYTES) problem("La foto supera 2 MB.", 413);
  if (input.toString("base64") !== encoded || input.length < 57 || !input.subarray(0, 8).equals(SIGNATURE)) problem("El archivo no contiene una imagen PNG válida.");
  if (input.readUInt32BE(8) !== 13 || input.toString("ascii", 12, 16) !== "IHDR") problem("La cabecera de la foto no es válida.");
  const width = input.readUInt32BE(16), height = input.readUInt32BE(20);
  if (width < MIN_DIMENSION || height < MIN_DIMENSION || width > MAX_DIMENSION || height > MAX_DIMENSION || width !== height) problem("Utiliza un recorte cuadrado de entre 64 y 1024 píxeles por lado.");
  if (input[24] !== 8 || ![2, 6].includes(input[25]) || input[26] !== 0 || input[27] !== 0 || input[28] !== 0) problem("La foto debe ser PNG RGB/RGBA de 8 bits, estática y sin entrelazado. Vuelve a seleccionarla desde el formulario.");
  let offset = 8, chunks = 0, ended = false, hasPixels = false;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset), type = input.toString("ascii", offset + 4, offset + 8);
    if (length > MAX_AVATAR_BYTES || offset + 12 + length > input.length || ++chunks > 512) problem("La estructura de la foto está dañada.");
    if (["acTL", "fcTL", "fdAT"].includes(type)) problem("Utiliza una foto estática; no se admiten avatares animados.");
    if (type === "IHDR" && offset !== 8) problem("La foto contiene cabeceras duplicadas.");
    if (type === "IDAT" && length > 0) hasPixels = true;
    offset += length + 12;
    if (type === "IEND") {
      if (length || offset !== input.length) problem("La foto contiene datos adicionales no permitidos.");
      ended = true; break;
    }
  }
  if (!ended || !hasPixels) problem("La foto está incompleta o no contiene píxeles.");
  let decoded, output;
  try {
    decoded = PNG.sync.read(input, { checkCRC: true });
    if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 4) throw new Error("Invalid pixels");
    output = PNG.sync.write({ width, height, data: decoded.data }, { colorType: 6, inputColorType: 6, bitDepth: 8, deflateLevel: 6 });
  } catch { problem("No se pudo leer la foto. El archivo está dañado o no es una imagen válida."); }
  if (output.length > MAX_AVATAR_BYTES) problem("La foto normalizada supera 2 MB. Utiliza un recorte de 768 píxeles o menos.", 413);
  return { data: output, mime: "image/png", width, height, version: crypto.randomBytes(12).toString("hex") };
}
module.exports = { normalizeAvatar, MAX_AVATAR_BYTES, MIN_DIMENSION, MAX_DIMENSION };
