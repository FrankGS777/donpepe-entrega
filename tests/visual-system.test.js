const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { transformSync } = require("esbuild");
const THREE = require("three");
const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const filename = path.join(root, "frontend/warehouse-materials.js");
const moduleFixture = new Module(filename, module);
moduleFixture.filename = filename;
moduleFixture.paths = module.paths;
moduleFixture._compile(
  transformSync(source("frontend/warehouse-materials.js"), { format: "cjs" })
    .code,
  filename,
);
const { worldBoxUV, industrialRoofGeometry } = moduleFixture.exports;

test("los iconos estáticos de todas las vistas existen en el catálogo SVG", () => {
  const ids = new Set(
    [...source("public/icons.svg").matchAll(/id="([^"]+)"/g)].map(
      (match) => match[1],
    ),
  );
  function walk(directory) {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(file) : [file];
      });
  }
  for (const file of walk(path.join(root, "views"))) {
    for (const match of fs
      .readFileSync(file, "utf8")
      .matchAll(/["'#](i-[a-z0-9-]+)["']/g))
      assert(ids.has(match[1]), `${path.relative(root, file)}: ${match[1]}`);
  }
});
test("las imágenes de selección tienen estados de carga y error sin inventar fotografías", () => {
  const js = source("public/js/app.js");
  assert.match(js, /Imagen no disponible/);
  assert.match(js, /Cargando imagen/);
  assert.match(js, /image\.addEventListener\("load"/);
  assert.match(js, /!image\.hasAttribute\("data-resource-media"\)/);
});

test("materiales WMS usan escala física en lugar de estirar una imagen en la pared", () => {
  const g = worldBoxUV(new THREE.BoxGeometry(20, 6, 0.24), 1.5);
  const uv = g.attributes.uv;
  let max = 0;
  for (let i = 0; i < uv.count; i++)
    max = Math.max(max, Math.abs(uv.getX(i)), Math.abs(uv.getY(i)));
  assert(max > 6, "la textura debe repetirse por metros");
  assert([...uv.array].every(Number.isFinite));
  g.dispose();
});
test("la cubierta industrial es ligera, continua y normalizada", () => {
  const g = industrialRoofGeometry(184, 134);
  assert.equal(g.attributes.position.count, 130);
  assert.equal(g.index.count / 3, 128);
  const p = g.attributes.position;
  assert.equal(p.getX(0), 0);
  assert.equal(p.getX(p.count - 1), 184);
  for (let i = 0; i < p.count; i++)
    assert(p.getY(i) >= 9 && p.getY(i) <= 10.25);
  assert([...g.attributes.normal.array].every(Number.isFinite));
  g.dispose();
});
test("las tres interfaces reciben correcciones, con etiquetas claras independientes del tema", () => {
  for (const layout of ["main", "rf", "auth"])
    assert.match(source(`views/layouts/${layout}.ejs`), /role-access\.css/);
  const css = source("public/css/role-access.css");
  assert.match(css, /\.print-label small[\s\S]*?color: #605468/);
  assert.match(css, /\.task-purpose[^}]+var\(--dp-text\)/);
  assert.match(css, /\.wmap-shell[\s\S]*?overflow: clip/);
});
test("acabados de alta calidad conservan render bajo demanda y mapas compartidos", () => {
  const map = source("frontend/warehouse-map.js"),
    materials = source("frontend/warehouse-materials.js");
  assert.match(map, /if \(dirty \|\| moved\)/);
  assert.match(map, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/);
  assert.doesNotMatch(materials, /https?:|TextureLoader|displacementMap/);
  assert.doesNotMatch(map, /new THREE\.PointLight/);
  assert.match(map, /shadowMap\.autoUpdate = false/);
  assert.match(map, /RoomEnvironment/);
  assert.match(materials, /canvas\.width = canvas\.height = size/);
  assert.match(materials, /const size = 1024/);
});
