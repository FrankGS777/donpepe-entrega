"use strict";

// A read model only: explains confirmed facts without changing stock or
// treating each handling step of the same load as a new receipt.
function explainMovement(row) {
  const count = new Intl.NumberFormat("es-PE").format(row.cases || 0);
  const boxes = `${count} ${row.cases === 1 ? "caja" : "cajas"}`;
  const singular = row.cases === 1;
  const from = row.from?.label || "Origen pendiente de registrar";
  const to = row.to?.label || "Destino pendiente de registrar";
  let title = row.typeLabel || "Movimiento registrado",
    summary,
    effect = "MOVE";
  switch (row.type) {
    case "OPENING":
      title = "Existencias iniciales";
      effect = "BASELINE";
      summary = `Se ${singular ? "registró" : "registraron"} ${boxes} ${singular ? "que ya existía" : "que ya existían"} al iniciar el control. No es una compra nueva ni reconstruye operaciones anteriores.`;
      break;
    case "RECEIPT":
      title = "Entrada de proveedor";
      effect = "ENTRY";
      summary = `${boxes} ${singular ? "ingresó" : "ingresaron"} desde ${from} a ${to}. Su disponibilidad depende del control de calidad y del almacenamiento.`;
      break;
    case "STORE_RECEIPT":
      title = "Recepción confirmada en tienda";
      summary = `${to} recibió ${boxes} desde ${from}. Cambia la custodia de las cajas; no es una entrada nueva desde un proveedor.`;
      break;
    case "STORE_SALE":
      title = "Salida registrada de tienda";
      effect = "EXIT";
      summary = `Se ${singular ? "descontó" : "descontaron"} ${boxes} de ${from} mediante una salida documentada.`;
      break;
    case "SUPPLIER_RETURN":
      title = "Devolución entregada al proveedor"; effect = "EXIT";
      summary = `${boxes} salieron de ${from} hacia ${to}, con recogida documentada. La compensación económica se registra por separado.`;
      break;
    case "WRITE_OFF":
      title = "Baja de existencias";
      effect = "EXIT";
      summary = `Se ${singular ? "retiró" : "retiraron"} ${boxes} del inventario de ${from}. El motivo y el responsable quedan registrados.`;
      break;
    case "SPLIT":
      title = "Separación para preparar el pedido";
      summary = `Se ${singular ? "separó" : "separaron"} ${boxes} de una carga existente. La carga resultante conserva su relación con la carga de origen, el producto y el lote.`;
      break;
    case "DISPATCH":
      title = "Salida del camión hacia tienda";
      summary = `${boxes} ${singular ? "pasó" : "pasaron"} a estar en tránsito. La recepción en tienda todavía no está confirmada.`;
      break;
    case "RETURN":
      title = "Devolución registrada";
      summary = `${boxes} ${singular ? "pasó" : "pasaron"} de ${from} a ${to}. Una devolución no vuelve a estar disponible hasta superar la revisión correspondiente.`;
      break;
    case "DIFFERENCE":
      title = "Diferencia de recepción pendiente";
      effect = "STATE";
      summary = `Se ${singular ? "identificó" : "identificaron"} ${boxes} como diferencia pendiente. No se confirma su recepción ni su baja automáticamente.`;
      break;
    case "QUALITY_HOLD":
      title = "Carga retenida para revisión";
      effect = "STATE";
      summary = `Se mantiene la identificación de ${boxes}, con retención que impide utilizarlas para abastecer.`;
      break;
    case "QUALITY_RELEASE":
      title = "Liberación tras revisión";
      effect = "STATE";
      summary = `Se liberó la retención de ${boxes}. Las demás validaciones de vencimiento, reserva y ubicación siguen vigentes.`;
      break;
    default:
      if (row.type === "TRANSFER") {
        title =
          row.from?.id && row.from.id === row.to?.id
            ? "Posición de la carga actualizada"
            : row.to?.scope === "TRANSPORT"
              ? "Carga en el camión"
              : row.from?.scope === "TRANSPORT"
                ? "Descarga del camión"
                : row.to?.id === "PACK"
                  ? "Llegada a preparación"
                  : /^DOCK-/.test(row.to?.id || "")
                    ? "Traslado al muelle"
                    : row.targetState === "STORED"
                      ? "Almacenamiento confirmado"
                      : row.to?.scope === "DEVICE"
                        ? "Recogida por un equipo"
                        : "Traslado entre ubicaciones";
      } else effect = "STATE";
      summary =
        row.from?.id === row.to?.id
          ? row.type === "TRANSFER"
            ? `Se confirmó una nueva posición para ${boxes} en ${to}. La carga sigue bajo la misma custodia.`
            : `${boxes} ${singular ? "permanece" : "permanecen"} en ${to}; se actualizó su estado operativo.`
          : `${boxes} se ${singular ? "trasladó" : "trasladaron"} de ${from} a ${to}.`;
  }
  const effectLabel = {
    ENTRY: "Entrada de existencias",
    EXIT: "Salida de existencias",
    MOVE: "Traslado · conserva las cajas",
    STATE: "Cambio de estado · conserva las cajas",
    BASELINE: "Punto de partida del registro",
  }[effect];
  const balanceLocation = ["STORE_SALE", "WRITE_OFF", "SUPPLIER_RETURN"].includes(row.type)
    ? row.from
    : row.to;
  return {
    title,
    summary,
    effect,
    effectLabel,
    balanceLocation: balanceLocation?.label || "Ubicación del registro",
    balanceMeaning:
      "El saldo corresponde a este producto, lote y vencimiento en esa ubicación justo después del movimiento; no es el stock actual.",
  };
}

module.exports = { explainMovement };
