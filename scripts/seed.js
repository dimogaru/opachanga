#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

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

function madridParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function formatUtcDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dateOffset(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

function currentConvocationDates() {
  const now = madridParts();
  const tuesday = new Date(Date.UTC(Number(now.year), Number(now.month) - 1, Number(now.day)));
  const daysSinceTuesday = (tuesday.getUTCDay() - 2 + 7) % 7;
  tuesday.setUTCDate(tuesday.getUTCDate() - daysSinceTuesday);
  const startDate = formatUtcDate(tuesday);
  return { startDate, endDate: `${dateOffset(startDate, 6)}T20:00:00`, now: `${now.year}-${now.month}-${now.day}T${now.hour}:${now.minute}:00` };
}

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
  for (const table of ["users", "matches", "convocations"]) {
    if (!tableExists(db, table)) {
      throw new Error(`Falta la tabla ${table}; inicia la aplicación una vez antes de ejecutar la semilla.`);
    }
  }

  const seed = db.transaction(() => {
    const { startDate, endDate, now } = currentConvocationDates();
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

    let match = db.prepare("SELECT * FROM matches WHERE start_date = ?").get(startDate);
    if (!match) {
      const created = db.prepare(`
        INSERT INTO matches (start_date, end_date, status) VALUES (?, ?, 'open')
      `).run(startDate, endDate);
      match = db.prepare("SELECT * FROM matches WHERE id = ?").get(created.lastInsertRowid);
    }
    if (match.status !== "open" || now >= match.end_date) {
      throw new Error(`La convocatoria del ${startDate} no está abierta; no se reabrió ni modificó.`);
    }
    if (match.result || JSON.parse(match.draft_state || "{}").status ||
        JSON.parse(match.team_a || "[]").length || JSON.parse(match.team_b || "[]").length ||
        db.prepare("SELECT 1 FROM match_finances WHERE match_id = ?").get(match.id) ||
        db.prepare("SELECT 1 FROM match_points WHERE match_id = ?").get(match.id)) {
      throw new Error("La convocatoria ya tiene draft, resultado o actividad financiera/deportiva; no se modificó.");
    }

    const placeholders = [...seedIds].map(() => "?").join(", ");
    const otherResponses = db.prepare(`
      SELECT u.alias FROM convocations c JOIN users u ON u.id = c.user_id
      WHERE c.match_id = ? AND u.role != 'admin' AND u.account_status = 'active'
        AND u.deleted_at IS NULL AND u.id NOT IN (${placeholders})
    `).all(match.id, ...seedIds);
    if (otherResponses.length) {
      throw new Error(`La convocatoria ya tiene respuestas de otros jugadores (${otherResponses.map((user) => user.alias).join(", ")}); no se modificó.`);
    }

    const setYes = db.prepare(`
      INSERT INTO convocations (match_id, user_id, status)
      VALUES (?, ?, 'principal')
      ON CONFLICT(match_id, user_id) DO UPDATE SET status = 'principal', updated_at = CURRENT_TIMESTAMP
    `);
    for (const player of seedAccounts) setYes.run(match.id, player.id);

    return {
      matchId: match.id,
      startDate,
      players: seedAccounts.length,
      baseRolePrincipal: seedAccounts.filter((player) => player.baseRole === "principal").length,
      baseRoleSuplente: seedAccounts.filter((player) => player.baseRole === "suplente").length,
      confirmedInListaPrincipal: seedAccounts.length,
      note: "Los cuatro suplentes conservan su rol base y quedan promovidos en esta convocatoria para habilitar el draft de 14.",
    };
  });

  console.log(JSON.stringify(seed.immediate(), null, 2));
} catch (error) {
  console.error(`No se pudo ejecutar la semilla: ${error.message}`);
  process.exitCode = 1;
} finally {
  db?.close();
}
