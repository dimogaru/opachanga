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
let pendingUsers = [];
let financeData = { players: [], transactions: [], pot: 0 };
let activeAdminTab = "convocatoria";

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
  const playerCount = list.length;
  const rows = list.length
    ? list.map((user) => `<li class="flex items-center gap-3 px-4 py-3 ${isAdmin && title === "Lista de suplentes" ? "pr-2" : ""}">
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl ${colorClass} text-[11px] font-bold">${escapeHtml(String(user.alias || "").slice(0, 2).toUpperCase())}</span>
        <span class="min-w-0 flex-1 truncate text-sm font-semibold">${escapeHtml(user.alias)}</span>
        <span class="hidden text-[11px] text-ink/40 sm:inline">${`${user.base_role === "principal" ? "Principal" : "Suplente"}${user.base_role === "suplente" && user.response === "principal" ? " · promovido" : ""}`}</span>
        ${isAdmin && title === "Lista de suplentes" ? `<button class="promote-player shrink-0 rounded-lg border border-pitch-700/20 px-2.5 py-1.5 text-[11px] font-bold text-pitch-800 transition hover:bg-pitch-100" data-user-id="${user.id}" aria-label="Promover a ${escapeHtml(user.alias)} a principal">↑ Principal</button>` : ""}
        ${isAdmin && title === "Lista principal" ? `<button class="notify-promoted shrink-0 rounded-lg border border-ink/10 px-2.5 py-1.5 text-[11px] font-bold text-ink/65 transition hover:bg-paper" data-user-id="${user.id}" aria-label="Enviar aviso a ${escapeHtml(user.alias)}">Avisar</button>` : ""}
      </li>`).join("")
    : `<li class="px-4 py-7 text-center text-sm text-ink/40">La lista está vacía.</li>`;
  return `<section class="overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm">
    <header class="flex items-center justify-between gap-3 border-b border-ink/[.07] px-4 py-3.5">
      <h3 class="flex items-center gap-2 text-sm font-bold"><span class="grid h-7 w-7 place-items-center rounded-lg ${colorClass}">${icon}</span>${title}</h3>
       <span class="rounded-full bg-paper px-2.5 py-1 text-xs font-bold text-ink/60">${playerCount}</span>
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
  const principalList = data.lists.principal || [];
  const captainOptionsA = principalList.map((player, index) =>
    `<option value="${player.id}" ${index === 0 ? "selected" : ""}>${escapeHtml(player.alias)}</option>`,
  ).join("");
  const captainOptionsB = principalList.map((player, index) =>
    `<option value="${player.id}" ${index === 1 ? "selected" : ""}>${escapeHtml(player.alias)}</option>`,
  ).join("");
  const canReopen = data.match.canReopen && data.match.status !== "played" && !["in_progress", "complete"].includes(data.match.draft?.status);
  const adminControls = !isAdmin ? "" : open
    ? `<form id="close-convocation-form" class="grid gap-3 border-t border-white/10 bg-white/[.03] p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:px-7">
        ${data.validForMatch ? `<label class="text-xs font-semibold text-white/70">Capitán A<select name="captainA" required class="mt-1.5 w-full rounded-xl border border-white/15 bg-pitch-800 px-3 py-2.5 text-sm text-white">${captainOptionsA}</select></label><label class="text-xs font-semibold text-white/70">Capitán B<select name="captainB" required class="mt-1.5 w-full rounded-xl border border-white/15 bg-pitch-800 px-3 py-2.5 text-sm text-white">${captainOptionsB}</select></label>` : `<p class="text-xs text-white/60 sm:col-span-2">Se puede cerrar con cualquier recuento; el draft solo se habilita con 14–16 principales.</p>`}
        <button class="rounded-xl bg-lime px-4 py-2.5 text-xs font-extrabold text-pitch-950">${data.validForMatch ? "Cerrar y guardar capitanes" : "Cerrar convocatoria"}</button>
      </form>`
    : data.match.status === "played"
      ? `<div class="border-t border-white/10 bg-white/[.03] p-4 text-xs text-white/60 sm:px-7">Partido jugado; la convocatoria no se puede reabrir.</div>`
      : `<div class="flex flex-col gap-3 border-t border-white/10 bg-white/[.03] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-7"><span class="text-xs text-white/60">Convocatoria cerrada. ${data.match.draft?.status === "in_progress" ? `Capitanes designados; turno del Equipo ${data.match.draft.currentTurn}.` : data.validForMatch ? "Revisa los capitanes en Partidos." : "No se puede iniciar el draft con este recuento."}</span>${canReopen ? `<button id="open-convocation" class="rounded-xl border border-white/20 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-white/10">Abrir convocatoria</button>` : ""}</div>`;
  return `
    <section class="mb-7 overflow-hidden rounded-3xl bg-pitch-900 text-white shadow-card">
      <div class="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
        <div class="max-w-xl">
          <div class="flex flex-wrap items-center gap-2"><span class="rounded-full ${open ? "bg-lime/15 text-lime" : "bg-white/15 text-white/70"} px-3 py-1.5 text-[10px] font-bold tracking-[.12em]">${open ? "CONVOCATORIA ABIERTA" : "CONVOCATORIA CERRADA"}</span><span class="text-xs text-white/50">Martes ${formatConvocationDate(data.match)}</span></div>
          <h2 class="display mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">${isAdmin ? "Control de convocatoria" : "¿Cuentas con nosotros?"}</h2>
          <p class="mt-1 text-sm text-white/60">${isAdmin ? "Administra el plazo y revisa las respuestas del grupo." : "Responde antes del lunes a las 20:00."}</p>
          <div class="mt-4 flex items-center gap-2 text-sm font-semibold ${data.validForMatch ? "text-lime" : "text-white/80"}"><span class="grid h-6 w-6 place-items-center rounded-full ${data.validForMatch ? "bg-lime/15 text-lime" : "bg-white/10"}">${data.validForMatch ? "✓" : "!"}</span>${readinessText}</div>
        </div>
        <div class="flex min-w-[210px] flex-col gap-3 rounded-2xl border border-white/10 bg-white/[.06] p-4">
          <div class="flex items-end justify-between"><span class="text-xs font-semibold text-white/60">Lista principal</span><span class="display text-3xl font-extrabold ${data.validForMatch ? "text-lime" : "text-white"}">${data.principalCount}<span class="text-base font-semibold text-white/40"> / 14–16</span></span></div>
          <div class="h-2 overflow-hidden rounded-full bg-white/10"><div class="h-full rounded-full ${data.validForMatch ? "bg-lime" : "bg-white/70"} transition-all" style="width:${Math.min(100, Math.round((data.principalCount / 16) * 100))}%"></div></div>
          <span class="text-[11px] text-white/45">${data.responseCount} respuestas · ${data.totalPlayers - data.responseCount} sin responder</span>
        </div>
      </div>
      ${isAdmin ? adminControls : `<div class="flex flex-col gap-3 border-t border-white/10 bg-white/[.03] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <span class="text-xs font-semibold text-white/60">${data.currentResponse ? `Tu respuesta: ${data.currentResponse === "no_va" ? "NO VOY" : "SÍ VOY"}` : "Todavía no has respondido"}</span>
        <div class="flex gap-2">
          <button id="response-yes" ${!open ? "disabled" : ""} class="flex-1 rounded-xl ${data.currentResponse === "principal" || data.currentResponse === "suplente" ? "bg-lime text-pitch-950" : "bg-white text-pitch-950"} px-4 py-2.5 text-xs font-extrabold tracking-wide transition hover:bg-lime disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">SÍ VOY</button>
          <button id="response-no" ${!open ? "disabled" : ""} class="flex-1 rounded-xl ${data.currentResponse === "no_va" ? "bg-red-300 text-pitch-950" : "border border-white/20 bg-white/5 text-white"} px-4 py-2.5 text-xs font-extrabold tracking-wide transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">NO VOY</button>
        </div>
      </div>`}
    </section>
     <div class="mb-3"><h2 class="display text-xl font-extrabold tracking-tight">${isAdmin ? "Listas del grupo" : "Respuestas del grupo"}</h2><p class="mt-1 text-xs text-ink/50">La lista se actualiza para todo el equipo.</p></div>
    <div class="grid gap-4 lg:grid-cols-3">
      ${listPanel("Lista principal", data.lists.principal, "bg-pitch-100 text-pitch-800", "✓", isAdmin)}
      ${listPanel("Lista de suplentes", data.lists.suplentes, "bg-amber-50 text-amber-700", "↗", isAdmin)}
      ${listPanel("Lista NO VAN", data.lists.no_va, "bg-stone-100 text-stone-500", "—", isAdmin)}
    </div>
    <details class="mt-4 rounded-2xl border border-ink/[.07] bg-white px-4 py-3">
       <summary class="cursor-pointer list-none text-sm font-semibold">Sin responder <span class="ml-1 rounded-full bg-paper px-2 py-0.5 text-xs text-ink/55">${data.lists.pending.length}</span></summary>
      <p class="mt-2 text-xs text-ink/50">${data.lists.pending.length ? data.lists.pending.map((user) => escapeHtml(user.alias)).join(" · ") : "Todo el grupo ha respondido."}</p>
    </details>`;
}

function matchLabel(match) {
  const date = new Date(`${match.start_date}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 7);
  return `Partido del ${date.toLocaleDateString("es-ES", { day: "numeric", month: "long", timeZone: "UTC" })}`;
}

