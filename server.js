const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const cron = require("node-cron");
const webPush = require("web-push");
const bcrypt = require("bcrypt");

const app = express();
const port = Number(process.env.PORT || 5000);
const dataDirectory = process.env.DATA_DIR || path.join(__dirname, "data");
const timeZone = "Europe/Madrid";
fs.mkdirSync(dataDirectory, { recursive: true });

const db = new Database(path.join(dataDirectory, "o-pachanga.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    alias TEXT,
    password_hash TEXT,
    account_status TEXT NOT NULL DEFAULT 'active'
      CHECK (account_status IN ('pending', 'active')),
    must_change_password INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    role TEXT NOT NULL CHECK (role IN ('principal', 'suplente', 'admin')),
    base_role TEXT NOT NULL DEFAULT 'principal'
      CHECK (base_role IN ('principal', 'suplente')),
    ranking_position INTEGER,
    balance REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    match_date TEXT,
    match_time TEXT NOT NULL DEFAULT '20:00',
    status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'closed', 'played', 'cancelled')),
    draft_state TEXT NOT NULL DEFAULT '{}',
    team_a TEXT NOT NULL DEFAULT '[]',
    team_b TEXT NOT NULL DEFAULT '[]',
    pitch_price REAL,
    result TEXT CHECK (result IN ('A', 'B', 'draw') OR result IS NULL)
  );

  CREATE TABLE IF NOT EXISTS convocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('principal', 'suplente', 'no_va')),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (match_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    concept TEXT NOT NULL,
    date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    match_id INTEGER REFERENCES matches(id),
    transaction_type TEXT NOT NULL DEFAULT 'manual'
      CHECK (transaction_type IN ('manual', 'match_charge', 'adjustment')),
    adjustment_of INTEGER REFERENCES transactions(id),
    status TEXT NOT NULL DEFAULT 'posted'
      CHECK (status IN ('posted', 'adjusted', 'refunded')),
    adjusted_by INTEGER REFERENCES users(id),
    adjusted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS push_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('opening', 'friday_reminder')),
    status TEXT NOT NULL DEFAULT 'sending'
      CHECK (status IN ('sending', 'sent', 'failed')),
    delivered_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT,
    UNIQUE (match_id, type)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS match_finances (
    match_id INTEGER PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
    pitch_cost REAL NOT NULL,
    fee_per_player REAL NOT NULL,
    participants INTEGER NOT NULL,
    total_collected REAL NOT NULL,
    pot_added REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS match_points (
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    points INTEGER NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('win', 'draw', 'loss')),
    PRIMARY KEY (match_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS balance_alert_campaigns (
    match_id INTEGER PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
    delivered_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT
  );
`);
db.exec(`
  UPDATE push_campaigns
  SET status = 'failed', error = 'Reintento disponible tras reiniciar el servidor'
  WHERE status = 'sending' AND created_at < datetime('now', '-15 minutes')
  ;
  UPDATE balance_alert_campaigns
  SET status = 'failed', error = 'Reintento disponible tras reiniciar el servidor'
  WHERE status = 'sending' AND created_at < datetime('now', '-15 minutes')
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
const userMigrations = [
  ["first_name", "TEXT"],
  ["last_name", "TEXT"],
  ["alias", "TEXT"],
  ["password_hash", "TEXT"],
  ["account_status", "TEXT NOT NULL DEFAULT 'active'"],
  ["must_change_password", "INTEGER NOT NULL DEFAULT 0"],
  ["deleted_at", "TEXT"],
  ["created_at", "TEXT"],
];
for (const [name, definition] of userMigrations) {
  if (!userColumns.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}
if (!userColumns.includes("base_role")) {
  db.exec(
    "ALTER TABLE users ADD COLUMN base_role TEXT NOT NULL DEFAULT 'principal' CHECK (base_role IN ('principal', 'suplente'))",
  );
  db.exec("UPDATE users SET base_role = role WHERE role IN ('principal', 'suplente')");
}
const matchColumns = db.prepare("PRAGMA table_info(matches)").all().map((column) => column.name);
if (!matchColumns.includes("pitch_price")) db.exec("ALTER TABLE matches ADD COLUMN pitch_price REAL");
if (!matchColumns.includes("match_date")) {
  db.exec("ALTER TABLE matches ADD COLUMN match_date TEXT");
}
if (!matchColumns.includes("match_time")) db.exec("ALTER TABLE matches ADD COLUMN match_time TEXT");
db.exec("UPDATE matches SET match_date = date(start_date, '+7 days') WHERE match_date IS NULL");
db.exec(`
  UPDATE matches SET match_time = CASE
    WHEN length(substr(end_date, 12, 5)) = 5 AND substr(end_date, 14, 1) = ':'
      THEN substr(end_date, 12, 5)
    ELSE '20:00'
  END
  WHERE match_time IS NULL OR trim(match_time) = ''
`);
const matchTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'matches'").get()?.sql || "";
if (!matchTableSql.includes("'cancelled'")) {
  const restoreForeignKeys = db.pragma("foreign_keys", { simple: true }) === 1;
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS matches_status_migration;
        CREATE TABLE matches_status_migration (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          match_date TEXT,
          match_time TEXT NOT NULL DEFAULT '20:00',
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open', 'closed', 'played', 'cancelled')),
          draft_state TEXT NOT NULL DEFAULT '{}',
          team_a TEXT NOT NULL DEFAULT '[]',
          team_b TEXT NOT NULL DEFAULT '[]',
          pitch_price REAL,
          result TEXT CHECK (result IN ('A', 'B', 'draw') OR result IS NULL)
        );
        INSERT INTO matches_status_migration
          (id, start_date, end_date, match_date, match_time, status, draft_state, team_a, team_b, pitch_price, result)
        SELECT id, start_date, end_date, match_date, COALESCE(match_time, '20:00'), status,
          draft_state, team_a, team_b, pitch_price, result
        FROM matches;
        DROP TABLE matches;
        ALTER TABLE matches_status_migration RENAME TO matches;
      `);
    }).immediate();
  } finally {
    db.pragma(`foreign_keys = ${restoreForeignKeys ? "ON" : "OFF"}`);
  }
}
db.exec("CREATE INDEX IF NOT EXISTS idx_matches_match_date ON matches(match_date, status)");
const transactionColumns = db.prepare("PRAGMA table_info(transactions)").all().map((column) => column.name);
const transactionMigrations = [
  ["match_id", "INTEGER REFERENCES matches(id)"],
  ["transaction_type", "TEXT NOT NULL DEFAULT 'manual' CHECK (transaction_type IN ('manual', 'match_charge', 'adjustment'))"],
  ["adjustment_of", "INTEGER REFERENCES transactions(id)"],
  ["status", "TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'adjusted', 'refunded'))"],
  ["adjusted_by", "INTEGER REFERENCES users(id)"],
  ["adjusted_at", "TEXT"],
];
for (const [name, definition] of transactionMigrations) {
  if (!transactionColumns.includes(name)) db.exec(`ALTER TABLE transactions ADD COLUMN ${name} ${definition}`);
}
const legacyMatchCharges = db.prepare(`
  SELECT id, concept FROM transactions
  WHERE transaction_type = 'manual' AND concept LIKE 'Partido #%: cuota automática'
`).all();
const migrateMatchCharge = db.prepare(`
  UPDATE transactions SET match_id = ?, transaction_type = 'match_charge'
  WHERE id = ? AND EXISTS (SELECT 1 FROM matches WHERE id = ?)
`);
for (const transaction of legacyMatchCharges) {
  const matchId = Number(transaction.concept.match(/^Partido #(\d+): cuota automática$/)?.[1]);
  if (Number.isInteger(matchId)) migrateMatchCharge.run(matchId, transaction.id, matchId);
}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_transactions_match ON transactions(match_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_adjustment ON transactions(adjustment_of, id);
`);

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_alias_unique ON users(alias COLLATE NOCASE) WHERE alias IS NOT NULL");
db.prepare("UPDATE users SET account_status = 'pending' WHERE role != 'admin' AND password_hash IS NULL AND account_status = 'active'").run();

const testResetAdminPasswordHash = "$2b$12$PL1QrpAlwd1z.AnTQRFcpuZnWcuGs4EWtitzO0rZNdQVh1MZgcvFG";
const defaultAdminPasswordHash = process.env.INITIAL_ADMIN_PASSWORD
  ? bcrypt.hashSync(process.env.INITIAL_ADMIN_PASSWORD, 12)
  : testResetAdminPasswordHash;
let defaultAdmin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
if (!defaultAdmin) {
  const createdAdmin = db.prepare(`
    INSERT INTO users (name, first_name, last_name, alias, password_hash, account_status,
      must_change_password, role, base_role, ranking_position, balance)
    VALUES ('DIEGO GAY DAVILA', 'DIEGO', 'GAY DAVILA', 'DIMOGARU', ?, 'active', 0, 'admin', 'principal', NULL, 0)
  `).run(defaultAdminPasswordHash);
  defaultAdmin = db.prepare("SELECT * FROM users WHERE id = ?").get(createdAdmin.lastInsertRowid);
} else if (!defaultAdmin.alias || !defaultAdmin.password_hash) {
  db.prepare(`
    UPDATE users SET name = 'DIEGO GAY DAVILA', first_name = 'DIEGO', last_name = 'GAY DAVILA',
      alias = COALESCE(NULLIF(alias, ''), 'DIMOGARU'),
      password_hash = COALESCE(password_hash, ?), account_status = 'active',
      must_change_password = CASE WHEN password_hash IS NULL THEN 1 ELSE must_change_password END,
      base_role = 'principal', ranking_position = NULL
    WHERE id = ?
  `).run(defaultAdminPasswordHash, defaultAdmin.id);
}
db.prepare("UPDATE users SET ranking_position = NULL, balance = 0 WHERE role = 'admin'").run();

const replitWorkspace = Boolean(process.env.REPL_ID) && process.env.REPLIT_DEPLOYMENT !== "1";
if (replitWorkspace) {
  const resetTestDatabase = db.transaction(() => {
    if (db.prepare("SELECT 1 FROM app_settings WHERE key = 'replit_test_reset_v1'").get()) return false;
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    if (!admin) throw new Error("No se puede limpiar la base de pruebas sin conservar la cuenta Admin.");

    db.prepare("DELETE FROM push_subscriptions").run();
    db.prepare("DELETE FROM push_campaigns").run();
    db.prepare("DELETE FROM balance_alert_campaigns").run();
    db.prepare("DELETE FROM match_points").run();
    db.prepare("DELETE FROM transactions").run();
    db.prepare("DELETE FROM convocations").run();
    db.prepare("DELETE FROM match_finances").run();
    db.prepare("DELETE FROM matches").run();
    db.prepare("DELETE FROM users WHERE role != 'admin'").run();
    db.prepare("DELETE FROM users WHERE role = 'admin' AND id != ?").run(admin.id);
    db.prepare(`
      UPDATE users SET name = 'DIEGO GAY DAVILA', first_name = 'DIEGO', last_name = 'GAY DAVILA',
        alias = 'DIMOGARU', password_hash = ?, role = 'admin', base_role = 'principal',
        account_status = 'active', must_change_password = 0, deleted_at = NULL,
        ranking_position = NULL, balance = 0
      WHERE id = ?
    `).run(testResetAdminPasswordHash, admin.id);
    db.prepare("DELETE FROM app_settings").run();
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('pot_cents', '0')").run();
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('replit_test_reset_v1', 'done')").run();
    db.prepare(`
      DELETE FROM sqlite_sequence
      WHERE name IN ('matches', 'convocations', 'transactions', 'push_subscriptions',
        'push_campaigns', 'match_points', 'balance_alert_campaigns')
    `).run();
    db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'users'").run(admin.id);
    return true;
  });
  if (resetTestDatabase.immediate()) {
    console.log("Limpieza inicial de la base de pruebas completada; cuenta Admin conservada.");
  }
}

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@opachanga.local";
let pushConfigured = false;
if (vapidPublicKey && vapidPrivateKey) {
  try {
    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    pushConfigured = true;
  } catch (error) {
    console.error("Configuración VAPID no válida; las notificaciones push están desactivadas.");
  }
}
if (!pushConfigured) {
  console.warn("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no configuradas; notificaciones push desactivadas.");
}

app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));
app.use(
  session({
    name: "pachanga.sid",
    secret: process.env.SESSION_SECRET || "solo-desarrollo-cambia-SESSION_SECRET",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  first_name: user.first_name,
  last_name: user.last_name,
  alias: user.alias,
  role: user.role,
  base_role: user.role === "admin" ? null : user.base_role,
  ranking_position: user.role === "admin" ? null : user.ranking_position,
  balance: user.role === "admin" ? null : user.balance,
  must_change_password: Boolean(user.must_change_password),
});

function requireUser(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Inicia sesión para continuar." });
  const account = db.prepare(`
    SELECT account_status, deleted_at, must_change_password
    FROM users WHERE id = ?
  `).get(req.session.user.id);
  if (!account || account.account_status !== "active" || account.deleted_at) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "La cuenta ya no está activa." });
  }
  if (Boolean(account.must_change_password) && req.path !== "/api/account/password") {
    return res.status(403).json({ error: "Cambia la contraseña inicial para continuar." });
  }
  req.session.user.must_change_password = Boolean(account.must_change_password);
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Se requiere una sesión de administración." });
  }
  if (req.session.user.must_change_password && req.path !== "/api/account/password") {
    return res.status(403).json({ error: "Cambia la contraseña inicial para continuar." });
  }
  next();
}

