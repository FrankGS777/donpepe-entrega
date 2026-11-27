function part(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 99)
    throw new Error(`${label} debe estar entre 01 y 99`);
  return String(number).padStart(2, "0");
}

function locationCode(zoneCode, aisle, module, level, position, depth = 1) {
  const zone = String(zoneCode || "").toUpperCase();
  if (!/^[A-Z0-9-]{2,12}$/.test(zone)) throw new Error("Zona inválida");
  return `CD1-${zone}-A${part(aisle, "Pasillo")}-R${part(module, "Rack")}-N${part(level, "Nivel")}-C${part(position, "Casillero")}-D${part(depth, "Profundidad")}`;
}

module.exports = { locationCode };
