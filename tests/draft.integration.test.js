const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { after, before, test } = require("node:test");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3-multiple-ciphers");

const projectDirectory = path.join(__dirname, "..");
const password = "draft-test-password";
const context = {};

async function findAvailablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    if (context.process.exitCode !== null) {
      throw new Error(`El servidor de pruebas terminó antes de iniciar.\n${context.output}`);
    }
    try {
      const response = await fetch(`${context.baseUrl}/api/session`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`El servidor de pruebas no respondió: ${lastError?.message}\n${context.output}`);
}

async function login(alias) {
  const response = await fetch(`${context.baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ alias, password }),
  });
  assert.equal(response.status, 200, `No se pudo iniciar sesión como ${alias}`);
  return response.headers.get("set-cookie").split(";")[0];
}

async function post(pathname, cookie, body) {
  const response = await fetch(`${context.baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
}

async function patch(pathname, cookie, body) {
  const response = await fetch(`${context.baseUrl}${pathname}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function get(pathname, cookie) {
  const response = await fetch(`${context.baseUrl}${pathname}`, {
    headers: { cookie },
  });
  return { response, payload: await response.json() };
}

function createMatchWithRoster(rosterSize) {
  const db = new Database(context.databasePath);
  try {
    const created = db.prepare(`
      INSERT INTO matches (start_date, end_date, status)
      VALUES (?, ?, 'closed')
    `).run(`2026-10-${String(rosterSize).padStart(2, "0")}`, "2026-11-01T20:00:00");
    const matchId = Number(created.lastInsertRowid);
    const players = db.prepare(`
      SELECT id FROM users
      WHERE role = 'principal' AND ranking_position BETWEEN 1 AND ?
      ORDER BY ranking_position
    `).all(rosterSize);
    assert.equal(players.length, rosterSize);
    const addConvocation = db.prepare(`
      INSERT INTO convocations (match_id, user_id, status) VALUES (?, ?, 'principal')
    `);
    db.transaction(() => players.forEach(({ id }) => addConvocation.run(matchId, id)))();
    return { matchId, playerIds: players.map(({ id }) => id) };
  } finally {
    db.close();
  }
}

async function startDraft(matchId, playerIds) {
  return post(
    `/api/admin/matches/${matchId}/draft/start`,
    context.adminCookie,
    { captainA: playerIds[0], captainB: playerIds[1] },
  );
}

before(async () => {
  context.dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "o-pachanga-draft-test-"));
  context.databasePath = path.join(context.dataDirectory, "o-pachanga.sqlite");
  const legacyDb = new Database(context.databasePath);
  try {
    legacyDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('principal', 'suplente', 'admin')),
        ranking_position INTEGER,
        balance REAL NOT NULL DEFAULT 0
      );
      INSERT INTO users (name, role, ranking_position, balance)
      VALUES ('Jugador existente', 'principal', 99, 7.5);
      CREATE TABLE matches (
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
      INSERT INTO matches (start_date, end_date, status)
      VALUES ('2026-10-13', '2026-10-20T20:00:00', 'played');
      CREATE TABLE convocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('principal', 'suplente', 'no_va')),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (match_id, user_id)
      );
      INSERT INTO convocations (match_id, user_id, status) VALUES (1, 1, 'principal');
    `);
  } finally {
    legacyDb.close();
  }
  const port = await findAvailablePort();
  context.baseUrl = `http://127.0.0.1:${port}`;
  context.process = spawn(process.execPath, ["server.js"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      DB_PATH: context.databasePath,
      PORT: String(port),
      NODE_ENV: "test",
      REPL_ID: "test-replit-workspace",
      REPLIT_DEPLOYMENT: "",
      INITIAL_ADMIN_PASSWORD: password,
      SESSION_SECRET: "draft-integration-test-session-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.output = "";
  context.process.stdout.setEncoding("utf8").on("data", (chunk) => { context.output += chunk; });
  context.process.stderr.setEncoding("utf8").on("data", (chunk) => { context.output += chunk; });

  await waitForServer();
  const db = new Database(context.databasePath);
  try {
    const hash = bcrypt.hashSync(password, 4);
    db.prepare("UPDATE users SET password_hash = ? WHERE role = 'admin'").run(hash);
    const addPlayer = db.prepare(`
      INSERT INTO users (
        name, alias, password_hash, account_status, role, base_role, ranking_position
      ) VALUES (?, ?, ?, 'active', 'principal', 'principal', ?)
    `);
    const players = Array.from({ length: 16 }, (_, index) => {
      const rankingPosition = index + 1;
      const alias = `draft${rankingPosition}`;
      const result = addPlayer.run(`Jugador ${rankingPosition}`, alias, hash, rankingPosition);
      return { id: Number(result.lastInsertRowid), alias };
    });
    context.playerIds = players.map((player) => player.id);
    context.captainACookie = await login(players[0].alias);
    context.captainBCookie = await login(players[1].alias);
    context.adminCookie = await login("DIMOGARU");
  } finally {
    db.close();
  }
});

after(async () => {
  if (context.process && context.process.exitCode === null) {
    context.process.kill("SIGTERM");
    await once(context.process, "exit");
  }
  if (context.dataDirectory) fs.rmSync(context.dataDirectory, { recursive: true, force: true });
});

test("solo Admin puede ajustar los totales de clasificación sin alterar resultados de partidos", async () => {
  const initial = await get("/api/standings", context.captainACookie);
  assert.equal(initial.response.status, 200);
  const player = initial.payload.standings.find((row) => row.alias === "draft1");
  assert.ok(player);

  const db = new Database(context.databasePath);
  const matchPointCount = db.prepare("SELECT COUNT(*) AS count FROM match_points").get().count;
  db.close();

  const denied = await post("/api/admin/standings/adjustments", context.captainACookie, {
    user_id: player.id,
    points: 17,
    matches_played: 3,
    wins: 2,
    draws: 1,
    losses: 0,
    reason: "Prueba de autorización",
  });
  assert.equal(denied.response.status, 403);
  const deniedHistory = await get("/api/admin/standings/adjustments", context.captainACookie);
  assert.equal(deniedHistory.response.status, 403);

  const invalid = await post("/api/admin/standings/adjustments", context.adminCookie, {
    user_id: player.id,
    points: 17,
    matches_played: 2,
    wins: 2,
    draws: 1,
    losses: 0,
    reason: "Prueba de validación",
  });
  assert.equal(invalid.response.status, 400);

  const first = await post("/api/admin/standings/adjustments", context.adminCookie, {
    user_id: player.id,
    points: 17,
    matches_played: 3,
    wins: 2,
    draws: 1,
    losses: 0,
    reason: "Ajuste manual de puntos por corrección",
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.payload));
  assert.equal(first.payload.adjustment.points_delta, 17);
  assert.equal(first.payload.adjustment.matches_played_delta, 3);
  assert.equal(first.payload.adjustment.admin_alias, "DIMOGARU");

  const updated = await get("/api/standings", context.captainBCookie);
  assert.equal(updated.payload.standings[0].alias, "draft1");
  assert.deepEqual(
    {
      points: updated.payload.standings[0].points,
      matches_played: updated.payload.standings[0].matches_played,
      wins: updated.payload.standings[0].wins,
      draws: updated.payload.standings[0].draws,
      losses: updated.payload.standings[0].losses,
    },
    { points: 17, matches_played: 3, wins: 2, draws: 1, losses: 0 },
  );

  const second = await post("/api/admin/standings/adjustments", context.adminCookie, {
    user_id: player.id,
    points: 10,
    matches_played: 2,
    wins: 1,
    draws: 1,
    losses: 0,
    reason: "Corrección del total acumulado",
  });
  assert.equal(second.response.status, 201, JSON.stringify(second.payload));
  assert.equal(second.payload.adjustment.points_delta, -7);
  assert.equal(second.payload.adjustment.matches_played_delta, -1);

  const history = await get("/api/admin/standings/adjustments", context.adminCookie);
  assert.equal(history.payload.adjustments.length, 2);
  assert.equal(history.payload.adjustments[0].reason, "Corrección del total acumulado");
  const finalStandings = await get("/api/standings", context.captainACookie);
  assert.equal(finalStandings.payload.standings[0].points, 10);

  const dbAfter = new Database(context.databasePath, { readonly: true });
  assert.equal(dbAfter.prepare("SELECT COUNT(*) AS count FROM match_points").get().count, matchPointCount);
  dbAfter.close();
});

test("no se crea una convocatoria automáticamente y Admin debe elegir la fecha", async () => {
  const db = new Database(context.databasePath, { readonly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(({ name }) => name));
    for (const table of [
      "users", "matches", "convocations", "transactions", "push_subscriptions",
      "push_campaigns", "app_settings", "match_finances", "match_points",
      "standing_adjustments", "balance_alert_campaigns",
    ]) {
      assert.ok(tables.has(table), `Falta la tabla requerida ${table}.`);
    }
    const convocationColumns = new Set(db.pragma("table_info(convocations)").map(({ name }) => name));
    assert.ok(convocationColumns.has("invited_by_user_id"));
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'matches'").get().sql;
    assert.match(schema, /'cancelled'/, "La migración debe ampliar los estados permitidos sin perder la tabla.");
    const oldMatch = db.prepare("SELECT status, match_date, match_time FROM matches WHERE id = 1").get();
    assert.deepEqual(oldMatch, { status: "played", match_date: "2026-10-20", match_time: "20:00" });
    const existingUser = db.prepare(`
      SELECT name, role, ranking_position, balance FROM users WHERE name = 'Jugador existente'
    `).get();
    assert.deepEqual(existingUser, {
      name: "Jugador existente",
      role: "principal",
      ranking_position: 99,
      balance: 7.5,
    });
    assert.equal(
      db.prepare("SELECT invited_by_user_id FROM convocations WHERE match_id = 1 AND user_id = 1").get().invited_by_user_id,
      null,
      "La migración debe añadir el invitador sin asignarlo a respuestas antiguas.",
    );
    assert.deepEqual(db.pragma("foreign_key_check"), [], "La migración debe conservar las relaciones de la base.");
  } finally {
    db.close();
  }

  const initial = await get("/api/convocations/current", context.adminCookie);
  assert.equal(initial.response.status, 200);
  assert.equal(initial.payload.match, null);

  const missingDate = await post("/api/admin/convocations/new", context.adminCookie, {});
  assert.equal(missingDate.response.status, 400);
  assert.match(missingDate.payload.error, /fecha de partido/);

  const matchDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const created = await post(
    "/api/admin/convocations/new",
    context.adminCookie,
    { match_date: matchDate, match_time: "19:30" },
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.match.match_date, matchDate);
  assert.equal(created.payload.match.match_time, "19:30");
  assert.equal(created.payload.match.end_date, `${matchDate}T19:30:00`);
  assert.match(created.payload.match.match_date_label, /^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo), \d{1,2} de [A-ZÁÉÍÓÚ][a-záéíóú]+$/);

  const substituteSeedDb = new Database(context.databasePath);
  let availableSubId;
  try {
    const hash = bcrypt.hashSync(password, 4);
    const addSubstitute = substituteSeedDb.prepare(`
      INSERT INTO users (name, first_name, last_name, alias, password_hash, account_status,
        role, base_role, ranking_position, balance)
      VALUES (?, ?, ?, ?, ?, 'active', 'suplente', 'suplente', ?, 0)
    `);
    availableSubId = Number(addSubstitute.run("Sub Libre", "Sub", "Libre", "sublibre", hash, 100).lastInsertRowid);
    const alreadyRespondedId = Number(addSubstitute.run("Sub Ya", "Sub", "Ya", "subya", hash, 101).lastInsertRowid);
    substituteSeedDb.prepare("INSERT INTO convocations (match_id, user_id, status) VALUES (?, ?, 'no_va')")
      .run(created.payload.match.id, alreadyRespondedId);
  } finally {
    substituteSeedDb.close();
  }
  const availableSubs = await get("/api/convocations/current/available-suplentes", context.captainACookie);
  assert.equal(availableSubs.response.status, 200);
  assert.deepEqual(availableSubs.payload.players.map(({ alias }) => alias), ["sublibre"]);
  const deniedAdminList = await get("/api/convocations/current/available-suplentes", context.adminCookie);
  assert.equal(deniedAdminList.response.status, 403);
  const deniedAdminAdd = await post("/api/convocations/current/add-existing-suplente", context.adminCookie, {
    user_id: availableSubId,
  });
  assert.equal(deniedAdminAdd.response.status, 403);

  const addedExisting = await post("/api/convocations/current/add-existing-suplente", context.captainACookie, {
    user_id: availableSubId,
  });
  assert.equal(addedExisting.response.status, 200, JSON.stringify(addedExisting.payload));
  const invitedExisting = addedExisting.payload.lists.suplentes.find(({ alias }) => alias === "sublibre");
  assert.equal(invitedExisting?.invited_by_alias, "draft1");
  const duplicateExisting = await post("/api/convocations/current/add-existing-suplente", context.captainBCookie, {
    user_id: availableSubId,
  });
  assert.equal(duplicateExisting.response.status, 409);
  const deniedPromotion = await post(`/api/admin/convocations/${availableSubId}/promote`, context.captainACookie, {});
  assert.equal(deniedPromotion.response.status, 403);
  const promotedByAdmin = await post(`/api/admin/convocations/${availableSubId}/promote`, context.adminCookie, {});
  assert.equal(promotedByAdmin.response.status, 200, JSON.stringify(promotedByAdmin.payload));
  assert.ok(promotedByAdmin.payload.lists.principal.some(({ alias }) => alias === "sublibre"));
  const availableAfterAdd = await get("/api/convocations/current/available-suplentes", context.captainACookie);
  assert.deepEqual(availableAfterAdd.payload.players, []);

  const addedNew = await post("/api/convocations/current/add-new-suplente", context.captainBCookie, {
    first_name: "Iñigo",
    last_name: "Nuevo",
    alias: "NuevoSub",
  });
  assert.equal(addedNew.response.status, 201, JSON.stringify(addedNew.payload));
  assert.equal(addedNew.payload.added_player.alias, "nuevosub");
  const invitedNew = addedNew.payload.lists.suplentes.find(({ alias }) => alias === "nuevosub");
  assert.equal(invitedNew?.invited_by_alias, "draft2");
  const adminConvocation = await get("/api/convocations/current", context.adminCookie);
  const adminInvitedNew = adminConvocation.payload.lists.suplentes.find(({ alias }) => alias === "nuevosub");
  assert.equal(adminInvitedNew?.invited_by_alias, "draft2");
  const duplicateAlias = await post("/api/convocations/current/add-new-suplente", context.captainACookie, {
    first_name: "Otro",
    last_name: "Jugador",
    alias: "DRAFT1",
  });
  assert.equal(duplicateAlias.response.status, 409);

  const newAccountDb = new Database(context.databasePath, { readonly: true });
  try {
    const newAccount = newAccountDb.prepare(`
      SELECT first_name, last_name, alias, password_hash, account_status, must_change_password,
        role, base_role, ranking_position, balance
      FROM users WHERE alias = 'nuevosub'
    `).get();
    assert.equal(newAccount.first_name, "Iñigo");
    assert.equal(newAccount.last_name, "Nuevo");
    assert.equal(newAccount.account_status, "active");
    assert.equal(newAccount.must_change_password, 1);
    assert.equal(newAccount.role, "suplente");
    assert.equal(newAccount.base_role, "suplente");
    assert.equal(newAccount.ranking_position, 102);
    assert.equal(newAccount.balance, 0);
    assert.equal(await bcrypt.compare("Pachanga123#", newAccount.password_hash), true);
  } finally {
    newAccountDb.close();
  }

  const current = await get("/api/convocations/current", context.adminCookie);
  assert.equal(current.payload.match.match_date, matchDate);
  assert.equal(current.payload.match.status, "open");

  const closed = await post("/api/admin/convocations/current/close", context.adminCookie, {});
  assert.equal(closed.response.status, 200, JSON.stringify(closed.payload));
  assert.equal(closed.payload.match.status, "closed");

  const reopened = await post("/api/admin/convocations/current/open", context.adminCookie, {});
  assert.equal(reopened.response.status, 200, JSON.stringify(reopened.payload));
  assert.equal(reopened.payload.match.status, "open");

  const closedAgain = await post("/api/admin/convocations/current/close", context.adminCookie, {});
  assert.equal(closedAgain.response.status, 200, JSON.stringify(closedAgain.payload));
  assert.equal(closedAgain.payload.match.status, "closed");

  const cancelled = await post("/api/admin/convocations/current/cancel", context.adminCookie, {});
  assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.payload));
  assert.equal(cancelled.payload.match.status, "cancelled");
  assert.equal(cancelled.payload.notification.status, "disabled");
  const historicalInvitations = await get(`/api/convocations/${cancelled.payload.match.id}`, context.adminCookie);
  const historicalNewSub = historicalInvitations.payload.lists.suplentes.find(({ alias }) => alias === "nuevosub");
  assert.equal(historicalNewSub?.invited_by_alias, "draft2");
  const addAfterClose = await post("/api/convocations/current/add-existing-suplente", context.captainACookie, {
    user_id: availableSubId,
  });
  assert.equal(addAfterClose.response.status, 409);

  const playerView = await get("/api/convocations/current", context.captainACookie);
  assert.equal(playerView.payload.match, null);
  assert.equal(playerView.payload.cancellation.status, "cancelled");
  assert.equal(playerView.payload.cancellation.match_date, matchDate);

  const forbiddenPrice = await post(
    `/api/admin/matches/${cancelled.payload.match.id}/price`,
    context.adminCookie,
    { price_total: 60 },
  );
  assert.equal(forbiddenPrice.response.status, 409);
  const forbiddenResult = await post(
    `/api/admin/matches/${cancelled.payload.match.id}/result`,
    context.adminCookie,
    { result: "A" },
  );
  assert.equal(forbiddenResult.response.status, 409);
  const dbAfterCancel = new Database(context.databasePath, { readonly: true });
  try {
    assert.equal(dbAfterCancel.prepare("SELECT COUNT(*) AS count FROM match_finances WHERE match_id = ?").get(cancelled.payload.match.id).count, 0);
    assert.equal(dbAfterCancel.prepare("SELECT COUNT(*) AS count FROM match_points WHERE match_id = ?").get(cancelled.payload.match.id).count, 0);
  } finally {
    dbAfterCancel.close();
  }

  const nextDate = new Date(Date.now() + 61 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const next = await post("/api/admin/convocations/new", context.adminCookie, {
    source_match_id: cancelled.payload.match.id,
    match_date: nextDate,
    match_time: "",
  });
  assert.equal(next.response.status, 201, JSON.stringify(next.payload));
  assert.equal(next.payload.match.match_time, "20:00", "La hora vacía debe conservar el valor predeterminado de 20:00.");

  const rosterDb = new Database(context.databasePath);
  try {
    const playerIds = rosterDb.prepare(`
      SELECT id FROM users WHERE role != 'admin' AND account_status = 'active'
      ORDER BY ranking_position LIMIT 14
    `).all().map(({ id }) => id);
    const addResponse = rosterDb.prepare(`
      INSERT INTO convocations (match_id, user_id, status) VALUES (?, ?, 'principal')
    `);
    rosterDb.transaction(() => playerIds.forEach((id) => addResponse.run(next.payload.match.id, id)))();
  } finally {
    rosterDb.close();
  }
  const cancellationAtMinimum = await post("/api/admin/convocations/current/cancel", context.adminCookie, {});
  assert.equal(cancellationAtMinimum.response.status, 409);
  assert.match(cancellationAtMinimum.payload.error, /al menos 14/);
});

