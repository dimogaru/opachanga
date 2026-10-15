const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let users = [];
let currentUser = null;
let installPrompt = null;
let toastTimer;

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
            ${installButton("!hidden sm:!inline-flex")}
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
          <div class="mb-8 flex items-center justify-between"><div><p class="text-xs font-bold uppercase tracking-[.15em] text-pitch-700">Bienvenido al vestuario</p><h2 class="display mt-2 text-3xl font-extrabold tracking-tight">¿Quién juega hoy?</h2></div>${installButton("!inline-flex !border-pitch-900/10 !bg-pitch-900 !text-white sm:hidden")}</div>
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

function renderAdmin() {
  const adminContent = `
    <div class="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div><div class="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-pitch-700"><span class="h-2 w-2 rounded-full bg-pitch-700"></span>ADMINISTRACIÓN <span class="text-ink/25">/</span> EQUIPO</div><h1 class="display text-3xl font-extrabold tracking-tight sm:text-4xl">Gestiona el equipo</h1><p class="mt-2 text-sm text-ink/55">Altas, posiciones y saldo de la plantilla.</p></div>
      <button id="new-player" class="inline-flex items-center justify-center gap-2 rounded-xl bg-pitch-900 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-pitch-800"><span class="text-lg leading-none">+</span> Añadir jugador</button>
    </div>
    <div class="mb-6 grid gap-3 sm:grid-cols-3">
      <div class="rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm"><p class="text-xs font-semibold text-ink/45">PLANTILLA TOTAL</p><div class="mt-2 flex items-end justify-between"><span class="display text-3xl font-extrabold">${users.length}</span><span class="pb-1 text-xs text-ink/40">jugadores</span></div></div>
      <div class="rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm"><p class="text-xs font-semibold text-ink/45">PRINCIPALES</p><div class="mt-2 flex items-end justify-between"><span class="display text-3xl font-extrabold">${users.filter((user) => user.role === "principal").length}</span><span class="mb-1 h-2 w-2 rounded-full bg-pitch-700"></span></div></div>
      <div class="rounded-2xl border border-ink/[.07] bg-white p-5 shadow-sm"><p class="text-xs font-semibold text-ink/45">SUPLENTES</p><div class="mt-2 flex items-end justify-between"><span class="display text-3xl font-extrabold">${users.filter((user) => user.role === "suplente").length}</span><span class="mb-1 h-2 w-2 rounded-full bg-amber-400"></span></div></div>
    </div>
    <section class="overflow-hidden rounded-2xl border border-ink/[.07] bg-white shadow-sm">
      <div class="flex items-center justify-between border-b border-ink/[.07] px-5 py-4 sm:px-6"><div><h2 class="font-bold">Jugadores</h2><p class="mt-0.5 text-xs text-ink/45">Posición de ranking y saldo actual</p></div><span class="rounded-full bg-pitch-100 px-3 py-1 text-xs font-bold text-pitch-800">${users.length} activos</span></div>
      ${users.length ? `<div class="overflow-x-auto"><table class="w-full min-w-[650px] text-left"><thead class="bg-paper/70 text-[10px] font-bold uppercase tracking-[.12em] text-ink/45"><tr><th class="px-5 py-3 sm:px-6">Jugador</th><th class="px-4 py-3">Rol</th><th class="px-4 py-3">Ranking</th><th class="px-4 py-3">Saldo</th><th class="px-5 py-3 text-right sm:px-6">Acción</th></tr></thead><tbody class="divide-y divide-ink/[.06]">${users.map((user) => `<tr class="hover:bg-paper/50"><td class="px-5 py-4 sm:px-6"><div class="flex items-center gap-3"><span class="grid h-9 w-9 place-items-center rounded-xl ${user.role === "principal" ? "bg-pitch-100 text-pitch-800" : "bg-amber-50 text-amber-700"} text-xs font-bold">${escapeHtml(user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase())}</span><span class="font-semibold">${escapeHtml(user.name)}</span></div></td><td class="px-4 py-4"><span class="rounded-full ${user.role === "principal" ? "bg-pitch-100 text-pitch-800" : "bg-amber-50 text-amber-700"} px-2.5 py-1 text-xs font-semibold">${user.role === "principal" ? "Principal" : "Suplente"}</span></td><td class="px-4 py-4 text-sm text-ink/65">${user.ranking_position ? `#${user.ranking_position}` : "—"}</td><td class="px-4 py-4 text-sm font-semibold">${formatMoney(user.balance)}</td><td class="px-5 py-4 text-right sm:px-6"><button class="edit-player rounded-lg border border-ink/10 px-3 py-1.5 text-xs font-bold transition hover:border-pitch-700 hover:text-pitch-700" data-id="${user.id}">Editar</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="px-6 py-14 text-center"><div class="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-pitch-100 text-pitch-800 text-xl">＋</div><p class="mt-4 font-bold">Aún no hay jugadores</p><p class="mt-1 text-sm text-ink/50">Añade a los amigos que forman el equipo.</p></div>`}
    </section>`;
  shell(adminContent, "Equipo");
  document.querySelector("#new-player")?.addEventListener("click", () => openPlayerModal());
  document.querySelectorAll(".edit-player").forEach((button) => {
    const player = users.find((user) => user.id === Number(button.dataset.id));
    button.addEventListener("click", () => openPlayerModal(player));
  });
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
    renderHome();
  } catch (error) {
    showToast(error.message);
  }
}

async function logout() {
  await api("/api/session", { method: "DELETE" }).catch(() => {});
  currentUser = null;
  renderLogin();
}

function renderHome() {
  if (currentUser?.role === "admin") return renderAdmin();
  const player = users.find((user) => user.id === currentUser?.id);
  const content = `
    <div class="mb-8"><div class="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-pitch-700"><span class="h-2 w-2 rounded-full bg-pitch-700"></span>VESTUARIO</div><h1 class="display text-3xl font-extrabold tracking-tight sm:text-4xl">¡Hola, ${escapeHtml(currentUser?.name?.split(" ")[0] || "jugador")}!</h1><p class="mt-2 text-sm text-ink/55">Tu sitio en el equipo está listo. Nos vemos en el campo.</p></div>
    <section class="relative overflow-hidden rounded-3xl bg-pitch-900 p-6 text-white shadow-card sm:p-9"><div class="absolute -right-14 -top-24 h-72 w-72 rounded-full border border-white/10"></div><div class="absolute -right-1 -top-10 h-48 w-48 rounded-full border border-white/10"></div><div class="relative max-w-xl"><span class="rounded-full bg-lime/15 px-3 py-1.5 text-xs font-bold text-lime">${player?.role === "principal" ? "JUGADOR PRINCIPAL" : "SUPLENTE"}</span><h2 class="display mt-6 text-3xl font-extrabold tracking-tight">Próximo partido</h2><p class="mt-2 text-sm text-white/60">La convocatoria del martes aparecerá aquí.</p><div class="mt-7 flex flex-wrap gap-3"><span class="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold">📅 &nbsp;Martes</span><span class="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold">⚽ &nbsp;Partido pendiente de convocar</span></div></div></section>
    <div class="mt-5 grid gap-4 sm:grid-cols-2"><section class="rounded-2xl border border-ink/[.07] bg-white p-6 shadow-sm"><p class="text-xs font-bold uppercase tracking-[.12em] text-ink/45">Posición en el ranking</p><p class="display mt-3 text-3xl font-extrabold">${player?.ranking_position ? `#${player.ranking_position}` : "—"}</p></section><section class="rounded-2xl border border-ink/[.07] bg-white p-6 shadow-sm"><p class="text-xs font-bold uppercase tracking-[.12em] text-ink/45">Saldo</p><p class="display mt-3 text-3xl font-extrabold">${formatMoney(player?.balance)}</p></section></div>
    <p class="mt-8 rounded-xl border border-dashed border-ink/15 px-5 py-4 text-sm text-ink/50">La convocatoria, los equipos y los resultados se podrán añadir como siguiente paso.</p>`;
  shell(content);
}

async function loadUsers() {
  users = await api("/api/users");
}

async function start() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("No se pudo registrar el service worker:", error));
  try {
    await loadUsers();
    const session = await api("/api/session");
    currentUser = session.user;
    if (currentUser) await loadUsers();
    currentUser ? renderHome() : renderLogin();
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
