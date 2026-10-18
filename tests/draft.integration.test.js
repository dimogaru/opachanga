const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { after, before, test } = require("node:test");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");

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
  const port = await findAvailablePort();
  context.baseUrl = `http://127.0.0.1:${port}`;
  context.process = spawn(process.execPath, ["server.js"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      DATA_DIR: context.dataDirectory,
      PORT: String(port),
      NODE_ENV: "test",
      REPL_ID: "",
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

test("no se crea una convocatoria automáticamente y Admin debe elegir la fecha", async () => {
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
    { match_date: matchDate },
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.match.match_date, matchDate);
  assert.match(created.payload.match.match_date_label, /^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo), \d{1,2} de [A-ZÁÉÍÓÚ][a-záéíóú]+$/);

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
