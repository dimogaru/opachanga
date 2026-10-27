const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let users = [];
let currentUser = null;
let installPrompt = null;
let toastTimer;
let convocationData = null;
let convocationHistory = [];
let selectedConvocationId = null;
let viewingHistoricalConvocation = false;
let pushConfig = { enabled: false, publicKey: null };
let selectedMatchId = null;
let matchData = { matches: [], pot: 0 };
let standingsData = { standings: [], pot: 0 };
let standingAdjustmentsData = [];
let pendingUsers = [];
let financeData = { players: [], transactions: [], pot: 0 };
let activeAdminTab = "convocatoria";
let manualAssignmentMode = false;
let manualAssignmentMatchId = null;
let manualTeamAssignments = new Map();
let lastAdminTeamNotificationKey = null;

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

function showToast(message, { success = false } = {}) {
  toast.textContent = message;
  toast.classList.toggle("bg-lime", success);
  toast.classList.toggle("text-pitch-950", success);
  toast.classList.toggle("bg-pitch-950", !success);
  toast.classList.toggle("text-white", !success);
  toast.classList.remove("translate-y-3", "opacity-0");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("translate-y-3", "opacity-0"), 2800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function profileButton(userId, alias) {
  return `<button type="button" class="open-player-profile inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-pitch-700 transition hover:bg-pitch-100 focus:outline-none focus:ring-2 focus:ring-pitch-700/30" data-profile-user-id="${Number(userId)}" aria-label="Abrir perfil de ${escapeHtml(alias)}" title="Ver perfil">
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.8"/><path d="M5 20c.6-3.4 3.2-5.5 7-5.5s6.4 2.1 7 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    <span>Perfil</span>
  </button>`;
}

function teamLabel(team) {
  return team === "A" ? "BLANCOS" : "COLOR";
}

function isTeamsPublished(status) {
  return status === "teams_published" || status === "complete";
}

function teamNotificationMessage(notification) {
  if (notification?.status === "sent" && notification.failed === 0) {
    const missing = notification.withoutSubscriptions
      ? ` (${notification.withoutSubscriptions} jugador(es) sin dispositivo suscrito)`
      : "";
    return `Equipos guardados y notificación enviada a toda la plantilla${missing}`;
  }
  if (notification?.status === "partial") {
    return `Equipos guardados; aviso parcial: ${notification.delivered} enviados, ${notification.failed} fallidos.`;
  }
  if (notification?.status === "empty") {
    return notification.activePlayers
      ? "Equipos guardados; no hay dispositivos suscritos en la plantilla."
      : "Equipos guardados; no hay jugadores activos a quienes avisar.";
  }
  if (notification?.status === "failed") return "Equipos guardados, pero falló el envío de la notificación push.";
  return "Equipos guardados, pero no se envió el aviso push: revisa la configuración VAPID.";
}

function teamNotificationKey(match) {
  const sentAt = match?.teamNotification?.sentAt;
  return sentAt ? `${match.id}:${sentAt}` : null;
}

function profileAvatar(photoUrl, alias, size = "h-24 w-24") {
  const initials = escapeHtml(String(alias || "?").slice(0, 2).toUpperCase());
  return `<div class="${size} grid shrink-0 place-items-center overflow-hidden rounded-full border-4 border-white bg-pitch-100 text-2xl font-extrabold text-pitch-800 shadow-md" data-profile-avatar>
    ${photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="Foto de ${escapeHtml(alias)}" class="h-full w-full object-cover"/>` : initials}
  </div>`;
}

function bindPlayerProfileButtons() {
  document.querySelectorAll(".open-player-profile").forEach((button) =>
    button.addEventListener("click", () => openPlayerProfile(Number(button.dataset.profileUserId))),
  );
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
  const banner = button.closest("[data-push-banner]");
  const hideBanner = () => {
    if (!banner) return;
    banner.hidden = true;
    banner.style.display = "none";
  };
  const showBanner = () => {
    if (!banner) return;
    banner.hidden = false;
    banner.style.removeProperty("display");
  };
  if ("Notification" in window && Notification.permission === "granted") {
    hideBanner();
    return;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    showBanner();
    button.disabled = true;
    button.textContent = "Avisos no disponibles";
    button.title = "Este navegador no admite notificaciones push.";
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      hideBanner();
      button.dataset.active = "true";
      return;
    }
    showBanner();
    if (!pushConfig.enabled || !("Notification" in window)) {
      button.disabled = true;
      button.textContent = "Avisos no configurados";
      button.title = "El servidor debe configurar Web Push y el navegador debe admitirlo.";
      button.classList.add("cursor-not-allowed", "opacity-60");
      return;
    }
    button.disabled = false;
    button.textContent = "Activar notificaciones push";
    button.dataset.active = "false";
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
    if (!active) {
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
      await api("/api/subscriptions", {
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

async function syncExistingPushSubscription() {
  if (
    !currentUser ||
    !pushConfig.enabled ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await api("/api/subscriptions", {
      method: "POST",
      body: JSON.stringify(subscription),
    });
  } catch (error) {
    console.warn("No se pudo resincronizar la suscripción push:", error);
  }
}

function openAccountSettings() {
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-50 grid place-items-center bg-pitch-950/65 p-4 backdrop-blur-sm";
  overlay.innerHTML = `<section class="w-full max-w-sm rounded-3xl bg-paper p-5 shadow-2xl sm:p-7" role="dialog" aria-modal="true" aria-labelledby="account-settings-title">
    <div class="flex items-start justify-between gap-4"><div><p class="text-xs font-bold uppercase tracking-[.13em] text-pitch-700">CUENTA</p><h2 id="account-settings-title" class="display mt-1 text-2xl font-extrabold">Configuración</h2></div><button class="close-account-settings grid h-9 w-9 place-items-center rounded-xl bg-white text-ink/60" type="button" aria-label="Cerrar configuración">✕</button></div>
    <div class="mt-5 rounded-2xl bg-white p-4"><p class="text-xs font-semibold uppercase tracking-wide text-ink/45">Sesión activa</p><p class="mt-1 font-bold">${escapeHtml(currentUser?.alias || currentUser?.name || "")}</p><p class="mt-1 text-xs text-ink/50">${currentUser?.role === "admin" ? "Administrador" : "Jugador"}</p></div>
    <p class="mt-4 text-sm leading-5 text-ink/55">La sesión permanece activa al cerrar la PWA. Cierra sesión solo para cambiar de cuenta.</p>
    <div class="mt-6 flex items-center justify-between border-t border-ink/10 pt-4"><span class="text-[11px] text-ink/40">¿Vas a cambiar de cuenta?</span><button id="account-logout" type="button" class="rounded-lg px-2 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 hover:text-red-900">Cerrar sesión</button></div>
  </section>`;
  document.body.append(overlay);
  overlay.querySelector(".close-account-settings").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.querySelector("#account-logout").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    overlay.remove();
    await logout();
  });
}

function formatConvocationDate(match) {
  if (match.match_date) return `Partido · ${formatMatchSchedule(match)}`;
  const start = new Date(`${match.start_date}T12:00:00Z`);
  const end = new Date(`${match.end_date.slice(0, 10)}T12:00:00Z`);
  const fmt = (date) => date.toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(start)} — ${fmt(end)}, 20:00`;
}

function renderPushBanner() {
  return `<section id="pushNotificationCard" data-push-banner class="mb-6 flex flex-col gap-4 rounded-2xl border border-pitch-900/10 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
    <div class="flex items-start gap-3">
      <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pitch-100 text-pitch-800" aria-hidden="true">🔔</span>
      <div><h2 class="font-bold">Activa las notificaciones push</h2><p class="mt-1 text-sm leading-5 text-ink/55">Recibe avisos de convocatoria y novedades directamente en este dispositivo.</p></div>
    </div>
    <button id="push-toggle" disabled class="w-full shrink-0 rounded-xl bg-pitch-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-pitch-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto" title="Activa avisos de convocatoria en este dispositivo">Activar notificaciones push</button>
  </section>`;
}

function formatConvocationRange(match) {
  if (match.match_date) return `Partido ${formatMatchSchedule(match)}`;
  const start = new Date(`${match.start_date}T12:00:00Z`);
  const end = new Date(`${match.end_date.slice(0, 10)}T12:00:00Z`);
  const fmt = (date) => date.toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
  return `Jornada ${fmt(start)} - ${fmt(end)}`;
}

function formatSpanishDate(dateString) {
  if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const date = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateString) return null;
  const parts = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const titleCase = (value) => value.charAt(0).toLocaleUpperCase("es-ES") + value.slice(1);
  return `${titleCase(values.weekday)}, ${values.day} de ${titleCase(values.month)}`;
}

function formatMatchDate(match) {
  return formatSpanishDate(match?.match_date) || match?.match_date_label || "Fecha por definir";
}

function formatMatchTime(match) {
  return match?.match_time_label || `${match?.match_time || "20:00"} h`;
}

function formatMatchSchedule(match) {
  return `${formatMatchDate(match)} · ${formatMatchTime(match)}`;
}

function madridDateInputValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function convocationStatusLabel(status) {
  return status === "cancelled" ? "Cancelada" : status === "played" ? "Partido jugado" : status === "closed" ? "Cerrada" : "Abierta";
}

function renderConvocationHistorySelector(data, history) {
  const rows = history.length ? history : data.match ? [data.match] : [];
  if (!rows.length) return "";
  return `<div class="mb-4 rounded-2xl border border-ink/[.07] bg-white p-4 shadow-sm">
    <label for="convocation-history-picker" class="mb-2 block text-xs font-bold uppercase tracking-[.1em] text-ink/50">Historial de convocatorias</label>
    <select id="convocation-history-picker" class="w-full rounded-xl border border-ink/10 bg-paper px-3 py-3 text-sm font-semibold text-ink outline-none transition focus:border-pitch-700 sm:max-w-xl">
      ${rows.map((match) => {
        const isActive = match.is_active === true || (match.id === data.match.id && !data.match.readOnly);
        const label = `${isActive ? "Convocatoria activa / " : ""}${formatConvocationRange(match)} · ${convocationStatusLabel(match.status)}`;
        return `<option value="${match.id}" ${match.id === data.match.id ? "selected" : ""}>${escapeHtml(label)}</option>`;
      }).join("")}
    </select>
  </div>`;
}

function renderConvocationHistorySummary(match) {
  const teamA = match.teamA || [];
  const teamB = match.teamB || [];
  const allPlayers = [...teamA, ...teamB];
  const aliasFor = (id) => allPlayers.find((player) => player.id === id)?.alias || "—";
  const captains = match.draft?.captainA && match.draft?.captainB
    ? `<div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink/55"><span>Capitán de BLANCOS: <b class="text-ink">${escapeHtml(aliasFor(match.draft.captainA))}</b></span><span>Capitán de COLOR: <b class="text-ink">${escapeHtml(aliasFor(match.draft.captainB))}</b></span></div>`
    : "";
  const resultLabel = match.result === "draw" ? "Empate" : match.result ? `Ganó ${teamLabel(match.result)}` : "Sin resultado registrado";
  const finance = match.finance;
  const financeSummary = finance
    ? `<div class="mt-4 grid gap-2 rounded-xl bg-paper p-3 text-xs text-ink/60 sm:grid-cols-2 lg:grid-cols-4"><span>Coste de pista: <b class="text-ink">${formatMoney(finance.pitch_cost)}</b></span><span>Cuota por jugador: <b class="text-ink">${formatMoney(finance.fee_per_player)}</b></span><span>Total cobrado: <b class="text-ink">${formatMoney(finance.total_collected)}</b></span><span>Añadido al bote: <b class="text-pitch-800">${formatMoney(finance.pot_added)}</b></span></div>`
    : `<p class="mt-4 rounded-xl bg-paper p-3 text-xs text-ink/50">No hay un cobro de partido registrado para esta jornada.</p>`;
  const transactions = match.transactions || [];
  const transactionsSummary = `<details class="mt-3 overflow-hidden rounded-xl border border-ink/[.07] bg-white">
    <summary class="cursor-pointer list-none px-3 py-3 text-xs font-bold">Movimientos de cobro y ajustes <span class="ml-1 rounded-full bg-paper px-2 py-1 text-[10px] text-ink/50">${transactions.length}</span></summary>
    ${transactions.length
      ? `<ul class="divide-y divide-ink/[.06] border-t border-ink/[.06]">${transactions.map((transaction) => {
        const status = transaction.status === "adjusted" ? "Ajustado" : transaction.status === "refunded" ? "Devuelto" : "Aplicado";
        const reference = transaction.adjustment_of ? ` · Ajuste del asiento #${transaction.adjustment_of}` : "";
        return `<li class="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"><span class="min-w-0"><b class="text-ink">${escapeHtml(transaction.alias)}</b><span class="ml-2 text-ink/50">${escapeHtml(transaction.concept)}${escapeHtml(reference)}</span></span><span class="flex shrink-0 items-center gap-2 text-xs"><b class="text-ink">${formatMoney(transaction.amount)}</b><span class="rounded-full bg-paper px-2 py-1 text-[10px] font-semibold text-ink/55">${status}</span></span></li>`;
      }).join("")}</ul>`
      : `<p class="border-t border-ink/[.06] px-3 py-3 text-xs text-ink/45">No se guardaron movimientos de cobro.</p>`}
  </details>`;
  return `<section class="mb-5 rounded-2xl border border-ink/[.07] bg-white p-4 shadow-sm sm:p-5">
    <div class="flex flex-wrap items-center justify-between gap-2"><div><p class="text-[10px] font-extrabold uppercase tracking-[.12em] text-pitch-700">Resumen guardado</p><h3 class="mt-1 font-bold">Partido · ${escapeHtml(resultLabel)}</h3></div><span class="rounded-full bg-paper px-3 py-1.5 text-xs font-bold text-ink/55">${teamA.length + teamB.length} jugadores en equipos</span></div>
    ${captains}
    <div class="mt-4 grid gap-3 sm:grid-cols-2">${renderTeamCard("BLANCOS", teamA, "bg-pitch-100 text-pitch-900")}${renderTeamCard("COLOR", teamB, "bg-amber-50 text-amber-900")}</div>
    ${financeSummary}
    ${transactionsSummary}
  </section>`;
}

function listPanel(title, usersInList, colorClass, icon, isAdmin = false, showBaseRole = true, canRemoveSubstitutes = false, canDemotePrincipals = false) {
  const list = usersInList || [];
  const playerCount = list.length;
  const rows = list.length
    ? list.map((user) => {
      const canRemove = title === "Lista de suplentes" && canRemoveSubstitutes &&
        (currentUser?.role === "admin" || Number(user.invited_by_user_id) === Number(currentUser?.id));
      const isAdminPrincipalRow = isAdmin && title === "Lista principal";
      const roleLabel = user.base_role === "suplente" && user.response === "principal"
        ? "Suplente promovido"
        : user.response === "suplente"
          ? "Suplente"
          : "Principal";
      return `<li class="flex items-center gap-2.5 px-3 py-3 sm:gap-3 sm:px-4 ${isAdmin && title === "Lista de suplentes" ? "pr-2" : ""}">
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl ${colorClass} text-[11px] font-bold">${escapeHtml(String(user.alias || "").slice(0, 2).toUpperCase())}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-extrabold leading-5 ${isAdminPrincipalRow ? "text-left" : ""}">${escapeHtml(user.alias)}${title === "Lista de suplentes" && user.invited_by_alias ? `<span class="ml-1 font-normal text-ink/50">(${escapeHtml(user.invited_by_alias)})</span>` : ""}</span>
          ${showBaseRole ? `<span class="block truncate text-[10px] leading-4 text-ink/45">${escapeHtml(isAdminPrincipalRow ? roleLabel : `${user.base_role === "principal" ? "Principal" : "Suplente"}${user.base_role === "suplente" && user.response === "principal" ? " · promovido" : ""}`)}</span>` : ""}
        </span>
        ${!isAdminPrincipalRow ? profileButton(user.id, user.alias) : ""}
        ${isAdmin && title === "Lista de suplentes" ? `<button class="promote-player shrink-0 rounded-lg border border-pitch-700/20 px-2.5 py-1.5 text-[11px] font-bold text-pitch-800 transition hover:bg-pitch-100" data-user-id="${user.id}" aria-label="Promover a ${escapeHtml(user.alias)} a principal">↑ Principal</button>` : ""}
        ${canDemotePrincipals && title === "Lista principal" ? `<span class="ml-auto flex shrink-0 items-center gap-1">
          <button type="button" class="change-principal-status rounded-lg border border-amber-700/20 px-2 py-2 text-[9px] font-extrabold leading-none text-amber-800 transition hover:bg-amber-50 disabled:opacity-50 sm:px-2.5 sm:text-[10px]" data-user-id="${user.id}" data-alias="${escapeHtml(user.alias)}" data-status="suplente" aria-label="Mover a ${escapeHtml(user.alias)} a Suplentes">A SUPLENTE</button>
          <button type="button" class="change-principal-status rounded-lg border border-red-700/20 px-2 py-2 text-[9px] font-extrabold leading-none text-red-700 transition hover:bg-red-50 disabled:opacity-50 sm:px-2.5 sm:text-[10px]" data-user-id="${user.id}" data-alias="${escapeHtml(user.alias)}" data-status="no_va" aria-label="Mover a ${escapeHtml(user.alias)} a NO VAN">NO VAN</button>
        </span>` : ""}
        ${canRemove ? `<button type="button" class="remove-substitute grid h-9 w-9 shrink-0 place-items-center rounded-lg text-red-700 transition hover:bg-red-50 disabled:opacity-50" data-user-id="${user.id}" data-alias="${escapeHtml(user.alias)}" aria-label="Quitar a ${escapeHtml(user.alias)} de la convocatoria" title="Quitar suplente">×</button>` : ""}
      </li>`;
    }).join("")
    : `<li class="px-4 py-7 text-center text-sm text-ink/40">La lista está vacía.</li>`;
  return `<section class="overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm">
    <header class="flex items-center justify-between gap-3 border-b border-ink/[.07] px-4 py-3.5">
      <h3 class="flex items-center gap-2 text-sm font-bold"><span class="grid h-7 w-7 place-items-center rounded-lg ${colorClass}">${icon}</span>${title}</h3>
       <span class="rounded-full bg-paper px-2.5 py-1 text-xs font-bold text-ink/60">${playerCount}</span>
    </header>
    <ul class="divide-y divide-ink/[.05]">${rows}</ul>
  </section>`;
}