function renderTeamCard(title, players, tone) {
  const rows = players.length
    ? players.map((player) => `<li class="flex items-center gap-2.5 border-t border-ink/[.06] px-4 py-3 first:border-0"><span class="grid h-7 w-7 place-items-center rounded-lg bg-white/80 text-[10px] font-bold text-ink/55" aria-hidden="true">⚽</span><span class="text-sm font-semibold">${escapeHtml(player.alias)}</span></li>`).join("")
    : `<li class="px-4 py-6 text-sm text-ink/45">Sin jugadores todavía.</li>`;
  return `<section class="overflow-hidden rounded-2xl border border-ink/[.07] ${tone}"><header class="flex items-center justify-between px-4 py-3"><h3 class="font-bold">${title}</h3><span class="rounded-full bg-white/75 px-2.5 py-1 text-xs font-bold">${players.length}</span></header><ul class="bg-white/70">${rows}</ul></section>`;
}

function renderCaptainDraft(match) {
  const draft = match.draft || {};
  if (match.status !== "closed" || draft.status !== "in_progress" ||
      ![draft.captainA, draft.captainB].includes(currentUser?.id)) return "";
  if (match.draftValidationError) {
    return `<section class="my-4 rounded-2xl border border-red-700/20 bg-red-50 p-4 text-sm text-red-800" role="alert"><h3 class="font-bold">Draft detenido por una validación</h3><p class="mt-1">${escapeHtml(match.draftValidationError)} El Admin debe revisar la alineación antes de continuar.</p></section>`;
  }
  const myTeam = currentUser.id === draft.captainA ? "A" : "B";
  const isMyTurn = draft.currentTurn === myTeam;
  const activeCaptainName = draft.currentTurn === "A"
    ? users.find((player) => player.id === draft.captainA)?.name || "Capitán A"
    : users.find((player) => player.id === draft.captainB)?.name || "Capitán B";
  const available = match.available || [];
  const remaining = draft.remaining?.length || 0;
  const selectionHint = remaining === 3
    ? "Quedan tres: el capitán A elige dos seguidos y el último jugador se asigna automáticamente al Equipo A."
    : remaining === 2 && draft.currentTurn === "A"
      ? "Al capitán A le queda una elección antes de que el último jugador se asigne automáticamente a su equipo."
      : "Los capitanes alternan una elección cada uno.";
  const playerCards = available.length
    ? available.map((player) => `<button type="button" class="captain-draft-pick flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white px-4 py-3 text-left shadow-sm transition ${isMyTurn ? "hover:border-pitch-700 hover:bg-pitch-50 active:scale-[.99]" : "cursor-not-allowed opacity-55"}" data-match-id="${match.id}" data-player-id="${player.id}" data-final-pick="${remaining === 2 && draft.currentTurn === "A"}" ${isMyTurn ? "" : "disabled"}><span class="min-w-0 truncate text-sm font-semibold">${escapeHtml(player.alias)}</span><span class="shrink-0 rounded-lg bg-pitch-100 px-2.5 py-1.5 text-[11px] font-extrabold text-pitch-800">${isMyTurn ? "Elegir" : "En espera"}</span></button>`).join("")
    : `<p class="rounded-xl bg-white/70 p-4 text-sm text-ink/50">El draft se está completando.</p>`;
  return `<section class="my-4 rounded-2xl border border-pitch-700/15 bg-pitch-50 p-4 sm:p-5" aria-live="polite">
    <div class="flex flex-wrap items-start justify-between gap-3"><div><p class="text-[10px] font-extrabold uppercase tracking-[.13em] text-pitch-700">Elección de equipos</p><h3 class="display mt-1 text-xl font-extrabold">Eres capitán del Equipo ${myTeam}</h3></div><span class="rounded-full ${isMyTurn ? "bg-pitch-900 text-white" : "bg-white text-ink/60"} px-3 py-1.5 text-xs font-extrabold">${isMyTurn ? "TU TURNO" : `Turno de ${escapeHtml(activeCaptainName)}`}</span></div>
    <p class="mt-2 text-sm leading-5 text-ink/60">${isMyTurn ? "Toca un jugador de la lista para sumarlo a tu equipo." : `${escapeHtml(activeCaptainName)} está eligiendo. La lista se actualizará automáticamente.`}</p>
    <div class="mt-3 grid gap-2 sm:grid-cols-2">${playerCards}</div>
    <p class="mt-3 text-[11px] leading-5 text-ink/45">${selectionHint} · ${remaining} ${remaining === 1 ? "jugador restante" : "jugadores restantes"}</p>
  </section>`;
}

