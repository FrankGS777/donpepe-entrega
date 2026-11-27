"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public/theme.js"), "utf8");
function fixture({ saved, blocked = false, loading = false } = {}) {
  const storage = new Map(saved == null ? [] : [["donpepe.theme", saved]]), writes = [], events = [], listeners = {}, documentListeners = {}, observers = [], buttons = [];
  const root = { dataset: {}, style: {} }, meta = { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
  function button() { const b = { attrs: {}, dataset: {}, label: { textContent: "" }, setAttribute(key, value) { this.attrs[key] = value; }, querySelector() { return this.label; } }; buttons.push(b); return b; }
  const first = button();
  const window = { addEventListener(name, handler) { listeners[name] = handler; }, dispatchEvent(event) { events.push(event); }, MutationObserver: true };
  const context = { window, document: { documentElement: root, readyState: loading ? "loading" : "complete", querySelector: () => meta, querySelectorAll: () => buttons, addEventListener(name, handler) { documentListeners[name] = handler; } }, localStorage: { getItem(key) { if (blocked) throw Error("Storage unavailable"); return storage.get(key); }, setItem(key, value) { if (blocked) throw Error("Storage unavailable"); writes.push([key,value]); storage.set(key,value); } }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} } };
  vm.runInNewContext(source, context);
  return { root, meta, window, api: window.DonPepeTheme, buttons, first, storage, writes, events, listeners, documentListeners, observers, button };
}
test("tema inicial oscuro se aplica síncronamente antes de DOMContentLoaded", () => {
  const f = fixture({ loading: true }); assert.equal(f.root.dataset.theme, "dark"); assert.equal(f.root.style.colorScheme, "dark"); assert.equal(f.meta.attributes.content, "#090b0f"); assert.equal(f.events.length, 0); assert.equal(f.writes.length, 0); assert.equal(typeof f.documentListeners.DOMContentLoaded, "function");
});
test("el tema guardado válido se restaura; un valor desconocido vuelve a oscuro", () => {
  assert.equal(fixture({ saved: "light" }).api.get(), "light"); assert.equal(fixture({ saved: "invalid" }).api.get(), "dark");
});
test("alternar guarda la preferencia y actualiza nombre accesible y estado del botón", () => {
  const f = fixture(); assert.equal(f.first.attrs["aria-pressed"], "true"); assert.equal(f.api.toggle(), "light"); assert.equal(f.storage.get("donpepe.theme"), "light"); assert.equal(f.first.attrs["aria-pressed"], "false"); assert.equal(f.first.attrs["aria-label"], "Activar modo oscuro"); assert.equal(f.first.label.textContent, "Modo oscuro");
});
test("cada cambio real emite el contrato del evento y valores inválidos no mutan el tema", () => {
  const f = fixture(); f.api.set("light"); f.api.set("light"); assert.equal(f.events.length, 1); assert.equal(f.events[0].type, "donpepe:themechange"); assert.equal(f.events[0].detail.theme, "light"); assert.throws(() => f.api.set("purple"), /dark o light/); assert.equal(f.api.get(), "light"); assert(Object.isFrozen(f.api));
});
test("la preferencia se sincroniza entre pestañas sin una escritura recursiva", () => {
  const f = fixture(); f.listeners.storage({ key: "unrelated", newValue: "light" }); assert.equal(f.api.get(), "dark"); f.listeners.storage({ key: "donpepe.theme", newValue: "light" }); assert.equal(f.api.get(), "light"); assert.equal(f.writes.length, 0); assert.equal(f.events[0].detail.theme, "light");
});
test("sin almacenamiento permitido el tema sigue funcionando en memoria", () => {
  const f = fixture({ blocked: true }); assert.equal(f.api.get(), "dark"); assert.equal(f.api.toggle(), "light"); assert.equal(f.root.dataset.theme, "light");
});
test("botones añadidos después del inicio reciben las etiquetas accesibles del tema actual", () => {
  const f = fixture({ saved: "light" }); const later = f.button(); f.observers[0]([{ addedNodes: [{ nodeType: 1, matches: () => true }] }]); assert.equal(later.attrs["aria-pressed"], "false"); assert.equal(later.attrs["aria-label"], "Activar modo oscuro"); assert.equal(later.dataset.currentTheme, "light");
});
