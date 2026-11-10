// MI CASA – MIS RESPONSABILIDADES · aplicación principal
import { CONFIG } from './config.js';
import { LocalStore } from './store-local.js';
import * as L from './logic.js';
import { esc, $, $$, toast, modal, confirmDlg, promptDlg, zoom, confetti, attachMasks, avatarHTML, compressImage, blobToDataURL, pickFile, download, busy } from './ui.js';

const app = $('#app');
const S = {
  store: null, me: null, family: null, isAdmin: false, tab: 'home', today: '',
  members: [], acts: [], inst: [], rewards: [], uses: [], fridays: [], notifs: [],
  actFilter: '', hist: null, prefill: null, installEvt: null,
};
const ADMIN_TABS = [['home', '🏠', 'Inicio'], ['acts', '📋', 'Actividades'], ['rewards', '🎁', 'Premios'], ['history', '📊', 'Historial'], ['more', '⚙️', 'Más']];
const KID_TABS = [['home', '🏠', 'Hoy'], ['progress', '📈', 'Progreso'], ['rewards', '🎁', 'Premios'], ['history', '🗓️', 'Historial'], ['me', '🙂', 'Perfil']];
const COLORS = ['#4f46e5', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#475569'];

// =====================================================================
// Arranque
// =====================================================================
function applyTheme() {
  const t = localStorage.getItem('mc_theme') || 'auto';
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1120' : '#4f46e5');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

function readParams() {
  const p = new URLSearchParams(location.search);
  if (p.get('s') && p.get('k')) {
    localStorage.setItem('mc_server', JSON.stringify({ url: p.get('s'), key: p.get('k') }));
    localStorage.setItem('mc_mode', 'cloud');
  }
  if (p.get('f')) S.prefill = { code: p.get('f'), user: p.get('u') || '' };
  if ([...p.keys()].length) history.replaceState(null, '', location.pathname);
}
function serverCfg() {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) return { url: CONFIG.SUPABASE_URL.trim(), key: CONFIG.SUPABASE_ANON_KEY.trim(), fixed: true };
  try { return JSON.parse(localStorage.getItem('mc_server')); } catch { return null; }
}
async function makeStore() {
  if (localStorage.getItem('mc_mode') === 'local') return new LocalStore();
  const cfg = serverCfg();
  if (!cfg) return null;
  const { CloudStore } = await import('./store-supabase.js');
  return new CloudStore(cfg.url, cfg.key);
}
function registerSW() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener?.('message', e => { if (e.data?.type === 'open-tab') { S.tab = e.data.tab || 'home'; if (S.me) render(); } });
  }
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; $$('[data-act="install"]').forEach(b => b.classList.remove('hidden')); });

async function boot() {
  applyTheme(); readParams(); registerSW();
  app.innerHTML = '<div class="spinner"></div>';
  try { S.store = await makeStore(); }
  catch { S.store = null; toast('No se pudo cargar el conector del servidor. Revisá tu conexión a internet.', 'err'); }
  if (!S.store) return renderWelcome();
  let sess = null;
  try { sess = await S.store.init(); } catch (e) { toast(e.message, 'err'); }
  if (!sess) return renderLogin();
  await enter(sess);
}

async function enter(sess) {
  S.me = sess.profile; S.family = sess.family; S.isAdmin = S.me.role === 'admin';
  S.tab = 'home'; S.hist = null; S.actFilter = '';
  app.innerHTML = '<div class="spinner"></div>';
  try { await loadAll(); }
  catch (e) { toast(e.message, 'err'); await S.store.logout().catch(() => {}); return renderLogin(); }
  S.store.subscribe(onRealtime);
  render();
  afterEnter();
}

async function loadAll() {
  const st = S.store;
  S.today = await st.ensureToday();
  try { await st.refreshFriday(); } catch (e) { console.warn(e); }
  const [members, acts, inst, submitted, rewards, uses, fridays, notifs, sess] = await Promise.all([
    st.listMembers(), st.listActivities(), st.listInstances({ from: L.addDays(S.today, -120) }),
    S.isAdmin ? st.listInstances({ status: 'submitted' }) : [], st.listRewards(),
    st.listRewardUses({ from: L.addDays(S.today, -90) }), st.listFriday(), st.listNotifications(), st.reloadSession(),
  ]);
  const ids = new Set(inst.map(t => t.id));
  S.inst = inst.concat(submitted.filter(t => !ids.has(t.id)));
  Object.assign(S, { members, acts, rewards, uses, fridays, notifs });
  if (sess) { S.me = sess.profile; S.family = sess.family; S.isAdmin = S.me.role === 'admin'; }
}

let rtTimer;
function onRealtime(evt) {
  if (evt.type === 'notification') {
    const n = evt.row;
    if (document.hidden) sysNotify(n.title, n.body, n.type);
    else toast(`${n.title} · ${n.body}`);
  }
  clearTimeout(rtTimer);
  rtTimer = setTimeout(async () => {
    const before = S.isAdmin ? null : L.stats(myToday()).pct;
    try { await loadAll(); render(true); } catch (e) { console.warn(e); }
    if (!S.isAdmin && before < 100 && L.stats(myToday()).pct >= 100) { confetti(); toast('¡Completaste el 100% del día! 🎉', 'ok'); }
  }, 350);
}
async function refresh(keep = true) {
  try { await loadAll(); render(keep); } catch (e) { toast(e.message, 'err'); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) refresh(true); });
setInterval(() => {
  if (!S.me) return;
  if (L.todayStr(S.family.settings?.timezone) !== S.today) refresh(false);
  checkDueReminders();
}, 60000);
setInterval(() => $$('[data-until]').forEach(el => {
  const ms = +el.dataset.until - Date.now();
  if (ms <= 0) { el.textContent = 'Tiempo terminado'; el.removeAttribute('data-until'); return; }
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60;
  el.textContent = `${Math.floor(m / 60) ? Math.floor(m / 60) + 'h ' : ''}${m % 60}m ${String(s).padStart(2, '0')}s`;
}), 1000);

// =====================================================================
// Ayudantes
// =====================================================================
const kids = () => S.members.filter(m => m.role === 'child' && m.active);
const mem = id => S.members.find(m => m.id === id);
const tz = () => S.family?.settings?.timezone || 'America/Asuncion';
const set = () => S.family?.settings || {};
const thr = () => Number(set().weekly_threshold ?? 90);
const fmode = () => set().friday_mode || 'individual';
const myToday = () => S.inst.filter(t => t.child_id === S.me.id && t.date === S.today);
const pill = t => { const s = L.STATUS[t.status]; return `<span class="pill" style="--st:${s.color}">${s.icon} ${s.label}</span>`; };
const barHTML = (pct, cls = '') => `<div class="bar ${cls}"><i data-w="${Math.min(100, pct)}"></i></div>`;
const pctTxt = p => `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
const rewardsFor = kidId => S.rewards.filter(r => r.active && (!r.child_id || r.child_id === kidId));
const sectionTitle = (t, right = '') => `<div class="section-title"><h2>${t}</h2>${right}</div>`;
const empty = (e, t) => `<div class="empty"><div class="e">${e}</div><div>${t}</div></div>`;
const unread = () => S.notifs.filter(n => !n.read).length;
const pendingReview = () => S.inst.filter(t => t.status === 'submitted').sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || ''));
function familyLink(username) {
  const cfg = serverCfg();
  const p = new URLSearchParams({ f: S.family.code });
  if (username) p.set('u', username);
  if (cfg && !cfg.fixed) { p.set('s', cfg.url); p.set('k', cfg.key); }
  return `${location.origin}${location.pathname}?${p}`;
}
async function share(text) {
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copiado ✔', 'ok'); } catch { toast('No se pudo copiar', 'err'); } }

function rewardState(r, kidId) {
  const s = L.stats(S.inst.filter(t => t.child_id === kidId && t.date === S.today));
  const use = S.uses.find(u => u.child_id === kidId && u.reward_id === r.id && u.date === S.today);
  if (use) {
    const until = new Date(use.started_at).getTime() + use.minutes * 60000;
    return until > Date.now() ? { k: 'active', until } : { k: 'used' };
  }
  if (s.total && s.pct >= r.min_pct) return { k: 'available' };
  return { k: 'locked', need: Math.max(0, r.min_pct - s.pct), s };
}
function fridayInfo(kidId) {
  const ws = L.weekStart(S.today);
  const fri = L.addDays(ws, 4);
  const fam = fmode() === 'family';
  const list = S.inst.filter(t => t.date >= ws && t.date <= fri && (fam || t.child_id === kidId));
  const s = L.stats(list);
  const row = S.fridays.find(f => f.week_start === ws && (fam ? f.scope === 'family' : f.scope === kidId));
  const iso = L.dow(S.today) || 7;
  return { ws, s, row, fam, isFridayOrLater: iso >= 5, reached: s.total > 0 && s.pct >= thr() };
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function hours(min) { return min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ' ' + (min % 60) + ' min' : ''}` : `${min} min`; }

// Fotos privadas: se cargan con enlaces temporales cuando aparecen en pantalla
const io = 'IntersectionObserver' in window ? new IntersectionObserver(ents => ents.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); loadPhoto(e.target); } }), { rootMargin: '200px' }) : null;
async function loadPhoto(img) {
  try { img.src = await S.store.photoUrl(img.dataset.photo); }
  catch { img.replaceWith(Object.assign(document.createElement('div'), { className: 'muted small center', textContent: 'Foto no disponible' })); }
}
function hydrate(root) {
  $$('img[data-photo]', root).forEach(img => io ? io.observe(img) : loadPhoto(img));
}
function animateBars(root, instant) {
  const bars = $$('.bar > i[data-w], .week-bars i[data-h]', root);
  const go = () => bars.forEach(i => { if (i.dataset.w != null) i.style.width = i.dataset.w + '%'; else i.style.height = i.dataset.h + '%'; });
  if (instant) { bars.forEach(i => i.style.transition = 'none'); go(); requestAnimationFrame(() => bars.forEach(i => i.style.transition = '')); }
  else requestAnimationFrame(() => requestAnimationFrame(go));
}

// =====================================================================
// Pantallas de bienvenida e inicio de sesión
// =====================================================================
function renderWelcome() {
  app.innerHTML = `<div class="login">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h1 class="center">Mi Casa</h1><p class="center muted" style="margin:4px 0 22px">Mis responsabilidades</p>
    <div class="card">
      <h2>☁️ Conectar con el servidor familiar</h2>
      <p class="small muted">Pegá la URL y la clave pública (Publishable key o anon key) de tu proyecto Supabase. Así todos los teléfonos de la familia quedan sincronizados.</p>
      <form id="srv">
        <div class="field"><label class="f">URL del proyecto</label><input class="input" name="url" placeholder="https://xxxx.supabase.co" required autocomplete="off"></div>
        <div class="field"><label class="f">Publishable key / anon key</label><textarea class="input" name="key" required placeholder="sb_publishable_… o eyJhbGciOi…" style="min-height:70px"></textarea></div>
        <button class="btn block big">Conectar</button>
      </form>
      <p class="tiny muted">¿Tus hijos? Usen el enlace de acceso que les comparte papá o mamá: ya trae todo configurado.</p>
    </div>
    <div class="card">
      <h2>📱 Probar en este teléfono</h2>
      <p class="small muted">Modo local: funciona sin servidor, pero los datos quedan solo en este dispositivo (ideal para conocer la app).</p>
      <button class="btn ghost block" id="local">Probar en modo local</button>
    </div></div>`;
  $('#srv').onsubmit = e => {
    e.preventDefault();
    const url = e.target.url.value.trim().replace(/\/+$/, ''), key = e.target.key.value.trim();
    if (!/^https:\/\/.+/.test(url)) return toast('La URL debe empezar con https://', 'err');
    localStorage.setItem('mc_server', JSON.stringify({ url, key }));
    localStorage.setItem('mc_mode', 'cloud');
    boot();
  };
  $('#local').onclick = () => { localStorage.setItem('mc_mode', 'local'); boot(); };
}