function requirePlayer(req, res, next) {
  requireUser(req, res, (error) => {
    if (error) return next(error);
    if (req.session.user.role === "admin") {
      return res.status(403).json({ error: "Esta acción está disponible solo para jugadores." });
    }
    next();
  });
}

function madridParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function shiftDate(dateString, offsetDays) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function madridDate(date = new Date()) {
  const parts = madridParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isValidDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatSpanishDate(dateString) {
  if (!isValidDateOnly(dateString)) return null;
  const parts = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).formatToParts(new Date(`${dateString}T12:00:00Z`));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const titleCase = (value) => value.charAt(0).toLocaleUpperCase("es-ES") + value.slice(1);
  return `${titleCase(values.weekday)}, ${values.day} de ${titleCase(values.month)}`;
}

function getCurrentMatch() {
  return db.prepare(`
    SELECT * FROM matches
    WHERE status IN ('open', 'closed')
    ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,
      match_date DESC, start_date DESC, id DESC
    LIMIT 1
  `).get() || null;
}

function latestCancellation() {
  const latest = db.prepare(`
    SELECT * FROM matches
    ORDER BY COALESCE(match_date, start_date) DESC, id DESC
    LIMIT 1
  `).get();
  return latest?.status === "cancelled" ? latest : null;
}

function emptyConvocationData() {
  return {
    match: null,
    cancellation: null,
    lists: { principal: [], suplentes: [], no_va: [], pending: [] },
    currentResponse: null,
    principalCount: 0,
    validForMatch: false,
    responseCount: 0,
    totalPlayers: 0,
  };
}

function getConvocationData(match, userId, { historical = false } = {}) {
  const roster = historical
    ? db.prepare(`
        SELECT u.id, u.name, u.alias, u.role, u.base_role, u.ranking_position, c.status AS response
        FROM convocations c
        JOIN users u ON u.id = c.user_id
        WHERE c.match_id = ? AND u.role != 'admin'
        ORDER BY
          CASE c.status WHEN 'principal' THEN 1 WHEN 'suplente' THEN 2 ELSE 3 END,
          u.ranking_position IS NULL, u.ranking_position, u.name COLLATE NOCASE
      `).all(match.id)
    : db.prepare(`
        SELECT u.id, u.name, u.alias, u.role, u.base_role, u.ranking_position, c.status AS response
        FROM users u
        LEFT JOIN convocations c ON c.user_id = u.id AND c.match_id = ?
        WHERE u.account_status = 'active' AND u.role != 'admin' AND u.deleted_at IS NULL
        ORDER BY
          CASE COALESCE(c.status, u.base_role)
            WHEN 'principal' THEN 1
            WHEN 'suplente' THEN 2
            WHEN 'no_va' THEN 3
            ELSE 4
          END,
          u.ranking_position IS NULL,
          u.ranking_position,
          u.name COLLATE NOCASE
      `).all(match.id);
  const principal = roster.filter((user) => user.response === "principal");
  const suplentes = roster.filter((user) => user.response === "suplente");
  const noVan = roster.filter((user) => user.response === "no_va");
  const activePlayers = roster;
  const pending = historical ? [] : activePlayers.filter((user) => user.response === null);
  const principalCount = principal.length;
  return {
    match: {
      ...matchDetails(match),
      draft: readJson(match.draft_state, {}),
      canReopen: !historical && match.status === "closed" &&
        !["in_progress", "complete"].includes(readJson(match.draft_state, {}).status),
      readOnly: historical,
      transactions: historical || match.status === "played" ? getMatchTransactions(match.id) : [],
    },
    lists: { principal, suplentes, no_va: noVan, pending },
    currentResponse: roster.find((user) => user.id === userId)?.response || null,
    principalCount,
    validForMatch: principalCount === 14 || principalCount === 16,
    responseCount: activePlayers.filter((user) => user.response !== null).length,
    totalPlayers: activePlayers.length,
  };
}

function getMatchTransactions(matchId) {
  return db.prepare(`
    SELECT t.id, t.user_id, u.alias, t.amount, t.concept, t.date,
      t.transaction_type, t.adjustment_of, t.status
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    WHERE t.match_id = ? AND u.role != 'admin'
    ORDER BY t.id
  `).all(matchId);
}

function moneyCents(value) {
  return Math.round(Number(value) * 100);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function nonAdminPlayerIds(ids) {
  const uniqueIds = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!uniqueIds.length) return [];
  const users = db.prepare(`
    SELECT id FROM users
    WHERE id IN (${uniqueIds.map(() => "?").join(",")})
      AND role != 'admin'
  `).all(...uniqueIds);
  const eligible = new Set(users.map((user) => user.id));
  return uniqueIds.filter((id) => eligible.has(id));
}

function readJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function principalRosterIds(matchId) {
  return db.prepare(`
    SELECT c.user_id
    FROM convocations c JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.status = 'principal' AND u.role != 'admin'
    ORDER BY c.id
  `).all(matchId).map((row) => row.user_id);
}

function validateDraftState(matchId, draft, teamA, teamB) {
  if (!["in_progress", "complete"].includes(draft?.status)) return "El estado del draft no es válido.";
  if (!Array.isArray(teamA) || !Array.isArray(teamB) || !Array.isArray(draft.picks)) {
    return "Faltan datos de elecciones o de equipos.";
  }
  const confirmedIds = new Set(principalRosterIds(matchId));
  const inferredRoster = [
    ...teamA,
    ...teamB,
    ...(Array.isArray(draft.picks) ? draft.picks.map((pick) => pick?.userId) : []),
    ...(Array.isArray(draft.remaining) ? draft.remaining : []),
  ].map(Number).filter(Number.isInteger);
  const roster = Array.isArray(draft.roster) ? draft.roster.map(Number) : [...new Set(inferredRoster)];
  if (![14, 16].includes(roster.length) || new Set(roster).size !== roster.length ||
      roster.some((id) => !confirmedIds.has(id))) {
    return "El draft requiere exactamente 14 o 16 jugadores confirmados para formar equipos iguales.";
  }
  if (!Number.isInteger(draft.captainA) || !Number.isInteger(draft.captainB) ||
      draft.captainA === draft.captainB || !roster.includes(draft.captainA) || !roster.includes(draft.captainB)) {
    return "Los capitanes no son válidos para esta lista.";
  }
  const pool = roster.filter((id) => id !== draft.captainA && id !== draft.captainB);
  const manualPicks = draft.picks.filter((pick) => !pick?.automatic);
  const automaticPicks = draft.picks.filter((pick) => pick?.automatic === true);
  if (automaticPicks.length > 1 ||
      (draft.status === "complete" && automaticPicks.length !== 1) ||
      (draft.status === "in_progress" && automaticPicks.length !== 0)) {
    return "La asignación automática del último jugador no coincide con el estado del draft.";
  }
  if (draft.status === "complete" && draft.picks.at(-1)?.automatic !== true) {
    return "La asignación automática debe ser la última acción del draft.";
  }

  const chosen = new Set();
  const expectedA = [draft.captainA];
  const expectedB = [draft.captainB];
  for (let index = 0; index < manualPicks.length; index += 1) {
    const pick = manualPicks[index];
    const playerId = Number(pick?.userId);
    const remainingBeforePick = pool.length - index;
    const expectedTeam = remainingBeforePick > 3
      ? index % 2 === 0 ? "B" : "A"
      : remainingBeforePick >= 2 ? "A" : null;
    if (!Number.isInteger(playerId) || !pool.includes(playerId) || chosen.has(playerId)) {
      return "Hay un jugador repetido o ajeno a la lista confirmada.";
    }
    if (!expectedTeam || pick.team !== expectedTeam) {
      return "El orden de turnos no respeta la regla del draft.";
    }
    chosen.add(playerId);
    (pick.team === "A" ? expectedA : expectedB).push(playerId);
  }

  const unpicked = pool.filter((id) => !chosen.has(id));
  if (draft.status === "complete") {
    const automaticPick = automaticPicks[0];
    const automaticId = Number(automaticPick?.userId);
    if (manualPicks.length !== pool.length - 1 || unpicked.length !== 1 ||
        !Number.isInteger(automaticId) || automaticId !== unpicked[0] || automaticPick.team !== "B" ||
        draft.currentTurn !== null || (draft.remaining || []).length !== 0) {
      return "No se puede confirmar la alineación: la elección final o el último jugador asignado no son válidos.";
    }
    expectedB.push(automaticId);
  } else {
    const remaining = Array.isArray(draft.remaining) ? draft.remaining.map(Number) : [];
    const remainingSet = new Set(remaining);
    if (remaining.length < 2 || remainingSet.size !== remaining.length ||
        remaining.length !== unpicked.length || unpicked.some((id) => !remainingSet.has(id))) {
      return "La lista de jugadores pendientes no coincide con las elecciones realizadas.";
    }
    const expectedTurn = remaining.length <= 3
      ? "A"
      : manualPicks.length % 2 === 0 ? "B" : "A";
    if (draft.currentTurn !== expectedTurn) {
      return "El turno activo no respeta el orden del draft.";
    }
  }

  const numericTeamA = teamA.map(Number);
  const numericTeamB = teamB.map(Number);
  const allTeamIds = [...numericTeamA, ...numericTeamB];
  const maxTeamSize = roster.length / 2;
  if (numericTeamA.length > maxTeamSize || numericTeamB.length > maxTeamSize) {
    return "Un equipo no puede superar la mitad de los jugadores confirmados.";
  }
  if (draft.status === "complete" &&
      (numericTeamA.length !== maxTeamSize || numericTeamB.length !== maxTeamSize)) {
    return "El draft debe terminar con el mismo número de jugadores en ambos equipos.";
  }
  if (new Set(allTeamIds).size !== allTeamIds.length ||
      numericTeamA.length !== expectedA.length || numericTeamA.some((id, index) => id !== expectedA[index]) ||
      numericTeamB.length !== expectedB.length || numericTeamB.some((id, index) => id !== expectedB[index])) {
    return "Hay jugadores duplicados o equipos que no coinciden con las elecciones guardadas.";
  }
  return null;
}

