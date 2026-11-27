(function () {
  "use strict";
  var key = "donpepe.theme";
  var root = document.documentElement;
  var current = "dark";
  try {
    var saved = localStorage.getItem(key);
    if (saved === "dark" || saved === "light") current = saved;
  } catch (_) { /* Private browsing may prohibit storage. The theme still works. */ }

  function updateButtons() {
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      var label = current === "dark" ? "Activar modo claro" : "Activar modo oscuro";
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", current === "dark" ? "true" : "false");
      button.setAttribute("title", label);
      button.dataset.currentTheme = current;
      var text = button.querySelector("[data-theme-label]");
      if (text) text.textContent = current === "dark" ? "Modo claro" : "Modo oscuro";
    });
  }
  function apply(value, persist, emit) {
    if (value !== "dark" && value !== "light") throw new TypeError("El tema debe ser dark o light.");
    var changed = current !== value || root.dataset.theme !== value;
    current = value;
    root.dataset.theme = value;
    root.style.colorScheme = value;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", value === "dark" ? "#090b0f" : "#f2f1ed");
    if (persist) {
      try { localStorage.setItem(key, value); } catch (_) { /* In-memory fallback. */ }
    }
    updateButtons();
    if (emit && changed) window.dispatchEvent(new CustomEvent("donpepe:themechange", { detail: { theme: value } }));
    return current;
  }
  window.DonPepeTheme = Object.freeze({
    get: function () { return current; },
    set: function (value) { return apply(value, true, true); },
    toggle: function () { return apply(current === "dark" ? "light" : "dark", true, true); },
  });
  // This runs synchronously in the document head, before a first painted frame.
  apply(current, false, false);
  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest && event.target.closest("[data-theme-toggle]");
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return;
    event.preventDefault();
    window.DonPepeTheme.toggle();
  });
  window.addEventListener("storage", function (event) {
    if (event.key === key) apply(event.newValue === "light" ? "light" : "dark", false, true);
  });
  function ready() {
    updateButtons();
    if (!window.MutationObserver) return;
    new MutationObserver(function (records) {
      if (records.some(function (record) {
        return Array.from(record.addedNodes).some(function (node) {
          return node.nodeType === 1 && (node.matches("[data-theme-toggle]") || node.querySelector("[data-theme-toggle]"));
        });
      })) updateButtons();
    }).observe(root, { subtree: true, childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
})();