function renderNewConvocationControl(match, history = []) {
  const hasActiveMatch = history.some((item) => item.is_active);
  const isTerminal = !match || ["played", "cancelled"].includes(match.status);
  if (hasActiveMatch || !isTerminal) return "";
  const sourceMatchId = match?.id || "";
  return `<div class="mt-2 w-full">
    <button id="show-new-convocation-date" type="button" class="w-full rounded-xl bg-lime px-4 py-3 text-sm font-extrabold text-pitch-950 shadow-sm transition hover:bg-lime/90 focus:outline-none focus:ring-2 focus:ring-lime focus:ring-offset-2 focus:ring-offset-pitch-900">Abrir Nueva Convocatoria</button>
    <form id="new-convocation-form" data-source-match-id="${sourceMatchId}" class="mt-3 hidden rounded-xl border border-white/15 bg-white/[.08] p-3">
      <label class="block text-xs font-bold text-white/80">Fecha del Partido
        <input name="match_date" type="date" min="${madridDateInputValue()}" required class="mt-1.5 w-full rounded-lg border border-white/15 bg-white px-2.5 py-2.5 text-sm font-semibold text-ink"/>
      </label>
      <label class="mt-3 block text-xs font-bold text-white/80">Hora del Partido <span class="font-normal text-white/45">(opcional)</span>
        <input name="match_time" type="time" value="20:00" class="mt-1.5 w-full rounded-lg border border-white/15 bg-white px-2.5 py-2.5 text-sm font-semibold text-ink"/>
      </label>
      <p class="mt-2 text-[11px] leading-4 text-white/55">El grupo verá esta fecha. La convocatoria solo se cerrará cuando la cierre Admin.</p>
      <button class="mt-3 w-full rounded-lg bg-white px-3 py-2.5 text-xs font-extrabold text-pitch-900">Confirmar y Abrir Convocatoria</button>
    </form>
  </div>`;
}

function renderCancellationAlert(cancellation) {
  if (!cancellation) return "";
  return `<div class="mb-5 rounded-2xl border border-red-700/25 bg-red-50 p-4 text-red-900 shadow-sm sm:p-5" role="alert">
    <p class="text-sm font-extrabold tracking-wide">CONVOCATORIA CANCELADA por no alcanzar el mínimo de jugadores (14).</p>
    <p class="mt-1 text-xs text-red-800/75">${escapeHtml(formatMatchSchedule(cancellation))}. No se aplican cobros ni puntos.</p>
  </div>`;
}

function renderConvocationBoard(data, isAdmin = false, history = []) {
  if (!data.match) {
    return `${renderCancellationAlert(data.cancellation)}
      ${isAdmin ? renderConvocationHistorySelector(data, history) : ""}
      <section class="mb-7 rounded-3xl bg-pitch-900 p-5 text-white shadow-card sm:p-7">
        <span class="inline-flex rounded-full bg-white/15 px-3 py-1.5 text-[10px] font-bold tracking-[.12em]">SIN CONVOCATORIA ABIERTA</span>
        <h2 class="display mt-4 text-2xl font-extrabold sm:text-3xl">${isAdmin ? "Abre la próxima convocatoria" : "Aún no hay convocatoria abierta"}</h2>
        <p class="mt-2 max-w-xl text-sm leading-6 text-white/65">${isAdmin ? "La fecha y la apertura se deciden manualmente desde Administración." : "El administrador anunciará la fecha del próximo partido cuando abra la convocatoria."}</p>
        ${isAdmin ? renderNewConvocationControl(null, history) : ""}
      </section>`;
  }
  const open = data.match.status === "open";
  const readOnly = data.match.readOnly === true;
  const readinessText = data.match.status === "cancelled"
    ? "Convocatoria cancelada"
    : data.validForMatch
    ? "Plantilla válida para jugar"
    : data.principalCount < 14
      ? `Faltan ${14 - data.principalCount} para llegar a 14`
      : data.principalCount === 15
        ? "Ajusta la lista a 14 o 16 para repartir los equipos por igual"
        : "Hay más de 16 principales";
  const principalList = data.lists.principal || [];
  const captainOptionsA = principalList.map((player, index) =>
    `<option value="${player.id}" ${index === 0 ? "selected" : ""}>${escapeHtml(player.alias)}</option>`,
  ).join("");
  const captainOptionsB = principalList.map((player, index) =>
    `<option value="${player.id}" ${index === 1 ? "selected" : ""}>${escapeHtml(player.alias)}</option>`,
  ).join("");
  const canReopen = !readOnly && data.match.canReopen && data.match.status !== "played" &&
    data.match.draft?.status !== "in_progress" && !isTeamsPublished(data.match.draft?.status);
  const canCancel = !readOnly && ["open", "closed"].includes(data.match.status) &&
    data.principalCount < 14 && !data.match.draft?.status;
  const cancelButton = canCancel
    ? `<button id="cancel-convocation" type="button" class="rounded-xl border border-red-300/50 px-4 py-2.5 text-xs font-bold text-red-100 transition hover:bg-red-400/15">Cancelar Convocatoria (Falta de Jugadores)</button>`
    : "";
  const adminControls = !isAdmin ? "" : readOnly
    ? `<div class="border-t border-white/10 bg-white/[.03] p-4 text-xs text-white/60 sm:px-7">Jornada histórica · vista de solo consulta.</div>`
    : open
    ? `<form id="close-convocation-form" class="grid gap-3 border-t border-white/10 bg-white/[.03] p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:px-7">
        ${data.validForMatch ? `<label class="text-xs font-semibold text-white/70">Capitán de BLANCOS<select name="captainA" required class="mt-1.5 w-full rounded-xl border border-white/15 bg-pitch-800 px-3 py-2.5 text-sm text-white">${captainOptionsA}</select></label><label class="text-xs font-semibold text-white/70">Capitán de COLOR<select name="captainB" required class="mt-1.5 w-full rounded-xl border border-white/15 bg-pitch-800 px-3 py-2.5 text-sm text-white">${captainOptionsB}</select></label>` : `<p class="text-xs text-white/60 sm:col-span-2">Se puede cerrar con cualquier recuento; el draft equilibrado solo se habilita con 14 o 16 principales.</p>`}
        <button class="rounded-xl bg-lime px-4 py-2.5 text-xs font-extrabold text-pitch-950">${data.validForMatch ? "Cerrar y guardar capitanes" : "Cerrar convocatoria"}</button>
      </form>${canCancel ? `<div class="border-t border-white/10 bg-white/[.03] px-4 pb-4 pt-3 sm:px-7">${cancelButton}</div>` : ""}`
    : data.match.status === "cancelled"
      ? `<div class="border-t border-white/10 bg-white/[.03] p-4 text-xs text-white/60 sm:px-7">Convocatoria cancelada: no se alcanzó el mínimo de 14 jugadores.</div>`
    : data.match.status === "played"
      ? `<div class="border-t border-white/10 bg-white/[.03] p-4 text-xs text-white/60 sm:px-7">Partido jugado; la convocatoria no se puede reabrir.</div>`
      : `<div class="flex flex-col gap-3 border-t border-white/10 bg-white/[.03] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-7"><span class="text-xs text-white/60">Convocatoria cerrada. ${data.match.draft?.status === "in_progress" ? `Capitanes designados; turno de ${teamLabel(data.match.draft.currentTurn)}.` : data.validForMatch ? "Revisa los capitanes en Partidos." : "No se puede iniciar el draft con este recuento."}</span><div class="flex flex-wrap gap-2">${canReopen ? `<button id="open-convocation" class="rounded-xl border border-white/20 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-white/10">Abrir convocatoria</button>` : ""}${cancelButton}</div></div>`;
  return `
    ${data.match.status === "cancelled" ? renderCancellationAlert(data.match) : ""}
    ${isAdmin ? renderConvocationHistorySelector(data, history) : ""}
    <section class="mb-7 overflow-hidden rounded-3xl bg-pitch-900 text-white shadow-card">
      <div class="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
        <div class="max-w-xl">
          <div class="flex flex-wrap items-center gap-2"><span class="rounded-full ${open ? "bg-lime/15 text-lime" : data.match.status === "cancelled" ? "bg-red-300 text-red-950" : "bg-white/15 text-white/70"} px-3 py-1.5 text-[10px] font-bold tracking-[.12em]">${data.match.status === "cancelled" ? "CONVOCATORIA CANCELADA" : data.match.status === "played" ? "PARTIDO JUGADO" : open ? "CONVOCATORIA ABIERTA" : "CONVOCATORIA CERRADA"}</span><span class="text-xs text-white/50">${formatConvocationDate(data.match)}</span>${!isAdmin && data.match.status !== "cancelled" ? `<span class="rounded-full bg-lime px-3 py-1.5 text-[10px] font-extrabold tracking-[.08em] text-pitch-950">PRÓXIMO PARTIDO: ${escapeHtml(formatMatchSchedule(data.match))}</span>` : ""}</div>
          <h2 class="display mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">${isAdmin ? readOnly ? "Historial de convocatoria" : "Control de convocatoria" : "¿Cuentas con nosotros?"}</h2>
          <p class="mt-1 text-sm text-white/60">${data.match.status === "cancelled" ? "No se registrará cobro ni puntuación para esta convocatoria." : isAdmin ? "La apertura y el cierre se realizan manualmente. Revisa las respuestas del grupo." : "Responde antes del día del partido a las 20:00 h para confirmar tu asistencia."}</p>
          <div class="mt-4 flex items-center gap-2 text-sm font-semibold ${data.validForMatch ? "text-lime" : "text-white/80"}"><span class="grid h-6 w-6 place-items-center rounded-full ${data.validForMatch ? "bg-lime/15 text-lime" : "bg-white/10"}">${data.validForMatch ? "✓" : "!"}</span>${readinessText}</div>
        </div>
        <div class="flex min-w-[210px] flex-col gap-3 rounded-2xl border border-white/10 bg-white/[.06] p-4">
           <div class="flex items-end justify-between"><span class="text-xs font-semibold text-white/60">Lista principal</span><span class="display text-3xl font-extrabold ${data.validForMatch ? "text-lime" : "text-white"}">${data.principalCount}<span class="text-base font-semibold text-white/40"> / 14 o 16</span></span></div>
          <div class="h-2 overflow-hidden rounded-full bg-white/10"><div class="h-full rounded-full ${data.validForMatch ? "bg-lime" : "bg-white/70"} transition-all" style="width:${Math.min(100, Math.round((data.principalCount / 16) * 100))}%"></div></div>
           <span class="text-[11px] text-white/45">${readOnly ? `${data.responseCount} respuestas guardadas` : `${data.responseCount} respuestas · ${data.totalPlayers - data.responseCount} sin responder`}</span>
            ${isAdmin ? renderNewConvocationControl(data.match, history) : ""}
        </div>
      </div>
      ${isAdmin ? adminControls : `<div class="flex flex-col gap-3 border-t border-white/10 bg-white/[.03] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <span class="text-xs font-semibold text-white/60">${data.currentResponse ? `Tu respuesta: ${data.currentResponse === "no_va" ? "NO VOY" : "SÍ VOY"}` : "Todavía no has respondido"}</span>
        <div class="flex gap-2">
          <button id="response-yes" ${!open ? "disabled" : ""} class="flex-1 rounded-xl ${data.currentResponse === "principal" || data.currentResponse === "suplente" ? "bg-lime text-pitch-950" : "bg-white text-pitch-950"} px-4 py-2.5 text-xs font-extrabold tracking-wide transition hover:bg-lime disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">SÍ VOY</button>
          <button id="response-no" ${!open ? "disabled" : ""} class="flex-1 rounded-xl ${data.currentResponse === "no_va" ? "bg-red-300 text-pitch-950" : "border border-white/20 bg-white/5 text-white"} px-4 py-2.5 text-xs font-extrabold tracking-wide transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">NO VOY</button>
        </div>
      </div>`}
      ${!isAdmin && open ? `<div class="border-t border-white/10 bg-white/[.03] p-4 sm:px-7">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-xs leading-5 text-white/60">¿Falta alguien en la lista? Añade a un suplente registrado o invita a uno nuevo.</p>
          <button id="add-substitute" type="button" class="w-full rounded-xl border border-lime/50 bg-lime px-4 py-3 text-sm font-extrabold text-pitch-950 transition hover:bg-lime/90 focus:outline-none focus:ring-2 focus:ring-lime focus:ring-offset-2 focus:ring-offset-pitch-900 sm:w-auto">+ Añadir Suplente</button>
        </div>
      </div>` : ""}
    </section>
    ${isAdmin && (readOnly || data.match.status === "played") ? renderConvocationHistorySummary(data.match) : ""}
     <div class="mb-3"><h2 class="display text-xl font-extrabold tracking-tight">${isAdmin ? "Listas del grupo" : "Respuestas del grupo"}</h2><p class="mt-1 text-xs text-ink/50">La lista se actualiza para todo el equipo.</p></div>
    <div class="grid gap-4 lg:grid-cols-3">
      ${listPanel("Lista principal", data.lists.principal, "bg-pitch-100 text-pitch-800", "✓", isAdmin && !readOnly, !readOnly, false, isAdmin && !readOnly && open)}
      ${listPanel("Lista de suplentes", data.lists.suplentes, "bg-amber-50 text-amber-700", "↗", isAdmin && !readOnly, !readOnly, !readOnly && open)}
      ${listPanel("Lista NO VAN", data.lists.no_va, "bg-stone-100 text-stone-500", "—", isAdmin && !readOnly, !readOnly)}
    </div>
    <details class="mt-4 rounded-2xl border border-ink/[.07] bg-white px-4 py-3">
       <summary class="cursor-pointer list-none text-sm font-semibold">${readOnly ? "Respuestas archivadas" : "Sin responder"} <span class="ml-1 rounded-full bg-paper px-2 py-0.5 text-xs text-ink/55">${readOnly ? data.responseCount : data.lists.pending.length}</span></summary>
      <p class="mt-2 text-xs text-ink/50">${readOnly ? "El historial conserva las respuestas registradas para esta jornada." : data.lists.pending.length ? data.lists.pending.map((user) => escapeHtml(user.alias)).join(" · ") : "Todo el grupo ha respondido."}</p>
    </details>`;
}

function matchLabel(match) {
  return `Partido del ${formatMatchSchedule(match)}`;
}

function matchStatusLabel(status) {
  return status === "cancelled"
    ? "cancelada"
    : status === "played"
      ? "jugado"
      : status === "closed"
        ? "convocatoria cerrada"
        : "convocatoria abierta";
}