function recalculateMatchPoints(matchId, result, teamA, teamB) {
  db.prepare("DELETE FROM match_points WHERE match_id = ?").run(matchId);
  const insertPoints = db.prepare(`
    INSERT INTO match_points (match_id, user_id, points, result) VALUES (?, ?, ?, ?)
  `);
  for (const [team, outcome] of [
    [teamA, result === "draw" ? "draw" : result === "A" ? "win" : "loss"],
    [teamB, result === "draw" ? "draw" : result === "B" ? "win" : "loss"],
  ]) {
    const points = 1 + (outcome === "win" ? 3 : outcome === "draw" ? 1 : 0);
    for (const userId of team) insertPoints.run(matchId, userId, points, outcome);
  }
}

function repairCurrentLegacyDraftBalance() {
  const currentMatch = db.prepare("SELECT * FROM matches ORDER BY match_date DESC, start_date DESC, id DESC LIMIT 1").get();
  if (!currentMatch) return false;
  const draft = readJson(currentMatch.draft_state, {});
  if (draft.status !== "complete" || !Array.isArray(draft.picks)) return false;

  const automaticPicks = draft.picks
    .map((pick, index) => ({ pick, index }))
    .filter(({ pick }) => pick?.automatic === true);
  if (automaticPicks.length !== 1 || automaticPicks[0].pick.team !== "A" ||
      automaticPicks[0].index !== draft.picks.length - 1) return false;

  const roster = Array.isArray(draft.roster) ? draft.roster.map(Number) : [];
  if (![14, 16].includes(roster.length) || new Set(roster).size !== roster.length) return false;
  const captainA = Number(draft.captainA);
  const captainB = Number(draft.captainB);
  if (!roster.includes(captainA) || !roster.includes(captainB) || captainA === captainB) return false;

  const pool = roster.filter((id) => id !== captainA && id !== captainB);
  const manualPicks = draft.picks.filter((pick) => pick?.automatic !== true);
  if (manualPicks.length !== pool.length - 1) return false;
  const chosen = new Set();
  const legacyTeamA = [captainA];
  const legacyTeamB = [captainB];
  for (let index = 0; index < manualPicks.length; index += 1) {
    const pick = manualPicks[index];
    const playerId = Number(pick?.userId);
    const remainingBeforePick = pool.length - index;
    const expectedTeam = remainingBeforePick > 3
      ? index % 2 === 0 ? "B" : "A"
      : "A";
    if (!Number.isInteger(playerId) || !pool.includes(playerId) || chosen.has(playerId) ||
        pick.team !== expectedTeam) return false;
    chosen.add(playerId);
    (pick.team === "A" ? legacyTeamA : legacyTeamB).push(playerId);
  }

  const unpicked = pool.filter((id) => !chosen.has(id));
  const automaticPick = automaticPicks[0].pick;
  const automaticId = Number(automaticPick.userId);
  if (unpicked.length !== 1 || automaticId !== unpicked[0]) return false;
  legacyTeamA.push(automaticId);
  const storedTeamA = readJson(currentMatch.team_a, []);
  const storedTeamB = readJson(currentMatch.team_b, []);
  if (JSON.stringify(storedTeamA) !== JSON.stringify(legacyTeamA) ||
      JSON.stringify(storedTeamB) !== JSON.stringify(legacyTeamB) ||
      legacyTeamA.length !== roster.length / 2 + 1 ||
      legacyTeamB.length !== roster.length / 2 - 1) return false;

  const teamA = legacyTeamA.slice(0, -1);
  const teamB = [...legacyTeamB, automaticId];
  draft.picks[automaticPicks[0].index] = { ...automaticPick, team: "B" };
  const validationError = validateDraftState(currentMatch.id, draft, teamA, teamB);
  if (validationError) {
    console.error(`No se pudo reequilibrar el draft del partido #${currentMatch.id}: ${validationError}`);
    return false;
  }

  db.transaction(() => {
    db.prepare("UPDATE matches SET draft_state = ?, team_a = ?, team_b = ? WHERE id = ?")
      .run(JSON.stringify(draft), JSON.stringify(teamA), JSON.stringify(teamB), currentMatch.id);
    if (currentMatch.status === "played" && ["A", "B", "draw"].includes(currentMatch.result)) {
      recalculateMatchPoints(currentMatch.id, currentMatch.result, teamA, teamB);
    }
  }).immediate();
  console.log(`Draft del partido #${currentMatch.id} reequilibrado: ${teamA.length} en A y ${teamB.length} en B; cobro conservado.`);
  return true;
}

repairCurrentLegacyDraftBalance();

function matchDetails(match) {
  if (!match) return null;
  const matchDate = match.match_date || shiftDate(match.start_date, 7);
  const matchTime = isValidTime(match.match_time)
    ? match.match_time
    : isValidTime(match.end_date?.slice(11, 16)) ? match.end_date.slice(11, 16) : "20:00";
  const storedTeamA = readJson(match.team_a, []);
  const storedTeamB = readJson(match.team_b, []);
  const teamAIds = Array.isArray(storedTeamA) ? storedTeamA : [];
  const teamBIds = Array.isArray(storedTeamB) ? storedTeamB : [];
  const draft = readJson(match.draft_state, {});
  let draftValidationError = ["in_progress", "complete"].includes(draft.status)
    ? !Array.isArray(storedTeamA) || !Array.isArray(storedTeamB)
      ? "Faltan datos de elecciones o de equipos."
      : validateDraftState(match.id, draft, teamAIds, teamBIds)
    : null;
  if (!draftValidationError && ["closed", "played"].includes(match.status) &&
      (match.draft_state !== "{}" || teamAIds.length || teamBIds.length) &&
      !["in_progress", "complete"].includes(draft.status)) {
    draftValidationError = "El estado guardado del draft no es válido.";
  }
  const getTeam = (ids, activeOnly = false) => ids.length
    ? db.prepare(`
      SELECT id, name, alias, ranking_position FROM users
      WHERE id IN (${ids.map(() => "?").join(",")}) AND role != 'admin'
        ${activeOnly ? "AND account_status = 'active' AND deleted_at IS NULL" : ""}
    `).all(...ids)
      .sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id))
    : [];
  const available = draft.remaining?.length ? getTeam(draft.remaining, true) : [];
  const finance = db.prepare("SELECT * FROM match_finances WHERE match_id = ?").get(match.id) || null;
  const principalCount = db.prepare(`
    SELECT COUNT(*) AS count FROM convocations c
    JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.status = 'principal'
      AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
  `)
    .get(match.id).count;
  const principalPlayers = db.prepare(`
    SELECT u.id, u.name, u.alias, u.ranking_position
    FROM convocations c JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.status = 'principal'
      AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
    ORDER BY u.ranking_position IS NULL, u.ranking_position, u.name COLLATE NOCASE
  `).all(match.id);
  return {
    ...match,
    match_date: matchDate,
    match_date_label: formatSpanishDate(matchDate),
    match_time: matchTime,
    match_time_label: `${matchTime} h`,
    draft,
    draftValidationError,
    teamA: getTeam(teamAIds),
    teamB: getTeam(teamBIds),
    available,
    finance,
    principalCount,
    principalPlayers,
  };
}

function currentPot() {
  const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'pot_cents'").get();
  return Number(setting?.value || 0) / 100;
}

