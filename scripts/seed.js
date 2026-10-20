#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3-multiple-ciphers");

const manuallyInvoked = process.argv.includes("--manual");
if (!manuallyInvoked && process.env.NODE_ENV !== "development") {
  throw new Error("Semilla bloqueada: usa NODE_ENV=development o ejecuta el comando manual `npm run seed`.");
}
if (!manuallyInvoked && process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Semilla bloqueada en un deployment publicado.");
}

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

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

const dataDirectory = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const databasePath = path.join(dataDirectory, "o-pachanga.sqlite");
if (!fs.existsSync(databasePath)) {
  throw new Error("No existe la base local. Inicia la aplicación una vez para crear el esquema y vuelve a ejecutar la semilla.");
}

let db;
try {
  db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  for (const table of ["users"]) {
    if (!tableExists(db, table)) {
      throw new Error(`Falta la tabla ${table}; inicia la aplicación una vez antes de ejecutar la semilla.`);
    }
  }

  const seed = db.transaction(() => {
    const findAlias = db.prepare("SELECT id, role FROM users WHERE alias COLLATE NOCASE = ?");
    const seedAccounts = players.map((player) => {
      const existing = findAlias.get(player.alias);
      if (existing?.role === "admin") {
        throw new Error(`El alias ${player.alias} ya pertenece a una cuenta Admin; no se modificó.`);
      }
      return { ...player, id: existing?.id ?? null };
    });
    const seedIds = new Set(seedAccounts.map((player) => player.id).filter(Number.isInteger));

    const occupiedRanks = db.prepare(`
      SELECT id, alias, ranking_position FROM users
      WHERE role != 'admin' AND account_status = 'active' AND deleted_at IS NULL
        AND ranking_position BETWEEN 1 AND 14
    `).all().filter((user) => !seedIds.has(user.id));
    if (occupiedRanks.length) {
      throw new Error(`Las posiciones de ranking ${occupiedRanks.map((user) => user.ranking_position).join(", ")} ya pertenecen a otros jugadores activos; no se modificó la base.`);
    }

    const updatePlayer = db.prepare(`
      UPDATE users SET name = ?, first_name = ?, last_name = ?, alias = ?, password_hash = ?,
        account_status = 'active', must_change_password = 0, deleted_at = NULL,
        role = ?, base_role = ?, ranking_position = ?, balance = 10
      WHERE id = ?
    `);
    const insertPlayer = db.prepare(`
      INSERT INTO users (name, first_name, last_name, alias, password_hash, account_status,
        must_change_password, role, base_role, ranking_position, balance)
      VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, 10)
    `);

    for (const player of seedAccounts) {
      const values = [
        player.name,
        player.firstName,
        player.lastName,
        player.alias,
        seedPasswordHash,
        player.baseRole,
        player.baseRole,
        player.rankingPosition,
      ];
      if (player.id) {
        updatePlayer.run(...values, player.id);
      } else {
        player.id = Number(insertPlayer.run(...values).lastInsertRowid);
        seedIds.add(player.id);
      }
    }

    return {
      players: seedAccounts.length,
      baseRolePrincipal: seedAccounts.filter((player) => player.baseRole === "principal").length,
      baseRoleSuplente: seedAccounts.filter((player) => player.baseRole === "suplente").length,
      note: "La semilla no crea ni abre convocatorias; Admin debe abrirlas y asignar la fecha del partido manualmente.",
    };
  });

  console.log(JSON.stringify(seed.immediate(), null, 2));
} catch (error) {
  console.error(`No se pudo ejecutar la semilla: ${error.message}`);
  process.exitCode = 1;
} finally {
  db?.close();
}