function renderTeamCard(title, players, tone) {
  const rows = players.length
    ? players.map((player) => `<li class="flex items-center gap-2.5 border-t border-ink/[.06] px-4 py-2.5 first:border-0"><span class="grid h-7 w-7 place-items-center rounded-lg bg-white/80 text-[10px] font-bold text-ink/55" aria-hidden="true">⚽</span><span class="min-w-0 flex-1 truncate text-sm font-semibold">${escapeHtml(player.alias)}</span>${profileButton(player.id, player.alias)}</li>`).join("")
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
    ? users.find((player) => player.id === draft.captainA)?.alias || "Capitán de BLANCOS"
    : users.find((player) => player.id === draft.captainB)?.alias || "Capitán de COLOR";
  const available = match.available || [];
  const remaining = draft.remaining?.length || 0;
  const selectionHint = remaining === 3
    ? "Quedan tres: BLANCOS elige dos seguidos y el último jugador se asigna automáticamente a COLOR."
    : remaining === 2 && draft.currentTurn === "A"
      ? "Al capitán de BLANCOS le queda una elección antes de que el último jugador se asigne automáticamente a COLOR."
      : "Los capitanes alternan una elección cada uno.";
  const playerCards = available.length
    ? available.map((player) => `<button type="button" class="captain-draft-pick flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white px-4 py-3 text-left shadow-sm transition ${isMyTurn ? "hover:border-pitch-700 hover:bg-pitch-50 active:scale-[.99]" : "cursor-not-allowed opacity-55"}" data-match-id="${match.id}" data-player-id="${player.id}" data-final-pick="${remaining === 2 && draft.currentTurn === "A"}" ${isMyTurn ? "" : "disabled"}><span class="min-w-0 truncate text-sm font-semibold">${escapeHtml(player.alias)}</span><span class="shrink-0 rounded-lg bg-pitch-100 px-2.5 py-1.5 text-[11px] font-extrabold text-pitch-800">${isMyTurn ? "Elegir" : "En espera"}</span></button>`).join("")
    : `<p class="rounded-xl bg-white/70 p-4 text-sm text-ink/50">El draft se está completando.</p>`;
  return `<section class="my-4 rounded-2xl border border-pitch-700/15 bg-pitch-50 p-4 sm:p-5" aria-live="polite">
    <div class="flex flex-wrap items-start justify-between gap-3"><div><p class="text-[10px] font-extrabold uppercase tracking-[.13em] text-pitch-700">Elección de equipos</p><h3 class="display mt-1 text-xl font-extrabold">Eres capitán de ${teamLabel(myTeam)}</h3></div><span class="rounded-full ${isMyTurn ? "bg-pitch-900 text-white" : "bg-white text-ink/60"} px-3 py-1.5 text-xs font-extrabold">${isMyTurn ? "TU TURNO" : `Turno de ${escapeHtml(activeCaptainName)}`}</span></div>
    <p class="mt-2 text-sm leading-5 text-ink/60">${isMyTurn ? "Toca un jugador de la lista para sumarlo a tu equipo." : `${escapeHtml(activeCaptainName)} está eligiendo. La lista se actualizará automáticamente.`}</p>
    <div class="mt-3 grid gap-2 sm:grid-cols-2">${playerCards}</div>
    <p class="mt-3 text-[11px] leading-5 text-ink/45">${selectionHint} · ${remaining} ${remaining === 1 ? "jugador restante" : "jugadores restantes"}</p>
  </section>`;
}

function renderManualAssignmentPanel(match, principalPlayers, isSaved = false) {
  if (manualAssignmentMatchId !== match.id) {
    manualAssignmentMatchId = match.id;
    manualTeamAssignments = new Map();
    for (const player of match.teamA || []) manualTeamAssignments.set(Number(player.id), "A");
    for (const player of match.teamB || []) manualTeamAssignments.set(Number(player.id), "B");
  }

  const players = principalPlayers || [];
  const rosterIds = new Set(players.map((player) => Number(player.id)));
  for (const id of manualTeamAssignments.keys()) {
    if (!rosterIds.has(Number(id))) manualTeamAssignments.delete(id);
  }
  const half = players.length / 2;
  const teamAPlayers = players.filter((player) => manualTeamAssignments.get(Number(player.id)) === "A");
  const teamBPlayers = players.filter((player) => manualTeamAssignments.get(Number(player.id)) === "B");
  const unassigned = players.filter((player) => !manualTeamAssignments.has(Number(player.id)));
  const validRoster = players.length === 14 || players.length === 16;
  const canSave = validRoster && teamAPlayers.length === half && teamBPlayers.length === half && unassigned.length === 0;
  const rows = players.map((player) => {
    const assigned = manualTeamAssignments.get(Number(player.id));
    return `<li class="flex min-w-0 items-center gap-2 border-b border-ink/[.06] px-3 py-2.5 last:border-0 sm:gap-3">
      <span class="min-w-0 flex-1 truncate text-sm font-bold">@${escapeHtml(player.alias)}</span>
      <div class="flex shrink-0 gap-1">
        <button type="button" class="manual-team-choice rounded-lg border px-2 py-2 text-[8px] font-extrabold leading-none transition sm:px-2.5 sm:text-[10px] ${assigned === "A" ? "border-pitch-900 bg-pitch-900 text-white" : "border-pitch-900/15 bg-white text-pitch-900"}" data-player-id="${player.id}" data-team="A" aria-label="+ BLANCOS" aria-pressed="${assigned === "A"}">+ BLANCOS</button>
        <button type="button" class="manual-team-choice rounded-lg border px-2 py-2 text-[8px] font-extrabold leading-none transition sm:px-2.5 sm:text-[10px] ${assigned === "B" ? "border-amber-800 bg-amber-800 text-white" : "border-amber-800/15 bg-white text-amber-900"}" data-player-id="${player.id}" data-team="B" aria-label="+ COLOR" aria-pressed="${assigned === "B"}">+ COLOR</button>
        ${assigned ? `<button type="button" class="manual-team-choice rounded-lg border border-ink/10 bg-paper px-2 py-2 text-[8px] font-extrabold leading-none text-ink/65 transition sm:px-2.5 sm:text-[10px]" data-player-id="${player.id}" data-team="${assigned === "A" ? "B" : "A"}" aria-label="⇄ Cambiar de equipo">⇄ Cambiar</button>` : ""}
      </div>
    </li>`;
  }).join("");
  const previewRows = (team) => team.length
    ? `<ul class="divide-y divide-ink/[.06]">${team.map((player) => `<li class="truncate px-3 py-2 text-xs font-semibold">@${escapeHtml(player.alias)}</li>`).join("")}</ul>`
    : `<p class="px-3 py-4 text-xs text-ink/45">Sin jugadores asignados.</p>`;
  const validationMessage = canSave
    ? `<p class="text-xs font-semibold text-pitch-800">Reparto equilibrado: ${half} jugadores por equipo.</p>`
    : `<p class="text-xs font-semibold text-amber-800">${unassigned.length ? `Asigna los ${unassigned.length} jugador(es) pendientes. ` : ""}BLANCOS: ${teamAPlayers.length} / COLOR: ${teamBPlayers.length}; deben quedar ${half} por equipo.</p>`;

  return `<section class="mt-3 rounded-xl border border-ink/[.07] bg-white p-3 sm:p-4" aria-live="polite">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div><h4 class="text-sm font-extrabold">Asignación manual por Admin</h4><p class="mt-1 text-[11px] text-ink/50">Usa + BLANCOS o + COLOR para asignar; ⇄ Cambiar mueve al jugador al otro equipo.</p></div>
      <span class="rounded-full bg-paper px-3 py-1.5 text-[11px] font-extrabold">${isSaved ? "FORMACIÓN GUARDADA" : "SIN GUARDAR"}</span>
    </div>
    <div class="mb-3 grid grid-cols-2 gap-2">
      <section class="overflow-hidden rounded-xl border border-pitch-900/15 bg-pitch-50"><header class="flex items-center justify-between px-3 py-2"><b class="text-xs text-pitch-900">BLANCOS</b><span class="rounded-full bg-white px-2 py-1 text-[10px] font-extrabold">${teamAPlayers.length} / ${half || 0}</span></header>${previewRows(teamAPlayers)}</section>
      <section class="overflow-hidden rounded-xl border border-amber-800/15 bg-amber-50"><header class="flex items-center justify-between px-3 py-2"><b class="text-xs text-amber-900">COLOR</b><span class="rounded-full bg-white px-2 py-1 text-[10px] font-extrabold">${teamBPlayers.length} / ${half || 0}</span></header>${previewRows(teamBPlayers)}</section>
    </div>
    ${unassigned.length ? `<p class="mb-2 rounded-lg bg-paper px-3 py-2 text-[11px] text-ink/55">Sin asignar: ${unassigned.map((player) => `@${escapeHtml(player.alias)}`).join(" · ")}</p>` : ""}
    <ul class="overflow-hidden rounded-xl border border-ink/[.07]">${rows}</ul>
    <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      ${validationMessage}
      <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        ${isSaved ? `<button id="cancel-edit-manual-teams" type="button" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm font-bold text-ink/65 sm:w-auto">Cancelar</button>` : ""}
        <button id="save-manual-teams" type="button" ${canSave ? "" : "disabled"} class="w-full rounded-xl bg-pitch-900 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-pitch-800 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">Guardar Equipos y Notificar</button>
      </div>
    </div>
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
  if (manualAssignmentMatchId !== selected.id) {
    manualAssignmentMatchId = null;
    manualTeamAssignments = new Map();
    manualAssignmentMode = false;
  }
  const draft = selected.draft || {};
  const completed = isTeamsPublished(draft.status);
  const available = selected.available || [];
  const principalPlayers = selected.principalPlayers || [];
  const captainOptionsA = principalPlayers.map((player, index) =>
    `<option value="${player.id}" ${player.id === draft.captainA || (!draft.captainA && index === 0) ? "selected" : ""}>${escapeHtml(player.alias)}</option>`,
  ).join("");
  const captainOptionsB = principalPlayers.map((player, index) =>
    `<option value="${player.id}" ${player.id === draft.captainB || (!draft.captainB && index === 1) ? "selected" : ""}>${escapeHtml(player.alias)}</option>`,
  ).join("");
  const turnName = draft.currentTurn === "A"
    ? users.find((player) => player.id === draft.captainA)?.alias || "Capitán de BLANCOS"
    : users.find((player) => player.id === draft.captainB)?.alias || "Capitán de COLOR";
  const selection = `<label class="block"><span class="mb-1.5 block text-xs font-semibold text-ink/55">Seleccionar partido</span><select id="match-picker" class="w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-pitch-700">${matches.map((match) => `<option value="${match.id}" ${match.id === selected.id ? "selected" : ""}>${escapeHtml(matchLabel(match))} · ${matchStatusLabel(match.status)}</option>`).join("")}</select></label>`;
  let adminControls = "";
  const isCurrentOrFuture = selected.isCurrent ||
    (typeof selected.match_date === "string" && selected.match_date >= madridDateInputValue());
  const canAdminEditTeams = isAdmin && selected.status === "closed" && isCurrentOrFuture &&
    !selected.result && !selected.finance;
  const hasBalancedRoster = principalPlayers.length === 14 || principalPlayers.length === 16;
  const editTeamsButton = `<button id="edit-teams-manually" type="button" class="w-full rounded-xl bg-pitch-900 px-4 py-3 text-sm font-extrabold text-white sm:w-auto">Asignar / Editar Equipos manualmente</button>`;
  const teamNotificationBanner = isAdmin && selected.teamNotification
    ? `<p role="status" class="mt-3 rounded-xl bg-pitch-50 px-4 py-3 text-xs font-semibold text-pitch-900">${escapeHtml(teamNotificationMessage(selected.teamNotification))}</p>`
    : "";
  if (selected.draftValidationError) {
    const manualRepair = canAdminEditTeams && hasBalancedRoster
      ? manualAssignmentMode
        ? `<div class="mt-3 rounded-xl bg-white p-3"><p class="mb-3 text-sm font-bold">Corrección administrativa · al guardar, los capitanes quedan bloqueados</p>${renderManualAssignmentPanel(selected, principalPlayers, true)}</div>`
        : `<div class="mt-3">${editTeamsButton}</div>`
      : "";
    adminControls = `<div class="mt-4 rounded-xl border border-red-700/20 bg-red-50 p-4 text-sm text-red-800" role="alert"><p class="font-bold">Validación del draft bloqueada</p><p class="mt-1">${escapeHtml(selected.draftValidationError)} No se podrá confirmar el resultado ni aplicar el cobro hasta revisar la alineación.</p>${manualRepair}</div>`;
  } else if (isAdmin && selected.status === "closed" && draft.status === "in_progress") {
    adminControls = !canAdminEditTeams
      ? `<div class="mt-4 rounded-xl bg-paper p-4"><p class="text-sm font-bold">Elección en curso · Turno de ${teamLabel(draft.currentTurn)}</p><p class="mt-1 text-xs text-ink/50">${selected.result || selected.finance ? "No se permiten cambios después de registrar resultado o cobros." : "La edición manual queda limitada a partidos actuales o futuros todavía no jugados."}</p></div>`
      : manualAssignmentMode
        ? `<div class="mt-4 rounded-xl bg-paper p-4"><p class="mb-3 text-sm font-bold">Draft en curso · la asignación manual sustituirá el draft y bloqueará a los capitanes</p>${renderManualAssignmentPanel(selected, principalPlayers, true)}</div>`
        : `<div class="mt-4 flex flex-col gap-3 rounded-xl bg-paper p-4 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-sm font-bold">Elección en curso · Turno de ${teamLabel(draft.currentTurn)}</p><p class="mt-1 text-xs text-ink/50">Le toca a ${escapeHtml(turnName)}. Admin puede asignar los equipos manualmente en cualquier momento antes de jugar.</p></div>${hasBalancedRoster ? editTeamsButton : `<p class="text-xs text-amber-800">Se necesitan 14 o 16 principales para guardar equipos equilibrados.</p>`}</div>`;
  } else if (isAdmin && selected.status === "closed" && isTeamsPublished(draft.status)) {
    if (selected.result || selected.finance) {
      adminControls = `<p class="mt-4 rounded-xl bg-pitch-100 p-4 text-sm font-bold text-pitch-900">BLANCOS y COLOR publicados. No se pueden cambiar después de registrar el resultado o aplicar cobros.</p>`;
    } else if (!canAdminEditTeams) {
      adminControls = `<p class="mt-4 rounded-xl bg-paper p-4 text-sm text-ink/55">La edición manual está disponible en partidos actuales o futuros, antes del resultado y de los cobros.</p>`;
    } else if (!hasBalancedRoster) {
      adminControls = `<p class="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Se necesitan exactamente 14 o 16 jugadores principales para reasignar equipos equilibrados.</p>`;
    } else if (manualAssignmentMode) {
      adminControls = `<div class="mt-4 rounded-xl bg-paper p-4"><div class="mb-3 flex flex-wrap items-center justify-between gap-2"><p class="text-sm font-bold">Alineación publicada · edición exclusiva de Admin</p><span class="rounded-full bg-pitch-100 px-3 py-1.5 text-[11px] font-extrabold text-pitch-900">CAPITANES BLOQUEADOS</span></div>${renderManualAssignmentPanel(selected, principalPlayers, true)}</div>`;
    } else {
      adminControls = `<div class="mt-4 flex flex-col gap-3 rounded-xl bg-pitch-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-sm font-extrabold text-pitch-900">Equipos publicados · Capitanes bloqueados</p><p class="mt-1 text-xs leading-5 text-pitch-900/70">Admin puede reasignar la formación antes del resultado y los cobros.</p></div>${editTeamsButton}</div>`;
    }
  } else if (isAdmin && selected.status === "closed" && !draft.status) {
    const count = selected.principalCount ?? convocationData?.principalCount ?? 0;
    if (!canAdminEditTeams) {
      adminControls = `<p class="mt-4 rounded-xl bg-paper p-4 text-sm text-ink/55">La asignación manual está disponible tras cerrar la convocatoria, para jornadas actuales o futuras y antes del resultado/cobro.</p>`;
    } else if (count !== 14 && count !== 16) {
      adminControls = `<p class="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">${count === 15 ? "No se puede formar una alineación equilibrada con 15 jugadores. Ajusta la Lista Principal a 14 o 16." : `El reparto equilibrado requiere 14 o 16 confirmados; hay ${count}.`}</p>`;
    } else {
      const modeTabs = `<div class="grid grid-cols-2 gap-2" role="group" aria-label="Método de selección de equipos">
            <button type="button" class="draft-mode-choice rounded-xl px-3 py-2.5 text-xs font-extrabold transition ${manualAssignmentMode ? "border border-ink/10 bg-white text-ink/60" : "bg-pitch-900 text-white"}" data-manual-mode="false" aria-pressed="${!manualAssignmentMode}">Draft de capitanes</button>
            <button type="button" class="draft-mode-choice rounded-xl px-3 py-2.5 text-xs font-extrabold transition ${manualAssignmentMode ? "bg-pitch-900 text-white" : "border border-ink/10 bg-white text-ink/60"}" data-manual-mode="true" aria-pressed="${manualAssignmentMode}">Asignación Manual por Admin</button>
          </div>`;
      const modeContent = manualAssignmentMode
        ? renderManualAssignmentPanel(selected, principalPlayers)
        : `<form id="start-draft-form" data-match-id="${selected.id}" class="mt-3 rounded-xl bg-paper p-4"><p class="text-sm font-bold">Draft de capitanes · ${count} principales</p><p class="mt-1 text-xs text-ink/50">Designa los capitanes de BLANCOS y COLOR. COLOR empieza; al quedar tres jugadores, BLANCOS elige dos y el último se asigna automáticamente a COLOR para igualar las plantillas.</p><div class="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label class="text-xs font-semibold text-ink/55">Capitán de BLANCOS<select name="captainA" required class="mt-1 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm">${captainOptionsA}</select></label><label class="text-xs font-semibold text-ink/55">Capitán de COLOR<select name="captainB" required class="mt-1 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm">${captainOptionsB}</select></label><button class="rounded-xl bg-pitch-900 px-4 py-2.5 text-sm font-bold text-white">Iniciar draft</button></div></form>`;
      adminControls = `<div class="mt-4 rounded-xl bg-paper p-4"><p class="mb-3 text-sm font-bold">Convocatoria cerrada · ${count} principales</p>${modeTabs}${modeContent}</div>`;
    }
  } else if (selected.status === "cancelled") {
    adminControls = `<div class="mt-4 rounded-xl border border-red-700/20 bg-red-50 p-4 text-sm text-red-800" role="alert"><p class="font-bold">Convocatoria cancelada</p><p class="mt-1">No se registrará resultado, cobro ni puntuación para este evento.</p></div>`;
  } else if (selected.status === "open") {
    adminControls = `<p class="mt-4 rounded-xl bg-paper p-4 text-sm text-ink/55">El draft estará disponible después de cerrar la convocatoria.</p>`;
  } else if (isTeamsPublished(draft.status)) {
    adminControls = `<p class="mt-4 rounded-xl bg-pitch-100 p-4 text-sm font-bold text-pitch-900">BLANCOS y COLOR publicados.</p>`;
  }
  const scoreText = selected.result === "draw" ? "Empate" : selected.result ? `Victoria de ${teamLabel(selected.result)}` : "";
  const finance = selected.finance;
  const financeControl = isAdmin && showFinance
    ? selected.status === "cancelled"
      ? `<p class="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">Evento cancelado: no se permite configurar precio ni aplicar cobros.</p>`
      : finance
      ? `<div class="mt-4 grid gap-2 rounded-xl bg-white p-4 text-xs text-ink/60 sm:grid-cols-4"><span>Coste del partido: <b class="text-ink">${formatMoney(finance.pitch_cost)}</b></span><span>Precio por jugador: <b class="text-ink">${formatMoney(finance.fee_per_player)}</b></span><span>Recaudado (${finance.participants}): <b class="text-ink">${formatMoney(finance.total_collected)}</b></span><span>Saldo neto al bote: <b class="text-pitch-800">${formatMoney(finance.pot_added)}</b></span></div>`
      : `<p class="mt-4 rounded-xl bg-paper p-4 text-sm text-ink/55">${selected.total_match_price == null && selected.pitch_price == null || selected.player_price == null ? "Configura el coste total y el precio por jugador desde la pestaña Finanzas." : `Precio por jugador: ${formatMoney(selected.player_price)} · coste total: ${formatMoney(selected.total_match_price ?? selected.pitch_price)}.`} El descuento se aplicará automáticamente al guardar el resultado.</p>`
    : "";
  const canSaveResult = selected.status === "played" || Boolean(finance) ||
    (selected.player_price != null && (selected.total_match_price != null || selected.pitch_price != null));
  const resultControl = isAdmin && completed && selected.status !== "cancelled" && !selected.draftValidationError
    ? canSaveResult
      ? `<form id="match-result-form" data-match-id="${selected.id}" data-existing="${selected.status === "played"}" class="mt-4 grid gap-3 rounded-xl bg-white p-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div class="sm:col-span-2"><h3 class="font-bold">Registrar Resultado del Partido</h3><p class="mt-1 text-xs text-ink/50">${selected.status === "played" ? "Si corriges el resultado, se sustituyen los puntos anteriores de este partido." : "La clasificación se actualizará al guardar el resultado."}</p></div>
          <label class="block"><span class="mb-1.5 block text-xs font-semibold text-ink/55">Resultado final</span><select name="result" required class="w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm"><option value="A" ${selected.result === "A" ? "selected" : ""}>Ganó BLANCOS</option><option value="B" ${selected.result === "B" ? "selected" : ""}>Ganó COLOR</option><option value="draw" ${selected.result === "draw" ? "selected" : ""}>Empate</option></select></label>
          <button class="rounded-xl bg-lime px-4 py-2.5 text-sm font-extrabold text-pitch-950">${selected.status === "played" ? "Actualizar resultado y puntos" : finance ? "Guardar resultado y puntos" : "Guardar resultado y cobrar"}</button>
          ${selected.status !== "played" && !finance ? `<p class="text-xs text-ink/45 sm:col-span-2">Se descontará ${formatMoney(selected.player_price)} a cada participante. El sobrante positivo se sumará al Bote; un déficit no lo modifica automáticamente.</p>` : ""}
        </form>`
      : `<p class="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Antes de guardar el resultado, define el Precio por Partido en Finanzas.</p>`
    : selected.status === "played" ? `<p class="mt-4 rounded-xl bg-lime/20 p-4 text-sm font-bold text-pitch-900">Resultado: ${scoreText}. Puntuación guardada: asistencia +1, victoria +3 extra, empate +1 extra.</p>` : "";
  return `<section id="match-teams" class="mb-7 scroll-mt-4 rounded-3xl border border-ink/[.07] bg-white p-5 shadow-sm sm:p-6"><div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p class="text-xs font-bold uppercase tracking-[.12em] text-pitch-700">Partidos</p><h2 class="display mt-1 text-2xl font-extrabold">${escapeHtml(matchLabel(selected))}</h2><p class="mt-1 text-xs text-ink/50">${selected.status === "cancelled" ? "Convocatoria cancelada" : selected.status === "played" ? "Partido jugado" : selected.status === "closed" ? "Convocatoria cerrada" : "Convocatoria abierta"}</p></div><div class="w-full sm:max-w-xs">${selection}</div></div><div class="grid gap-3 sm:grid-cols-2">${renderTeamCard("BLANCOS", selected.teamA || [], "bg-pitch-100 text-pitch-900")}${renderTeamCard("COLOR", selected.teamB || [], "bg-amber-50 text-amber-900")}</div>${isAdmin ? adminControls : renderCaptainDraft(selected)}${teamNotificationBanner}${financeControl}${resultControl}</section>`;
}