function renderLogin(tab) {
  const cfg = serverCfg();
  const local = S.store.mode === 'local';
  tab = tab || (S.prefill ? 'kid' : 'parent');
  app.innerHTML = `<div class="login">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h1 class="center">Mi Casa</h1><p class="center muted" style="margin:4px 0 20px">Mis responsabilidades ${local ? '<span class="mode-tag">MODO LOCAL</span>' : ''}</p>
    <div class="tabs"><button data-t="parent" class="${tab === 'parent' ? 'on' : ''}">👨‍👩‍👧 Papá / Mamá</button><button data-t="kid" class="${tab === 'kid' ? 'on' : ''}">🧒 Hijo / Hija</button></div>
    <div class="card" id="lbox">${tab === 'parent' ? parentLoginHTML() : kidLoginHTML()}</div>
    <p class="center small muted" style="margin-top:18px">${local ? 'Datos guardados solo en este teléfono' : `Servidor: ${esc((cfg?.url || '').replace('https://', ''))}`}
    ${cfg?.fixed && !local ? '' : ' · <button class="link" id="chg">Cambiar</button>'}</p>
    <button class="btn ghost block ${S.installEvt ? '' : 'hidden'}" data-act="install">⬇️ Instalar la app</button>
  </div>`;
  $$('.tabs button', app).forEach(b => b.onclick = () => renderLogin(b.dataset.t));
  $('#chg')?.addEventListener('click', () => { localStorage.removeItem('mc_mode'); localStorage.removeItem('mc_server'); boot(); });
  bindLoginForms();
  attachMasks(app);
}
function parentLoginHTML(signup) {
  if (signup) return `<h2>Crear cuenta familiar</h2><p class="small muted">Vas a ser el administrador. Después agregás a tus hijos.</p>
    <form id="signup">
      <div class="field"><label class="f">Nombre de la familia</label><input class="input" name="fam" required placeholder="Familia González"></div>
      <div class="field"><label class="f">Tu nombre</label><input class="input" name="name" required placeholder="Papá / Mamá / Carlos"></div>
      <div class="field"><label class="f">Correo</label><input class="input" type="email" name="email" required autocomplete="email"></div>
      <div class="field"><label class="f">Contraseña (mínimo 6)</label><input class="input" type="password" name="pass" required minlength="6" autocomplete="new-password"></div>
      <button class="btn block big">Crear familia</button></form>
    <p class="center"><button class="link" id="toLogin">Ya tengo cuenta</button></p>`;
  return `<h2>Ingreso de administrador</h2>
    <form id="plogin">
      <div class="field"><label class="f">Correo</label><input class="input" type="email" name="email" required autocomplete="email"></div>
      <div class="field"><label class="f">Contraseña</label><input class="input" type="password" name="pass" required autocomplete="current-password"></div>
      <button class="btn block big">Entrar</button></form>
    <p class="center"><button class="link" id="toSignup">¿Primera vez? Crear cuenta familiar</button></p>
    <p class="center tiny muted">¿Te agregaron como segundo administrador con usuario y PIN? Entrá por la pestaña "Hijo / Hija".</p>`;
}
function kidLoginHTML() {
  return `<h2>Ingreso con PIN</h2><p class="small muted">Pedile a papá o mamá tu código familiar, usuario y PIN.</p>
    <form id="klogin">
      <div class="field"><label class="f">Código familiar</label><input class="input" name="code" required value="${esc(S.prefill?.code || '')}" style="text-transform:uppercase" autocomplete="off" autocapitalize="characters"></div>
      <div class="field"><label class="f">Usuario</label><input class="input" name="user" required value="${esc(S.prefill?.user || '')}" autocomplete="username" autocapitalize="none"></div>
      <div class="field"><label class="f">PIN (6 números)</label><input class="input pin" type="password" name="pin" data-mask="pin" required minlength="6" maxlength="6" autocomplete="current-password"></div>
      <button class="btn block big">Entrar</button></form>`;
}
function bindLoginForms() {
  $('#toSignup')?.addEventListener('click', () => { $('#lbox').innerHTML = parentLoginHTML(true); bindLoginForms(); });
  $('#toLogin')?.addEventListener('click', () => { $('#lbox').innerHTML = parentLoginHTML(); bindLoginForms(); });
  const go = (form, fn) => form && (form.onsubmit = e => { e.preventDefault(); busy(form.querySelector('.btn'), async () => { const s = await fn(form); if (s?.needsConfirm) return toast('Te enviamos un correo para confirmar la cuenta. Confirmalo y después iniciá sesión. (Podés desactivar la confirmación en Supabase, ver guía)', 'ok'); if (s) await enter(s); }); });
  go($('#plogin'), f => S.store.loginAdmin(f.email.value, f.pass.value));
  go($('#signup'), f => S.store.signUpAdmin({ email: f.email.value, password: f.pass.value, familyName: f.fam.value.trim(), displayName: f.name.value.trim() }));
  go($('#klogin'), f => S.store.loginMember(f.code.value, f.user.value, f.pin.value));
}

// =====================================================================
// Estructura principal
// =====================================================================
function render(keep) {
  if (!S.me) return;
  const y = scrollY;
  const views = S.isAdmin ? AV : KV;
  if (!views[S.tab]) S.tab = 'home';
  const v = views[S.tab]();
  const tabs = S.isAdmin ? ADMIN_TABS : KID_TABS;
  const pend = S.isAdmin ? pendingReview().length : myToday().filter(t => ['pending', 'rejected', 'redo'].includes(t.status)).length;
  app.innerHTML = `
    <header class="topbar">
      ${v.left || ''}
      <div class="title"><h1 class="ellipsis">${v.title}</h1><div class="small muted ellipsis">${v.sub || ''}</div></div>
      ${S.store.mode === 'local' ? '<span class="mode-tag">LOCAL</span>' : ''}
      <button class="icon-btn" data-act="bell" aria-label="Notificaciones">🔔${unread() ? `<span class="dot">${unread()}</span>` : ''}</button>
    </header>
    <main class="page">${v.body}</main>
    ${v.fab || ''}
    <nav class="nav"><div class="nav-inner">${tabs.map(([id, ico, label]) => `<button data-act="tab" data-tab="${id}" class="${S.tab === id ? 'on' : ''}"><span class="ico">${ico}</span>${label}${id === 'home' && pend ? `<span class="badge">${pend}</span>` : ''}</button>`).join('')}</div></nav>`;
  attachMasks(app); hydrate(app); animateBars(app, keep);
  scrollTo(0, keep ? y : 0);
  v.after?.();
}

// =====================================================================
// PANEL DEL ADMINISTRADOR
// =====================================================================
const AV = {};

AV.home = () => {
  const today = S.inst.filter(t => t.date === S.today);
  const st = L.stats(today);
  const pend = pendingReview();
  const ks = kids();
  return {
    title: `Hola, ${esc(S.me.display_name)}`, sub: esc(S.family.name),
    body: `
      <div class="hero">
        <div class="small muted">${cap(L.longDate(S.today))}</div>
        <div class="row between" style="margin:4px 0 12px"><b style="font-size:1.15rem">Resumen de hoy</b><b style="font-size:1.4rem">${pctTxt(st.pct)}</b></div>
        ${barHTML(st.pct)}
        <div class="stat-grid" style="margin-top:14px">
          <div class="stat"><b>${st.total}</b><span>Asignadas</span></div>
          <div class="stat"><b>${pend.length}</b><span>Por revisar</span></div>
          <div class="stat"><b>${st.approved}</b><span>Aprobadas</span></div>
          <div class="stat"><b>${st.rejected}</b><span>Rechazadas</span></div>
        </div>
      </div>
      ${!ks.length ? `<div class="card" style="margin-top:14px"><h2>👋 Empecemos</h2><p class="muted">Agregá a tus hijos, creales su acceso con PIN y asignales actividades.</p><button class="btn block" data-act="newMember" data-role="child">➕ Agregar hijo/a</button></div>` : ''}
      ${sectionTitle(`🔎 PENDIENTES DE VERIFICACIÓN (${pend.length})`)}
      ${pend.length ? pend.map(evidCard).join('') : `<div class="card">${empty('🎉', 'No hay evidencias por revisar.')}</div>`}
      ${ks.length ? sectionTitle('👧 Progreso de cada hijo') + ks.map(kidCard).join('') : ''}
      ${ks.length ? sectionTitle('🎉 Viernes de recompensa', `<button class="link" data-act="tab" data-tab="rewards">Gestionar</button>`) + fridayAdminSummary() : ''}
    `,
    fab: ks.length ? `<button class="btn fab" data-act="newAct">➕ Actividad</button>` : '',
  };
};

function evidCard(t) {
  const k = mem(t.child_id);
  const when = L.fmtTime(t.submitted_at, tz());
  return `<div class="evid" id="ev-${t.id}">
    ${t.photo_path ? `<div class="ph" data-zoomphoto="${esc(t.photo_path)}"><img data-photo="${esc(t.photo_path)}" alt="Evidencia de ${esc(t.title)}"></div>`
      : `<div class="ph muted" style="aspect-ratio:auto;padding:18px">${t.photo_deleted ? '🗑️ Foto eliminada' : '📝 Marcada como realizada (sin foto obligatoria)'}</div>`}
    <div class="body">
      <div class="row">${avatarHTML(k, 'sm')}<div class="grow"><b>${esc(k?.display_name || '')}</b> · ${esc(t.icon)} ${esc(t.title)}</div></div>
      <div class="small muted" style="margin-top:6px">Enviada ${t.date !== S.today ? L.shortDate(t.date) + ' ' : ''}a las ${when}${t.attempts > 1 ? ` · intento ${t.attempts}` : ''}${t.late ? ' · <b style="color:var(--c-pending)">⏰ fuera de horario</b>' : ''}</div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn ok" data-act="review" data-a="approve" data-id="${t.id}">✅ Aprobar</button>
        <button class="btn bad" data-act="review" data-a="reject" data-id="${t.id}">❌ Rechazar</button>
        <button class="btn warn" data-act="review" data-a="redo" data-id="${t.id}">📷 Otra foto</button>
      </div>
    </div></div>`;
}

function kidCard(k) {
  const s = L.stats(S.inst.filter(t => t.child_id === k.id && t.date === S.today));
  const fi = fridayInfo(k.id);
  const own = L.weekProgress(S.inst, S.today, k.id);
  const sk = L.streaks(S.inst.filter(t => t.child_id === k.id), S.today);
  const av = rewardsFor(k.id).map(r => [r, rewardState(r, k.id)]).filter(([, x]) => x.k !== 'locked');
  return `<div class="card">
    <div class="row">${avatarHTML(k)}<div class="grow"><b>${esc(k.display_name)}</b><div class="small muted">${s.approved}/${s.total} aprobadas hoy</div></div><b style="font-size:1.5rem">${pctTxt(s.pct)}</b></div>
    <div style="margin:12px 0 8px">${barHTML(s.pct)}</div>
    <div class="small muted">📨 ${s.submitted} por revisar · ⏳ ${s.pending} por hacer · ❌ ${s.rejected} rechazadas${s.expired ? ` · ⌛ ${s.expired} vencidas` : ''}</div>
    <div class="small" style="margin-top:6px">📅 Semana (L-V): <b>${pctTxt(own.friday.pct)}</b> · Meta ${thr()}% ${own.friday.pct >= thr() && own.friday.total ? '✅' : ''} · 🔥 Racha: <b>${sk.current}</b></div>
    ${av.length ? `<div class="chips" style="margin-top:10px">${av.map(([r, x]) => `<span class="pill" style="--st:var(--c-approved)">${esc(r.icon)} ${esc(r.name)} ${x.k === 'active' ? '· en uso' : x.k === 'used' ? '· usada' : '· habilitada'}</span>`).join('')}</div>` : ''}
    <div class="btn-row" style="margin-top:12px"><button class="btn ghost sm" data-act="kidToday" data-id="${k.id}">📋 Tareas de hoy</button><button class="btn ghost sm" data-act="newAct" data-kid="${k.id}">➕ Asignar</button></div>
  </div>`;
}

function fridayAdminSummary() {
  const ws = L.weekStart(S.today);
  const fam = fmode() === 'family';
  const rows = fam ? [{ name: 'Meta familiar', ...fridayInfo(null) }] : kids().map(k => ({ name: k.display_name, ...fridayInfo(k.id) }));
  return `<div class="card"><div class="small muted">Meta: ${thr()}% de lunes a viernes · ${fam ? 'Meta familiar compartida' : 'Individual'} · semana del ${L.shortDate(ws)}</div>
    ${rows.map(r => `<div class="list-item"><div class="grow"><b>${esc(r.name)}</b><div style="margin-top:6px">${barHTML(r.s.pct, 'thin')}</div></div>
      <div class="center" style="min-width:90px"><b>${pctTxt(r.s.pct)}</b><div class="tiny muted">${r.row ? (r.row.status === 'unlocked' ? '🔓 Desbloqueado' : '✅ ' + (L.FRIDAY_OPTIONS[r.row.choice]?.label || 'Aprobado')) : r.isFridayOrLater ? (r.reached ? 'Alcanzada' : 'No alcanzada') : 'En curso'}</div></div></div>`).join('')}
  </div>`;
}