function renderMatchPanel(matchesData, isAdmin = false, showFinance = isAdmin) {
  const matches = matchesData.matches || [];
  if (!matches.length) return "";
  const captainMatch = !isAdmin
    ? matches.find((match) => match.draft?.status === "in_progress" &&
      [match.draft.captainA, match.draft.captainB].includes(currentUser?.id))
    : null;
  let selected = captainMatch || matches.find((match) => match.id === Number(selectedMatchId));
  if (!selected) {
    selected = matches.find((match) => match.status === "closed") ||
      matches.find((match) => match.status === "played") || matches[0];
    selectedMatchId = selected.id;
  }
  const draft = selected.draft || {};
  const completed = draft.status === "complete";
  const available = selected.available || [];
  const principalPlayers = selected.principalPlayers || [];
  const captainOptionsA = principalPlayers.map((player, index) =>
    `<option value="${player.id}" ${player.id === draft.captainA || (!draft.captainA && index === 0) ? "selected" : ""}>${escapeHtml(player.alias)}</option>`,
  ).join("");
  const captainOptionsB = principalPlayers.map((player, index) =>
    `<option value="${player.id}" ${player.id === draft.captainB || (!draft.captainB && index === 1) ? "selected" : ""}>${escapeHtml(player.alias)}</option>`,
  ).join("");
  const turnName = draft.currentTurn === "A"
    ? users.find((player) => player.id === draft.captainA)?.alias || "Capitán 1"
    : users.find((player) => player.id === draft.captainB)?.alias || "Capitán 2";
  const selection = `<label class="block"><span class="mb-1.5 block text-xs font-semibold text-ink/55">Seleccionar partido</span><select id="match-picker" class="w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-pitch-700">${matches.map((match) => `<option value="${match.id}" ${match.id === selected.id ? "selected" : ""}>${escapeHtml(matchLabel(match))} · ${match.status === "played" ? "jugado" : match.status === "closed" ? "convocatoria cerrada" : "convocatoria abierta"}</option>`).join("")}</select></label>`;
  let adminControls = "";
  if (selected.draftValidationError) {
    adminControls = `<div class="mt-4 rounded-xl border border-red-700/20 bg-red-50 p-4 text-sm text-red-800" role="alert"><p class="font-bold">Validación del draft bloqueada</p><p class="mt-1">${escapeHtml(selected.draftValidationError)} No se podrá confirmar el resultado ni aplicar el cobro hasta revisar la alineación.</p></div>`;
  } else if (isAdmin && selected.status === "closed" && !["in_progress", "complete"].includes(draft.status)) {
    const count = selected.principalCount ?? convocationData?.principalCount ?? 0;
    adminControls = count >= 14 && count <= 16
      ? `<form id="start-draft-form" data-match-id="${selected.id}" class="mt-4 rounded-xl bg-paper p-4"><p class="text-sm font-bold">Convocatoria cerrada · ${count} principales</p><p class="mt-1 text-xs text-ink/50">Elige los capitanes A y B. El capitán B empieza; al quedar tres jugadores, el capitán A elige dos y recibe automáticamente al último.</p><div class="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label class="text-xs font-semibold text-ink/55">Capitán A<select name="captainA" required class="mt-1 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm">${captainOptionsA}</select></label><label class="text-xs font-semibold text-ink/55">Capitán B<select name="captainB" required class="mt-1 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm">${captainOptionsB}</select></label><button class="rounded-xl bg-pitch-900 px-4 py-2.5 text-sm font-bold text-white">Iniciar draft</button></div></form>`
      : `<p class="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">No se puede iniciar el draft: hacen falta entre 14 y 16 confirmados principales; hay ${count}.</p>`;
  } else if (isAdmin && draft.status === "in_progress") {
    adminControls = `<div class="mt-4 rounded-xl bg-paper p-4"><p class="text-sm font-bold">Elección en curso · Turno del Equipo ${draft.currentTurn}</p><p class="mt-1 text-xs text-ink/50">Le toca a ${escapeHtml(turnName)}. Los capitanes eligen desde sus perfiles; la lista se actualiza automáticamente.</p></div>`;
  } else if (selected.status === "open") {
    adminControls = `<p class="mt-4 rounded-xl bg-paper p-4 text-sm text-ink/55">El draft estará disponible después de cerrar la convocatoria.</p>`;
  } else if (draft.status === "complete") {
    adminControls = `<p class="mt-4 rounded-xl bg-pitch-100 p-4 text-sm font-bold text-pitch-900">Draft completo. Composición de equipos guardada.</p>`;
  }
  const scoreText = selected.result === "draw" ? "Empate" : selected.result ? `Victoria del Equipo ${selected.result}` : "";
  const finance = selected.finance;
  const financeControl = isAdmin && showFinance
    ? finance
      ? `<div class="mt-4 grid gap-2 rounded-xl bg-white p-4 text-xs text-ink/60 sm:grid-cols-4"><span>Precio total: <b class="text-ink">${formatMoney(finance.pitch_cost)}</b></span><span>Cuota inicial: <b class="text-ink">${formatMoney(finance.fee_per_player)}</b></span><span>Cobrado (${finance.participants}): <b class="text-ink">${formatMoney(finance.total_collected)}</b></span><span>Al bote: <b class="text-pitch-800">${formatMoney(finance.pot_added)}</b></span></div>`
      : `<p class="mt-4 rounded-xl bg-paper p-4 text-sm text-ink/55">${selected.pitch_price == null ? "Configura el Precio por Partido desde la pestaña Finanzas." : `Precio configurado: ${formatMoney(selected.pitch_price)}.`} El descuento se aplicará automáticamente al guardar el resultado.</p>`
    : "";
  const canSaveResult = selected.status === "played" || Boolean(finance) || selected.pitch_price != null;
  const resultControl = isAdmin && completed && !selected.draftValidationError
    ? canSaveResult
      ? `<form id="match-result-form" data-match-id="${selected.id}" data-existing="${selected.status === "played"}" class="mt-4 flex flex-col gap-2 rounded-xl bg-white p-4 sm:flex-row sm:items-end"><label class="flex-1"><span class="mb-1.5 block text-xs font-semibold text-ink/55">Resultado final</span><select name="result" required class="w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm"><option value="A" ${selected.result === "A" ? "selected" : ""}>Gana Equipo A</option><option value="B" ${selected.result === "B" ? "selected" : ""}>Gana Equipo B</option><option value="draw" ${selected.result === "draw" ? "selected" : ""}>Empate</option></select></label><button class="rounded-xl bg-lime px-4 py-2.5 text-sm font-extrabold text-pitch-950">${selected.status === "played" ? "Actualizar resultado y puntos" : finance ? "Guardar resultado y puntos" : "Guardar resultado y cobrar"}</button></form>${selected.status !== "played" && !finance ? `<p class="mt-2 text-xs text-ink/45">Se cobrará ${formatMoney(selected.pitch_price)} entre quienes jugaron; cualquier redondeo se suma al bote.</p>` : ""}`
      : `<p class="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Antes de guardar el resultado, define el Precio por Partido en Finanzas.</p>`
    : selected.status === "played" ? `<p class="mt-4 rounded-xl bg-lime/20 p-4 text-sm font-bold text-pitch-900">Resultado: ${scoreText}. Puntuación guardada: asistencia +1, victoria +3 extra, empate +1 extra.</p>` : "";
  return `<section class="mb-7 rounded-3xl border border-ink/[.07] bg-white p-5 shadow-sm sm:p-6"><div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p class="text-xs font-bold uppercase tracking-[.12em] text-pitch-700">Partidos</p><h2 class="display mt-1 text-2xl font-extrabold">${escapeHtml(matchLabel(selected))}</h2><p class="mt-1 text-xs text-ink/50">${selected.status === "played" ? "Partido jugado" : selected.status === "closed" ? "Convocatoria cerrada" : "Convocatoria abierta"}</p></div><div class="w-full sm:max-w-xs">${selection}</div></div><div class="grid gap-3 sm:grid-cols-2">${renderTeamCard("Equipo A", selected.teamA || [], "bg-pitch-100 text-pitch-900")}${renderTeamCard("Equipo B", selected.teamB || [], "bg-amber-50 text-amber-900")}</div>${isAdmin ? adminControls : renderCaptainDraft(selected)}${financeControl}${resultControl}</section>`;
}

function renderMatchFinanceControl(matchesData) {
  const matches = matchesData.matches || [];
  if (!matches.length) return "";
  let selected = matches.find((match) => match.id === Number(selectedMatchId));
  if (!selected) selected = matches.find((match) => match.draft?.status === "complete" && !match.finance) || matches[0];
  selectedMatchId = selected.id;
  const options = matches.map((match) =>
    `<option value="${match.id}" ${match.id === selected.id ? "selected" : ""}>${escapeHtml(matchLabel(match))} · ${match.status === "played" ? "jugado" : match.status === "closed" ? "cerrado" : "abierto"}</option>`,
  ).join("");
  const action = selected.finance
    ? `<div class="grid gap-2 rounded-xl bg-paper p-4 text-xs text-ink/60 sm:grid-cols-4"><span>Precio total: <b class="text-ink">${formatMoney(selected.finance.pitch_cost)}</b></span><span>Cuota inicial: <b class="text-ink">${formatMoney(selected.finance.fee_per_player)}</b></span><span>Cobrado (${selected.finance.participants}): <b class="text-ink">${formatMoney(selected.finance.total_collected)}</b></span><span>Al bote: <b class="text-pitch-800">${formatMoney(selected.finance.pot_added)}</b></span></div>`
    : selected.status === "played"
      ? `<div class="rounded-xl bg-paper p-4 text-sm text-ink/55">Este partido ya tiene resultado, pero no conserva un cobro automático histórico.</div>`
      : `<form id="match-price-form" data-match-id="${selected.id}" class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><label><span class="mb-1.5 block text-xs font-semibold text-ink/55">Precio por Partido · coste total de pista/reserva (€)</span><input name="price_total" type="number" min="0" step="0.01" required value="${selected.pitch_price ?? ""}" placeholder="Ej. 60,00" class="w-full rounded-xl border border-ink/10 px-3 py-2.5 text-sm"/></label><button class="rounded-xl bg-pitch-900 px-4 py-2.5 text-sm font-bold text-white">${selected.pitch_price == null ? "Guardar precio" : "Actualizar precio"}</button><p class="text-xs text-ink/45 sm:col-span-2">Al guardar el resultado, se dividirá entre los jugadores de los equipos, redondeando la cuota al céntimo superior; el sobrante irá al bote.</p></form>`;
  return `<section class="mb-5 rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm"><div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 class="font-bold">Precio del partido y cobro automático</h3><p class="mt-1 text-xs text-ink/50">La cuota se descuenta una vez al guardar el primer resultado.</p></div><label class="text-xs font-semibold text-ink/55 sm:w-64">Partido<select id="finance-match-picker" class="mt-1 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm">${options}</select></label></div>${action}</section>`;
}