function matchPricePreviewText(totalRaw, playerRaw, playerCount) {
  const count = Math.max(0, Number(playerCount) || 0);
  const total = Number(totalRaw);
  const perPlayer = Number(playerRaw);
  if (totalRaw === "" || playerRaw === "" || !Number.isFinite(total) || !Number.isFinite(perPlayer) ||
      total < 0 || perPlayer < 0) {
    return "Introduce ambos precios para ver el cálculo.";
  }
  const totalCents = Math.round(total * 100);
  const playerCents = Math.round(perPlayer * 100);
  const collectedCents = playerCents * count;
  const differenceCents = collectedCents - totalCents;
  const differenceText = differenceCents > 0
    ? `Aportación al Bote: +${formatMoney(differenceCents / 100)}`
    : differenceCents < 0
      ? `Déficit frente al coste: ${formatMoney(Math.abs(differenceCents) / 100)} (no se descontará automáticamente del Bote)`
      : "Aportación al Bote: 0,00 €";
  return `${count} ${count === 1 ? "jugador" : "jugadores"} × ${formatMoney(playerCents / 100)} = ${formatMoney(collectedCents / 100)} recaudados. Coste del partido: ${formatMoney(totalCents / 100)}. ${differenceText}.`;
}

function renderMatchFinanceControl(matchesData, matchCharges = []) {
  const matches = matchesData.matches || [];
  if (!matches.length) return "";
  let selected = matches.find((match) => match.id === Number(selectedMatchId));
  if (!selected) selected = matches.find((match) => isTeamsPublished(match.draft?.status) && !match.finance) || matches[0];
  selectedMatchId = selected.id;
  const options = matches.map((match) =>
    `<option value="${match.id}" ${match.id === selected.id ? "selected" : ""}>${escapeHtml(matchLabel(match))} · ${matchStatusLabel(match.status)}</option>`,
  ).join("");
  const action = selected.finance
    ? `<div class="grid gap-2 rounded-xl bg-paper p-4 text-xs text-ink/60 sm:grid-cols-4"><span>Coste del partido: <b class="text-ink">${formatMoney(selected.finance.pitch_cost)}</b></span><span>Precio por jugador: <b class="text-ink">${formatMoney(selected.finance.fee_per_player)}</b></span><span>Recaudado (${selected.finance.participants}): <b class="text-ink">${formatMoney(selected.finance.total_collected)}</b></span><span>Saldo neto al bote: <b class="text-pitch-800">${formatMoney(selected.finance.pot_added)}</b></span></div>`
    : selected.status === "cancelled"
      ? `<div class="rounded-xl bg-red-50 p-4 text-sm text-red-800">Evento cancelado. No se pueden aplicar cobros.</div>`
    : selected.status === "played"
      ? `<div class="rounded-xl bg-paper p-4 text-sm text-ink/55">Este partido ya tiene resultado, pero no conserva un cobro automático histórico.</div>`
      : `<form id="match-price-form" data-match-id="${selected.id}" data-principal-count="${selected.principalCount || 0}" class="grid gap-3 sm:grid-cols-2"><label><span class="mb-1.5 block text-xs font-semibold text-ink/55">Precio total del partido · pista/reserva (€)</span><input name="price_total" type="number" min="0" step="0.01" required value="${selected.total_match_price ?? selected.pitch_price ?? ""}" placeholder="Ej. 40,00" class="w-full rounded-xl border border-ink/10 px-3 py-2.5 text-sm"/></label><label><span class="mb-1.5 block text-xs font-semibold text-ink/55">Precio del partido por jugador (€)</span><input name="price_per_player" type="number" min="0" step="0.01" required value="${selected.player_price ?? ""}" placeholder="Ej. 3,00" class="w-full rounded-xl border border-ink/10 px-3 py-2.5 text-sm"/></label><p data-match-price-preview class="rounded-xl bg-lime/20 p-3 text-xs font-semibold leading-5 text-pitch-900 sm:col-span-2">${matchPricePreviewText(selected.total_match_price ?? selected.pitch_price ?? "", selected.player_price ?? "", selected.principalCount || 0)}</p><button class="rounded-xl bg-pitch-900 px-4 py-2.5 text-sm font-bold text-white sm:col-span-2 sm:justify-self-start">${selected.total_match_price == null && selected.pitch_price == null ? "Guardar precios" : "Actualizar precios"}</button><p class="text-xs text-ink/45 sm:col-span-2">El cobro descuenta el precio fijo configurado a cada jugador de los equipos. El sobrante positivo se suma al Bote; un déficit se muestra, pero no lo modifica automáticamente.</p></form>`;
  const historyCards = matchCharges.map((charge) => {
    const amountToPot = Number(charge.pot_contribution ?? charge.pot_added ?? 0);
    return `<article class="grid gap-2 py-3 first:pt-0 last:pb-0"><div class="flex items-start justify-between gap-3"><div><p class="text-sm font-bold">${escapeHtml(matchLabel({ match_date: charge.match_date, match_time: charge.match_time }))}</p><p class="mt-1 text-[11px] text-ink/45">${charge.participants} participantes · ${escapeHtml(String(charge.created_at || ""))}</p></div><span class="shrink-0 text-sm font-extrabold text-pitch-800">${formatMoney(charge.total_collected)}</span></div><p class="text-xs leading-5 text-ink/60">Precio por jugador: ${formatMoney(charge.player_price ?? charge.fee_per_player)} · coste: ${formatMoney(charge.total_match_price ?? charge.pitch_cost)} · saldo neto del Bote: ${formatMoney(amountToPot)}</p></article>`;
  }).join("");
  const historyRows = matchCharges.map((charge) => {
    const amountToPot = Number(charge.pot_contribution ?? charge.pot_added ?? 0);
    return `<tr><td class="px-4 py-3 text-sm font-semibold">${escapeHtml(matchLabel({ match_date: charge.match_date, match_time: charge.match_time }))}</td><td class="px-4 py-3 text-right text-sm">${formatMoney(charge.player_price ?? charge.fee_per_player)}</td><td class="px-4 py-3 text-right text-sm">${formatMoney(charge.total_match_price ?? charge.pitch_cost)}</td><td class="px-4 py-3 text-right text-sm">${charge.participants}</td><td class="px-4 py-3 text-right text-sm font-semibold">${formatMoney(charge.total_collected)}</td><td class="px-4 py-3 text-right text-sm font-bold ${amountToPot < 0 ? "text-red-700" : "text-pitch-800"}">${formatMoney(amountToPot)}</td></tr>`;
  }).join("");
  const history = `<div class="mt-5 overflow-hidden rounded-xl border border-ink/[.07]"><div class="border-b border-ink/[.07] px-4 py-3"><h4 class="text-sm font-bold">Historial de partidos cobrados</h4><p class="mt-1 text-xs text-ink/45">Desglose de cuota, recaudación, coste y movimiento neto del Bote.</p></div>${matchCharges.length ? `<div class="divide-y divide-ink/[.06] px-4 sm:hidden">${historyCards}</div><div class="hidden overflow-x-auto sm:block"><table class="w-full min-w-[820px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-4 py-3">Partido</th><th class="px-4 py-3 text-right">€/jugador</th><th class="px-4 py-3 text-right">Coste</th><th class="px-4 py-3 text-right">Jugadores</th><th class="px-4 py-3 text-right">Recaudado</th><th class="px-4 py-3 text-right">Bote neto</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${historyRows}</tbody></table></div>` : `<p class="px-4 py-6 text-center text-xs text-ink/45">Aún no hay partidos cobrados.</p>`}</div>`;
  return `<section class="mb-5 rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm"><div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 class="font-bold">Precio del partido y cobro automático</h3><p class="mt-1 text-xs text-ink/50">La cuota fija se descuenta una sola vez al guardar el primer resultado.</p></div><label class="text-xs font-semibold text-ink/55 sm:w-64">Partido<select id="finance-match-picker" class="mt-1 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm">${options}</select></label></div>${action}${history}</section>`;
}

function renderStandingsBoard(data) {
  const rows = data.standings || [];
  return `<section class="mb-7 overflow-hidden rounded-3xl border border-ink/[.07] bg-white shadow-sm"><div class="flex flex-col gap-3 border-b border-ink/[.07] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><p class="text-xs font-bold uppercase tracking-[.12em] text-pitch-700">Temporada</p><h2 class="display mt-1 text-2xl font-extrabold">Clasificación</h2><p class="mt-1 text-xs text-ink/50">Puntos globales por asistencia y resultado.</p></div><div class="rounded-2xl bg-lime/35 px-4 py-3"><p class="text-[10px] font-bold uppercase tracking-[.12em] text-pitch-900/60">Bote acumulado</p><p data-pot-balance class="display text-xl font-extrabold text-pitch-900">${formatMoney(data.pot)}</p></div></div><div class="overflow-x-auto"><table class="w-full min-w-[600px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-5 py-3">#</th><th class="px-4 py-3">Jugador</th><th class="px-4 py-3">Puntos</th><th class="px-4 py-3">PJ</th><th class="px-4 py-3">V-E-D</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${rows.length ? rows.map((player, index) => `<tr><td class="px-5 py-3 text-sm font-bold text-pitch-700">${index + 1}</td><td class="px-4 py-2"><div class="flex items-center gap-1"><span class="text-sm font-semibold">${escapeHtml(player.alias)}</span>${profileButton(player.id, player.alias)}</div></td><td class="px-4 py-3"><span class="rounded-full bg-pitch-100 px-2.5 py-1 text-xs font-extrabold text-pitch-900">${player.points}</span></td><td class="px-4 py-3 text-sm text-ink/55">${player.matches_played}</td><td class="px-4 py-3 text-sm text-ink/55">${player.wins}-${player.draws}-${player.losses}</td></tr>`).join("") : `<tr><td colspan="5" class="px-5 py-8 text-center text-sm text-ink/45">La clasificación empieza con el primer resultado.</td></tr>`}</tbody></table></div></section>`;
}