async function sendNegativeBalanceAlert(match) {
  if (!pushConfigured) return { skipped: true, reason: "push_not_configured" };
  const claim = db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO balance_alert_campaigns (match_id, status) VALUES (?, 'sending')")
      .run(match.id);
    const campaign = db.prepare("SELECT * FROM balance_alert_campaigns WHERE match_id = ?").get(match.id);
    if (campaign.status === "sent" || campaign.status === "sending") return { claimed: false, campaign };
    db.prepare("UPDATE balance_alert_campaigns SET status = 'sending', error = NULL WHERE match_id = ?").run(match.id);
    return { claimed: true, campaign };
  })();
  if (!claim.claimed) {
    return { alreadySent: claim.campaign.status === "sent", inProgress: claim.campaign.status === "sending" };
  }
  const recipients = db.prepare(`
    SELECT s.endpoint, s.p256dh, s.auth
    FROM push_subscriptions s
    JOIN users u ON u.id = s.user_id
    JOIN convocations c ON c.user_id = u.id AND c.match_id = ?
      AND c.status IN ('principal', 'suplente')
    WHERE u.account_status = 'active' AND u.role != 'admin'
      AND u.deleted_at IS NULL AND u.balance < 0
  `).all(match.id);
  const payload = JSON.stringify({
    title: "Saldo negativo antes de jugar",
    body: `Tienes saldo negativo. El partido es ${formatSpanishDate(match.match_date || shiftDate(match.start_date, 7))}. Revisa tu cuenta.`,
    url: "/",
  });
  const results = await Promise.allSettled(recipients.map((subscription) =>
    webPush.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, payload, { TTL: 60 * 60 * 24 }),
  ));
  const expired = [];
  let delivered = 0;
  let failed = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") delivered += 1;
    else {
      failed += 1;
      if ([404, 410].includes(result.reason?.statusCode)) expired.push(recipients[index].endpoint);
    }
  });
  const removeExpired = db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?");
  expired.forEach((endpoint) => removeExpired.run(endpoint));
  db.prepare(`
    UPDATE balance_alert_campaigns
    SET status = ?, delivered_count = ?, error = ?, sent_at = CURRENT_TIMESTAMP
    WHERE match_id = ?
  `).run(failed ? "failed" : "sent", delivered, failed ? `${failed} entregas fallidas` : null, match.id);
  return { delivered, failed, status: failed ? "failed" : "sent" };
}

async function sendCampaign(match, type) {
  if (!pushConfigured) {
    const error = new Error("Las notificaciones push no están configuradas. Define las variables VAPID.");
    error.status = 503;
    throw error;
  }
  if (!["opening", "friday_reminder"].includes(type)) {
    const error = new Error("Tipo de notificación no válido.");
    error.status = 400;
    throw error;
  }

  const claim = db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO push_campaigns (match_id, type, status) VALUES (?, ?, 'sending')")
      .run(match.id, type);
    const campaign = db.prepare("SELECT * FROM push_campaigns WHERE match_id = ? AND type = ?")
      .get(match.id, type);
    if (campaign.status === "sent" || campaign.status === "sending") {
      return { claimed: false, campaign };
    }
    db.prepare("UPDATE push_campaigns SET status = 'sending', error = NULL WHERE id = ?").run(campaign.id);
    return { claimed: true, campaign };
  })();

  if (!claim.claimed) {
    return { alreadySent: claim.campaign.status === "sent", inProgress: claim.campaign.status === "sending", delivered: claim.campaign.delivered_count };
  }

  const subscriptions = type === "opening"
    ? db.prepare("SELECT s.endpoint, s.p256dh, s.auth FROM push_subscriptions s JOIN users u ON u.id = s.user_id WHERE u.account_status = 'active' AND u.role != 'admin' AND u.deleted_at IS NULL").all()
    : db.prepare(`
        SELECT s.endpoint, s.p256dh, s.auth
        FROM push_subscriptions s
        JOIN users u ON u.id = s.user_id AND u.account_status = 'active' AND u.role != 'admin' AND u.deleted_at IS NULL
        LEFT JOIN convocations c ON c.user_id = s.user_id AND c.match_id = ?
        WHERE c.user_id IS NULL OR c.status IS NULL
      `).all(match.id);
  const matchDateLabel = formatSpanishDate(match.match_date || shiftDate(match.start_date, 7));
  const message = type === "opening"
    ? { title: "Convocatoria abierta", body: `Confirma si vienes al partido del ${matchDateLabel}.`, url: "/" }
    : { title: "Aún no te has apuntado al partido", body: `Confirma si vienes antes del ${matchDateLabel} a las 20:00 h.`, url: "/" };
  const results = await Promise.allSettled(subscriptions.map((subscription) =>
    webPush.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, JSON.stringify(message), { TTL: 60 * 60 * 24 * 3 }),
  ));
  const expired = [];
  let delivered = 0;
  const errors = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") delivered += 1;
    else {
      const statusCode = result.reason?.statusCode;
      if (statusCode === 404 || statusCode === 410) expired.push(subscriptions[index].endpoint);
      errors.push(statusCode || "error");
    }
  });
  const removeExpired = db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?");
  expired.forEach((endpoint) => removeExpired.run(endpoint));
  const status = errors.length ? "failed" : "sent";
  db.prepare(`
    UPDATE push_campaigns
    SET status = ?, delivered_count = ?, error = ?, sent_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, delivered, errors.length ? `${errors.length} entregas fallidas` : null, claim.campaign.id);
  return { delivered, failed: errors.length, status };
}

async function sendUserNotification(userId, payload) {
  if (!pushConfigured) return { skipped: true };
  const subscriptions = db.prepare(`
    SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?
  `).all(userId);
  const results = await Promise.allSettled(subscriptions.map((subscription) =>
    webPush.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, JSON.stringify(payload), { TTL: 60 * 60 * 24 }),
  ));
  let delivered = 0;
  const expired = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") delivered += 1;
    else if ([404, 410].includes(result.reason?.statusCode)) expired.push(subscriptions[index].endpoint);
  });
  const removeExpired = db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?");
  expired.forEach((endpoint) => removeExpired.run(endpoint));
  return { delivered, failed: results.length - delivered };
}

app.post("/api/register", async (req, res) => {
  const body = req.body || {};
  const firstName = String(body.first_name || "").trim().replace(/\s+/g, " ");
  const lastName = String(body.last_name || "").trim().replace(/\s+/g, " ");
  const alias = String(body.alias || "").trim().normalize("NFKC").toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const fullName = `${firstName} ${lastName}`.trim();
  if (!firstName || firstName.length > 60 || !lastName || lastName.length > 80) {
    return res.status(400).json({ error: "Indica un nombre y unos apellidos válidos." });
  }
  if (!/^[\p{L}\p{N}._-]{3,24}$/u.test(alias)) {
    return res.status(400).json({ error: "El alias debe tener entre 3 y 24 letras, números, puntos, guiones o guiones bajos." });
  }
  if (Buffer.byteLength(password, "utf8") < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ error: "La contraseña debe tener entre 8 y 72 bytes." });
  }
  if (db.prepare("SELECT id FROM users WHERE alias = ? COLLATE NOCASE").get(alias)) {
    return res.status(409).json({ error: "Ese alias ya está en uso." });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const existingPlayer = db.prepare(`
      SELECT id FROM users
      WHERE role != 'admin' AND account_status = 'pending'
        AND alias IS NULL AND password_hash IS NULL
        AND lower(trim(name)) = lower(?)
      ORDER BY id LIMIT 1
    `).get(fullName);
    let userId;
    if (existingPlayer) {
      userId = existingPlayer.id;
      db.prepare(`
        UPDATE users
        SET name = ?, first_name = ?, last_name = ?, alias = ?, password_hash = ?,
            account_status = 'pending', must_change_password = 0, created_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(fullName, firstName, lastName, alias, passwordHash, userId);
    } else {
      const created = db.prepare(`
        INSERT INTO users (name, first_name, last_name, alias, password_hash, account_status,
          role, base_role, ranking_position, balance)
        VALUES (?, ?, ?, ?, ?, 'pending', 'principal', 'principal', NULL, 0)
      `).run(fullName, firstName, lastName, alias, passwordHash);
      userId = Number(created.lastInsertRowid);
    }
    res.status(202).json({ registered: true, status: "pending", name: fullName });
  } catch (error) {
    if (String(error.code || "").includes("CONSTRAINT")) {
      return res.status(409).json({ error: "Ese alias ya está en uso." });
    }
    console.error("No se pudo registrar el usuario:", error.message);
    res.status(500).json({ error: "No se pudo completar el registro." });
  }
});

app.get("/api/users", requireUser, (_req, res) => {
  const users = db.prepare(`
    SELECT id, name, first_name, last_name, alias, role, base_role, ranking_position, balance
    FROM users
    WHERE account_status = 'active' AND role != 'admin' AND deleted_at IS NULL
    ORDER BY role, ranking_position IS NULL, ranking_position, name COLLATE NOCASE
  `).all();
  res.json(users);
});

app.get("/api/admin/pending-users", requireAdmin, (_req, res) => {
  const pendingUsers = db.prepare(`
    SELECT id, first_name, last_name, name, alias, created_at
    FROM users
    WHERE role != 'admin' AND account_status = 'pending' AND deleted_at IS NULL
      AND alias IS NOT NULL AND password_hash IS NOT NULL
    ORDER BY created_at, id
  `).all();
  res.json(pendingUsers);
});

