const path = require("node:path");
const express = require("express");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const db = require("./db");
const cron = require("node-cron");
const webPush = require("web-push");
const bcrypt = require("bcrypt");

const app = express();
const port = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const PgSessionStore = connectPgSimple(session);
const timeZone = "Europe/Madrid";
const defaultSubstitutePassword = "Pachanga123#";
const maxProfilePhotoBytes = 256 * 1024;
/*
  Legacy SQLite initialization is intentionally disabled. The active startup
  path uses the PostgreSQL initializer in db.initialize().
const databasePath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve("./data/database.sqlite");
const timeZone = "Europe/Madrid";
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
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
    invited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
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

  CREATE TABLE IF NOT EXISTS standing_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    admin_id INTEGER NOT NULL REFERENCES users(id),
    points_delta INTEGER NOT NULL,
    matches_played_delta INTEGER NOT NULL,
    wins_delta INTEGER NOT NULL,
    draws_delta INTEGER NOT NULL,
    losses_delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_standing_adjustments_user
    ON standing_adjustments(user_id, id);

  CREATE TABLE IF NOT EXISTS balance_alert_campaigns (
    match_id INTEGER PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
    delivered_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT
  );
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
  ["photo_url", "TEXT"],
  ["strong_points", "TEXT NOT NULL DEFAULT ''"],
  ["weak_points", "TEXT NOT NULL DEFAULT ''"],
  ["preferred_position", "TEXT NOT NULL DEFAULT ''"],
  ["other_details", "TEXT NOT NULL DEFAULT ''"],
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
const convocationColumns = db.prepare("PRAGMA table_info(convocations)").all().map((column) => column.name);
if (!convocationColumns.includes("invited_by_user_id")) {
  db.exec("ALTER TABLE convocations ADD COLUMN invited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
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

const testResetAdminPasswordHash = "$2b$12$PL1QrpAlwd1z.AnTQRFcpuZnWcuGs4EWtitzO0rZNdQVh1MZgcvFG";
const defaultAdminPasswordHash = process.env.INITIAL_ADMIN_PASSWORD
  ? bcrypt.hashSync(process.env.INITIAL_ADMIN_PASSWORD, 12)
  : testResetAdminPasswordHash;
const defaultAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
if (!defaultAdmin) {
  db.prepare(`
    INSERT INTO users (name, first_name, last_name, alias, password_hash, account_status,
      must_change_password, role, base_role, ranking_position, balance)
    VALUES ('DIEGO GAY DAVILA', 'DIEGO', 'GAY DAVILA', 'DIMOGARU', ?, 'active', 0, 'admin', 'principal', NULL, 0)
  `).run(defaultAdminPasswordHash);
}
*/

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.PUBLIC_VAPID_KEY || "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || process.env.PRIVATE_VAPID_KEY || "";
const vapidSubject = process.env.VAPID_SUBJECT || process.env.VAPID_EMAIL || "mailto:admin@opachanga.local";
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
  console.warn("Claves VAPID no configuradas; notificaciones push desactivadas.");
}

