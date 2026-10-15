const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");

const app = express();
const port = Number(process.env.PORT || 5000);
const dataDirectory = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(dataDirectory, { recursive: true });

const db = new Database(path.join(dataDirectory, "o-pachanga.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('principal', 'suplente', 'admin')),
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
`);

const hasAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
if (!hasAdmin) {
  db.prepare(
    "INSERT INTO users (name, role, ranking_position, balance) VALUES (?, 'admin', NULL, 0)",
  ).run(process.env.INITIAL_ADMIN_NAME || "Admin O Pachanga");
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
  ranking_position: user.ranking_position,
  balance: user.balance,
});

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Se requiere una sesión de administración." });
  }
  next();
}

app.get("/api/users", (_req, res) => {
  const users = db
    .prepare("SELECT id, name, role, ranking_position, balance FROM users ORDER BY role, ranking_position, name")
    .all();
  res.json(users);
});

app.get("/api/session", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/session", (req, res) => {
  const userId = Number(req.body?.userId);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: "Selecciona un usuario válido." });
  }
  const user = db.prepare("SELECT id, name, role FROM users WHERE id = ?").get(userId);
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

app.get("/api/admin/users", requireAdmin, (_req, res) => {
  const users = db
    .prepare(
      "SELECT id, name, role, ranking_position, balance FROM users WHERE role != 'admin' ORDER BY ranking_position IS NULL, ranking_position, name",
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
    .prepare("INSERT INTO users (name, role, ranking_position, balance) VALUES (?, ?, ?, ?)")
    .run(cleanName, role, rank, amount);
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
  db.prepare("UPDATE users SET name = ?, role = ?, ranking_position = ?, balance = ? WHERE id = ?")
    .run(name, role, rank, amount, id);
  res.json(publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id)));
});

app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));
app.get(/.*/, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(port, "0.0.0.0", () => {
  console.log(`O Pachanga disponible en http://0.0.0.0:${port}`);
});