app.post("/api/admin/pending-users/:id/approve", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const pending = db.prepare(`
    SELECT id FROM users
    WHERE id = ? AND role != 'admin' AND account_status = 'pending' AND deleted_at IS NULL
      AND alias IS NOT NULL AND password_hash IS NOT NULL
  `).get(id);
  if (!pending) return res.status(404).json({ error: "No se encontró una solicitud pendiente válida." });
  const baseRole = req.body?.base_role;
  const rankingPosition = Number(req.body?.ranking_position);
  const balance = Number(req.body?.balance);
  if (!["principal", "suplente"].includes(baseRole)) {
    return res.status(400).json({ error: "El rol base debe ser principal o suplente." });
  }
  if (!Number.isInteger(rankingPosition) || rankingPosition < 1) {
    return res.status(400).json({ error: "La posición del ranking debe ser un entero positivo." });
  }
  if (!Number.isFinite(balance) || !Number.isSafeInteger(moneyCents(balance))) return res.status(400).json({ error: "El saldo inicial debe ser válido." });
  if (db.prepare("SELECT id FROM users WHERE account_status = 'active' AND role != 'admin' AND ranking_position = ? AND id != ?").get(rankingPosition, id)) {
    return res.status(409).json({ error: "Esa posición ya está asignada a otro jugador activo." });
  }
  db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET role = ?, base_role = ?, ranking_position = ?, balance = ?, account_status = 'active'
      WHERE id = ?
    `).run(baseRole, baseRole, rankingPosition, moneyCents(balance) / 100, id);
    if (moneyCents(balance)) {
      db.prepare("INSERT INTO transactions (user_id, amount, concept) VALUES (?, ?, ?)")
        .run(id, moneyCents(balance) / 100, "Saldo inicial al aprobar la cuenta");
    }
  })();
  res.json({ approved: true, user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id)) });
});

app.get("/api/session", (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  const user = db.prepare(`
    SELECT id, name, first_name, last_name, alias, role, base_role,
      ranking_position, balance, must_change_password, account_status, deleted_at
    FROM users WHERE id = ?
  `).get(req.session.user.id);
  if (!user || user.account_status !== "active" || user.deleted_at) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }
  req.session.user = user;
  res.json({ user: publicUser(user) });
});

app.post("/api/session", async (req, res) => {
  const alias = String(req.body?.alias || "").trim().normalize("NFKC").toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const user = db.prepare(`
    SELECT id, name, first_name, last_name, alias, role, base_role,
      ranking_position, balance, password_hash, must_change_password, account_status, deleted_at
    FROM users WHERE alias = ? COLLATE NOCASE
  `).get(alias);
  if (user?.account_status === "pending" && !user.deleted_at) {
    return res.status(403).json({ error: "Tu cuenta está pendiente de aprobación." });
  }
  if (!user || user.account_status !== "active" || user.deleted_at || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Alias o contraseña incorrectos." });
  }
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.user = publicUser(user);
  res.json({ user: publicUser(user) });
});

app.post("/api/account/password", requireUser, async (req, res) => {
  const currentPassword = typeof req.body?.current_password === "string" ? req.body.current_password : "";
  const newPassword = typeof req.body?.new_password === "string" ? req.body.new_password : "";
  const user = db.prepare("SELECT password_hash FROM users WHERE id = ? AND account_status = 'active'")
    .get(req.session.user.id);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(401).json({ error: "La contraseña actual no es válida." });
  }
  if (Buffer.byteLength(newPassword, "utf8") < 8 || Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).json({ error: "La nueva contraseña debe tener entre 8 y 72 bytes." });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?")
    .run(passwordHash, req.session.user.id);
  req.session.user.must_change_password = 0;
  res.json({ updated: true });
});

app.delete("/api/session", (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: "No se pudo cerrar la sesión." });
    res.clearCookie("pachanga.sid");
    res.status(204).end();
  });
});

app.get("/api/convocations/current", requireUser, (_req, res) => {
  const match = getCurrentMatch();
  res.json(match ? getConvocationData(match, _req.session.user.id) : emptyConvocationData());
});

app.get("/api/admin/convocations/history", requireAdmin, (_req, res) => {
  const activeMatch = getCurrentMatch();
  const matches = db.prepare(`
    SELECT m.id, m.start_date, m.end_date, m.match_date, m.status, m.result,
      COUNT(CASE WHEN u.role != 'admin' THEN c.user_id END) AS response_count,
      COUNT(CASE WHEN c.status = 'principal' AND u.role != 'admin' THEN 1 END) AS principal_count
    FROM matches m
    LEFT JOIN convocations c ON c.match_id = m.id
    LEFT JOIN users u ON u.id = c.user_id
    GROUP BY m.id
    ORDER BY COALESCE(m.match_date, m.start_date) DESC, m.id DESC
  `).all().map((match) => ({
    ...match,
    match_date: match.match_date || shiftDate(match.start_date, 7),
    match_date_label: formatSpanishDate(match.match_date || shiftDate(match.start_date, 7)),
    is_active: match.id === activeMatch?.id,
  }));
  res.json({ active_match_id: activeMatch?.id || null, matches });
});

app.get("/api/convocations/:matchId", requireUser, (req, res) => {
  const matchId = Number(req.params.matchId);
  if (!Number.isInteger(matchId)) return res.status(400).json({ error: "Identificador de jornada no válido." });
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró la convocatoria." });
  const activeMatch = getCurrentMatch();
  res.json(getConvocationData(match, req.session.user.id, { historical: match.id !== activeMatch?.id }));
});

app.post("/api/admin/convocations/current/open", requireAdmin, async (req, res) => {
  const match = getCurrentMatch();
  if (!match) return res.status(404).json({ error: "No hay una convocatoria cerrada para reabrir." });
  const draft = readJson(match.draft_state, {});
  if (match.status === "played" || ["in_progress", "complete"].includes(draft.status)) {
    return res.status(409).json({ error: "No se puede reabrir una convocatoria con un draft iniciado o un partido jugado." });
  }
  if (match.status !== "closed") return res.status(409).json({ error: "La convocatoria ya está abierta." });
  db.prepare("UPDATE matches SET status = 'open', draft_state = '{}', team_a = '[]', team_b = '[]' WHERE id = ?")
    .run(match.id);
  let notification = { status: "disabled" };
  if (pushConfigured) {
    try {
      notification = await sendCampaign(db.prepare("SELECT * FROM matches WHERE id = ?").get(match.id), "opening");
    } catch (error) {
      notification = { status: "failed", error: error.message };
    }
  }
  res.json({
    ...getConvocationData(db.prepare("SELECT * FROM matches WHERE id = ?").get(match.id), req.session.user.id),
    notification,
  });
});

app.post("/api/admin/convocations/current/close", requireAdmin, (req, res) => {
  const match = getCurrentMatch();
  if (!match) return res.status(404).json({ error: "No hay una convocatoria abierta para cerrar." });
  if (match.status !== "open") return res.status(409).json({ error: "La convocatoria ya está cerrada." });
  const roster = db.prepare(`
    SELECT u.id FROM convocations c JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.status = 'principal'
      AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
    ORDER BY u.ranking_position IS NULL, u.ranking_position, u.name COLLATE NOCASE
  `).all(match.id);
  const captainA = Number(req.body?.captainA);
  const captainB = Number(req.body?.captainB);
  let draft = {};
  let teamA = [];
  let teamB = [];
  if (roster.length === 14 || roster.length === 16) {
    const ids = new Set(roster.map((player) => player.id));
    if (!Number.isInteger(captainA) || !Number.isInteger(captainB) || captainA === captainB || !ids.has(captainA) || !ids.has(captainB)) {
      return res.status(400).json({ error: "Selecciona dos jugadores distintos de la Lista Principal como capitanes A y B." });
    }
    teamA = [captainA];
    teamB = [captainB];
    draft = {
      status: "in_progress",
      captainA,
      captainB,
      currentTurn: "B",
      roster: roster.map((player) => player.id),
      remaining: roster.map((player) => player.id).filter((id) => id !== captainA && id !== captainB),
      picks: [],
    };
  }
  db.prepare("UPDATE matches SET status = 'closed', draft_state = ?, team_a = ?, team_b = ? WHERE id = ?")
    .run(JSON.stringify(draft), JSON.stringify(teamA), JSON.stringify(teamB), match.id);
  res.json(getConvocationData(db.prepare("SELECT * FROM matches WHERE id = ?").get(match.id), req.session.user.id));
});

app.post("/api/admin/convocations/new", requireAdmin, async (req, res) => {
  const matchDate = typeof req.body?.match_date === "string" ? req.body.match_date.trim() : "";
  if (!isValidDateOnly(matchDate)) {
    return res.status(400).json({ error: "Selecciona una fecha de partido válida." });
  }
  if (matchDate < madridDate()) {
    return res.status(400).json({ error: "La fecha del partido no puede estar en el pasado." });
  }

  const sourceValue = req.body?.source_match_id;
  const sourceMatchId = sourceValue == null || sourceValue === "" ? null : Number(sourceValue);
  if (sourceMatchId !== null) {
    if (!Number.isInteger(sourceMatchId)) return res.status(400).json({ error: "La jornada anterior no es válida." });
    const sourceMatch = db.prepare("SELECT id, status FROM matches WHERE id = ?").get(sourceMatchId);
    if (!sourceMatch) return res.status(404).json({ error: "No se encontró la jornada anterior." });
    if (sourceMatch.status !== "played") {
      return res.status(409).json({ error: "Finaliza el partido anterior antes de abrir una nueva convocatoria." });
    }
  }

  let schedule;
  try {
    schedule = db.transaction(() => {
      const activeMatch = getCurrentMatch();
      if (activeMatch) {
        if (activeMatch.status === "open" && activeMatch.match_date === matchDate) {
          return { match: activeMatch, created: false };
        }
        const error = new Error("Ya existe una convocatoria activa. Ciérrala y finaliza su partido antes de abrir otra.");
        error.status = 409;
        throw error;
      }
      const existingDate = db.prepare("SELECT * FROM matches WHERE match_date = ? ORDER BY id DESC LIMIT 1")
        .get(matchDate);
      if (existingDate) {
        const error = new Error("Ya existe una jornada registrada para esa fecha de partido.");
        error.status = 409;
        throw error;
      }
      const latest = db.prepare("SELECT * FROM matches ORDER BY COALESCE(match_date, start_date) DESC, id DESC LIMIT 1").get();
      if (latest && latest.status !== "played") {
        const error = new Error("Finaliza la jornada anterior antes de abrir una convocatoria nueva.");
        error.status = 409;
        throw error;
      }

      const startDate = madridDate();
      const endDate = `${matchDate}T20:00:00`;
      const insert = db.prepare(`
        INSERT INTO matches (start_date, end_date, match_date, status)
        VALUES (?, ?, ?, 'open')
      `).run(startDate, endDate, matchDate);
      return {
        match: db.prepare("SELECT * FROM matches WHERE id = ?").get(insert.lastInsertRowid),
        created: true,
      };
    }).immediate();
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("No se pudo abrir la siguiente convocatoria:", error.message);
    return res.status(500).json({ error: "No se pudo crear la nueva convocatoria." });
  }

  let notification;
  if (!pushConfigured) {
    notification = { status: "disabled", error: "Web Push no está configurado en el servidor." };
  } else {
    try {
      notification = await sendCampaign(schedule.match, "opening");
    } catch (error) {
      notification = { status: "failed", error: error.message };
    }
  }
  res.status(schedule.created ? 201 : 200).json({
    ...getConvocationData(schedule.match, req.session.user.id),
    created: schedule.created,
    notification,
  });
});

app.get("/api/matches", requireUser, (_req, res) => {
  const matches = db.prepare("SELECT * FROM matches ORDER BY COALESCE(match_date, start_date) DESC, id DESC LIMIT 12").all()
    .map(matchDetails);
  res.json({ matches, pot: currentPot() });
});

app.get("/api/standings", requireUser, (_req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.alias, u.base_role, u.ranking_position,
      COALESCE(SUM(mp.points), 0) AS points,
      COALESCE(SUM(CASE WHEN mp.result = 'win' THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN mp.result = 'draw' THEN 1 ELSE 0 END), 0) AS draws,
      COALESCE(SUM(CASE WHEN mp.result = 'loss' THEN 1 ELSE 0 END), 0) AS losses,
      COUNT(mp.match_id) AS matches_played
    FROM users u
    LEFT JOIN match_points mp ON mp.user_id = u.id
    WHERE u.account_status = 'active' AND u.role != 'admin' AND u.deleted_at IS NULL
    GROUP BY u.id
    ORDER BY points DESC, wins DESC, u.name COLLATE NOCASE
  `).all();
  res.json({ standings: rows, pot: currentPot() });
});

