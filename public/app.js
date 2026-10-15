const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let users = [];
let currentUser = null;
let installPrompt = null;
let toastTimer;
let convocationData = null;
let pushConfig = { enabled: false, publicKey: null };
let selectedMatchId = null;
let matchData = { matches: [], pot: 0 };
let standingsData = { standings: [], pot: 0 };

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo completar la operación.");
  return payload;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("translate-y-3", "opacity-0");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("translate-y-3", "opacity-0"), 2800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function installButton(extraClasses = "") {
  return `<button id="install-app" class="hidden items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 ${extraClasses}">
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Instalar app
  </button>`;
}

function attachInstallButton() {
  const button = document.querySelector("#install-app");
  if (!button) return;
  if (installPrompt) button.classList.replace("hidden", "inline-flex");
  button.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    button.classList.replace("inline-flex", "hidden");
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function syncPushButton() {
  const button = document.querySelector("#push-toggle");
  if (!button) return;
  if (!pushConfig.enabled || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    button.disabled = true;
    button.textContent = "Avisos no configurados";
    button.title = "El servidor debe configurar Web Push y el navegador debe admitirlo.";
    button.classList.add("cursor-not-allowed", "opacity-60");
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    button.disabled = false;
    button.textContent = subscription ? "Avisos activados" : "Activar avisos";
    button.dataset.active = subscription ? "true" : "false";
  } catch {
    button.disabled = true;
    button.textContent = "Avisos no disponibles";
  }
}

async function togglePushSubscription() {
  const button = document.querySelector("#push-toggle");
  if (!button) return;
  button.disabled = true;
  try {
    const active = button.dataset.active === "true";
    if (!active && Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Necesitas permitir las notificaciones en el navegador.");
    }
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await api("/api/push/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: existing.endpoint }),
      });
      await existing.unsubscribe();
      showToast("Avisos desactivados en este dispositivo.");
    } else {
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushConfig.publicKey),
      });
      await api("/api/push/subscriptions", {
        method: "POST",
        body: JSON.stringify(subscription),
      });
      showToast("Avisos activados en este dispositivo.");
    }
  } catch (error) {
    showToast(error.message || "No se pudo cambiar la suscripción push.");
  } finally {
    await syncPushButton();
    button.disabled = false;
  }
}