function renderStandingsAdjustmentPanel(data, adjustments = []) {
  const players = data.standings || [];
  const selected = players[0];
  const fields = [
    ["points", "Puntos totales"],
    ["matches_played", "Partidos jugados"],
    ["wins", "Ganados"],
    ["draws", "Empatados"],
    ["losses", "Perdidos"],
  ];
  const options = players.map((player) =>
    `<option value="${player.id}" ${player.id === selected?.id ? "selected" : ""}>${escapeHtml(player.alias)}</option>`,
  ).join("");
  const inputs = fields.map(([name, label]) => {
    const value = selected?.[name] ?? 0;
    const min = name === "points" ? "" : 'min="0"';
    return `<label class="block text-xs font-semibold text-ink/60">${label}<input name="${name}" type="number" step="1" ${min} required value="${value}" class="mt-1.5 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink"/></label>`;
  }).join("");
  const signed = (value) => `${value > 0 ? "+" : ""}${value}`;
  const history = adjustments.length
    ? `<div class="mt-5"><h4 class="text-sm font-bold">Últimos ajustes</h4><ul class="mt-2 divide-y divide-ink/[.06]">${adjustments.slice(0, 20).map((item) => `<li class="py-3"><div class="flex flex-wrap items-center justify-between gap-2"><span class="text-sm font-bold">@${escapeHtml(item.player_alias)}</span><span class="text-[11px] text-ink/45">${escapeHtml(item.created_at)} · Admin @${escapeHtml(item.admin_alias)}</span></div><p class="mt-1 text-xs leading-5 text-ink/60">${escapeHtml(item.reason)}</p><p class="mt-1 text-[11px] font-semibold text-pitch-800">Δ ${signed(item.points_delta)} puntos · ${signed(item.matches_played_delta)} PJ · ${signed(item.wins_delta)} G · ${signed(item.draws_delta)} E · ${signed(item.losses_delta)} P</p></li>`).join("")}</ul></div>`
    : `<p class="mt-5 rounded-xl bg-paper p-3 text-xs text-ink/50">Aún no hay ajustes manuales registrados.</p>`;
  return `<section class="mb-7 rounded-3xl border border-ink/[.07] bg-white p-5 shadow-sm sm:p-6"><details class="group"><summary class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl bg-pitch-900 px-4 py-3.5 text-sm font-extrabold text-white"><span>Modificar Clasificación</span><span class="text-lime group-open:rotate-45" aria-hidden="true">＋</span></summary><div class="pt-4"><p class="mb-4 text-xs leading-5 text-ink/55">Define los nuevos totales. Se guarda solo la diferencia con el cálculo actual; los resultados e historiales de partidos no se modifican. Cada ajuste queda registrado con motivo. Partidos jugados debe coincidir con ganados + empatados + perdidos; se permiten puntos negativos.</p>${players.length ? `<form id="standings-adjustment-form" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label class="block text-xs font-semibold text-ink/60 sm:col-span-2 lg:col-span-1">Jugador · alias<select name="user_id" required class="mt-1.5 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink">${options}</select></label>${inputs}<label class="block text-xs font-semibold text-ink/60 sm:col-span-2 lg:col-span-3">Motivo del ajuste<textarea name="reason" required maxlength="500" rows="2" placeholder="Ej. Ajuste manual de puntos por sanción/corrección" class="mt-1.5 w-full resize-y rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal text-ink"></textarea></label><div class="sm:col-span-2 lg:col-span-3"><button type="submit" class="w-full rounded-xl bg-lime px-4 py-3 text-sm font-extrabold text-pitch-950 transition hover:bg-lime/80 sm:w-auto">Guardar ajuste manual</button><span class="ml-3 text-[11px] text-ink/45">Solo Admin puede realizar esta acción.</span></div></form>` : `<p class="rounded-xl bg-paper p-4 text-sm text-ink/55">No hay jugadores activos para modificar.</p>`}${history}</div></details></section>`;
}

function renderApprovalPanel(pending) {
  const cards = pending.length
    ? pending.map((user) => {
      const invitedSubstitute = user.substitute_invitation === true;
      const invitationNote = invitedSubstitute
        ? `<p class="mt-1 text-[11px] font-semibold leading-4 text-amber-800">Nuevo suplente · invitado por @${escapeHtml(user.invited_by_alias || "jugador")}${user.invitation_match_date ? ` · Partido ${escapeHtml(user.invitation_match_date)}` : ""}</p>`
        : "";
      return `<form class="pending-approval-card grid gap-3 border-t border-ink/[.06] p-4 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto] sm:items-end" data-user-id="${user.id}">
        <div><p class="font-bold">${escapeHtml(`${user.first_name} ${user.last_name}`)}</p><p class="mt-0.5 text-xs text-ink/45">@${escapeHtml(user.alias)}</p>${invitationNote}</div>
        ${invitedSubstitute
          ? `<div><span class="mb-1 block text-[11px] font-semibold text-ink/55">Rol base</span><p class="rounded-lg bg-paper px-2.5 py-2 text-sm font-semibold">Suplente</p><input type="hidden" name="base_role" value="suplente"/></div>`
          : `<label><span class="mb-1 block text-[11px] font-semibold text-ink/55">Rol base</span><select name="base_role" class="w-full rounded-lg border border-ink/10 bg-white px-2.5 py-2 text-sm"><option value="principal">Principal</option><option value="suplente">Suplente</option></select></label>`}
        <label><span class="mb-1 block text-[11px] font-semibold text-ink/55">Posición fija</span><input name="ranking_position" type="number" min="1" step="1" required value="${Number(user.ranking_position) || ""}" placeholder="1" class="w-full rounded-lg border border-ink/10 px-2.5 py-2 text-sm"/></label>
        <label><span class="mb-1 block text-[11px] font-semibold text-ink/55">Saldo inicial (€)</span><input name="balance" type="number" step="0.01" required value="0" ${invitedSubstitute ? "readonly" : ""} class="w-full rounded-lg border border-ink/10 px-2.5 py-2 text-sm"/></label>
        <button class="rounded-xl bg-pitch-900 px-4 py-2.5 text-xs font-bold text-white">${invitedSubstitute ? "Aprobar y añadir" : "Aprobar"}</button>
      </form>`;
    }).join("")
    : `<p class="px-5 py-7 text-center text-sm text-ink/45">No hay solicitudes pendientes de revisión.</p>`;
  return `<section class="mb-7 overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm"><header class="flex items-center justify-between px-5 py-4"><div><h2 class="font-bold">Aprobaciones pendientes</h2><p class="mt-1 text-xs text-ink/45">Revisa las nuevas cuentas y solicitudes de suplentes antes de activarlas.</p></div><span class="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">${pending.length}</span></header>${cards}</section>`;
}

