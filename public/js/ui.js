(() => {
  const ready = (work) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", work, { once: true })
      : work();
  const modalInstances = new WeakMap();
  let activeModal = null;

  function focusable(root) {
    return [
      ...root.querySelectorAll("button,a,input,select,textarea,[tabindex]"),
    ].filter(
      (item) =>
        !item.disabled &&
        item.tabIndex !== -1 &&
        !item.hidden &&
        item.getClientRects().length,
    );
  }

  function modal(element) {
    if (modalInstances.has(element)) return modalInstances.get(element);
    let opener = null;
    let backdrop = null;
    let closeTimer;
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-modal", "true");
    const api = {
      show() {
        if (activeModal === api) return;
        clearTimeout(closeTimer);
        backdrop?.remove();
        if (activeModal && activeModal !== api) activeModal.hide();
        opener = document.activeElement;
        element.hidden = false;
        element.setAttribute("aria-hidden", "false");
        requestAnimationFrame(() => element.classList.add("is-open"));
        document.body.classList.add("ui-locked");
        backdrop = document.createElement("button");
        backdrop.type = "button";
        backdrop.className = "ui-backdrop";
        backdrop.setAttribute("aria-label", "Cerrar ventana");
        backdrop.addEventListener("click", api.hide);
        element.before(backdrop);
        requestAnimationFrame(() => backdrop.classList.add("is-open"));
        activeModal = api;
        setTimeout(() => focusable(element)[0]?.focus(), 40);
      },
      hide() {
        if (element.hidden) return;
        element.classList.remove("is-open");
        backdrop?.classList.remove("is-open");
        closeTimer = setTimeout(() => {
          element.hidden = true;
          element.setAttribute("aria-hidden", "true");
          backdrop?.remove();
          backdrop = null;
          if (!activeModal) document.body.classList.remove("ui-locked");
          element.dispatchEvent(new CustomEvent("ui:modal-hidden"));
          if (!activeModal) opener?.focus?.();
        }, 180);
        activeModal = null;
      },
    };
    modalInstances.set(element, api);
    element.hidden = true;
    element
      .querySelectorAll('[data-ui-dismiss="modal"]')
      .forEach((button) => button.addEventListener("click", api.hide));
    return api;
  }

  function closeMenus(except = null) {
    document.querySelectorAll("[data-ui-menu-panel]").forEach((panel) => {
      if (panel === except) return;
      panel.hidden = true;
      panel
        .closest(".ui-menu")
        ?.querySelector("[data-ui-menu-button]")
        ?.setAttribute("aria-expanded", "false");
    });
  }

  ready(() => {
    document.documentElement.classList.add("ui-enhanced");
    requestAnimationFrame(() => document.body.classList.add("ui-ready"));
    document.querySelector("[data-validation-summary]")?.focus();

    // Restaurar el elemento que realmente hace scroll, no la ventana.
    const sidebar = document.querySelector("[data-sidebar-scroll]");
    if (sidebar) {
      const key =
        "donpepe:sidebar:" + (document.body.dataset.userId || "session");
      const elements = [sidebar, sidebar.querySelector(".role-nav")].filter(
        Boolean,
      );
      const save = () => {
        try {
          sessionStorage.setItem(
            key,
            JSON.stringify(elements.map((e) => e.scrollTop)),
          );
        } catch {}
      };
      try {
        const positions = JSON.parse(sessionStorage.getItem(key) || "[]");
        elements.forEach((element, i) => {
          element.scrollTop = Number(positions[i]) || 0;
        });
      } catch {}
      elements.forEach((e) =>
        e.addEventListener("scroll", save, { passive: true }),
      );
      sidebar.addEventListener("click", save, { capture: true });
      window.addEventListener("pagehide", save);
    }

    document.addEventListener(
      "invalid",
      (event) => {
        const field = event.target;
        if (!(field instanceof HTMLElement)) return;
        field.setAttribute("aria-invalid", "true");
        let message = field.parentElement.querySelector(
          "[data-field-feedback]",
        );
        if (!message) {
          message = document.createElement("small");
          message.className = "field-feedback";
          message.dataset.fieldFeedback = "";
          message.id = "field-feedback-" + Math.random().toString(36).slice(2);
          field.after(message);
          field.setAttribute(
            "aria-describedby",
            [field.getAttribute("aria-describedby"), message.id]
              .filter(Boolean)
              .join(" "),
          );
        }
        message.textContent = field.validationMessage;
        field.classList.remove("field-invalid-pulse");
        requestAnimationFrame(() => field.classList.add("field-invalid-pulse"));
      },
      true,
    );
    document.addEventListener("input", (event) => {
      const field = event.target;
      if (
        field.getAttribute?.("aria-invalid") === "true" &&
        field.validity?.valid
      ) {
        field.removeAttribute("aria-invalid");
        const message = field.parentElement.querySelector(
          "[data-field-feedback]",
        );
        if (message) message.textContent = "";
      }
    });
    document.addEventListener("submit", (event) => {
      if (event.target.getAttribute("aria-busy") === "true") {
        event.preventDefault();
        return;
      }
      queueMicrotask(() => {
        const form = event.target;
        if (event.defaultPrevented || !(form instanceof HTMLFormElement))
          return;
        form.setAttribute("aria-busy", "true");
        const button = event.submitter;
        if (button) {
          button.dataset.originalLabel = button.textContent;
          button.style.minWidth = button.getBoundingClientRect().width + "px";
          button.textContent = "Procesando…";
          button.classList.add("ui-saving");
          button.disabled = true;
        }
      });
    });
    window.addEventListener("pageshow", () => {
      document.querySelectorAll(".ui-saving").forEach((button) => {
        button.textContent = button.dataset.originalLabel;
        button.disabled = false;
        button.classList.remove("ui-saving");
      });
      document
        .querySelectorAll('[aria-busy="true"]')
        .forEach((form) => form.removeAttribute("aria-busy"));
      document.body.classList.remove("ui-navigating");
    });
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (
        !link ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        link.target ||
        link.hasAttribute("download")
      )
        return;
      const url = new URL(link.href, location.href);
      if (url.origin === location.origin && url.pathname !== location.pathname)
        document.body.classList.add("ui-navigating");
    });

    document.querySelectorAll("[data-ui-menu-button]").forEach((button) => {
      const panel = button
        .closest(".ui-menu")
        ?.querySelector("[data-ui-menu-panel]");
      if (!panel) return;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const open = panel.hidden;
        closeMenus(open ? panel : null);
        panel.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
      });
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".ui-menu")) closeMenus();
    });

    document.querySelectorAll("[data-ui-dismiss='alert']").forEach((button) =>
      button.addEventListener("click", () => {
        const alert = button.closest(".alert");
        alert?.classList.add("is-leaving");
        setTimeout(() => alert?.remove(), 180);
      }),
    );

    document.querySelectorAll("[data-ui-drawer-open]").forEach((button) => {
      const drawer = document.querySelector(button.dataset.uiDrawerOpen);
      if (!drawer) return;
      button.addEventListener("click", () => {
        drawer.hidden = false;
        requestAnimationFrame(() => drawer.classList.add("is-open"));
        document.body.classList.add("ui-locked");
      });
    });
    document.querySelectorAll("[data-ui-drawer-close]").forEach((button) =>
      button.addEventListener("click", () => {
        const drawer = button.closest("[data-ui-drawer]");
        drawer?.classList.remove("is-open");
        setTimeout(() => {
          if (drawer) drawer.hidden = true;
          document.body.classList.remove("ui-locked");
        }, 180);
      }),
    );

    document
      .querySelectorAll(".btn, .nav-link, .rf-menu-card")
      .forEach((element) =>
        element.addEventListener("pointerdown", (event) => {
          const rect = element.getBoundingClientRect();
          element.style.setProperty(
            "--press-x",
            `${event.clientX - rect.left}px`,
          );
          element.style.setProperty(
            "--press-y",
            `${event.clientY - rect.top}px`,
          );
          element.classList.remove("is-pressed");
          requestAnimationFrame(() => element.classList.add("is-pressed"));
        }),
      );

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        activeModal?.hide();
        closeMenus();
        document
          .querySelectorAll("[data-ui-drawer].is-open [data-ui-drawer-close]")
          .forEach((button) => button.click());
      }
      if (event.key === "Tab" && activeModal) {
        const root = document.querySelector(".modal.is-open");
        const items = root ? focusable(root) : [];
        if (!items.length) return;
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  });

  function confirmAction(message) {
    return new Promise((resolve) => {
      const root = document.createElement("div");
      root.className = "modal ui-confirm-dialog";
      root.innerHTML =
        '<div class="modal-dialog"><div class="modal-content"><div class="modal-header"><svg class="icon"><use href="/icons.svg#i-shield"></use></svg><h2 id="confirmActionTitle">Confirmar acción</h2></div><div class="modal-body"><p id="confirmActionMessage"></p></div><div class="modal-footer"><button type="button" class="btn btn-outline-light" data-cancel>Cancelar</button><button type="button" class="btn btn-brand" data-accept>Confirmar</button></div></div></div>';
      root.querySelector("p").textContent = message;
      root.setAttribute("aria-labelledby", "confirmActionTitle");
      root.setAttribute("aria-describedby", "confirmActionMessage");
      document.body.append(root);
      const instance = modal(root);
      root.setAttribute("role", "alertdialog");
      let accepted = false;
      root
        .querySelector("[data-cancel]")
        .addEventListener("click", instance.hide);
      root.querySelector("[data-accept]").addEventListener("click", () => {
        accepted = true;
        instance.hide();
      });
      root.addEventListener(
        "ui:modal-hidden",
        () => {
          root.remove();
          resolve(accepted);
        },
        { once: true },
      );
      instance.show();
    });
  }
  window.WmsUi = {
    ...(window.WmsUi || {}),
    modal,
    closeMenus,
    confirm: confirmAction,
  };
})();