app.post("/api/admin/matches/:id/draft/start", requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  if (match.status !== "closed") return res.status(409).json({ error: "El draft solo se puede iniciar con la convocatoria cerrada." });
  const previousDraft = readJson(match.draft_state, {});
  if (["in_progress", "complete"].includes(previousDraft.status)) return res.status(409).json({ error: "El draft de este partido ya se inició." });
  const participants = db.prepare(`
    SELECT u.id, u.name, u.ranking_position
    FROM convocations c JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.status = 'principal'
      AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
    ORDER BY u.ranking_position IS NULL, u.ranking_position, u.name COLLATE NOCASE
  `).all(matchId);
  if (participants.length !== 14 && participants.length !== 16) {
    return res.status(409).json({ error: "El draft requiere exactamente 14 o 16 jugadores confirmados para formar equipos iguales." });
  }
  const participantById = new Map(participants.map((player) => [player.id, player]));
  const captainAId = Number(req.body?.captainA || previousDraft.captainA);
  const captainBId = Number(req.body?.captainB || previousDraft.captainB);
  if (!Number.isInteger(captainAId) || !Number.isInteger(captainBId) || captainAId === captainBId ||
      !participantById.has(captainAId) || !participantById.has(captainBId)) {
    return res.status(400).json({ error: "Designa dos jugadores distintos de la Lista Principal para iniciar el draft." });
  }
  const captainA = participantById.get(captainAId);
  const captainB = participantById.get(captainBId);
  const remaining = participants.filter((player) => player.id !== captainA.id && player.id !== captainB.id).map((player) => player.id);
  const draft = {
    status: "in_progress",
    captainA: captainA.id,
    captainB: captainB.id,
    currentTurn: "B",
    roster: participants.map((player) => player.id),
    remaining,
    picks: [],
  };
  db.prepare("UPDATE matches SET draft_state = ?, team_a = ?, team_b = ? WHERE id = ?")
    .run(JSON.stringify(draft), JSON.stringify([captainA.id]), JSON.stringify([captainB.id]), matchId);
  res.json(matchDetails(db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)));
});

app.post("/api/matches/:id/draft/pick", requirePlayer, (req, res) => {
  const matchId = Number(req.params.id);
  const playerId = Number(req.body?.userId);
  const pickerId = req.session.user.id;
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  const draft = readJson(match.draft_state, {});
  if (match.status !== "closed" || draft.status !== "in_progress") {
    return res.status(409).json({ error: "No hay un draft abierto para este partido." });
  }
  const teamA = readJson(match.team_a, []);
  const teamB = readJson(match.team_b, []);
  const integrityError = validateDraftState(matchId, draft, teamA, teamB);
  if (integrityError) {
    return res.status(409).json({
      error: `Draft inconsistente. No se guardará esta elección: ${integrityError}`,
      draftInvalid: true,
    });
  }
  const expectedCaptainId = draft.currentTurn === "A" ? draft.captainA : draft.currentTurn === "B" ? draft.captainB : null;
  if (pickerId !== expectedCaptainId) {
    return res.status(403).json({ error: "Solo puede elegir el capitán que tiene el turno activo." });
  }
  const remaining = draft.remaining || [];
  if (!Number.isInteger(playerId) || !remaining.includes(playerId)) {
    return res.status(400).json({ error: "Selecciona un jugador disponible en el draft." });
  }
  if (!db.prepare(`
    SELECT 1 FROM convocations c JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.user_id = ? AND c.status = 'principal'
      AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
  `).get(matchId, playerId)) {
    return res.status(400).json({ error: "Solo puedes elegir jugadores activos de la Lista Principal confirmada." });
  }
  const team = draft.currentTurn === "A" ? teamA : teamB;
  team.push(playerId);
  remaining.splice(remaining.indexOf(playerId), 1);
  draft.picks.push({ userId: playerId, team: draft.currentTurn });
  if (remaining.length === 0) {
    draft.status = "complete";
    draft.currentTurn = null;
  } else if (remaining.length === 1 && draft.currentTurn === "A") {
    teamB.push(remaining[0]);
    draft.picks.push({ userId: remaining[0], team: "B", automatic: true });
    remaining.length = 0;
    draft.status = "complete";
    draft.currentTurn = null;
  } else if (remaining.length === 3) {
    draft.currentTurn = "A";
  } else if (remaining.length > 3) {
    draft.currentTurn = draft.currentTurn === "A" ? "B" : "A";
  }
  const finalIntegrityError = validateDraftState(matchId, draft, teamA, teamB);
  if (finalIntegrityError) {
    return res.status(409).json({
      error: `No se puede confirmar la alineación final: ${finalIntegrityError}`,
      draftInvalid: true,
    });
  }
  db.prepare("UPDATE matches SET draft_state = ?, team_a = ?, team_b = ? WHERE id = ?")
    .run(JSON.stringify(draft), JSON.stringify(teamA), JSON.stringify(teamB), matchId);
  res.json(matchDetails(db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)));
});

app.post("/api/admin/matches/:id/price", requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const price = Number(req.body?.price_total);
  const priceCents = moneyCents(price);
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  if (!Number.isFinite(price) || price < 0 || !Number.isSafeInteger(priceCents)) {
    return res.status(400).json({ error: "Introduce un precio total válido, igual o superior a cero." });
  }
  if (match.status === "played") {
    return res.status(409).json({ error: "No se puede definir un precio retroactivo para un partido jugado." });
  }
  if (db.prepare("SELECT 1 FROM match_finances WHERE match_id = ?").get(matchId)) {
    return res.status(409).json({ error: "El cobro ya se aplicó al registrar el resultado y el precio no se puede cambiar." });
  }
  db.prepare("UPDATE matches SET pitch_price = ? WHERE id = ?").run(priceCents / 100, matchId);
  res.json({ match: matchDetails(db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)) });
});

app.post("/api/admin/matches/:id/finance", requireAdmin, (_req, res) =>
  res.status(410).json({ error: "El cobro ahora se calcula automáticamente al guardar el resultado. Configura el Precio por Partido en Finanzas." }),
);

app.post("/api/admin/matches/:id/result", requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const result = req.body?.result;
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  if (!["A", "B", "draw"].includes(result)) return res.status(400).json({ error: "El resultado debe ser A, B o empate." });
  if (!["closed", "played"].includes(match.status) || readJson(match.draft_state, {}).status !== "complete") {
    return res.status(409).json({ error: "Cierra la convocatoria y completa el draft antes de guardar el resultado." });
  }
  const rawTeamA = readJson(match.team_a, []);
  const rawTeamB = readJson(match.team_b, []);
  const draftIntegrityError = validateDraftState(matchId, readJson(match.draft_state, {}), rawTeamA, rawTeamB);
  if (draftIntegrityError) {
    return res.status(409).json({
      error: `No se puede guardar el resultado ni cobrar: draft inconsistente. ${draftIntegrityError}`,
      draftInvalid: true,
    });
  }
  const teamA = nonAdminPlayerIds(rawTeamA);
  const teamB = nonAdminPlayerIds(rawTeamB);
  const existingFinance = db.prepare("SELECT 1 FROM match_finances WHERE match_id = ?").get(matchId);
  const shouldCharge = !existingFinance && match.status !== "played";
  let charge = null;
  if (shouldCharge) {
    if (match.pitch_price == null) {
      return res.status(409).json({ error: "Configura primero el Precio por Partido en la pestaña Finanzas." });
    }
    const participants = [...new Set([...teamA, ...teamB])];
    if (!participants.length) return res.status(409).json({ error: "No hay jugadores en los equipos para aplicar el cobro." });
    const pitchCents = moneyCents(match.pitch_price);
    const feeCents = Math.ceil(pitchCents / participants.length);
    const collectedCents = feeCents * participants.length;
    if (!Number.isSafeInteger(collectedCents)) {
      return res.status(400).json({ error: "El precio es demasiado alto para calcular el cobro por jugador." });
    }
    charge = {
      participants,
      pitchCents,
      feeCents,
      collectedCents,
      potAddedCents: collectedCents - pitchCents,
    };
  }
  const saveResult = db.transaction(() => {
    const latestMatch = db.prepare("SELECT status FROM matches WHERE id = ?").get(matchId);
    const financeExists = db.prepare("SELECT 1 FROM match_finances WHERE match_id = ?").get(matchId);
    if (charge && (latestMatch?.status !== "closed" || financeExists)) charge = null;
    db.prepare("UPDATE matches SET status = 'played', result = ? WHERE id = ?").run(result, matchId);
    if (charge) {
      const insertTransaction = db.prepare(`
        INSERT INTO transactions (user_id, amount, concept, match_id, transaction_type)
        VALUES (?, ?, ?, ?, 'match_charge')
      `);
      const debitPlayer = db.prepare("UPDATE users SET balance = ROUND((balance - ?) * 100) / 100 WHERE id = ?");
      if (charge.feeCents > 0) {
        for (const userId of charge.participants) {
          debitPlayer.run(charge.feeCents / 100, userId);
          insertTransaction.run(userId, -(charge.feeCents / 100), `Partido #${matchId}: cuota automática`, matchId);
        }
      }
      const currentPotCents = moneyCents(currentPot());
      db.prepare(`
        INSERT INTO app_settings (key, value) VALUES ('pot_cents', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(currentPotCents + charge.potAddedCents));
      db.prepare(`
        INSERT INTO match_finances (match_id, pitch_cost, fee_per_player, participants, total_collected, pot_added)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        matchId,
        charge.pitchCents / 100,
        charge.feeCents / 100,
        charge.participants.length,
        charge.collectedCents / 100,
        charge.potAddedCents / 100,
      );
    }
    recalculateMatchPoints(matchId, result, teamA, teamB);
  });
  try {
    saveResult.immediate();
  } catch (error) {
    console.error("No se pudo guardar el resultado:", error.message);
    return res.status(500).json({ error: "No se pudo guardar el resultado." });
  }
  res.json({
    match: matchDetails(db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)),
    pot: currentPot(),
    charged: Boolean(charge),
  });
});

app.post("/api/admin/matches/:id/notify-negative-balances", requireAdmin, async (req, res) => {
  const matchId = Number(req.params.id);
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  try {
    res.json(await sendNegativeBalanceAlert(match));
  } catch (error) {
    res.status(500).json({ error: "No se pudieron enviar las alertas de saldo." });
  }
});

