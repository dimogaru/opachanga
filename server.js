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
    status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'closed', 'played')),
    draft_state TEXT NOT NULL DEFAULT '{}',
    team_a TEXT NOT NULL DEFAULT '[]',
    team_b TEXT NOT NULL DEFAULT '[]',
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
    date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_alias_unique ON users(alias COLLATE NOCASE) WHERE alias IS NOT NULL");
db.prepare("UPDATE users SET account_status = 'pending' WHERE role != 'admin' AND password_hash IS NULL AND account_status = 'active'").run();

const defaultAdminPasswordHash = "$2b$12$gaqaTxzmMlTqHxFpr5iA0uhcd2uwmcIiKAPettfW3dKm9x8Obti22";
let defaultAdmin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
if (!defaultAdmin) {
  const createdAdmin = db.prepare(`
    INSERT INTO users (name, first_name, last_name, alias, password_hash, account_status,
      must_change_password, role, base_role, ranking_position, balance)
    VALUES ('DIEGO GAY DAVILA', 'DIEGO', 'GAY DAVILA', 'DIEGO', ?, 'active', 1, 'admin', 'principal', 1, 0)
  `).run(defaultAdminPasswordHash);
  defaultAdmin = db.prepare("SELECT * FROM users WHERE id = ?").get(createdAdmin.lastInsertRowid);
} else if (!defaultAdmin.alias || !defaultAdmin.password_hash) {
  db.prepare(`
    UPDATE users SET name = 'DIEGO GAY DAVILA', first_name = 'DIEGO', last_name = 'GAY DAVILA',
      alias = COALESCE(NULLIF(alias, ''), 'DIEGO'),
      password_hash = COALESCE(password_hash, ?), account_status = 'active',
      must_change_password = CASE WHEN password_hash IS NULL THEN 1 ELSE must_change_password END,
      base_role = 'principal', ranking_position = 1
    WHERE id = ?
  `).run(defaultAdminPasswordHash, defaultAdmin.id);
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
  role: user.role,
  base_role: user.base_role,
  ranking_position: user.ranking_position,
  balance: user.balance,
});

function requireUser(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Inicia sesión para continuar." });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Se requiere una sesión de administración." });
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

function currentTuesday(date = new Date()) {
  const parts = madridParts(date);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  return shiftDate(localDate, -((weekday - 2 + 7) % 7));
}

function ensureCurrentMatch(date = new Date()) {
  const startDate = currentTuesday(date);
  const endDate = `${shiftDate(startDate, 6)}T20:00:00`;
  let match = db.prepare("SELECT * FROM matches WHERE start_date = ?").get(startDate);
  let created = false;
  if (!match) {
    const result = db
      .prepare("INSERT INTO matches (start_date, end_date, status) VALUES (?, ?, 'open')")
      .run(startDate, endDate);
    match = db.prepare("SELECT * FROM matches WHERE id = ?").get(result.lastInsertRowid);
    created = true;
  }
  const parts = madridParts(date);
  const now = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`;
  if (match.status === "open" && now >= match.end_date) {
    db.prepare("UPDATE matches SET status = 'closed' WHERE id = ?").run(match.id);
    match = db.prepare("SELECT * FROM matches WHERE id = ?").get(match.id);
  }
  if (created && match.status === "open" && pushConfigured) {
    setImmediate(() => sendCampaign(match, "opening").catch((error) => console.error("No se pudo enviar la apertura push:", error.message)));
  }
  return match;
}

function getConvocationData(match, userId) {
  const roster = db.prepare(`
    SELECT u.id, u.name, u.role, u.base_role, u.ranking_position, c.status AS response
    FROM users u
    LEFT JOIN convocations c ON c.user_id = u.id AND c.match_id = ?
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
  const pending = roster.filter((user) => user.response === null);
  const principalCount = principal.length;
  return {
    match,
    lists: { principal, suplentes, no_va: noVan, pending },
    currentResponse: roster.find((user) => user.id === userId)?.response || null,
    principalCount,
    validForMatch: principalCount >= 14 && principalCount <= 16,
    responseCount: principalCount + suplentes.length + noVan.length,
    totalPlayers: roster.length,
  };
}