test("el draft equilibra plantillas de 14 y 16 jugadores y valida los turnos", async (t) => {
  for (const rosterSize of [14, 16]) {
    await t.test(`${rosterSize} jugadores: B empieza, A elige dos al quedar tres y el último va a B`, async () => {
      const { matchId, playerIds } = createMatchWithRoster(rosterSize);
      const started = await startDraft(matchId, playerIds);
      assert.equal(started.response.status, 200, JSON.stringify(started.payload));
      assert.equal(started.payload.draft.currentTurn, "B", "El primer turno debe pertenecer al Capitán B.");

      const wrongCaptain = await post(
        `/api/matches/${matchId}/draft/pick`,
        context.captainACookie,
        { userId: started.payload.draft.remaining[0] },
      );
      assert.equal(wrongCaptain.response.status, 403, "El Capitán A no puede elegir cuando empieza B.");

      let draft = started.payload.draft;
      while (draft.remaining.length > 3) {
        const cookie = draft.currentTurn === "A" ? context.captainACookie : context.captainBCookie;
        const picked = await post(
          `/api/matches/${matchId}/draft/pick`,
          cookie,
          { userId: draft.remaining[0] },
        );
        assert.equal(picked.response.status, 200, JSON.stringify(picked.payload));
        draft = picked.payload.draft;
      }

      assert.equal(draft.remaining.length, 3);
      assert.equal(draft.currentTurn, "A", "Con tres jugadores restantes, el turno debe pasar a A.");
      for (let pickNumber = 0; pickNumber < 2; pickNumber += 1) {
        const picked = await post(
          `/api/matches/${matchId}/draft/pick`,
          context.captainACookie,
          { userId: draft.remaining[0] },
        );
        assert.equal(picked.response.status, 200, JSON.stringify(picked.payload));
        draft = picked.payload.draft;
        if (pickNumber === 0) assert.equal(draft.currentTurn, "A", "A debe conservar el turno para su segunda elección.");
      }

      assert.equal(draft.status, "complete");
      assert.equal(draft.currentTurn, null);
      assert.deepEqual(
        draft.picks.filter((pick) => !pick.automatic).slice(-2).map((pick) => pick.team),
        ["A", "A"],
      );
      const automaticPick = draft.picks.at(-1);
      assert.equal(automaticPick.automatic, true);
      assert.equal(automaticPick.team, "B");
      assert.equal(draft.remaining.length, 0);

      const db = new Database(context.databasePath, { readonly: true });
      try {
        const stored = db.prepare("SELECT team_a, team_b, draft_state FROM matches WHERE id = ?").get(matchId);
        const teamA = JSON.parse(stored.team_a);
        const teamB = JSON.parse(stored.team_b);
        assert.equal(teamA.length, rosterSize / 2);
        assert.equal(teamB.length, rosterSize / 2);
        assert.equal(teamB.at(-1), automaticPick.userId, "El último jugador debe quedar asignado a B.");
        assert.equal(new Set([...teamA, ...teamB]).size, rosterSize);
        assert.equal(JSON.parse(stored.draft_state).status, "complete");
      } finally {
        db.close();
      }
    });
  }

  await t.test("rechaza un draft con 15 jugadores", async () => {
    const { matchId, playerIds } = createMatchWithRoster(15);
    const result = await startDraft(matchId, playerIds);
    assert.equal(result.response.status, 409);
    assert.match(result.payload.error, /exactamente 14 o 16 jugadores/);
  });

  await t.test("rechaza una elección cuando el turno guardado es inválido", async () => {
    const { matchId, playerIds } = createMatchWithRoster(14);
    const started = await startDraft(matchId, playerIds);
    assert.equal(started.response.status, 200);
    const db = new Database(context.databasePath);
    try {
      const draft = started.payload.draft;
      draft.currentTurn = "X";
      db.prepare("UPDATE matches SET draft_state = ? WHERE id = ?")
        .run(JSON.stringify(draft), matchId);
    } finally {
      db.close();
    }

    const result = await post(
      `/api/matches/${matchId}/draft/pick`,
      context.captainBCookie,
      { userId: started.payload.draft.remaining[0] },
    );
    assert.equal(result.response.status, 409);
    assert.match(result.payload.error, /turno activo no respeta el orden/);
  });

  await t.test("rechaza un equipo que supera la mitad del roster", async () => {
    const { matchId, playerIds } = createMatchWithRoster(14);
    const started = await startDraft(matchId, playerIds);
    assert.equal(started.response.status, 200);
    const db = new Database(context.databasePath);
    try {
      db.prepare("UPDATE matches SET team_a = ? WHERE id = ?")
        .run(JSON.stringify(playerIds.slice(0, 8)), matchId);
    } finally {
      db.close();
    }

    const result = await post(
      `/api/matches/${matchId}/draft/pick`,
      context.captainBCookie,
      { userId: started.payload.draft.remaining[0] },
    );
    assert.equal(result.response.status, 409);
    assert.match(result.payload.error, /no puede superar la mitad/);
  });
});

