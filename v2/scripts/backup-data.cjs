"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");

async function copyDatabases(source, destination) {
  const databases = ["identity.sqlite", "simulation.sqlite"];
  for (const name of databases) await fs.access(path.join(source, name));
  // Creating the destination without recursive prevents accidental overwrites.
  await fs.mkdir(destination, { mode: 0o700 });
  try {
    for (const name of databases) {
      const target = path.join(destination, name);
      const original = new DatabaseSync(path.join(source, name), { readOnly: true });
      try { await backup(original, target); } finally { original.close(); }
      await fs.chmod(target, 0o600);
      const copy = new DatabaseSync(target, { readOnly: true });
      try {
        if (copy.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error(`Copia inválida de ${name}.`);
      } finally { copy.close(); }
    }
  } catch (error) {
    await fs.rm(destination, { recursive: true });
    throw error;
  }
}

if (require.main === module) {
  const [action, source, destination] = process.argv.slice(2);
  if (action !== "copy-offline" || !source || !destination) {
    console.error("Detén DonPepe y ejecuta: node v2/scripts/backup-data.cjs copy-offline <origen> <destino-nuevo>");
    process.exitCode = 1;
  } else {
    copyDatabases(source, destination).then(() => console.log("Copia de las dos bases verificada."), error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { copyDatabases };