function renderPlayerManagementPanel(players, pending) {
  const rows = players.map((user) => `<tr class="hover:bg-paper/50" data-player-search="${escapeHtml(`${user.name} ${user.alias}`.toLocaleLowerCase("es"))}">
    <td class="px-4 py-3 sm:px-5"><div class="font-semibold">${escapeHtml(user.name)}</div><div class="mt-0.5 flex items-center gap-1 text-xs text-ink/45"><span>@${escapeHtml(user.alias)}</span>${profileButton(user.id, user.alias)}</div></td>
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
  const potTransactions = data.potTransactions || [];
  const playerOptions = players.map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join("");
  const potMovementLabel = (movementType) => ({
    match_remainder: "Remanente automático de partido",
    match_adjustment: "Corrección de partido",
    manual_income: "Ingreso manual",
    manual_expense: "Gasto manual",
    opening_balance: "Saldo previo del bote",
  }[movementType] || "Movimiento del bote");
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
  const potMovementCards = potTransactions.map((movement) => `<article class="grid gap-2 py-3 first:pt-0 last:pb-0"><div class="flex items-start justify-between gap-3"><div><p class="text-xs text-ink/45">${escapeHtml(String(movement.created_at))}</p><p class="mt-1 text-sm font-bold">${escapeHtml(potMovementLabel(movement.movement_type))}</p></div><span class="shrink-0 text-sm font-extrabold ${Number(movement.amount) < 0 ? "text-red-700" : "text-pitch-800"}">${formatMoney(movement.amount)}</span></div><p class="text-xs leading-5 text-ink/60">${escapeHtml(movement.concept)}</p><div class="flex flex-wrap justify-between gap-2 text-[11px] text-ink/45"><span>Saldo del bote: <b class="text-ink/70">${formatMoney(movement.balance_after)}</b></span><span>${movement.match_id ? `Partido #${movement.match_id}` : movement.created_by_alias ? `Admin @${escapeHtml(movement.created_by_alias)}` : ""}</span></div></article>`).join("");
  const potMovementRows = potTransactions.map((movement) => `<tr><td class="px-4 py-3 text-xs text-ink/50">${escapeHtml(String(movement.created_at))}</td><td class="px-4 py-3 text-xs font-semibold">${escapeHtml(potMovementLabel(movement.movement_type))}</td><td class="px-4 py-3 text-sm text-ink/65">${escapeHtml(movement.concept)}${movement.match_id ? `<span class="mt-1 block text-[10px] text-ink/40">Partido #${movement.match_id}</span>` : ""}</td><td class="px-4 py-3 text-right text-sm font-bold ${Number(movement.amount) < 0 ? "text-red-700" : "text-pitch-800"}">${formatMoney(movement.amount)}</td><td class="px-4 py-3 text-right text-sm font-semibold">${formatMoney(movement.balance_after)}</td></tr>`).join("");
  return `<div class="mb-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><div><p class="text-xs font-bold uppercase tracking-[.12em] text-pitch-700">Gestión financiera</p><h2 class="display mt-1 text-2xl font-extrabold">Saldos y movimientos</h2><p class="mt-1 text-sm text-ink/50">Los ajustes quedan anotados en el historial de cada jugador.</p></div><div class="rounded-2xl bg-lime/35 px-5 py-3"><p class="text-[10px] font-bold uppercase tracking-[.12em] text-pitch-900/60">Bote acumulado</p><p data-pot-balance class="display text-xl font-extrabold text-pitch-900">${formatMoney(data.pot)}</p></div></div>
    ${renderMatchFinanceControl(matchesData, data.matchCharges || [])}
    <section class="mb-5 rounded-2xl border border-pitch-700/15 bg-pitch-50/60 p-4 shadow-sm sm:p-5">
      <div class="mb-4"><p class="text-xs font-bold uppercase tracking-[.12em] text-pitch-700">Bote del grupo</p><h3 class="mt-1 font-bold">Ajustes Manuales del Bote General</h3><p class="mt-1 text-xs leading-5 text-ink/55">Registra ingresos o gastos directamente en el fondo común. Estos movimientos no modifican el saldo de ningún jugador.</p></div>
      <form id="pot-adjustment-form" class="grid gap-3 sm:grid-cols-[1.5fr_1fr_1fr_auto] sm:items-end">
        <label class="text-xs font-semibold text-ink/60">Concepto / Descripción<input name="concept" required maxlength="160" placeholder="Ej. Compra de balones" class="mt-1.5 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm"/></label>
        <label class="text-xs font-semibold text-ink/60">Importe (€)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="Ej. 25,00" class="mt-1.5 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm"/></label>
        <label class="text-xs font-semibold text-ink/60">Tipo de operación<select name="operation" required class="mt-1.5 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm"><option value="income">Ingreso / Sumar</option><option value="expense">Gasto / Restar</option></select></label>
        <button type="submit" class="rounded-xl bg-pitch-900 px-4 py-2.5 text-sm font-bold text-white">Registrar ajuste en el Bote</button>
        <p class="text-[11px] text-ink/45 sm:col-span-4">Introduce el importe como positivo; el tipo elegido determina si se suma o se resta.</p>
      </form>
    </section>
    <form id="balance-adjust-form" class="mb-5 grid gap-3 rounded-2xl border border-ink/[.07] bg-white p-4 shadow-sm sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end">
      <label class="text-xs font-semibold text-ink/60">Jugador<select name="user_id" required class="mt-1.5 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm">${playerOptions}</select></label>
      <label class="text-xs font-semibold text-ink/60">Ajuste (€)<input name="amount" type="number" step="0.01" required placeholder="+10 o -5" class="mt-1.5 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm"/></label>
      <label class="text-xs font-semibold text-ink/60">Concepto<input name="concept" required maxlength="120" placeholder="Pago, devolución, corrección…" class="mt-1.5 block w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm"/></label>
      <button ${players.length ? "" : "disabled"} class="rounded-xl bg-pitch-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">Registrar ajuste</button>
      <p class="text-[11px] text-ink/45 sm:col-span-4">Un importe positivo suma saldo; uno negativo lo descuenta. El cobro de pista de cada partido se gestiona arriba.</p>
    </form>
    <section class="mb-5 overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm"><header class="flex items-center justify-between border-b border-ink/[.07] px-4 py-3.5"><div><h3 class="font-bold">Saldos de jugadores</h3><p class="mt-0.5 text-xs text-ink/45">${players.length} cuentas activas; Admin no tiene saldo de jugador.</p></div></header>
      ${players.length ? `<div class="border-b border-ink/[.06] p-4"><label class="block"><span class="sr-only">Buscar en saldos por nombre o alias</span><input id="balance-player-search" type="search" placeholder="Buscar por nombre, apellidos o alias…" class="w-full rounded-xl border border-ink/10 px-4 py-2.5 text-sm outline-none focus:border-pitch-700 sm:max-w-sm"/></label></div><div class="overflow-x-auto"><table class="w-full min-w-[420px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-4 py-3">Jugador</th><th class="px-4 py-3">Rol</th><th class="px-4 py-3 text-right">Saldo</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${players.map((player) => `<tr data-balance-player-search="${escapeHtml(`${player.name} ${player.alias || ""}`.toLocaleLowerCase("es"))}"><td class="px-4 py-3 text-sm font-semibold">${escapeHtml(player.name)} (${escapeHtml(player.alias || "—")})</td><td class="px-4 py-3 text-xs text-ink/50">${player.base_role === "principal" ? "Principal" : "Suplente"}</td><td class="px-4 py-3 text-right text-sm font-bold ${player.balance < 0 ? "text-red-700" : ""}">${formatMoney(player.balance)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="px-4 py-8 text-center text-sm text-ink/45">No hay jugadores activos.</p>`}
    </section>
    <section class="overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm"><header class="border-b border-ink/[.07] px-4 py-3.5"><h3 class="font-bold">Historial financiero</h3><p class="mt-0.5 text-xs text-ink/45">Hasta 100 movimientos. Los cargos ajustables conservan su asiento original.</p></header>
      ${transactions.length ? `<div class="divide-y divide-ink/[.06] p-4 sm:hidden">${transactionCards}</div><div class="hidden overflow-x-auto sm:block"><table class="w-full min-w-[920px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-4 py-3">Fecha</th><th class="px-4 py-3">Jugador</th><th class="px-4 py-3">Concepto / estado</th><th class="px-4 py-3 text-right">Importe</th><th class="px-4 py-3">Acción</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${transactionRows}</tbody></table></div>` : `<p class="px-4 py-8 text-center text-sm text-ink/45">Aún no hay movimientos financieros.</p>`}
    </section>
    <section id="pot-movement-history" class="mt-5 overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm"><header class="border-b border-ink/[.07] px-4 py-3.5"><h3 class="font-bold">Movimientos del Bote General</h3><p class="mt-0.5 text-xs text-ink/45">Historial de remanentes de partidos, correcciones e ingresos y gastos manuales, con el saldo resultante.</p></header>
      ${potTransactions.length ? `<div class="divide-y divide-ink/[.06] p-4 sm:hidden">${potMovementCards}</div><div class="hidden overflow-x-auto sm:block"><table class="w-full min-w-[760px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-4 py-3">Fecha</th><th class="px-4 py-3">Tipo</th><th class="px-4 py-3">Concepto</th><th class="px-4 py-3 text-right">Importe</th><th class="px-4 py-3 text-right">Saldo resultante</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${potMovementRows}</tbody></table></div>` : `<p class="px-4 py-8 text-center text-sm text-ink/45">Todavía no hay movimientos del bote.</p>`}
    </section>`;
}

function renderPotMovementHistory(potTransactions) {
  const label = (type) => ({
    match_remainder: "Remanente automático de partido",
    match_adjustment: "Corrección de partido",
    manual_income: "Ingreso manual",
    manual_expense: "Gasto manual",
    opening_balance: "Saldo previo del bote",
  }[type] || "Movimiento del bote");
  const cards = potTransactions.map((movement) => `<article class="grid gap-2 py-3 first:pt-0 last:pb-0"><div class="flex items-start justify-between gap-3"><div><p class="text-xs text-ink/45">${escapeHtml(String(movement.created_at))}</p><p class="mt-1 text-sm font-bold">${escapeHtml(label(movement.movement_type))}</p></div><span class="shrink-0 text-sm font-extrabold ${Number(movement.amount) < 0 ? "text-red-700" : "text-pitch-800"}">${formatMoney(movement.amount)}</span></div><p class="text-xs leading-5 text-ink/60">${escapeHtml(movement.concept)}</p><div class="flex flex-wrap justify-between gap-2 text-[11px] text-ink/45"><span>Saldo del bote: <b class="text-ink/70">${formatMoney(movement.balance_after)}</b></span><span>${movement.match_id ? `Partido #${movement.match_id}` : movement.created_by_alias ? `Admin @${escapeHtml(movement.created_by_alias)}` : ""}</span></div></article>`).join("");
  const rows = potTransactions.map((movement) => `<tr><td class="px-4 py-3 text-xs text-ink/50">${escapeHtml(String(movement.created_at))}</td><td class="px-4 py-3 text-xs font-semibold">${escapeHtml(label(movement.movement_type))}</td><td class="px-4 py-3 text-sm text-ink/65">${escapeHtml(movement.concept)}${movement.match_id ? `<span class="mt-1 block text-[10px] text-ink/40">Partido #${movement.match_id}</span>` : ""}</td><td class="px-4 py-3 text-right text-sm font-bold ${Number(movement.amount) < 0 ? "text-red-700" : "text-pitch-800"}">${formatMoney(movement.amount)}</td><td class="px-4 py-3 text-right text-sm font-semibold">${formatMoney(movement.balance_after)}</td></tr>`).join("");
  return `<section id="pot-movement-history" class="mt-5 overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm"><header class="border-b border-ink/[.07] px-4 py-3.5"><h3 class="font-bold">Movimientos del Bote General</h3><p class="mt-0.5 text-xs text-ink/45">Historial de remanentes de partidos, correcciones e ingresos y gastos manuales, con el saldo resultante.</p></header>
    ${potTransactions.length ? `<div class="divide-y divide-ink/[.06] p-4 sm:hidden">${cards}</div><div class="hidden overflow-x-auto sm:block"><table class="w-full min-w-[760px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-4 py-3">Fecha</th><th class="px-4 py-3">Tipo</th><th class="px-4 py-3">Concepto</th><th class="px-4 py-3 text-right">Importe</th><th class="px-4 py-3 text-right">Saldo resultante</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${rows}</tbody></table></div>` : `<p class="px-4 py-8 text-center text-sm text-ink/45">Todavía no hay movimientos del bote.</p>`}
  </section>`;
}

function renderNotificationPanel(data, players, config, status) {
  const campaigns = status.campaigns || {};
  const message = config.enabled
    ? "Web Push está activo. Admin abre y cierra las convocatorias manualmente; el recordatorio de respuestas sigue programado."
    : "Web Push está desactivado: configura VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en el servidor.";
  const principalPlayers = data.lists.principal || [];
  const matchStatus = data.match?.status || null;
  return `<div class="mb-5"><p class="text-xs font-bold uppercase tracking-[.12em] text-pitch-700">Centro de avisos</p><h2 class="display mt-1 text-2xl font-extrabold">Notificaciones push</h2><p class="mt-1 text-sm text-ink/50">${message}</p></div>
    <div class="mb-5 grid gap-3 sm:grid-cols-2">
      ${[
        ["opening", "Convocatoria abierta", "Envía el aviso manual a todos los dispositivos suscritos.", campaigns.opening],
        ["unanswered", "Aún no te has apuntado", "Solo a jugadores que todavía no respondieron.", campaigns.friday_reminder],
        ["negative_balance", "Aviso de saldo negativo", "A jugadores convocados con saldo negativo.", null],
      ].map(([type, title, description, campaign]) => `<article class="rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm"><div class="flex items-start justify-between gap-3"><div><h3 class="font-bold">${title}</h3><p class="mt-1 text-xs leading-5 text-ink/50">${description}</p></div><span class="rounded-full ${campaign?.status === "sent" ? "bg-pitch-100 text-pitch-800" : "bg-paper text-ink/50"} px-2.5 py-1 text-[10px] font-bold">${campaign?.status === "sent" ? `${campaign.delivered_count} enviadas` : "Manual"}</span></div><button data-notification-type="${type}" ${!config.enabled || (type !== "opening" && (!matchStatus || (type === "unanswered" && matchStatus !== "open"))) ? "disabled" : ""} class="admin-notification-button mt-4 w-full rounded-xl bg-pitch-900 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">${title}</button></article>`).join("")}
      <article class="rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm"><h3 class="font-bold">Aviso individual de Lista Principal</h3><p class="mt-1 text-xs leading-5 text-ink/50">Envía un aviso directo a un jugador que aparece en la lista principal actual.</p><div class="mt-4 flex gap-2"><select id="notify-player-select" class="min-w-0 flex-1 rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm">${principalPlayers.map((player) => `<option value="${player.id}">${escapeHtml(player.alias)}</option>`).join("")}</select><button id="notify-player" ${!config.enabled || !principalPlayers.length ? "disabled" : ""} class="shrink-0 rounded-xl bg-pitch-900 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40">Enviar</button></div></article>
    </div>
    <section class="rounded-2xl border border-ink/[.07] bg-white p-5 text-xs text-ink/55 shadow-sm"><h3 class="font-bold text-ink">Estado de envíos</h3><p class="mt-2">Apertura: ${campaigns.opening?.status === "sent" ? `${campaigns.opening.delivered_count} entregadas` : "sin enviar"} · Recordatorio: ${campaigns.friday_reminder?.status === "sent" ? `${campaigns.friday_reminder.delivered_count} entregadas` : "sin enviar"}</p><p class="mt-1">Próximo partido: ${data.match ? escapeHtml(matchLabel(data.match)) : "Sin convocatoria activa"}</p></section>`;
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
            ${currentUser?.role === "admin" ? `<span class="hidden rounded-full border border-lime/30 px-3 py-1.5 text-[10px] font-bold tracking-wide text-lime sm:inline-flex">ADMIN</span>` : ""}
            <div class="hidden items-center gap-2 sm:flex"><span class="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-xs font-bold">${escapeHtml(initials)}</span><span class="max-w-32 truncate text-sm font-medium">${escapeHtml(currentUser?.name || "")}</span></div>
            ${currentUser?.role === "admin" ? `<button id="account-settings" class="${activeAdminTab === "jugadores" ? "hidden" : ""} rounded-lg px-2 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="Configuración de cuenta">Mi cuenta</button>` : ""}
          </div>
        </div>
      </header>
      <main class="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">${content}</main>
      <footer class="mx-auto max-w-7xl px-5 pb-8 text-xs text-ink/40 sm:px-8">O Pachanga <span class="mx-1">·</span> Una buena pachanga empieza aquí.</footer>
    </div>`;
  attachInstallButton();
  document.querySelector("#account-settings")?.addEventListener("click", openAccountSettings);
  document.querySelector("#push-toggle")?.addEventListener("click", togglePushSubscription);
  syncPushButton();
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
      void syncExistingPushSubscription();
      if (initializeAdminTeamNotificationKey()) await renderHome();
      scrollToNotificationTeams();
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
        void syncExistingPushSubscription();
        if (initializeAdminTeamNotificationKey()) await renderHome();
        scrollToNotificationTeams();
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
  const activeConvocation = await api("/api/convocations/current");
  const historyResponse = await api("/api/admin/convocations/history");
  convocationHistory = historyResponse.matches || [];
  const activeMatchId = activeConvocation.match?.id ?? null;
  const hasSelectedMatch = convocationHistory.some((match) => match.id === Number(selectedConvocationId));
  if (activeMatchId !== null) {
    if (!viewingHistoricalConvocation || selectedConvocationId == null || !hasSelectedMatch) {
      selectedConvocationId = activeMatchId;
      viewingHistoricalConvocation = false;
    }
  } else if (!viewingHistoricalConvocation || selectedConvocationId == null || !hasSelectedMatch) {
    selectedConvocationId = convocationHistory[0]?.id ?? null;
    viewingHistoricalConvocation = selectedConvocationId !== null;
  }
  if (activeMatchId !== null && Number(selectedConvocationId) === activeMatchId) {
    convocationData = activeConvocation;
  } else if (selectedConvocationId !== null) {
    try {
      convocationData = await api(`/api/convocations/${Number(selectedConvocationId)}`);
    } catch {
      selectedConvocationId = activeMatchId;
      viewingHistoricalConvocation = false;
      convocationData = activeConvocation;
    }
  } else {
    convocationData = activeConvocation;
  }
  matchData = await api("/api/matches");
  standingsData = await api("/api/standings");
  standingAdjustmentsData = (await api("/api/admin/standings/adjustments")).adjustments || [];
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
    ${renderPushBanner()}
    <nav class="mb-6 flex gap-2 overflow-x-auto rounded-2xl border border-ink/[.07] bg-white p-2 shadow-sm" aria-label="Secciones de administración">
      ${tabs.map(([id, label]) => `<button class="admin-tab-button shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold transition ${activeAdminTab === id ? "bg-pitch-900 text-white" : "text-ink/55 hover:bg-paper"}" data-admin-tab="${id}" aria-pressed="${activeAdminTab === id}">${label}</button>`).join("")}
    </nav>
    <section class="admin-tab-panel ${activeAdminTab === "convocatoria" ? "" : "hidden"}" data-admin-panel="convocatoria">
      ${renderConvocationBoard(convocationData, true, convocationHistory)}
    </section>
    <section class="admin-tab-panel ${activeAdminTab === "avisos" ? "" : "hidden"}" data-admin-panel="avisos">
      ${renderNotificationPanel(activeConvocation, users, pushConfig, notificationStatus)}
    </section>
    <section class="admin-tab-panel ${activeAdminTab === "finanzas" ? "" : "hidden"}" data-admin-panel="finanzas">
      ${renderFinancePanel(financeData, matchData)}
    </section>
    <section class="admin-tab-panel ${activeAdminTab === "partidos" ? "" : "hidden"}" data-admin-panel="partidos">
      ${renderMatchPanel(matchData, true, false)}
      ${renderStandingsBoard(standingsData)}
      ${renderStandingsAdjustmentPanel(standingsData, standingAdjustmentsData)}
    </section>
    <section class="admin-tab-panel ${activeAdminTab === "jugadores" ? "" : "hidden"}" data-admin-panel="jugadores">
      ${renderPlayerManagementPanel(players, pendingUsers)}
    </section>`;
  shell(adminContent, "Equipo");
  bindPlayerProfileButtons();
  document.querySelectorAll(".admin-tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      activeAdminTab = button.dataset.adminTab;
      document.querySelector("#account-settings")?.classList.toggle("hidden", activeAdminTab === "jugadores");
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
  const standingsAdjustmentForm = document.querySelector("#standings-adjustment-form");
  standingsAdjustmentForm?.elements.user_id.addEventListener("change", (event) => {
    const player = standingsData.standings.find((item) => item.id === Number(event.target.value));
    if (!player) return;
    for (const field of ["points", "matches_played", "wins", "draws", "losses"]) {
      standingsAdjustmentForm.elements[field].value = player[field];
    }
  });
  standingsAdjustmentForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    for (const field of ["user_id", "points", "matches_played", "wins", "draws", "losses"]) {
      values[field] = Number(values[field]);
    }
    button.disabled = true;
    try {
      const response = await api("/api/admin/standings/adjustments", {
        method: "POST",
        body: JSON.stringify(values),
      });
      standingsData = { ...standingsData, standings: response.standings };
      showToast(`Clasificación ajustada para @${response.adjustment.player_alias}.`);
      activeAdminTab = "partidos";
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
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
  document.querySelector("#balance-player-search")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLocaleLowerCase("es");
    document.querySelectorAll("[data-balance-player-search]").forEach((row) => {
      row.classList.toggle("hidden", !row.dataset.balancePlayerSearch.includes(query));
    });
  });
  bindConvocationActions(true);
  document.querySelector("#convocation-history-picker")?.addEventListener("change", async (event) => {
    selectedConvocationId = Number(event.target.value);
    viewingHistoricalConvocation = selectedConvocationId !== historyResponse.active_match_id;
    await renderAdmin();
  });
  document.querySelector("#show-new-convocation-date")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    const form = document.querySelector("#new-convocation-form");
    if (!form) return;
    form.classList.remove("hidden");
    button.classList.add("hidden");
    form.querySelector('[name="match_date"]')?.focus();
  });
  document.querySelector("#new-convocation-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"], button:not([type])');
    if (button) button.disabled = true;
    try {
      const sourceMatchId = form.dataset.sourceMatchId;
      const response = await api("/api/admin/convocations/new", {
        method: "POST",
        body: JSON.stringify({
          match_date: form.elements.match_date.value,
          match_time: form.elements.match_time.value,
          ...(sourceMatchId ? { source_match_id: Number(sourceMatchId) } : {}),
        }),
      });
      selectedConvocationId = response.match.id;
      viewingHistoricalConvocation = false;
      if (response.created) {
        const pushMessage = response.notification?.status === "disabled"
          ? " Web Push no está configurado."
          : response.notification?.status === "failed"
            ? " No se pudieron enviar todas las notificaciones."
            : response.notification?.inProgress
              ? " Los avisos están en proceso."
              : " Aviso de apertura procesado.";
        showToast(`Nueva convocatoria abierta.${pushMessage}`);
      } else {
        showToast("La convocatoria para esa fecha ya estaba abierta.");
      }
      activeAdminTab = "convocatoria";
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      if (button) button.disabled = false;
    }
  });
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
       ? "Convocatoria cerrada. Empieza el capitán de COLOR desde su perfil."
         : "Convocatoria cerrada.");
      activeAdminTab = "convocatoria";
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      form.querySelector("button").disabled = false;
    }
  });
  document.querySelector("#cancel-convocation")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!confirm("¿Cancelar esta convocatoria? Se avisará al grupo y no se aplicarán cobros ni puntos.")) return;
    button.disabled = true;
    try {
      const response = await api("/api/admin/convocations/current/cancel", {
        method: "POST",
        body: "{}",
      });
      selectedConvocationId = response.match.id;
      viewingHistoricalConvocation = true;
      const pushMessage = response.notification?.status === "disabled"
        ? " Web Push no está configurado."
        : response.notification?.status === "failed"
          ? " Algunos avisos push no se entregaron."
          : response.notification?.delivered
            ? ` Aviso enviado a ${response.notification.delivered} dispositivo(s).`
            : "";
      showToast(`Convocatoria cancelada.${pushMessage}`);
      activeAdminTab = "convocatoria";
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
  document.querySelector("#open-convocation")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await api("/api/admin/convocations/current/open", { method: "POST", body: "{}" });
      showToast(response.notification?.status === "disabled"
        ? "Convocatoria abierta. Web Push no está configurado."
        : "Convocatoria abierta.");
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
  document.querySelector("#pot-adjustment-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api("/api/admin/finance/pot-transactions", {
        method: "POST",
        body: JSON.stringify({
          concept: form.elements.concept.value,
          amount: Number(form.elements.amount.value),
          operation: form.elements.operation.value,
        }),
      });
      const financePanel = document.querySelector('[data-admin-panel="finanzas"]');
      const potBalance = financePanel?.querySelector("[data-pot-balance]");
      const potHistory = financePanel?.querySelector("#pot-movement-history");
      form.reset();
      financeData = {
        ...financeData,
        pot: result.pot,
        potTransactions: result.movement
          ? [result.movement, ...(financeData.potTransactions || [])]
          : financeData.potTransactions || [],
      };
      if (potBalance) potBalance.textContent = formatMoney(result.pot);
      if (potHistory) {
        potHistory.outerHTML = renderPotMovementHistory(financeData.potTransactions || []);
      }
      try {
        const refreshedFinance = await api("/api/admin/finance/overview");
        financeData = refreshedFinance;
        const currentPanel = document.querySelector('[data-admin-panel="finanzas"]');
        const currentPotBalance = currentPanel?.querySelector("[data-pot-balance]");
        const currentPotHistory = currentPanel?.querySelector("#pot-movement-history");
        if (currentPotBalance) currentPotBalance.textContent = formatMoney(refreshedFinance.pot);
        if (currentPotHistory) {
          currentPotHistory.outerHTML = renderPotMovementHistory(refreshedFinance.potTransactions || []);
        }
      } catch (refreshError) {
        console.warn("No se pudo refrescar el historial del Bote tras registrar el ajuste:", refreshError);
      }
      button.disabled = false;
      showToast("Ajuste registrado correctamente en el Bote", { success: true });
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
        const message = result.noSubscriptions
          ? "No hay dispositivos suscritos"
          : result.alreadySent
            ? "Este aviso ya se había enviado."
            : result.inProgress
              ? "El envío de este aviso está en curso."
              : result.skipped
                ? "Push no está configurado en el servidor."
                : result.failed
                  ? `${result.delivered} notificación(es) enviadas; ${result.failed} no se entregaron.`
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
  document.querySelector("#add-substitute")?.addEventListener("click", openSubstituteModal);
  document.querySelectorAll(".remove-substitute").forEach((button) => {
    button.addEventListener("click", async () => {
      const alias = button.dataset.alias || "este suplente";
      if (!confirm(`¿Quitar a @${alias} de la convocatoria?`)) return;
      button.disabled = true;
      try {
        convocationData = await api(`/api/convocations/current/suplentes/${button.dataset.userId}`, {
          method: "DELETE",
        });
        showToast(`@${alias} eliminado de la lista de suplentes.`);
        if (isAdmin) {
          activeAdminTab = "convocatoria";
          await renderAdmin();
        } else {
          await renderHome();
        }
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    });
  });
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
    document.querySelectorAll(".change-principal-status").forEach((button) => {
      button.addEventListener("click", async () => {
        const alias = button.dataset.alias || "este jugador";
        const targetStatus = button.dataset.status;
        const targetLabel = targetStatus === "suplente" ? "la Lista de Suplentes" : "la Lista NO VAN";
        if (!confirm(`¿Mover a @${alias} a ${targetLabel}? Si ya se cobró el partido, se devolverá su cuota.`)) return;
        button.disabled = true;
        try {
          convocationData = await api(`/api/admin/convocations/current/${button.dataset.userId}/status`, {
            method: "POST",
            body: JSON.stringify({ status: targetStatus }),
          });
          const refunded = Number(convocationData.refunded || 0);
          const destination = convocationData.movedTo === "suplente" ? "la Lista de Suplentes" : "la Lista NO VAN";
          showToast(refunded > 0
            ? `@${convocationData.removedAlias} pasó a ${destination}; se devolvieron ${formatMoney(refunded)}.`
            : `@${convocationData.removedAlias} pasó a ${destination}.`);
          activeAdminTab = "convocatoria";
          await renderAdmin();
        } catch (error) {
          showToast(error.message);
          button.disabled = false;
        }
      });
    });
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
        const result = await api(`/api/admin/pending-users/${form.dataset.userId}/approve`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        showToast(result.added_to_convocation
          ? "Suplente aprobado y añadido a la convocatoria."
          : "Cuenta aprobada y activada.");
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
    manualAssignmentMatchId = null;
    manualTeamAssignments = new Map();
    manualAssignmentMode = false;
    await renderHome();
  });
  document.querySelector("#finance-match-picker")?.addEventListener("change", async (event) => {
    selectedMatchId = Number(event.target.value);
    manualAssignmentMatchId = null;
    manualTeamAssignments = new Map();
    manualAssignmentMode = false;
    activeAdminTab = "finanzas";
    await renderAdmin();
  });
  document.querySelectorAll(".captain-draft-pick").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.finalPick === "true" &&
          !confirm("Esta es la última elección del draft. El jugador restante pasará automáticamente a COLOR. ¿Confirmar la alineación?")) return;
      button.disabled = true;
      try {
        const match = await api(`/api/matches/${button.dataset.matchId}/draft/pick`, {
          method: "POST",
          body: JSON.stringify({ userId: Number(button.dataset.playerId) }),
        });
        selectedMatchId = match.id;
        showToast(isTeamsPublished(match.draft.status) ? "Draft completo. BLANCOS y COLOR ya están publicados." : "Elección guardada.");
        await renderHome();
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    });
  });
  if (!isAdmin) return;
  document.querySelectorAll(".draft-mode-choice").forEach((button) => {
    button.addEventListener("click", async () => {
      manualAssignmentMode = button.dataset.manualMode === "true";
      manualAssignmentMatchId = Number(selectedMatchId);
      manualTeamAssignments = new Map();
      await renderAdmin();
    });
  });
  document.querySelector("#edit-teams-manually")?.addEventListener("click", async () => {
    manualAssignmentMode = true;
    manualAssignmentMatchId = Number(selectedMatchId);
    manualTeamAssignments = new Map();
    const match = matchData.matches?.find((item) => item.id === manualAssignmentMatchId);
    for (const player of match?.teamA || []) manualTeamAssignments.set(Number(player.id), "A");
    for (const player of match?.teamB || []) manualTeamAssignments.set(Number(player.id), "B");
    await renderAdmin();
  });
  document.querySelector("#cancel-edit-manual-teams")?.addEventListener("click", async () => {
    manualAssignmentMode = false;
    manualAssignmentMatchId = null;
    manualTeamAssignments = new Map();
    await renderAdmin();
  });
  document.querySelectorAll(".manual-team-choice").forEach((button) => {
    button.addEventListener("click", async () => {
      const playerId = Number(button.dataset.playerId);
      const team = button.dataset.team;
      if (!Number.isSafeInteger(playerId) || !["A", "B"].includes(team)) return;
      manualAssignmentMatchId = Number(selectedMatchId);
      manualTeamAssignments.set(playerId, team);
      await renderAdmin();
    });
  });
  document.querySelector("#save-manual-teams")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    const teamA = [...manualTeamAssignments.entries()].filter(([, team]) => team === "A").map(([id]) => id);
    const teamB = [...manualTeamAssignments.entries()].filter(([, team]) => team === "B").map(([id]) => id);
    if (!confirm(`¿Guardar la formación equilibrada: BLANCOS ${teamA.length} y COLOR ${teamB.length}?`)) return;
    button.disabled = true;
    try {
      const response = await api(`/api/admin/matches/${selectedMatchId}/teams/manual`, {
        method: "POST",
        body: JSON.stringify({ teamA, teamB }),
      });
      selectedMatchId = response.id;
      manualAssignmentMatchId = null;
      manualTeamAssignments = new Map();
      manualAssignmentMode = false;
      const notification = response.notification;
      lastAdminTeamNotificationKey = teamNotificationKey({ id: response.id, teamNotification: notification });
      showToast(teamNotificationMessage(notification));
      activeAdminTab = "partidos";
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
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
      manualAssignmentMatchId = null;
      manualTeamAssignments = new Map();
      manualAssignmentMode = false;
      showToast("Draft iniciado. Empieza el capitán de COLOR.");
      activeAdminTab = "partidos";
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
      showToast("Precio total y cuota por jugador guardados; el cobro se aplicará al registrar el resultado.");
      activeAdminTab = "finanzas";
      await renderAdmin();
    } catch (error) {
      showToast(error.message);
      form.querySelector("button").disabled = false;
    }
  });
  const matchPriceForm = document.querySelector("#match-price-form");
  const updatePricePreview = () => {
    if (!matchPriceForm) return;
    const preview = matchPriceForm.querySelector("[data-match-price-preview]");
    if (!preview) return;
    preview.textContent = matchPricePreviewText(
      matchPriceForm.elements.price_total.value,
      matchPriceForm.elements.price_per_player.value,
      matchPriceForm.dataset.principalCount,
    );
  };
  matchPriceForm?.addEventListener("input", updatePricePreview);
  matchPriceForm?.addEventListener("change", updatePricePreview);
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

