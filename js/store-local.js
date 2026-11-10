// Modo local (sin servidor): todo se guarda en este teléfono (IndexedDB).
// Sirve para probar la app antes de configurar Supabase. Implementa la misma
// interfaz y las mismas reglas que la versión en la nube.
import { todayStr, nowTimeStr, addDays, dow } from './logic.js';

const DBN = 'micasa-local', VER = 1;
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DBN, VER);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('photos'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function get(store, key) {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function put(store, key, val) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(val, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function del(store, key) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('micasa:' + s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const EMPTY = () => ({ families: [], profiles: [], creds: {}, activities: [], task_instances: [], rewards: [], reward_uses: [], friday_rewards: [], notifications: [] });

export class LocalStore {
  constructor() {
    this.mode = 'local';
    this.profile = null; this.family = null;
    this.urls = new Map();
    this.bc = 'BroadcastChannel' in self ? new BroadcastChannel('micasa-local') : null;
    this.listeners = [];
    this._pendingNotifs = [];
    if (this.bc) this.bc.onmessage = e => this.listeners.forEach(f => f(e.data));
  }
  async load() { return (await get('kv', 'db')) || EMPTY(); }
  async save(db, evt) {
    await put('kv', 'db', db);
    if (evt) { this.bc?.postMessage(evt); }
  }
  emitSelf(evt) { setTimeout(() => this.listeners.forEach(f => f(evt)), 0); }
  notify(db, profileId, type, title, body, ref = null) {
    const n = { id: uid(), family_id: this.family?.id || db.profiles.find(p => p.id === profileId)?.family_id, profile_id: profileId, type, title, body: body || '', ref, read: false, created_at: now() };
    db.notifications.push(n);
    this._pendingNotifs.push(n);
  }
  async commit(db, type = 'instances') {
    await this.save(db, { type });
    for (const n of this._pendingNotifs || []) {
      const evt = { type: 'notification', row: n };
      this.bc?.postMessage(evt);
      if (n.profile_id === this.profile?.id) this.emitSelf(evt);
    }
    this._pendingNotifs = [];
  }
  me() { if (!this.profile) throw new Error('Sin sesión'); return this.profile; }
  isAdmin() { return this.profile?.role === 'admin'; }
  needAdmin() { if (!this.isAdmin()) throw new Error('Solo los administradores pueden hacer esto'); }
  today(db) { const f = db.families.find(x => x.id === this.family.id); return todayStr(f?.settings?.timezone); }

  // ---------- Sesión ----------
  async init() {
    const id = sessionStorage.getItem('mc_local_sess') || localStorage.getItem('mc_local_sess');
    if (!id) return null;
    sessionStorage.setItem('mc_local_sess', id);
    return this.loadSession(id);
  }
  async loadSession(id) {
    const db = await this.load();
    const p = db.profiles.find(x => x.id === id && x.active);
    if (!p) return null;
    this.profile = p; this.family = db.families.find(f => f.id === p.family_id);
    this._pendingNotifs = [];
    return { profile: p, family: this.family };
  }
  setSess(id) { sessionStorage.setItem('mc_local_sess', id); localStorage.setItem('mc_local_sess', id); }
  async reloadSession() { return this.loadSession(this.profile.id); }
  async signUpAdmin({ email, password, familyName, displayName }) {
    if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
    const db = await this.load();
    if (Object.values(db.creds).some(c => c.email === email.toLowerCase().trim())) throw new Error('Ese correo ya está registrado');
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
    const fam = { id: uid(), name: familyName, code, created_at: now(), settings: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Asuncion', weekly_threshold: 90, friday_mode: 'individual', photo_retention_days: 90, photo_quality: 'optimized' } };
    const p = { id: uid(), family_id: fam.id, role: 'admin', display_name: displayName || 'Administrador', username: null, avatar: null, color: '#4f46e5', active: true, created_at: now(), user_id: 'local' };
    db.families.push(fam); db.profiles.push(p);
    db.creds[p.id] = { email: email.toLowerCase().trim(), hash: await sha(password) };
    await this.save(db);
    this.setSess(p.id);
    return this.loadSession(p.id);
  }
  async loginAdmin(email, password) {
    const db = await this.load(); const h = await sha(password);
    const id = Object.keys(db.creds).find(k => db.creds[k].email === email.toLowerCase().trim() && db.creds[k].hash === h);
    if (!id) throw new Error('Usuario, PIN o contraseña incorrectos');
    this.setSess(id);
    const s = await this.loadSession(id);
    if (!s) throw new Error('Esta cuenta fue desactivada');
    return s;
  }
  async loginMember(code, username, pin) {
    const db = await this.load();
    const fam = db.families.find(f => f.code === code.trim().toUpperCase());
    const p = fam && db.profiles.find(x => x.family_id === fam.id && x.active && (x.username || '').toLowerCase() === username.trim().toLowerCase());
    if (!p || !db.creds[p.id]) throw new Error('No se encontró ese usuario en la familia. Revisá el código familiar y el usuario');
    if (db.creds[p.id].hash !== await sha(pin)) throw new Error('Usuario, PIN o contraseña incorrectos');
    this.setSess(p.id);
    return this.loadSession(p.id);
  }
  async logout() { sessionStorage.removeItem('mc_local_sess'); localStorage.removeItem('mc_local_sess'); this.profile = this.family = null; }
  async changePassword(pw) {
    if (pw.length < 6) throw new Error('Debe tener al menos 6 caracteres');
    const db = await this.load(); db.creds[this.me().id] = { ...(db.creds[this.me().id] || {}), hash: await sha(pw) }; await this.save(db);
  }

  // ---------- Familia y miembros ----------
  async updateFamily(patch) {
    this.needAdmin();
    const db = await this.load(); const f = db.families.find(x => x.id === this.family.id);
    if (patch.name != null) f.name = patch.name;
    if (patch.settings) f.settings = { ...f.settings, ...patch.settings };
    await this.save(db, { type: 'family' }); this.family = f; return f;
  }
  async listMembers() { const db = await this.load(); return db.profiles.filter(p => p.family_id === this.family.id).map(p => ({ ...p, user_id: db.creds[p.id] ? 'local' : null })); }
  async saveMember(m) {
    this.needAdmin();
    const db = await this.load();
    const username = m.username ? m.username.toLowerCase().trim() : null;
    if (username && db.profiles.some(p => p.family_id === this.family.id && p.username === username && p.id !== m.id)) throw new Error('Ese nombre de usuario ya existe en la familia');
    let p = m.id && db.profiles.find(x => x.id === m.id && x.family_id === this.family.id);
    if (p) Object.assign(p, { role: m.role, display_name: m.display_name, username, avatar: m.avatar ?? null, color: m.color, active: m.active ?? true });
    else { p = { id: uid(), family_id: this.family.id, role: m.role, display_name: m.display_name, username, avatar: m.avatar ?? null, color: m.color, active: m.active ?? true, created_at: now() }; db.profiles.push(p); }
    await this.save(db, { type: 'members' }); return p;
  }
  async deleteMember(id) {
    this.needAdmin(); if (id === this.profile.id) throw new Error('No podés eliminarte a vos mismo');
    const db = await this.load();
    for (const t of db.task_instances.filter(t => t.child_id === id && t.photo_path)) await del('photos', t.photo_path);
    db.profiles = db.profiles.filter(p => p.id !== id);
    for (const k of ['activities', 'task_instances', 'reward_uses', 'notifications']) db[k] = db[k].filter(x => x.child_id !== id && x.profile_id !== id);
    db.rewards = db.rewards.filter(r => r.child_id !== id);
    db.friday_rewards = db.friday_rewards.filter(f => f.child_id !== id);
    delete db.creds[id];
    await this.save(db, { type: 'members' });
  }
  async createAccess(profileId, pin) {
    this.needAdmin();
    if (!/^\d{6}$/.test(pin)) throw new Error('El PIN debe tener 6 números');
    const db = await this.load();
    db.creds[profileId] = { hash: await sha(pin) };
    await this.save(db, { type: 'members' });
  }

  // ---------- Actividades ----------
  async listActivities() { const db = await this.load(); return db.activities.filter(a => a.family_id === this.family.id && !a.deleted); }
  async saveActivity(a) {
    this.needAdmin();
    const db = await this.load();
    const fields = ['child_id', 'title', 'description', 'category', 'icon', 'image', 'frequency', 'days', 'once_date', 'due_time', 'points', 'requires_photo', 'is_habit', 'active'];
    let row = a.id && db.activities.find(x => x.id === a.id);
    if (row) {
      fields.forEach(f => row[f] = a[f] ?? null);
      for (const t of db.task_instances.filter(t => t.activity_id === a.id && ['pending', 'redo'].includes(t.status)))
        Object.assign(t, { title: row.title, description: row.description, category: row.category, icon: row.icon, points: row.points, requires_photo: row.requires_photo, due_time: row.due_time, is_habit: row.is_habit });
      if (!row.active) db.task_instances.filter(t => t.activity_id === a.id && t.status === 'pending').forEach(t => t.status = 'cancelled');
    } else {
      row = { id: uid(), family_id: this.family.id, deleted: false, created_at: now(), start_date: a.start_date };
      fields.forEach(f => row[f] = a[f] ?? null);
      db.activities.push(row);
    }
    await this.save(db, { type: 'instances' }); return row;
  }
  async deleteActivity(id) {
    this.needAdmin();
    const db = await this.load(); const a = db.activities.find(x => x.id === id);
    if (a) { a.deleted = true; a.active = false; }
    db.task_instances.filter(t => t.activity_id === id && t.status === 'pending').forEach(t => t.status = 'cancelled');
    await this.save(db, { type: 'instances' });
  }

  // ---------- Actividades del día ----------
  async ensureToday() {
    const db = await this.load(); const fam = this.family.id; const d = this.today(db); const w = dow(d);
    let changed = false;
    for (const t of db.task_instances) if (t.family_id === fam && t.date < d && ['pending', 'redo'].includes(t.status)) { t.status = 'expired'; changed = true; }
    const active = new Set(db.profiles.filter(p => p.active).map(p => p.id));
    for (const a of db.activities) {
      if (a.family_id !== fam || !a.active || a.deleted || !active.has(a.child_id) || a.start_date > d) continue;
      const applies = a.frequency === 'once' ? a.once_date === d : (a.days || []).includes(w);
      if (!applies || db.task_instances.some(t => t.activity_id === a.id && t.date === d)) continue;
      db.task_instances.push({ id: uid(), family_id: fam, activity_id: a.id, child_id: a.child_id, date: d, title: a.title, description: a.description || '', category: a.category, icon: a.icon, points: a.points, requires_photo: a.requires_photo, is_habit: a.is_habit, due_time: a.due_time, status: 'pending', photo_path: null, photo_deleted: false, submitted_at: null, late: false, attempts: 0, reviewed_at: null, reviewed_by: null, note: null, created_at: now() });
      changed = true;
    }
    if (changed) await this.save(db, { type: 'instances' });
    return d;
  }
  async listInstances({ from, to, childId, status } = {}) {
    const db = await this.load();
    return db.task_instances.filter(t => t.family_id === this.family.id && (!from || t.date >= from) && (!to || t.date <= to) && (!childId || t.child_id === childId) && (!status || t.status === status))
      .sort((a, b) => b.date.localeCompare(a.date) || a.created_at.localeCompare(b.created_at));
  }
  async submitTask(task, blob) {
    const me = this.me(); const db = await this.load();
    const t = db.task_instances.find(x => x.id === task.id && x.child_id === me.id);
    if (!t) throw new Error('Actividad no encontrada');
    if (t.date !== this.today(db)) throw new Error('Solo se pueden enviar actividades del día');
    if (!['pending', 'rejected', 'redo'].includes(t.status)) throw new Error('Esta actividad ya fue enviada o no está disponible');
    if (t.requires_photo && !blob) throw new Error('Esta actividad necesita una fotografía');
    if (blob) {
      const path = `${this.family.id}/${me.id}/${t.date}/${t.id}-${Date.now()}.jpg`;
      await put('photos', path, blob); t.photo_path = path; t.photo_deleted = false;
    }
    const tz = this.family.settings?.timezone;
    Object.assign(t, { status: 'submitted', submitted_at: now(), attempts: t.attempts + 1, late: !!(t.due_time && nowTimeStr(tz) > t.due_time) });
    for (const a of db.profiles.filter(p => p.family_id === this.family.id && p.role === 'admin' && p.active))
      this.notify(db, a.id, 'evidence', '📸 Nueva evidencia', `${me.display_name} envió: ${t.title}`, t.id);
    await this.commit(db);
  }
  async reviewTask(id, action, note) {
    this.needAdmin();
    if (!['approve', 'reject', 'redo'].includes(action)) throw new Error('Acción inválida');
    const db = await this.load(); const t = db.task_instances.find(x => x.id === id && x.family_id === this.family.id);
    if (!t) throw new Error('Actividad no encontrada');
    if (t.status === 'cancelled') throw new Error('La actividad está cancelada');
    t.status = { approve: 'approved', reject: 'rejected', redo: 'redo' }[action];
    t.note = (note || '').trim() || null; t.reviewed_at = now(); t.reviewed_by = this.profile.id;
    const extra = t.note ? ': ' + t.note : '';
    if (action === 'approve') this.notify(db, t.child_id, 'approved', '✅ ¡Actividad aprobada!', t.title, t.id);
    if (action === 'reject') this.notify(db, t.child_id, 'rejected', '⚠️ Necesita corrección', t.title + extra, t.id);
    if (action === 'redo') this.notify(db, t.child_id, 'redo', '📷 Enviá una nueva foto', t.title + extra, t.id);
    await this.commit(db);
  }
  async setInstanceStatus(id, status) {
    this.needAdmin();
    const db = await this.load(); const t = db.task_instances.find(x => x.id === id && x.family_id === this.family.id);
    if (t) t.status = status; await this.save(db, { type: 'instances' });
  }
  async photoUrl(path) {
    if (this.urls.has(path)) return this.urls.get(path);
    const b = await get('photos', path); if (!b) throw new Error('Foto no disponible');
    const u = URL.createObjectURL(b); this.urls.set(path, u); return u;
  }
  async photoBlob(path) { return get('photos', path); }
  async deletePhoto(t) {
    this.needAdmin();
    const db = await this.load(); const x = db.task_instances.find(i => i.id === t.id);
    if (x?.photo_path) await del('photos', x.photo_path);
    if (x) { x.photo_path = null; x.photo_deleted = true; }
    await this.save(db, { type: 'instances' });
  }
  async cleanupPhotos(before) {
    this.needAdmin();
    const db = await this.load(); let n = 0;
    for (const t of db.task_instances) if (t.family_id === this.family.id && t.date < before && t.photo_path) { await del('photos', t.photo_path); t.photo_path = null; t.photo_deleted = true; n++; }
    await this.save(db, { type: 'instances' }); return n;
  }

  // ---------- Recompensas ----------
  async listRewards() { const db = await this.load(); return db.rewards.filter(r => r.family_id === this.family.id); }
  async saveReward(r) {
    this.needAdmin();
    const db = await this.load();
    let row = r.id && db.rewards.find(x => x.id === r.id);
    const f = { name: r.name, icon: r.icon, minutes: r.minutes, min_pct: r.min_pct, child_id: r.child_id || null, description: r.description || '', active: r.active };
    if (row) Object.assign(row, f); else { row = { id: uid(), family_id: this.family.id, created_at: now(), ...f }; db.rewards.push(row); }
    await this.save(db, { type: 'rewards' }); return row;
  }
  async deleteReward(id) { this.needAdmin(); const db = await this.load(); db.rewards = db.rewards.filter(r => r.id !== id); await this.save(db, { type: 'rewards' }); }
  async listRewardUses({ from, to } = {}) {
    const db = await this.load();
    return db.reward_uses.filter(u => u.family_id === this.family.id && (!from || u.date >= from) && (!to || u.date <= to)).sort((a, b) => b.started_at.localeCompare(a.started_at));
  }
  async useReward(id) {
    const me = this.me(); const db = await this.load(); const d = this.today(db);
    const r = db.rewards.find(x => x.id === id && x.family_id === this.family.id && x.active && (!x.child_id || x.child_id === me.id));
    if (!r) throw new Error('Recompensa no disponible');
    const list = db.task_instances.filter(t => t.child_id === me.id && t.date === d && t.status !== 'cancelled');
    if (!list.length) throw new Error('Hoy no tenés actividades asignadas');
    const pct = list.filter(t => t.status === 'approved').length * 100 / list.length;
    if (pct < r.min_pct) throw new Error(`Necesitás llegar al ${r.min_pct}% del día para usar esta recompensa`);
    if (db.reward_uses.some(u => u.child_id === me.id && u.reward_id === r.id && u.date === d)) throw new Error('Ya usaste esta recompensa hoy');
    const u = { id: uid(), family_id: this.family.id, child_id: me.id, reward_id: r.id, reward_name: r.name, date: d, minutes: r.minutes, started_at: now() };
    db.reward_uses.push(u);
    for (const a of db.profiles.filter(p => p.family_id === this.family.id && p.role === 'admin' && p.active))
      this.notify(db, a.id, 'reward', '🎁 Recompensa en uso', `${me.display_name} empezó: ${r.name} (${r.minutes} min)`, u.id);
    await this.commit(db, 'rewards'); return u;
  }

  // ---------- Viernes ----------
  async refreshFriday() {
    const db = await this.load(); const fam = this.family.id; const d = this.today(db);
    const iso = dow(d) === 0 ? 7 : dow(d); if (iso < 5) return;
    const ws = addDays(d, -(iso - 1)); const fri = addDays(ws, 4);
    const s = db.families.find(f => f.id === fam).settings; const thr = Number(s.weekly_threshold ?? 90);
    const calc = l => { const v = l.filter(t => t.status !== 'cancelled'); return v.length ? { pct: Math.round(v.filter(t => t.status === 'approved').length * 1000 / v.length) / 10 } : null; };
    const inWeek = t => t.family_id === fam && t.date >= ws && t.date <= fri;
    let changed = false;
    const add = (scope, child, pct) => {
      if (db.friday_rewards.some(f => f.family_id === fam && f.week_start === ws && f.scope === scope)) return false;
      db.friday_rewards.push({ id: uid(), family_id: fam, week_start: ws, scope, child_id: child, pct, status: 'unlocked', votes: {}, choice: null, approved_by: null, approved_at: null, created_at: now() });
      return changed = true;
    };
    if ((s.friday_mode || 'individual') === 'family') {
      const c = calc(db.task_instances.filter(inWeek));
      if (c && c.pct >= thr && add('family', null, c.pct))
        db.profiles.filter(p => p.family_id === fam && p.active).forEach(p => this.notify(db, p.id, 'friday', '🎉 ¡Meta semanal familiar alcanzada!', 'Se desbloqueó el Viernes de recompensa. ¡A votar: cena o delivery!', ws));
    } else {
      for (const k of db.profiles.filter(p => p.family_id === fam && p.role === 'child' && p.active)) {
        const c = calc(db.task_instances.filter(t => inWeek(t) && t.child_id === k.id));
        if (c && c.pct >= thr && add(k.id, k.id, c.pct)) {
          this.notify(db, k.id, 'friday', '🎉 ¡Meta semanal alcanzada!', 'Desbloqueaste el Viernes de recompensa. Elegí: cena o delivery.', ws);
          db.profiles.filter(p => p.family_id === fam && p.role === 'admin' && p.active).forEach(a => this.notify(db, a.id, 'friday', '🎉 Meta semanal alcanzada', `${k.display_name} desbloqueó el Viernes de recompensa`, ws));
        }
      }
    }
    if (changed) await this.commit(db, 'friday');
  }
  async listFriday() { const db = await this.load(); return db.friday_rewards.filter(f => f.family_id === this.family.id).sort((a, b) => b.week_start.localeCompare(a.week_start)); }
  async voteFriday(id, option) {
    const me = this.me();
    if (!['cena', 'delivery'].includes(option)) throw new Error('Opción inválida');
    const db = await this.load(); const f = db.friday_rewards.find(x => x.id === id && x.family_id === this.family.id);
    if (!f) throw new Error('Premio no encontrado');
    if (f.status !== 'unlocked') throw new Error('La votación ya cerró');
    if (f.scope !== 'family' && f.scope !== me.id) throw new Error('Este premio no es tuyo');
    f.votes = { ...f.votes, [me.id]: option };
    await this.save(db, { type: 'friday' });
  }
  async decideFriday(id, patch) {
    this.needAdmin();
    const db = await this.load(); const f = db.friday_rewards.find(x => x.id === id && x.family_id === this.family.id);
    if (f) Object.assign(f, patch, { approved_by: this.profile.id, approved_at: now() });
    await this.save(db, { type: 'friday' });
  }

  // ---------- Notificaciones ----------
  async listNotifications() { const db = await this.load(); return db.notifications.filter(n => n.profile_id === this.profile.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 60); }
  async markAllRead() { const db = await this.load(); db.notifications.filter(n => n.profile_id === this.profile.id).forEach(n => n.read = true); await this.save(db); }
  subscribe(cb) {
    this.listeners = [evt => {
      if (evt.type === 'notification' && evt.row.profile_id !== this.profile?.id) return;
      cb(evt);
    }];
  }
  unsubscribe() { this.listeners = []; }
  async savePushSubscription() { /* en modo local no hay servidor que envíe push */ }

  // ---------- Respaldo ----------
  async exportAll(includePhotos, onProgress) {
    const db = await this.load(); const fam = this.family.id; const f = x => x.family_id === fam;
    const data = { app: 'micasa', version: 1, exported_at: now(), family: db.families.find(x => x.id === fam),
      profiles: db.profiles.filter(f), activities: db.activities.filter(f), task_instances: db.task_instances.filter(f),
      rewards: db.rewards.filter(f), reward_uses: db.reward_uses.filter(f), friday_rewards: db.friday_rewards.filter(f), photos: {} };
    if (includePhotos) {
      const paths = data.task_instances.filter(t => t.photo_path).map(t => t.photo_path); let i = 0;
      for (const p of paths) { const b = await get('photos', p); if (b) data.photos[p] = await blobToDataURL(b); onProgress?.(++i, paths.length); }
    }
    return data;
  }
  async importAll(d, onProgress) {
    this.needAdmin();
    const db = await this.load(); const fam = this.family.id; const me = this.profile.id;
    const cur = new Set(db.profiles.filter(p => p.family_id === fam).map(p => p.id));
    const pmap = {};
    for (const p of d.profiles || []) pmap[p.id] = cur.has(p.id) ? p.id : (p.role === 'admin' ? me : p.id);
    const M = id => (id ? (pmap[id] ?? null) : null);
    const upsert = (k, rows) => { for (const r of rows) { const i = db[k].findIndex(x => x.id === r.id); if (i >= 0) db[k][i] = r; else db[k].push(r); } };
    onProgress?.('Miembros');
    upsert('profiles', (d.profiles || []).filter(p => pmap[p.id] === p.id && p.id !== me).map(p => ({ ...p, family_id: fam })));
    if (d.family?.settings) { const { last_backup, ...s } = d.family.settings; const f = db.families.find(x => x.id === fam); f.settings = { ...f.settings, ...s }; this.family = f; }
    onProgress?.('Actividades');
    upsert('activities', (d.activities || []).map(a => ({ ...a, family_id: fam, child_id: M(a.child_id) })).filter(a => a.child_id));
    onProgress?.('Historial');
    const rows = [];
    for (const t of d.task_instances || []) {
      const child = M(t.child_id); if (!child) continue;
      let path = t.photo_path;
      if (path && d.photos?.[path]) { const np = `${fam}/${child}/${t.date}/${t.id}-r.jpg`; await put('photos', np, await (await fetch(d.photos[path])).blob()); path = np; }
      else if (path && !(await get('photos', path))) path = null;
      rows.push({ ...t, family_id: fam, child_id: child, reviewed_by: M(t.reviewed_by), photo_path: path, photo_deleted: t.photo_deleted || (!!t.photo_path && !path) });
    }
    upsert('task_instances', rows);
    onProgress?.('Recompensas');
    upsert('rewards', (d.rewards || []).map(r => ({ ...r, family_id: fam, child_id: M(r.child_id) })));
    upsert('reward_uses', (d.reward_uses || []).map(u => ({ ...u, family_id: fam, child_id: M(u.child_id) })).filter(u => u.child_id));
    upsert('friday_rewards', (d.friday_rewards || []).map(f => ({ ...f, family_id: fam, child_id: M(f.child_id), scope: f.scope === 'family' ? 'family' : (M(f.child_id) || f.scope) })));
    await this.save(db, { type: 'instances' });
  }
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