app.set("trust proxy", 1);
app.use(express.json({ limit: "512kb" }));
app.use(
  session({
    store: new PgSessionStore({
      pool: db.getPool(),
      tableName: "user_sessions",
      createTableIfMissing: false,
      pruneSessionInterval: 60 * 60,
    }),
    name: "pachanga.sid",
    secret: process.env.SESSION_SECRET || "solo-desarrollo-cambia-SESSION_SECRET",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 365 * 24 * 60 * 60 * 1000,
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

async function requireUser(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Inicia sesión para continuar." });
  const account = await db.prepare(`
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

async function requirePlayer(req, res, next) {
  await requireUser(req, res, () => {});
  if (res.headersSent) return;
  if (!req.session.user) return;
  if (req.session.user.role === "admin") {
    return res.status(403).json({ error: "Esta acción está disponible solo para jugadores." });
  }
  next();
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

async function getCurrentMatch() {
  return db.prepare(`
    SELECT * FROM matches
    WHERE status IN ('open', 'closed')
    ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,
      match_date DESC, start_date DESC, id DESC
    LIMIT 1
  `).get() || null;
}

async function latestCancellation() {
  const latest = await db.prepare(`
    SELECT * FROM matches
    ORDER BY id DESC
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

async function getConvocationData(match, userId, { historical = false } = {}) {
  const roster = historical
    ? await db.prepare(`
        SELECT u.id, u.name, u.alias, u.role, u.base_role, u.ranking_position,
          c.status AS response, c.invited_by_user_id, inviter.alias AS invited_by_alias
        FROM convocations c
        JOIN users u ON u.id = c.user_id
        LEFT JOIN users inviter ON inviter.id = c.invited_by_user_id
        WHERE c.match_id = ? AND u.role != 'admin'
        ORDER BY
          CASE c.status WHEN 'principal' THEN 1 WHEN 'suplente' THEN 2 ELSE 3 END,
          u.ranking_position IS NULL, u.ranking_position, LOWER(u.name)
      `).all(match.id)
    : await db.prepare(`
        SELECT u.id, u.name, u.alias, u.role, u.base_role, u.ranking_position,
          c.status AS response, c.invited_by_user_id, inviter.alias AS invited_by_alias
        FROM users u
        LEFT JOIN convocations c ON c.user_id = u.id AND c.match_id = ?
        LEFT JOIN users inviter ON inviter.id = c.invited_by_user_id
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
          LOWER(u.name)
      `).all(match.id);
  const principal = roster.filter((user) => user.response === "principal");
  const suplentes = roster.filter((user) => user.response === "suplente");
  const noVan = roster.filter((user) => user.response === "no_va");
  const activePlayers = roster;
  const pending = historical ? [] : activePlayers.filter((user) => user.response === null);
  const principalCount = principal.length;
  return {
    match: {
      ...await matchDetails(match),
      draft: readJson(match.draft_state, {}),
      canReopen: !historical && match.status === "closed" &&
        !["in_progress", "complete"].includes(readJson(match.draft_state, {}).status),
      readOnly: historical,
      transactions: historical || match.status === "played" ? await getMatchTransactions(match.id) : [],
    },
    lists: { principal, suplentes, no_va: noVan, pending },
    currentResponse: roster.find((user) => user.id === userId)?.response || null,
    principalCount,
    validForMatch: principalCount === 14 || principalCount === 16,
    responseCount: activePlayers.filter((user) => user.response !== null).length,
    totalPlayers: activePlayers.length,
  };
}

async function getMatchTransactions(matchId) {
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

async function nonAdminPlayerIds(ids) {
  const uniqueIds = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!uniqueIds.length) return [];
  const users = await db.prepare(`
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

async function principalRosterIds(matchId) {
  const rows = await db.prepare(`
    SELECT c.user_id
    FROM convocations c JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.status = 'principal' AND u.role != 'admin'
    ORDER BY c.id
  `).all(matchId);
  return rows.map((row) => row.user_id);
}

async function validateDraftState(matchId, draft, teamA, teamB) {
  if (!["in_progress", "complete"].includes(draft?.status)) return "El estado del draft no es válido.";
  if (!Array.isArray(teamA) || !Array.isArray(teamB) || !Array.isArray(draft.picks)) {
    return "Faltan datos de elecciones o de equipos.";
  }
  const confirmedIds = new Set(await principalRosterIds(matchId));
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

async function recalculateMatchPoints(matchId, result, teamA, teamB) {
  await db.prepare("DELETE FROM match_points WHERE match_id = ?").run(matchId);
  const insertPoints = db.prepare(`
    INSERT INTO match_points (match_id, user_id, points, result) VALUES (?, ?, ?, ?)
  `);
  for (const [team, outcome] of [
    [teamA, result === "draw" ? "draw" : result === "A" ? "win" : "loss"],
    [teamB, result === "draw" ? "draw" : result === "B" ? "win" : "loss"],
  ]) {
    const points = 1 + (outcome === "win" ? 3 : outcome === "draw" ? 1 : 0);
    for (const userId of team) await insertPoints.run(matchId, userId, points, outcome);
  }
}

async function repairCurrentLegacyDraftBalance() {
  const currentMatch = await db.prepare("SELECT * FROM matches ORDER BY match_date DESC, start_date DESC, id DESC LIMIT 1").get();
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
  const validationError = await validateDraftState(currentMatch.id, draft, teamA, teamB);
  if (validationError) {
    console.error(`No se pudo reequilibrar el draft del partido #${currentMatch.id}: ${validationError}`);
    return false;
  }

  await db.transaction(async () => {
    await db.prepare("UPDATE matches SET draft_state = ?, team_a = ?, team_b = ? WHERE id = ?")
      .run(JSON.stringify(draft), JSON.stringify(teamA), JSON.stringify(teamB), currentMatch.id);
    if (currentMatch.status === "played" && ["A", "B", "draw"].includes(currentMatch.result)) {
      await recalculateMatchPoints(currentMatch.id, currentMatch.result, teamA, teamB);
    }
  })();
  console.log(`Draft del partido #${currentMatch.id} reequilibrado: ${teamA.length} en A y ${teamB.length} en B; cobro conservado.`);
  return true;
}

async function matchDetails(match) {
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
      : await validateDraftState(match.id, draft, teamAIds, teamBIds)
    : null;
  if (!draftValidationError && ["closed", "played"].includes(match.status) &&
      (match.draft_state !== "{}" || teamAIds.length || teamBIds.length) &&
      !["in_progress", "complete"].includes(draft.status)) {
    draftValidationError = "El estado guardado del draft no es válido.";
  }
  const getTeam = async (ids, activeOnly = false) => ids.length
    ? (await db.prepare(`
      SELECT id, name, alias, ranking_position FROM users
      WHERE id IN (${ids.map(() => "?").join(",")}) AND role != 'admin'
        ${activeOnly ? "AND account_status = 'active' AND deleted_at IS NULL" : ""}
    `).all(...ids))
      .sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id))
    : [];
  const available = draft.remaining?.length ? await getTeam(draft.remaining, true) : [];
  const finance = await db.prepare("SELECT * FROM match_finances WHERE match_id = ?").get(match.id) || null;
  const principalCount = (await db.prepare(`
    SELECT COUNT(*) AS count FROM convocations c
    JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.status = 'principal'
      AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
  `)
    .get(match.id)).count;
  const principalPlayers = await db.prepare(`
    SELECT u.id, u.name, u.alias, u.ranking_position
    FROM convocations c JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.status = 'principal'
      AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
    ORDER BY u.ranking_position IS NULL, u.ranking_position, LOWER(u.name)
  `).all(match.id);
  return {
    ...match,
    match_date: matchDate,
    match_date_label: formatSpanishDate(matchDate),
    match_time: matchTime,
    match_time_label: `${matchTime} h`,
    draft,
    draftValidationError,
    teamA: await getTeam(teamAIds),
    teamB: await getTeam(teamBIds),
    available,
    finance,
    principalCount,
    principalPlayers,
  };
}

async function currentPot() {
  const setting = await db.prepare("SELECT value FROM app_settings WHERE key = 'pot_cents'").get();
  return Number(setting?.value || 0) / 100;
}

async function lockCurrentPotCents() {
  await db.prepare(`
    INSERT INTO app_settings (key, value) VALUES ('pot_cents', '0')
    ON CONFLICT(key) DO NOTHING
  `).run();
  const setting = await db.prepare(`
    SELECT value FROM app_settings WHERE key = 'pot_cents' FOR UPDATE
  `).get();
  const cents = Math.round(Number(setting?.value || 0));
  if (!Number.isSafeInteger(cents)) {
    throw new Error("El saldo actual del bote no es válido.");
  }
  return cents;
}

async function sendNegativeBalanceAlert(match) {
  if (!pushConfigured) return { skipped: true, reason: "push_not_configured" };
  const claim = await db.transaction(async () => {
    await db.prepare("INSERT INTO balance_alert_campaigns (match_id, status) VALUES (?, 'sending') ON CONFLICT (match_id) DO NOTHING")
      .run(match.id);
    const campaign = await db.prepare("SELECT * FROM balance_alert_campaigns WHERE match_id = ?").get(match.id);
    if (campaign.status === "sent") return { claimed: false, campaign };
    if (campaign.status === "sending") {
      const stale = (await db.prepare("SELECT ?::timestamptz < CURRENT_TIMESTAMP - INTERVAL '15 minutes' AS value").get(campaign.created_at)).value;
      if (!stale) return { claimed: false, campaign };
    }
    await db.prepare(`
      UPDATE balance_alert_campaigns
      SET status = 'sending', error = NULL, created_at = CURRENT_TIMESTAMP
      WHERE match_id = ?
    `).run(match.id);
    return { claimed: true, campaign };
  })();
  if (!claim.claimed) {
    return { alreadySent: claim.campaign.status === "sent", inProgress: claim.campaign.status === "sending" };
  }
  const recipients = await db.prepare(`
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
    body: `Tienes saldo negativo. El partido es ${formatSpanishDate(match.match_date || shiftDate(match.start_date, 7))} a las ${match.match_time || "20:00"} h. Revisa tu cuenta.`,
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
  for (const endpoint of expired) {
    await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }
  await db.prepare(`
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

  const claim = await db.transaction(async () => {
    await db.prepare("INSERT INTO push_campaigns (match_id, type, status) VALUES (?, ?, 'sending') ON CONFLICT (match_id, type) DO NOTHING")
      .run(match.id, type);
    const campaign = await db.prepare("SELECT * FROM push_campaigns WHERE match_id = ? AND type = ?")
      .get(match.id, type);
    if (campaign.status === "sent") {
      return { claimed: false, campaign };
    }
    if (campaign.status === "sending") {
      const stale = (await db.prepare("SELECT ?::timestamptz < CURRENT_TIMESTAMP - INTERVAL '15 minutes' AS value").get(campaign.created_at)).value;
      if (!stale) return { claimed: false, campaign };
    }
    await db.prepare(`
      UPDATE push_campaigns
      SET status = 'sending', error = NULL, created_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(campaign.id);
    return { claimed: true, campaign };
  })();

  if (!claim.claimed) {
    return { alreadySent: claim.campaign.status === "sent", inProgress: claim.campaign.status === "sending", delivered: claim.campaign.delivered_count };
  }

  const subscriptions = type === "opening"
    ? await db.prepare("SELECT s.endpoint, s.p256dh, s.auth FROM push_subscriptions s JOIN users u ON u.id = s.user_id WHERE u.account_status = 'active' AND u.role != 'admin' AND u.deleted_at IS NULL").all()
    : await db.prepare(`
        SELECT s.endpoint, s.p256dh, s.auth
        FROM push_subscriptions s
        JOIN users u ON u.id = s.user_id AND u.account_status = 'active' AND u.role != 'admin' AND u.deleted_at IS NULL
        LEFT JOIN convocations c ON c.user_id = s.user_id AND c.match_id = ?
        WHERE c.user_id IS NULL OR c.status IS NULL
      `).all(match.id);
  const matchDateLabel = formatSpanishDate(match.match_date || shiftDate(match.start_date, 7));
  const matchTimeLabel = match.match_time || match.end_date?.slice(11, 16) || "20:00";
  const message = type === "opening"
    ? { title: "Convocatoria abierta", body: `Confirma si vienes al partido del ${matchDateLabel} a las ${matchTimeLabel} h.`, url: "/" }
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
  for (const endpoint of expired) {
    await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }
  const status = errors.length ? "failed" : "sent";
  await db.prepare(`
    UPDATE push_campaigns
    SET status = ?, delivered_count = ?, error = ?, sent_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, delivered, errors.length ? `${errors.length} entregas fallidas` : null, claim.campaign.id);
  return { delivered, failed: errors.length, status };
}

async function sendManualOpeningNotification() {
  if (!pushConfigured) {
    const error = new Error("Las notificaciones push no están configuradas. Define las variables VAPID.");
    error.status = 503;
    throw error;
  }

  const subscriptions = await db.prepare(`
    SELECT endpoint, p256dh, auth
    FROM push_subscriptions
  `).all();
  if (!subscriptions.length) {
    return {
      delivered: 0,
      failed: 0,
      status: "empty",
      noSubscriptions: true,
      message: "No hay dispositivos suscritos",
    };
  }

  const payload = {
    title: "⚽ ¡Convocatoria abierta!",
    body: "Ya puedes apuntarte a la próxima pachanga.",
    url: "/",
    tag: "o-pachanga-convocatoria-abierta",
  };
  const results = await Promise.allSettled(subscriptions.map((subscription) =>
    webPush.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, JSON.stringify(payload), { TTL: 60 * 60 * 24 * 3 }),
  ));

  let delivered = 0;
  let failed = 0;
  const expired = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      delivered += 1;
      return;
    }
    failed += 1;
    if ([404, 410].includes(result.reason?.statusCode)) {
      expired.push(subscriptions[index].endpoint);
    }
  });
  for (const endpoint of expired) {
    await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }

  return { delivered, failed, status: failed ? "failed" : "sent" };
}

async function sendUserNotification(userId, payload, { cleanupExpired = true } = {}) {
  if (!pushConfigured) return { skipped: true };
  const subscriptions = await db.prepare(`
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
  if (cleanupExpired) {
    for (const endpoint of expired) {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
    }
  }
  return { delivered, failed: results.length - delivered };
}

async function sendPromotionNotification(userId, recipientLabel, payload) {
  if (!pushConfigured) {
    console.warn(`[Web Push promoción] No se pudo avisar a ${recipientLabel}: VAPID no está configurado.`);
    return { delivered: 0, failed: 0, skipped: true };
  }
  try {
    const subscriptions = await db.prepare(`
      SELECT COUNT(*)::integer AS count FROM push_subscriptions WHERE user_id = ?
    `).get(userId);
    if (!subscriptions?.count) {
      console.info(`[Web Push promoción] ${recipientLabel} no tiene dispositivos suscritos.`);
      return { delivered: 0, failed: 0, skipped: true, reason: "no_subscription" };
    }

    const result = await sendUserNotification(userId, payload, { cleanupExpired: false });
    if (result.delivered > 0) {
      console.info(`[Web Push promoción] Aviso enviado a ${recipientLabel}: ${result.delivered} dispositivo(s).`);
    }
    if (result.failed > 0) {
      console.warn(`[Web Push promoción] Fallaron ${result.failed} envío(s) a ${recipientLabel}.`);
    }
    if (result.delivered === 0 && result.failed === 0) {
      console.info(`[Web Push promoción] No hay una suscripción activa para ${recipientLabel}.`);
    }
    return result;
  } catch (error) {
    console.error(`[Web Push promoción] Error al avisar a ${recipientLabel}; la promoción se mantiene:`, error.message);
    return { delivered: 0, failed: 1 };
  }
}

async function sendRosterRemovalNotification(userId, alias, matchId) {
  const label = `jugador @${alias}`;
  if (!pushConfigured) {
    console.warn(`[Web Push convocatoria] No se pudo avisar a ${label}: VAPID no está configurado.`);
    return;
  }
  try {
    const subscriptions = await db.prepare(`
      SELECT COUNT(*)::integer AS count FROM push_subscriptions WHERE user_id = ?
    `).get(userId);
    if (!subscriptions?.count) {
      console.info(`[Web Push convocatoria] ${label} no tiene dispositivos suscritos.`);
      return;
    }
    const result = await sendUserNotification(userId, {
      title: "Actualización de Convocatoria",
      body: "El Administrador te ha movido a la lista NO VAN para el próximo partido.",
      url: "/",
      tag: `no-va-${matchId}-${userId}`,
    }, { cleanupExpired: false });
    if (result.delivered > 0) {
      console.info(`[Web Push convocatoria] Aviso de baja enviado a ${label}: ${result.delivered} dispositivo(s).`);
    }
    if (result.failed > 0) {
      console.warn(`[Web Push convocatoria] Fallaron ${result.failed} envío(s) a ${label}.`);
    }
    if (result.delivered === 0 && result.failed === 0) {
      console.info(`[Web Push convocatoria] No hay una suscripción activa para ${label}.`);
    }
  } catch (error) {
    console.error(`[Web Push convocatoria] Error al avisar a ${label}; la baja se mantiene:`, error.message);
  }
}

async function sendCancellationNotifications(match) {
  if (!pushConfigured) return { status: "disabled", delivered: 0 };
  const recipients = await db.prepare(`
    SELECT DISTINCT u.id
    FROM users u
    JOIN push_subscriptions s ON s.user_id = u.id
    WHERE u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
  `).all();
  const payload = {
    title: "Convocatoria cancelada",
    body: "CONVOCATORIA CANCELADA por no alcanzar el mínimo de jugadores (14).",
    url: "/",
    tag: `cancelled-${match.id}`,
  };
  const results = await Promise.allSettled(recipients.map(({ id }) => sendUserNotification(id, payload)));
  const delivered = results.reduce((total, result) =>
    total + (result.status === "fulfilled" ? result.value.delivered || 0 : 0), 0);
  const failed = results.reduce((total, result) =>
    total + (result.status === "fulfilled" ? result.value.failed || 0 : 1), 0);
  return { status: failed ? "failed" : "sent", delivered, failed };
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
  if (await db.prepare("SELECT id FROM users WHERE LOWER(alias) = LOWER(?)").get(alias)) {
    return res.status(409).json({ error: "Ese alias ya está en uso." });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const existingPlayer = await db.prepare(`
      SELECT id FROM users
      WHERE role != 'admin' AND account_status = 'pending'
        AND alias IS NULL AND password_hash IS NULL
        AND lower(trim(name)) = lower(?)
      ORDER BY id LIMIT 1
    `).get(fullName);
    let userId;
    if (existingPlayer) {
      userId = existingPlayer.id;
      await db.prepare(`
        UPDATE users
        SET name = ?, first_name = ?, last_name = ?, alias = ?, password_hash = ?,
            account_status = 'pending', must_change_password = 0, created_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(fullName, firstName, lastName, alias, passwordHash, userId);
    } else {
      const created = await db.prepare(`
        INSERT INTO users (name, first_name, last_name, alias, password_hash, account_status,
          role, base_role, ranking_position, balance)
        VALUES (?, ?, ?, ?, ?, 'pending', 'principal', 'principal', NULL, 0) RETURNING id
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

app.get("/api/users", requireUser, async (_req, res) => {
  const users = await db.prepare(`
    SELECT id, name, first_name, last_name, alias, role, base_role, ranking_position, balance
    FROM users
    WHERE account_status = 'active' AND role != 'admin' AND deleted_at IS NULL
    ORDER BY role, ranking_position IS NULL, ranking_position, LOWER(name)
  `).all();
  res.json(users);
});

app.get("/api/users/:id/profile", requireUser, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "El jugador seleccionado no es válido." });
  }
  const profile = await db.prepare(`
    SELECT id, alias, photo_url, strong_points, weak_points, preferred_position, other_details
    FROM users WHERE id = ? AND role != 'admin'
  `).get(id);
  if (!profile) return res.status(404).json({ error: "No se encontró la ficha de ese jugador." });
  res.json({ profile });
});

app.patch("/api/users/:id/profile", requireUser, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "El jugador seleccionado no es válido." });
  }
  const isAdmin = req.session.user.role === "admin";
  if (!isAdmin && req.session.user.id !== id) {
    return res.status(403).json({ error: "Solo puedes editar tu propia ficha de jugador." });
  }
  const current = await db.prepare(`
    SELECT id, alias, photo_url, strong_points, weak_points, preferred_position, other_details
    FROM users WHERE id = ? AND role != 'admin'
  `).get(id);
  if (!current) return res.status(404).json({ error: "No se encontró la ficha de ese jugador." });

  const body = req.body || {};
  let photoUrl = current.photo_url;
  if (body.photo_url !== undefined) {
    photoUrl = body.photo_url === null || body.photo_url === "" ? null : body.photo_url;
    if (photoUrl !== null) {
      const match = typeof photoUrl === "string"
        ? photoUrl.match(/^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/)
        : null;
      if (!match) {
        return res.status(400).json({ error: "La foto debe ser una imagen WebP, JPEG o PNG válida." });
      }
      const imageBytes = Buffer.from(match[2], "base64");
      const hasValidHeader = match[1] === "webp"
        ? imageBytes.length >= 12 && imageBytes.toString("ascii", 0, 4) === "RIFF" && imageBytes.toString("ascii", 8, 12) === "WEBP"
        : match[1] === "jpeg"
          ? imageBytes.length >= 3 && imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff
          : imageBytes.length >= 8 && imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      if (imageBytes.length > maxProfilePhotoBytes || !hasValidHeader) {
        return res.status(400).json({ error: "La foto no es válida o supera el límite de 256 KB." });
      }
    }
  }

  const fields = [
    ["strong_points", 1000, "Los puntos fuertes"],
    ["weak_points", 1000, "Los puntos débiles"],
    ["preferred_position", 60, "La posición preferida"],
    ["other_details", 2000, "Otros datos"],
  ];

  if (!isAdmin) {
    const allowedFields = new Set(["photo_url", ...fields.map(([field]) => field)]);
    if (Object.keys(body).some((field) => !allowedFields.has(field))) {
      return res.status(403).json({
        error: "Solo puedes editar tu fotografía y tus propios datos técnicos.",
      });
    }

    const updates = [];
    const values = [];
    if (body.photo_url !== undefined) {
      updates.push("photo_url = ?");
      values.push(photoUrl);
    }
    for (const [field, limit, label] of fields) {
      if (body[field] === undefined) continue;
      const value = typeof body[field] === "string" ? body[field].trim() : null;
      if (value === null || value.length > limit) {
        return res.status(400).json({ error: `${label} debe ser texto de ${limit} caracteres o menos.` });
      }
      updates.push(`${field} = ?`);
      values.push(value);
    }
    if (!updates.length) {
      return res.status(400).json({ error: "No hay cambios de perfil para guardar." });
    }
    values.push(id);
    await db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    return res.json({
      profile: await db.prepare(`
        SELECT id, alias, photo_url, strong_points, weak_points, preferred_position, other_details
        FROM users WHERE id = ?
      `).get(id),
    });
  }

  const alias = body.alias === undefined
    ? current.alias
    : typeof body.alias === "string" ? body.alias.trim().normalize("NFKC").toLowerCase() : null;
  if (!/^[\p{L}\p{N}._-]{3,24}$/u.test(alias || "")) {
    return res.status(400).json({ error: "El alias debe tener entre 3 y 24 caracteres." });
  }
  if (await db.prepare("SELECT id FROM users WHERE LOWER(alias) = LOWER(?) AND id != ?").get(alias, id)) {
    return res.status(409).json({ error: "Ese alias ya está en uso." });
  }

  const profileValues = {};
  for (const [field, limit, label] of fields) {
    const value = body[field] === undefined
      ? current[field]
      : typeof body[field] === "string" ? body[field].trim() : null;
    if (value === null || value.length > limit) {
      return res.status(400).json({ error: `${label} debe ser texto de ${limit} caracteres o menos.` });
    }
    profileValues[field] = value;
  }

  try {
    await db.prepare(`
      UPDATE users
      SET alias = ?, photo_url = ?, strong_points = ?, weak_points = ?,
        preferred_position = ?, other_details = ?
      WHERE id = ?
    `).run(
      alias,
      photoUrl,
      profileValues.strong_points,
      profileValues.weak_points,
      profileValues.preferred_position,
      profileValues.other_details,
      id,
    );
  } catch (error) {
    if (String(error.code || "").includes("CONSTRAINT")) {
      return res.status(409).json({ error: "Ese alias ya está en uso." });
    }
    throw error;
  }
  const profile = await db.prepare(`
    SELECT id, alias, photo_url, strong_points, weak_points, preferred_position, other_details
    FROM users WHERE id = ?
  `).get(id);
  res.json({ profile });
});

app.get("/api/admin/pending-users", requireAdmin, async (_req, res) => {
  const pendingUsers = await db.prepare(`
    SELECT u.id, u.first_name, u.last_name, u.name, u.alias, u.created_at,
      u.ranking_position, (r.id IS NOT NULL) AS substitute_invitation,
      inviter.alias AS invited_by_alias, m.match_date AS invitation_match_date
    FROM users u
    LEFT JOIN substitute_approval_requests r
      ON r.user_id = u.id AND r.status = 'pending'
    LEFT JOIN users inviter ON inviter.id = r.invited_by_user_id
    LEFT JOIN matches m ON m.id = r.match_id
    WHERE u.role != 'admin' AND u.account_status = 'pending' AND u.deleted_at IS NULL
      AND u.alias IS NOT NULL AND u.password_hash IS NOT NULL
    ORDER BY u.created_at, u.id
  `).all();
  res.json(pendingUsers);
});

app.post("/api/admin/pending-users/:id/approve", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "La solicitud seleccionada no es válida." });
  }
  try {
    const approval = await db.transaction(async () => {
      const pending = await db.prepare(`
        SELECT id FROM users
        WHERE id = ? AND role != 'admin' AND account_status = 'pending' AND deleted_at IS NULL
          AND alias IS NOT NULL AND password_hash IS NOT NULL
        FOR UPDATE
      `).get(id);
      if (!pending) {
        const error = new Error("No se encontró una solicitud pendiente válida.");
        error.status = 404;
        throw error;
      }

      const invitation = await db.prepare(`
        SELECT r.id, r.match_id, r.invited_by_user_id, m.status AS match_status
        FROM substitute_approval_requests r
        LEFT JOIN matches m ON m.id = r.match_id
        WHERE r.user_id = ? AND r.status = 'pending'
        ORDER BY r.id DESC LIMIT 1
        FOR UPDATE OF r
      `).get(id);
      if (invitation && invitation.match_status !== "open") {
        const error = new Error("La convocatoria asociada ya no está abierta. No se ha aprobado la cuenta.");
        error.status = 409;
        throw error;
      }

      const baseRole = invitation ? "suplente" : req.body?.base_role;
      const rankingPosition = Number(req.body?.ranking_position);
      const balance = invitation ? 0 : Number(req.body?.balance);
      if (!["principal", "suplente"].includes(baseRole)) {
        const error = new Error("El rol base debe ser principal o suplente.");
        error.status = 400;
        throw error;
      }
      if (!Number.isInteger(rankingPosition) || rankingPosition < 1) {
        const error = new Error("La posición del ranking debe ser un entero positivo.");
        error.status = 400;
        throw error;
      }
      if (!Number.isFinite(balance) || !Number.isSafeInteger(moneyCents(balance))) {
        const error = new Error("El saldo inicial debe ser válido.");
        error.status = 400;
        throw error;
      }
      if (await db.prepare(`
        SELECT id FROM users
        WHERE account_status = 'active' AND role != 'admin'
          AND ranking_position = ? AND id != ?
      `).get(rankingPosition, id)) {
        const error = new Error("Esa posición ya está asignada a otro jugador activo.");
        error.status = 409;
        throw error;
      }

      await db.prepare(`
        UPDATE users
        SET role = ?, base_role = ?, ranking_position = ?, balance = ?,
          account_status = 'active', must_change_password = CASE WHEN ? THEN 1 ELSE must_change_password END
        WHERE id = ?
      `).run(baseRole, baseRole, rankingPosition, moneyCents(balance) / 100, Boolean(invitation), id);
      if (moneyCents(balance)) {
        await db.prepare("INSERT INTO transactions (user_id, amount, concept) VALUES (?, ?, ?)")
          .run(id, moneyCents(balance) / 100, "Saldo inicial al aprobar la cuenta");
      }
      if (invitation) {
        await db.prepare(`
          INSERT INTO convocations (match_id, user_id, status, updated_at, invited_by_user_id)
          VALUES (?, ?, 'suplente', CURRENT_TIMESTAMP, ?)
          ON CONFLICT(match_id, user_id)
          DO UPDATE SET status = 'suplente', updated_at = CURRENT_TIMESTAMP,
            invited_by_user_id = excluded.invited_by_user_id
        `).run(invitation.match_id, id, invitation.invited_by_user_id);
        await db.prepare(`
          UPDATE substitute_approval_requests
          SET status = 'approved', approved_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'pending'
        `).run(invitation.id);
      }
      return { invited: Boolean(invitation) };
    })();
    res.json({
      approved: true,
      added_to_convocation: approval.invited,
      user: publicUser(await db.prepare("SELECT * FROM users WHERE id = ?").get(id)),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

app.get("/api/session", async (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  const user = await db.prepare(`
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
  const user = await db.prepare(`
    SELECT id, name, first_name, last_name, alias, role, base_role,
      ranking_position, balance, password_hash, must_change_password, account_status, deleted_at
    FROM users WHERE LOWER(alias) = LOWER(?)
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
  const user = await db.prepare("SELECT password_hash FROM users WHERE id = ? AND account_status = 'active'")
    .get(req.session.user.id);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(401).json({ error: "La contraseña actual no es válida." });
  }
  if (Buffer.byteLength(newPassword, "utf8") < 8 || Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).json({ error: "La nueva contraseña debe tener entre 8 y 72 bytes." });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?")
    .run(passwordHash, req.session.user.id);
  req.session.user.must_change_password = 0;
  res.json({ updated: true });
});

async function destroySession(req, res) {
  const user = req.session.user;
  if (user?.id) {
    try {
      await db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(user.id);
    } catch (error) {
      console.error("No se pudo limpiar la suscripción push al cerrar sesión:", error.message);
    }
  }
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: "No se pudo cerrar la sesión." });
    res.clearCookie("pachanga.sid");
    res.status(204).end();
  });
}

app.post("/api/logout", destroySession);
app.delete("/api/session", destroySession);

app.get("/api/convocations/current", requireUser, async (_req, res) => {
  const match = await getCurrentMatch();
  if (match) return res.json(await getConvocationData(match, _req.session.user.id));
  const data = emptyConvocationData();
  const cancellation = await latestCancellation();
  if (cancellation) data.cancellation = await matchDetails(cancellation);
  res.json(data);
});

app.get("/api/admin/convocations/history", requireAdmin, async (_req, res) => {
  const activeMatch = await getCurrentMatch();
  const matches = (await db.prepare(`
    SELECT m.id, m.start_date, m.end_date, m.match_date, m.match_time, m.status, m.result,
      COUNT(CASE WHEN u.role != 'admin' THEN c.user_id END) AS response_count,
      COUNT(CASE WHEN c.status = 'principal' AND u.role != 'admin' THEN 1 END) AS principal_count
    FROM matches m
    LEFT JOIN convocations c ON c.match_id = m.id
    LEFT JOIN users u ON u.id = c.user_id
    GROUP BY m.id
    ORDER BY COALESCE(m.match_date, m.start_date) DESC, m.id DESC
  `).all()).map((match) => ({
    ...match,
    match_date: match.match_date || shiftDate(match.start_date, 7),
    match_date_label: formatSpanishDate(match.match_date || shiftDate(match.start_date, 7)),
    match_time: match.match_time || match.end_date?.slice(11, 16) || "20:00",
    match_time_label: `${match.match_time || match.end_date?.slice(11, 16) || "20:00"} h`,
    is_active: match.id === activeMatch?.id,
  }));
  res.json({ active_match_id: activeMatch?.id || null, matches });
});

app.get("/api/convocations/:matchId", requireUser, async (req, res) => {
  const matchId = Number(req.params.matchId);
  if (!Number.isInteger(matchId)) return res.status(400).json({ error: "Identificador de jornada no válido." });
  const match = await db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró la convocatoria." });
  const activeMatch = await getCurrentMatch();
  res.json(await getConvocationData(match, req.session.user.id, { historical: match.id !== activeMatch?.id }));
});

app.post("/api/admin/convocations/current/open", requireAdmin, async (req, res) => {
  const match = await getCurrentMatch();
  if (!match) return res.status(404).json({ error: "No hay una convocatoria cerrada para reabrir." });
  const draft = readJson(match.draft_state, {});
  if (match.status === "played" || ["in_progress", "complete"].includes(draft.status)) {
    return res.status(409).json({ error: "No se puede reabrir una convocatoria con un draft iniciado o un partido jugado." });
  }
  if (match.status !== "closed") return res.status(409).json({ error: "La convocatoria ya está abierta." });
  await db.prepare("UPDATE matches SET status = 'open', draft_state = '{}', team_a = '[]', team_b = '[]' WHERE id = ?")
    .run(match.id);
  let notification = { status: "disabled" };
  if (pushConfigured) {
    try {
      notification = await sendCampaign(await db.prepare("SELECT * FROM matches WHERE id = ?").get(match.id), "opening");
    } catch (error) {
      notification = { status: "failed", error: error.message };
    }
  }
  res.json({
    ...await getConvocationData(await db.prepare("SELECT * FROM matches WHERE id = ?").get(match.id), req.session.user.id),
    notification,
  });
});

app.post("/api/admin/convocations/current/close", requireAdmin, async (req, res) => {
  const match = await getCurrentMatch();
  if (!match) return res.status(404).json({ error: "No hay una convocatoria abierta para cerrar." });
  if (match.status !== "open") return res.status(409).json({ error: "La convocatoria ya está cerrada." });
  const roster = await db.prepare(`
    SELECT u.id FROM convocations c JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.status = 'principal'
      AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
    ORDER BY u.ranking_position IS NULL, u.ranking_position, LOWER(u.name)
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
  await db.prepare("UPDATE matches SET status = 'closed', draft_state = ?, team_a = ?, team_b = ? WHERE id = ?")
    .run(JSON.stringify(draft), JSON.stringify(teamA), JSON.stringify(teamB), match.id);
  res.json(await getConvocationData(await db.prepare("SELECT * FROM matches WHERE id = ?").get(match.id), req.session.user.id));
});

app.post("/api/admin/convocations/current/cancel", requireAdmin, async (req, res) => {
  const match = await getCurrentMatch();
  if (!match) return res.status(404).json({ error: "No hay una convocatoria activa para cancelar." });
  if (!["open", "closed"].includes(match.status)) {
    return res.status(409).json({ error: "Solo se puede cancelar una convocatoria abierta o cerrada sin partido jugado." });
  }

  let cancelledMatch;
  try {
    cancelledMatch = await db.transaction(async () => {
      const current = await db.prepare("SELECT * FROM matches WHERE id = ?").get(match.id);
      if (!current || !["open", "closed"].includes(current.status)) {
        const error = new Error("La convocatoria ya no se puede cancelar.");
        error.status = 409;
        throw error;
      }
      const principalCount = (await db.prepare(`
        SELECT COUNT(*) AS count
        FROM convocations c
        JOIN users u ON u.id = c.user_id
        WHERE c.match_id = ? AND c.status = 'principal'
          AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
      `).get(current.id)).count;
      if (principalCount >= 14) {
        const error = new Error("No se puede cancelar: ya hay al menos 14 jugadores en la Lista Principal.");
        error.status = 409;
        throw error;
      }
      const hasSportsOrFinance = current.result ||
        readJson(current.draft_state, {}).status ||
        readJson(current.team_a, []).length ||
        readJson(current.team_b, []).length ||
        await db.prepare("SELECT 1 FROM match_finances WHERE match_id = ?").get(current.id) ||
        await db.prepare("SELECT 1 FROM match_points WHERE match_id = ?").get(current.id) ||
        await db.prepare("SELECT 1 FROM transactions WHERE match_id = ?").get(current.id);
      if (hasSportsOrFinance) {
        const error = new Error("No se puede cancelar un evento con draft, resultado, puntos o movimientos financieros.");
        error.status = 409;
        throw error;
      }
      await db.prepare("UPDATE matches SET status = 'cancelled' WHERE id = ?").run(current.id);
      return db.prepare("SELECT * FROM matches WHERE id = ?").get(current.id);
    })();
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("No se pudo cancelar la convocatoria:", error.message);
    return res.status(500).json({ error: "No se pudo cancelar la convocatoria." });
  }

  let notification = { status: "disabled", delivered: 0 };
  if (pushConfigured) {
    try {
      notification = await sendCancellationNotifications(cancelledMatch);
    } catch (error) {
      notification = { status: "failed", delivered: 0, error: error.message };
    }
  }
  res.json({ match: await matchDetails(cancelledMatch), notification });
});

app.post("/api/admin/convocations/new", requireAdmin, async (req, res) => {
  const matchDate = typeof req.body?.match_date === "string" ? req.body.match_date.trim() : "";
  if (!isValidDateOnly(matchDate)) {
    return res.status(400).json({ error: "Selecciona una fecha de partido válida." });
  }
  if (matchDate < madridDate()) {
    return res.status(400).json({ error: "La fecha del partido no puede estar en el pasado." });
  }
  const submittedTime = typeof req.body?.match_time === "string" ? req.body.match_time.trim() : "";
  const matchTime = submittedTime || "20:00";
  if (!isValidTime(matchTime)) {
    return res.status(400).json({ error: "La hora del partido debe tener formato HH:MM." });
  }

  const sourceValue = req.body?.source_match_id;
  const sourceMatchId = sourceValue == null || sourceValue === "" ? null : Number(sourceValue);
  if (sourceMatchId !== null) {
    if (!Number.isInteger(sourceMatchId)) return res.status(400).json({ error: "La jornada anterior no es válida." });
    const sourceMatch = await db.prepare("SELECT id, status FROM matches WHERE id = ?").get(sourceMatchId);
    if (!sourceMatch) return res.status(404).json({ error: "No se encontró la jornada anterior." });
    if (!["played", "cancelled"].includes(sourceMatch.status)) {
      return res.status(409).json({ error: "Finaliza o cancela la jornada anterior antes de abrir una nueva convocatoria." });
    }
  }

  let schedule;
  try {
    schedule = await db.transaction(async () => {
      const activeMatch = await getCurrentMatch();
      if (activeMatch) {
        if (activeMatch.status === "open" && activeMatch.match_date === matchDate) {
          return { match: activeMatch, created: false };
        }
        const error = new Error("Ya existe una convocatoria activa. Ciérrala y finaliza su partido antes de abrir otra.");
        error.status = 409;
        throw error;
      }
      const existingDate = await db.prepare("SELECT * FROM matches WHERE match_date = ? ORDER BY id DESC LIMIT 1")
        .get(matchDate);
      if (existingDate) {
        const error = new Error("Ya existe una jornada registrada para esa fecha de partido.");
        error.status = 409;
        throw error;
      }
      const latest = await db.prepare("SELECT * FROM matches ORDER BY COALESCE(match_date, start_date) DESC, id DESC LIMIT 1").get();
      if (latest && !["played", "cancelled"].includes(latest.status)) {
        const error = new Error("Finaliza la jornada anterior antes de abrir una convocatoria nueva.");
        error.status = 409;
        throw error;
      }

      const startDate = madridDate();
      const endDate = `${matchDate}T${matchTime}:00`;
      const insert = await db.prepare(`
        INSERT INTO matches (start_date, end_date, match_date, match_time, status)
        VALUES (?, ?, ?, ?, 'open') RETURNING id
      `).run(startDate, endDate, matchDate, matchTime);
      return {
        match: await db.prepare("SELECT * FROM matches WHERE id = ?").get(insert.lastInsertRowid),
        created: true,
      };
    })();
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
    ...await getConvocationData(schedule.match, req.session.user.id),
    created: schedule.created,
    notification,
  });
});

app.get("/api/matches", requireUser, async (_req, res) => {
  const rawMatches = await db.prepare("SELECT * FROM matches ORDER BY COALESCE(match_date, start_date) DESC, id DESC LIMIT 12").all();
  const matches = await Promise.all(rawMatches.map(matchDetails));
  res.json({ matches, pot: await currentPot() });
});

async function getStandingsRows() {
  return db.prepare(`
    SELECT u.id, u.alias, u.base_role, u.ranking_position,
      COALESCE(mp.points, 0) + COALESCE(sa.points_delta, 0) AS points,
      COALESCE(mp.wins, 0) + COALESCE(sa.wins_delta, 0) AS wins,
      COALESCE(mp.draws, 0) + COALESCE(sa.draws_delta, 0) AS draws,
      COALESCE(mp.losses, 0) + COALESCE(sa.losses_delta, 0) AS losses,
      COALESCE(mp.matches_played, 0) + COALESCE(sa.matches_played_delta, 0) AS matches_played
    FROM users u
    LEFT JOIN (
      SELECT user_id, SUM(points) AS points,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) AS draws,
        SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
        COUNT(*) AS matches_played
      FROM match_points
      GROUP BY user_id
    ) mp ON mp.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(points_delta) AS points_delta,
        SUM(matches_played_delta) AS matches_played_delta,
        SUM(wins_delta) AS wins_delta,
        SUM(draws_delta) AS draws_delta,
        SUM(losses_delta) AS losses_delta
      FROM standing_adjustments
      GROUP BY user_id
    ) sa ON sa.user_id = u.id
    WHERE u.account_status = 'active' AND u.role != 'admin' AND u.deleted_at IS NULL
    ORDER BY points DESC, wins DESC, LOWER(u.alias)
  `).all();
}

async function getMatchStandingTotals(userId) {
  return db.prepare(`
    SELECT COALESCE(SUM(points), 0) AS points,
      SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) AS draws,
      SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
      COUNT(*) AS matches_played
    FROM match_points
    WHERE user_id = ?
  `).get(userId);
}

async function getManualStandingDeltas(userId) {
  return db.prepare(`
    SELECT COALESCE(SUM(points_delta), 0) AS points,
      COALESCE(SUM(matches_played_delta), 0) AS matches_played,
      COALESCE(SUM(wins_delta), 0) AS wins,
      COALESCE(SUM(draws_delta), 0) AS draws,
      COALESCE(SUM(losses_delta), 0) AS losses
    FROM standing_adjustments
    WHERE user_id = ?
  `).get(userId);
}

app.get("/api/admin/standings/adjustments", requireAdmin, async (_req, res) => {
  const adjustments = await db.prepare(`
    SELECT sa.id, sa.user_id, player.alias AS player_alias,
      sa.admin_id, admin.alias AS admin_alias,
      sa.points_delta, sa.matches_played_delta, sa.wins_delta,
      sa.draws_delta, sa.losses_delta, sa.reason, sa.created_at
    FROM standing_adjustments sa
    JOIN users player ON player.id = sa.user_id
    JOIN users admin ON admin.id = sa.admin_id
    ORDER BY sa.id DESC
    LIMIT 50
  `).all();
  res.json({ adjustments });
});

app.post("/api/admin/standings/adjustments", requireAdmin, async (req, res) => {
  const userId = Number(req.body?.user_id);
  const fields = ["points", "matches_played", "wins", "draws", "losses"];
  const targets = {};
  for (const field of fields) {
    const value = req.body?.[field];
    const number = Number(value);
    if (value === undefined || value === null || value === "" || !Number.isSafeInteger(number)) {
      return res.status(400).json({ error: `El campo ${field} debe ser un número entero válido.` });
    }
    if (Math.abs(number) > 1_000_000) {
      return res.status(400).json({ error: "Los totales deben estar dentro del rango permitido." });
    }
    targets[field] = number;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!Number.isSafeInteger(userId) || userId < 1) {
    return res.status(400).json({ error: "Selecciona un jugador válido." });
  }
  if (targets.matches_played < 0 || targets.wins < 0 || targets.draws < 0 || targets.losses < 0) {
    return res.status(400).json({ error: "Los partidos jugados y sus resultados no pueden ser negativos." });
  }
  if (targets.matches_played !== targets.wins + targets.draws + targets.losses) {
    return res.status(400).json({ error: "Partidos jugados debe coincidir con ganados + empatados + perdidos." });
  }
  if (!reason || reason.length > 500) {
    return res.status(400).json({ error: "Indica un motivo de hasta 500 caracteres." });
  }

  try {
    const adjustmentId = await db.transaction(async () => {
      const player = await db.prepare(`
        SELECT id FROM users
        WHERE id = ? AND role != 'admin'
          AND account_status = 'active' AND deleted_at IS NULL
      `).get(userId);
      if (!player) {
        const error = new Error("No se encontró un jugador activo para ajustar.");
        error.status = 404;
        throw error;
      }

      const matches = await getMatchStandingTotals(userId);
      const manual = await getManualStandingDeltas(userId);
      const current = {
        points: matches.points + manual.points,
        matches_played: matches.matches_played + manual.matches_played,
        wins: matches.wins + manual.wins,
        draws: matches.draws + manual.draws,
        losses: matches.losses + manual.losses,
      };
      const deltas = Object.fromEntries(fields.map((field) => [field, targets[field] - current[field]]));
      if (Object.values(deltas).every((delta) => delta === 0)) {
        const error = new Error("Los totales indicados ya coinciden con la clasificación actual.");
        error.status = 409;
        throw error;
      }

      const result = await db.prepare(`
        INSERT INTO standing_adjustments (
          user_id, admin_id, points_delta, matches_played_delta,
          wins_delta, draws_delta, losses_delta, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
      `).run(
        userId,
        req.session.user.id,
        deltas.points,
        deltas.matches_played,
        deltas.wins,
        deltas.draws,
        deltas.losses,
        reason,
      );
      return Number(result.lastInsertRowid);
    })();

    const adjustment = await db.prepare(`
      SELECT sa.id, sa.user_id, player.alias AS player_alias,
        sa.admin_id, admin.alias AS admin_alias,
        sa.points_delta, sa.matches_played_delta, sa.wins_delta,
        sa.draws_delta, sa.losses_delta, sa.reason, sa.created_at
      FROM standing_adjustments sa
      JOIN users player ON player.id = sa.user_id
      JOIN users admin ON admin.id = sa.admin_id
      WHERE sa.id = ?
    `).get(adjustmentId);
    res.status(201).json({ adjustment, standings: await getStandingsRows() });
  } catch (error) {
    console.error("No se pudo ajustar la clasificación:", error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : "No se pudo guardar el ajuste de clasificación." });
  }
});

app.get("/api/standings", requireUser, async (_req, res) => {
  res.json({ standings: await getStandingsRows(), pot: await currentPot() });
});

app.get("/api/pot", requireUser, async (_req, res) => {
  res.json({ pot: await currentPot() });
});

app.post("/api/admin/matches/:id/draft/start", requireAdmin, async (req, res) => {
  const matchId = Number(req.params.id);
  const match = await db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  if (match.status !== "closed") return res.status(409).json({ error: "El draft solo se puede iniciar con la convocatoria cerrada." });
  const previousDraft = readJson(match.draft_state, {});
  if (["in_progress", "complete"].includes(previousDraft.status)) return res.status(409).json({ error: "El draft de este partido ya se inició." });
  const participants = await db.prepare(`
    SELECT u.id, u.name, u.ranking_position
    FROM convocations c JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.status = 'principal'
      AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
    ORDER BY u.ranking_position IS NULL, u.ranking_position, LOWER(u.name)
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
  await db.prepare("UPDATE matches SET draft_state = ?, team_a = ?, team_b = ? WHERE id = ?")
    .run(JSON.stringify(draft), JSON.stringify([captainA.id]), JSON.stringify([captainB.id]), matchId);
  res.json(await matchDetails(await db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)));
});

app.post("/api/matches/:id/draft/pick", requirePlayer, async (req, res) => {
  const matchId = Number(req.params.id);
  const playerId = Number(req.body?.userId);
  const pickerId = req.session.user.id;
  const match = await db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  const draft = readJson(match.draft_state, {});
  if (match.status !== "closed" || draft.status !== "in_progress") {
    return res.status(409).json({ error: "No hay un draft abierto para este partido." });
  }
  const teamA = readJson(match.team_a, []);
  const teamB = readJson(match.team_b, []);
  const integrityError = await validateDraftState(matchId, draft, teamA, teamB);
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
  if (!await db.prepare(`
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
  const finalIntegrityError = await validateDraftState(matchId, draft, teamA, teamB);
  if (finalIntegrityError) {
    return res.status(409).json({
      error: `No se puede confirmar la alineación final: ${finalIntegrityError}`,
      draftInvalid: true,
    });
  }
  await db.prepare("UPDATE matches SET draft_state = ?, team_a = ?, team_b = ? WHERE id = ?")
    .run(JSON.stringify(draft), JSON.stringify(teamA), JSON.stringify(teamB), matchId);
  res.json(await matchDetails(await db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)));
});

app.post("/api/admin/matches/:id/price", requireAdmin, async (req, res) => {
  const matchId = Number(req.params.id);
  const price = Number(req.body?.price_total);
  const priceCents = moneyCents(price);
  const match = await db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  if (match.status === "cancelled") return res.status(409).json({ error: "Una convocatoria cancelada no admite precio ni cobros." });
  if (!Number.isFinite(price) || price < 0 || !Number.isSafeInteger(priceCents)) {
    return res.status(400).json({ error: "Introduce un precio total válido, igual o superior a cero." });
  }
  if (match.status === "played") {
    return res.status(409).json({ error: "No se puede definir un precio retroactivo para un partido jugado." });
  }
  if (await db.prepare("SELECT 1 FROM match_finances WHERE match_id = ?").get(matchId)) {
    return res.status(409).json({ error: "El cobro ya se aplicó al registrar el resultado y el precio no se puede cambiar." });
  }
  await db.prepare("UPDATE matches SET pitch_price = ? WHERE id = ?").run(priceCents / 100, matchId);
  res.json({ match: await matchDetails(await db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)) });
});

app.post("/api/admin/matches/:id/finance", requireAdmin, (_req, res) =>
  res.status(410).json({ error: "El cobro ahora se calcula automáticamente al guardar el resultado. Configura el Precio por Partido en Finanzas." }),
);

app.post("/api/admin/matches/:id/result", requireAdmin, async (req, res) => {
  const matchId = Number(req.params.id);
  const result = req.body?.result;
  const match = await db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  if (!["A", "B", "draw"].includes(result)) return res.status(400).json({ error: "El resultado debe ser A, B o empate." });
  if (match.status === "cancelled") return res.status(409).json({ error: "Una convocatoria cancelada no admite resultados, cobros ni puntos." });
  if (!["closed", "played"].includes(match.status) || readJson(match.draft_state, {}).status !== "complete") {
    return res.status(409).json({ error: "Cierra la convocatoria y completa el draft antes de guardar el resultado." });
  }
  const rawTeamA = readJson(match.team_a, []);
  const rawTeamB = readJson(match.team_b, []);
  const draftIntegrityError = await validateDraftState(matchId, readJson(match.draft_state, {}), rawTeamA, rawTeamB);
  if (draftIntegrityError) {
    return res.status(409).json({
      error: `No se puede guardar el resultado ni cobrar: draft inconsistente. ${draftIntegrityError}`,
      draftInvalid: true,
    });
  }
  const teamA = await nonAdminPlayerIds(rawTeamA);
  const teamB = await nonAdminPlayerIds(rawTeamB);
  const existingFinance = await db.prepare("SELECT 1 FROM match_finances WHERE match_id = ?").get(matchId);
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
  const saveResult = db.transaction(async () => {
    const latestMatch = await db.prepare("SELECT status FROM matches WHERE id = ?").get(matchId);
    const financeExists = await db.prepare("SELECT 1 FROM match_finances WHERE match_id = ?").get(matchId);
    if (charge && (latestMatch?.status !== "closed" || financeExists)) charge = null;
    await db.prepare("UPDATE matches SET status = 'played', result = ? WHERE id = ?").run(result, matchId);
    if (charge) {
      const insertTransaction = db.prepare(`
        INSERT INTO transactions (user_id, amount, concept, match_id, transaction_type)
        VALUES (?, ?, ?, ?, 'match_charge')
      `);
      const debitPlayer = db.prepare("UPDATE users SET balance = ROUND((balance - ?) * 100) / 100 WHERE id = ?");
      if (charge.feeCents > 0) {
        for (const userId of charge.participants) {
          await debitPlayer.run(charge.feeCents / 100, userId);
          await insertTransaction.run(userId, -(charge.feeCents / 100), `Partido #${matchId}: cuota automática`, matchId);
        }
      }
      const currentPotCents = await lockCurrentPotCents();
      const updatedPotCents = currentPotCents + charge.potAddedCents;
      if (!Number.isSafeInteger(updatedPotCents)) {
        throw new Error("El saldo del bote excede el rango permitido.");
      }
      await db.prepare(`
        INSERT INTO app_settings (key, value) VALUES ('pot_cents', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(updatedPotCents));
      await db.prepare(`
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
      if (charge.potAddedCents !== 0) {
        await db.prepare(`
          INSERT INTO bote_transactions
            (match_id, concept, amount, movement_type, balance_after, created_by)
          VALUES (?, ?, ?, 'match_remainder', ?, ?)
        `).run(
          matchId,
          `Remanente de cuota · Partido #${matchId}`,
          charge.potAddedCents / 100,
          updatedPotCents / 100,
          req.session.user.id,
        );
      }
    }
    await recalculateMatchPoints(matchId, result, teamA, teamB);
  });
  try {
    await saveResult();
  } catch (error) {
    console.error("No se pudo guardar el resultado:", error.message);
    return res.status(500).json({ error: "No se pudo guardar el resultado." });
  }
  res.json({
    match: await matchDetails(await db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)),
    pot: await currentPot(),
    charged: Boolean(charge),
  });
});

app.post("/api/admin/matches/:id/notify-negative-balances", requireAdmin, async (req, res) => {
  const matchId = Number(req.params.id);
  const match = await db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  try {
    res.json(await sendNegativeBalanceAlert(match));
  } catch (error) {
    res.status(500).json({ error: "No se pudieron enviar las alertas de saldo." });
  }
});

app.post("/api/convocations/me", requirePlayer, async (req, res) => {
  const response = req.body?.response;
  if (!["yes", "no"].includes(response)) {
    return res.status(400).json({ error: "Elige «Sí voy» o «No voy»." });
  }
  const match = await getCurrentMatch();
  if (!match) return res.status(409).json({ error: "No hay una convocatoria abierta." });
  if (match.status !== "open") {
    return res.status(409).json({ error: "La convocatoria ya está cerrada." });
  }
  const user = await db.prepare("SELECT id, role, base_role FROM users WHERE id = ?")
    .get(req.session.user.id);
  if (!user) return res.status(401).json({ error: "La cuenta ya no existe." });
  const status = response === "no" ? "no_va" : user.base_role;
  await db.prepare(`
    INSERT INTO convocations (match_id, user_id, status, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(match_id, user_id)
    DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `).run(match.id, user.id, status);
  res.json(await getConvocationData(match, user.id));
});

app.get("/api/convocations/current/available-suplentes", requirePlayer, async (req, res) => {
  const match = await getCurrentMatch();
  if (!match || match.status !== "open") {
    return res.status(409).json({ error: "No hay una convocatoria abierta." });
  }
  const players = await db.prepare(`
    SELECT u.id, u.alias
    FROM users u
    LEFT JOIN convocations c ON c.match_id = ? AND c.user_id = u.id
    WHERE u.role = 'suplente' AND u.base_role = 'suplente'
      AND u.account_status = 'active' AND u.deleted_at IS NULL
      AND c.user_id IS NULL
    ORDER BY u.ranking_position IS NULL, u.ranking_position, LOWER(u.alias)
  `).all(match.id);
  res.json({ players });
});

app.post("/api/convocations/current/add-existing-suplente", requirePlayer, async (req, res) => {
  const userId = Number(req.body?.user_id);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: "Selecciona un suplente válido." });
  }
  const match = await getCurrentMatch();
  if (!match || match.status !== "open") {
    return res.status(409).json({ error: "No hay una convocatoria abierta." });
  }
  try {
    await db.transaction(async () => {
      const current = await getCurrentMatch();
      if (!current || current.id !== match.id || current.status !== "open") {
        const error = new Error("La convocatoria ya no está abierta.");
        error.status = 409;
        throw error;
      }
      const candidate = await db.prepare(`
        SELECT id FROM users
        WHERE id = ? AND role = 'suplente' AND base_role = 'suplente'
          AND account_status = 'active' AND deleted_at IS NULL
      `).get(userId);
      if (!candidate) {
        const error = new Error("No se encontró un suplente activo válido.");
        error.status = 409;
        throw error;
      }
      if (await db.prepare("SELECT 1 FROM convocations WHERE match_id = ? AND user_id = ?").get(match.id, userId)) {
        const error = new Error("Ese jugador ya respondió a esta convocatoria.");
        error.status = 409;
        throw error;
      }
      await db.prepare(`
        INSERT INTO convocations (match_id, user_id, status, updated_at, invited_by_user_id)
        VALUES (?, ?, 'suplente', CURRENT_TIMESTAMP, ?)
      `).run(match.id, userId, req.session.user.id);
    })();
    res.json(await getConvocationData(match, req.session.user.id));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : "No se pudo añadir al suplente." });
  }
});