function moneyCents(value) {
  return Math.round(Number(value) * 100);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function readJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function matchDetails(match) {
  if (!match) return null;
  const teamAIds = readJson(match.team_a, []);
  const teamBIds = readJson(match.team_b, []);
  const draft = readJson(match.draft_state, {});
  const getTeam = (ids) => ids.length
    ? db.prepare(`SELECT id, name, ranking_position FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids)
      .sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id))
    : [];
  const available = draft.remaining?.length ? getTeam(draft.remaining) : [];
  const finance = db.prepare("SELECT * FROM match_finances WHERE match_id = ?").get(match.id) || null;
  const principalCount = db.prepare("SELECT COUNT(*) AS count FROM convocations WHERE match_id = ? AND status = 'principal'")
    .get(match.id).count;
  return {
    ...match,
    draft,
    teamA: getTeam(teamAIds),
    teamB: getTeam(teamBIds),
    available,
    finance,
    principalCount,
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
    WHERE u.balance < 0
  `).all();
  const payload = JSON.stringify({
    title: "Saldo pendiente · O Pachanga",
    body: "Tienes saldo negativo. Revisa tu cuenta antes del partido de mañana.",
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
    ? db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions").all()
    : db.prepare(`
        SELECT s.endpoint, s.p256dh, s.auth
        FROM push_subscriptions s
        LEFT JOIN convocations c ON c.user_id = s.user_id AND c.match_id = ?
        WHERE c.user_id IS NULL
      `).all(match.id);
  const message = type === "opening"
    ? { title: "¡Convocatoria abierta!", body: "Confirma si vienes al partido de esta semana.", url: "/" }
    : { title: "¿Vienes a la pachanga?", body: "Aún no has respondido. Confirma antes del lunes a las 20:00.", url: "/" };
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

app.get("/api/users", (_req, res) => {
  const users = db
    .prepare("SELECT id, name, role, base_role, ranking_position, balance FROM users ORDER BY role, ranking_position, name")
    .all();
  res.json(users);
});

app.get("/api/session", (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  const user = db.prepare("SELECT id, name, role, base_role FROM users WHERE id = ?")
    .get(req.session.user.id);
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }
  req.session.user = user;
  res.json({ user });
});

app.post("/api/session", (req, res) => {
  const userId = Number(req.body?.userId);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: "Selecciona un usuario válido." });
  }
  const user = db.prepare("SELECT id, name, role, base_role FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "No se encontró ese usuario." });
  req.session.user = user;
  res.json({ user });
});

app.delete("/api/session", (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: "No se pudo cerrar la sesión." });
    res.clearCookie("pachanga.sid");
    res.status(204).end();
  });
});

app.get("/api/convocations/current", requireUser, (_req, res) => {
  const match = ensureCurrentMatch();
  res.json(getConvocationData(match, _req.session.user.id));
});

app.get("/api/matches", requireUser, (_req, res) => {
  ensureCurrentMatch();
  const matches = db.prepare("SELECT * FROM matches ORDER BY start_date DESC, id DESC LIMIT 12").all()
    .map(matchDetails);
  res.json({ matches, pot: currentPot() });
});

app.get("/api/standings", requireUser, (_req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.base_role, u.ranking_position,
      COALESCE(SUM(mp.points), 0) AS points,
      COALESCE(SUM(CASE WHEN mp.result = 'win' THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN mp.result = 'draw' THEN 1 ELSE 0 END), 0) AS draws,
      COALESCE(SUM(CASE WHEN mp.result = 'loss' THEN 1 ELSE 0 END), 0) AS losses,
      COUNT(mp.match_id) AS matches_played
    FROM users u
    LEFT JOIN match_points mp ON mp.user_id = u.id
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
  if (readJson(match.draft_state, {}).status) return res.status(409).json({ error: "El draft de este partido ya se inició." });
  const participants = db.prepare(`
    SELECT u.id, u.name, u.ranking_position
    FROM convocations c JOIN users u ON u.id = c.user_id
    WHERE c.match_id = ? AND c.status = 'principal'
    ORDER BY u.ranking_position IS NULL, u.ranking_position, u.name COLLATE NOCASE
  `).all(matchId);
  if (participants.length < 14 || participants.length > 16) {
    return res.status(409).json({ error: "El draft requiere entre 14 y 16 jugadores confirmados en la lista principal." });
  }
  const captainA = participants.find((player) => player.ranking_position === 1);
  const captainB = participants.find((player) => player.ranking_position === 2);
  if (!captainA || !captainB || captainA.id === captainB.id) {
    return res.status(409).json({ error: "Asigna las posiciones de ranking 1 y 2 a dos jugadores confirmados para iniciar el draft." });
  }
  const remaining = participants.filter((player) => player.id !== captainA.id && player.id !== captainB.id).map((player) => player.id);
  const draft = {
    status: "in_progress",
    captainA: captainA.id,
    captainB: captainB.id,
    currentTurn: "B",
    remaining,
    picks: [],
  };
  db.prepare("UPDATE matches SET draft_state = ?, team_a = ?, team_b = ? WHERE id = ?")
    .run(JSON.stringify(draft), JSON.stringify([captainA.id]), JSON.stringify([captainB.id]), matchId);
  res.json(matchDetails(db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)));
});

