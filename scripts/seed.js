#!/usr/bin/env node

const { Pool } = require("pg");

const manuallyInvoked = process.argv.includes("--manual");
if (!manuallyInvoked && process.env.NODE_ENV !== "development") {
  throw new Error("Semilla bloqueada: usa NODE_ENV=development o ejecuta el comando manual `npm run seed`.");
}
if (!manuallyInvoked && process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Semilla bloqueada en un deployment publicado.");
}
if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL para conectar con PostgreSQL.");

const seedPasswordHash = "$2b$12$K7EvqLvkNtESiU1.84HoIe43iGq1F7Zet3G9zYh3rQms0.Ff5TtYG";
const players = [
  { alias: "Alex10", firstName: "Alejandro", lastName: "Torres", baseRole: "principal" },
  { alias: "Migue", firstName: "Miguel Ángel", lastName: "Ruiz", baseRole: "principal" },
  { alias: "DaniG", firstName: "Daniel", lastName: "García", baseRole: "principal" },
  { alias: "JaviBox", firstName: "Javier", lastName: "Martínez", baseRole: "principal" },
  { alias: "CarlosV", firstName: "Carlos", lastName: "Vidal", baseRole: "principal" },
  { alias: "Santi8", firstName: "Santiago", lastName: "López", baseRole: "principal" },
  { alias: "Guille", firstName: "Guillermo", lastName: "Navarro", baseRole: "principal" },
  { alias: "RafaStriker", firstName: "Rafael", lastName: "Benítez", baseRole: "principal" },
  { alias: "NicoP", firstName: "Nicolás", lastName: "Pérez", baseRole: "principal" },
  { alias: "FerCrack", firstName: "Fernando", lastName: "Gómez", baseRole: "principal" },
  { alias: "ManuS", firstName: "Manuel", lastName: "Sánchez", baseRole: "suplente" },
  { alias: "Hugo9", firstName: "Hugo", lastName: "Fernández", baseRole: "suplente" },
  { alias: "AdrianC", firstName: "Adrián", lastName: "Castro", baseRole: "suplente" },
  { alias: "LeoM", firstName: "Leonardo", lastName: "Morales", baseRole: "suplente" },
].map((player, index) => ({
  ...player,
  name: `${player.firstName} ${player.lastName}`,
  rankingPosition: index + 1,
}));

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query(
      "SELECT id, alias, role, ranking_position FROM users WHERE LOWER(alias) = ANY($1::text[])",
      [players.map((player) => player.alias.toLowerCase())],
    );
    const existingByAlias = new Map(existingResult.rows.map((user) => [user.alias.toLowerCase(), user]));
    for (const player of players) {
      if (existingByAlias.get(player.alias.toLowerCase())?.role === "admin") {
        throw new Error(`El alias ${player.alias} ya pertenece a una cuenta Admin; no se modificó.`);
      }
    }

    const seedIds = new Set([...existingByAlias.values()].map((user) => Number(user.id)));
    const occupied = await client.query(`
      SELECT id, alias, ranking_position FROM users
      WHERE role != 'admin' AND account_status = 'active' AND deleted_at IS NULL
        AND ranking_position BETWEEN 1 AND 14
    `);
    const occupiedRanks = occupied.rows.filter((user) => !seedIds.has(Number(user.id)));
    if (occupiedRanks.length) {
      throw new Error(`Las posiciones ${occupiedRanks.map((user) => user.ranking_position).join(", ")} ya están ocupadas; no se modificó la base.`);
    }

    for (const player of players) {
      const existing = existingByAlias.get(player.alias.toLowerCase());
      const values = [
        player.name, player.firstName, player.lastName, player.alias, seedPasswordHash,
        player.baseRole, player.baseRole, player.rankingPosition,
      ];
      if (existing) {
        await client.query(`
          UPDATE users SET name = $1, first_name = $2, last_name = $3, alias = $4, password_hash = $5,
            account_status = 'active', must_change_password = 0, deleted_at = NULL,
            role = $6, base_role = $7, ranking_position = $8, balance = 10
          WHERE id = $9
        `, [...values, existing.id]);
      } else {
        await client.query(`
          INSERT INTO users (name, first_name, last_name, alias, password_hash, account_status,
            must_change_password, role, base_role, ranking_position, balance)
          VALUES ($1, $2, $3, $4, $5, 'active', 0, $6, $7, $8, 10)
        `, values);
      }
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({
      players: players.length,
      principal: players.filter((player) => player.baseRole === "principal").length,
      suplente: players.filter((player) => player.baseRole === "suplente").length,
      note: "La semilla no abre convocatorias; Admin debe abrirlas y asignar la fecha manualmente.",
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`No se pudo ejecutar la semilla: ${error.message}`);
  process.exitCode = 1;
});