app.post("/api/convocations/current/add-new-suplente", requirePlayer, async (req, res) => {
  const firstName = String(req.body?.first_name || "").trim().replace(/\s+/g, " ");
  const lastName = String(req.body?.last_name || "").trim().replace(/\s+/g, " ");
  const alias = String(req.body?.alias || "").trim().normalize("NFKC").toLowerCase();
  if (!firstName || firstName.length > 60 || !lastName || lastName.length > 80) {
    return res.status(400).json({ error: "Indica un nombre y unos apellidos válidos." });
  }
  if (!/^[\p{L}\p{N}._-]{3,24}$/u.test(alias)) {
    return res.status(400).json({ error: "El alias debe tener entre 3 y 24 letras, números, puntos, guiones o guiones bajos." });
  }
  const match = await getCurrentMatch();
  if (!match || match.status !== "open") {
    return res.status(409).json({ error: "No hay una convocatoria abierta." });
  }
  try {
    const passwordHash = await bcrypt.hash(defaultSubstitutePassword, 12);
    const createdUserId = await db.transaction(async () => {
      const current = await getCurrentMatch();
      if (!current || current.id !== match.id || current.status !== "open") {
        const error = new Error("La convocatoria ya no está abierta.");
        error.status = 409;
        throw error;
      }
      if (await db.prepare("SELECT 1 FROM users WHERE LOWER(alias) = LOWER(?)").get(alias)) {
        const error = new Error("Ese alias ya está en uso.");
        error.status = 409;
        throw error;
      }
      const name = `${firstName} ${lastName}`;
      const rankingPosition = (await db.prepare(`
        SELECT COALESCE(MAX(ranking_position), 0) + 1 AS next_position
        FROM users WHERE role != 'admin'
      `).get()).next_position;
      const created = await db.prepare(`
        INSERT INTO users (name, first_name, last_name, alias, password_hash, account_status,
          must_change_password, role, base_role, ranking_position, balance, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', 1, 'suplente', 'suplente', ?, 0, CURRENT_TIMESTAMP) RETURNING id
      `).run(name, firstName, lastName, alias, passwordHash, rankingPosition);
      const userId = Number(created.lastInsertRowid);
      await db.prepare(`
        INSERT INTO substitute_approval_requests (user_id, match_id, invited_by_user_id)
        VALUES (?, ?, ?)
      `).run(userId, match.id, req.session.user.id);
      return userId;
    })();
    res.status(201).json({
      pending_approval: true,
      added_player: await db.prepare("SELECT id, alias FROM users WHERE id = ?").get(createdUserId),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (String(error.code || "").includes("CONSTRAINT")) {
      return res.status(409).json({ error: "Ese alias ya está en uso." });
    }
    console.error("No se pudo añadir el suplente:", error.message);
    res.status(500).json({ error: "No se pudo crear la cuenta de suplente." });
  }
});

app.delete("/api/convocations/current/suplentes/:userId", requireUser, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: "Selecciona un suplente válido." });
  }
  const match = await getCurrentMatch();
  if (!match || match.status !== "open") {
    return res.status(409).json({ error: "No hay una convocatoria abierta." });
  }

  try {
    await db.transaction(async () => {
      const latestMatch = await db.prepare("SELECT id, status FROM matches WHERE id = ?").get(match.id);
      if (!latestMatch || latestMatch.status !== "open") {
        const error = new Error("La convocatoria ya no está abierta.");
        error.status = 409;
        throw error;
      }

      const actor = await db.prepare(`
        SELECT id, role FROM users
        WHERE id = ? AND account_status = 'active' AND deleted_at IS NULL
      `).get(req.session.user.id);
      if (!actor) {
        const error = new Error("La cuenta ya no está activa.");
        error.status = 401;
        throw error;
      }

      const invitation = await db.prepare(`
        SELECT invited_by_user_id FROM convocations
        WHERE match_id = ? AND user_id = ? AND status = 'suplente'
        FOR UPDATE
      `).get(match.id, userId);
      if (!invitation) {
        const error = new Error("Ese jugador ya no está en la lista de suplentes.");
        error.status = 409;
        throw error;
      }

      const isAdmin = actor.role === "admin";
      const isInviter = Number(invitation.invited_by_user_id) === Number(actor.id);
      if (!isAdmin && !isInviter) {
        const error = new Error("Solo quien añadió a este suplente o un administrador puede quitarlo.");
        error.status = 403;
        throw error;
      }

      const deleted = await db.prepare(`
        DELETE FROM convocations
        WHERE match_id = ? AND user_id = ? AND status = 'suplente'
          AND (? = TRUE OR invited_by_user_id = ?)
        RETURNING user_id
      `).get(match.id, userId, isAdmin, actor.id);
      if (!deleted) {
        const error = new Error("No se pudo quitar al suplente de la convocatoria.");
        error.status = 409;
        throw error;
      }
    })();

    res.json(await getConvocationData(match, req.session.user.id));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("No se pudo quitar al suplente:", error.message);
    res.status(500).json({ error: "No se pudo quitar al suplente de la convocatoria." });
  }
});