app.post("/api/admin/matches/:id/draft/pick", requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const playerId = Number(req.body?.userId);
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  const draft = readJson(match.draft_state, {});
  if (match.status !== "closed" || draft.status !== "in_progress") {
    return res.status(409).json({ error: "No hay un draft abierto para este partido." });
  }
  const remaining = draft.remaining || [];
  if (!Number.isInteger(playerId) || !remaining.includes(playerId)) {
    return res.status(400).json({ error: "Selecciona un jugador disponible en el draft." });
  }
  const teamA = readJson(match.team_a, []);
  const teamB = readJson(match.team_b, []);
  const team = draft.currentTurn === "A" ? teamA : teamB;
  team.push(playerId);
  remaining.splice(remaining.indexOf(playerId), 1);
  draft.picks.push({ userId: playerId, team: draft.currentTurn });
  if (remaining.length === 0) {
    draft.status = "complete";
    draft.currentTurn = null;
  } else if (remaining.length === 1 && draft.currentTurn === "A") {
    teamA.push(remaining[0]);
    draft.picks.push({ userId: remaining[0], team: "A", automatic: true });
    remaining.length = 0;
    draft.status = "complete";
    draft.currentTurn = null;
  } else if (remaining.length === 3) {
    draft.currentTurn = "A";
  } else if (remaining.length > 3) {
    draft.currentTurn = draft.currentTurn === "A" ? "B" : "A";
  }
  db.prepare("UPDATE matches SET draft_state = ?, team_a = ?, team_b = ? WHERE id = ?")
    .run(JSON.stringify(draft), JSON.stringify(teamA), JSON.stringify(teamB), matchId);
  res.json(matchDetails(db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)));
});

app.post("/api/admin/matches/:id/finance", requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const pitchCost = Number(req.body?.pitch_cost);
  const feePerPlayer = Number(req.body?.fee_per_player);
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  if (readJson(match.draft_state, {}).status !== "complete") {
    return res.status(409).json({ error: "Completa primero el draft para registrar el cobro." });
  }
  if (!Number.isFinite(pitchCost) || !Number.isFinite(feePerPlayer) || pitchCost < 0 || feePerPlayer < 0) {
    return res.status(400).json({ error: "Introduce importes válidos, iguales o superiores a cero." });
  }
  if (db.prepare("SELECT 1 FROM match_finances WHERE match_id = ?").get(matchId)) {
    return res.status(409).json({ error: "El cobro de este partido ya está registrado." });
  }
  const teamA = readJson(match.team_a, []);
  const teamB = readJson(match.team_b, []);
  const participantIds = [...new Set([...teamA, ...teamB])];
  const costCents = moneyCents(pitchCost);
  const feeCents = moneyCents(feePerPlayer);
  const collectedCents = participantIds.length * feeCents;
  if (!participantIds.length) return res.status(409).json({ error: "No hay participantes en los equipos." });
  if (collectedCents < costCents) {
    return res.status(400).json({ error: "El total cobrado debe cubrir el coste de la pista para que el bote no quede en negativo." });
  }
  const addedPotCents = collectedCents - costCents;
  try {
    db.transaction(() => {
      const insertTransaction = db.prepare("INSERT INTO transactions (user_id, amount, concept) VALUES (?, ?, ?)");
      const debitPlayer = db.prepare("UPDATE users SET balance = ROUND((balance - ?) * 100) / 100 WHERE id = ?");
      for (const userId of participantIds) {
        debitPlayer.run(feeCents / 100, userId);
        insertTransaction.run(userId, -(feeCents / 100), `Partido #${matchId}: cobro por jugador`);
      }
      const currentPotCents = moneyCents(currentPot());
      db.prepare(`
        INSERT INTO app_settings (key, value) VALUES ('pot_cents', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(currentPotCents + addedPotCents));
      db.prepare(`
        INSERT INTO match_finances (match_id, pitch_cost, fee_per_player, participants, total_collected, pot_added)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(matchId, costCents / 100, feeCents / 100, participantIds.length, collectedCents / 100, addedPotCents / 100);
    })();
  } catch (error) {
    console.error("No se pudo registrar el cobro:", error.message);
    return res.status(500).json({ error: "No se pudo completar el cobro; no se aplicaron los cambios." });
  }
  res.json({ match: matchDetails(db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)), pot: currentPot() });
});

