const messages = {
  ER_DUP_ENTRY:
    "Ya existe un registro con esos datos únicos. Revisa correo, RUC, código, nombre o número de lote.",
  ER_NO_REFERENCED_ROW_2:
    "Uno de los registros relacionados no existe o ya no está disponible.",
  ER_ROW_IS_REFERENCED_2:
    "El registro no puede eliminarse porque conserva historial relacionado.",
  ER_CHECK_CONSTRAINT_VIOLATED:
    "Los datos no cumplen una regla de integridad del negocio.",
  ER_DATA_TOO_LONG: "Uno de los valores supera la longitud permitida.",
  ER_TRUNCATED_WRONG_VALUE: "Uno de los valores tiene un formato incorrecto.",
};
const publicDatabaseMessage = (error) =>
  messages[error.code] ||
  "La operación entra en conflicto con los datos actuales.";
module.exports = { publicDatabaseMessage };
