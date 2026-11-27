const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const ejs = require("ejs");

// Contratos de marca puramente locales: no cargan la aplicación ni su BD.
const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const logoPath = "/images/donpepe-logo-final-gold.png";

function inspectPng(file) {
  const bytes = fs.readFileSync(path.join(root, "public", file));
  assert.deepEqual(
    bytes.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const chunks = [];
  let header;
  let ended = false;
  for (let offset = 8; offset < bytes.length; ) {
    assert(offset + 12 <= bytes.length, `${file}: chunk truncado`);
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    assert(offset + size + 12 <= bytes.length, `${file}: datos PNG truncados`);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    if (type === "IHDR") header = data;
    if (type === "IDAT") chunks.push(data);
    if (type === "IEND") ended = true;
    offset += size + 12;
  }
  assert(
    ended && header && chunks.length,
    `${file}: estructura PNG incompleta`,
  );
  assert.equal(header.length, 13);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  assert.deepEqual(
    [...header.subarray(8)],
    [8, 6, 0, 0, 0],
    `${file}: debe ser RGBA de 8 bits`,
  );
  const stride = width * 4;
  const pixels = zlib.inflateSync(Buffer.concat(chunks));
  assert.equal(pixels.length, (stride + 1) * height);
  let previous = Buffer.alloc(stride);
  let minAlpha = 255;
  let maxAlpha = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1);
    const filter = pixels[offset];
    assert(filter >= 0 && filter <= 4, `${file}: filtro PNG inválido`);
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? row[x - 4] : 0;
      const b = previous[x];
      const c = x >= 4 ? previous[x - 4] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][
        filter
      ];
      row[x] = (pixels[offset + 1 + x] + predictor) & 255;
      if (x % 4 === 3) {
        minAlpha = Math.min(minAlpha, row[x]);
        maxAlpha = Math.max(maxAlpha, row[x]);
      }
    }
    previous = row;
  }
  assert.equal(minAlpha, 0, `${file}: el fondo debe ser transparente`);
  assert(maxAlpha > 0, `${file}: el logotipo no debe estar vacío`);
  return { width, height };
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const css = source("public/css/brand.css");
function declarations(selector, text = css) {
  const blocks = [
    ...text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ];
  const block = blocks.find((match) =>
    match[1]
      .split(/,(?![^()]*\))/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .includes(selector.replace(/\s+/g, " ").trim()),
  );
  assert(block, `Falta la regla de contraste ${selector}`);
  return block[2];
}

test("el logo final es PNG RGBA transparente y está encuadrado sin márgenes excesivos", () => {
  const image = inspectPng(logoPath);
  assert(image.width >= 1500 && image.height >= 450);
  assert(image.width / image.height > 2.6 && image.width / image.height < 3.1);
});

test("el parcial de marca tiene un nombre accesible y un único arte final dorado", () => {
  const filename = path.join(root, "views/partials/brandLogo.ejs");
  const template = ejs.compile(fs.readFileSync(filename, "utf8"), { filename });
  const html = template({});
  assert.match(html, /role="img"\s+aria-label="DonPepe"/);
  const images = html.match(/<img\b[^>]*>/g) || [];
  assert.equal(images.length, 1);
  for (const image of images) {
    assert.match(image, /alt=""/);
    assert.match(image, /aria-hidden="true"/);
    assert.match(image, /data-brand-logo/);
  }
  assert(html.includes(logoPath));
  assert.doesNotMatch(html, /donpepe-logo-(?:purple|white)\.png/);
});

test("todos los layouts comparten iconos y cargan la capa final de marca", () => {
  for (const layout of ["main", "auth", "rf"]) {
    const html = source(`views/layouts/${layout}.ejs`);
    assert.match(html, /include\(['"]\.\.\/partials\/brandIcons['"]\)/);
    assert.equal((html.match(/\/css\/brand\.css/g) || []).length, 1);
    assert(
      html.indexOf("/css/brand.css") > html.indexOf("/css/role-access.css"),
    );
  }
  const icons = source("views/partials/brandIcons.ejs");
  assert(icons.includes(logoPath));
  assert.match(icons, /rel="apple-touch-icon"/);
  for (const file of walk(path.join(root, "views")).filter((file) =>
    file.endsWith(".ejs"),
  )) {
    assert.doesNotMatch(
      fs.readFileSync(file, "utf8"),
      /donpepe-wordmark\.svg|donpepe-logo-(?:purple|white)\.png|favicon-64\.png|\/images\/apple-touch-icon\.png/,
      path.relative(root, file),
    );
  }
});

test("acceso, sidebar, cabecera móvil y RF usan el mismo componente de marca", () => {
  for (const slot of [
    "views/partials/authWordmark.ejs",
    "views/partials/sidebar.ejs",
    "views/partials/topbar.ejs",
    "views/layouts/rf.ejs",
  ]) {
    assert.match(
      source(slot),
      /include\(['"](?:\.\.\/partials\/)?brandLogo['"]/,
    );
  }
  const dynamicLabel = source("public/js/app.js");
  assert(dynamicLabel.includes(logoPath));
  assert.doesNotMatch(dynamicLabel, /donpepe-logo-(?:purple|white)\.png/);
});

test("el arte conserva su dorado y dispone de soporte oscuro en superficies claras", () => {
  assert.match(
    declarations("body[class] .donpepe-logo"),
    /background:\s*transparent/,
  );
  for (const selector of [
    "body.role-jefe_operaciones :is(.sidebar .brand, .shell-home) .donpepe-logo",
    "body.rf-mode .rf-brand .donpepe-logo",
    'body[class][data-theme="light"] :is(.sidebar .brand, .shell-home, .rf-brand) .donpepe-logo',
  ]) {
    assert.match(declarations(selector), /background:\s*#241332/);
  }
  assert.match(declarations("body[class] .donpepe-logo img"), /filter:\s*none/);
  assert.match(
    declarations("body[class] .donpepe-logo img"),
    /object-fit:\s*contain/,
  );
  assert.match(
    declarations("body[class] .sidebar .brand .donpepe-logo"),
    /width:\s*100%/,
  );
  assert.match(
    declarations("body[class] .sidebar .brand"),
    /padding:\s*20px\s+0/,
  );
  assert.match(
    declarations("body[class] .rf-brand .donpepe-logo"),
    /height:\s*auto/,
  );
});

test("la etiqueta conserva el logo final y su contraste durante la impresión", () => {
  assert.match(css, /@media\s+print\s*\{/);
  const print = css.slice(css.indexOf("@media print"));
  assert.match(
    declarations("body[class] .lot-label-brand", print),
    /background:\s*#241332\s*!important/,
  );
  assert.match(
    declarations("body[class] .lot-label-brand", print),
    /print-color-adjust:\s*exact/,
  );
});