app.post("/api/admin/matches/:id/result", requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const result = req.body?.result;
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return res.status(404).json({ error: "No se encontró el partido." });
  if (!["A", "B", "draw"].includes(result)) return res.status(400).json({ error: "El resultado debe ser A, B o empate." });
  if (match.status !== "closed" || readJson(match.draft_state, {}).status !== "complete") {
    return res.status(409).json({ error: "Cierra la convocatoria y completa el draft antes de guardar el resultado." });
  }
  const teamA = readJson(match.team_a, []);
  const teamB = readJson(match.team_b, []);
  const saveResult = db.transaction(() => {
    db.prepare("UPDATE matches SET status = 'played', result = ? WHERE id = ?").run(result, matchId);
    const insertPoints = db.prepare("INSERT INTO match_points (match_id, user_id, points, result) VALUES (?, ?, ?, ?)");
    for (const userId of teamA) {
      const outcome = result === "draw" ? "draw" : result === "A" ? "win" : "loss";
      insertPoints.run(matchId, userId, 1 + (outcome === "win" ? 3 : outcome === "draw" ? 1 : 0), outcome);
    }
    for (const userId of teamB) {
      const outcome = result === "draw" ? "draw" : result === "B" ? "win" : "loss";
      insertPoints.run(matchId, userId, 1 + (outcome === "win" ? 3 : outcome === "draw" ? 1 : 0), outcome);
    }
  });
  try {
    saveResult();
  } catch (error) {
    console.error("No se pudo guardar el resultado:", error.message);
    return res.status(500).json({ error: "No se pudo guardar el resultado." });
  }
  res.json(matchDetails(db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)));
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

app.post("/api/convocations/me", requireUser, (req, res) => {
  const response = req.body?.response;
  if (!["yes", "no"].includes(response)) {
    return res.status(400).json({ error: "Elige «Sí voy» o «No voy»." });
  }
  const match = ensureCurrentMatch();
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
  const match = ensureCurrentMatch();
  if (match.status !== "open") {
    return res.status(409).json({ error: "La convocatoria está cerrada; ya no se pueden mover jugadores." });
  }
  const userId = Number(req.params.userId);
  const response = db.prepare("SELECT status FROM convocations WHERE match_id = ? AND user_id = ?")
    .get(match.id, userId);
  if (!response || response.status !== "suplente") {
    return res.status(409).json({ error: "Solo se puede promover a alguien de la lista de suplentes." });
  }
  db.prepare("UPDATE convocations SET status = 'principal', updated_at = CURRENT_TIMESTAMP WHERE match_id = ? AND user_id = ?")
    .run(match.id, userId);
  res.json(getConvocationData(match, req.session.user.id));
});

app.patch("/api/admin/profile", requireAdmin, (req, res) => {
  const baseRole = req.body?.base_role;
  if (!["principal", "suplente"].includes(baseRole)) {
    return res.status(400).json({ error: "El rol base debe ser principal o suplente." });
  }
  const rawRank = req.body?.ranking_position;
  const rank = rawRank === undefined ? undefined : rawRank === "" || rawRank == null ? null : Number(rawRank);
  if (rank !== undefined && rank !== null && (!Number.isInteger(rank) || rank < 1)) {
    return res.status(400).json({ error: "La posición del ranking debe ser un entero positivo." });
  }
  if (rank === undefined) {
    db.prepare("UPDATE users SET base_role = ? WHERE id = ?").run(baseRole, req.session.user.id);
  } else {
    db.prepare("UPDATE users SET base_role = ?, ranking_position = ? WHERE id = ?")
      .run(baseRole, rank, req.session.user.id);
  }
  req.session.user.base_role = baseRole;
  const user = db.prepare("SELECT id, name, role, base_role, ranking_position FROM users WHERE id = ?")
    .get(req.session.user.id);
  res.json({ user });
});

app.get("/api/push/config", requireUser, (_req, res) => {
  res.json({ enabled: pushConfigured, publicKey: pushConfigured ? vapidPublicKey : null });
});

app.post("/api/push/subscriptions", requireUser, (req, res) => {
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

app.delete("/api/push/subscriptions", requireUser, (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== "string") return res.status(400).json({ error: "Falta el endpoint de la suscripción." });
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
    .run(endpoint, req.session.user.id);
  res.status(204).end();
});

app.get("/api/admin/notifications/status", requireAdmin, (_req, res) => {
  const match = ensureCurrentMatch();
  const campaigns = db.prepare("SELECT type, status, delivered_count, sent_at FROM push_campaigns WHERE match_id = ?")
    .all(match.id);
  res.json({
    enabled: pushConfigured,
    matchId: match.id,
    campaigns: Object.fromEntries(campaigns.map((campaign) => [campaign.type, campaign])),
  });
});

app.post("/api/admin/notifications/:type", requireAdmin, async (req, res) => {
  const match = ensureCurrentMatch();
  if (match.status !== "open") {
    return res.status(409).json({ error: "La convocatoria está cerrada." });
  }
  try {
    const result = await sendCampaign(match, req.params.type);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "No se pudo enviar la notificación." });
  }
});