function renderStandingsBoard(data) {
  const rows = data.standings || [];
  return `<section class="mb-7 overflow-hidden rounded-3xl border border-ink/[.07] bg-white shadow-sm"><div class="flex flex-col gap-3 border-b border-ink/[.07] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><p class="text-xs font-bold uppercase tracking-[.12em] text-pitch-700">Temporada</p><h2 class="display mt-1 text-2xl font-extrabold">Clasificación</h2><p class="mt-1 text-xs text-ink/50">Puntos globales por asistencia y resultado.</p></div><div class="rounded-2xl bg-lime/35 px-4 py-3"><p class="text-[10px] font-bold uppercase tracking-[.12em] text-pitch-900/60">Bote acumulado</p><p class="display text-xl font-extrabold text-pitch-900">${formatMoney(data.pot)}</p></div></div><div class="overflow-x-auto"><table class="w-full min-w-[560px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-5 py-3">#</th><th class="px-4 py-3">Jugador</th><th class="px-4 py-3">Puntos</th><th class="px-4 py-3">PJ</th><th class="px-4 py-3">V-E-D</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${rows.length ? rows.map((player, index) => `<tr><td class="px-5 py-3 text-sm font-bold text-pitch-700">${index + 1}</td><td class="px-4 py-3 text-sm font-semibold">${escapeHtml(player.alias)}</td><td class="px-4 py-3"><span class="rounded-full bg-pitch-100 px-2.5 py-1 text-xs font-extrabold text-pitch-900">${player.points}</span></td><td class="px-4 py-3 text-sm text-ink/55">${player.matches_played}</td><td class="px-4 py-3 text-sm text-ink/55">${player.wins}-${player.draws}-${player.losses}</td></tr>`).join("") : `<tr><td colspan="5" class="px-5 py-8 text-center text-sm text-ink/45">La clasificación empieza con el primer resultado.</td></tr>`}</tbody></table></div></section>`;
}

function renderApprovalPanel(pending) {
  const cards = pending.length
    ? pending.map((user) => `<form class="pending-approval-card grid gap-3 border-t border-ink/[.06] p-4 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end" data-user-id="${user.id}"><div><p class="font-bold">${escapeHtml(`${user.first_name} ${user.last_name}`)}</p><p class="mt-0.5 text-xs text-ink/45">@${escapeHtml(user.alias)}</p></div><label><span class="mb-1 block text-[11px] font-semibold text-ink/55">Rol base</span><select name="base_role" class="w-full rounded-lg border border-ink/10 bg-white px-2.5 py-2 text-sm"><option value="principal">Principal</option><option value="suplente">Suplente</option></select></label><label><span class="mb-1 block text-[11px] font-semibold text-ink/55">Posición fija</span><input name="ranking_position" type="number" min="1" step="1" required placeholder="1" class="w-full rounded-lg border border-ink/10 px-2.5 py-2 text-sm"/></label><label><span class="mb-1 block text-[11px] font-semibold text-ink/55">Saldo inicial (€)</span><input name="balance" type="number" step="0.01" required value="0" class="w-full rounded-lg border border-ink/10 px-2.5 py-2 text-sm"/></label><button class="rounded-xl bg-pitch-900 px-4 py-2.5 text-xs font-bold text-white">Aprobar</button></form>`).join("")
    : `<p class="px-5 py-7 text-center text-sm text-ink/45">No hay solicitudes pendientes de revisión.</p>`;
  return `<section class="mb-7 overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm"><header class="flex items-center justify-between px-5 py-4"><div><h2 class="font-bold">Aprobaciones pendientes</h2><p class="mt-1 text-xs text-ink/45">Asigna rol base, posición fija y saldo inicial para activar la cuenta.</p></div><span class="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">${pending.length}</span></header>${cards}</section>`;
}

