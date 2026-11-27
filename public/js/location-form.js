(() => {
  const form = document.querySelector("#locationForm");
  if (!form) return;

  const zones = JSON.parse(form.dataset.zones || "[]");
  const allowedProfiles = {
    REC: ["RECEPCION"],
    SEC: ["RESERVA"],
    "SEC-A": ["RESERVA"],
    "SEC-B": ["RESERVA"],
    "SEC-C": ["RESERVA"],
    VEN: ["PICKING"],
    FRI: ["RESERVA", "PICKING"],
    CON: ["RESERVA", "PICKING"],
    QUA: ["CUARENTENA"],
    DSP: ["DESPACHO"],
    "DSP-F": ["DESPACHO"],
    "DSP-C": ["DESPACHO"],
  };
  const profiles = {
    RECEPCION: {
      label: "Recepción",
      purpose: "Entrada temporal contra una orden de compra.",
      permissions: ["Recibir", "Contar"],
      prefix: "REC",
    },
    RESERVA: {
      label: "Reserva",
      purpose: "Almacenamiento de respaldo y origen de reposición.",
      permissions: ["Almacenar", "Contar"],
      prefix: "RSV",
    },
    PICKING: {
      label: "Picking de sucursales",
      purpose: "Stock activo desde el que se preparan pedidos de sucursales.",
      permissions: ["Almacenar", "Despachar", "Contar"],
      prefix: "PCK",
    },
    CUARENTENA: {
      label: "Cuarentena",
      purpose: "Aislamiento hasta revisión o liberación.",
      permissions: ["Recibir aislado", "Contar"],
      prefix: "QUA",
    },
    DESPACHO: {
      label: "Despacho / staging",
      purpose: "Consolidación temporal de pedidos preparados.",
      permissions: ["Almacenar temporal", "Contar"],
      prefix: "DSP",
    },
  };

  const zoneSelect = form.querySelector("#locationZone");
  const explainer = form.querySelector("#zoneExplanation");
  const permissions = form.querySelector("#profilePermissions");
  const codeInput = form.querySelector("#generatedLocationCode");
  const aisleInput = form.querySelector('[name="pasillo"]');
  const moduleInput = form.querySelector('[name="estante"]');
  const levelInput = form.querySelector('[name="nivel"]');
  const positionInput = form.querySelector('[name="posicion"]');
  const profileCards = [...form.querySelectorAll(".location-profile")];
  const initial = {
    code: codeInput.value,
    zone: Number(zoneSelect.value),
    aisle: Number(aisleInput.value),
    module: Number(moduleInput.value),
    level: Number(levelInput.value),
    position: Number(positionInput.value),
  };

  const selectedZone = () =>
    zones.find((zone) => Number(zone.id) === Number(zoneSelect.value));
  const selectedProfile = () =>
    form.querySelector('input[name="tipo"]:checked')?.value;

  function renderProfile() {
    const type = selectedProfile();
    const profile = profiles[type];
    profileCards.forEach((card) =>
      card.classList.toggle("selected", card.dataset.profile === type),
    );
    if (!profile) {
      permissions.replaceChildren();
      return;
    }
    permissions.replaceChildren();
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const description = document.createElement("small");
    title.textContent = `${profile.label}: permisos automáticos`;
    description.textContent = profile.purpose;
    copy.append(title, description);
    const badges = document.createElement("p");
    profile.permissions.forEach((permission) => {
      const badge = document.createElement("span");
      badge.textContent = permission;
      badges.append(badge);
    });
    permissions.append(copy, badges);

    renderCode();
  }

  function renderCode() {
    const zone = selectedZone();
    const address = [aisleInput, moduleInput, levelInput, positionInput].map((input) => Number(input.value));
    const unchanged = initial.code && Number(zoneSelect.value) === initial.zone &&
      address.every((value, index) => value === [initial.aisle, initial.module, initial.level, initial.position][index]);
    codeInput.value = unchanged ? initial.code : zone && address.every((value) => value >= 1 && value <= 99)
      ? `${zone.codigo_zona}-P${String(address[0]).padStart(2, "0")}-M${String(address[1]).padStart(2, "0")}-N${String(address[2]).padStart(2, "0")}-C${String(address[3]).padStart(2, "0")}`
      : "Completa la dirección";
  }

  function renderZone() {
    const zone = selectedZone();
    if (!zone) return;
    explainer.querySelector("small").textContent =
      `${zone.proposito} · ${zone.condicion_almacenamiento}`;
    explainer.querySelector("strong").textContent =
      `${zone.codigo_zona} · ${zone.nombre}`;
    explainer.querySelector("span").textContent = zone.descripcion;
    const allowed = allowedProfiles[zone.codigo_zona] || [];
    profileCards.forEach((card) => {
      const enabled = allowed.includes(card.dataset.profile);
      card.classList.toggle("disabled", !enabled);
      card.querySelector("input").disabled = !enabled;
    });
    const current = selectedProfile();
    if (!allowed.includes(current)) {
      const first = form.querySelector(
        `.location-profile[data-profile="${allowed[0]}"] input`,
      );
      if (first) first.checked = true;
    }
    renderProfile();
  }

  zoneSelect.addEventListener("change", renderZone);
  profileCards.forEach((card) =>
    card.querySelector("input").addEventListener("change", renderProfile),
  );
  [aisleInput, moduleInput, levelInput, positionInput].forEach((input) =>
    input.addEventListener("input", renderCode),
  );
  renderZone();
})();
