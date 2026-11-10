// Capa de datos en la nube (Supabase): base de datos, inicio de sesión, fotos privadas y tiempo real.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const BUCKET = 'evidencias';
const KID_DOMAIN = 'familia-micasa.app';

function err(e) {
  if (!e) return;
  let msg = e.message || String(e);
  if (/Invalid login credentials/i.test(msg)) msg = 'Usuario, PIN o contraseña incorrectos';
  if (/User already registered/i.test(msg)) msg = 'Ese correo ya está registrado';
  if (/Password should be at least/i.test(msg)) msg = 'La contraseña debe tener al menos 6 caracteres';
  if (/duplicate key.*username/i.test(msg)) msg = 'Ese nombre de usuario ya existe en la familia';
  if (/rate limit/i.test(msg)) msg = 'Demasiados intentos. Esperá unos minutos y probá de nuevo';
  if (/Failed to fetch|NetworkError/i.test(msg)) msg = 'Sin conexión con el servidor. Revisá tu internet';
  throw new Error(msg);
}
const ok = ({ data, error }) => { if (error) err(error); return data; };

export class CloudStore {
  constructor(url, key) {
    this.mode = 'cloud';
    this.url = url; this.key = key;
    this.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'micasa-auth' } });
    this.profile = null; this.family = null;
    this.urlCache = new Map();
    this.channel = null;
  }

  // ---------- Sesión ----------
  async init() {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) return null;
    try { return await this.reloadSession(); } catch { return null; }
  }
  async reloadSession() {
    const { data: u } = await this.sb.auth.getUser();
    if (!u?.user) return null;
    const prof = ok(await this.sb.from('profiles').select('*').eq('user_id', u.user.id).eq('active', true).maybeSingle());
    if (!prof) { await this.sb.auth.signOut(); throw new Error('Esta cuenta no está vinculada a ninguna familia o fue desactivada'); }
    const fam = ok(await this.sb.from('families').select('*').eq('id', prof.family_id).single());
    this.profile = prof; this.family = fam;
    return { profile: prof, family: fam };
  }
  async signUpAdmin({ email, password, familyName, displayName }) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Asuncion';
    const { data, error } = await this.sb.auth.signUp({
      email: email.trim(), password,
      options: { data: { family_name: familyName, display_name: displayName, timezone: tz } },
    });
    if (error) err(error);
    if (!data.session) return { needsConfirm: true };
    return this.reloadSession();
  }
  async loginAdmin(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) err(error);
    return this.reloadSession();
  }
  async loginMember(code, username, pin) {
    const email = ok(await this.sb.rpc('resolve_login', { p_code: code, p_username: username }));
    if (!email) throw new Error('No se encontró ese usuario en la familia. Revisá el código familiar y el usuario');
    const { error } = await this.sb.auth.signInWithPassword({ email, password: pin });
    if (error) err(error);
    return this.reloadSession();
  }
  async logout() { this.unsubscribe(); await this.sb.auth.signOut(); this.profile = this.family = null; }
  async changePassword(pw) { const { error } = await this.sb.auth.updateUser({ password: pw }); if (error) err(error); }

  // ---------- Familia y miembros ----------
  async updateFamily(patch) {
    const upd = {};
    if (patch.name != null) upd.name = patch.name;
    if (patch.settings) upd.settings = { ...this.family.settings, ...patch.settings };
    this.family = ok(await this.sb.from('families').update(upd).eq('id', this.family.id).select().single());
    return this.family;
  }
  async listMembers() {
    return ok(await this.sb.from('profiles').select('id,family_id,role,display_name,username,avatar,color,active,created_at,user_id').order('created_at'));
  }
  async saveMember(m) {
    const row = { role: m.role, display_name: m.display_name, username: m.username ? m.username.toLowerCase().trim() : null, avatar: m.avatar ?? null, color: m.color, active: m.active ?? true };
    if (m.id) return ok(await this.sb.from('profiles').update(row).eq('id', m.id).select().single());
    return ok(await this.sb.from('profiles').insert({ ...row, family_id: this.family.id }).select().single());
  }
  async deleteMember(id) {
    const rows = ok(await this.sb.from('task_instances').select('photo_path').eq('child_id', id).not('photo_path', 'is', null));
    await this.removePaths(rows.map(r => r.photo_path));
    ok(await this.sb.from('profiles').delete().eq('id', id));
  }
  async createAccess(profileId, pin) {
    const token = ok(await this.sb.rpc('create_invite', { p_profile: profileId }));
    const rnd = crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 12);
    const email = `u${rnd}@${KID_DOMAIN}`;
    const tmp = createClient(this.url, this.key, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'micasa-tmp' } });
    const { data, error } = await tmp.auth.signUp({ email, password: pin, options: { data: { invite: token } } });
    if (error) err(error);
    if (!data.session) throw new Error('Supabase pide confirmar el correo. Desactivá "Confirm email" en Authentication → Sign In / Providers → Email (ver guía) y volvé a intentar.');
    await tmp.auth.signOut().catch(() => {});
  }

  // ---------- Actividades ----------
  async listActivities() { return ok(await this.sb.from('activities').select('*').eq('deleted', false).order('created_at')); }
  async saveActivity(a) {
    const row = { child_id: a.child_id, title: a.title, description: a.description || '', category: a.category, icon: a.icon, image: a.image || null,
      frequency: a.frequency, days: a.days, once_date: a.once_date || null, due_time: a.due_time || null, points: a.points,
      requires_photo: a.requires_photo, is_habit: a.is_habit, active: a.active };
    let saved;
    if (a.id) {
      saved = ok(await this.sb.from('activities').update(row).eq('id', a.id).select().single());
      // actualizar las de hoy que todavía no se hicieron
      ok(await this.sb.from('task_instances').update({ title: row.title, description: row.description, category: row.category, icon: row.icon,
        points: row.points, requires_photo: row.requires_photo, due_time: row.due_time, is_habit: row.is_habit })
        .eq('activity_id', a.id).in('status', ['pending', 'redo']));
      if (!row.active) ok(await this.sb.from('task_instances').update({ status: 'cancelled' }).eq('activity_id', a.id).eq('status', 'pending'));
    } else {
      saved = ok(await this.sb.from('activities').insert({ ...row, family_id: this.family.id, start_date: a.start_date }).select().single());
    }
    return saved;
  }
  async deleteActivity(id) {
    ok(await this.sb.from('activities').update({ deleted: true, active: false }).eq('id', id));
    ok(await this.sb.from('task_instances').update({ status: 'cancelled' }).eq('activity_id', id).eq('status', 'pending'));
  }

  // ---------- Actividades del día ----------
  async ensureToday() { return ok(await this.sb.rpc('ensure_today')); }
  async listInstances({ from, to, childId, status } = {}) {
    let q = this.sb.from('task_instances').select('*').order('date', { ascending: false }).order('created_at').limit(5000);
    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);
    if (childId) q = q.eq('child_id', childId);
    if (status) q = q.eq('status', status);
    return ok(await q);
  }
  async submitTask(t, blob) {
    let path = null;
    if (blob) {
      path = `${this.family.id}/${this.profile.id}/${t.date}/${t.id}-${Date.now()}.jpg`;
      ok(await this.sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false }));
    }
    ok(await this.sb.rpc('submit_task', { p_id: t.id, p_photo: path }));
  }
  async reviewTask(id, action, note) { ok(await this.sb.rpc('review_task', { p_id: id, p_action: action, p_note: note || null })); }
  async setInstanceStatus(id, status) { ok(await this.sb.from('task_instances').update({ status }).eq('id', id)); }
  async photoUrl(path) {
    const c = this.urlCache.get(path);
    if (c && c.exp > Date.now()) return c.url;
    const d = ok(await this.sb.storage.from(BUCKET).createSignedUrl(path, 3600));
    this.urlCache.set(path, { url: d.signedUrl, exp: Date.now() + 50 * 60000 });
    return d.signedUrl;
  }
  async photoBlob(path) { return ok(await this.sb.storage.from(BUCKET).download(path)); }
  async removePaths(paths) {
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      if (chunk.length) ok(await this.sb.storage.from(BUCKET).remove(chunk));
    }
  }
  async deletePhoto(t) {
    if (t.photo_path) await this.removePaths([t.photo_path]);
    ok(await this.sb.from('task_instances').update({ photo_path: null, photo_deleted: true }).eq('id', t.id));
  }
  async cleanupPhotos(beforeDate) {
    const rows = ok(await this.sb.from('task_instances').select('id,photo_path').lt('date', beforeDate).not('photo_path', 'is', null));
    await this.removePaths(rows.map(r => r.photo_path));
    for (let i = 0; i < rows.length; i += 200) {
      ok(await this.sb.from('task_instances').update({ photo_path: null, photo_deleted: true }).in('id', rows.slice(i, i + 200).map(r => r.id)));
    }
    return rows.length;
  }

  // ---------- Recompensas ----------
  async listRewards() { return ok(await this.sb.from('rewards').select('*').order('created_at')); }
  async saveReward(r) {
    const row = { name: r.name, icon: r.icon, minutes: r.minutes, min_pct: r.min_pct, child_id: r.child_id || null, description: r.description || '', active: r.active };
    if (r.id) return ok(await this.sb.from('rewards').update(row).eq('id', r.id).select().single());
    return ok(await this.sb.from('rewards').insert({ ...row, family_id: this.family.id }).select().single());
  }
  async deleteReward(id) { ok(await this.sb.from('rewards').delete().eq('id', id)); }
  async listRewardUses({ from, to } = {}) {
    let q = this.sb.from('reward_uses').select('*').order('started_at', { ascending: false }).limit(2000);
    if (from) q = q.gte('date', from); if (to) q = q.lte('date', to);
    return ok(await q);
  }
  async useReward(id) { return ok(await this.sb.rpc('use_reward', { p_reward: id })); }

  // ---------- Viernes ----------
  async refreshFriday() { ok(await this.sb.rpc('refresh_friday')); }
  async listFriday() { return ok(await this.sb.from('friday_rewards').select('*').order('week_start', { ascending: false }).limit(200)); }
  async voteFriday(id, option) { ok(await this.sb.rpc('vote_friday', { p_id: id, p_option: option })); }
  async decideFriday(id, patch) {
    ok(await this.sb.from('friday_rewards').update({ ...patch, approved_by: this.profile.id, approved_at: new Date().toISOString() }).eq('id', id));
  }

  // ---------- Notificaciones ----------
  async listNotifications() {
    return ok(await this.sb.from('notifications').select('*').eq('profile_id', this.profile.id).order('created_at', { ascending: false }).limit(60));
  }
  async markAllRead() { ok(await this.sb.from('notifications').update({ read: true }).eq('profile_id', this.profile.id).eq('read', false)); }
  subscribe(cb) {
    this.unsubscribe();
    const fam = this.family.id, me = this.profile.id;
    this.channel = this.sb.channel('micasa-' + fam)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${me}` }, p => cb({ type: 'notification', row: p.new }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_instances', filter: `family_id=eq.${fam}` }, () => cb({ type: 'instances' }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friday_rewards', filter: `family_id=eq.${fam}` }, () => cb({ type: 'friday' }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reward_uses', filter: `family_id=eq.${fam}` }, () => cb({ type: 'rewards' }))
      .subscribe();
  }
  unsubscribe() { if (this.channel) { this.sb.removeChannel(this.channel); this.channel = null; } }
  async savePushSubscription(sub) {
    ok(await this.sb.from('push_subscriptions').upsert({ family_id: this.family.id, profile_id: this.profile.id, endpoint: sub.endpoint, subscription: sub }, { onConflict: 'endpoint' }));
  }

  // ---------- Respaldo ----------
  async exportAll(includePhotos, onProgress) {
    const all = async (t, sel = '*') => {
      const out = []; let from = 0;
      for (;;) {
        const rows = ok(await this.sb.from(t).select(sel).range(from, from + 999));
        out.push(...rows); if (rows.length < 1000) break; from += 1000;
      }
      return out;
    };
    const data = {
      app: 'micasa', version: 1, exported_at: new Date().toISOString(),
      family: this.family,
      profiles: await all('profiles', 'id,family_id,role,display_name,username,avatar,color,active,created_at'),
      activities: await all('activities'),
      task_instances: await all('task_instances'),
      rewards: await all('rewards'),
      reward_uses: await all('reward_uses'),
      friday_rewards: await all('friday_rewards'),
      photos: {},
    };
    if (includePhotos) {
      const paths = data.task_instances.filter(t => t.photo_path).map(t => t.photo_path);
      let i = 0;
      for (const p of paths) {
        try { data.photos[p] = await blobToDataURL(await this.photoBlob(p)); } catch {}
        onProgress?.(++i, paths.length);
      }
    }
    return data;
  }
  async importAll(d, onProgress) {
    const fam = this.family.id, me = this.profile.id;
    const current = await this.listMembers();
    const curIds = new Set(current.map(m => m.id));
    const pmap = {};
    for (const p of d.profiles || []) {
      if (curIds.has(p.id)) pmap[p.id] = p.id;
      else if (p.role === 'admin') pmap[p.id] = me; // los padres del respaldo se asocian al administrador actual
      else pmap[p.id] = p.id;
    }
    const M = id => (id ? (pmap[id] ?? null) : null);
    const up = async (table, rows) => {
      for (let i = 0; i < rows.length; i += 500) ok(await this.sb.from(table).upsert(rows.slice(i, i + 500), { onConflict: 'id' }));
    };
    onProgress?.('Miembros');
    await up('profiles', (d.profiles || []).filter(p => pmap[p.id] === p.id && p.id !== me).map(p => ({
      id: p.id, family_id: fam, role: p.role, display_name: p.display_name, username: p.username, avatar: p.avatar, color: p.color, active: p.active })));
    if (d.family?.settings) {
      const { last_backup, ...s } = d.family.settings;
      await this.updateFamily({ settings: s });
    }
    onProgress?.('Actividades');
    await up('activities', (d.activities || []).map(a => ({ ...a, family_id: fam, child_id: M(a.child_id) })).filter(a => a.child_id));
    onProgress?.('Historial');
    const actIds = new Set((d.activities || []).map(a => a.id));
    const rows = [];
    for (const t of d.task_instances || []) {
      const child = M(t.child_id); if (!child) continue;
      let path = t.photo_path;
      if (path && d.photos?.[path]) {
        const np = `${fam}/${child}/${t.date}/${t.id}-r.jpg`;
        try {
          const blob = await (await fetch(d.photos[path])).blob();
          const r = await this.sb.storage.from(BUCKET).upload(np, blob, { contentType: 'image/jpeg', upsert: true });
          path = r.error ? null : np;
        } catch { path = null; }
      } else if (path && !path.startsWith(fam + '/')) path = null;
      rows.push({ ...t, family_id: fam, child_id: child, reviewed_by: M(t.reviewed_by), activity_id: actIds.has(t.activity_id) ? t.activity_id : null, photo_path: path, photo_deleted: t.photo_deleted || (!!t.photo_path && !path) });
    }
    await up('task_instances', rows);
    onProgress?.('Recompensas');
    await up('rewards', (d.rewards || []).map(r => ({ ...r, family_id: fam, child_id: M(r.child_id) })));
    const rwIds = new Set((d.rewards || []).map(r => r.id));
    await up('reward_uses', (d.reward_uses || []).map(u => ({ ...u, family_id: fam, child_id: M(u.child_id), reward_id: rwIds.has(u.reward_id) ? u.reward_id : null })).filter(u => u.child_id));
    await up('friday_rewards', (d.friday_rewards || []).map(f => ({ ...f, family_id: fam, child_id: M(f.child_id), approved_by: M(f.approved_by), scope: f.scope === 'family' ? 'family' : (M(f.child_id) || f.scope) })));
  }
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