function renderPlayerManagementPanel(players, pending) {
  const rows = players.map((user) => `<tr class="hover:bg-paper/50" data-player-search="${escapeHtml(`${user.name} ${user.alias}`.toLocaleLowerCase("es"))}">
    <td class="px-4 py-3 sm:px-5"><div class="font-semibold">${escapeHtml(user.name)}</div><div class="mt-0.5 text-xs text-ink/45">@${escapeHtml(user.alias)}</div></td>
    <td class="px-4 py-3 text-sm">${user.base_role === "principal" ? "Principal" : "Suplente"}</td>
    <td class="px-4 py-3 text-sm">${user.ranking_position ? `#${user.ranking_position}` : "—"}</td>
    <td class="px-4 py-3 text-sm font-semibold">${formatMoney(user.balance)}</td>
    <td class="px-4 py-3"><div class="flex flex-wrap justify-end gap-1.5"><button class="edit-player rounded-lg border border-ink/10 px-2.5 py-1.5 text-[11px] font-bold hover:border-pitch-700 hover:text-pitch-700" data-id="${user.id}">Editar</button><button class="reset-player-password rounded-lg border border-ink/10 px-2.5 py-1.5 text-[11px] font-bold hover:bg-paper" data-id="${user.id}">Resetear contraseña</button><button class="delete-player rounded-lg border border-red-700/15 px-2.5 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-50" data-id="${user.id}">Retirar</button></div></td>
  </tr>`).join("");
  return `${renderApprovalPanel(pending)}
    <section class="overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm">
      <header class="flex flex-col gap-3 border-b border-ink/[.07] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div><h2 class="font-bold">Gestión de jugadores</h2><p class="mt-1 text-xs text-ink/45">Editar datos, rol, ranking, saldo o acceso.</p></div>
        <button id="new-player" class="rounded-xl bg-pitch-900 px-4 py-2.5 text-xs font-bold text-white">+ Añadir jugador</button>
      </header>
      <div class="border-b border-ink/[.06] p-4"><label class="block"><span class="sr-only">Buscar jugadores</span><input id="player-search" type="search" placeholder="Buscar por nombre o alias…" class="w-full rounded-xl border border-ink/10 px-4 py-2.5 text-sm outline-none focus:border-pitch-700 sm:max-w-sm"/></label></div>
      ${players.length ? `<div class="overflow-x-auto"><table class="w-full min-w-[760px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-4 py-3 sm:px-5">Jugador</th><th class="px-4 py-3">Rol</th><th class="px-4 py-3">Ranking</th><th class="px-4 py-3">Saldo</th><th class="px-4 py-3 text-right">Acciones</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${rows}</tbody></table></div>` : `<p class="px-5 py-10 text-center text-sm text-ink/45">Aún no hay jugadores activos.</p>`}
    </section>`;
}

function renderFinancePanel(data, matchesData) {
  const players = data.players || [];
  const transactions = data.transactions || [];
  const playerOptions = players.map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join("");
  const adjustmentControl = (transaction) => {
    if (!transaction.can_adjust) {
      return `<span class="text-xs text-ink/45">${transaction.transaction_type === "adjustment" ? "Asiento de ajuste" : "—"}</span>`;
    }
    const currentCharge = Math.max(0, Number(transaction.current_charge) || 0);
    return `<details class="min-w-48"><summary class="cursor-pointer list-none rounded-lg border border-pitch-700/20 px-3 py-2 text-center text-xs font-bold text-pitch-800 hover:bg-pitch-50">Corregir / devolver cargo</summary><form class="transaction-adjust-form mt-2 grid gap-2 rounded-xl bg-paper p-3" data-transaction-id="${transaction.id}" data-current-charge="${currentCharge.toFixed(2)}"><label class="text-[11px] font-semibold text-ink/60">Acción<select name="action" class="mt-1 block w-full rounded-lg border border-ink/10 bg-white px-2.5 py-2 text-xs"><option value="adjust">Corregir cuota</option><option value="refund">Devolver íntegramente</option></select></label><label class="target-charge-field text-[11px] font-semibold text-ink/60">Cuota final (€)<input name="target_amount" type="number" min="0" step="0.01" required value="${currentCharge.toFixed(2)}" class="mt-1 block w-full rounded-lg border border-ink/10 bg-white px-2.5 py-2 text-xs"/></label><label class="text-[11px] font-semibold text-ink/60">Motivo<input name="reason" required maxlength="120" placeholder="Ej. importe introducido por error" class="mt-1 block w-full rounded-lg border border-ink/10 bg-white px-2.5 py-2 text-xs"/></label><p class="text-[10px] leading-4 text-ink/45">Se conserva el cargo original y se crea un nuevo asiento.</p><button class="rounded-lg bg-pitch-900 px-3 py-2 text-xs font-bold text-white">Guardar ajuste</button></form></details>`;
  };
  const statusLabel = (transaction) => transaction.status === "adjusted"
    ? "Ajustada"
    : transaction.status === "refunded"
      ? "Devuelta"
      : transaction.transaction_type === "match_charge"
        ? "Cargo de partido"
        : transaction.transaction_type === "adjustment"
          ? "Ajuste"
          : "Registrada";
  const transactionCards = transactions.map((transaction) => `<article class="grid gap-2 py-3 first:pt-0 last:pb-0"><div class="flex items-start justify-between gap-3"><div><p class="text-xs text-ink/45">${escapeHtml(transaction.date)}</p><p class="mt-1 text-sm font-bold">${escapeHtml(transaction.name)}</p></div><span class="shrink-0 text-sm font-extrabold ${transaction.amount < 0 ? "text-red-700" : "text-pitch-800"}">${formatMoney(transaction.amount)}</span></div><p class="text-xs leading-5 text-ink/60">${escapeHtml(transaction.concept)}</p><div class="flex items-center justify-between gap-2"><span class="rounded-full bg-paper px-2.5 py-1 text-[10px] font-bold text-ink/60">${statusLabel(transaction)}</span>${transaction.match_id ? `<span class="text-[10px] text-ink/40">Partido #${transaction.match_id}</span>` : ""}</div>${adjustmentControl(transaction)}</article>`).join("");
  const transactionRows = transactions.map((transaction) => `<tr><td class="px-4 py-3 text-xs text-ink/50">${escapeHtml(transaction.date)}</td><td class="px-4 py-3 text-sm font-semibold">${escapeHtml(transaction.name)}</td><td class="px-4 py-3 text-sm text-ink/65"><span>${escapeHtml(transaction.concept)}</span><span class="mt-1 block text-[10px] text-ink/40">${transaction.match_id ? `Partido #${transaction.match_id} · ` : ""}${statusLabel(transaction)}</span></td><td class="px-4 py-3 text-right text-sm font-bold ${transaction.amount < 0 ? "text-red-700" : "text-pitch-800"}">${formatMoney(transaction.amount)}</td><td class="px-4 py-3">${adjustmentControl(transaction)}</td></tr>`).join("");
  return `<div class="mb-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><div><p class="text-xs font-bold uppercase tracking-[.12em] text-pitch-700">Gestión financiera</p><h2 class="display mt-1 text-2xl font-extrabold">Saldos y movimientos</h2><p class="mt-1 text-sm text-ink/50">Los ajustes quedan anotados en el historial de cada jugador.</p></div><div class="rounded-2xl bg-lime/35 px-5 py-3"><p class="text-[10px] font-bold uppercase tracking-[.12em] text-pitch-900/60">Bote acumulado</p><p class="display text-xl font-extrabold text-pitch-900">${formatMoney(data.pot)}</p></div></div>
    ${renderMatchFinanceControl(matchesData)}
    <form id="balance-adjust-form" class="mb-5 grid gap-3 rounded-2xl border border-ink/[.07] bg-white p-4 shadow-sm sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end">
      <label class="text-xs font-semibold text-ink/60">Jugador<select name="user_id" required class="mt-1.5 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm">${playerOptions}</select></label>
      <label class="text-xs font-semibold text-ink/60">Ajuste (€)<input name="amount" type="number" step="0.01" required placeholder="+10 o -5" class="mt-1.5 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm"/></label>
      <label class="text-xs font-semibold text-ink/60">Concepto<input name="concept" required maxlength="120" placeholder="Pago, devolución, corrección…" class="mt-1.5 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm"/></label>
      <button ${players.length ? "" : "disabled"} class="rounded-xl bg-pitch-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">Registrar ajuste</button>
      <p class="text-[11px] text-ink/45 sm:col-span-4">Un importe positivo suma saldo; uno negativo lo descuenta. El cobro de pista de cada partido se gestiona arriba.</p>
    </form>
    <section class="mb-5 overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm"><header class="flex items-center justify-between border-b border-ink/[.07] px-4 py-3.5"><div><h3 class="font-bold">Saldos de jugadores</h3><p class="mt-0.5 text-xs text-ink/45">${players.length} cuentas activas; Admin no tiene saldo de jugador.</p></div></header>
      ${players.length ? `<div class="overflow-x-auto"><table class="w-full min-w-[420px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-4 py-3">Jugador</th><th class="px-4 py-3">Rol</th><th class="px-4 py-3 text-right">Saldo</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${players.map((player) => `<tr><td class="px-4 py-3 text-sm font-semibold">${escapeHtml(player.name)}</td><td class="px-4 py-3 text-xs text-ink/50">${player.base_role === "principal" ? "Principal" : "Suplente"}</td><td class="px-4 py-3 text-right text-sm font-bold ${player.balance < 0 ? "text-red-700" : ""}">${formatMoney(player.balance)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="px-4 py-8 text-center text-sm text-ink/45">No hay jugadores activos.</p>`}
    </section>
    <section class="overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm"><header class="border-b border-ink/[.07] px-4 py-3.5"><h3 class="font-bold">Historial financiero</h3><p class="mt-0.5 text-xs text-ink/45">Hasta 100 movimientos. Los cargos ajustables conservan su asiento original.</p></header>
      ${transactions.length ? `<div class="divide-y divide-ink/[.06] p-4 sm:hidden">${transactionCards}</div><div class="hidden overflow-x-auto sm:block"><table class="w-full min-w-[920px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-4 py-3">Fecha</th><th class="px-4 py-3">Jugador</th><th class="px-4 py-3">Concepto / estado</th><th class="px-4 py-3 text-right">Importe</th><th class="px-4 py-3">Acción</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${transactionRows}</tbody></table></div>` : `<p class="px-4 py-8 text-center text-sm text-ink/45">Aún no hay movimientos financieros.</p>`}
    </section>`;
}

function renderNotificationPanel(data, players, config, status) {
  const campaigns = status.campaigns || {};
  const message = config.enabled
    ? "Web Push está activo. La apertura y el recordatorio también se programan automáticamente."
    : "Web Push está desactivado: configura VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en el servidor.";
  const principalPlayers = data.lists.principal || [];
  return `<div class="mb-5"><p class="text-xs font-bold uppercase tracking-[.12em] text-pitch-700">Centro de avisos</p><h2 class="display mt-1 text-2xl font-extrabold">Notificaciones push</h2><p class="mt-1 text-sm text-ink/50">${message}</p></div>
    <div class="mb-5 grid gap-3 sm:grid-cols-2">
      ${[
        ["opening", "Convocatoria abierta", "Envía el aviso de apertura al grupo.", campaigns.opening],
        ["unanswered", "Aún no te has apuntado", "Solo a jugadores que todavía no respondieron.", campaigns.friday_reminder],
        ["negative_balance", "Aviso de saldo negativo", "A jugadores convocados con saldo negativo.", null],
      ].map(([type, title, description, campaign]) => `<article class="rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm"><div class="flex items-start justify-between gap-3"><div><h3 class="font-bold">${title}</h3><p class="mt-1 text-xs leading-5 text-ink/50">${description}</p></div><span class="rounded-full ${campaign?.status === "sent" ? "bg-pitch-100 text-pitch-800" : "bg-paper text-ink/50"} px-2.5 py-1 text-[10px] font-bold">${campaign?.status === "sent" ? `${campaign.delivered_count} enviadas` : "Manual"}</span></div><button data-notification-type="${type}" ${!config.enabled || (type !== "negative_balance" && data.match.status !== "open") ? "disabled" : ""} class="admin-notification-button mt-4 w-full rounded-xl bg-pitch-900 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">${title}</button></article>`).join("")}
      <article class="rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm"><h3 class="font-bold">Aviso individual de Lista Principal</h3><p class="mt-1 text-xs leading-5 text-ink/50">Envía un aviso directo a un jugador que aparece en la lista principal actual.</p><div class="mt-4 flex gap-2"><select id="notify-player-select" class="min-w-0 flex-1 rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm">${principalPlayers.map((player) => `<option value="${player.id}">${escapeHtml(player.alias)}</option>`).join("")}</select><button id="notify-player" ${!config.enabled || !principalPlayers.length ? "disabled" : ""} class="shrink-0 rounded-xl bg-pitch-900 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40">Enviar</button></div></article>
    </div>
    <section class="rounded-2xl border border-ink/[.07] bg-white p-5 text-xs text-ink/55 shadow-sm"><h3 class="font-bold text-ink">Estado de envíos</h3><p class="mt-2">Apertura: ${campaigns.opening?.status === "sent" ? `${campaigns.opening.delivered_count} entregadas` : "sin enviar"} · Recordatorio: ${campaigns.friday_reminder?.status === "sent" ? `${campaigns.friday_reminder.delivered_count} entregadas` : "sin enviar"}</p><p class="mt-1">Partido semanal: ${escapeHtml(matchLabel(data.match))}</p></section>`;
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
            ${currentUser?.role === "admin" ? `<span class="hidden rounded-full border border-lime/30 px-3 py-1.5 text-[10px] font-bold tracking-wide text-lime sm:inline-flex">ADMIN</span>` : `<button id="push-toggle" disabled class="rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4" title="Activa avisos de convocatoria en este dispositivo">Activar avisos</button>`}
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
  if (currentUser?.role !== "admin") syncPushButton();
}

function renderRegistration() {
  app.innerHTML = `
    <main class="min-h-screen bg-paper px-5 py-10 sm:grid sm:place-items-center">
      <section class="mx-auto w-full max-w-lg rounded-3xl border border-ink/[.07] bg-white p-6 shadow-card sm:p-9">
        <p class="text-xs font-bold uppercase tracking-[.15em] text-pitch-700">NUEVO JUGADOR</p><h1 class="display mt-2 text-3xl font-extrabold">Crear cuenta</h1>
        <p class="mt-2 text-sm leading-6 text-ink/55">El administrador revisará tu solicitud antes de activar el acceso.</p>
        <form id="register-form" class="mt-6 space-y-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <label><span class="mb-1.5 block text-sm font-semibold">Nombre</span><input name="first_name" required maxlength="60" autocomplete="given-name" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm outline-none focus:border-pitch-700"/></label>
            <label><span class="mb-1.5 block text-sm font-semibold">Apellidos</span><input name="last_name" required maxlength="80" autocomplete="family-name" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm outline-none focus:border-pitch-700"/></label>
          </div>
          <label class="block"><span class="mb-1.5 block text-sm font-semibold">Alias único</span><input name="alias" required minlength="3" maxlength="24" autocomplete="username" pattern="[A-Za-zÀ-ÿ0-9._-]{3,24}" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm outline-none focus:border-pitch-700"/><span class="mt-1 block text-xs text-ink/45">3–24 caracteres: letras, números, punto, guion o guion bajo.</span></label>
          <label class="block"><span class="mb-1.5 block text-sm font-semibold">Contraseña</span><input name="password" required type="password" minlength="8" maxlength="72" autocomplete="new-password" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm outline-none focus:border-pitch-700"/><span class="mt-1 block text-xs text-ink/45">Mínimo 8 caracteres.</span></label>
          <div id="register-error" class="hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"></div>
          <div class="flex flex-col gap-2 pt-1 sm:flex-row"><button type="button" id="back-to-login" class="flex-1 rounded-xl border border-ink/15 px-4 py-3 text-sm font-bold">Volver</button><button class="flex-1 rounded-xl bg-pitch-900 px-4 py-3 text-sm font-bold text-white">Enviar solicitud</button></div>
        </form>
      </section>
    </main>`;
  document.querySelector("#back-to-login").addEventListener("click", renderLogin);
  document.querySelector("#register-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]') || form.querySelector("button:last-child");
    button.disabled = true;
    try {
      await api("/api/register", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      app.innerHTML = `<main class="grid min-h-screen place-items-center bg-paper p-5"><section class="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-card"><span class="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-pitch-100 text-2xl text-pitch-800">✓</span><h1 class="display mt-5 text-2xl font-extrabold">Solicitud enviada</h1><p class="mt-2 text-sm leading-6 text-ink/55">Tu cuenta está pendiente de aprobación. Podrás iniciar sesión cuando el administrador la active.</p><button id="back-to-login" class="mt-6 rounded-xl bg-pitch-900 px-5 py-3 text-sm font-bold text-white">Volver al inicio</button></section></main>`;
      document.querySelector("#back-to-login").addEventListener("click", renderLogin);
    } catch (error) {
      const errorBox = document.querySelector("#register-error");
      errorBox.textContent = error.message;
      errorBox.classList.remove("hidden");
      button.disabled = false;
    }
  });
}

function renderPasswordChange() {
  app.innerHTML = `<main class="grid min-h-screen place-items-center bg-paper p-5"><section class="w-full max-w-md rounded-3xl border border-ink/[.07] bg-white p-6 shadow-card sm:p-8"><p class="text-xs font-bold uppercase tracking-[.15em] text-pitch-700">PROTEGE TU CUENTA</p><h1 class="display mt-2 text-2xl font-extrabold">Cambia la contraseña inicial</h1><p class="mt-2 text-sm leading-6 text-ink/55">Antes de usar O Pachanga, elige una contraseña personal.</p><form id="password-change-form" class="mt-6 space-y-4"><label class="block"><span class="mb-1.5 block text-sm font-semibold">Contraseña actual</span><input name="current_password" required type="password" autocomplete="current-password" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm"/></label><label class="block"><span class="mb-1.5 block text-sm font-semibold">Nueva contraseña</span><input name="new_password" required type="password" minlength="8" maxlength="72" autocomplete="new-password" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm"/></label><div id="password-error" class="hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"></div><button class="w-full rounded-xl bg-pitch-900 px-4 py-3 text-sm font-bold text-white">Guardar contraseña</button></form></section></main>`;
  document.querySelector("#password-change-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await api("/api/account/password", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      currentUser.must_change_password = false;
      await loadUsers();
      await renderHome();
    } catch (error) {
      const errorBox = document.querySelector("#password-error");
      errorBox.textContent = error.message;
      errorBox.classList.remove("hidden");
      button.disabled = false;
    }
  });
}

function renderLogin() {
  app.innerHTML = `
    <main class="grid min-h-screen lg:grid-cols-2">
      <section class="pitch-grid flex min-h-[320px] flex-col justify-between bg-pitch-900 px-7 py-7 text-white sm:px-12 sm:py-10 lg:min-h-screen lg:px-16">
        <div class="flex items-center gap-3"><span class="grid h-11 w-11 place-items-center rounded-2xl bg-lime text-pitch-950">⚽</span><span><b class="display block text-xl font-extrabold">O Pachanga</b><span class="text-[10px] font-semibold tracking-[.16em] text-white/55">FÚTBOL ENTRE AMIGOS</span></span></div>
        <div class="max-w-xl py-10"><span class="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-lime">TEMPORADA ABIERTA</span><h1 class="display mt-6 text-4xl font-extrabold leading-tight sm:text-6xl">El templo de<br/><span class="text-lime">O Pachanga.</span></h1><p class="mt-5 max-w-md text-base leading-7 text-white/65">Organiza la pachanga semanal y mantente al día con el equipo.</p></div>
        <p class="text-xs font-medium text-white/45">PARTIDO · EQUIPO · AMIGOS</p>
      </section>
      <section class="flex items-center justify-center px-5 py-12 sm:px-10 lg:px-16"><div class="w-full max-w-md">
        <div class="mb-8 flex items-center justify-between gap-3"><div><p class="text-xs font-bold uppercase tracking-[.15em] text-pitch-700">Bienvenido al vestuario</p><h2 class="display mt-2 text-3xl font-extrabold tracking-tight">Iniciar sesión</h2></div>${installButton("shrink-0 border-pitch-900/10 !bg-pitch-900 !text-white")}</div>
        <form id="login-form" class="space-y-4 rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm">
          <label class="block"><span class="mb-1.5 block text-sm font-semibold">Alias</span><input name="alias" required autocomplete="username" maxlength="24" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm outline-none focus:border-pitch-700"/></label>
          <label class="block"><span class="mb-1.5 block text-sm font-semibold">Contraseña</span><input name="password" required type="password" autocomplete="current-password" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm outline-none focus:border-pitch-700"/></label>
          <div id="login-error" class="hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"></div>
          <button class="w-full rounded-xl bg-pitch-900 px-4 py-3 text-sm font-bold text-white hover:bg-pitch-800">Entrar</button>
        </form>
        <p class="mt-5 text-center text-sm text-ink/55">¿Aún no tienes cuenta? <button id="show-register" class="font-bold text-pitch-700 underline underline-offset-2">Regístrate</button></p>
      </div></section>
    </main>`;
  attachInstallButton();
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const result = await api("/api/session", { method: "POST", body: JSON.stringify(form) });
      currentUser = result.user;
      if (currentUser.must_change_password) renderPasswordChange();
      else {
        await loadUsers();
        await renderHome();
      }
    } catch (error) {
      const errorBox = document.querySelector("#login-error");
      errorBox.textContent = error.message;
      errorBox.classList.remove("hidden");
      button.disabled = false;
    }
  });
  document.querySelector("#show-register").addEventListener("click", renderRegistration);
  return;

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
          <h1 class="display max-w-lg text-4xl font-extrabold leading-[1.08] tracking-[-.04em] sm:text-6xl">El templo de<br/><span class="text-lime">O Pachanga.</span></h1>
          <p class="mt-5 max-w-md text-base leading-7 text-white/65">La pachanga semanal, organizada como se merece. Inicia sesión y salta al campo.</p>
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
  pendingUsers = await api("/api/admin/pending-users");
  financeData = await api("/api/admin/finance/overview");
  pushConfig = await api("/api/push/config").catch(() => ({ enabled: false, publicKey: null }));
  const notificationStatus = await api("/api/admin/notifications/status").catch(() => ({ enabled: pushConfig.enabled, campaigns: {} }));
  const players = users;
  const tabs = [
    ["convocatoria", "Convocatoria"],
    ["avisos", "Avisos"],
    ["finanzas", "Finanzas"],
    ["partidos", "Partidos"],
    ["jugadores", "Jugadores"],
  ];
  const adminContent = `
    <div class="mb-6"><div class="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-pitch-700"><span class="h-2 w-2 rounded-full bg-pitch-700"></span>PANEL EXCLUSIVO DE ADMINISTRACIÓN</div><h1 class="display text-3xl font-extrabold tracking-tight sm:text-4xl">Control de O Pachanga</h1><p class="mt-2 text-sm text-ink/55">Convocatorias, avisos, cuentas y resultados en un solo lugar.</p></div>
    <nav class="mb-6 flex gap-2 overflow-x-auto rounded-2xl border border-ink/[.07] bg-white p-2 shadow-sm" aria-label="Secciones de administración">
      ${tabs.map(([id, label]) => `<button class="admin-tab-button shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold transition ${activeAdminTab === id ? "bg-pitch-900 text-white" : "text-ink/55 hover:bg-paper"}" data-admin-tab="${id}" aria-pressed="${activeAdminTab === id}">${label}</button>`).join("")}
    </nav>
    <section class="admin-tab-panel ${activeAdminTab === "convocatoria" ? "" : "hidden"}" data-admin-panel="convocatoria">
      ${renderConvocationBoard(convocationData, true)}
    </section>
    <section class="admin-tab-panel ${activeAdminTab === "avisos" ? "" : "hidden"}" data-admin-panel="avisos">
      ${renderNotificationPanel(convocationData, users, pushConfig, notificationStatus)}
    </section>
    <section class="admin-tab-panel ${activeAdminTab === "finanzas" ? "" : "hidden"}" data-admin-panel="finanzas">
      ${renderFinancePanel(financeData, matchData)}
    </section>
    <section class="admin-tab-panel ${activeAdminTab === "partidos" ? "" : "hidden"}" data-admin-panel="partidos">
      ${renderMatchPanel(matchData, true, false)}
      ${renderStandingsBoard(standingsData)}
    </section>
    <section class="admin-tab-panel ${activeAdminTab === "jugadores" ? "" : "hidden"}" data-admin-panel="jugadores">
      ${renderPlayerManagementPanel(players, pendingUsers)}
    </section>`;
  shell(adminContent, "Equipo");
  document.querySelectorAll(".admin-tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      activeAdminTab = button.dataset.adminTab;
      document.querySelectorAll("[data-admin-panel]").forEach((panel) =>
        panel.classList.toggle("hidden", panel.dataset.adminPanel !== activeAdminTab),
      );
      document.querySelectorAll(".admin-tab-button").forEach((item) => {
        const active = item.dataset.adminTab === activeAdminTab;
        item.classList.toggle("bg-pitch-900", active);
        item.classList.toggle("text-white", active);
        item.classList.toggle("text-ink/55", !active);
        item.setAttribute("aria-pressed", String(active));
      });
    });
  });
  document.querySelector("#new-player")?.addEventListener("click", () => openPlayerModal());
  document.querySelectorAll(".edit-player").forEach((button) => {
    const player = players.find((user) => user.id === Number(button.dataset.id));
    button.addEventListener("click", () => openPlayerModal(player));
  });
  document.querySelectorAll(".reset-player-password").forEach((button) => {
    const player = players.find((user) => user.id === Number(button.dataset.id));
    button.addEventListener("click", () => openPasswordResetModal(player));
  });
  document.querySelectorAll(".delete-player").forEach((button) => {
    const player = players.find((user) => user.id === Number(button.dataset.id));
    button.addEventListener("click", async () => {
      if (!confirm(`Retirar a ${player.name} del equipo? Se conservarán su historial, movimientos y resultados; perderá acceso a la cuenta.`)) return;
      button.disabled = true;
      try {
        await api(`/api/admin/users/${player.id}`, { method: "DELETE" });
        showToast("Jugador retirado; su historial se conserva.");
        await renderAdmin();
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    });
  });
  document.querySelector("#player-search")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLocaleLowerCase("es");
    document.querySelectorAll("[data-player-search]").forEach((row) => {
      row.classList.toggle("hidden", !row.dataset.playerSearch.includes(query));
    });
  });
  bindConvocationActions(true);
  bindApprovalActions();
  document.querySelector("#close-convocation-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    if (payload.captainA && payload.captainA === payload.captainB) {
      showToast("Elige capitanes distintos para los dos equipos.");
      return;
    }
    form.querySelector("button").disabled = true;
    try {
       const closed = await api("/api/admin/convocations/current/close", {
        method: "POST",
        body: JSON.stringify(payload),
      });
       showToast(closed.match.draft?.status === "in_progress"
         ? "Convocatoria cerrada. Empieza el capitán B desde su perfil."
         : "Convocatoria cerrada.");
      activeAdminTab = "convocatoria";
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      form.querySelector("button").disabled = false;
    }
  });
  document.querySelector("#open-convocation")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api("/api/admin/convocations/current/open", { method: "POST", body: "{}" });
      showToast("Convocatoria abierta.");
      activeAdminTab = "convocatoria";
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
  document.querySelector("#balance-adjust-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const playerId = form.elements.user_id.value;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await api(`/api/admin/users/${playerId}/balance`, {
        method: "POST",
        body: JSON.stringify({
          amount: form.elements.amount.value,
          concept: form.elements.concept.value,
        }),
      });
      showToast("Ajuste registrado en el historial financiero.");
       activeAdminTab = "partidos";
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
  document.querySelectorAll(".transaction-adjust-form").forEach((form) => {
    const actionSelect = form.elements.action;
    const targetInput = form.elements.target_amount;
    const targetLabel = form.querySelector(".target-charge-field");
    const syncAction = () => {
      const refund = actionSelect.value === "refund";
      targetInput.disabled = refund;
      targetInput.required = !refund;
      targetInput.value = refund ? "0.00" : form.dataset.currentCharge;
      targetLabel.classList.toggle("opacity-50", refund);
    };
    actionSelect.addEventListener("change", syncAction);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const action = actionSelect.value;
      const currentCharge = Number(form.dataset.currentCharge);
      const targetAmount = action === "refund" ? 0 : Number(targetInput.value);
      const confirmText = action === "refund"
        ? `Se devolverán ${formatMoney(currentCharge)} al jugador y se actualizarán el bote y las cuentas del partido. ¿Continuar?`
        : `La cuota final cambiará de ${formatMoney(currentCharge)} a ${formatMoney(targetAmount)}. Se registrará la diferencia y se actualizará el bote. ¿Continuar?`;
      if (!confirm(confirmText)) return;
      const button = form.querySelector("button");
      button.disabled = true;
      try {
        const result = await api(`/api/admin/finance/transactions/${form.dataset.transactionId}/adjust`, {
          method: "POST",
          body: JSON.stringify({
            action,
            target_amount: targetAmount,
            reason: form.elements.reason.value,
          }),
        });
        showToast(result.status === "refunded"
          ? "Cargo devuelto; el asiento original se conserva en el historial."
          : "Cuota corregida; el asiento original se conserva en el historial.");
        activeAdminTab = "finanzas";
        await renderAdmin();
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    });
  });
  for (const button of document.querySelectorAll(".admin-notification-button")) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = await api(`/api/admin/notifications/${button.dataset.notificationType}`, { method: "POST", body: "{}" });
        const message = result.alreadySent
          ? "Este aviso ya se había enviado."
          : result.inProgress
            ? "El envío de este aviso está en curso."
            : result.skipped
              ? "Push no está configurado en el servidor."
            : `${result.delivered} notificación(es) enviadas.`;
        showToast(message);
        activeAdminTab = "avisos";
        await renderAdmin();
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    });
  }
  document.querySelector("#notify-player")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const userId = document.querySelector("#notify-player-select").value;
    if (!userId) return showToast("No hay jugadores en la Lista Principal.");
    button.disabled = true;
    try {
      const result = await api(`/api/admin/players/${userId}/notify-promoted`, {
        method: "POST",
        body: "{}",
      });
      showToast(result.skipped ? "Push no está configurado en el servidor." : `${result.delivered} aviso(s) enviados.`);
      activeAdminTab = "avisos";
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
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
          activeAdminTab = "convocatoria";
          await renderAdmin();
        } catch (error) {
          showToast(error.message);
          button.disabled = false;
        }
      });
    });
    document.querySelectorAll(".notify-promoted").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const result = await api(`/api/admin/players/${button.dataset.userId}/notify-promoted`, {
            method: "POST",
            body: "{}",
          });
          showToast(result.skipped ? "Push no está configurado en el servidor." : `${result.delivered} aviso(s) enviados.`);
          activeAdminTab = "convocatoria";
          await renderAdmin();
        } catch (error) {
          showToast(error.message);
          button.disabled = false;
        }
      });
    });
  }
}

