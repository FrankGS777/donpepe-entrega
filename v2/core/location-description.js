"use strict";

const pad = (value) => String(value).padStart(2, "0");
function compactLocationLabel(value) {
  const normalized = (text) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es")
      .trim();
  return String(value || "")
    .split(" · ")
    .filter(
      (part, index, parts) =>
        part &&
        !parts
          .slice(0, index)
          .some((previous) => normalized(previous).includes(normalized(part))),
    )
    .join(" · ");
}
function describeLocation(state, id) {
  if (!id)
    return { id: null, code: "", label: "Ubicación pendiente de asignar" };
  const location = state.layout?.locations?.find((row) => row.id === id);
  if (location) {
    const zone = state.layout.zones?.find((row) => row.id === location.zoneId);
    const components = {
      center: state.layout.name || "Centro de distribución DonPepe",
      zone: zone?.name || location.zoneId,
      aisle: location.aisle,
      rack: location.module,
      level: location.level,
      position: location.slot,
      depth: location.depth || 1,
    };
    const label = [
      components.center,
      components.zone,
      `Pasillo ${pad(components.aisle)}`,
      location.kind === "FLOOR"
        ? `Plaza en piso ${pad(components.position)}`
        : `Rack ${pad(components.rack)} · Nivel ${pad(components.level)} · Posición ${pad(components.position)}`,
      components.depth > 1 ? `Profundidad ${components.depth}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return { id, code: location.code || id, label, components };
  }
  const branch = state.catalog?.branches?.find((row) => row.id === id);
  const device = [...(state.robots || []), ...(state.trucks || [])].find(
    (row) => row.id === id,
  );
  const station =
    state.layout?.stations?.find((row) => row.id === id) ||
    state.layout?.automation?.stations?.find((row) => row.id === id);
  const slot = state.layout?.loadingDocks
    ?.flatMap((row) => row.stagingSlots || [])
    .find((row) => row.id === id);
  const label = branch
    ? compactLocationLabel(
        [branch.name, branch.district, branch.address]
          .filter(Boolean)
          .join(" · "),
      )
    : device
      ? `${device.name || id} · carga bajo custodia del equipo`
      : station
        ? `${state.layout.name || "Centro de distribución"} · ${station.name || id}`
        : slot
          ? `Muelle ${String(slot.dockId).split("-").at(-1)} · Plaza de consolidación ${String(id).split("-").at(-1)}`
          : id.startsWith("INCIDENT-")
            ? "Mercancía con diferencia pendiente de conciliación"
            : id;
  return { id, code: id, label };
}

module.exports = { describeLocation, compactLocationLabel };