app.get("/api/admin/users", requireAdmin, (_req, res) => {
  const users = db
    .prepare(
      "SELECT id, name, role, base_role, ranking_position, balance FROM users WHERE role != 'admin' ORDER BY ranking_position IS NULL, ranking_position, name",
    )
    .all();
  res.json(users);
});

app.post("/api/admin/users", requireAdmin, (req, res) => {
  const { name, role, ranking_position: rankingPosition, balance } = req.body || {};
  const cleanName = typeof name === "string" ? name.trim() : "";
  const rank = rankingPosition === "" || rankingPosition == null ? null : Number(rankingPosition);
  const amount = balance === "" || balance == null ? 0 : Number(balance);
  if (!cleanName || cleanName.length > 80) {
    return res.status(400).json({ error: "El nombre es obligatorio y debe tener 80 caracteres o menos." });
  }
  if (!["principal", "suplente"].includes(role)) {
    return res.status(400).json({ error: "El rol debe ser principal o suplente." });
  }
  if (rank !== null && (!Number.isInteger(rank) || rank < 1)) {
    return res.status(400).json({ error: "La posición del ranking debe ser un entero positivo." });
  }
  if (!Number.isFinite(amount)) {
    return res.status(400).json({ error: "El saldo debe ser un importe válido." });
  }
  const result = db
    .prepare("INSERT INTO users (name, role, base_role, ranking_position, balance) VALUES (?, ?, ?, ?, ?)")
    .run(cleanName, role, role, rank, amount);
  res.status(201).json(publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid)));
});

app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM users WHERE id = ? AND role != 'admin'").get(id);
  if (!current) return res.status(404).json({ error: "No se encontró ese jugador." });
  const body = req.body || {};
  const name = body.name === undefined ? current.name : String(body.name).trim();
  const role = body.role === undefined ? current.role : body.role;
  const rawRank = body.ranking_position === undefined ? current.ranking_position : body.ranking_position;
  const rank = rawRank === "" || rawRank == null ? null : Number(rawRank);
  const amount = body.balance === undefined ? current.balance : Number(body.balance);
  if (!name || name.length > 80) {
    return res.status(400).json({ error: "El nombre es obligatorio y debe tener 80 caracteres o menos." });
  }
  if (!["principal", "suplente"].includes(role)) {
    return res.status(400).json({ error: "El rol debe ser principal o suplente." });
  }
  if (rank !== null && (!Number.isInteger(rank) || rank < 1)) {
    return res.status(400).json({ error: "La posición del ranking debe ser un entero positivo." });
  }
  if (!Number.isFinite(amount)) {
    return res.status(400).json({ error: "El saldo debe ser un importe válido." });
  }
  db.prepare("UPDATE users SET name = ?, role = ?, base_role = ?, ranking_position = ?, balance = ? WHERE id = ?")
    .run(name, role, role, rank, amount, id);
  res.json(publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id)));
});

cron.schedule("* * * * *", () => {
  ensureCurrentMatch();
}, { timezone: timeZone });

cron.schedule("5 0 * * 2", async () => {
  const match = ensureCurrentMatch();
  try {
    await sendCampaign(match, "opening");
  } catch (error) {
    console.error("No se pudo enviar la apertura semanal:", error.message);
  }
}, { timezone: timeZone });

cron.schedule("0 10 * * 5", async () => {
  const match = ensureCurrentMatch();
  try {
    await sendCampaign(match, "friday_reminder");
  } catch (error) {
    console.error("No se pudo enviar el recordatorio del viernes:", error.message);
  }
}, { timezone: timeZone });

cron.schedule("0 10 * * 1", async () => {
  const match = ensureCurrentMatch();
  try {
    const result = await sendNegativeBalanceAlert(match);
    if (!result.skipped) console.log(`Alertas de saldo del partido #${match.id}: ${result.delivered || 0} enviadas.`);
  } catch (error) {
    console.error("No se pudieron enviar las alertas de saldo del lunes:", error.message);
  }
}, { timezone: timeZone });

app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));
app.get(/.*/, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(port, "0.0.0.0", () => {
  console.log(`O Pachanga disponible en http://0.0.0.0:${port}`);
});