function bindApprovalActions() {
  document.querySelectorAll(".pending-approval-card").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector("button");
      submit.disabled = true;
      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        await api(`/api/admin/pending-users/${form.dataset.userId}/approve`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        showToast("Cuenta aprobada y activada.");
        await renderAdmin();
      } catch (error) {
        showToast(error.message);
        submit.disabled = false;
      }
    });
  });
}

function bindMatchActions(isAdmin = false) {
  document.querySelector("#match-picker")?.addEventListener("change", async (event) => {
    selectedMatchId = Number(event.target.value);
    await renderHome();
  });
  document.querySelector("#finance-match-picker")?.addEventListener("change", async (event) => {
    selectedMatchId = Number(event.target.value);
    activeAdminTab = "finanzas";
    await renderAdmin();
  });
  document.querySelectorAll(".captain-draft-pick").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.finalPick === "true" &&
          !confirm("Esta es la última elección manual. El jugador restante pasará automáticamente al Equipo A. ¿Confirmar la alineación?")) return;
      button.disabled = true;
      try {
        const match = await api(`/api/matches/${button.dataset.matchId}/draft/pick`, {
          method: "POST",
          body: JSON.stringify({ userId: Number(button.dataset.playerId) }),
        });
        selectedMatchId = match.id;
        showToast(match.draft.status === "complete" ? "Draft completo. Los equipos ya están publicados." : "Elección guardada.");
        await renderHome();
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    });
  });
  if (!isAdmin) return;
  document.querySelector("#start-draft-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const payload = Object.fromEntries(new FormData(form).entries());
    if (payload.captainA === payload.captainB) {
      showToast("Elige capitanes distintos para los dos equipos.");
      return;
    }
    button.disabled = true;
    try {
      const match = await api(`/api/admin/matches/${form.dataset.matchId}/draft/start`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      selectedMatchId = match.id;
      showToast("Draft iniciado. Empieza el capitán B.");
      activeAdminTab = "finanzas";
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
  document.querySelector("#match-price-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    form.querySelector("button").disabled = true;
    try {
      const { match } = await api(`/api/admin/matches/${form.dataset.matchId}/price`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      selectedMatchId = match.id;
      showToast("Precio del partido guardado; el cobro se aplicará al registrar el resultado.");
      activeAdminTab = "finanzas";
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
    if (form.dataset.existing === "true" &&
        !confirm("Esto actualizará el resultado y recalculará los puntos de este partido. ¿Continuar?")) return;
    form.querySelector("button").disabled = true;
    try {
      const resultResponse = await api(`/api/admin/matches/${form.dataset.matchId}/result`, {
        method: "POST",
        body: JSON.stringify({ result }),
      });
      showToast(resultResponse.charged
        ? "Resultado guardado, cuota descontada y puntos asignados."
        : form.dataset.existing === "true"
          ? "Resultado actualizado; el cobro no se ha repetido."
          : "Resultado guardado y puntos asignados; el cobro ya estaba registrado.");
      activeAdminTab = "partidos";
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      form.querySelector("button").disabled = false;
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
        <label class="block"><span class="mb-1.5 block text-sm font-semibold">Alias único</span><input name="alias" required minlength="3" maxlength="24" pattern="[A-Za-zÀ-ÿ0-9._-]{3,24}" value="${escapeHtml(player?.alias || "")}" placeholder="Ej. alexg" class="w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-pitch-700"/></label>
        <label class="block"><span class="mb-1.5 block text-sm font-semibold">${editing ? "Nueva contraseña (opcional)" : "Contraseña"}</span><input name="password" type="password" ${editing ? "" : "required"} minlength="8" maxlength="72" autocomplete="new-password" class="w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-pitch-700"/></label>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block"><span class="mb-1.5 block text-sm font-semibold">Rol base</span><select name="role" class="w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-pitch-700">${["principal", "suplente"].map((role) => `<option value="${role}" ${player?.role === role ? "selected" : ""}>${role === "principal" ? "Principal" : "Suplente"}</option>`).join("")}</select></label>
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
      activeAdminTab = "jugadores";
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

function openPasswordResetModal(player) {
  if (!player) return;
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-40 grid place-items-center bg-pitch-950/50 p-4 backdrop-blur-[2px]";
  overlay.innerHTML = `<section class="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-8" role="dialog" aria-modal="true" aria-labelledby="password-reset-title">
    <div class="mb-5 flex items-start justify-between"><div><p class="text-xs font-bold uppercase tracking-[.13em] text-pitch-700">ACCESO DE JUGADOR</p><h2 id="password-reset-title" class="display mt-1 text-2xl font-extrabold">Resetear contraseña</h2><p class="mt-1 text-sm text-ink/50">${escapeHtml(player.name)}</p></div><button type="button" class="close-reset grid h-9 w-9 place-items-center rounded-xl bg-paper text-ink/55" aria-label="Cerrar">✕</button></div>
    <form id="password-reset-form" class="space-y-4"><label class="block"><span class="mb-1.5 block text-sm font-semibold">Nueva contraseña temporal</span><input name="password" type="password" required minlength="8" maxlength="72" autocomplete="new-password" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm"/></label><p class="text-xs leading-5 text-ink/50">Al iniciar sesión, el jugador tendrá que elegir una contraseña personal.</p><div id="reset-error" class="hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"></div><div class="flex gap-3"><button type="button" class="close-reset flex-1 rounded-xl border border-ink/15 px-4 py-3 text-sm font-bold">Cancelar</button><button class="flex-1 rounded-xl bg-pitch-900 px-4 py-3 text-sm font-bold text-white">Guardar contraseña</button></div></form>
  </section>`;
  document.body.append(overlay);
  overlay.querySelectorAll(".close-reset").forEach((button) => button.addEventListener("click", () => overlay.remove()));
  overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });
  overlay.querySelector("#password-reset-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']") || form.querySelector("button:last-child");
    button.disabled = true;
    try {
      await api(`/api/admin/users/${player.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: new FormData(form).get("password") }),
      });
      overlay.remove();
      showToast("Contraseña reiniciada; deberá cambiarla al entrar.");
    } catch (error) {
      const errorBox = overlay.querySelector("#reset-error");
      errorBox.textContent = error.message;
      errorBox.classList.remove("hidden");
      button.disabled = false;
    }
  });
  overlay.querySelector('input[name="password"]').focus();
}

async function login(alias, password) {
  try {
    const result = await api("/api/session", {
      method: "POST",
      body: JSON.stringify({ alias, password }),
    });
    currentUser = result.user;
    if (currentUser.must_change_password) renderPasswordChange();
    else {
      await loadUsers();
      await renderHome();
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function logout() {
  try {
    const registration = await navigator.serviceWorker?.ready;
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) {
      if (currentUser?.role !== "admin") {
        await api("/api/push/subscriptions", {
          method: "DELETE",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      }
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
  if (currentUser?.must_change_password) return renderPasswordChange();
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

let pollingDraft = false;
async function refreshLiveDraftIfChanged() {
  if (!currentUser || document.visibilityState !== "visible" || pollingDraft ||
      document.querySelector('[role="dialog"]')) return;
  const isDesignatedCaptain = matchData?.matches?.some((match) =>
    match.draft?.status === "in_progress" &&
    [match.draft.captainA, match.draft.captainB].includes(currentUser.id),
  );
  if (!isDesignatedCaptain) return;
  pollingDraft = true;
  try {
    const latest = await api("/api/matches");
    if (JSON.stringify(latest) !== JSON.stringify(matchData)) {
      matchData = latest;
      await renderHome();
    }
  } catch {
    // The next poll will refresh the draft when the connection returns.
  } finally {
    pollingDraft = false;
  }
}

setInterval(refreshConvocationIfChanged, 15000);
setInterval(refreshLiveDraftIfChanged, 4000);

async function start() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("No se pudo registrar el service worker:", error));
  try {
    const session = await api("/api/session");
    currentUser = session.user;
    if (currentUser) {
      await loadUsers();
      await renderHome();
    } else renderLogin();
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
