#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Sqlite = require("better-sqlite3-multiple-ciphers");
const { Pool } = require("pg");
const db = require("../db");

const sqlitePath = path.resolve(
  process.env.SQLITE_SOURCE || process.env.DB_PATH || path.join(__dirname, "../data/database.sqlite"),
);
const tableOrder = [
  "users",
  "matches",
  "convocations",
  "transactions",
  "push_subscriptions",
  "push_campaigns",
  "app_settings",
  "match_finances",
  "match_points",
  "standing_adjustments",
  "balance_alert_campaigns",
];
const idTables = new Set([
  "users",
  "matches",
  "convocations",
  "transactions",
  "push_subscriptions",
  "push_campaigns",
  "standing_adjustments",
]);
const foreignKeys = {
  convocations: { user_id: "users", match_id: "matches", invited_by_user_id: "users" },
  transactions: { user_id: "users", match_id: "matches", adjusted_by: "users", adjustment_of: "transactions" },
  push_subscriptions: { user_id: "users" },
  push_campaigns: { match_id: "matches" },
  match_finances: { match_id: "matches" },
  match_points: { match_id: "matches", user_id: "users" },
  standing_adjustments: { user_id: "users", admin_id: "users" },
  balance_alert_campaigns: { match_id: "matches" },
};
const targetTables = [...tableOrder];

function readSqliteSnapshot(file) {
  if (!fs.existsSync(file)) throw new Error(`No existe el archivo SQLite indicado: ${file}`);
  const sqlite = new Sqlite(file, { readonly: true, fileMustExist: true });
  try {
    const available = new Set(sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).all().map(({ name }) => name));
    const snapshot = {};
    for (const table of tableOrder) {
      if (!available.has(table)) continue;
      const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all().map(({ name }) => name);
      const orderBy = columns.includes("id") ? "id" : columns.join(", ");
      snapshot[table] = {
        columns,
        rows: sqlite.prepare(`SELECT * FROM "${table}" ORDER BY ${orderBy}`).all(),
      };
    }
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    return { snapshot, fingerprint };
  } finally {
    sqlite.close();
  }
}

function remapRow(table, row, idMaps, { deferAdjustment = false } = {}) {
  const copy = { ...row };
  for (const [column, referencedTable] of Object.entries(foreignKeys[table] || {})) {
    if (copy[column] == null) continue;
    if (deferAdjustment && table === "transactions" && column === "adjustment_of") {
      copy[column] = null;
      continue;
    }
    const mappedId = idMaps[referencedTable]?.get(Number(copy[column]));
    if (!mappedId) throw new Error(`No se pudo enlazar ${table}.${column}=${copy[column]}.`);
    copy[column] = mappedId;
  }
  return copy;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL; no se ha leído ni mostrado su valor.");
  const { snapshot, fingerprint } = readSqliteSnapshot(sqlitePath);
  if (!snapshot.users?.rows.length || !snapshot.matches?.rows.length) {
    throw new Error("La SQLite seleccionada no contiene usuarios y partidos para importar.");
  }

  await db.initialize();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const idMaps = Object.fromEntries([...idTables].map((table) => [table, new Map()]));
  const counts = {};

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS opachanga_sqlite_imports (
        fingerprint TEXT PRIMARY KEY,
        source_name TEXT NOT NULL,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        row_counts JSONB NOT NULL
      )
    `);
    const prior = await client.query(
      "SELECT fingerprint FROM opachanga_sqlite_imports WHERE fingerprint = $1",
      [fingerprint],
    );
    if (prior.rowCount) {
      console.log(JSON.stringify({ status: "already_imported", source: path.basename(sqlitePath), fingerprint }));
      return;
    }

    await client.query("BEGIN");
    for (const table of targetTables) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
      const count = rows[0].count;
      if (table === "users" ? count !== 1 : count !== 0) {
        throw new Error(`Destino no vacío en ${table} (${count} filas); se cancela sin modificar datos.`);
      }
    }

    const { rows: targetAdmins } = await client.query(
      "SELECT id, alias, role FROM users WHERE role = 'admin' ORDER BY id",
    );
    const sourceAdmins = snapshot.users.rows.filter((user) => user.role === "admin");
    if (targetAdmins.length !== 1 || sourceAdmins.length !== 1 ||
        String(targetAdmins[0].alias).toLowerCase() !== String(sourceAdmins[0].alias).toLowerCase()) {
      throw new Error("El Admin de SQLite no coincide con el Admin inicial de PostgreSQL; no se importó ningún dato.");
    }
    idMaps.users.set(Number(sourceAdmins[0].id), Number(targetAdmins[0].id));

    const targetColumns = new Map();
    for (const table of tableOrder) {
      const result = await client.query(
        "SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
        [table],
      );
      targetColumns.set(table, new Map(result.rows.map((column) => [column.column_name, column])));
    }

    for (const table of tableOrder) {
      const rows = snapshot[table]?.rows || [];
      counts[table] = 0;
      for (const sourceRow of rows) {
        if (table === "users" && sourceRow.role === "admin") continue;
        const row = remapRow(table, sourceRow, idMaps, { deferAdjustment: true });
        const allowed = targetColumns.get(table);
        const columns = Object.keys(row).filter((column) => {
          const destination = allowed.get(column);
          if (!destination) return false;
          return !(row[column] == null && destination.is_nullable === "NO" && destination.column_default);
        });
        if (!columns.length) throw new Error(`No hay columnas compatibles para importar ${table}.`);
        const values = columns.map((column) => row[column]);
        const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
        const idColumn = idTables.has(table) ? "id" : null;
        const sql = `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${placeholders})${idColumn ? " RETURNING id" : ""}`;
        const result = await client.query(sql, values);
        const newId = idColumn ? Number(result.rows[0]?.id ?? sourceRow.id) : null;
        if (idColumn) idMaps[table].set(Number(sourceRow.id), newId);
        counts[table] += 1;
      }
    }

    for (const row of snapshot.transactions?.rows || []) {
      if (row.adjustment_of == null) continue;
      const childId = idMaps.transactions.get(Number(row.id));
      const parentId = idMaps.transactions.get(Number(row.adjustment_of));
      if (!childId || !parentId) throw new Error("No se pudo conservar la relación de un ajuste financiero.");
      await client.query("UPDATE transactions SET adjustment_of = $1 WHERE id = $2", [parentId, childId]);
    }

    for (const table of idTables) {
      await client.query(
        "SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM " + `"${table}"` + "), 1), true)",
        [`public.${table}`],
      );
    }
    await client.query(
      "INSERT INTO opachanga_sqlite_imports (fingerprint, source_name, row_counts) VALUES ($1, $2, $3::jsonb)",
      [fingerprint, path.basename(sqlitePath), JSON.stringify(counts)],
    );
    await client.query("COMMIT");
    console.log(JSON.stringify({ status: "imported", source: path.basename(sqlitePath), fingerprint, rows: counts }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`No se completó la migración SQLite → PostgreSQL: ${error.message}`);
  process.exitCode = 1;
});