function formatConvocationDate(match) {
  const start = new Date(`${match.start_date}T12:00:00Z`);
  const end = new Date(`${match.end_date.slice(0, 10)}T12:00:00Z`);
  const fmt = (date) => date.toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(start)} — ${fmt(end)}, 20:00`;
}

function listPanel(title, usersInList, colorClass, icon, isAdmin = false) {
  const list = usersInList || [];
  const rows = list.length
    ? list.map((user) => `<li class="flex items-center gap-3 px-4 py-3 ${isAdmin && title === "Lista de suplentes" ? "pr-2" : ""}">
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl ${colorClass} text-[11px] font-bold">${escapeHtml(user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase())}</span>
        <span class="min-w-0 flex-1 truncate text-sm font-semibold">${escapeHtml(user.name)}</span>
        <span class="hidden text-[11px] text-ink/40 sm:inline">${user.base_role === "principal" ? "Principal" : "Suplente"}${user.base_role === "suplente" && user.response === "principal" ? " · promovido" : ""}</span>
        ${isAdmin && title === "Lista de suplentes" ? `<button class="promote-player shrink-0 rounded-lg border border-pitch-700/20 px-2.5 py-1.5 text-[11px] font-bold text-pitch-800 transition hover:bg-pitch-100" data-user-id="${user.id}" aria-label="Promover a ${escapeHtml(user.name)} a principal">↑ Principal</button>` : ""}
      </li>`).join("")
    : `<li class="px-4 py-7 text-center text-sm text-ink/40">La lista está vacía.</li>`;
  return `<section class="overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm">
    <header class="flex items-center justify-between gap-3 border-b border-ink/[.07] px-4 py-3.5">
      <h3 class="flex items-center gap-2 text-sm font-bold"><span class="grid h-7 w-7 place-items-center rounded-lg ${colorClass}">${icon}</span>${title}</h3>
      <span class="rounded-full bg-paper px-2.5 py-1 text-xs font-bold text-ink/60">${list.length}</span>
    </header>
    <ul class="divide-y divide-ink/[.05]">${rows}</ul>
  </section>`;
}

function renderConvocationBoard(data, isAdmin = false) {
  const open = data.match.status === "open";
  const readinessText = data.validForMatch
    ? "Plantilla válida para jugar"
    : data.principalCount < 14
      ? `Faltan ${14 - data.principalCount} para llegar a 14`
      : "Hay más de 16 principales";
  return `
    <section class="mb-7 overflow-hidden rounded-3xl bg-pitch-900 text-white shadow-card">
      <div class="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
        <div class="max-w-xl">
          <div class="flex flex-wrap items-center gap-2"><span class="rounded-full ${open ? "bg-lime/15 text-lime" : "bg-white/15 text-white/70"} px-3 py-1.5 text-[10px] font-bold tracking-[.12em]">${open ? "CONVOCATORIA ABIERTA" : "CONVOCATORIA CERRADA"}</span><span class="text-xs text-white/50">Martes ${formatConvocationDate(data.match)}</span></div>
          <h2 class="display mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">¿Cuentas con nosotros?</h2>
          <p class="mt-1 text-sm text-white/60">Responde antes del lunes a las 20:00. El admin también participa como jugador.</p>
          <div class="mt-4 flex items-center gap-2 text-sm font-semibold ${data.validForMatch ? "text-lime" : "text-white/80"}"><span class="grid h-6 w-6 place-items-center rounded-full ${data.validForMatch ? "bg-lime/15 text-lime" : "bg-white/10"}">${data.validForMatch ? "✓" : "!"}</span>${readinessText}</div>
        </div>
        <div class="flex min-w-[210px] flex-col gap-3 rounded-2xl border border-white/10 bg-white/[.06] p-4">
          <div class="flex items-end justify-between"><span class="text-xs font-semibold text-white/60">Lista principal</span><span class="display text-3xl font-extrabold ${data.validForMatch ? "text-lime" : "text-white"}">${data.principalCount}<span class="text-base font-semibold text-white/40"> / 14–16</span></span></div>
          <div class="h-2 overflow-hidden rounded-full bg-white/10"><div class="h-full rounded-full ${data.validForMatch ? "bg-lime" : "bg-white/70"} transition-all" style="width:${Math.min(100, Math.round((data.principalCount / 16) * 100))}%"></div></div>
          <span class="text-[11px] text-white/45">${data.responseCount} respuestas · ${data.totalPlayers - data.responseCount} sin responder</span>
        </div>
      </div>
      <div class="flex flex-col gap-3 border-t border-white/10 bg-white/[.03] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <span class="text-xs font-semibold text-white/60">${data.currentResponse ? `Tu respuesta: ${data.currentResponse === "no_va" ? "NO VOY" : "SÍ VOY"}` : "Todavía no has respondido"}</span>
        <div class="flex gap-2">
          <button id="response-yes" ${!open ? "disabled" : ""} class="flex-1 rounded-xl ${data.currentResponse === "principal" || data.currentResponse === "suplente" ? "bg-lime text-pitch-950" : "bg-white text-pitch-950"} px-4 py-2.5 text-xs font-extrabold tracking-wide transition hover:bg-lime disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">SÍ VOY</button>
          <button id="response-no" ${!open ? "disabled" : ""} class="flex-1 rounded-xl ${data.currentResponse === "no_va" ? "bg-red-300 text-pitch-950" : "border border-white/20 bg-white/5 text-white"} px-4 py-2.5 text-xs font-extrabold tracking-wide transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">NO VOY</button>
        </div>
      </div>
    </section>
    <div class="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 class="display text-xl font-extrabold tracking-tight">Respuestas del grupo</h2><p class="mt-1 text-xs text-ink/50">La lista se actualiza para todo el equipo.</p></div>${isAdmin ? `<div class="flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold"><label>Mi rol<select id="admin-base-role" class="ml-2 rounded-lg border-0 bg-transparent text-xs font-bold text-pitch-800 outline-none"><option value="principal" ${currentUser.base_role === "principal" ? "selected" : ""}>Principal</option><option value="suplente" ${currentUser.base_role === "suplente" ? "selected" : ""}>Suplente</option></select></label><label>Ranking #<input id="admin-profile-rank" type="number" min="1" step="1" value="${currentUser.ranking_position ?? ""}" class="ml-1 w-14 rounded-md border border-ink/10 px-1.5 py-1 text-xs font-bold outline-none focus:border-pitch-700" aria-label="Tu posición de ranking"/></label><button id="save-admin-profile" class="rounded-lg bg-pitch-900 px-2.5 py-1.5 text-xs font-bold text-white">Guardar</button></div>` : ""}</div>
    ${isAdmin ? `<div class="mb-4 grid gap-3 rounded-2xl border border-pitch-900/10 bg-white p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><p class="text-sm font-bold">Avisos de esta convocatoria</p><p id="push-status-copy" class="mt-1 text-xs text-ink/50">${pushConfig.enabled ? "Apertura automática el martes · recordatorio el viernes a las 10:00." : "Configura las claves VAPID del servidor para activar los avisos push."}</p></div><button id="send-opening" class="rounded-xl border border-ink/10 px-3 py-2 text-xs font-bold transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40">Enviar apertura</button><button id="send-reminder" class="rounded-xl bg-pitch-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-pitch-800 disabled:cursor-not-allowed disabled:opacity-40">Enviar recordatorio</button></div>` : ""}
    <div class="grid gap-4 lg:grid-cols-3">
      ${listPanel("Lista principal", data.lists.principal, "bg-pitch-100 text-pitch-800", "✓", isAdmin)}
      ${listPanel("Lista de suplentes", data.lists.suplentes, "bg-amber-50 text-amber-700", "↗", isAdmin)}
      ${listPanel("Lista NO VAN", data.lists.no_va, "bg-stone-100 text-stone-500", "—", isAdmin)}
    </div>
    <details class="mt-4 rounded-2xl border border-ink/[.07] bg-white px-4 py-3">
      <summary class="cursor-pointer list-none text-sm font-semibold">Sin responder <span class="ml-1 rounded-full bg-paper px-2 py-0.5 text-xs text-ink/55">${data.lists.pending.length}</span></summary>
      <p class="mt-2 text-xs text-ink/50">${data.lists.pending.length ? data.lists.pending.map((user) => escapeHtml(user.name)).join(" · ") : "Todo el grupo ha respondido."}</p>
    </details>`;
}

function matchLabel(match) {
  const date = new Date(`${match.start_date}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 7);
  return `Partido del ${date.toLocaleDateString("es-ES", { day: "numeric", month: "long", timeZone: "UTC" })}`;
}