AV.acts = () => {
  const ks = kids();
  const f = S.actFilter;
  const list = S.acts.filter(a => !f || a.child_id === f);
  const groups = {};
  list.forEach(a => (groups[a.category] ||= []).push(a));
  return {
    title: 'Actividades', sub: `${S.acts.filter(a => a.active).length} activas`,
    body: `
      <div class="chips" style="margin-bottom:12px"><button class="chip ${!f ? 'on' : ''}" data-act="actFilter" data-id="">Todos</button>${ks.map(k => `<button class="chip ${f === k.id ? 'on' : ''}" data-act="actFilter" data-id="${k.id}">${esc(k.display_name)}</button>`).join('')}</div>
      <div class="btn-row"><button class="btn" data-act="newAct" ${ks.length ? '' : 'disabled'}>➕ Nueva</button><button class="btn ghost" data-act="templates" ${ks.length ? '' : 'disabled'}>📋 Plantillas</button></div>
      ${!ks.length ? `<div class="card" style="margin-top:14px">${empty('🧒', 'Primero agregá un hijo/a en la pestaña Más → Miembros.')}</div>` : ''}
      ${ks.length && !list.length ? `<div class="card" style="margin-top:14px">${empty('📋', 'Todavía no hay actividades. Usá "Plantillas" para cargar las de ejemplo en un toque.')}</div>` : ''}
      ${Object.entries(groups).map(([cat, arr]) => sectionTitle(esc(cat)) + `<div class="card">${arr.map(a => {
        const k = mem(a.child_id);
        return `<div class="list-item click" data-act="editAct" data-id="${a.id}" style="${a.active ? '' : 'opacity:.5'}">
          <div class="task" style="padding:0;box-shadow:none;border:0;width:auto"><div class="emoji">${esc(a.icon)}</div></div>
          <div class="grow"><b>${esc(a.title)}</b><div class="small muted">👤 ${esc(k?.display_name || '')} · ${L.freqText(a)}${a.due_time ? ' · hasta ' + esc(a.due_time) : ''} · ${a.points} pts ${a.requires_photo ? '· 📷' : ''}${a.is_habit ? ' · hábito' : ''}${a.active ? '' : ' · pausada'}</div></div><span class="muted">›</span></div>`;
      }).join('')}</div>`).join('')}`,
  };
};

AV.rewards = () => {
  const ks = kids();
  const todayUses = S.uses.filter(u => u.date === S.today);
  const ws = L.weekStart(S.today);
  const fr = S.fridays;
  const t = thr();
  return {
    title: 'Premios', sub: 'Privilegios y Viernes de recompensa',
    body: `
      ${sectionTitle('🎁 Privilegios diarios', `<button class="link" data-act="editReward">➕ Nuevo</button>`)}
      <div class="card">${S.rewards.length ? S.rewards.map(r => `<div class="list-item click" data-act="editReward" data-id="${r.id}" style="${r.active ? '' : 'opacity:.5'}">
          <div class="reward"><div class="ri">${esc(r.icon)}</div></div><div class="grow"><b>${esc(r.name)}</b><div class="small muted">${hours(r.minutes)} · requiere ${r.min_pct}% del día · ${r.child_id ? 'Para ' + esc(mem(r.child_id)?.display_name || '') : 'Para todos'}</div></div><span class="muted">›</span></div>`).join('')
        : empty('🎁', 'No hay recompensas configuradas.') + `<button class="btn ghost block" data-act="rewardExamples">Crear ejemplos (celular, entretenimiento, aire)</button>`}
      <p class="tiny muted" style="margin-top:10px">Las comidas, la higiene, el descanso, la salud y las necesidades básicas nunca se condicionan: aquí solo se configuran privilegios extra.</p></div>

      ${sectionTitle('⏱️ En uso / usadas hoy')}
      <div class="card">${todayUses.length ? todayUses.map(u => { const until = new Date(u.started_at).getTime() + u.minutes * 60000; const k = mem(u.child_id);
        return `<div class="list-item">${avatarHTML(k, 'sm')}<div class="grow"><b>${esc(k?.display_name || '')}</b> · ${esc(u.reward_name)}<div class="small muted">Desde ${L.fmtTime(u.started_at, tz())} · ${hours(u.minutes)}</div></div>${until > Date.now() ? `<span class="countdown" data-until="${until}">…</span>` : '<span class="small muted">Terminado</span>'}</div>`; }).join('') : empty('⏱️', 'Nadie usó recompensas hoy.')}</div>

      ${sectionTitle('🎉 Viernes de recompensa')}
      <div class="card">
        <label class="f">Porcentaje mínimo semanal (lunes a viernes)</label>
        <div class="chips">${[85, 90, 100].map(v => `<button class="chip ${t === v ? 'on' : ''}" data-act="setThr" data-v="${v}">${v}%</button>`).join('')}<button class="chip ${[85, 90, 100].includes(t) ? '' : 'on'}" data-act="setThr" data-v="custom">${[85, 90, 100].includes(t) ? 'Otro' : t + '%'}</button></div>
        ${ks.length > 1 || fmode() === 'family' ? `<label class="f" style="margin-top:14px">¿Cómo se gana?</label>
        <div class="chips"><button class="chip ${fmode() === 'individual' ? 'on' : ''}" data-act="setMode" data-v="individual">👤 Individual</button><button class="chip ${fmode() === 'family' ? 'on' : ''}" data-act="setMode" data-v="family">👨‍👩‍👧 Meta familiar</button></div>` : ''}
        <p class="small muted" style="margin-top:10px">Desde el viernes, si se alcanza la meta, se desbloquea el premio: <b>salir a cenar</b> o <b>pedir delivery</b>. Los hijos votan y vos aprobás.</p>
      </div>
      ${ks.length ? fridayAdminSummary() : ''}
      ${fr.filter(f => f.week_start === ws).map(fridayDecisionCard).join('')}

      ${sectionTitle('📜 Historial de premios del viernes')}
      <div class="card">${fr.length ? fr.map(f => `<div class="list-item"><div class="reward"><div class="ri">${f.choice ? L.FRIDAY_OPTIONS[f.choice].icon : '🔓'}</div></div><div class="grow"><b>Semana del ${L.shortDate(f.week_start)}</b><div class="small muted">${f.scope === 'family' ? 'Meta familiar' : esc(mem(f.child_id)?.display_name || '')} · ${pctTxt(Number(f.pct))} · ${f.status === 'unlocked' ? 'Pendiente de aprobar' : f.status === 'approved' ? 'Aprobado: ' + esc(L.FRIDAY_OPTIONS[f.choice]?.label || '') : 'Realizado: ' + esc(L.FRIDAY_OPTIONS[f.choice]?.label || '')}</div></div></div>`).join('') : empty('📜', 'Todavía no hay premios registrados.')}</div>`,
  };
};

function fridayDecisionCard(f) {
  const votes = Object.entries(f.votes || {});
  const count = o => votes.filter(([, v]) => v === o).length;
  const who = f.scope === 'family' ? 'Meta familiar' : mem(f.child_id)?.display_name || '';
  return `<div class="friday" style="margin-top:14px">
    <h2>🎉 ${esc(who)} desbloqueó el viernes</h2>
    <div class="small muted" style="margin:4px 0 10px">Cumplimiento ${pctTxt(Number(f.pct))} · Votos: 🍽️ ${count('cena')} · 🛵 ${count('delivery')}${votes.length ? ' (' + votes.map(([id, v]) => esc(mem(id)?.display_name || '') + ': ' + L.FRIDAY_OPTIONS[v].icon).join(', ') + ')' : ''}</div>
    ${f.status === 'unlocked' ? `<div class="btn-row"><button class="vote" data-act="fridayDecide" data-id="${f.id}" data-v="cena"><span class="i">🍽️</span>Aprobar: cena</button><button class="vote" data-act="fridayDecide" data-id="${f.id}" data-v="delivery"><span class="i">🛵</span>Aprobar: delivery</button></div>`
      : f.status === 'approved' ? `<p><b>Aprobado: ${L.FRIDAY_OPTIONS[f.choice].icon} ${L.FRIDAY_OPTIONS[f.choice].label}</b></p><button class="btn block" style="background:#fff;color:#b45309" data-act="fridayDone" data-id="${f.id}">✔️ Registrar como realizado</button>`
      : `<p><b>✔️ Realizado: ${L.FRIDAY_OPTIONS[f.choice].icon} ${L.FRIDAY_OPTIONS[f.choice].label}</b></p>`}
  </div>`;
}

