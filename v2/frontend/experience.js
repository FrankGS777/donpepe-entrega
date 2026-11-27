// Shared interaction feedback, independent of roles and logistics commands.
const editable =
  "input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])";
let serial = 0;
function caption(field) {
  return (
    field.labels?.[0]?.childNodes[0]?.textContent?.trim() ||
    field.getAttribute("aria-label") ||
    "Este campo"
  );
}
function validationMessage(field) {
  const name = caption(field),
    v = field.validity;
  if (v.valueMissing) return `${name}: completa este campo.`;
  if (v.typeMismatch)
    return field.type === "email"
      ? "Escribe un correo válido, por ejemplo nombre@gmail.com."
      : `${name}: revisa el formato.`;
  if (v.rangeUnderflow) return `El mínimo permitido es ${field.min}.`;
  if (v.rangeOverflow) return `El máximo permitido es ${field.max}.`;
  if (v.badInput) return "Escribe un número válido.";
  if (v.stepMismatch)
    return !field.step || field.step === "1"
      ? "Escribe una cantidad entera válida."
      : `Usa incrementos de ${field.step} para este valor.`;
  if (v.tooShort) return `Escribe al menos ${field.minLength} caracteres.`;
  if (v.patternMismatch)
    return field.title || `${name}: revisa el formato indicado.`;
  return field.validationMessage || "Revisa este valor.";
}
export function clearFieldError(field) {
  if (!(field instanceof HTMLElement)) return;
  field.removeAttribute("aria-invalid");
  const id = field.dataset.errorId;
  if (id) {
    document.getElementById(id)?.remove();
    const ids = (field.getAttribute("aria-describedby") || "")
      .split(" ")
      .filter((x) => x && x !== id);
    ids.length
      ? field.setAttribute("aria-describedby", ids.join(" "))
      : field.removeAttribute("aria-describedby");
    delete field.dataset.errorId;
  }
}
export function markFieldError(field, message) {
  if (!(field instanceof HTMLElement)) return;
  clearFieldError(field);
  field.setAttribute("aria-invalid", "true");
  const note = document.createElement("span");
  note.id = `field-problem-${++serial}`;
  note.className = "field-problem";
  note.textContent = message;
  field.dataset.errorId = note.id;
  field.setAttribute(
    "aria-describedby",
    `${field.getAttribute("aria-describedby") || ""} ${note.id}`.trim(),
  );
  field.insertAdjacentElement("afterend", note);
}
export function formIssue(form, message, fields = {}) {
  if (!form) return;
  const summary =
    form.querySelector(".form-error") ||
    (() => {
      const node = document.createElement("div");
      node.className = "form-error";
      form.prepend(node);
      return node;
    })();
  summary.textContent = message;
  summary.setAttribute("role", "alert");
  summary.tabIndex = -1;
  const unmatched = [];
  for (const [name, error] of Object.entries(fields)) {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLElement) markFieldError(field, error);
    else unmatched.push(String(error));
  }
  // Cross-field decisions and group errors must never vanish just because the
  // backend key is not a single editable input in this particular view.
  if (unmatched.length) {
    const list = document.createElement("ul");
    for (const error of new Set(unmatched)) {
      const item = document.createElement("li");
      item.textContent = error;
      list.append(item);
    }
    summary.append(list);
  }
  const first = form.querySelector("[aria-invalid=true]");
  const focusTarget =
    (first?.dataset.entityFocus &&
      document.getElementById(first.dataset.entityFocus)) ||
    first ||
    summary;
  focusTarget.focus({ preventScroll: true });
  focusTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
    summary.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 260 },
    );
}
export function installExperience({ dialog }) {
  const motion = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let previousFocus, lastOutsideFocus;
  document.addEventListener("focusin", (event) => {
    if (!dialog.contains(event.target)) lastOutsideFocus = event.target;
  });
  function progress(form) {
    if (form.closest("#login-form") || !form.querySelector("[required]"))
      return;
    let bar = form.querySelector(":scope > .form-completion");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "form-completion";
      bar.innerHTML =
        '<span></span><progress max="100" value="0" aria-label="Campos obligatorios completos"></progress>';
      form.prepend(bar);
    }
    const required = [...form.querySelectorAll("[required]")].filter(
      (f) => f.willValidate,
    );
    const valid = required.filter((f) => f.validity.valid).length;
    bar.querySelector("span").textContent =
      valid === required.length
        ? "Campos obligatorios completos"
        : `${valid} de ${required.length} campos obligatorios completos`;
    bar.querySelector("progress").value = required.length
      ? (valid / required.length) * 100
      : 100;
  }
  function prepare(root) {
    for (const form of root.querySelectorAll("form")) {
      form.noValidate = true;
      progress(form);
    }
    for (const field of root.querySelectorAll(
      "textarea[maxlength],input[maxlength]:not([type=password]):not([type=hidden]):not([type=search])",
    )) {
      if (Number(field.maxLength) < 40 || field.dataset.counterReady) continue;
      field.dataset.counterReady = "true";
      const counter = document.createElement("small");
      counter.className = "character-counter";
      counter.setAttribute("aria-hidden", "true");
      field.insertAdjacentElement("afterend", counter);
      const update = () => {
        counter.textContent = `${field.value.length} / ${field.maxLength}`;
        counter.classList.toggle(
          "near-limit",
          field.value.length >= field.maxLength * 0.9,
        );
      };
      field.addEventListener("input", update);
      update();
    }
    for (const img of root.querySelectorAll("img[loading=lazy]")) {
      if (img.complete) img.classList.add("media-ready");
      else
        img.addEventListener("load", () => img.classList.add("media-ready"), {
          once: true,
        });
    }
  }
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node.nodeType === 1) {
          if (node.matches("form")) {
            node.noValidate = true;
            progress(node);
          }
          prepare(node);
          if (
            node.matches(
              ".document-card,.store-product,.admin-entity-card,.equipment-card,.branch-card",
            )
          ) {
            const siblings = [...node.parentElement.children];
            node.style.setProperty(
              "--entry-delay",
              `${Math.min(siblings.indexOf(node), 7) * 22}ms`,
            );
          }
        }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  prepare(document);
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.hasAttribute("data-govern-validation")) return;
      for (const field of form.querySelectorAll(editable))
        clearFieldError(field);
      const invalid = [...form.querySelectorAll(editable)].filter(
        (field) => field.willValidate && !field.validity.valid,
      );
      if (invalid.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        for (const field of invalid)
          markFieldError(field, validationMessage(field));
        formIssue(
          form,
          `Revisa ${invalid.length === 1 ? "el campo señalado" : `los ${invalid.length} campos señalados`} para continuar.`,
        );
      }
    },
    true,
  );
  document.addEventListener("input", (event) => {
    // The basket owns its shared-limit validation and accessible inline error;
    // injecting another error inside its compact stepper breaks the layout.
    if (event.target.matches("[data-store-quantity]")) return;
    const form = event.target.closest("form");
    if (form) progress(form);
    if (event.target.closest("form[data-govern-validation]")) return;
    if (
      event.target.matches(editable) &&
      event.target.hasAttribute("aria-invalid")
    ) {
      if (event.target.validity.valid) clearFieldError(event.target);
      else markFieldError(event.target, validationMessage(event.target));
    }
  });
  document.addEventListener("change", (event) => {
    const form = event.target.closest("form");
    if (form) progress(form);
  });
  document.addEventListener("focusout", (event) => {
    const field = event.target;
    if (field.matches?.("[data-store-quantity]")) return;
    if (!field.matches?.(editable) || field.closest("[data-govern-validation]"))
      return;
    if (field.value && field.willValidate && !field.validity.valid)
      markFieldError(field, validationMessage(field));
  });
  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("button.btn,a.btn");
    if (!button || button.disabled || !motion() || event.button !== 0) return;
    const bounds = button.getBoundingClientRect();
    const pulse = document.createElement("span");
    pulse.className = "action-ripple";
    pulse.setAttribute("aria-hidden", "true");
    pulse.style.left = `${event.clientX - bounds.left}px`;
    pulse.style.top = `${event.clientY - bounds.top}px`;
    button.append(pulse);
    pulse.addEventListener("animationend", () => pulse.remove(), {
      once: true,
    });
  });
  const dialogObserver = new MutationObserver((records) => {
    if (!records.some((r) => r.attributeName === "open")) return;
    if (dialog.open) {
      previousFocus = lastOutsideFocus;
      dialog.classList.remove("dialog-entered");
      requestAnimationFrame(() => dialog.classList.add("dialog-entered"));
    }
  });
  dialogObserver.observe(dialog, {
    attributes: true,
    attributeFilter: ["open"],
  });
  document.addEventListener(
    "error",
    (event) => {
      const img = event.target;
      if (img?.dataset?.masterImage !== undefined) return;
      if (
        img instanceof HTMLImageElement &&
        img.dataset.catalogPhoto !== undefined &&
        !img.dataset.fallback
      ) {
        img.dataset.fallback = "true";
        img.src = "/images/resource-fallback.svg";
        img.classList.add("photo-unavailable");
        img.alt = "Fotografía no disponible";
      }
    },
    true,
  );
  dialog.addEventListener("close", () => {
    for (const field of dialog.querySelectorAll("[aria-invalid=true]"))
      clearFieldError(field);
    if (previousFocus?.isConnected && !dialog.contains(previousFocus))
      previousFocus.focus({ preventScroll: true });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape")
      document.querySelector(".experience-help")?.remove();
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === "Enter" &&
      dialog.open &&
      !document.querySelector(
        ".entity-picker-dialog[open],.assortment-dialog[open]",
      )
    ) {
      const form = dialog.querySelector("form"),
        submit = form?.querySelector("button[type=submit],button:not([type])");
      if (form && submit && !submit.disabled) {
        event.preventDefault();
        form.requestSubmit(submit);
      }
    }
    if (
      event.key === "/" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.target.closest("input,textarea,select,[contenteditable=true]") &&
      !document.querySelector("#map-find") &&
      !document.querySelector(
        ".entity-picker-dialog[open],.assortment-dialog[open]",
      )
    ) {
      const search = (
        dialog.open ? dialog : document.querySelector("#main")
      )?.querySelector("input[type=search]");
      if (search) {
        event.preventDefault();
        search.focus();
      }
    }
  });
}
export function cardImageSources(url) {
  const match = /^\/images\/(categories|representations)\/([\w-]+)\.webp$/.exec(url || "");
  if (!match) return "";
  const [, family, name] = match;
  const preview = `/images/previews/${family}/${name}.webp`;
  const width = /^equipment-(auto_id_gate|auto_unloader|case_picking_cell|inbound_conveyor|pie_station|store_receiving_station)$/.test(name) ? 1536 : 1200;
  return ` srcset="${preview} 640w, ${url} ${width}w" sizes="(max-width: 600px) 90vw, 490px"`;
}
export function photo(item, className = "", logo = false) {
  const path = logo ? item?.logoUrl : item?.imageUrl;
  const safe =
    typeof path === "string" &&
    /^\/images\/[\w/.-]+\.(?:png|jpe?g|webp|svg)$/i.test(path) &&
    !path.includes("..");
  const name = String(item?.name || "Producto").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
  return `<img data-catalog-photo class="catalog-photo ${className}${item?.preferredBackground === "dark" ? " logo-contrast-dark" : ""}" src="${safe ? path : "/images/resource-fallback.svg"}"${safe && className !== "store-hero-photo" ? cardImageSources(path) : ""} alt="${logo ? "Logo de " : ""}${name}" loading="lazy" decoding="async" width="160" height="160">`;
}