function renderTeamCard(title, players, tone) {
  const rows = players.length
    ? players.map((player) => `<li class="flex items-center gap-2.5 border-t border-ink/[.06] px-4 py-3 first:border-0"><span class="grid h-7 w-7 place-items-center rounded-lg bg-white/80 text-[10px] font-bold text-ink/55">${player.ranking_position ? `#${player.ranking_position}` : "⚽"}</span><span class="text-sm font-semibold">${escapeHtml(player.name)}</span></li>`).join("")
    : `<li class="px-4 py-6 text-sm text-ink/45">Sin jugadores todavía.</li>`;
  return `<section class="overflow-hidden rounded-2xl border border-ink/[.07] ${tone}"><header class="flex items-center justify-between px-4 py-3"><h3 class="font-bold">${title}</h3><span class="rounded-full bg-white/75 px-2.5 py-1 text-xs font-bold">${players.length}</span></header><ul class="bg-white/70">${rows}</ul></section>`;
}

function renderMatchPanel(matchesData, isAdmin = false) {
  const matches = matchesData.matches || [];
  if (!matches.length) return "";
  let selected = matches.find((match) => match.id === Number(selectedMatchId));
  if (!selected) {
    selected = matches.find((match) => match.status === "closed") ||
      matches.find((match) => match.status === "played") || matches[0];
    selectedMatchId = selected.id;
  }
  const draft = selected.draft || {};
  const completed = draft.status === "complete";
  const available = selected.available || [];
  const turnName = draft.currentTurn === "A"
    ? users.find((player) => player.id === draft.captainA)?.name || "Jugador #1"
    : users.find((player) => player.id === draft.captainB)?.name || "Jugador #2";
  const selection = `<label class="block"><span class="mb-1.5 block text-xs font-semibold text-ink/55">Seleccionar partido</span><select id="match-picker" class="w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-pitch-700">${matches.map((match) => `<option value="${match.id}" ${match.id === selected.id ? "selected" : ""}>${escapeHtml(matchLabel(match))} · ${match.status === "played" ? "jugado" : match.status === "closed" ? "convocatoria cerrada" : "convocatoria abierta"}</option>`).join("")}</select></label>`;
  let adminControls = "";
  if (isAdmin && selected.status === "closed" && !draft.status) {
    const count = selected.principalCount ?? convocationData?.principalCount ?? 0;
    adminControls = count >= 14 && count <= 16
      ? `<div class="mt-4 rounded-xl bg-paper p-4"><p class="text-sm font-bold">Convocatoria cerrada · ${count} principales</p><p class="mt-1 text-xs text-ink/50">El jugador #2 elige primero. Luego se alterna hasta dejar tres; el #1 elige dos y recibe automáticamente al último.</p><button id="start-draft" data-match-id="${selected.id}" class="mt-3 rounded-xl bg-pitch-900 px-4 py-2.5 text-sm font-bold text-white">Iniciar draft</button></div>`
      : `<p class="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">No se puede iniciar el draft: hacen falta entre 14 y 16 confirmados principales; hay ${count}.</p>`;
  } else if (isAdmin && draft.status === "in_progress") {
    adminControls = `<div class="mt-4 rounded-xl bg-paper p-4"><p class="text-sm font-bold">Turno de ${escapeHtml(turnName)} · Equipo ${draft.currentTurn}</p><p class="mt-1 text-xs text-ink/50">${available.length} jugadores disponibles</p><div class="mt-3 flex flex-col gap-2 sm:flex-row"><select id="draft-player" class="min-w-0 flex-1 rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm">${available.map((player) => `<option value="${player.id}">${escapeHtml(player.name)}${player.ranking_position ? ` · #${player.ranking_position}` : ""}</option>`).join("")}</select><button id="draft-pick" data-match-id="${selected.id}" ${available.length ? "" : "disabled"} class="rounded-xl bg-pitch-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">Elegir jugador</button></div></div>`;
  } else if (selected.status === "open") {
    adminControls = `<p class="mt-4 rounded-xl bg-paper p-4 text-sm text-ink/55">El draft estará disponible al cerrar la convocatoria el lunes a las 20:00.</p>`;
  } else if (draft.status === "complete") {
    adminControls = `<p class="mt-4 rounded-xl bg-pitch-100 p-4 text-sm font-bold text-pitch-900">Draft completo. Composición de equipos guardada.</p>`;
  }
  const scoreText = selected.result === "draw" ? "Empate" : selected.result ? `Victoria del Equipo ${selected.result}` : "";
  const finance = selected.finance;
  const financeControl = isAdmin && completed && !finance && selected.status !== "played"
    ? `<form id="match-finance-form" data-match-id="${selected.id}" class="mt-4 grid gap-3 rounded-xl border border-ink/[.07] bg-white p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label><span class="mb-1.5 block text-xs font-semibold text-ink/55">Coste pista (€)</span><input name="pitch_cost" type="number" min="0" step="0.01" required class="w-full rounded-xl border border-ink/10 px-3 py-2.5 text-sm"/></label><label><span class="mb-1.5 block text-xs font-semibold text-ink/55">Cobro por jugador (€)</span><input name="fee_per_player" type="number" min="0" step="0.01" required class="w-full rounded-xl border border-ink/10 px-3 py-2.5 text-sm"/></label><button class="rounded-xl bg-pitch-900 px-4 py-2.5 text-sm font-bold text-white">Registrar cobro</button><p class="text-xs text-ink/45 sm:col-span-3">Cada participante paga el importe indicado; la diferencia total tras cubrir la pista se suma al bote.</p></form>`
    : finance ? `<div class="mt-4 grid gap-2 rounded-xl bg-white p-4 text-xs text-ink/60 sm:grid-cols-3"><span>Pista: <b class="text-ink">${formatMoney(finance.pitch_cost)}</b></span><span>Cobrado: <b class="text-ink">${formatMoney(finance.total_collected)}</b></span><span>Al bote: <b class="text-pitch-800">${formatMoney(finance.pot_added)}</b></span></div>` : "";
  const resultControl = isAdmin && completed && selected.status !== "played"
    ? `<form id="match-result-form" data-match-id="${selected.id}" class="mt-4 flex flex-col gap-2 rounded-xl bg-white p-4 sm:flex-row sm:items-end"><label class="flex-1"><span class="mb-1.5 block text-xs font-semibold text-ink/55">Resultado final</span><select name="result" required class="w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm"><option value="A">Gana Equipo A</option><option value="B">Gana Equipo B</option><option value="draw">Empate</option></select></label><button class="rounded-xl bg-lime px-4 py-2.5 text-sm font-extrabold text-pitch-950">Guardar resultado y puntos</button></form>`
    : selected.status === "played" ? `<p class="mt-4 rounded-xl bg-lime/20 p-4 text-sm font-bold text-pitch-900">Resultado: ${scoreText}. Puntuación guardada: asistencia +1, victoria +3 extra, empate +1 extra.</p>` : "";
  const alertControl = isAdmin && pushConfig.enabled && selected.status !== "open"
    ? `<button id="negative-balance-alert" data-match-id="${selected.id}" class="mt-3 rounded-xl border border-amber-700/20 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50">Enviar alerta de saldo negativo</button>` : "";
  return `<section class="mb-7 rounded-3xl border border-ink/[.07] bg-white p-5 shadow-sm sm:p-6"><div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p class="text-xs font-bold uppercase tracking-[.12em] text-pitch-700">Partidos</p><h2 class="display mt-1 text-2xl font-extrabold">${escapeHtml(matchLabel(selected))}</h2><p class="mt-1 text-xs text-ink/50">${selected.status === "played" ? "Partido jugado" : selected.status === "closed" ? "Convocatoria cerrada" : "Convocatoria abierta"}</p></div><div class="w-full sm:max-w-xs">${selection}</div></div><div class="grid gap-3 sm:grid-cols-2">${renderTeamCard("Equipo A", selected.teamA || [], "bg-pitch-100 text-pitch-900")}${renderTeamCard("Equipo B", selected.teamB || [], "bg-amber-50 text-amber-900")}</div>${adminControls}${financeControl}${resultControl}${alertControl}</section>`;
}

function renderStandingsBoard(data) {
  const rows = data.standings || [];
  return `<section class="mb-7 overflow-hidden rounded-3xl border border-ink/[.07] bg-white shadow-sm"><div class="flex flex-col gap-3 border-b border-ink/[.07] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><p class="text-xs font-bold uppercase tracking-[.12em] text-pitch-700">Temporada</p><h2 class="display mt-1 text-2xl font-extrabold">Clasificación</h2><p class="mt-1 text-xs text-ink/50">Puntos globales por asistencia y resultado.</p></div><div class="rounded-2xl bg-lime/35 px-4 py-3"><p class="text-[10px] font-bold uppercase tracking-[.12em] text-pitch-900/60">Bote acumulado</p><p class="display text-xl font-extrabold text-pitch-900">${formatMoney(data.pot)}</p></div></div><div class="overflow-x-auto"><table class="w-full min-w-[560px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-5 py-3">#</th><th class="px-4 py-3">Jugador</th><th class="px-4 py-3">Puntos</th><th class="px-4 py-3">PJ</th><th class="px-4 py-3">V-E-D</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${rows.length ? rows.map((player, index) => `<tr><td class="px-5 py-3 text-sm font-bold text-pitch-700">${index + 1}</td><td class="px-4 py-3 text-sm font-semibold">${escapeHtml(player.name)}</td><td class="px-4 py-3"><span class="rounded-full bg-pitch-100 px-2.5 py-1 text-xs font-extrabold text-pitch-900">${player.points}</span></td><td class="px-4 py-3 text-sm text-ink/55">${player.matches_played}</td><td class="px-4 py-3 text-sm text-ink/55">${player.wins}-${player.draws}-${player.losses}</td></tr>`).join("") : `<tr><td colspan="5" class="px-5 py-8 text-center text-sm text-ink/45">La clasificación empieza con el primer resultado.</td></tr>`}</tbody></table></div></section>`;
}

function shell(content, active = "Inicio") {
  const initials = currentUser?.name?.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "OP";
  app.innerHTML = `
    <div class="min-h-screen">
      <header class="bg-pitch-900 text-white">
        <div class="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a href="#" class="flex items-center gap-3" aria-label="O Pachanga, inicio">
            <span class="grid h-10 w-10 place-items-center rounded-2xl bg-lime text-pitch-950">
              <svg aria-hidden="true" width="27" height="27" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="1.5"/><path d="m16 10 4 3-1.5 5h-5L12 13l4-3Zm0 0-2-5m6 8 5-1m-6 6 3 5m-8-7-4 4m3-7-5-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span><span class="display block text-lg font-extrabold leading-tight tracking-tight">O Pachanga</span><span class="block text-[11px] font-medium tracking-[.12em] text-white/55">FÚTBOL ENTRE AMIGOS</span></span>
          </a>
          <div class="flex items-center gap-2 sm:gap-4">
            ${installButton()}
            <button id="push-toggle" disabled class="rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4" title="Activa avisos de convocatoria en este dispositivo">Activar avisos</button>
            <div class="hidden items-center gap-2 sm:flex"><span class="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-xs font-bold">${escapeHtml(initials)}</span><span class="max-w-32 truncate text-sm font-medium">${escapeHtml(currentUser?.name || "")}</span></div>
            <button id="logout" class="rounded-lg px-2 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="Cerrar sesión">Salir</button>
          </div>
        </div>
      </header>
      <main class="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">${content}</main>
      <footer class="mx-auto max-w-7xl px-5 pb-8 text-xs text-ink/40 sm:px-8">O Pachanga <span class="mx-1">·</span> Una buena pachanga empieza aquí.</footer>
    </div>`;
  attachInstallButton();
  document.querySelector("#logout")?.addEventListener("click", logout);
  document.querySelector("#push-toggle")?.addEventListener("click", togglePushSubscription);
  syncPushButton();
}

function renderLogin() {
  const admin = users.filter((user) => user.role === "admin");
  const players = users.filter((user) => user.role !== "admin");
  app.innerHTML = `
    <main class="grid min-h-screen lg:grid-cols-[1fr_1fr]">
      <section class="pitch-grid relative flex min-h-[340px] flex-col justify-between overflow-hidden bg-pitch-900 px-7 py-7 text-white sm:px-12 sm:py-10 lg:min-h-screen lg:px-16">
        <div class="absolute -right-20 top-20 h-80 w-80 rounded-full border border-white/10"></div><div class="absolute -right-8 top-32 h-56 w-56 rounded-full border border-white/10"></div><div class="field-mark absolute right-20 top-1/2 h-28 w-28 -translate-y-1/2"></div>
        <a href="#" class="relative flex items-center gap-3">
          <span class="grid h-11 w-11 place-items-center rounded-2xl bg-lime text-pitch-950"><svg aria-hidden="true" width="27" height="27" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="1.5"/><path d="m16 10 4 3-1.5 5h-5L12 13l4-3Zm0 0-2-5m6 8 5-1m-6 6 3 5m-8-7-4 4m3-7-5-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          <span><span class="display block text-xl font-extrabold tracking-tight">O Pachanga</span><span class="text-[10px] font-semibold tracking-[.16em] text-white/55">FÚTBOL ENTRE AMIGOS</span></span>
        </a>
        <div class="relative max-w-xl py-12 lg:py-0">
          <span class="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-lime"><span class="h-1.5 w-1.5 rounded-full bg-lime"></span> TEMPORADA ABIERTA</span>
          <h1 class="display max-w-lg text-4xl font-extrabold leading-[1.08] tracking-[-.04em] sm:text-6xl">Los martes<br/>son de <span class="text-lime">partido.</span></h1>
          <p class="mt-5 max-w-md text-base leading-7 text-white/65">La pachanga semanal, organizada como se merece. Elige tu usuario y salta al campo.</p>
        </div>
        <div class="relative flex items-center gap-2 text-xs font-medium text-white/45"><span class="inline-flex gap-1"><i class="h-1 w-1 rounded-full bg-lime"></i><i class="h-1 w-1 rounded-full bg-lime/60"></i><i class="h-1 w-1 rounded-full bg-lime/30"></i></span>PARTIDO · EQUIPO · AMIGOS</div>
      </section>
      <section class="flex items-center justify-center px-5 py-12 sm:px-10 lg:px-16">
        <div class="w-full max-w-md">
          <div class="mb-8 flex items-center justify-between gap-3"><div><p class="text-xs font-bold uppercase tracking-[.15em] text-pitch-700">Bienvenido al vestuario</p><h2 class="display mt-2 text-3xl font-extrabold tracking-tight">¿Quién juega hoy?</h2></div>${installButton("shrink-0 border-pitch-900/10 !bg-pitch-900 !text-white")}</div>
          <div class="space-y-6">
            <div><div class="mb-3 flex items-center justify-between"><h3 class="text-sm font-bold">Jugadores</h3><span class="text-xs text-ink/45">${players.length} ${players.length === 1 ? "jugador" : "jugadores"}</span></div>
              ${players.length ? `<div class="grid gap-2.5">${players.map((user) => `<button class="login-user group flex w-full items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-pitch-700/30 hover:shadow-card" data-user-id="${user.id}">
                <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl ${user.role === "principal" ? "bg-pitch-100 text-pitch-800" : "bg-amber-50 text-amber-700"} text-xs font-bold">${escapeHtml(user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase())}</span>
                <span class="min-w-0 flex-1"><span class="block truncate font-semibold">${escapeHtml(user.name)}</span><span class="mt-0.5 block text-xs text-ink/45">${user.role === "principal" ? `Principal${user.ranking_position ? ` · #${user.ranking_position}` : ""}` : "Suplente"}</span></span>
                <svg class="text-ink/30 transition group-hover:translate-x-1 group-hover:text-pitch-700" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>`).join("")}</div>` : `<div class="rounded-2xl border border-dashed border-ink/15 bg-white/60 px-5 py-6 text-sm text-ink/55">Todavía no hay jugadores. Entra como admin para crear el equipo.</div>`}</div>
            <div><div class="mb-3 flex items-center gap-3"><span class="h-px flex-1 bg-ink/10"></span><span class="text-[10px] font-bold uppercase tracking-[.16em] text-ink/35">Administración</span><span class="h-px flex-1 bg-ink/10"></span></div>
              ${admin.map((user) => `<button class="login-user flex w-full items-center gap-3 rounded-2xl border border-pitch-900/10 bg-pitch-900/[.035] px-4 py-3 text-left transition hover:bg-pitch-900/[.08]" data-user-id="${user.id}"><span class="grid h-9 w-9 place-items-center rounded-xl bg-pitch-900 text-lime"><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" stroke-width="1.7"/><path d="m19.4 15 .1.1 1.1.9-1.4 2.4-1.3-.5a2 2 0 0 0-1.4.1l-.2.1a2 2 0 0 0-1 1.1l-.4 1.3h-2.8l-.4-1.3a2 2 0 0 0-1-1.1l-.2-.1a2 2 0 0 0-1.4-.1l-1.3.5-1.4-2.4 1.1-.9a2 2 0 0 0 .7-1.3v-.3a2 2 0 0 0-.7-1.3l-1.1-.9 1.4-2.4 1.3.5a2 2 0 0 0 1.4-.1l.2-.1a2 2 0 0 0 1-1.1l.4-1.3h2.8l.4 1.3a2 2 0 0 0 1 1.1l.2.1a2 2 0 0 0 1.4.1l1.3-.5 1.4 2.4-1.1.9a2 2 0 0 0-.7 1.3v.3a2 2 0 0 0 .7 1.3Z" stroke="currentColor" stroke-width="1.1"/></svg></span><span class="flex-1"><span class="block text-sm font-semibold">${escapeHtml(user.name)}</span><span class="text-xs text-ink/45">Panel de administración</span></span><span class="text-sm text-pitch-700">→</span></button>`).join("")}
            </div>
          </div>
          <p class="mt-7 text-center text-xs leading-5 text-ink/40">Esta versión identifica al usuario por selección. Para un despliegue público, activa autenticación real antes de exponer el acceso de administración.</p>
        </div>
      </section>
    </main>`;
  attachInstallButton();
  document.querySelectorAll(".login-user").forEach((button) =>
    button.addEventListener("click", () => login(Number(button.dataset.userId))),
  );
}

async function renderAdmin() {
  await loadUsers();
  convocationData = await api("/api/convocations/current");
  matchData = await api("/api/matches");
  standingsData = await api("/api/standings");
  pushConfig = await api("/api/push/config").catch(() => ({ enabled: false, publicKey: null }));
  currentUser = { ...currentUser, ...users.find((user) => user.id === currentUser.id) };
  const players = users.filter((user) => user.role !== "admin");
  const adminContent = `
    <div class="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div><div class="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-pitch-700"><span class="h-2 w-2 rounded-full bg-pitch-700"></span>ADMINISTRACIÓN <span class="text-ink/25">/</span> EQUIPO</div><h1 class="display text-3xl font-extrabold tracking-tight sm:text-4xl">Gestiona la pachanga</h1><p class="mt-2 text-sm text-ink/55">La convocatoria, el equipo y la organización semanal.</p></div>
      <button id="new-player" class="inline-flex items-center justify-center gap-2 rounded-xl bg-pitch-900 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-pitch-800"><span class="text-lg leading-none">+</span> Añadir jugador</button>
    </div>
    ${renderConvocationBoard(convocationData, true)}
    ${renderMatchPanel(matchData, true)}
    ${renderStandingsBoard(standingsData)}
    <div class="mb-6 grid gap-3 sm:grid-cols-3">
      <div class="rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm"><p class="text-xs font-semibold text-ink/45">PLANTILLA TOTAL</p><div class="mt-2 flex items-end justify-between"><span class="display text-3xl font-extrabold">${players.length + 1}</span><span class="pb-1 text-xs text-ink/40">incluye admin</span></div></div>
      <div class="rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm"><p class="text-xs font-semibold text-ink/45">PRINCIPALES</p><div class="mt-2 flex items-end justify-between"><span class="display text-3xl font-extrabold">${players.filter((user) => user.base_role === "principal").length + (currentUser.base_role === "principal" ? 1 : 0)}</span><span class="mb-1 h-2 w-2 rounded-full bg-pitch-700"></span></div></div>
      <div class="rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm"><p class="text-xs font-semibold text-ink/45">SUPLENTES</p><div class="mt-2 flex items-end justify-between"><span class="display text-3xl font-extrabold">${players.filter((user) => user.base_role === "suplente").length + (currentUser.base_role === "suplente" ? 1 : 0)}</span><span class="mb-1 h-2 w-2 rounded-full bg-amber-400"></span></div></div>
    </div>
    <section class="overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm">
      <div class="flex items-center justify-between border-b border-ink/[.07] px-5 py-4 sm:px-6"><div><h2 class="font-bold">Jugadores</h2><p class="mt-0.5 text-xs text-ink/45">Posición de ranking y saldo actual</p></div><span class="rounded-full bg-pitch-100 px-3 py-1 text-xs font-bold text-pitch-800">${players.length} activos</span></div>
      ${players.length ? `<div class="overflow-x-auto"><table class="w-full min-w-[650px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-5 py-3 sm:px-6">Jugador</th><th class="px-4 py-3">Rol base</th><th class="px-4 py-3">Ranking</th><th class="px-4 py-3">Saldo</th><th class="px-5 py-3 text-right sm:px-6">Acción</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${players.map((user) => `<tr class="hover:bg-paper/50"><td class="px-5 py-4 sm:px-6"><div class="flex items-center gap-3"><span class="grid h-9 w-9 place-items-center rounded-xl ${user.base_role === "principal" ? "bg-pitch-100 text-pitch-800" : "bg-amber-50 text-amber-700"} text-xs font-bold">${escapeHtml(user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase())}</span><span class="font-semibold">${escapeHtml(user.name)}</span></div></td><td class="px-4 py-4"><span class="rounded-full ${user.base_role === "principal" ? "bg-pitch-100 text-pitch-800" : "bg-amber-50 text-amber-700"} px-2.5 py-1 text-xs font-semibold">${user.base_role === "principal" ? "Principal" : "Suplente"}</span></td><td class="px-4 py-4 text-sm text-ink/65">${user.ranking_position ? `#${user.ranking_position}` : "—"}</td><td class="px-4 py-4 text-sm font-semibold">${formatMoney(user.balance)}</td><td class="px-5 py-4 text-right sm:px-6"><button class="edit-player rounded-lg border border-ink/10 px-3 py-1.5 text-xs font-bold transition hover:border-pitch-700 hover:text-pitch-700" data-id="${user.id}">Editar</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="px-6 py-14 text-center"><div class="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-pitch-100 text-pitch-800 text-xl">＋</div><p class="mt-4 font-bold">Aún no hay jugadores</p><p class="mt-1 text-sm text-ink/50">Añade a los amigos que forman el equipo.</p></div>`}
    </section>`;
  shell(adminContent, "Equipo");
  document.querySelector("#new-player")?.addEventListener("click", () => openPlayerModal());
  document.querySelectorAll(".edit-player").forEach((button) => {
    const player = players.find((user) => user.id === Number(button.dataset.id));
    button.addEventListener("click", () => openPlayerModal(player));
  });
  bindConvocationActions(true);
  document.querySelector("#save-admin-profile")?.addEventListener("click", async () => {
    try {
      const result = await api("/api/admin/profile", {
        method: "PATCH",
        body: JSON.stringify({
          base_role: document.querySelector("#admin-base-role").value,
          ranking_position: document.querySelector("#admin-profile-rank").value || null,
        }),
      });
      currentUser = result.user;
      showToast("Perfil y posición de ranking actualizados.");
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
    }
  });
  for (const [id, type] of [["send-opening", "opening"], ["send-reminder", "friday_reminder"]]) {
    const button = document.querySelector(`#${id}`);
    button.disabled = !pushConfig.enabled || convocationData.match.status !== "open";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = await api(`/api/admin/notifications/${type}`, { method: "POST", body: "{}" });
        const message = result.alreadySent
          ? "Este aviso ya se había enviado."
          : result.inProgress
            ? "El envío de este aviso está en curso."
            : `${result.delivered} notificación(es) enviadas.`;
        showToast(message);
        await renderAdmin();
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    });
  }
  if (pushConfig.enabled) {
    api("/api/admin/notifications/status").then((status) => {
      const opening = status.campaigns.opening;
      const reminder = status.campaigns.friday_reminder;
      const notes = [];
      if (opening?.status === "sent") notes.push(`Apertura: ${opening.delivered_count} enviada(s)`);
      if (reminder?.status === "sent") notes.push(`Recordatorio: ${reminder.delivered_count} enviada(s)`);
      if (opening?.status === "sent" || opening?.status === "sending") document.querySelector("#send-opening").disabled = true;
      if (reminder?.status === "sent" || reminder?.status === "sending") document.querySelector("#send-reminder").disabled = true;
      if (notes.length) document.querySelector("#push-status-copy").textContent = notes.join(" · ");
    }).catch(() => {});
  }
  bindMatchActions(true);
}