app.post([
  "/api/admin/convocations/current/:userId/status",
  "/api/admin/convocations/current/:userId/no-va",
], requireAdmin, async (req, res) => {
  const match = await getCurrentMatch();
  if (!match) return res.status(409).json({ error: "No hay una convocatoria abierta." });
  if (match.status !== "open") {
    return res.status(409).json({ error: "La convocatoria está cerrada; ya no se pueden cambiar las listas." });
  }
  const targetStatus = req.body.status || "no_va";
  if (!["suplente", "no_va"].includes(targetStatus)) {
    return res.status(400).json({ error: "El destino debe ser Suplentes o NO VAN." });
  }
  const userId = Number(req.params.userId);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    return res.status(400).json({ error: "Selecciona un jugador válido." });
  }

  try {
    const outcome = await db.transaction(async () => {
      const latestMatch = await db.prepare("SELECT status FROM matches WHERE id = ? FOR UPDATE").get(match.id);
      if (latestMatch?.status !== "open") {
        return { error: "La convocatoria ya no está abierta.", status: 409 };
      }
      const principal = await db.prepare(`
        SELECT c.user_id, u.alias
        FROM convocations c
        JOIN users u ON u.id = c.user_id
        WHERE c.match_id = ? AND c.user_id = ? AND c.status = 'principal'
          AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
        FOR UPDATE OF c, u
      `).get(match.id, userId);
      if (!principal) {
        return { error: "El jugador ya no está en la Lista Principal de esta convocatoria.", status: 409 };
      }

      let refundedCents = 0;
      const finance = await db.prepare(`
        SELECT * FROM match_finances WHERE match_id = ? FOR UPDATE
      `).get(match.id);
      let updatedCollectedCents = 0;
      let updatedPotAddedCents = 0;
      let updatedParticipants = null;
      if (finance) {
        updatedCollectedCents = moneyCents(finance.total_collected);
        updatedPotAddedCents = moneyCents(finance.pot_added);
        updatedParticipants = Number(finance.participants) - 1;
        if (![updatedCollectedCents, updatedPotAddedCents, updatedParticipants].every(Number.isSafeInteger) ||
            updatedParticipants < 0) {
          return { error: "Los datos financieros del partido son inconsistentes; no se ha cambiado la convocatoria.", status: 409 };
        }
      }
      const charge = await db.prepare(`
        SELECT id FROM transactions
        WHERE user_id = ? AND match_id = ? AND transaction_type = 'match_charge'
        ORDER BY id LIMIT 1 FOR UPDATE
      `).get(userId, match.id);
      if (charge) {
        const netCents = (await db.prepare(`
          SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) AS cents
          FROM transactions WHERE id = ? OR adjustment_of = ?
        `).get(charge.id, charge.id)).cents;
        const currentChargeCents = -netCents;
        if (!Number.isSafeInteger(currentChargeCents) || currentChargeCents < 0) {
          return { error: "El historial del cargo es inconsistente; no se ha cambiado la convocatoria.", status: 409 };
        }

        if (currentChargeCents > 0) {
          let updatedPotCents = null;
          if (finance) {
            updatedCollectedCents -= currentChargeCents;
            updatedPotAddedCents -= currentChargeCents;
            updatedPotCents = await lockCurrentPotCents() - currentChargeCents;
            if (![updatedCollectedCents, updatedPotAddedCents, updatedPotCents].every(Number.isSafeInteger) ||
                updatedCollectedCents < 0) {
              return { error: "No se pudo recalcular el cobro del partido; no se ha cambiado la convocatoria.", status: 409 };
            }
          }

          await db.prepare(`
            INSERT INTO transactions
              (user_id, amount, concept, match_id, transaction_type, adjustment_of)
            VALUES (?, ?, ?, ?, 'adjustment', ?)
          `).run(
            userId,
            currentChargeCents / 100,
            `Devolución del cargo del partido #${match.id}: cambio de Lista Principal a ${targetStatus === "suplente" ? "Suplentes" : "NO VAN"}`,
            match.id,
            charge.id,
          );
          await db.prepare("UPDATE users SET balance = ROUND((balance + ?) * 100) / 100 WHERE id = ?")
            .run(currentChargeCents / 100, userId);
          await db.prepare(`
            UPDATE transactions SET status = 'refunded', adjusted_by = ?, adjusted_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(req.session.user.id, charge.id);
          if (finance) {
            await db.prepare(`
              INSERT INTO bote_transactions
                (match_id, concept, amount, movement_type, balance_after, created_by)
              VALUES (?, ?, ?, 'match_adjustment', ?, ?)
            `).run(
              match.id,
              `Devolución de cuota de @${principal.alias} · Partido #${match.id}`,
              -(currentChargeCents / 100),
              updatedPotCents / 100,
              req.session.user.id,
            );
            await db.prepare(`
              INSERT INTO app_settings (key, value) VALUES ('pot_cents', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `).run(String(updatedPotCents));
          }
          refundedCents = currentChargeCents;
        }
      }
      if (finance) {
        await db.prepare(`
          UPDATE match_finances
          SET participants = ?, total_collected = ?, pot_added = ?
          WHERE match_id = ?
        `).run(
          updatedParticipants,
          updatedCollectedCents / 100,
          updatedPotAddedCents / 100,
          match.id,
        );
      }

      const changed = await db.prepare(`
        UPDATE convocations
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE match_id = ? AND user_id = ? AND status = 'principal'
        RETURNING user_id
      `).get(targetStatus, match.id, userId);
      if (!changed) {
        const error = new Error("No se pudo actualizar la respuesta del jugador.");
        error.status = 409;
        throw error;
      }
      return { alias: principal.alias, refunded: refundedCents / 100, status: targetStatus };
    })();

    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    if (outcome.status === "no_va") {
      await sendRosterRemovalNotification(userId, outcome.alias, match.id);
    }
    res.json({
      ...await getConvocationData(match, req.session.user.id),
      removedAlias: outcome.alias,
      refunded: outcome.refunded,
      movedTo: outcome.status,
    });
  } catch (error) {
    console.error("No se pudo actualizar el estado del jugador en la convocatoria:", error.message);
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: "No se pudo actualizar la Lista Principal." });
  }
});

