process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.SESSION_SECRET = "test-secret-with-more-than-32-characters";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ejs = require("ejs");
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
}
test("todas las plantillas EJS compilan", () => {
  const views = walk(path.join(__dirname, "..", "views")).filter((file) =>
    file.endsWith(".ejs"),
  );
  assert.ok(views.length >= 25);
  for (const file of views)
    assert.doesNotThrow(
      () => ejs.compile(fs.readFileSync(file, "utf8"), { filename: file }),
      path.relative(process.cwd(), file),
    );
});
test("la aplicación Express puede cargarse", () =>
  assert.doesNotThrow(() => require("../app")));
test("el nombre de tienda está disponible globalmente para errores tempranos", () => {
  const app = require("../app");
  assert.equal(app.locals.storeName, "Don Pepe WMS");
});
