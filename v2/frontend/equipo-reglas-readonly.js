const tasks = {
  PUTAWAY: "Almacenar mercancía recibida",
  PICK: "Recoger mercancía de reserva",
  PICK_TO_PACK: "Llevar a preparación",
  TO_STAGING: "Llevar a consolidación",
  RETURN_TO_QUARANTINE: "Retorno seguro a cuarentena",
  TRUCK_LOAD: "Cargar camión",
  TRUCK_UNLOAD: "Descargar y retirar carga",
  DELIVERY: "Repartir a sucursales",
  RETURN_PICKUP: "Recoger devoluciones",
};

/** Read-only operational interpretation of the administrator's device schema.
 * No command/API function is passed to this view. */
export function showEquipmentRules({
  asset,
  schema,
  showDialog,
  esc,
  photo,
  icon,
}) {
  if (!asset || !schema?.fields)
    throw Error(
      "No se pudo cargar la ficha de reglas. Actualiza la vista y vuelve a intentarlo.",
    );
  const effective = { ...schema.defaults, ...asset.settings },
    pending = asset.pendingSettings?.settings;
  const value = (field, current) => {
    if (current === undefined || current === null) return "—";
    if (field.type === "boolean")
      return current ? "Habilitada" : "Deshabilitada";
    if (field.type === "tasks")
      return (current || []).map((task) => tasks[task] || task).join(" · ");
    if (field.type === "select")
      return (
        field.options?.find((option) => option.value === current)?.label ||
        String(current)
      );
    return `${current}${/Percent$/.test(field.key) ? " %" : /Seconds$/.test(field.key) ? " s" : ""}`;
  };
  const limits = (field) => {
    if (asset.type === "INBOUND_CONVEYOR" && field.key === "transferSeconds")
      return `De ${field.min} a ${field.max} s como mínimo de control. En nuevas autorizaciones, el ciclo físico completo respeta al menos 75 s para rodillos, giro y distribuidor; una configuración mayor también se respeta. Los procesos ya iniciados conservan su plazo observado.`;
    if (field.type === "integer")
      return `De ${field.min} a ${field.max}${/Percent$/.test(field.key) ? " %" : ""}${field.key === "priority" ? ". El valor mayor tiene más preferencia." : ""}`;
    if (field.type === "boolean")
      return field.key === "commissioned" ? "La puesta en servicio debe estar validada antes de asignar trabajos. No equivale a desactivar un enclavamiento." : "Sólo afecta nuevas asignaciones; conserva el trabajo ya iniciado.";
    if (field.type === "select")
      return (field.options || []).map((option) => option.label).join(" · ");
    return `${(schema.allowedTasks || []).map((task) => tasks[task] || task).join(" · ")}${schema.mustKeepTasks?.length ? `. Siempre se conserva: ${schema.mustKeepTasks.map((task) => tasks[task] || task).join(" · ")}.` : ""}`;
  };
  const appliedAt = asset.settingsAppliedAt
    ? new Intl.DateTimeFormat("es-PE", {
        dateStyle: "medium",
        timeStyle: "short",
          timeZone: "America/Lima",
      }).format(new Date(asset.settingsAppliedAt))
    : "Configuración inicial del equipo";
  showDialog(
    `Reglas de ${asset.name}`,
    `<section class="equipment-rules-view" data-equipment-rule-view><div class="equipment-rules-hero">${photo(asset, "equipment-rules-photo")}<div><span class="eyebrow">CONFIGURACIÓN EFECTIVA</span><h3>${esc(asset.name)}</h3><p>${esc([asset.manufacturer, asset.model].filter(Boolean).join(" · "))}</p><span class="badge purple">${icon("shield")} Sólo consulta</span></div></div><div class="notice ${pending ? "warning" : ""}">${pending ? "Hay reglas nuevas pendientes. Las reglas efectivas siguen activas hasta que el equipo termine su trabajo y pueda aplicarlas de forma segura." : "Estas reglas están activas. Administración gestiona su configuración; Operaciones consulta y supervisa su ejecución."}</div><div class="equipment-rules-grid">${schema.fields.map((field) => `<article class="equipment-rule-item ${pending && JSON.stringify(pending[field.key]) !== JSON.stringify(effective[field.key]) ? "has-pending" : ""}" data-rule-key="${esc(field.key)}"><h4>${esc(field.label)}</h4><dl><div><dt>En uso</dt><dd>${esc(value(field, effective[field.key]))}</dd></div>${pending ? `<div class="equipment-rule-pending"><dt>Próxima aplicación</dt><dd>${esc(value(field, pending[field.key]))}</dd></div>` : ""}</dl><p><strong>Límites y alcance</strong>${esc(limits(field))}</p></article>`).join("")}</div>${asset.type === "AMR" ? '<div class="notice">La reanudación después de recargar debe superar por al menos 30 puntos el umbral de entrada a carga. Los retornos seguros a cuarentena siempre permanecen habilitados.</div>' : ""}<p class="field-hint">${esc(appliedAt)}. Esta ventana es informativa y no modifica el equipo, sus tareas ni las reglas.</p></section><div class="dialog-actions"><button type="button" class="btn secondary" data-action="close-dialog">Cerrar consulta</button></div>`,
    "OPERACIONES · REGLAS DEL EQUIPO",
  );
}