app.post("/api/admin/convocations/:userId/promote", requireAdmin, async (req, res) => {
  const match = await getCurrentMatch();
  if (!match) return res.status(409).json({ error: "No hay una convocatoria abierta." });
  if (match.status !== "open") {
    return res.status(409).json({ error: "La convocatoria está cerrada; ya no se pueden mover jugadores." });
  }
  const userId = Number(req.params.userId);
  const promotion = await db.transaction(async () => {
    const response = await db.prepare(`
      SELECT c.invited_by_user_id, u.alias AS promoted_alias,
        inviter.alias AS inviter_alias, inviter.role AS inviter_role,
        inviter.account_status AS inviter_account_status, inviter.deleted_at AS inviter_deleted_at
      FROM convocations c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN users inviter ON inviter.id = c.invited_by_user_id
      WHERE c.match_id = ? AND c.user_id = ? AND c.status = 'suplente'
        AND u.role != 'admin' AND u.account_status = 'active' AND u.deleted_at IS NULL
      FOR UPDATE OF c
    `).get(match.id, userId);
    if (!response) return null;
    const updated = await db.prepare(`
      UPDATE convocations SET status = 'principal', updated_at = CURRENT_TIMESTAMP
      WHERE match_id = ? AND user_id = ? AND status = 'suplente'
      RETURNING user_id
    `).get(match.id, userId);
    return updated ? response : null;
  })();
  if (!promotion) {
    return res.status(409).json({ error: "Solo se puede promover a alguien de la lista de suplentes." });
  }

  const notifications = [
    sendPromotionNotification(userId, `suplente @${promotion.promoted_alias}`, {
      title: "¡Pasas a la Lista Principal!",
      body: "Has sido promocionado para jugar el próximo partido. ¡Revisa la convocatoria en la app!",
      url: "/",
      tag: `promotion-${match.id}-${userId}`,
    }),
  ];
  const inviterId = Number(promotion.invited_by_user_id);
  const inviterIsDifferentUser = Number.isSafeInteger(inviterId) && inviterId > 0 && inviterId !== userId;
  const inviterIsNonAdmin = promotion.inviter_role && promotion.inviter_role !== "admin";
  const inviterIsActive = promotion.inviter_account_status === "active" && !promotion.inviter_deleted_at;
  if (inviterIsDifferentUser && inviterIsNonAdmin && inviterIsActive) {
    notifications.push(sendPromotionNotification(inviterId, `invitador @${promotion.inviter_alias}`, {
      title: "Tu suplente entra en el partido",
      body: `Tu suplente ${promotion.promoted_alias} ha pasado a la Lista Principal para el próximo partido.`,
      url: "/",
      tag: `promotion-invited-${match.id}-${inviterId}-${userId}`,
    }));
  } else if (promotion.invited_by_user_id) {
    console.info(`[Web Push promoción] Solo se avisará a @${promotion.promoted_alias}: el registro no tiene un invitador jugador activo.`);
  }
  await Promise.all(notifications);

  res.json(await getConvocationData(match, req.session.user.id));
});

