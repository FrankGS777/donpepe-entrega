const LOCATION_PROFILES = Object.freeze({
  RECEPCION: Object.freeze({
    label: "Recepción",
    purpose: "Ingreso temporal y control contra la orden de compra",
    permite_recepcion: true,
    permite_almacenaje: false,
    permite_picking: false,
    permite_conteo: true,
  }),
  RESERVA: Object.freeze({
    label: "Reserva",
    purpose: "Stock de respaldo para put-away y reabastecimiento",
    permite_recepcion: false,
    permite_almacenaje: true,
    permite_picking: false,
    permite_conteo: true,
  }),
  PICKING: Object.freeze({
    label: "Picking",
    purpose: "Stock activo para preparación de pedidos internos",
    permite_recepcion: false,
    permite_almacenaje: true,
    permite_picking: true,
    permite_conteo: true,
  }),
  DESPACHO: Object.freeze({
    label: "Despacho / staging",
    purpose: "Consolidación temporal de pedidos preparados",
    permite_recepcion: false,
    permite_almacenaje: true,
    permite_picking: false,
    permite_conteo: true,
  }),
  CUARENTENA: Object.freeze({
    label: "Cuarentena",
    purpose: "Aislamiento de inventario no liberado o con incidencia",
    permite_recepcion: true,
    permite_almacenaje: true,
    permite_picking: false,
    permite_conteo: true,
  }),
});

const ZONE_ALLOWED_TYPES = Object.freeze({
  REC: Object.freeze(["RECEPCION"]),
  "REC-F": Object.freeze(["RECEPCION"]),
  "REC-C": Object.freeze(["RECEPCION"]),
  SEC: Object.freeze(["RESERVA"]),
  "SEC-A": Object.freeze(["RESERVA"]),
  "SEC-B": Object.freeze(["RESERVA"]),
  "SEC-C": Object.freeze(["RESERVA"]),
  VEN: Object.freeze(["PICKING"]),
  FRI: Object.freeze(["RESERVA", "PICKING"]),
  CON: Object.freeze(["RESERVA", "PICKING"]),
  QUA: Object.freeze(["CUARENTENA"]),
  "QUA-F": Object.freeze(["CUARENTENA"]),
  "QUA-C": Object.freeze(["CUARENTENA"]),
  DSP: Object.freeze(["DESPACHO"]),
  "DSP-F": Object.freeze(["DESPACHO"]),
  "DSP-C": Object.freeze(["DESPACHO"]),
});

const locationProfile = (type) => LOCATION_PROFILES[type] || null;
const isTypeAllowedInZone = (type, zoneCode) =>
  Boolean(ZONE_ALLOWED_TYPES[zoneCode]?.includes(type));

module.exports = {
  LOCATION_PROFILES,
  ZONE_ALLOWED_TYPES,
  locationProfile,
  isTypeAllowedInZone,
};