function bindConvocationActions(isAdmin = false) {
  for (const [id, response] of [["response-yes", "yes"], ["response-no", "no"]]) {
    document.querySelector(`#${id}`)?.addEventListener("click", async () => {
      try {
        convocationData = await api("/api/convocations/me", {
          method: "POST",
          body: JSON.stringify({ response }),
        });
        showToast(response === "yes" ? "Respuesta guardada. ¡Nos vemos en el campo!" : "Respuesta guardada.");
        await renderHome();
      } catch (error) {
        showToast(error.message);
      }
    });
  }
  if (isAdmin) {
    document.querySelectorAll(".promote-player").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          convocationData = await api(`/api/admin/convocations/${button.dataset.userId}/promote`, {
            method: "POST",
            body: "{}",
          });
          showToast("Jugador promovido a la lista principal.");
          await renderAdmin();
        } catch (error) {
          showToast(error.message);
          button.disabled = false;
        }
      });
    });
  }
}

function bindMatchActions(isAdmin = false) {
  document.querySelector("#match-picker")?.addEventListener("change", async (event) => {
    selectedMatchId = Number(event.target.value);
    await renderHome();
  });
  if (!isAdmin) return;
  document.querySelector("#start-draft")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const match = await api(`/api/admin/matches/${button.dataset.matchId}/draft/start`, {
        method: "POST",
        body: "{}",
      });
      selectedMatchId = match.id;
      showToast("Draft iniciado. El jugador #2 elige primero.");
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
  document.querySelector("#draft-pick")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const userId = Number(document.querySelector("#draft-player").value);
    button.disabled = true;
    try {
      const match = await api(`/api/admin/matches/${button.dataset.matchId}/draft/pick`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      selectedMatchId = match.id;
      showToast(match.draft.status === "complete" ? "Draft completo. Equipos guardados." : "Jugador elegido.");
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
  document.querySelector("#match-finance-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    form.querySelector("button").disabled = true;
    try {
      await api(`/api/admin/matches/${form.dataset.matchId}/finance`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showToast("Cobro aplicado; los saldos y el bote se han actualizado.");
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      form.querySelector("button").disabled = false;
    }
  });
  document.querySelector("#match-result-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = new FormData(form).get("result");
    form.querySelector("button").disabled = true;
    try {
      await api(`/api/admin/matches/${form.dataset.matchId}/result`, {
        method: "POST",
        body: JSON.stringify({ result }),
      });
      showToast("Resultado guardado y puntos asignados.");
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      form.querySelector("button").disabled = false;
    }
  });
  document.querySelector("#negative-balance-alert")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api(`/api/admin/matches/${button.dataset.matchId}/notify-negative-balances`, {
        method: "POST",
        body: "{}",
      });
      showToast(result.alreadySent ? "La alerta de este partido ya se había enviado." : `${result.delivered || 0} alerta(s) de saldo enviadas.`);
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
}

async function renderPlayer() {
  await loadUsers();
  convocationData = await api("/api/convocations/current");
  matchData = await api("/api/matches");
  standingsData = await api("/api/standings");
  pushConfig = await api("/api/push/config").catch(() => ({ enabled: false, publicKey: null }));
  const player = users.find((user) => user.id === currentUser?.id);
  const content = `
    <div class="mb-7"><div class="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-pitch-700"><span class="h-2 w-2 rounded-full bg-pitch-700"></span>VESTUARIO</div><h1 class="display text-3xl font-extrabold tracking-tight sm:text-4xl">¡Hola, ${escapeHtml(currentUser?.name?.split(" ")[0] || "jugador")}!</h1><p class="mt-2 text-sm text-ink/55">Responde a la convocatoria y consulta las listas del equipo.</p></div>
    ${renderConvocationBoard(convocationData, false)}
    ${renderMatchPanel(matchData, false)}
    ${renderStandingsBoard(standingsData)}
    <div class="mt-5 grid gap-4 sm:grid-cols-2">
      <section class="rounded-2xl border border-ink/[.07] bg-white p-6 shadow-sm"><p class="text-xs font-bold uppercase tracking-[.12em] text-ink/45">Tu rol base</p><p class="display mt-3 text-2xl font-extrabold">${player?.base_role === "principal" ? "Principal" : "Suplente"}</p></section>
      <section class="rounded-2xl border border-ink/[.07] bg-white p-6 shadow-sm"><p class="text-xs font-bold uppercase tracking-[.12em] text-ink/45">Saldo</p><p class="display mt-3 text-2xl font-extrabold">${formatMoney(player?.balance)}</p></section>
    </div>`;
  shell(content);
  bindConvocationActions();
  bindMatchActions();
}

function formatMoney(amount) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(amount) || 0);
}