app.get("/api/push/config", requireUser, (_req, res) => {
  res.json({ enabled: pushConfigured, publicKey: pushConfigured ? vapidPublicKey : null });
});

app.post(["/api/subscriptions", "/api/push/subscriptions"], requireUser, async (req, res) => {
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
  await db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint)
    DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(req.session.user.id, endpoint, keys.p256dh, keys.auth);
  res.status(201).json({ subscribed: true });
});

app.delete("/api/push/subscriptions", requireUser, async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== "string") return res.status(400).json({ error: "Falta el endpoint de la suscripción." });
  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
    .run(endpoint, req.session.user.id);
  res.status(204).end();
});

app.get("/api/admin/notifications/status", requireAdmin, async (_req, res) => {
  const match = await getCurrentMatch();
  if (!match) return res.json({ enabled: pushConfigured, matchId: null, campaigns: {} });
  const campaigns = await db.prepare("SELECT type, status, delivered_count, sent_at FROM push_campaigns WHERE match_id = ?")
    .all(match.id);
  res.json({
    enabled: pushConfigured,
    matchId: match.id,
    campaigns: Object.fromEntries(campaigns.map((campaign) => [campaign.type, campaign])),
  });
});

app.post("/api/admin/notifications/:type", requireAdmin, async (req, res) => {
  if (req.params.type === "opening") {
    try {
      return res.json(await sendManualOpeningNotification());
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.message || "No se pudo enviar la notificación.",
      });
    }
  }

  const match = await getCurrentMatch();
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
  const match = await getCurrentMatch();
  if (!match) return res.status(409).json({ error: "No hay una convocatoria abierta." });
  if (!Number.isInteger(userId)) return res.status(400).json({ error: "Selecciona un jugador válido." });
  const player = await db.prepare(`
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

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  const users = await db
    .prepare(
      "SELECT id, name, first_name, last_name, alias, role, base_role, ranking_position, balance FROM users WHERE role != 'admin' AND account_status = 'active' AND deleted_at IS NULL ORDER BY ranking_position IS NULL, ranking_position, name",
    )
    .all();
  res.json(users);
});

app.get("/api/admin/finance/overview", requireAdmin, async (_req, res) => {
  const players = await db.prepare(`
    SELECT id, name, alias, base_role, balance
    FROM users
    WHERE role != 'admin' AND account_status = 'active' AND deleted_at IS NULL
    ORDER BY balance ASC, LOWER(name)
  `).all();
  const transactions = await db.prepare(`
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
  const potTransactions = await db.prepare(`
    SELECT bt.id, bt.match_id, bt.concept, bt.amount, bt.movement_type,
      bt.balance_after, bt.created_at, creator.alias AS created_by_alias
    FROM bote_transactions bt
    LEFT JOIN users creator ON creator.id = bt.created_by
    ORDER BY bt.created_at DESC, bt.id DESC
  `).all();
  res.json({ players, transactions, pot: await currentPot(), potTransactions });
});

