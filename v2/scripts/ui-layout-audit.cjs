"use strict";
// Geometry checks complement screenshots; horizontally scrollable tables and
// deliberately floating map/navigation controls are not layout defects.
module.exports = async function auditLayout(page) {
  return page.evaluate(() => {
    const issues = [],
      shown = (element) => {
        const r = element.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          getComputedStyle(element).visibility !== "hidden"
        );
      };
    const key = (element) =>
      element.id
        ? `#${element.id}`
        : `${element.tagName.toLowerCase()}.${String(element.className || "")
            .trim()
            .replace(/\s+/g, ".")}`;
    const root =
      document.querySelector("#dialog[open] #dialog-body") ||
      document.querySelector("#main");
    if (!root) return [];
    const rect = (element) => {
      const r = element.getBoundingClientRect();
      return {
        top: r.top,
        left: r.left,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    for (const grid of root.querySelectorAll(
      ".master-summary-columns,.govern-columns,.store-home-columns,.govern-summary,.master-catalog-grid,.admin-registry-grid,.branch-grid,.store-stock-grid",
    )) {
      if (getComputedStyle(grid).display !== "grid") continue;
      const children = [...grid.children]
        .filter(shown)
        .filter((el) => getComputedStyle(el).position !== "absolute");
      for (let i = 0; i < children.length; i++)
        for (let j = i + 1; j < children.length; j++) {
          const a = rect(children[i]),
            b = rect(children[j]);
          if (
            Math.abs(a.top - b.top) < 30 &&
            a.right <= b.left + 2 &&
            Math.abs(a.top - b.top) > 2
          )
            issues.push({
              type: "paired-grid-top",
              parent: key(grid),
              a: key(children[i]),
              b: key(children[j]),
              difference: Math.abs(a.top - b.top),
            });
        }
    }
    for (const grid of root.querySelectorAll(".form-grid,.admin-form-grid")) {
      const labels = [...grid.children].filter(
        (el) => el.tagName === "LABEL" && shown(el),
      );
      for (let i = 0; i < labels.length; i++)
        for (let j = i + 1; j < labels.length; j++) {
          const a = rect(labels[i]),
            b = rect(labels[j]);
          if (Math.abs(a.top - b.top) > 2 || a.right > b.left + 2) continue;
          const input = (label) =>
            [
              ...label.querySelectorAll(
                "input:not([type=checkbox]):not([type=file]),select:not(.entity-original-select),.entity-picker-trigger",
              ),
            ].find(shown);
          const ai = input(labels[i]),
            bi = input(labels[j]);
          if (ai && bi && Math.abs(rect(ai).top - rect(bi).top) > 2)
            issues.push({
              type: "form-field-top",
              a: ai.name || key(ai),
              b: bi.name || key(bi),
              difference: Math.abs(rect(ai).top - rect(bi).top),
            });
        }
    }
    for (const el of root.querySelectorAll(
      ".trace-load,.trace-lot,.product-spotlight,.form-grid,.admin-form-grid,.master-record,.section-heading",
    )) {
      if (shown(el) && el.scrollWidth > el.clientWidth + 3)
        issues.push({
          type: "component-overflow",
          element: key(el),
          width: el.clientWidth,
          scroll: el.scrollWidth,
        });
    }
    return issues;
  });
};