AV.history = () => {
  if (!S.hist) {
    S.hist = { from: L.addDays(S.today, -6), to: S.today, kid: '', cat: '', status: '', rows: null };
    loadHistory();
  }
  const h = S.hist;
  const ks = S.members.filter(m => m.role === 'child');
  let body = `<div class="card">
      <div class="chips" style="margin-bottom:12px">${[[0, 'Hoy'], [6, '7 días'], [29, '30 días'], [89, '90 días']].map(([d, l]) => `<button class="chip ${h.from === L.addDays(S.today, -d) && h.to === S.today ? 'on' : ''}" data-act="histQuick" data-d="${d}">${l}</button>`).join('')}</div>
      <form id="hf">
        <div class="row"><div class="grow field"><label class="f">Desde</label><input class="input" name="from" data-mask="date" placeholder="DD/MM/AAAA" value="${L.shortDate(h.from)}"></div>
        <div class="grow field"><label class="f">Hasta</label><input class="input" name="to" data-mask="date" placeholder="DD/MM/AAAA" value="${L.shortDate(h.to)}"></div></div>
        <div class="row"><div class="grow field"><label class="f">Hijo/a</label><select class="input" name="kid"><option value="">Todos</option>${ks.map(k => `<option value="${k.id}" ${h.kid === k.id ? 'selected' : ''}>${esc(k.display_name)}</option>`).join('')}</select></div>
        <div class="grow field"><label class="f">Estado</label><select class="input" name="status"><option value="">Todos</option>${Object.entries(L.STATUS).map(([k, v]) => `<option value="${k}" ${h.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div></div>
        <div class="field"><label class="f">Tipo de actividad</label><select class="input" name="cat"><option value="">Todas</option>${L.CATEGORIES.map(c => `<option ${h.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <button class="btn block">🔎 Aplicar filtros</button>
      </form></div>`;
  if (!h.rows) body += '<div class="spinner"></div>';
  else {
    const rows = h.rows.filter(t => (!h.cat || t.category === h.cat) && (!h.status || t.status === h.status));
    const base = h.rows.filter(t => !h.cat || t.category === h.cat);
    const st = L.stats(base);
    const days = []; for (let d = h.from; d <= h.to && days.length < 92; d = L.addDays(d, 1)) days.push(d);
    const per = L.byDate(base);
    const photos = rows.filter(t => t.photo_path).length;
    const uses = S.uses.filter(u => u.date >= h.from && u.date <= h.to && (!h.kid || u.child_id === h.kid));
    body += `${sectionTitle('📈 Resumen')}
      <div class="stat-grid"><div class="stat"><b>${st.total}</b><span>Asignadas</span></div><div class="stat"><b>${st.approved}</b><span>Aprobadas</span></div><div class="stat"><b>${st.rejected}</b><span>Rechazadas</span></div><div class="stat"><b>${pctTxt(st.pct)}</b><span>Cumplimiento</span></div></div>
      <div class="card" style="margin-top:12px"><div class="small muted">Cumplimiento por día · ${st.points} puntos · ${photos} fotos · ${st.expired} vencidas</div>
        <div class="mini-bars" style="margin-top:8px">${days.map(d => { const s = L.stats(per[d] || []); return `<i title="${L.shortDate(d)}: ${s.pct}%" style="height:${s.total ? Math.max(4, s.pct) : 2}%;${s.total ? '' : 'opacity:.2'}"></i>`; }).join('')}</div>
        ${!h.kid && kids().length > 1 ? kids().map(k => { const s = L.stats(base.filter(t => t.child_id === k.id)); return `<div class="list-item">${avatarHTML(k, 'sm')}<div class="grow"><b>${esc(k.display_name)}</b>${barHTML(s.pct, 'thin')}</div><b>${pctTxt(s.pct)}</b></div>`; }).join('') : ''}
      </div>
      ${sectionTitle('🗓️ Actividades')}
      ${rows.length ? Object.entries(L.byDate(rows)).sort((a, b) => b[0].localeCompare(a[0])).map(([d, arr]) => `<div class="day-head"><span>${cap(L.longDate(d))}</span><span class="muted small">${pctTxt(L.stats(per[d] || []).pct)}</span></div>${arr.map(t => histRow(t, true)).join('')}`).join('') : `<div class="card">${empty('🔍', 'No hay actividades con esos filtros.')}</div>`}
      ${sectionTitle('🎁 Recompensas obtenidas')}
      <div class="card">${uses.length ? uses.map(u => `<div class="list-item">${avatarHTML(mem(u.child_id), 'sm')}<div class="grow"><b>${esc(u.reward_name)}</b><div class="small muted">${esc(mem(u.child_id)?.display_name || '')} · ${L.shortDate(u.date)} ${L.fmtTime(u.started_at, tz())} · ${hours(u.minutes)}</div></div></div>`).join('') : empty('🎁', 'Sin recompensas en el período.')}</div>`;
  }
  return {
    title: 'Historial', sub: 'Actividades, fotos y estadísticas', body,
    after: () => {
      $('#hf').onsubmit = e => {
        e.preventDefault();
        const f = e.target, from = L.fromDMY(f.from.value), to = L.fromDMY(f.to.value);
        if (!from || !to) return toast('Revisá las fechas (DD/MM/AAAA)', 'err');
        if (from > to) return toast('La fecha "desde" es posterior a "hasta"', 'err');
        Object.assign(S.hist, { from, to, kid: f.kid.value, cat: f.cat.value, status: f.status.value, rows: null });
        render(true); loadHistory();
      };
    },
  };
};
async function loadHistory() {
  const h = S.hist;
  try {
    const rows = await S.store.listInstances({ from: h.from, to: h.to, childId: h.kid || undefined });
    if (S.hist === h) { h.rows = rows; if (S.tab === 'history') render(true); }
  } catch (e) { toast(e.message, 'err'); }
}
function histRow(t, admin) {
  const k = mem(t.child_id);
  const s = L.STATUS[t.status];
  return `<button class="task" data-act="task" data-id="${t.id}" style="--st:${s.color}">
    ${t.photo_path ? `<img class="thumb" data-photo="${esc(t.photo_path)}" alt="">` : `<div class="emoji">${esc(t.icon)}</div>`}
    <div class="grow"><div class="t ellipsis">${esc(t.title)}</div><div class="s">${admin ? esc(k?.display_name || '') + ' · ' : ''}${t.submitted_at ? 'enviada ' + L.fmtTime(t.submitted_at, tz()) : ''}${t.reviewed_at ? ' · revisada ' + L.fmtTime(t.reviewed_at, tz()) : ''}</div></div>${pill(t)}</button>`;
}

AV.more = () => {
  const ks = S.members;
  const s = set();
  const theme = localStorage.getItem('mc_theme') || 'auto';
  const lastB = s.last_backup;
  return {
    title: 'Más', sub: 'Familia, miembros y configuración',
    body: `
      ${sectionTitle('🏠 Familia')}
      <div class="card">
        <div class="row between"><div><b style="font-size:1.1rem">${esc(S.family.name)}</b><div class="small muted">Código familiar: <code class="k">${esc(S.family.code)}</code></div></div><button class="btn ghost sm" data-act="renameFamily">✏️</button></div>
        <div class="btn-row" style="margin-top:12px"><button class="btn ghost sm" data-act="shareFamily">📤 Enlace de la app</button><button class="btn ghost sm" data-act="copyCode">📋 Copiar código</button></div>
        ${S.store.mode === 'local' ? '<p class="small" style="color:var(--c-pending)">⚠️ Modo local: los datos están solo en este teléfono. Para usar varios teléfonos conectá Supabase (ver guía).</p>' : ''}
      </div>
      ${sectionTitle('👨‍👩‍👧 Miembros', `<span></span>`)}
      <div class="card">
        ${ks.map(m => `<div class="list-item click" data-act="editMember" data-id="${m.id}" style="${m.active ? '' : 'opacity:.5'}">${avatarHTML(m)}<div class="grow"><b>${esc(m.display_name)}</b><div class="small muted">${m.role === 'admin' ? '⭐ Administrador' : '🧒 Hijo/a'}${m.username ? ' · @' + esc(m.username) : ''}${m.id === S.me.id ? ' · vos' : m.user_id ? ' · ✅ con acceso' : ' · 🔑 sin acceso'}${m.active ? '' : ' · desactivado'}</div></div><span class="muted">›</span></div>`).join('')}
        <div class="btn-row" style="margin-top:10px"><button class="btn sm" data-act="newMember" data-role="child">➕ Hijo/a</button><button class="btn ghost sm" data-act="newMember" data-role="admin">➕ Administrador</button></div>
      </div>
      ${sectionTitle('🔔 Notificaciones')}
      <div class="card">${notifStatusHTML()}</div>
      ${sectionTitle('🎨 Apariencia')}
      <div class="card"><div class="chips">${[['auto', '🌗 Automático'], ['light', '☀️ Claro'], ['dark', '🌙 Oscuro']].map(([v, l]) => `<button class="chip ${theme === v ? 'on' : ''}" data-act="theme" data-v="${v}">${l}</button>`).join('')}</div></div>
      ${sectionTitle('📷 Fotografías')}
      <div class="card">
        <label class="f">Calidad de las fotos que se envían</label>
        <div class="chips"><button class="chip ${s.photo_quality !== 'original' ? 'on' : ''}" data-act="photoQ" data-v="optimized">Optimizada (ahorra espacio)</button><button class="chip ${s.photo_quality === 'original' ? 'on' : ''}" data-act="photoQ" data-v="original">Alta calidad</button></div>
        <div class="field" style="margin-top:14px"><label class="f">Conservar fotos durante (días)</label>
          <div class="row"><input class="input grow" id="ret" data-mask="num" value="${esc(s.photo_retention_days ?? 90)}"><button class="btn ghost" data-act="saveRet">Guardar</button></div></div>
        <label class="switch"><span>Eliminar automáticamente las fotos más antiguas</span><input type="checkbox" id="autoClean" ${s.photo_auto_cleanup ? 'checked' : ''}></label>
        <button class="btn outline block" data-act="cleanup">🧹 Limpiar fotos antiguas ahora</button>
        <p class="tiny muted">Solo se borra la imagen: el registro de la actividad y su aprobación quedan en el historial.</p>
      </div>
      ${sectionTitle('💾 Copias de seguridad')}
      <div class="card">
        <div class="small">Último respaldo: <b>${lastB ? L.fmtDateTime(lastB, tz()) : 'nunca'}</b></div>
        <label class="switch"><span>Incluir fotografías (archivo más pesado)</span><input type="checkbox" id="bkPhotos"></label>
        <div class="btn-row"><button class="btn" data-act="exportBk">⬇️ Descargar respaldo</button><button class="btn ghost" data-act="importBk">⬆️ Restaurar</button></div>
        <p class="tiny muted">Incluye miembros, actividades, historial, configuración y registros de recompensas.</p>
      </div>
      ${S.store.mode === 'cloud' ? `${sectionTitle('📡 Notificaciones push (avanzado)')}
      <div class="card"><p class="small muted">Para recibir avisos con la app cerrada hay que activar la función de envío en Supabase (ver guía, paso 6).</p>
        <div class="small">Clave pública: ${s.vapid_public ? '<b style="color:var(--c-approved)">configurada ✅</b>' : '<b>no configurada</b>'}</div>
        <button class="btn ghost block" style="margin-top:10px" data-act="vapid">🔑 Generar / cargar claves VAPID</button></div>` : ''}
      ${sectionTitle('👤 Cuenta')}
      <div class="card">
        <div class="small muted">${esc(S.me.display_name)} · ${S.store.mode === 'cloud' ? 'Nube (Supabase)' : 'Modo local'} · Zona horaria ${esc(tz())} · v${CONFIG.VERSION}</div>
        <div class="btn-row" style="margin-top:12px"><button class="btn ghost" data-act="changePass">🔒 Cambiar contraseña</button><button class="btn bad" data-act="logout">Cerrar sesión</button></div>
        <button class="btn ghost block ${S.installEvt ? '' : 'hidden'}" style="margin-top:10px" data-act="install">⬇️ Instalar la app</button>
      </div>`,
    after: () => {
      $('#autoClean').onchange = e => busy(null, async () => { await S.store.updateFamily({ settings: { photo_auto_cleanup: e.target.checked } }); S.family = S.store.family; toast('Guardado', 'ok'); });
    },
  };
};
function notifStatusHTML() {
  if (!('Notification' in window)) return '<p class="small muted">Este navegador no admite notificaciones del sistema. Vas a ver los avisos dentro de la app (🔔).</p>';
  const p = Notification.permission;
  return p === 'granted' ? '<p class="small">✅ Notificaciones activadas en este teléfono.</p><button class="btn ghost sm" data-act="testNotif">Probar notificación</button>'
    : p === 'denied' ? '<p class="small">🚫 Bloqueadas. Activalas desde los ajustes del navegador (candado junto a la dirección → Notificaciones).</p>'
      : '<button class="btn block" data-act="enableNotif">🔔 Activar notificaciones en este teléfono</button>';
}

// =====================================================================
// PANEL DEL HIJO
// =====================================================================
const KV = {};

KV.home = () => {
  const list = myToday();
  const s = L.stats(list);
  const fix = list.filter(t => ['rejected', 'redo'].includes(t.status));
  const todo = list.filter(t => t.status === 'pending');
  const sent = list.filter(t => t.status === 'submitted');
  const done = list.filter(t => t.status === 'approved');
  const na = list.filter(t => t.status === 'cancelled');
  const fi = fridayInfo(S.me.id);
  const rws = rewardsFor(S.me.id);
  const hour = +L.nowTimeStr(tz()).slice(0, 2);
  const greet = hour < 12 ? 'Buen día' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  return {
    title: `¡Hola, ${esc(S.me.display_name)}! 👋`, sub: `${greet} · ${cap(L.longDate(S.today))}`,
    left: avatarHTML(S.me),
    body: `
      <div class="hero">
        <div class="row between"><div><div class="small muted">Progreso de hoy</div><div class="big-pct">${pctTxt(s.pct)}</div></div><div style="font-size:2.6rem">${s.pct >= 100 ? '🏆' : s.pct >= 50 ? '🚀' : '🌱'}</div></div>
        ${barHTML(s.pct)}
        <div class="small" style="margin-top:10px">${L.motivation(s.pct, s.total)}</div>
        <div class="stat-grid" style="margin-top:14px">
          <div class="stat"><b>${s.approved}</b><span>Aprobadas</span></div><div class="stat"><b>${s.submitted}</b><span>Esperando</span></div>
          <div class="stat"><b>${s.pending}</b><span>Por hacer</span></div><div class="stat"><b>${s.rejected}</b><span>Corregir</span></div>
        </div>
      </div>
      ${fix.length ? sectionTitle('⚠️ Para corregir') + fix.map(t => kidTaskRow(t)).join('') : ''}
      ${sectionTitle(`📝 Por hacer (${todo.length})`)}
      ${todo.length ? todo.map(t => kidTaskRow(t)).join('') : `<div class="card">${empty(s.total ? '🙌' : '🌤️', s.total ? '¡No te queda nada pendiente!' : 'Hoy no tenés actividades asignadas.')}</div>`}
      ${sent.length ? sectionTitle(`📨 Esperando aprobación (${sent.length})`) + sent.map(t => kidTaskRow(t)).join('') : ''}
      ${done.length ? sectionTitle(`✅ Aprobadas (${done.length})`) + done.map(t => kidTaskRow(t)).join('') : ''}
      ${na.length ? `<p class="small muted center" style="margin-top:14px">🚫 ${na.length} actividad(es) no aplican hoy (no afectan tu porcentaje).</p>` : ''}
      ${rws.length ? sectionTitle('🎁 Recompensas de hoy', `<button class="link" data-act="tab" data-tab="rewards">Ver</button>`) + `<div class="card"><div class="chips">${rws.map(r => { const x = rewardState(r, S.me.id); return `<span class="pill" style="--st:${x.k === 'locked' ? 'var(--muted)' : 'var(--c-approved)'}">${x.k === 'locked' ? '🔒' : '🔓'} ${esc(r.icon)} ${esc(r.name)}</span>`; }).join('')}</div></div>` : ''}
      ${sectionTitle('🎉 Viernes de recompensa')}${kidFridayCard(fi)}`,
  };
};
function kidTaskRow(t) {
  const s = L.STATUS[t.status];
  return `<button class="task" data-act="task" data-id="${t.id}" style="--st:${s.color}">
    <div class="emoji">${esc(t.icon)}</div>
    <div class="grow"><div class="t">${esc(t.title)}</div><div class="s">${t.due_time ? '⏰ hasta ' + esc(t.due_time) + ' · ' : ''}${t.points} pts${t.requires_photo ? ' · 📷 foto' : ''}${t.is_habit ? ' · hábito' : ''}</div>
    ${t.note && ['rejected', 'redo'].includes(t.status) ? `<div class="note">💬 ${esc(t.note)}</div>` : ''}</div>${pill(t)}</button>`;
}
function kidFridayCard(fi) {
  const t = thr();
  let state;
  if (fi.row?.status === 'unlocked') {
    const mine = fi.row.votes?.[S.me.id];
    state = `<p style="margin:6px 0 10px"><b>¡Desbloqueado! 🎊 Votá qué prefieren:</b></p>
      <div class="btn-row">${Object.entries(L.FRIDAY_OPTIONS).map(([k, o]) => `<button class="vote ${mine === k ? 'on' : ''}" data-act="vote" data-id="${fi.row.id}" data-v="${k}"><span class="i">${o.icon}</span>${o.label}</button>`).join('')}</div>
      <p class="small muted" style="margin-top:8px">${mine ? 'Tu voto quedó registrado. Papá o mamá confirman la elección.' : 'Tocá una opción para votar.'}</p>`;
  } else if (fi.row) {
    state = `<p style="font-size:1.15rem;margin-top:8px"><b>Este viernes: ${L.FRIDAY_OPTIONS[fi.row.choice]?.icon} ${L.FRIDAY_OPTIONS[fi.row.choice]?.label}</b> ${fi.row.status === 'done' ? '✔️' : '🎉'}</p>`;
  } else if (!fi.isFridayOrLater) {
    state = `<p class="small" style="margin-top:8px">${fi.s.pct >= t ? '¡Vas por buen camino! Mantenelo hasta el viernes 💪' : `Te falta ${pctTxt(Math.round((t - fi.s.pct) * 10) / 10)} para la meta. ¡Vos podés!`}</p>`;
  } else {
    state = `<p class="small" style="margin-top:8px">${fi.s.total ? 'Esta semana no se alcanzó la meta. ¡La próxima sí! 💪' : 'Esta semana no hubo actividades.'}</p>`;
  }
  return `<div class="friday"><div class="row between"><div><div class="small muted">${fi.fam ? 'Meta familiar' : 'Tu meta'} · ${t}% de lunes a viernes</div><div class="big-pct" style="font-size:2rem">${pctTxt(fi.s.pct)}</div></div><div style="font-size:2.4rem">${fi.row ? '🔓' : '🔒'}</div></div>${barHTML(fi.s.pct)}${state}</div>`;
}

KV.progress = () => {
  const mine = S.inst.filter(t => t.child_id === S.me.id);
  const wp = L.weekProgress(mine, S.today);
  const sk = L.streaks(mine, S.today);
  const per = L.byDate(mine);
  const bd = L.badges(mine, S.today);
  const total = mine.filter(t => t.status === 'approved').length;
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => L.addDays(wp.ws, i));
  return {
    title: 'Mi progreso', sub: 'Semana, rachas e insignias',
    body: `
      <div class="hero"><div class="small muted">Esta semana</div><div class="big-pct">${pctTxt(wp.week.pct)}</div>${barHTML(wp.week.pct)}
        <div class="stat-grid three" style="margin-top:14px"><div class="stat"><b>🔥 ${sk.current}</b><span>Racha actual</span></div><div class="stat"><b>${sk.best}</b><span>Mejor racha</span></div><div class="stat"><b>${wp.week.points}</b><span>Puntos semana</span></div></div></div>
      <div class="card" style="margin-top:14px"><h3>Cumplimiento por día</h3>
        <div class="week-bars" style="margin-top:12px">${days.map(d => { const s = L.stats(per[d] || []); return `<div class="col ${d === S.today ? 'today' : ''} ${s.total ? '' : 'empty'}"><b class="tiny">${s.total ? Math.round(s.pct) + '%' : ''}</b><i data-h="${s.total ? Math.max(4, s.pct) : 4}" style="height:0"></i><span class="tiny">${L.DAY_NAMES[L.dow(d)]}</span></div>`; }).join('')}</div>
        <div class="stat-grid three" style="margin-top:14px"><div class="stat"><b>${wp.week.approved}</b><span>Aprobadas</span></div><div class="stat"><b>${wp.week.pending + wp.week.submitted}</b><span>Pendientes</span></div><div class="stat"><b>${wp.week.rejected}</b><span>Rechazadas</span></div></div>
      </div>
      ${sectionTitle('🎉 Hacia el viernes')}${kidFridayCard(fridayInfo(S.me.id))}
      ${sectionTitle(`🏅 Insignias (${bd.filter(b => b.ok).length}/${bd.length})`)}
      <div class="badges">${bd.map(b => `<div class="bdg ${b.ok ? '' : 'off'}"><div class="i">${b.icon}</div><b>${b.name}</b><span>${b.desc}</span></div>`).join('')}</div>
      <p class="center small muted" style="margin-top:14px">Total de actividades aprobadas: <b>${total}</b></p>`,
  };
};

KV.rewards = () => {
  const rws = rewardsFor(S.me.id);
  const myUses = S.uses.filter(u => u.child_id === S.me.id);
  const myFr = S.fridays.filter(f => f.scope === 'family' || f.scope === S.me.id);
  return {
    title: 'Mis premios', sub: 'Lo que podés conseguir hoy',
    body: `
      ${sectionTitle('🎁 Privilegios de hoy')}
      ${rws.length ? rws.map(r => {
        const x = rewardState(r, S.me.id);
        return `<div class="card"><div class="reward ${x.k === 'locked' ? 'locked' : ''}"><div class="ri">${esc(r.icon)}</div><div class="grow"><b>${esc(r.name)}</b><div class="small muted">${hours(r.minutes)} · se habilita con ${r.min_pct}% del día</div>${r.description ? `<div class="small">${esc(r.description)}</div>` : ''}</div></div>
          <div style="margin-top:12px">${x.k === 'available' ? `<button class="btn ok block" data-act="useReward" data-id="${r.id}">▶️ Usar ahora (${hours(r.minutes)})</button>`
            : x.k === 'active' ? `<div class="center">⏱️ Tiempo restante: <span class="countdown" data-until="${x.until}">…</span></div>`
              : x.k === 'used' ? '<div class="center small muted">✔️ Ya la usaste hoy</div>'
                : `<div class="small muted">🔒 ${x.s.total ? `Te falta ${pctTxt(Math.round(x.need * 10) / 10)} del día para habilitarla` : 'Hoy no hay actividades para habilitarla'}</div>${barHTML(x.s.pct, 'thin')}`}</div></div>`;
      }).join('') : `<div class="card">${empty('🎁', 'Todavía no hay privilegios configurados.')}</div>`}
      ${sectionTitle('🎉 Viernes de recompensa')}${kidFridayCard(fridayInfo(S.me.id))}
      ${sectionTitle('📜 Premios obtenidos')}
      <div class="card">${myUses.length || myFr.length ? [...myFr.map(f => `<div class="list-item"><div class="reward"><div class="ri">${f.choice ? L.FRIDAY_OPTIONS[f.choice].icon : '🔓'}</div></div><div class="grow"><b>Viernes · semana del ${L.shortDate(f.week_start)}</b><div class="small muted">${f.choice ? L.FRIDAY_OPTIONS[f.choice].label : 'Esperando aprobación'} · ${pctTxt(Number(f.pct))}</div></div></div>`),
        ...myUses.map(u => `<div class="list-item"><div class="grow"><b>${esc(u.reward_name)}</b><div class="small muted">${L.shortDate(u.date)} · ${hours(u.minutes)}</div></div></div>`)].join('') : empty('📜', 'Aún no obtuviste premios. ¡A completar actividades!')}</div>`,
  };
};

KV.history = () => {
  const mine = S.inst.filter(t => t.child_id === S.me.id && t.date >= L.addDays(S.today, -30));
  const per = L.byDate(mine);
  return {
    title: 'Mi historial', sub: 'Últimos 30 días',
    body: Object.keys(per).length ? Object.entries(per).sort((a, b) => b[0].localeCompare(a[0])).map(([d, arr]) =>
      `<div class="day-head"><span>${cap(L.longDate(d))}</span><span class="small muted">${pctTxt(L.stats(arr).pct)}</span></div>${arr.map(t => histRow(t, false)).join('')}`).join('')
      : `<div class="card">${empty('🗓️', 'Todavía no hay historial.')}</div>`,
  };
};

KV.me = () => {
  const theme = localStorage.getItem('mc_theme') || 'auto';
  const mine = S.inst.filter(t => t.child_id === S.me.id);
  return {
    title: 'Mi perfil', sub: esc(S.family.name),
    body: `<div class="card center">${avatarHTML(S.me, 'lg', 'margin:0 auto')}
        <h2 style="margin-top:10px">${esc(S.me.display_name)}</h2><div class="small muted">@${esc(S.me.username || '')} · ${mine.filter(t => t.status === 'approved').length} actividades aprobadas</div></div>
      ${sectionTitle('🔔 Notificaciones')}<div class="card">${notifStatusHTML()}</div>
      ${sectionTitle('🎨 Apariencia')}<div class="card"><div class="chips">${[['auto', '🌗 Automático'], ['light', '☀️ Claro'], ['dark', '🌙 Oscuro']].map(([v, l]) => `<button class="chip ${theme === v ? 'on' : ''}" data-act="theme" data-v="${v}">${l}</button>`).join('')}</div></div>
      ${sectionTitle('🔒 Cuenta')}<div class="card"><div class="btn-row"><button class="btn ghost" data-act="changePass">Cambiar PIN</button><button class="btn bad" data-act="logout">Cerrar sesión</button></div>
      <button class="btn ghost block ${S.installEvt ? '' : 'hidden'}" style="margin-top:10px" data-act="install">⬇️ Instalar la app</button></div>`,
  };
};

// =====================================================================
// Ventanas (modales)
// =====================================================================
function taskModal(t) {
  const k = mem(t.child_id);
  const act = S.acts.find(a => a.id === t.activity_id);
  const canDo = !S.isAdmin && t.date === S.today && ['pending', 'rejected', 'redo'].includes(t.status);
  const m = modal(`
    <div class="sheet-head"><div class="row"><div class="emoji" style="width:52px;height:52px;border-radius:16px;background:var(--surface-2);display:grid;place-items:center;font-size:1.8rem">${esc(t.icon)}</div>
      <div><h2>${esc(t.title)}</h2><div class="small muted">${esc(t.category)}${S.isAdmin ? ' · ' + esc(k?.display_name || '') : ''} · ${L.shortDate(t.date)}</div></div></div><button class="icon-btn" data-close aria-label="Cerrar">✕</button></div>
    <div class="row wrap" style="margin-bottom:12px">${pill(t)}${t.due_time ? `<span class="pill">⏰ hasta ${esc(t.due_time)}</span>` : ''}<span class="pill">⭐ ${t.points} pts</span>${t.requires_photo ? '<span class="pill">📷 requiere foto</span>' : ''}${t.late ? '<span class="pill" style="--st:var(--c-pending)">fuera de horario</span>' : ''}</div>
    ${t.description ? `<div class="card"><b>Instrucciones</b><p style="margin:6px 0 0;white-space:pre-wrap">${esc(t.description)}</p></div>` : ''}
    ${act?.image ? `<div class="card"><b>Referencia</b><img src="${esc(act.image)}" alt="" style="border-radius:12px;margin-top:8px"></div>` : ''}
    ${t.is_habit ? '<p class="small muted">💡 Hábito personal: se registra para formar buenas costumbres.</p>' : ''}
    ${t.note ? `<div class="note">💬 ${esc(t.note)}</div>` : ''}
    ${t.photo_path ? `<div class="card"><b>Evidencia enviada</b>${t.submitted_at ? `<div class="small muted">${L.fmtDateTime(t.submitted_at, tz())}</div>` : ''}<img data-photo="${esc(t.photo_path)}" data-zoomphoto="${esc(t.photo_path)}" class="preview" style="margin-top:8px" alt="Evidencia"></div>` : t.photo_deleted ? '<p class="small muted">🗑️ La foto de esta actividad fue eliminada.</p>' : ''}
    ${t.reviewed_at ? `<p class="small muted">Revisada: ${L.fmtDateTime(t.reviewed_at, tz())}${t.reviewed_by ? ' por ' + esc(mem(t.reviewed_by)?.display_name || '') : ''}</p>` : ''}
    ${canDo ? `<button class="btn big block" id="doIt" style="margin-top:14px">🚀 REALIZAR ACTIVIDAD</button>
      <div id="cap" class="hidden" style="margin-top:14px">
        <p class="small">${t.requires_photo ? 'Sacá una foto que muestre la actividad terminada.' : 'Esta actividad no requiere foto, pero podés adjuntar una.'}</p>
        <div class="btn-row"><button class="btn ghost" id="cam">📷 Tomar foto</button><button class="btn ghost" id="gal">🖼️ Elegir imagen</button></div>
        <img id="pv" class="preview hidden" style="margin-top:12px" alt="Vista previa">
        <button class="btn ok big block" id="send" style="margin-top:12px" ${t.requires_photo ? 'disabled' : ''}>${t.requires_photo ? '📤 Enviar evidencia' : '✔️ Marcar como realizada'}</button>
      </div>` : ''}
    ${S.isAdmin ? adminTaskActions(t) : ''}
  `);
  hydrate(m.el);
  if (canDo) {
    let blob = null;
    const pickAndShow = async capture => {
      const f = await pickFile({ capture });
      if (!f) return;
      const q = set().photo_quality === 'original';
      await busy(null, async () => {
        blob = await compressImage(f, q ? 3000 : 1280, q ? 0.92 : 0.8);
        const pv = $('#pv', m.el); pv.src = URL.createObjectURL(blob); pv.classList.remove('hidden');
        const sb = $('#send', m.el); sb.disabled = false; sb.innerHTML = '📤 Enviar evidencia';
      });
    };
    $('#doIt', m.el).onclick = e => { e.target.classList.add('hidden'); $('#cap', m.el).classList.remove('hidden'); };
    $('#cam', m.el).onclick = () => pickAndShow(true);
    $('#gal', m.el).onclick = () => pickAndShow(false);
    $('#send', m.el).onclick = e => busy(e.currentTarget, async () => {
      await S.store.submitTask(t, blob);
      m.close();
      toast('¡Enviada! Ahora esperá la verificación 🙌', 'ok');
      await refresh();
    });
  }
  bindAdminTaskActions(t, m);
}
function adminTaskActions(t) {
  const b = [];
  if (t.status === 'submitted') b.push(`<button class="btn ok" data-ta="approve">✅ Aprobar</button><button class="btn bad" data-ta="reject">❌ Rechazar</button><button class="btn warn" data-ta="redo">📷 Nueva foto</button>`);
  else if (t.status === 'approved') b.push(`<button class="btn bad" data-ta="reject">↩️ Revertir (rechazar)</button>`);
  else if (['pending', 'rejected', 'redo'].includes(t.status) && t.date === S.today) b.push(`<button class="btn ok" data-ta="approve">✅ Aprobar directo</button><button class="btn ghost" data-ta="cancel">🚫 No aplica hoy</button>`);
  else if (t.status === 'cancelled' && t.date === S.today) b.push(`<button class="btn ghost" data-ta="restore">↩️ Restaurar</button>`);
  if (t.photo_path) b.push(`<button class="btn outline" data-ta="delphoto">🗑️ Eliminar foto</button>`);
  return b.length ? `<div class="btn-row" style="margin-top:16px">${b.join('')}</div>` : '';
}
function bindAdminTaskActions(t, m) {
  if (!S.isAdmin) return;
  $$('[data-ta]', m.el).forEach(btn => btn.onclick = async () => {
    const a = btn.dataset.ta;
    if (['approve', 'reject', 'redo'].includes(a)) { if (await review(t.id, a)) m.close(); return; }
    if (a === 'delphoto' && !(await confirmDlg('¿Eliminar esta foto? El registro de la actividad se conserva.', 'Eliminar', true))) return;
    busy(btn, async () => {
      if (a === 'cancel') await S.store.setInstanceStatus(t.id, 'cancelled');
      if (a === 'restore') await S.store.setInstanceStatus(t.id, 'pending');
      if (a === 'delphoto') await S.store.deletePhoto(t);
      m.close(); toast('Listo ✔', 'ok');
      if (S.hist) S.hist.rows = null, loadHistory();
      await refresh();
    });
  });
}

async function review(id, action) {
  let note = null;
  if (action === 'reject') { note = await promptDlg('¿Qué hay que corregir?', { label: 'Observación para tu hijo/a', placeholder: 'Ej: faltó doblar la manta', required: true, okText: 'Rechazar' }); if (note == null) return false; }
  if (action === 'redo') { note = await promptDlg('Pedir nueva foto', { label: 'Motivo (opcional)', placeholder: 'Ej: la foto salió borrosa', okText: 'Pedir nueva foto' }); if (note == null) return false; }
  const card = $(`#ev-${id}`);
  let okDone = false;
  await busy(card?.querySelector(`[data-a="${action}"]`), async () => {
    await S.store.reviewTask(id, action, note);
    okDone = true;
    toast(action === 'approve' ? '✅ Aprobada' : action === 'reject' ? '❌ Rechazada con observación' : '📷 Se pidió una nueva foto', action === 'approve' ? 'ok' : '');
    if (S.hist) { S.hist.rows = null; loadHistory(); }
    await refresh();
  });
  return okDone;
}

function kidTodayModal(kidId) {
  const k = mem(kidId);
  const list = S.inst.filter(t => t.child_id === kidId && t.date === S.today);
  const m = modal(`<div class="sheet-head"><div class="row">${avatarHTML(k)}<div><h2>${esc(k.display_name)}</h2><div class="small muted">Actividades de hoy · ${pctTxt(L.stats(list).pct)}</div></div></div><button class="icon-btn" data-close>✕</button></div>
    ${list.length ? list.map(t => histRow(t, false)).join('') : empty('📋', 'Sin actividades hoy.')}
    <button class="btn ghost block" style="margin-top:14px" data-close data-act="newAct" data-kid="${kidId}">➕ Asignar actividad extra</button>`);
  hydrate(m.el);
  m.el.addEventListener('click', e => { const b = e.target.closest('[data-act="task"]'); if (b) { m.close(); } });
}

function actForm(a, presetKid) {
  const isNew = !a;
  const ks = kids();
  const d = a || { title: '', description: '', category: L.CATEGORIES[0], icon: '✅', frequency: 'daily', days: [0, 1, 2, 3, 4, 5, 6], due_time: '', points: 10, requires_photo: true, is_habit: false, active: true, image: null, child_id: presetKid || S.actFilter || (ks.length === 1 ? ks[0].id : '') };
  let image = d.image || null;
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const m = modal(`
    <div class="sheet-head"><h2>${isNew ? 'Nueva actividad' : 'Editar actividad'}</h2><button class="icon-btn" data-close>✕</button></div>
    <form id="af">
      <div class="field"><label class="f">${isNew ? 'Asignar a' : 'Asignada a'}</label><div class="chips">${S.members.filter(x => x.role === 'child' && (x.active || x.id === d.child_id)).map(k => `<label class="chip ${d.child_id === k.id ? 'on' : ''}"><input type="${isNew ? 'checkbox' : 'radio'}" name="kid" value="${k.id}" ${d.child_id === k.id ? 'checked' : ''} hidden>${esc(k.display_name)}</label>`).join('')}</div></div>
      <div class="field"><label class="f">Nombre de la actividad</label><input class="input" name="title" required value="${esc(d.title)}" placeholder="Ej: Arreglar la cama"></div>
      <div class="field"><label class="f">Ícono</label><div class="emoji-grid">${[...new Set([d.icon, ...L.ICONS])].map(i => `<button type="button" class="${i === d.icon ? 'on' : ''}" data-icon="${esc(i)}">${esc(i)}</button>`).join('')}</div></div>
      <div class="field"><label class="f">Categoría</label><select class="input" name="category">${L.CATEGORIES.map(c => `<option ${c === d.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label class="f">Descripción e instrucciones</label><textarea class="input" name="description" placeholder="Qué tiene que hacer y cómo se verifica">${esc(d.description)}</textarea></div>
      <div class="field"><label class="f">Foto ilustrativa (opcional)</label><img id="aimg" class="preview ${image ? '' : 'hidden'}" src="${esc(image || '')}" alt=""><div class="btn-row" style="margin-top:8px"><button type="button" class="btn ghost sm" id="addImg">🖼️ ${image ? 'Cambiar' : 'Agregar'} foto</button><button type="button" class="btn ghost sm ${image ? '' : 'hidden'}" id="rmImg">Quitar</button></div></div>
      <div class="field"><label class="f">Frecuencia</label><div class="chips">${[['daily', 'Todos los días'], ['custom', 'Días específicos'], ['weekly', 'Semanal'], ['once', 'Extraordinaria']].map(([v, l]) => `<label class="chip ${d.frequency === v ? 'on' : ''}"><input type="radio" name="frequency" value="${v}" ${d.frequency === v ? 'checked' : ''} hidden>${l}</label>`).join('')}</div></div>
      <div class="field" data-show="frequency=custom|weekly"><label class="f">Días</label><div class="chips">${dayOrder.map(i => `<label class="chip ${d.days.includes(i) && d.frequency !== 'daily' ? 'on' : ''}"><input type="checkbox" name="days" value="${i}" ${d.days.includes(i) && d.frequency !== 'daily' ? 'checked' : ''} hidden>${L.DAY_NAMES[i]}</label>`).join('')}</div><p class="tiny muted" data-show="frequency=weekly">Semanal: elegí un solo día.</p></div>
      <div class="field" data-show="frequency=once"><label class="f">Fecha</label><input class="input" name="once_date" data-mask="date" placeholder="DD/MM/AAAA" value="${L.shortDate(d.once_date || S.today)}"></div>
      <div class="row"><div class="field grow"><label class="f">Hora límite (opcional)</label><input class="input" name="due_time" data-mask="time" placeholder="HH:MM" value="${esc(d.due_time || '')}"></div>
      <div class="field grow"><label class="f">Puntos</label><input class="input" name="points" data-mask="num" value="${esc(d.points)}"></div></div>
      <label class="switch"><span>📷 Requiere evidencia fotográfica</span><input type="checkbox" name="requires_photo" ${d.requires_photo ? 'checked' : ''}></label>
      <label class="switch"><span>💡 Es un hábito personal (higiene, cuidado)</span><input type="checkbox" name="is_habit" ${d.is_habit ? 'checked' : ''}></label>
      ${isNew ? '' : `<label class="switch"><span>▶️ Activa</span><input type="checkbox" name="active" ${d.active ? 'checked' : ''}></label>`}
      <button class="btn block big" style="margin-top:10px">💾 Guardar</button>
      ${isNew ? '' : '<button type="button" class="btn outline block" id="delAct" style="margin-top:10px;color:var(--c-rejected)">🗑️ Eliminar actividad</button>'}
    </form>`);
  const f = $('#af', m.el);
  let icon = d.icon;
  const sync = () => {
    $$('label.chip', f).forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
    const fr = f.frequency.value;
    $$('[data-show]', f).forEach(el => { const [, v] = el.dataset.show.split('='); el.classList.toggle('hidden', !v.split('|').includes(fr)); });
  };
  f.addEventListener('change', sync); sync();
  $$('[data-icon]', f).forEach(b => b.onclick = () => { icon = b.dataset.icon; $$('[data-icon]', f).forEach(x => x.classList.toggle('on', x === b)); });
  $('#addImg', f).onclick = async () => { const file = await pickFile(); if (!file) return; image = await blobToDataURL(await compressImage(file, 640, 0.75)); const im = $('#aimg', f); im.src = image; im.classList.remove('hidden'); $('#rmImg', f).classList.remove('hidden'); };
  $('#rmImg', f).onclick = () => { image = null; $('#aimg', f).classList.add('hidden'); $('#rmImg', f).classList.add('hidden'); };
  $('#delAct', f)?.addEventListener('click', async () => {
    if (!(await confirmDlg(`¿Eliminar "${d.title}"? Las actividades ya realizadas quedan en el historial.`, 'Eliminar', true))) return;
    busy(null, async () => { await S.store.deleteActivity(a.id); m.close(); toast('Actividad eliminada', 'ok'); await refresh(); });
  });
  f.onsubmit = e => {
    e.preventDefault();
    const kidsSel = $$('input[name="kid"]:checked', f).map(i => i.value);
    const freq = f.frequency.value;
    let days = $$('input[name="days"]:checked', f).map(i => +i.value);
    let once_date = null;
    if (!kidsSel.length) return toast('Elegí a quién se asigna', 'err');
    if (!f.title.value.trim()) return toast('Escribí el nombre de la actividad', 'err');
    if (freq === 'daily') days = [0, 1, 2, 3, 4, 5, 6];
    if ((freq === 'custom' || freq === 'weekly') && !days.length) return toast('Elegí al menos un día', 'err');
    if (freq === 'weekly' && days.length !== 1) return toast('Para "Semanal" elegí un solo día (o usá "Días específicos")', 'err');
    if (freq === 'once') { once_date = L.fromDMY(f.once_date.value); if (!once_date) return toast('Fecha inválida (DD/MM/AAAA)', 'err'); if (once_date < S.today) return toast('La fecha no puede ser anterior a hoy', 'err'); }
    const due = f.due_time.value.trim();
    if (due && !L.validTime(due)) return toast('Hora límite inválida (HH:MM, ej: 18:30)', 'err');
    const obj = { title: f.title.value.trim(), description: f.description.value.trim(), category: f.category.value, icon, image, frequency: freq, days, once_date,
      due_time: due ? L.normTime(due) : null, points: Math.max(0, parseInt(f.points.value || '0', 10) || 0), requires_photo: f.requires_photo.checked, is_habit: f.is_habit.checked,
      active: isNew ? true : f.active.checked, start_date: S.today };
    busy(f.querySelector('.btn.big'), async () => {
      if (isNew) for (const kid of kidsSel) await S.store.saveActivity({ ...obj, child_id: kid });
      else await S.store.saveActivity({ ...obj, id: a.id, child_id: kidsSel[0] });
      m.close();
      toast(isNew ? `Actividad asignada${kidsSel.length > 1 ? ' a ' + kidsSel.length + ' hijos' : ''} ✔` : 'Cambios guardados ✔', 'ok');
      await refresh();
    });
  };
}

function templatesModal() {
  const ks = kids();
  const groups = {};
  L.CATALOG.forEach((c, i) => (groups[c.category] ||= []).push([c, i]));
  const m = modal(`<div class="sheet-head"><h2>📋 Actividades de ejemplo</h2><button class="icon-btn" data-close>✕</button></div>
    <form id="tf"><div class="field"><label class="f">Asignar a</label><div class="chips">${ks.map(k => `<label class="chip ${ks.length === 1 || S.actFilter === k.id ? 'on' : ''}"><input type="checkbox" name="kid" value="${k.id}" ${ks.length === 1 || S.actFilter === k.id ? 'checked' : ''} hidden>${esc(k.display_name)}</label>`).join('')}</div></div>
    ${Object.entries(groups).map(([cat, arr]) => `<div class="row between" style="margin-top:14px"><b>${esc(cat)}</b><button type="button" class="link" data-all="${esc(cat)}">Todas</button></div>
      ${arr.map(([c, i]) => `<label class="list-item" style="cursor:pointer"><input type="checkbox" name="t" value="${i}" data-cat="${esc(cat)}" style="width:22px;height:22px"><span style="font-size:1.4rem">${c.icon}</span><div class="grow">${esc(c.title)}<div class="tiny muted">${c.requires_photo ? '📷 con foto' : 'sin foto'}${c.is_habit ? ' · hábito' : ''}</div></div></label>`).join('')}`).join('')}
    <p class="small muted">Se crean como diarias, 10 puntos. Después podés editar horarios, días y puntos.</p>
    <button class="btn block big">Asignar seleccionadas</button></form>`);
  const f = $('#tf', m.el);
  f.addEventListener('change', () => $$('label.chip', f).forEach(l => l.classList.toggle('on', l.querySelector('input').checked)));
  $$('[data-all]', f).forEach(b => b.onclick = () => { const boxes = $$(`input[data-cat="${CSS.escape(b.dataset.all)}"]`, f); const all = boxes.every(x => x.checked); boxes.forEach(x => x.checked = !all); });
  f.onsubmit = e => {
    e.preventDefault();
    const kidsSel = $$('input[name="kid"]:checked', f).map(i => i.value);
    const items = $$('input[name="t"]:checked', f).map(i => L.CATALOG[+i.value]);
    if (!kidsSel.length) return toast('Elegí a quién se asignan', 'err');
    if (!items.length) return toast('Marcá al menos una actividad', 'err');
    busy(f.querySelector('.btn'), async () => {
      for (const kid of kidsSel) for (const c of items)
        await S.store.saveActivity({ ...c, child_id: kid, frequency: 'daily', days: [0, 1, 2, 3, 4, 5, 6], once_date: null, due_time: null, points: 10, image: null, active: true, start_date: S.today });
      m.close(); toast(`${items.length * kidsSel.length} actividades asignadas ✔`, 'ok'); await refresh();
    });
  };
}

function rewardForm(r) {
  const isNew = !r;
  const d = r || { name: '', icon: '📱', minutes: 60, min_pct: 100, child_id: null, description: '', active: true };
  const m = modal(`<div class="sheet-head"><h2>${isNew ? 'Nuevo privilegio' : 'Editar privilegio'}</h2><button class="icon-btn" data-close>✕</button></div>
    <form id="rf">
      <div class="field"><label class="f">Nombre</label><input class="input" name="name" required value="${esc(d.name)}" placeholder="Ej: Tiempo de celular"></div>
      <div class="field"><label class="f">Ícono</label><div class="emoji-grid">${L.REWARD_ICONS.map(i => `<button type="button" class="${i === d.icon ? 'on' : ''}" data-icon="${i}">${i}</button>`).join('')}</div></div>
      <div class="field"><label class="f">Tiempo disponible (minutos)</label><div class="chips" style="margin-bottom:8px">${[30, 60, 120].map(v => `<button type="button" class="chip" data-min="${v}">${hours(v)}</button>`).join('')}</div><input class="input" name="minutes" data-mask="num" value="${d.minutes}"></div>
      <div class="field"><label class="f">Se habilita al llegar al (% del día)</label><div class="chips" style="margin-bottom:8px">${[50, 80, 100].map(v => `<button type="button" class="chip" data-pct="${v}">${v}%</button>`).join('')}</div><input class="input" name="min_pct" data-mask="num" value="${d.min_pct}"></div>
      <div class="field"><label class="f">Para</label><select class="input" name="child"><option value="">Todos los hijos</option>${kids().map(k => `<option value="${k.id}" ${d.child_id === k.id ? 'selected' : ''}>${esc(k.display_name)}</option>`).join('')}</select></div>
      <div class="field"><label class="f">Reglas o detalle (opcional)</label><textarea class="input" name="description" placeholder="Ej: aire acondicionado recreativo según las reglas de la casa">${esc(d.description)}</textarea></div>
      ${isNew ? '' : `<label class="switch"><span>Activo</span><input type="checkbox" name="active" ${d.active ? 'checked' : ''}></label>`}
      <button class="btn block big">💾 Guardar</button>
      ${isNew ? '' : '<button type="button" id="delRw" class="btn outline block" style="margin-top:10px;color:var(--c-rejected)">🗑️ Eliminar</button>'}
    </form>`);
  const f = $('#rf', m.el); let icon = d.icon;
  $$('[data-icon]', f).forEach(b => b.onclick = () => { icon = b.dataset.icon; $$('[data-icon]', f).forEach(x => x.classList.toggle('on', x === b)); });
  $$('[data-min]', f).forEach(b => b.onclick = () => f.minutes.value = b.dataset.min);
  $$('[data-pct]', f).forEach(b => b.onclick = () => f.min_pct.value = b.dataset.pct);
  $('#delRw', f)?.addEventListener('click', async () => { if (await confirmDlg('¿Eliminar este privilegio?', 'Eliminar', true)) busy(null, async () => { await S.store.deleteReward(r.id); m.close(); await refresh(); }); });
  f.onsubmit = e => {
    e.preventDefault();
    const minutes = parseInt(f.minutes.value, 10), pct = parseInt(f.min_pct.value, 10);
    if (!f.name.value.trim()) return toast('Escribí un nombre', 'err');
    if (!(minutes > 0)) return toast('Indicá los minutos', 'err');
    if (!(pct >= 0 && pct <= 100)) return toast('El porcentaje debe estar entre 0 y 100', 'err');
    busy(f.querySelector('.btn.big'), async () => {
      await S.store.saveReward({ id: r?.id, name: f.name.value.trim(), icon, minutes, min_pct: pct, child_id: f.child.value || null, description: f.description.value.trim(), active: isNew ? true : f.active.checked });
      m.close(); toast('Guardado ✔', 'ok'); await refresh();
    });
  };
}

function memberForm(mb, role) {
  const isNew = !mb;
  const d = mb || { role, display_name: '', username: '', color: COLORS[S.members.length % COLORS.length], avatar: null, active: true };
  let avatar = d.avatar, color = d.color;
  const isMe = mb && mb.id === S.me.id;
  const m = modal(`<div class="sheet-head"><h2>${isNew ? (role === 'admin' ? 'Nuevo administrador' : 'Nuevo hijo/a') : 'Editar miembro'}</h2><button class="icon-btn" data-close>✕</button></div>
    <form id="mf">
      <div class="center" style="margin-bottom:12px"><div id="avp" style="display:inline-block">${avatarHTML({ ...d, avatar, color }, 'lg')}</div><div><button type="button" class="link" id="pic">📷 Foto de perfil</button></div></div>
      <div class="field"><label class="f">Nombre</label><input class="input" name="name" required value="${esc(d.display_name)}"></div>
      ${isMe && !d.username ? '' : `<div class="field"><label class="f">Usuario para iniciar sesión</label><input class="input" name="username" value="${esc(d.username || '')}" placeholder="ej: sofi" autocapitalize="none" autocomplete="off" ${isMe ? 'readonly' : 'required'}><p class="tiny muted">Solo letras minúsculas, números, punto o guion. Sin espacios.</p></div>`}
      <div class="field"><label class="f">Color</label><div class="chips">${COLORS.map(c => `<button type="button" class="chip" data-color="${c}" style="background:${c};border-color:${c === color ? 'var(--text)' : c};width:40px;padding:0"></button>`).join('')}</div></div>
      ${isNew || isMe ? '' : `<label class="switch"><span>Activo</span><input type="checkbox" name="active" ${d.active ? 'checked' : ''}></label>`}
      <button class="btn block big">💾 Guardar</button>
      ${!isNew && !isMe ? `<button type="button" class="btn ghost block" id="acc" style="margin-top:10px">🔑 ${d.user_id ? 'Cambiar PIN / nuevo acceso' : 'Crear acceso con PIN'}</button>
        <button type="button" class="btn outline block" id="delM" style="margin-top:10px;color:var(--c-rejected)">🗑️ Eliminar definitivamente</button>` : ''}
    </form>`);
  const f = $('#mf', m.el);
  const repaint = () => { $('#avp', f).innerHTML = avatarHTML({ ...d, display_name: f.name.value || d.display_name, avatar, color }, 'lg'); };
  $('#pic', f).onclick = async () => { const file = await pickFile(); if (!file) return; avatar = await blobToDataURL(await compressImage(file, 256, 0.8)); repaint(); };
  $$('[data-color]', f).forEach(b => b.onclick = () => { color = b.dataset.color; $$('[data-color]', f).forEach(x => x.style.borderColor = x.dataset.color === color ? 'var(--text)' : x.dataset.color); repaint(); });
  $('#acc', f)?.addEventListener('click', () => { m.close(); accessModal(mb); });
  $('#delM', f)?.addEventListener('click', async () => {
    if (!(await confirmDlg(`¿Eliminar a ${d.display_name} y TODO su historial y fotos? Esta acción no se puede deshacer. Si solo querés pausarlo, desactivá el interruptor "Activo".`, 'Eliminar todo', true))) return;
    busy(null, async () => { await S.store.deleteMember(mb.id); m.close(); toast('Miembro eliminado', 'ok'); await refresh(); });
  });
  f.onsubmit = e => {
    e.preventDefault();
    const username = f.username ? f.username.value.trim().toLowerCase() : null;
    if (f.username && !isMe && !/^[a-z0-9._-]{2,30}$/.test(username)) return toast('Usuario inválido: usá letras minúsculas, números, punto o guion (mín. 2)', 'err');
    busy(f.querySelector('.btn.big'), async () => {
      const saved = await S.store.saveMember({ id: mb?.id, role: d.role, display_name: f.name.value.trim(), username: username || d.username || null, avatar, color, active: isNew || isMe ? true : f.active.checked });
      m.close(); toast('Guardado ✔', 'ok'); await refresh();
      if (isNew) accessModal(saved);
    });
  };
}

function accessModal(mb) {
  const sug = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  const m = modal(`<div class="sheet-head"><h2>🔑 Acceso de ${esc(mb.display_name)}</h2><button class="icon-btn" data-close>✕</button></div>
    <form id="pf"><p class="small muted">Elegí un PIN de 6 números. ${mb.user_id ? 'El PIN anterior dejará de funcionar.' : ''}</p>
      <div class="field"><input class="input pin" name="pin" data-mask="pin" value="${sug}" required></div>
      <button class="btn block big">Crear acceso</button></form>`);
  const f = $('#pf', m.el);
  f.onsubmit = e => {
    e.preventDefault();
    const pin = f.pin.value;
    if (!/^\d{6}$/.test(pin)) return toast('El PIN debe tener exactamente 6 números', 'err');
    busy(f.querySelector('.btn'), async () => {
      await S.store.createAccess(mb.id, pin);
      const link = familyLink(mb.username);
      const msg = `🏠 *Mi Casa – Mis Responsabilidades*\nAcceso de ${mb.display_name}\n\n1️⃣ Abrí este enlace: ${link}\n2️⃣ Elegí "Hijo / Hija"\n\nCódigo familiar: ${S.family.code}\nUsuario: ${mb.username}\nPIN: ${pin}\n\n📲 Después: menú ⋮ → "Instalar app" o "Agregar a pantalla principal".`;
      m.el.innerHTML = `<div class="grab"></div><div class="sheet-head"><h2>✅ Acceso listo</h2><button class="icon-btn" data-close>✕</button></div>
        <div class="card"><div class="list-item"><span>Código familiar</span><code class="k" style="margin-left:auto">${esc(S.family.code)}</code></div>
        <div class="list-item"><span>Usuario</span><code class="k" style="margin-left:auto">${esc(mb.username)}</code></div>
        <div class="list-item"><span>PIN</span><code class="k" style="margin-left:auto">${pin}</code></div></div>
        ${S.store.mode === 'local' ? '<p class="small" style="color:var(--c-pending)">Modo local: este acceso funciona solo en ESTE teléfono (cerrá sesión e ingresá como hijo/a para probar).</p>' : '<p class="small muted">Enviáselo a su teléfono. Al abrir el enlace ya queda el servidor y el código cargado.</p>'}
        <div class="btn-row"><button class="btn" id="shr">📤 Enviar por WhatsApp</button><button class="btn ghost" id="cpy">📋 Copiar</button></div>`;
      $('#shr', m.el).onclick = () => share(msg);
      $('#cpy', m.el).onclick = () => copy(msg);
      await refresh();
    });
  };
}

function openNotifs() {
  const m = modal(`<div class="sheet-head"><h2>🔔 Notificaciones</h2><button class="icon-btn" data-close>✕</button></div>
    ${S.notifs.length ? S.notifs.map(n => `<div class="notif ${n.read ? '' : 'unread'}"><b>${esc(n.title)}</b><div class="small">${esc(n.body)}</div><div class="tiny muted">${L.fmtDateTime(n.created_at, tz())}</div></div>`).join('') : empty('🔕', 'Sin notificaciones.')}`,
  { onClose: () => render(true) });
  if (unread()) S.store.markAllRead().then(() => S.notifs.forEach(n => n.read = true)).catch(() => {});
  return m;
}

async function passModal() {
  const kid = !S.isAdmin;
  const m = modal(`<div class="sheet-head"><h2>${kid ? 'Cambiar PIN' : 'Cambiar contraseña'}</h2><button class="icon-btn" data-close>✕</button></div>
    <form id="cp"><div class="field"><label class="f">${kid ? 'Nuevo PIN (6 números)' : 'Nueva contraseña (mín. 6)'}</label><input class="input ${kid ? 'pin' : ''}" type="password" name="p1" ${kid ? 'data-mask="pin"' : ''} required></div>
    <div class="field"><label class="f">Repetir</label><input class="input ${kid ? 'pin' : ''}" type="password" name="p2" ${kid ? 'data-mask="pin"' : ''} required></div>
    <button class="btn block big">Guardar</button></form>`);
  const f = $('#cp', m.el);
  f.onsubmit = e => {
    e.preventDefault();
    if (f.p1.value !== f.p2.value) return toast('No coinciden', 'err');
    if (kid && !/^\d{6}$/.test(f.p1.value)) return toast('El PIN debe tener 6 números', 'err');
    if (f.p1.value.length < 6) return toast('Mínimo 6 caracteres', 'err');
    busy(f.querySelector('.btn'), async () => { await S.store.changePassword(f.p1.value); m.close(); toast('Actualizado ✔', 'ok'); });
  };
}

async function vapidModal() {
  const m = modal(`<div class="sheet-head"><h2>🔑 Claves VAPID (push)</h2><button class="icon-btn" data-close>✕</button></div>
    <p class="small muted">Las claves permiten que Supabase envíe notificaciones aunque la app esté cerrada. Generalas una sola vez.</p>
    <button class="btn block" id="gen">Generar claves nuevas</button>
    <div id="out"></div>
    <div class="field" style="margin-top:14px"><label class="f">Clave pública que usa la familia</label><textarea class="input" id="pub" placeholder="Pegá la clave pública">${esc(set().vapid_public || '')}</textarea></div>
    <button class="btn ok block" id="savePub">Guardar clave pública</button>`);
  $('#gen', m.el).onclick = async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const pub = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    $('#out', m.el).innerHTML = `<div class="card" style="margin-top:12px"><b>Clave pública</b><p><code class="k" style="font-size:.75rem">${pub}</code></p>
      <b>Clave privada</b> <span class="tiny" style="color:var(--c-rejected)">(secreta: solo va en Supabase, no la compartas)</span><p><code class="k" style="font-size:.75rem">${jwk.d}</code></p>
      <div class="btn-row"><button class="btn ghost sm" id="c1">Copiar pública</button><button class="btn ghost sm" id="c2">Copiar privada</button></div></div>`;
    $('#pub', m.el).value = pub;
    $('#c1', m.el).onclick = () => copy(pub); $('#c2', m.el).onclick = () => copy(jwk.d);
  };
  $('#savePub', m.el).onclick = e => busy(e.target, async () => {
    await S.store.updateFamily({ settings: { vapid_public: $('#pub', m.el).value.trim() } }); S.family = S.store.family;
    toast('Guardada. Activá las notificaciones en cada teléfono.', 'ok'); setupPush(); render(true);
  });
}

// =====================================================================
// Acciones (botones con data-act)
// =====================================================================
const A = {
  tab: el => { S.tab = el.dataset.tab; render(); },
  bell: () => openNotifs(),
  task: el => { const t = S.inst.find(x => x.id === el.dataset.id) || S.hist?.rows?.find(x => x.id === el.dataset.id); if (t) taskModal(t); },
  review: el => review(el.dataset.id, el.dataset.a),
  kidToday: el => kidTodayModal(el.dataset.id),
  newAct: el => actForm(null, el.dataset.kid),
  editAct: el => actForm(S.acts.find(a => a.id === el.dataset.id)),
  templates: () => templatesModal(),
  actFilter: el => { S.actFilter = el.dataset.id; render(true); },
  editReward: el => rewardForm(S.rewards.find(r => r.id === el.dataset.id)),
  rewardExamples: el => busy(el, async () => {
    for (const r of [{ name: 'Tiempo de celular', icon: '📱', minutes: 60, min_pct: 100 }, { name: 'Tiempo de entretenimiento', icon: '🎮', minutes: 60, min_pct: 80 }, { name: 'Aire acondicionado recreativo', icon: '❄️', minutes: 120, min_pct: 100, description: 'Uso recreativo según las reglas familiares.' }])
      await S.store.saveReward({ ...r, active: true });
    toast('Recompensas de ejemplo creadas ✔', 'ok'); await refresh();
  }),
  useReward: async el => {
    const r = S.rewards.find(x => x.id === el.dataset.id);
    if (!(await confirmDlg(`¿Empezar "${r.name}" ahora? El tiempo (${hours(r.minutes)}) empieza a correr.`, 'Empezar'))) return;
    busy(el, async () => { await S.store.useReward(r.id); confetti(); toast('¡A disfrutar! ⏱️', 'ok'); await refresh(); });
  },
  vote: el => busy(el, async () => { await S.store.voteFriday(el.dataset.id, el.dataset.v); toast('¡Voto registrado!', 'ok'); await refresh(); }),
  fridayDecide: async el => {
    const o = L.FRIDAY_OPTIONS[el.dataset.v];
    if (!(await confirmDlg(`¿Aprobar el premio del viernes: ${o.icon} ${o.label}?`, 'Aprobar'))) return;
    busy(el, async () => { await S.store.decideFriday(el.dataset.id, { status: 'approved', choice: el.dataset.v }); toast('Premio aprobado 🎉', 'ok'); await refresh(); });
  },
  fridayDone: el => busy(el, async () => { await S.store.decideFriday(el.dataset.id, { status: 'done' }); toast('Registrado ✔', 'ok'); await refresh(); }),
  setThr: async el => {
    let v = el.dataset.v;
    if (v === 'custom') { v = await promptDlg('Porcentaje mínimo semanal', { label: 'Entre 1 y 100', value: String(thr()), multiline: false }); if (v == null) return; }
    v = parseInt(v, 10); if (!(v >= 1 && v <= 100)) return toast('Debe estar entre 1 y 100', 'err');
    busy(null, async () => { await S.store.updateFamily({ settings: { weekly_threshold: v } }); S.family = S.store.family; await refresh(); });
  },
  setMode: el => busy(null, async () => { await S.store.updateFamily({ settings: { friday_mode: el.dataset.v } }); S.family = S.store.family; await refresh(); }),
  newMember: el => memberForm(null, el.dataset.role),
  editMember: el => memberForm(S.members.find(x => x.id === el.dataset.id)),
  renameFamily: async () => { const v = await promptDlg('Nombre de la familia', { value: S.family.name, multiline: false, required: true }); if (v) busy(null, async () => { await S.store.updateFamily({ name: v }); S.family = S.store.family; render(true); }); },
  shareFamily: () => share(`🏠 Mi Casa – Mis Responsabilidades\nAbrí la app: ${familyLink()}\nCódigo familiar: ${S.family.code}`),
  copyCode: () => copy(S.family.code),
  theme: el => { localStorage.setItem('mc_theme', el.dataset.v); applyTheme(); render(true); },
  photoQ: el => busy(null, async () => { await S.store.updateFamily({ settings: { photo_quality: el.dataset.v } }); S.family = S.store.family; render(true); }),
  saveRet: el => { const v = parseInt($('#ret').value, 10); if (!(v >= 1)) return toast('Indicá una cantidad de días válida', 'err'); busy(el, async () => { await S.store.updateFamily({ settings: { photo_retention_days: v } }); S.family = S.store.family; toast('Guardado ✔', 'ok'); }); },
  cleanup: async el => {
    const days = Number(set().photo_retention_days ?? 90);
    if (!(await confirmDlg(`¿Eliminar las fotos con más de ${days} días? Los registros se conservan.`, 'Limpiar', true))) return;
    busy(el, async () => { const n = await S.store.cleanupPhotos(L.addDays(S.today, -days)); toast(`${n} foto(s) eliminada(s)`, 'ok'); await refresh(); });
  },
  exportBk: el => busy(el, async () => {
    const data = await S.store.exportAll($('#bkPhotos')?.checked, (i, n) => { el.innerHTML = `⏳ Fotos ${i}/${n}`; });
    download(`micasa-respaldo-${S.today}.json`, JSON.stringify(data));
    await S.store.updateFamily({ settings: { last_backup: new Date().toISOString() } }); S.family = S.store.family;
    toast('Respaldo descargado ✔', 'ok'); render(true);
  }),
  importBk: async () => {
    const file = await pickFile({ accept: '.json,application/json' });
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { return toast('El archivo no es un respaldo válido', 'err'); }
    if (data.app !== 'micasa') return toast('El archivo no es un respaldo de Mi Casa', 'err');
    if (!(await confirmDlg(`¿Restaurar el respaldo del ${L.fmtDateTime(data.exported_at, tz())}? Se agregan o actualizan los registros (no se borra nada).`, 'Restaurar'))) return;
    const btn = $('[data-act="importBk"]');
    busy(btn, async () => { await S.store.importAll(data, step => { if (btn) btn.innerHTML = '⏳ ' + step; }); toast('Respaldo restaurado ✔', 'ok'); await refresh(false); });
  },
  enableNotif: async () => {
    const p = await Notification.requestPermission();
    if (p === 'granted') { toast('Notificaciones activadas ✔', 'ok'); setupPush(); } else toast('No se otorgó el permiso', 'err');
    render(true);
  },
  testNotif: () => sysNotify('Mi Casa', 'Así se ven las notificaciones 👍', 'test', true),
  vapid: () => vapidModal(),
  changePass: () => passModal(),
  logout: async () => {
    if (!(await confirmDlg('¿Cerrar sesión en este teléfono?', 'Cerrar sesión'))) return;
    try { const reg = await navigator.serviceWorker?.getRegistration(); const sub = await reg?.pushManager?.getSubscription(); await sub?.unsubscribe(); } catch {}
    await S.store.logout(); S.me = null; S.hist = null; renderLogin();
  },
  histQuick: el => { const d = +el.dataset.d; Object.assign(S.hist, { from: L.addDays(S.today, -d), to: S.today, rows: null }); render(true); loadHistory(); },
  install: async () => { if (!S.installEvt) return; S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; $$('[data-act="install"]').forEach(b => b.classList.add('hidden')); },
};

document.addEventListener('click', e => {
  const z = e.target.closest('[data-zoomphoto]');
  if (z) { S.store.photoUrl(z.dataset.zoomphoto).then(zoom).catch(() => {}); return; }
  const el = e.target.closest('[data-act]');
  if (!el || !A[el.dataset.act]) return;
  e.preventDefault();
  A[el.dataset.act](el, e);
});

// =====================================================================
// Notificaciones del sistema y recordatorios
// =====================================================================
async function sysNotify(title, body, tag, force) {
  if (!('Notification' in window) || Notification.permission !== 'granted') { if (force) toast(title + ' · ' + body); return; }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, tag: tag || 'micasa', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', renotify: true };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch { toast(title + ' · ' + body); }
}
function b64ToU8(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64.length % 4) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
async function setupPush() {
  try {
    if (S.store.mode !== 'cloud' || !('PushManager' in window) || Notification.permission !== 'granted') return;
    const key = set().vapid_public; if (!key) return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const want = b64ToU8(key);
    if (sub && sub.options?.applicationServerKey) {
      const cur = new Uint8Array(sub.options.applicationServerKey);
      if (cur.length !== want.length || cur.some((b, i) => b !== want[i])) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    await S.store.savePushSubscription(sub.toJSON());
  } catch (e) { console.warn('push', e); }
}
function afterEnter() {
  setupPush();
  if (S.isAdmin) {
    const n = pendingReview().length;
    if (n) toast(`Tenés ${n} evidencia(s) por revisar 📸`);
    const s = set();
    if (s.photo_auto_cleanup && localStorage.getItem('mc_autoclean') !== S.today) {
      localStorage.setItem('mc_autoclean', S.today);
      S.store.cleanupPhotos(L.addDays(S.today, -Number(s.photo_retention_days ?? 90))).catch(() => {});
    }
  } else {
    const n = myToday().filter(t => ['pending', 'rejected', 'redo'].includes(t.status)).length;
    if (n) toast(`Tenés ${n} actividad(es) por completar hoy 💪`);
  }
}
function checkDueReminders() {
  if (S.isAdmin || !S.me) return;
  const now = L.nowTimeStr(tz());
  const [h, m] = now.split(':').map(Number);
  const in30 = `${String(Math.floor((h * 60 + m + 30) / 60) % 24).padStart(2, '0')}:${String((m + 30) % 60).padStart(2, '0')}`;
  for (const t of myToday()) {
    if (!t.due_time || !['pending', 'rejected', 'redo'].includes(t.status)) continue;
    const key = 'mc_rem_' + t.id;
    if (t.due_time > now && t.due_time <= in30 && !localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      sysNotify('⏰ Se acaba el tiempo', `"${t.title}" vence a las ${t.due_time}`, 'due-' + t.id, true);
    }
  }
  if (h >= 17 && localStorage.getItem('mc_evening') !== S.today) {
    const n = myToday().filter(t => ['pending', 'rejected', 'redo'].includes(t.status)).length;
    if (n) { localStorage.setItem('mc_evening', S.today); sysNotify('📝 Te faltan actividades', `Tenés ${n} pendiente(s) para hoy`, 'evening', true); }
  }
}

boot();
