const Catalog = require("../models/Catalog");
const AppError = require("../utils/AppError");
const labels = {
  categorias: "Categorías",
  marcas: "Marcas",
  proveedores: "Proveedores",
  ubicaciones: "Ubicaciones",
};
const normalizedCatalog = async (req) => {
  const data = { ...req.validated, activo: Boolean(req.body.activo) };
  if (req.params.type === "ubicaciones") {
    if (!req.params.id)
      throw new AppError("Las LOC del CD1 se crean desde el plano controlado, no individualmente", 409);
    const existing = await Catalog.find("ubicaciones", req.params.id);
    if (!existing || existing.modelo_plano !== "CD1")
      throw new AppError("Solo se administran direcciones activas del plano CD1", 409);
    return {
      ...existing,
      secuencia_putaway: data.secuencia_putaway,
      secuencia_pick: data.secuencia_pick,
      activo: data.activo,
    };
  }
  return data;
};
exports.index = async (req, res) => {
  const type = req.params.type;
  if (!labels[type]) throw new AppError("Catálogo no encontrado", 404);
  res.render("categorias/index", {
    title: labels[type],
    type,
    items: await Catalog.all(type, req.query),
    zones: type === "ubicaciones" ? await Catalog.zones() : [],
    filters: req.query,
  });
};
exports.newForm = async (req, res) => {
  const type = req.params.type;
  if (!labels[type]) throw new AppError("Catálogo no encontrado", 404);
  if (type === "ubicaciones") throw new AppError("El plano CD1 genera las LOC de forma controlada", 404);
  res.render("categorias/form", {
    title: `Nuevo · ${labels[type]}`,
    type,
    item:
      type === "ubicaciones"
        ? {
            activo: 1,
            zona_id: 2,
            tipo: "RESERVA",
            capacidad_unidades: 1000,
            pasillo: "01",
            estante: "01",
            nivel: 1,
            posicion: 1,
            secuencia_putaway: 100,
            secuencia_pick: 100,
            permite_almacenaje: 1,
            permite_conteo: 1,
          }
        : { activo: 1 },
    zones: type === "ubicaciones" ? await Catalog.zones() : [],
    errors: [],
  });
};
exports.create = async (req, res) => {
  if (req.params.type === "ubicaciones") throw new AppError("No se admite crear LOC fuera del plano CD1", 409);
  try {
    await Catalog.create(req.params.type, await normalizedCatalog(req));
    req.session.flash = { type: "success", message: "Registro creado." };
    return res.redirect(`/catalogos/${req.params.type}`);
  } catch (error) {
    if (!error.status || error.status >= 500) throw error;
    return res.status(error.status).render("categorias/form", {
      title: "Revisa el registro",
      type: req.params.type,
      item: { ...req.body, activo: Boolean(req.body.activo) },
      zones: req.params.type === "ubicaciones" ? await Catalog.zones() : [],
      errors: [{ msg: error.message }],
    });
  }
};
exports.editForm = async (req, res) => {
  const type = req.params.type;
  const item = await Catalog.find(type, req.params.id);
  if (!item) throw new AppError("Registro no encontrado", 404);
  res.render("categorias/form", {
    title: `Editar · ${labels[type]}`,
    type,
    item,
    zones: type === "ubicaciones" ? await Catalog.zones() : [],
    errors: [],
  });
};
exports.update = async (req, res) => {
  try {
    const data = await normalizedCatalog(req);
    if (req.params.type === "ubicaciones") {
      const current = await Catalog.find("ubicaciones", req.params.id);
      if (!current) throw new AppError("LOC no encontrada", 404);
      const usage = await Catalog.locationUsage(req.params.id);
      if (
        (!data.activo || !data.permite_picking) &&
        Number(usage.productos_picking) > 0
      )
        throw new AppError(
          `La LOC es primaria para ${usage.productos_picking} SKU; reasígnalos antes de desactivarla o cambiar su perfil`,
          409,
        );
      if (
        !data.activo &&
        (Number(usage.unidades) > 0 || Number(usage.tareas_abiertas) > 0)
      )
        throw new AppError(
          "Vacía la LOC y cierra sus tareas antes de desactivarla",
          409,
        );
      if (
        (Number(current.zona_id) !== Number(data.zona_id) ||
          String(current.pasillo) !== String(data.pasillo) ||
          String(current.estante) !== String(data.estante) ||
          Number(current.nivel) !== Number(data.nivel) ||
          Number(current.posicion) !== Number(data.posicion) ||
          String(current.codigo_loc) !== String(data.codigo_loc)) &&
        (Number(usage.unidades) > 0 ||
          Number(usage.productos_picking) > 0 ||
          Number(usage.tareas_abiertas) > 0)
      )
        throw new AppError(
          "No renombres ni muevas una LOC con stock, tareas o SKU asignados. Crea otra dirección y traslada el inventario primero",
          409,
        );
    }
    await Catalog.update(req.params.type, req.params.id, data);
    req.session.flash = {
      type: "success",
      message: "Registro actualizado.",
    };
    return res.redirect(`/catalogos/${req.params.type}`);
  } catch (error) {
    if (!error.status || error.status >= 500) throw error;
    return res.status(error.status).render("categorias/form", {
      title: "Revisa el registro",
      type: req.params.type,
      item: {
        ...req.body,
        id: req.params.id,
        activo: Boolean(req.body.activo),
      },
      zones: req.params.type === "ubicaciones" ? await Catalog.zones() : [],
      errors: [{ msg: error.message }],
    });
  }
};
exports.remove = async (req, res) => {
  if (req.params.type === "ubicaciones")
    throw new AppError("Una dirección del plano no se elimina; se desactiva sin stock ni tareas", 409);
  await Catalog.remove(req.params.type, req.params.id);
  req.session.flash = {
    type: "success",
    message:
      req.params.type === "proveedores"
        ? "Proveedor desactivado sin perder historial."
        : "Registro eliminado porque no tenía relaciones históricas.",
  };
  res.redirect(`/catalogos/${req.params.type}`);
};