app.post("/api/convocations/me", requirePlayer, (req, res) => {
  const response = req.body?.response;
  if (!["yes", "no"].includes(response)) {
    return res.status(400).json({ error: "Elige «Sí voy» o «No voy»." });
  }
  const match = getCurrentMatch();
  if (!match) return res.status(409).json({ error: "No hay una convocatoria abierta." });
  if (match.status !== "open") {
    return res.status(409).json({ error: "La convocatoria ya está cerrada." });
  }
  const user = db.prepare("SELECT id, role, base_role FROM users WHERE id = ?")
    .get(req.session.user.id);
  if (!user) return res.status(401).json({ error: "La cuenta ya no existe." });
  const status = response === "no" ? "no_va" : user.base_role;
  db.prepare(`
    INSERT INTO convocations (match_id, user_id, status, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(match_id, user_id)
    DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `).run(match.id, user.id, status);
  res.json(getConvocationData(match, user.id));
});

app.post("/api/admin/convocations/:userId/promote", requireAdmin, (req, res) => {
  const match = getCurrentMatch();
  if (!match) return res.status(409).json({ error: "No hay una convocatoria abierta." });
  if (match.status !== "open") {
    return res.status(409).json({ error: "La convocatoria está cerrada; ya no se pueden mover jugadores." });
  }
  const userId = Number(req.params.userId);
  const response = db.prepare(`
    SELECT c.status FROM convocations c
    JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.user_id = ? AND c.status = 'suplente'
      AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
  `)
    .get(match.id, userId);
  if (!response) {
    return res.status(409).json({ error: "Solo se puede promover a alguien de la lista de suplentes." });
  }
  db.prepare("UPDATE convocations SET status = 'principal', updated_at = CURRENT_TIMESTAMP WHERE match_id = ? AND user_id = ?")
    .run(match.id, userId);
  res.json(getConvocationData(match, req.session.user.id));
});

app.get("/api/push/config", requireUser, (_req, res) => {
  res.json({ enabled: pushConfigured, publicKey: pushConfigured ? vapidPublicKey : null });
});

app.post("/api/push/subscriptions", requirePlayer, (req, res) => {
  if (!pushConfigured) {
    return res.status(503).json({ error: "Las notificaciones push aún no están configuradas en el servidor." });
  }
  const { endpoint, keys } = req.body || {};
  if (
    typeof endpoint !== "string" ||
    !endpoint.startsWith("https://") ||
    typeof keys?.p256dh !== "string" ||
    typeof keys?.auth !== "string"
  ) {
    return res.status(400).json({ error: "La suscripción del navegador no es válida." });
  }
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint)
    DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(req.session.user.id, endpoint, keys.p256dh, keys.auth);
  res.status(201).json({ subscribed: true });
});

app.delete("/api/push/subscriptions", requirePlayer, (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== "string") return res.status(400).json({ error: "Falta el endpoint de la suscripción." });
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
    .run(endpoint, req.session.user.id);
  res.status(204).end();
});

app.get("/api/admin/notifications/status", requireAdmin, (_req, res) => {
  const match = getCurrentMatch();
  if (!match) return res.json({ enabled: pushConfigured, matchId: null, campaigns: {} });
  const campaigns = db.prepare("SELECT type, status, delivered_count, sent_at FROM push_campaigns WHERE match_id = ?")
    .all(match.id);
  res.json({
    enabled: pushConfigured,
    matchId: match.id,
    campaigns: Object.fromEntries(campaigns.map((campaign) => [campaign.type, campaign])),
  });
});

app.post("/api/admin/notifications/:type", requireAdmin, async (req, res) => {
  const match = getCurrentMatch();
  if (!match) return res.status(409).json({ error: "No hay una convocatoria para enviar este aviso." });
  const type = req.params.type === "unanswered" ? "friday_reminder" : req.params.type;
  if (["opening", "friday_reminder"].includes(type) && match.status !== "open") {
    return res.status(409).json({ error: "La convocatoria está cerrada." });
  }
  try {
    if (type === "negative_balance") return res.json(await sendNegativeBalanceAlert(match));
    const result = await sendCampaign(match, type);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "No se pudo enviar la notificación." });
  }
});

app.post("/api/admin/players/:id/notify-promoted", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const match = getCurrentMatch();
  if (!match) return res.status(409).json({ error: "No hay una convocatoria abierta." });
  if (!Number.isInteger(userId)) return res.status(400).json({ error: "Selecciona un jugador válido." });
  const player = db.prepare(`
    SELECT u.id FROM users u JOIN convocations c ON c.user_id = u.id
    WHERE u.id = ? AND u.role != 'admin' AND u.account_status = 'active'
      AND u.deleted_at IS NULL AND c.match_id = ? AND c.status = 'principal'
  `).get(userId, match.id);
  if (!player) return res.status(409).json({ error: "Solo se puede avisar a un jugador de la Lista Principal." });
  const result = await sendUserNotification(userId, {
    title: "Estás en la Lista Principal",
    body: "Tu convocatoria para el partido está confirmada como jugador principal.",
    url: "/",
    tag: `promotion-${match.id}-${userId}`,
  });
  res.json(result);
});

app.get("/api/admin/users", requireAdmin, (_req, res) => {
  const users = db
    .prepare(
      "SELECT id, name, first_name, last_name, alias, role, base_role, ranking_position, balance FROM users WHERE role != 'admin' AND account_status = 'active' AND deleted_at IS NULL ORDER BY ranking_position IS NULL, ranking_position, name",
    )
    .all();
  res.json(users);
});

app.get("/api/admin/finance/overview", requireAdmin, (_req, res) => {
  const players = db.prepare(`
    SELECT id, name, alias, base_role, balance
    FROM users
    WHERE role != 'admin' AND account_status = 'active' AND deleted_at IS NULL
    ORDER BY balance ASC, name COLLATE NOCASE
  `).all();
  const transactions = db.prepare(`
    SELECT t.id, t.user_id, u.name, t.amount, t.concept, t.date,
      t.match_id, t.adjustment_of, t.transaction_type, t.status, t.adjusted_at,
      CASE WHEN t.transaction_type = 'match_charge' THEN (
        SELECT -COALESCE(SUM(CAST(ROUND(t2.amount * 100) AS INTEGER)), 0) / 100.0
        FROM transactions t2
        WHERE t2.id = t.id OR t2.adjustment_of = t.id
      ) ELSE NULL END AS current_charge,
      CASE WHEN t.transaction_type = 'match_charge' THEN 1 ELSE 0 END AS can_adjust
    FROM transactions t JOIN users u ON u.id = t.user_id
    WHERE u.role != 'admin'
    ORDER BY t.date DESC, t.id DESC LIMIT 100
  `).all();
  res.json({ players, transactions, pot: currentPot() });
});