app.post("/api/admin/finance/pot-transactions", requireAdmin, async (req, res) => {
  const concept = String(req.body?.concept || "").trim();
  const amount = Number(req.body?.amount);
  const operation = req.body?.operation;
  if (!concept || concept.length > 160) {
    return res.status(400).json({ error: "Indica un concepto de hasta 160 caracteres." });
  }
  if (!["income", "expense"].includes(operation)) {
    return res.status(400).json({ error: "Elige ingreso o gasto para el movimiento." });
  }
  const amountCents = moneyCents(amount);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return res.status(400).json({ error: "El importe debe ser un número positivo válido." });
  }

  try {
    const result = await db.transaction(async () => {
      const currentCents = await lockCurrentPotCents();
      const signedCents = operation === "income" ? amountCents : -amountCents;
      const updatedCents = currentCents + signedCents;
      if (!Number.isSafeInteger(updatedCents)) {
        const error = new Error("El ajuste excede el rango permitido del bote.");
        error.status = 400;
        throw error;
      }
      const type = operation === "income" ? "manual_income" : "manual_expense";
      const movementAmount = signedCents / 100;
      const balanceAfter = updatedCents / 100;
      await db.prepare(`
        INSERT INTO app_settings (key, value) VALUES ('pot_cents', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(updatedCents));
      const inserted = await db.prepare(`
        INSERT INTO bote_transactions
          (concept, amount, movement_type, balance_after, created_by)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id
      `).run(concept, movementAmount, type, balanceAfter, req.session.user.id);
      const movement = await db.prepare(`
        SELECT id, concept, amount, movement_type, balance_after, created_at
        FROM bote_transactions WHERE id = ?
      `).get(inserted.lastInsertRowid);
      return { movement, pot: balanceAfter };
    })();
    res.status(201).json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("No se pudo registrar el ajuste del bote:", error.message);
    res.status(500).json({ error: "No se pudo registrar el movimiento del bote." });
  }
});

app.post("/api/admin/finance/transactions/:id/adjust", requireAdmin, async (req, res) => {
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
  const original = await db.prepare(`
    SELECT t.id FROM transactions t JOIN match_finances mf ON mf.match_id = t.match_id
    WHERE t.id = ? AND t.transaction_type = 'match_charge'
  `).get(transactionId);
  if (!original) return res.status(404).json({ error: "No se encontró un cargo de partido corregible." });

  const applyAdjustment = db.transaction(async () => {
    const charge = await db.prepare(`
      SELECT t.id, t.user_id, t.match_id
      FROM transactions t JOIN match_finances mf ON mf.match_id = t.match_id
      WHERE t.id = ? AND t.transaction_type = 'match_charge'
    `).get(transactionId);
    if (!charge) return { error: "El cargo ya no está disponible para corregir.", status: 409 };
    const netCents = (await db.prepare(`
      SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) AS cents
      FROM transactions WHERE id = ? OR adjustment_of = ?
    `).get(transactionId, transactionId)).cents;
    const currentChargeCents = -netCents;
    if (!Number.isSafeInteger(currentChargeCents) || currentChargeCents < 0) {
      return { error: "El historial de este cargo es inconsistente; no se ha modificado nada.", status: 409 };
    }
    if (targetCents === currentChargeCents) {
      return { error: "La cuota indicada ya coincide con el importe cobrado.", status: 409 };
    }
    if (!await db.prepare("SELECT 1 FROM users WHERE id = ?").get(charge.user_id)) {
      return { error: "No se encontró la cuenta asociada al cargo.", status: 409 };
    }

    const balanceDeltaCents = currentChargeCents - targetCents;
    const collectedDeltaCents = targetCents - currentChargeCents;
    const finance = await db.prepare("SELECT * FROM match_finances WHERE match_id = ?").get(charge.match_id);
    const updatedCollectedCents = moneyCents(finance.total_collected) + collectedDeltaCents;
    const updatedPotAddedCents = moneyCents(finance.pot_added) + collectedDeltaCents;
    const updatedPotCents = await lockCurrentPotCents() + collectedDeltaCents;
    if (![updatedCollectedCents, updatedPotAddedCents, updatedPotCents].every(Number.isSafeInteger) ||
        updatedCollectedCents < 0) {
      return { error: "El ajuste excede el rango financiero permitido; no se ha modificado nada.", status: 400 };
    }

    const status = targetCents === 0 ? "refunded" : "adjusted";
    const targetText = (targetCents / 100).toFixed(2).replace(".", ",");
    const concept = action === "refund"
      ? `Devolución íntegra del cargo del partido #${charge.match_id}: ${reason}`
      : `Corrección de cuota del partido #${charge.match_id}; nueva cuota ${targetText} €: ${reason}`;
    await db.prepare(`
      INSERT INTO transactions
        (user_id, amount, concept, match_id, transaction_type, adjustment_of)
      VALUES (?, ?, ?, ?, 'adjustment', ?)
    `).run(charge.user_id, balanceDeltaCents / 100, concept, charge.match_id, transactionId);
    await db.prepare("UPDATE users SET balance = ROUND((balance + ?) * 100) / 100 WHERE id = ?")
      .run(balanceDeltaCents / 100, charge.user_id);
    await db.prepare(`
      UPDATE transactions SET status = ?, adjusted_by = ?, adjusted_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, req.session.user.id, transactionId);
    await db.prepare(`
      UPDATE match_finances SET total_collected = ?, pot_added = ? WHERE match_id = ?
    `).run(updatedCollectedCents / 100, updatedPotAddedCents / 100, charge.match_id);
    if (collectedDeltaCents !== 0) {
      await db.prepare(`
        INSERT INTO bote_transactions
          (match_id, concept, amount, movement_type, balance_after, created_by)
        VALUES (?, ?, ?, 'match_adjustment', ?, ?)
      `).run(
        charge.match_id,
        `Corrección del remanente del partido #${charge.match_id}: ${reason}`,
        collectedDeltaCents / 100,
        updatedPotCents / 100,
        req.session.user.id,
      );
    }
    await db.prepare(`
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
  const result = await applyAdjustment();
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/admin/users/:id/balance", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const player = await db.prepare(`
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
  await db.transaction(async () => {
    await db.prepare("UPDATE users SET balance = ROUND((balance + ?) * 100) / 100 WHERE id = ?")
      .run(moneyCents(amount) / 100, id);
    await db.prepare("INSERT INTO transactions (user_id, amount, concept) VALUES (?, ?, ?)")
      .run(id, moneyCents(amount) / 100, concept);
  })();
  res.json({ user: await db.prepare("SELECT id, name, balance FROM users WHERE id = ?").get(id) });
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
  if (await db.prepare("SELECT id FROM users WHERE LOWER(alias) = LOWER(?)").get(alias)) {
    return res.status(409).json({ error: "Ese alias ya está en uso." });
  }
  if (rank !== null && (!Number.isInteger(rank) || rank < 1)) {
    return res.status(400).json({ error: "La posición del ranking debe ser un entero positivo." });
  }
  if (!Number.isFinite(amount) || !Number.isSafeInteger(moneyCents(amount))) {
    return res.status(400).json({ error: "El saldo debe ser un importe válido." });
  }
  if (rank !== null && await db.prepare("SELECT id FROM users WHERE account_status = 'active' AND role != 'admin' AND ranking_position = ?").get(rank)) {
    return res.status(409).json({ error: "Esa posición ya está asignada a otro jugador activo." });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [firstName, ...lastParts] = cleanName.split(/\s+/);
    const lastName = lastParts.join(" ");
    const result = await db.transaction(async () => {
      const created = await db.prepare(`
        INSERT INTO users (name, first_name, last_name, alias, password_hash, account_status,
          role, base_role, ranking_position, balance)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?) RETURNING id
      `).run(cleanName, firstName, lastName, alias, passwordHash, role, role, rank, moneyCents(amount) / 100);
      if (moneyCents(amount)) {
        await db.prepare("INSERT INTO transactions (user_id, amount, concept) VALUES (?, ?, ?)")
          .run(created.lastInsertRowid, moneyCents(amount) / 100, "Saldo inicial al crear la cuenta");
      }
      return created;
    })();
    res.status(201).json(publicUser(await db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid)));
  } catch (error) {
    if (String(error.code || "").includes("CONSTRAINT")) {
      return res.status(409).json({ error: "Ese alias o posición ya está en uso." });
    }
    res.status(500).json({ error: "No se pudo crear el jugador." });
  }
});

app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.prepare("SELECT * FROM users WHERE id = ? AND role != 'admin' AND account_status = 'active' AND deleted_at IS NULL").get(id);
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
  if (await db.prepare("SELECT id FROM users WHERE LOWER(alias) = LOWER(?) AND id != ?").get(alias, id)) {
    return res.status(409).json({ error: "Ese alias ya está en uso." });
  }
  if (rank !== null && await db.prepare("SELECT id FROM users WHERE account_status = 'active' AND role != 'admin' AND ranking_position = ? AND id != ?").get(rank, id)) {
    return res.status(409).json({ error: "Esa posición ya está asignada a otro jugador activo." });
  }
  const [firstName, ...lastParts] = name.split(/\s+/);
  const lastName = lastParts.join(" ");
  const passwordHash = password ? await bcrypt.hash(password, 12) : current.password_hash;
  await db.transaction(async () => {
    await db.prepare(`
      UPDATE users SET name = ?, first_name = ?, last_name = ?, alias = ?, password_hash = ?,
        role = ?, base_role = ?, ranking_position = ?, balance = ?,
        must_change_password = CASE WHEN ? != '' THEN 1 ELSE must_change_password END
      WHERE id = ?
    `).run(name, firstName, lastName, alias, passwordHash, role, role, rank, amount, password, id);
    const balanceDelta = moneyCents(amount) - moneyCents(current.balance);
    if (balanceDelta) {
      await db.prepare("INSERT INTO transactions (user_id, amount, concept) VALUES (?, ?, ?)")
        .run(id, balanceDelta / 100, "Ajuste manual de saldo desde la ficha del jugador");
    }
  })();
  res.json(publicUser(await db.prepare("SELECT * FROM users WHERE id = ?").get(id)));
});