function openPlayerModal(player = null) {
  const editing = Boolean(player);
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-40 grid place-items-center bg-pitch-950/50 p-4 backdrop-blur-[2px]";
  overlay.innerHTML = `
    <section class="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8" role="dialog" aria-modal="true" aria-labelledby="player-modal-title">
      <div class="mb-6 flex items-start justify-between"><div><p class="text-xs font-bold uppercase tracking-[.13em] text-pitch-700">${editing ? "PLANTILLA" : "NUEVA INCORPORACIÓN"}</p><h2 id="player-modal-title" class="display mt-1 text-2xl font-extrabold">${editing ? "Editar jugador" : "Añadir jugador"}</h2></div><button type="button" class="close-modal grid h-9 w-9 place-items-center rounded-xl bg-paper text-ink/55 hover:bg-ink/10" aria-label="Cerrar">✕</button></div>
      <form id="player-form" class="space-y-4">
        <label class="block"><span class="mb-1.5 block text-sm font-semibold">Nombre</span><input name="name" required maxlength="80" value="${escapeHtml(player?.name || "")}" placeholder="Ej. Alex García" class="w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none transition focus:border-pitch-700 focus:ring-4 focus:ring-pitch-700/10"/></label>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block"><span class="mb-1.5 block text-sm font-semibold">Rol en el equipo</span><select name="role" class="w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-pitch-700">${["principal", "suplente"].map((role) => `<option value="${role}" ${player?.role === role ? "selected" : ""}>${role === "principal" ? "Principal" : "Suplente"}</option>`).join("")}</select></label>
          <label class="block"><span class="mb-1.5 block text-sm font-semibold">Posición en ranking</span><input name="ranking_position" type="number" min="1" step="1" value="${player?.ranking_position ?? ""}" placeholder="Ej. 1" class="w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-pitch-700"/></label>
        </div>
        <label class="block"><span class="mb-1.5 block text-sm font-semibold">Saldo (€)</span><input name="balance" type="number" step="0.01" value="${player?.balance ?? "0.00"}" class="w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-pitch-700"/></label>
        <div id="form-error" class="hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"></div>
        <div class="flex gap-3 pt-2"><button type="button" class="close-modal flex-1 rounded-xl border border-ink/15 px-4 py-3 text-sm font-bold hover:bg-paper">Cancelar</button><button class="flex-1 rounded-xl bg-pitch-900 px-4 py-3 text-sm font-bold text-white hover:bg-pitch-800">${editing ? "Guardar cambios" : "Crear jugador"}</button></div>
      </form>
    </section>`;
  document.body.append(overlay);
  overlay.querySelectorAll(".close-modal").forEach((button) => button.addEventListener("click", () => overlay.remove()));
  overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });
  overlay.querySelector("#player-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.ranking_position = payload.ranking_position || null;
    try {
      await api(editing ? `/api/admin/users/${player.id}` : "/api/admin/users", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      overlay.remove();
      await loadUsers();
      renderAdmin();
      showToast(editing ? "Cambios guardados." : "Jugador añadido al equipo.");
    } catch (error) {
      const errorBox = overlay.querySelector("#form-error");
      errorBox.textContent = error.message;
      errorBox.classList.remove("hidden");
    }
  });
  overlay.querySelector('input[name="name"]').focus();
}

