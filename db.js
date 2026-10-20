// Entrada de PostgreSQL: database.js mantiene el Pool, DATABASE_URL,
// las transacciones asíncronas y el esquema idempotente compartido.
if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL para conectar con PostgreSQL.");
}

module.exports = require("./database");