app.post("/api/admin/users/:id/reset-password", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const player = await db.prepare(`
    SELECT id FROM users WHERE id = ? AND role != 'admin'
      AND account_status = 'active' AND deleted_at IS NULL
  `).get(id);
  if (!player) return res.status(404).json({ error: "No se encontró ese jugador activo." });
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (Buffer.byteLength(password, "utf8") < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ error: "La contraseña temporal debe tener entre 8 y 72 bytes." });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?")
    .run(passwordHash, id);
  res.json({ reset: true, must_change_password: true });
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const activeDraft = (await db.prepare("SELECT draft_state FROM matches WHERE status = 'closed'").all())
    .some((match) => readJson(match.draft_state, {}).status === "in_progress");
  if (activeDraft) {
    return res.status(409).json({ error: "Espera a que termine el draft antes de retirar jugadores." });
  }
  const player = await db.prepare(`
    SELECT id FROM users WHERE id = ? AND role != 'admin'
      AND account_status = 'active' AND deleted_at IS NULL
  `).get(id);
  if (!player) return res.status(404).json({ error: "No se encontró ese jugador activo." });
  await db.transaction(async () => {
    await db.prepare("UPDATE users SET account_status = 'pending', deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    await db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(id);
  })();
  res.json({ deleted: true, preservedHistory: true });
});

cron.schedule("0 10 * * 5", async () => {
  const match = await getCurrentMatch();
  if (!match || match.status !== "open" || match.match_date < madridDate()) return;
  try {
    await sendCampaign(match, "friday_reminder");
  } catch (error) {
    console.error("No se pudo enviar el recordatorio de respuestas:", error.message);
  }
}, { timezone: timeZone });

cron.schedule("0 10 * * *", async () => {
  const tomorrow = shiftDate(madridDate(), 1);
  const matches = await db.prepare(`
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

async function startServer() {
  await db.initialize();
  const defaultAdmin = await db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (!defaultAdmin) {
    const passwordHash = await bcrypt.hash("Opachanga#", 12);
    await db.prepare(`
      INSERT INTO users (name, first_name, last_name, alias, password_hash, account_status,
        must_change_password, role, base_role, ranking_position, balance)
      VALUES ('DIEGO GAY DAVILA', 'DIEGO', 'GAY DAVILA', 'DIMOGARU', ?, 'active', 0,
        'admin', 'principal', NULL, 0)
    `).run(passwordHash);
  }
  await repairCurrentLegacyDraftBalance();
  app.listen(port, HOST, () => {
    console.log(`Server listening on http://${HOST}:${port}`);
  });
}

startServer().catch((error) => {
  console.error("No se pudo inicializar O Pachanga:", error.message);
  process.exitCode = 1;
});