app.post("/api/admin/finance/transactions/:id/adjust", requireAdmin, (req, res) => {
  const transactionId = Number(req.params.id);
  const action = req.body?.action;
  const reason = String(req.body?.reason || "").trim();
  if (!Number.isInteger(transactionId) || transactionId < 1) {
    return res.status(400).json({ error: "El movimiento seleccionado no es válido." });
  }
  if (!["adjust", "refund"].includes(action)) {
    return res.status(400).json({ error: "Elige corregir la cuota o devolver el cargo." });
  }
  if (!reason || reason.length > 120) {
    return res.status(400).json({ error: "Indica un motivo de hasta 120 caracteres." });
  }
  const targetAmount = action === "refund" ? 0 : Number(req.body?.target_amount);
  const targetCents = moneyCents(targetAmount);
  if (!Number.isFinite(targetAmount) || targetAmount < 0 || !Number.isSafeInteger(targetCents)) {
    return res.status(400).json({ error: "La cuota corregida debe ser un importe válido, igual o superior a cero." });
  }
  const original = db.prepare(`
    SELECT t.id FROM transactions t JOIN match_finances mf ON mf.match_id = t.match_id
    WHERE t.id = ? AND t.transaction_type = 'match_charge'
  `).get(transactionId);
  if (!original) return res.status(404).json({ error: "No se encontró un cargo de partido corregible." });

  const applyAdjustment = db.transaction(() => {
    const charge = db.prepare(`
      SELECT t.id, t.user_id, t.match_id
      FROM transactions t JOIN match_finances mf ON mf.match_id = t.match_id
      WHERE t.id = ? AND t.transaction_type = 'match_charge'
    `).get(transactionId);
    if (!charge) return { error: "El cargo ya no está disponible para corregir.", status: 409 };
    const netCents = db.prepare(`
      SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) AS cents
      FROM transactions WHERE id = ? OR adjustment_of = ?
    `).get(transactionId, transactionId).cents;
    const currentChargeCents = -netCents;
    if (!Number.isSafeInteger(currentChargeCents) || currentChargeCents < 0) {
      return { error: "El historial de este cargo es inconsistente; no se ha modificado nada.", status: 409 };
    }
    if (targetCents === currentChargeCents) {
      return { error: "La cuota indicada ya coincide con el importe cobrado.", status: 409 };
    }
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(charge.user_id)) {
      return { error: "No se encontró la cuenta asociada al cargo.", status: 409 };
    }

    const balanceDeltaCents = currentChargeCents - targetCents;
    const collectedDeltaCents = targetCents - currentChargeCents;
    const finance = db.prepare("SELECT * FROM match_finances WHERE match_id = ?").get(charge.match_id);
    const updatedCollectedCents = moneyCents(finance.total_collected) + collectedDeltaCents;
    const updatedPotAddedCents = moneyCents(finance.pot_added) + collectedDeltaCents;
    const updatedPotCents = moneyCents(currentPot()) + collectedDeltaCents;
    if (![updatedCollectedCents, updatedPotAddedCents, updatedPotCents].every(Number.isSafeInteger) ||
        updatedCollectedCents < 0) {
      return { error: "El ajuste excede el rango financiero permitido; no se ha modificado nada.", status: 400 };
    }

    const status = targetCents === 0 ? "refunded" : "adjusted";
    const targetText = (targetCents / 100).toFixed(2).replace(".", ",");
    const concept = action === "refund"
      ? `Devolución íntegra del cargo del partido #${charge.match_id}: ${reason}`
      : `Corrección de cuota del partido #${charge.match_id}; nueva cuota ${targetText} €: ${reason}`;
    db.prepare(`
      INSERT INTO transactions
        (user_id, amount, concept, match_id, transaction_type, adjustment_of)
      VALUES (?, ?, ?, ?, 'adjustment', ?)
    `).run(charge.user_id, balanceDeltaCents / 100, concept, charge.match_id, transactionId);
    db.prepare("UPDATE users SET balance = ROUND((balance + ?) * 100) / 100 WHERE id = ?")
      .run(balanceDeltaCents / 100, charge.user_id);
    db.prepare(`
      UPDATE transactions SET status = ?, adjusted_by = ?, adjusted_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, req.session.user.id, transactionId);
    db.prepare(`
      UPDATE match_finances SET total_collected = ?, pot_added = ? WHERE match_id = ?
    `).run(updatedCollectedCents / 100, updatedPotAddedCents / 100, charge.match_id);
    db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('pot_cents', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(updatedPotCents));
    return {
      adjusted: true,
      status,
      previousCharge: currentChargeCents / 100,
      newCharge: targetCents / 100,
      balanceChange: balanceDeltaCents / 100,
      pot: updatedPotCents / 100,
    };
  });
  const result = applyAdjustment.immediate();
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/admin/users/:id/balance", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const player = db.prepare(`
    SELECT id, balance FROM users
    WHERE id = ? AND role != 'admin' AND account_status = 'active' AND deleted_at IS NULL
  `).get(id);
  if (!player) return res.status(404).json({ error: "No se encontró ese jugador activo." });
  const amount = Number(req.body?.amount);
  const concept = String(req.body?.concept || "").trim();
  if (!Number.isFinite(amount) || !Number.isSafeInteger(moneyCents(amount)) || moneyCents(amount) === 0) {
    return res.status(400).json({ error: "El ajuste debe ser un importe válido distinto de cero." });
  }
  if (!concept || concept.length > 120) return res.status(400).json({ error: "Indica un concepto de hasta 120 caracteres." });
  db.transaction(() => {
    db.prepare("UPDATE users SET balance = ROUND((balance + ?) * 100) / 100 WHERE id = ?")
      .run(moneyCents(amount) / 100, id);
    db.prepare("INSERT INTO transactions (user_id, amount, concept) VALUES (?, ?, ?)")
      .run(id, moneyCents(amount) / 100, concept);
  })();
  res.json({ user: db.prepare("SELECT id, name, balance FROM users WHERE id = ?").get(id) });
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const { name, role, alias: rawAlias, password, ranking_position: rankingPosition, balance } = req.body || {};
  const cleanName = typeof name === "string" ? name.trim() : "";
  const alias = String(rawAlias || "").trim().normalize("NFKC").toLowerCase();
  const rank = rankingPosition === "" || rankingPosition == null ? null : Number(rankingPosition);
  const amount = balance === "" || balance == null ? 0 : Number(balance);
  if (!cleanName || cleanName.length > 80) {
    return res.status(400).json({ error: "El nombre es obligatorio y debe tener 80 caracteres o menos." });
  }
  if (!["principal", "suplente"].includes(role)) {
    return res.status(400).json({ error: "El rol debe ser principal o suplente." });
  }
  if (!/^[\p{L}\p{N}._-]{3,24}$/u.test(alias)) {
    return res.status(400).json({ error: "Indica un alias válido de 3 a 24 caracteres." });
  }
  if (typeof password !== "string" || Buffer.byteLength(password, "utf8") < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ error: "La contraseña debe tener entre 8 y 72 bytes." });
  }
  if (db.prepare("SELECT id FROM users WHERE alias = ? COLLATE NOCASE").get(alias)) {
    return res.status(409).json({ error: "Ese alias ya está en uso." });
  }
  if (rank !== null && (!Number.isInteger(rank) || rank < 1)) {
    return res.status(400).json({ error: "La posición del ranking debe ser un entero positivo." });
  }
  if (!Number.isFinite(amount) || !Number.isSafeInteger(moneyCents(amount))) {
    return res.status(400).json({ error: "El saldo debe ser un importe válido." });
  }
  if (rank !== null && db.prepare("SELECT id FROM users WHERE account_status = 'active' AND role != 'admin' AND ranking_position = ?").get(rank)) {
    return res.status(409).json({ error: "Esa posición ya está asignada a otro jugador activo." });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [firstName, ...lastParts] = cleanName.split(/\s+/);
    const lastName = lastParts.join(" ");
    const result = db.transaction(() => {
      const created = db.prepare(`
        INSERT INTO users (name, first_name, last_name, alias, password_hash, account_status,
          role, base_role, ranking_position, balance)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      `).run(cleanName, firstName, lastName, alias, passwordHash, role, role, rank, moneyCents(amount) / 100);
      if (moneyCents(amount)) {
        db.prepare("INSERT INTO transactions (user_id, amount, concept) VALUES (?, ?, ?)")
          .run(created.lastInsertRowid, moneyCents(amount) / 100, "Saldo inicial al crear la cuenta");
      }
      return created;
    })();
    res.status(201).json(publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid)));
  } catch (error) {
    if (String(error.code || "").includes("CONSTRAINT")) {
      return res.status(409).json({ error: "Ese alias o posición ya está en uso." });
    }
    res.status(500).json({ error: "No se pudo crear el jugador." });
  }
});

app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM users WHERE id = ? AND role != 'admin' AND account_status = 'active' AND deleted_at IS NULL").get(id);
  if (!current) return res.status(404).json({ error: "No se encontró ese jugador." });
  const body = req.body || {};
  const name = body.name === undefined ? current.name : String(body.name).trim();
  const role = body.role === undefined ? current.role : body.role;
  const rawRank = body.ranking_position === undefined ? current.ranking_position : body.ranking_position;
  const rank = rawRank === "" || rawRank == null ? null : Number(rawRank);
  const amount = body.balance === undefined ? current.balance : Number(body.balance);
  const alias = body.alias === undefined ? current.alias : String(body.alias).trim().normalize("NFKC").toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!name || name.length > 80) {
    return res.status(400).json({ error: "El nombre es obligatorio y debe tener 80 caracteres o menos." });
  }
  if (!["principal", "suplente"].includes(role)) {
    return res.status(400).json({ error: "El rol debe ser principal o suplente." });
  }
  if (rank !== null && (!Number.isInteger(rank) || rank < 1)) {
    return res.status(400).json({ error: "La posición del ranking debe ser un entero positivo." });
  }
  if (!Number.isFinite(amount) || !Number.isSafeInteger(moneyCents(amount))) {
    return res.status(400).json({ error: "El saldo debe ser un importe válido." });
  }
  if (!/^[\p{L}\p{N}._-]{3,24}$/u.test(alias || "")) {
    return res.status(400).json({ error: "El alias debe tener entre 3 y 24 caracteres." });
  }
  if (password && (Buffer.byteLength(password, "utf8") < 8 || Buffer.byteLength(password, "utf8") > 72)) {
    return res.status(400).json({ error: "La nueva contraseña debe tener entre 8 y 72 bytes." });
  }
  if (db.prepare("SELECT id FROM users WHERE alias = ? COLLATE NOCASE AND id != ?").get(alias, id)) {
    return res.status(409).json({ error: "Ese alias ya está en uso." });
  }
  if (rank !== null && db.prepare("SELECT id FROM users WHERE account_status = 'active' AND role != 'admin' AND ranking_position = ? AND id != ?").get(rank, id)) {
    return res.status(409).json({ error: "Esa posición ya está asignada a otro jugador activo." });
  }
  const [firstName, ...lastParts] = name.split(/\s+/);
  const lastName = lastParts.join(" ");
  const passwordHash = password ? await bcrypt.hash(password, 12) : current.password_hash;
  db.transaction(() => {
    db.prepare(`
      UPDATE users SET name = ?, first_name = ?, last_name = ?, alias = ?, password_hash = ?,
        role = ?, base_role = ?, ranking_position = ?, balance = ?,
        must_change_password = CASE WHEN ? != '' THEN 1 ELSE must_change_password END
      WHERE id = ?
    `).run(name, firstName, lastName, alias, passwordHash, role, role, rank, amount, password, id);
    const balanceDelta = moneyCents(amount) - moneyCents(current.balance);
    if (balanceDelta) {
      db.prepare("INSERT INTO transactions (user_id, amount, concept) VALUES (?, ?, ?)")
        .run(id, balanceDelta / 100, "Ajuste manual de saldo desde la ficha del jugador");
    }
  })();
  res.json(publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id)));
});

app.post("/api/admin/users/:id/reset-password", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const player = db.prepare(`
    SELECT id FROM users WHERE id = ? AND role != 'admin'
      AND account_status = 'active' AND deleted_at IS NULL
  `).get(id);
  if (!player) return res.status(404).json({ error: "No se encontró ese jugador activo." });
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (Buffer.byteLength(password, "utf8") < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ error: "La contraseña temporal debe tener entre 8 y 72 bytes." });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?")
    .run(passwordHash, id);
  res.json({ reset: true, must_change_password: true });
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const activeDraft = db.prepare("SELECT draft_state FROM matches WHERE status = 'closed'").all()
    .some((match) => readJson(match.draft_state, {}).status === "in_progress");
  if (activeDraft) {
    return res.status(409).json({ error: "Espera a que termine el draft antes de retirar jugadores." });
  }
  const player = db.prepare(`
    SELECT id FROM users WHERE id = ? AND role != 'admin'
      AND account_status = 'active' AND deleted_at IS NULL
  `).get(id);
  if (!player) return res.status(404).json({ error: "No se encontró ese jugador activo." });
  db.transaction(() => {
    db.prepare("UPDATE users SET account_status = 'pending', deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(id);
  })();
  res.json({ deleted: true, preservedHistory: true });
});

cron.schedule("0 10 * * 5", async () => {
  const match = getCurrentMatch();
  if (!match || match.status !== "open" || match.match_date < madridDate()) return;
  try {
    await sendCampaign(match, "friday_reminder");
  } catch (error) {
    console.error("No se pudo enviar el recordatorio de respuestas:", error.message);
  }
}, { timezone: timeZone });

cron.schedule("0 10 * * *", async () => {
  const tomorrow = shiftDate(madridDate(), 1);
  const matches = db.prepare(`
    SELECT * FROM matches
    WHERE match_date = ? AND status IN ('open', 'closed')
  `).all(tomorrow);
  for (const match of matches) {
    try {
      const result = await sendNegativeBalanceAlert(match);
      if (!result.skipped) console.log(`Alertas de saldo del partido #${match.id}: ${result.delivered || 0} enviadas.`);
    } catch (error) {
      console.error(`No se pudieron enviar las alertas de saldo del partido #${match.id}:`, error.message);
    }
  }
}, { timezone: timeZone });

app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));
app.get(/.*/, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(port, "0.0.0.0", () => {
  console.log(`O Pachanga disponible en http://0.0.0.0:${port}`);
});