test("los jugadores solo actualizan su foto y Admin puede editar todos los datos de perfil", async () => {
  const ownPath = `/api/users/${context.playerIds[1]}/profile`;
  const publicProfile = await get(ownPath, context.captainACookie);
  assert.equal(publicProfile.response.status, 200);
  assert.equal(publicProfile.payload.profile.alias, "draft2");
  assert.equal(publicProfile.payload.profile.strong_points, "");
  assert.equal("name" in publicProfile.payload.profile, false);

  const deniedEdit = await patch(ownPath, context.captainACookie, {
    alias: "draft2",
    strong_points: "Desborde y pase",
  });
  assert.equal(deniedEdit.response.status, 403);

  const deniedTextEdit = await patch(`/api/users/${context.playerIds[0]}/profile`, context.captainACookie, {
    alias: "draft1",
    preferred_position: "Extremo",
    strong_points: "Buen pase",
    photo_url: "data:image/webp;base64,UklGRnh4eHhXRUJQ",
  });
  assert.equal(deniedTextEdit.response.status, 403);

  const ownUpdate = await patch(`/api/users/${context.playerIds[0]}/profile`, context.captainACookie, {
    photo_url: "data:image/webp;base64,UklGRnh4eHhXRUJQ",
  });
  assert.equal(ownUpdate.response.status, 200, JSON.stringify(ownUpdate.payload));
  assert.equal(ownUpdate.payload.profile.photo_url, "data:image/webp;base64,UklGRnh4eHhXRUJQ");
  assert.equal(ownUpdate.payload.profile.alias, "draft1");
  assert.equal(ownUpdate.payload.profile.strong_points, "");
  assert.equal(ownUpdate.payload.profile.preferred_position, "");

  const adminUpdate = await patch(`/api/users/${context.playerIds[2]}/profile`, context.adminCookie, {
    alias: "draft3",
    preferred_position: "Portero",
    strong_points: "Buen juego aéreo",
    weak_points: "Salida con el pie",
    other_details: "Prefiere jugar de portero",
  });
  assert.equal(adminUpdate.response.status, 200, JSON.stringify(adminUpdate.payload));
  assert.equal(adminUpdate.payload.profile.preferred_position, "Portero");
  assert.equal(adminUpdate.payload.profile.strong_points, "Buen juego aéreo");
  assert.equal(adminUpdate.payload.profile.weak_points, "Salida con el pie");
  assert.equal(adminUpdate.payload.profile.other_details, "Prefiere jugar de portero");

  const invalidPhoto = await patch(`/api/users/${context.playerIds[0]}/profile`, context.captainACookie, {
    photo_url: "data:image/svg+xml;base64,PHN2Zz4=",
  });
  assert.equal(invalidPhoto.response.status, 400);
});