async function login(userId) {
  try {
    const result = await api("/api/session", { method: "POST", body: JSON.stringify({ userId }) });
    currentUser = result.user;
    await loadUsers();
    await renderHome();
  } catch (error) {
    showToast(error.message);
  }
}

async function logout() {
  try {
    const registration = await navigator.serviceWorker?.ready;
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) {
      await api("/api/push/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
  } catch {
    // The server session still closes even if push unsubscribe fails.
  }
  await api("/api/session", { method: "DELETE" }).catch(() => {});
  currentUser = null;
  renderLogin();
}

async function renderHome() {
  if (currentUser?.role === "admin") return renderAdmin();
  return renderPlayer();
}

async function loadUsers() {
  users = await api("/api/users");
}

let pollingConvocation = false;
async function refreshConvocationIfChanged() {
  if (!currentUser || document.visibilityState !== "visible" || pollingConvocation || document.querySelector('[role="dialog"]')) return;
  pollingConvocation = true;
  try {
    const latest = await api("/api/convocations/current");
    if (JSON.stringify(latest) !== JSON.stringify(convocationData)) {
      convocationData = latest;
      await renderHome();
    }
  } catch {
    // Keep the last visible response while temporarily offline.
  } finally {
    pollingConvocation = false;
  }
}

setInterval(refreshConvocationIfChanged, 30000);

async function start() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("No se pudo registrar el service worker:", error));
  try {
    await loadUsers();
    const session = await api("/api/session");
    currentUser = session.user;
    if (currentUser) await renderHome();
    else {
      await loadUsers();
      renderLogin();
    }
  } catch (error) {
    app.innerHTML = `<main class="grid min-h-screen place-items-center p-6"><div class="max-w-sm text-center"><div class="text-4xl">⚽</div><h1 class="display mt-4 text-2xl font-extrabold">No hay conexión con el servidor</h1><p class="mt-2 text-sm text-ink/55">Comprueba la conexión e inténtalo de nuevo.</p><button onclick="location.reload()" class="mt-5 rounded-xl bg-pitch-900 px-5 py-3 text-sm font-bold text-white">Reintentar</button></div></main>`;
    console.error(error);
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  document.querySelectorAll("#install-app").forEach((button) => button.classList.replace("hidden", "inline-flex"));
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  showToast("O Pachanga se ha instalado correctamente.");
});
start();
