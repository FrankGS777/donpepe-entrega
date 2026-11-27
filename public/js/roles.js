(() => {
  const form = document.querySelector("[data-role-editor]");
  if (!form) return;
  const locked = form.dataset.roleLocked === "true";
  const profile = form.querySelector("[name=perfil]");
  const search = form.querySelector("[data-permission-search]");
  const inputs = [...form.querySelectorAll("[name=permisos]")];
  function includeDependencies(input, seen = new Set()) {
    if (seen.has(input.value)) return;
    seen.add(input.value);
    for (const name of input.dataset.dependencies.split(" ").filter(Boolean)) {
      const dependency = inputs.find((i) => i.value === name);
      if (dependency && !dependency.disabled) {
        dependency.checked = true;
        includeDependencies(dependency, seen);
      }
    }
  }
  function update() {
    const query = search.value.trim().toLocaleLowerCase("es");
    inputs.forEach((input) => {
      const row = input.closest("[data-permission-choice]");
      const allowed = locked
        ? input.checked
        : row.dataset.profiles.split(" ").includes(profile.value);
      input.disabled = locked || !allowed;
      if (!allowed && !locked) input.checked = false;
      row.hidden =
        !allowed || !row.textContent.toLocaleLowerCase("es").includes(query);
    });
    form.querySelectorAll("[data-permission-group]").forEach((group) => {
      group.hidden = !group.querySelector(
        "[data-permission-choice]:not([hidden])",
      );
    });
    form.querySelector("[data-permission-empty]").hidden = Boolean(
      form.querySelector("[data-permission-group]:not([hidden])"),
    );
    const selected = inputs.filter((i) => i.checked);
    form.querySelector("[data-permission-count]").textContent = selected.length;
    form.querySelector("[data-role-profile-summary]").textContent =
      profile.value === "operador_rf"
        ? "Terminal móvil. Ejecuta sólo tareas asignadas y operaciones RF habilitadas."
        : profile.value === "administrador_wms"
          ? "Gobierno y seguridad. Administrador único; no ejecuta movimientos RF."
          : "Escritorio operativo. Sin administración de cuentas ni ejecución física RF.";
    const summary = form.querySelector("[data-permission-summary]");
    summary.replaceChildren(
      ...selected.map((input) => {
        const text = document.createElement("span");
        text.textContent = input
          .closest("label")
          .querySelector("strong").textContent;
        return text;
      }),
    );
  }
  inputs.forEach((input) =>
    input.addEventListener("change", () => {
      if (input.checked) includeDependencies(input);
      else {
        // Quitar consulta retira las acciones dependientes, nunca las deja huérfanas.
        let changed;
        do {
          changed = false;
          inputs
            .filter((i) => i.checked)
            .forEach((i) => {
              if (
                i.dataset.dependencies
                  .split(" ")
                  .filter(Boolean)
                  .some((dep) => !inputs.find((p) => p.value === dep)?.checked)
              ) {
                i.checked = false;
                changed = true;
              }
            });
        } while (changed);
      }
      update();
    }),
  );
  profile.addEventListener("change", update);
  search.addEventListener("input", update);
  form.querySelector("[data-role-clear]").addEventListener("click", () => {
    if (!locked)
      inputs.forEach((i) => {
        i.checked = false;
      });
    update();
  });
  update();
})();