async function openSubstituteModal() {
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-pitch-950/60 p-3 backdrop-blur-sm sm:p-4";
  overlay.innerHTML = `
    <section class="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-7" role="dialog" aria-modal="true" aria-labelledby="substitute-modal-title">
      <div class="mb-5 flex items-start justify-between gap-3">
        <div><p class="text-xs font-bold uppercase tracking-[.13em] text-pitch-700">CONVOCATORIA ABIERTA</p><h2 id="substitute-modal-title" class="display mt-1 text-2xl font-extrabold">Añadir suplente</h2><p class="mt-1 text-sm text-ink/55">Elige una cuenta existente o registra a alguien nuevo.</p></div>
        <button type="button" class="close-substitute grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper text-ink/55 hover:bg-ink/10" aria-label="Cerrar">✕</button>
      </div>
      <div class="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-paper p-1.5" role="tablist" aria-label="Tipo de suplente">
        <button type="button" data-substitute-mode="existing" role="tab" aria-selected="true" class="rounded-xl bg-pitch-900 px-3 py-3 text-xs font-bold text-white">Suplente registrado</button>
        <button type="button" data-substitute-mode="new" role="tab" aria-selected="false" class="rounded-xl px-3 py-3 text-xs font-bold text-ink/60">Nuevo suplente</button>
      </div>
      <form id="existing-substitute-form" class="space-y-4">
        <label class="block"><span class="mb-1.5 block text-sm font-semibold">Jugador disponible</span><select name="user_id" required class="w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-pitch-700"><option value="">Cargando suplentes…</option></select></label>
        <p id="existing-substitute-empty" class="hidden rounded-xl bg-paper px-3 py-3 text-sm text-ink/55">No hay suplentes registrados pendientes de responder.</p>
        <div id="existing-substitute-error" class="hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert"></div>
        <button type="submit" class="w-full rounded-xl bg-pitch-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-pitch-800 disabled:cursor-not-allowed disabled:opacity-50">Añadir a la lista de suplentes</button>
      </form>
      <form id="new-substitute-form" class="hidden space-y-4">
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block"><span class="mb-1.5 block text-sm font-semibold">Nombre</span><input name="first_name" required maxlength="60" autocomplete="given-name" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm outline-none focus:border-pitch-700"/></label>
          <label class="block"><span class="mb-1.5 block text-sm font-semibold">Apellidos</span><input name="last_name" required maxlength="80" autocomplete="family-name" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm outline-none focus:border-pitch-700"/></label>
        </div>
        <label class="block"><span class="mb-1.5 block text-sm font-semibold">Alias único</span><input name="alias" required minlength="3" maxlength="24" pattern="[A-Za-zÀ-ÿ0-9._-]{3,24}" autocomplete="username" placeholder="Ej. Alex10" class="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm outline-none focus:border-pitch-700"/><span class="mt-1 block text-xs text-ink/45">Entre 3 y 24 caracteres; debe estar libre.</span></label>
      <p class="rounded-xl bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900">El suplente quedará pendiente de aprobación. Cuando el Admin lo apruebe, se activará y se añadirá a esta convocatoria.</p>
        <div id="new-substitute-error" class="hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert"></div>
        <button type="submit" class="w-full rounded-xl bg-pitch-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-pitch-800 disabled:cursor-not-allowed disabled:opacity-50">Enviar solicitud de aprobación</button>
      </form>
    </section>`;
  document.body.append(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll(".close-substitute").forEach((button) => button.addEventListener("click", close));
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

  const existingForm = overlay.querySelector("#existing-substitute-form");
  const newForm = overlay.querySelector("#new-substitute-form");
  const modeButtons = [...overlay.querySelectorAll("[data-substitute-mode]")];
  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      const isExisting = button.dataset.substituteMode === "existing";
      existingForm.classList.toggle("hidden", !isExisting);
      newForm.classList.toggle("hidden", isExisting);
      for (const modeButton of modeButtons) {
        const selected = modeButton === button;
        modeButton.setAttribute("aria-selected", String(selected));
        modeButton.classList.toggle("bg-pitch-900", selected);
        modeButton.classList.toggle("text-white", selected);
        modeButton.classList.toggle("text-ink/60", !selected);
      }
      overlay.querySelectorAll('[role="alert"]').forEach((error) => {
        error.textContent = "";
        error.classList.add("hidden");
      });
    });
  }

  const select = existingForm.elements.user_id;
  const existingEmpty = overlay.querySelector("#existing-substitute-empty");
  const existingButton = existingForm.querySelector('button[type="submit"]');
  try {
    const { players: availablePlayers } = await api("/api/convocations/current/available-suplentes");
    select.innerHTML = availablePlayers.length
      ? `<option value="">Selecciona un alias</option>${availablePlayers.map((player) => `<option value="${player.id}">${escapeHtml(player.alias)}</option>`).join("")}`
      : `<option value="">No hay suplentes disponibles</option>`;
    existingEmpty.classList.toggle("hidden", availablePlayers.length > 0);
    existingButton.disabled = availablePlayers.length === 0;
  } catch (error) {
    select.innerHTML = `<option value="">No se pudieron cargar los suplentes</option>`;
    existingButton.disabled = true;
    const errorBox = overlay.querySelector("#existing-substitute-error");
    errorBox.textContent = error.message;
    errorBox.classList.remove("hidden");
  }

  existingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!select.value) return;
    existingButton.disabled = true;
    try {
      await api("/api/convocations/current/add-existing-suplente", {
        method: "POST",
        body: JSON.stringify({ user_id: select.value }),
      });
      close();
      showToast("Suplente añadido a la convocatoria.");
      await renderHome();
    } catch (error) {
      const errorBox = overlay.querySelector("#existing-substitute-error");
      errorBox.textContent = error.message;
      errorBox.classList.remove("hidden");
      existingButton.disabled = false;
    }
  });

  const newButton = newForm.querySelector('button[type="submit"]');
  newForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    newButton.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(newForm).entries());
      const response = await api("/api/convocations/current/add-new-suplente", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const alias = response.added_player?.alias || body.alias;
      close();
      showToast("El suplente ha sido registrado y requiere la aprobación del Admin para incorporarse.");
      await renderHome();
    } catch (error) {
      const errorBox = overlay.querySelector("#new-substitute-error");
      errorBox.textContent = error.message;
      errorBox.classList.remove("hidden");
      newButton.disabled = false;
    }
  });
  overlay.querySelector('[data-substitute-mode="existing"]').focus();
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
    ${renderPushBanner()}
    ${renderConvocationBoard(convocationData, false)}
    ${renderMatchPanel(matchData, false)}
    ${renderStandingsBoard(standingsData)}
    <div class="mt-5 grid gap-4 sm:grid-cols-3">
      <section class="rounded-2xl border border-ink/[.07] bg-white p-6 shadow-sm"><p class="text-xs font-bold uppercase tracking-[.12em] text-ink/45">Tu ficha técnica</p><p class="mt-2 text-sm leading-5 text-ink/55">Añade tu posición, tus puntos fuertes y una foto.</p><div class="mt-3">${profileButton(currentUser.id, currentUser.alias)}</div></section>
      <section class="rounded-2xl border border-ink/[.07] bg-white p-6 shadow-sm"><p class="text-xs font-bold uppercase tracking-[.12em] text-ink/45">Tu rol base</p><p class="display mt-3 text-2xl font-extrabold">${player?.base_role === "principal" ? "Principal" : "Suplente"}</p></section>
      <section class="rounded-2xl border border-ink/[.07] bg-white p-6 shadow-sm"><p class="text-xs font-bold uppercase tracking-[.12em] text-ink/45">Saldo</p><p class="display mt-3 text-2xl font-extrabold">${formatMoney(player?.balance)}</p></section>
    </div>`;
  shell(content);
  bindPlayerProfileButtons();
  bindConvocationActions();
  bindMatchActions();
}

function formatMoney(amount) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(amount) || 0);
}

async function compressProfilePhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error("Selecciona una imagen válida.");
  if (file.size > 12 * 1024 * 1024) throw new Error("La imagen original debe pesar menos de 12 MB.");
  const image = await createImageBitmap(file);
  try {
    let maxSide = 480;
    let quality = 0.78;
    let dataUrl = "";
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL("image/webp", quality);
      if (!dataUrl.startsWith("data:image/webp,")) dataUrl = canvas.toDataURL("image/jpeg", quality);
      const base64Length = dataUrl.length - dataUrl.indexOf(",") - 1;
      const estimatedBytes = Math.floor(base64Length * 3 / 4);
      if (estimatedBytes <= 256 * 1024) return dataUrl;
      if (attempt % 2 === 0) quality = Math.max(0.48, quality - 0.1);
      else maxSide = Math.max(240, maxSide - 80);
    }
    throw new Error("La imagen no se pudo comprimir por debajo de 256 KB. Elige otra foto.");
  } finally {
    image.close();
  }
}

async function openPlayerProfile(userId) {
  let profile;
  try {
    ({ profile } = await api(`/api/users/${userId}/profile`));
  } catch (error) {
    showToast(error.message);
    return;
  }

  const canEditAlias = currentUser?.role === "admin";
  const canEditText = canEditAlias || currentUser?.id === profile.id;
  const canEditPhoto = canEditText;
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-pitch-950/65 p-3 backdrop-blur-sm sm:p-5";
  overlay.innerHTML = `
    <section class="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-3xl bg-paper shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
      <header class="relative overflow-hidden bg-pitch-900 px-5 pb-5 pt-4 text-white sm:px-7 sm:pb-6">
        <div class="absolute -right-8 -top-16 h-48 w-48 rounded-full border border-white/10"></div>
        <div class="relative flex items-start justify-between gap-4">
          <div><p class="text-[10px] font-bold uppercase tracking-[.16em] text-lime">${canEditText ? "Ficha de jugador" : "Perfil de jugador"}</p><h2 id="profile-modal-title" class="display mt-1 text-2xl font-extrabold">Perfil de ${escapeHtml(profile.alias)}</h2><p class="mt-1 text-xs text-white/60">${canEditAlias ? "Edita los datos técnicos del jugador." : canEditText ? "Puedes editar tu foto y tus datos técnicos." : "Ficha técnica del jugador."}</p></div>
          <button type="button" class="close-profile grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-white transition hover:bg-white/20" aria-label="Cerrar perfil">✕</button>
        </div>
        <div class="relative mt-5 flex items-center gap-4">
          ${profileAvatar(profile.photo_url, profile.alias)}
          <div class="min-w-0"><p class="truncate text-lg font-extrabold">@${escapeHtml(profile.alias)}</p><p class="mt-1 text-xs text-white/60">${canEditPhoto ? "Perfil visible para el equipo" : "Información compartida con el equipo"}</p></div>
        </div>
      </header>
      <form id="profile-form" class="space-y-4 p-5 sm:p-7">
        ${canEditPhoto ? `<div class="rounded-2xl border border-ink/[.07] bg-white p-4"><label class="block text-xs font-bold text-ink/60">Foto de perfil<input id="profile-photo-file" type="file" accept="image/*" class="mt-2 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-pitch-100 file:px-3 file:py-2 file:font-bold file:text-pitch-900"/></label><div class="mt-2 flex items-center justify-between gap-3"><span class="text-[11px] text-ink/45">Selecciona una imagen de tu dispositivo; se recorta cuadrada y se muestra redondeada. Máximo 256 KB tras comprimir.</span><button type="button" id="clear-profile-photo" class="shrink-0 text-[11px] font-bold text-red-700 ${profile.photo_url ? "" : "hidden"}">Quitar foto</button></div><p id="profile-photo-error" class="mt-2 hidden text-xs font-semibold text-red-700" role="alert"></p></div>` : ""}
        <label class="block text-xs font-bold text-ink/60">Alias público<input name="alias" required minlength="3" maxlength="24" pattern="[A-Za-zÀ-ÿ0-9._-]{3,24}" value="${escapeHtml(profile.alias)}" ${canEditAlias ? "" : "readonly"} class="mt-1.5 w-full rounded-xl border border-ink/10 ${canEditAlias ? "bg-white" : "bg-paper"} px-3.5 py-3 text-sm font-semibold text-ink outline-none focus:border-pitch-700"/></label>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block text-xs font-bold text-ink/60">Dónde juega<input name="preferred_position" list="profile-position-options" maxlength="60" value="${escapeHtml(profile.preferred_position || "")}" placeholder="Ej. Extremo izquierdo" ${canEditText ? "" : "readonly"} class="mt-1.5 w-full rounded-xl border border-ink/10 ${canEditText ? "bg-white" : "bg-paper"} px-3.5 py-3 text-sm font-normal outline-none focus:border-pitch-700"/></label>
          <datalist id="profile-position-options"><option value="Portero"><option value="Defensa"><option value="Centrocampista"><option value="Delantero"><option value="Extremo"><option value="Lateral"><option value="Mediocentro"></datalist>
        </div>
        <label class="block text-xs font-bold text-ink/60">Puntos fuertes<textarea name="strong_points" maxlength="1000" rows="2" placeholder="Ej. Gran disparo con la zurda, buen pase" ${canEditText ? "" : "readonly"} class="mt-1.5 w-full resize-y rounded-xl border border-ink/10 ${canEditText ? "bg-white" : "bg-paper"} px-3.5 py-3 text-sm font-normal leading-5 outline-none focus:border-pitch-700">${escapeHtml(profile.strong_points || "")}</textarea></label>
        <label class="block text-xs font-bold text-ink/60">Puntos débiles<textarea name="weak_points" maxlength="1000" rows="2" placeholder="Ej. Juego aéreo, repliegue defensivo" ${canEditText ? "" : "readonly"} class="mt-1.5 w-full resize-y rounded-xl border border-ink/10 ${canEditText ? "bg-white" : "bg-paper"} px-3.5 py-3 text-sm font-normal leading-5 outline-none focus:border-pitch-700">${escapeHtml(profile.weak_points || "")}</textarea></label>
        <label class="block text-xs font-bold text-ink/60">Otros datos<textarea name="other_details" maxlength="2000" rows="3" placeholder="Ej. Prefiere jugar en la banda izquierda" ${canEditText ? "" : "readonly"} class="mt-1.5 w-full resize-y rounded-xl border border-ink/10 ${canEditText ? "bg-white" : "bg-paper"} px-3.5 py-3 text-sm font-normal leading-5 outline-none focus:border-pitch-700">${escapeHtml(profile.other_details || "")}</textarea></label>
        <div id="profile-form-error" class="hidden rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert"></div>
        ${canEditPhoto
          ? `<button type="submit" class="w-full rounded-xl bg-pitch-900 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-pitch-800 disabled:opacity-50">${canEditText ? "Guardar cambios" : "Guardar fotografía"}</button>`
          : `<p class="rounded-xl bg-white px-4 py-3 text-center text-xs text-ink/45">Solo el jugador o el Administrador pueden modificar estos datos.</p>`}
        ${currentUser?.id === profile.id ? `<div class="flex justify-end border-t border-ink/10 pt-3"><button id="profile-logout" type="button" class="rounded-lg px-2 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 hover:text-red-900">Cerrar sesión</button></div>` : ""}
      </form>
    </section>`;
  document.body.append(overlay);

  const close = () => overlay.remove();
  overlay.querySelector(".close-profile").addEventListener("click", close);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  overlay.querySelector("#profile-logout")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    close();
    await logout();
  });

  if (!canEditPhoto) return;
  const form = overlay.querySelector("#profile-form");
  const avatar = overlay.querySelector("[data-profile-avatar]");
  const photoInput = overlay.querySelector("#profile-photo-file");
  const clearPhoto = overlay.querySelector("#clear-profile-photo");
  const photoError = overlay.querySelector("#profile-photo-error");
  let photoUrl = profile.photo_url || null;

  const renderAvatarPreview = () => {
    avatar.innerHTML = photoUrl
      ? `<img src="${escapeHtml(photoUrl)}" alt="Vista previa de ${escapeHtml(profile.alias)}" class="h-full w-full object-cover"/>`
      : escapeHtml(profile.alias.slice(0, 2).toUpperCase());
    clearPhoto.classList.toggle("hidden", !photoUrl);
  };

  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    photoInput.disabled = true;
    photoError.classList.add("hidden");
    try {
      photoUrl = await compressProfilePhoto(file);
      renderAvatarPreview();
    } catch (error) {
      photoError.textContent = error.message || "No se pudo cargar la foto.";
      photoError.classList.remove("hidden");
      photoInput.value = "";
    } finally {
      photoInput.disabled = false;
    }
  });
  clearPhoto.addEventListener("click", () => {
    photoUrl = null;
    photoInput.value = "";
    renderAvatarPreview();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector("#profile-form-error");
    submit.disabled = true;
    errorBox.classList.add("hidden");
    const values = canEditText
      ? Object.fromEntries(new FormData(form).entries())
      : {};
    if (!canEditAlias) delete values.alias;
    values.photo_url = photoUrl;
    try {
      const response = await api(`/api/users/${profile.id}/profile`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      if (currentUser.id === profile.id) currentUser.alias = response.profile.alias;
      close();
      showToast(canEditText ? "Perfil actualizado." : "Fotografía actualizada.");
      await loadUsers();
      await renderHome();
    } catch (error) {
      errorBox.textContent = error.message || "No se pudo guardar el perfil.";
      errorBox.classList.remove("hidden");
      submit.disabled = false;
    }
  });
  if (canEditAlias) form.elements.alias.focus();
  else if (currentUser?.id === profile.id) form.elements.preferred_position.focus();
  else photoInput.focus();
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
      void syncExistingPushSubscription();
      if (initializeAdminTeamNotificationKey()) await renderHome();
      scrollToNotificationTeams();
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
  } catch (error) {
    showToast(error.message || "No se pudo cerrar la sesión.");
    return;
  }
  currentUser = null;
  selectedConvocationId = null;
  viewingHistoricalConvocation = false;
  document.querySelectorAll('[role="dialog"]').forEach((dialog) => dialog.remove());
  renderLogin();
}

async function renderHome() {
  if (currentUser?.must_change_password) return renderPasswordChange();
  if (currentUser?.role === "admin") return renderAdmin();
  return renderPlayer();
}

function initializeAdminTeamNotificationKey() {
  if (currentUser?.role !== "admin") return false;
  const current = matchData?.matches?.find((match) =>
    match.isCurrent && isTeamsPublished(match.draft?.status) && match.teamNotification?.sentAt,
  );
  lastAdminTeamNotificationKey = teamNotificationKey(current);
  if (current && activeAdminTab !== "partidos") {
    activeAdminTab = "partidos";
    return true;
  }
  return false;
}

async function loadUsers() {
  users = await api("/api/users");
}

let pollingConvocation = false;
async function refreshConvocationIfChanged() {
  if (!currentUser || document.visibilityState !== "visible" || pollingConvocation || document.querySelector('[role="dialog"]')) return;
  pollingConvocation = true;
  try {
    const selectedEndpoint = currentUser.role === "admin" && selectedConvocationId
      ? `/api/convocations/${selectedConvocationId}`
      : "/api/convocations/current";
    const [latest, latestStandings] = await Promise.all([
      api(selectedEndpoint),
      api("/api/standings"),
    ]);
    const convocationChanged = JSON.stringify(latest) !== JSON.stringify(convocationData);
    const standingsChanged = JSON.stringify(latestStandings) !== JSON.stringify(standingsData);
    if (convocationChanged || standingsChanged) {
      convocationData = latest;
      standingsData = latestStandings;
      await renderHome();
    }
  } catch {
    // Keep the last visible response while temporarily offline.
  } finally {
    pollingConvocation = false;
  }
}

let pollingPot = false;
async function refreshPotBalance() {
  if (!currentUser || document.visibilityState !== "visible" || pollingPot) return;
  pollingPot = true;
  try {
    const { pot } = await api("/api/pot");
    const amount = Number(pot);
    if (!Number.isFinite(amount) || Number(standingsData.pot) === amount) return;
    standingsData = { ...standingsData, pot: amount };
    document.querySelectorAll("[data-pot-balance]").forEach((element) => {
      element.textContent = formatMoney(amount);
    });
  } catch {
    // Keep the last displayed total while temporarily offline.
  } finally {
    pollingPot = false;
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
  const hasCurrentPublishedTeams = matchData?.matches?.some((match) =>
    match.isCurrent && match.status === "closed" && isTeamsPublished(match.draft?.status),
  );
  const adminWatchingCurrentMatch = currentUser.role === "admin" && matchData?.matches?.some((match) =>
    match.isCurrent && match.status === "closed",
  );
  if (!isDesignatedCaptain && !hasCurrentPublishedTeams && !adminWatchingCurrentMatch) return;
  pollingDraft = true;
  try {
    const latest = await api("/api/matches");
    if (JSON.stringify(latest) !== JSON.stringify(matchData)) {
      const publishedMatch = currentUser.role === "admin"
        ? latest.matches?.find((match) =>
          match.isCurrent && isTeamsPublished(match.draft?.status) && match.teamNotification?.sentAt,
        )
        : null;
      const notificationKey = teamNotificationKey(publishedMatch);
      const newAdminNotification = notificationKey && notificationKey !== lastAdminTeamNotificationKey
        ? publishedMatch.teamNotification
        : null;
      if (newAdminNotification) {
        lastAdminTeamNotificationKey = notificationKey;
        activeAdminTab = "partidos";
      }
      matchData = latest;
      await renderHome();
      if (newAdminNotification) showToast(teamNotificationMessage(newAdminNotification));
    }
  } catch {
    // The next poll will refresh the draft when the connection returns.
  } finally {
    pollingDraft = false;
  }
}

setInterval(refreshConvocationIfChanged, 15000);
setInterval(refreshPotBalance, 5000);
setInterval(refreshLiveDraftIfChanged, 4000);

async function registerServiceWorkerWithUpdates() {
  if (!("serviceWorker" in navigator)) return;

  let reloadWhenControlled = Boolean(navigator.serviceWorker.controller);
  let isReloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadWhenControlled) {
      reloadWhenControlled = true;
      return;
    }
    if (isReloading) return;
    isReloading = true;
    window.location.reload();
  });

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const activateWaitingWorker = (worker) => worker?.postMessage({ type: "SKIP_WAITING" });

    if (registration.waiting) {
      reloadWhenControlled = true;
      activateWaitingWorker(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller && registration.waiting) {
          reloadWhenControlled = true;
          activateWaitingWorker(registration.waiting);
        }
      });
    });

    await registration.update();
  } catch (error) {
    console.warn("No se pudo registrar o actualizar el service worker:", error);
  }
}

async function start() {
  void registerServiceWorkerWithUpdates();
  const notificationLink = new URLSearchParams(window.location.search);
  const notificationMatchId = Number(notificationLink.get("match_id"));
  const openTeamsFromNotification = notificationLink.get("view") === "convocatoria-equipos";
  if (openTeamsFromNotification && Number.isSafeInteger(notificationMatchId) && notificationMatchId > 0) {
    selectedMatchId = notificationMatchId;
    activeAdminTab = "partidos";
  }
  try {
    const session = await api("/api/session");
    currentUser = session.user;
    if (currentUser) {
      await loadUsers();
      await renderHome();
      void syncExistingPushSubscription();
      if (initializeAdminTeamNotificationKey()) await renderHome();
      if (openTeamsFromNotification) scrollToNotificationTeams();
    } else renderLogin();
  } catch (error) {
    app.innerHTML = `<main class="grid min-h-screen place-items-center p-6"><div class="max-w-sm text-center"><div class="text-4xl">⚽</div><h1 class="display mt-4 text-2xl font-extrabold">No hay conexión con el servidor</h1><p class="mt-2 text-sm text-ink/55">Comprueba la conexión e inténtalo de nuevo.</p><button onclick="location.reload()" class="mt-5 rounded-xl bg-pitch-900 px-5 py-3 text-sm font-bold text-white">Reintentar</button></div></main>`;
    console.error(error);
  }
}

function scrollToNotificationTeams() {
  if (new URLSearchParams(window.location.search).get("view") !== "convocatoria-equipos") return;
  requestAnimationFrame(() => {
    document.querySelector("#match-teams")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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
