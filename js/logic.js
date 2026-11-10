// Lógica pura compartida: fechas, porcentajes, rachas, insignias y catálogo de ejemplo.

export const STATUS = {
  pending:   { label: 'Por hacer',          color: 'var(--c-pending)',  icon: '⏳' },
  submitted: { label: 'Enviada',            color: 'var(--c-submitted)', icon: '📨' },
  approved:  { label: 'Aprobada',           color: 'var(--c-approved)', icon: '✅' },
  rejected:  { label: 'Rechazada',          color: 'var(--c-rejected)', icon: '❌' },
  redo:      { label: 'Nueva foto pedida',  color: 'var(--c-rejected)', icon: '📷' },
  expired:   { label: 'Vencida',            color: 'var(--c-expired)',  icon: '⌛' },
  cancelled: { label: 'No aplica',          color: 'var(--c-expired)',  icon: '🚫' },
};

export const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const DAY_FULL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// ---------- Fechas (siempre como 'AAAA-MM-DD') ----------
export function todayStr(tz = 'America/Asuncion', now = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now); }
  catch { return new Intl.DateTimeFormat('en-CA').format(now); }
}
export function nowTimeStr(tz = 'America/Asuncion', now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  } catch { return now.toTimeString().slice(0, 5); }
}
export function parseD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
export function fmtD(dt) { return dt.toISOString().slice(0, 10); }
export function addDays(s, n) { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return fmtD(d); }
export function dow(s) { return parseD(s).getUTCDay(); }
export function weekStart(s) { const w = dow(s); return addDays(s, w === 0 ? -6 : 1 - w); } // lunes
export function diffDays(a, b) { return Math.round((parseD(a) - parseD(b)) / 86400000); }
export function longDate(s) {
  const d = parseD(s);
  return `${DAY_FULL[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
}
export function shortDate(s) { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; }
// 'DD/MM/AAAA' -> 'AAAA-MM-DD' (o null si es inválida)
export function fromDMY(t) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((t || '').trim());
  if (!m) return null;
  const s = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = parseD(s);
  return fmtD(d) === s ? s : null;
}
export function validTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim());
  return !!m && +m[1] < 24 && +m[2] < 60;
}
export function normTime(t) { const [h, m] = t.trim().split(':'); return `${h.padStart(2, '0')}:${m}`; }
export function fmtDateTime(iso, tz) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('es-PY', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  } catch { return new Date(iso).toLocaleString(); }
}
export function fmtTime(iso, tz) {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat('es-PY', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)); }
  catch { return new Date(iso).toTimeString().slice(0, 5); }
}

// ---------- Progreso ----------
// Las canceladas ("no aplica") no cuentan. Solo las aprobadas suman.
export function stats(list) {
  const s = { total: 0, approved: 0, submitted: 0, pending: 0, rejected: 0, expired: 0, cancelled: 0, points: 0, pct: 0 };
  for (const t of list) {
    if (t.status === 'cancelled') { s.cancelled++; continue; }
    s.total++;
    if (t.status === 'approved') { s.approved++; s.points += t.points || 0; }
    else if (t.status === 'submitted') s.submitted++;
    else if (t.status === 'rejected' || t.status === 'redo') s.rejected++;
    else if (t.status === 'expired') s.expired++;
    else s.pending++;
  }
  s.pct = s.total ? Math.round((s.approved / s.total) * 1000) / 10 : 0;
  return s;
}
export function byDate(list) {
  const m = {};
  for (const t of list) (m[t.date] ||= []).push(t);
  return m;
}
export function filterRange(list, from, to, childId) {
  return list.filter(t => t.date >= from && t.date <= to && (!childId || t.child_id === childId));
}

// Racha: días consecutivos con el 100% aprobado. Los días sin actividades no cortan la racha.
// El día de hoy, si todavía no está completo, no la corta.
export function streaks(list, today) {
  const days = byDate(list);
  const dates = Object.keys(days).filter(d => d <= today).sort();
  let best = 0, run = 0;
  const complete = d => { const s = stats(days[d]); return s.total > 0 && s.approved === s.total; };
  for (const d of dates) {
    const s = stats(days[d]);
    if (s.total === 0) continue;
    if (complete(d)) { run++; best = Math.max(best, run); } else if (d !== today) run = 0;
  }
  // racha actual
  let cur = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i]; const s = stats(days[d]);
    if (s.total === 0) continue;
    if (complete(d)) cur++;
    else if (d === today) continue;
    else break;
  }
  return { current: cur, best: Math.max(best, cur) };
}

export function weekProgress(list, today, childId) {
  const ws = weekStart(today);
  const fri = addDays(ws, 4);
  const week = filterRange(list, ws, addDays(ws, 6), childId);
  const friWeek = filterRange(list, ws, fri, childId);
  return { ws, week: stats(week), friday: stats(friWeek) };
}

// ---------- Insignias ----------
export function badges(list, today) {
  const ap = list.filter(t => t.status === 'approved');
  const st = streaks(list, today);
  const days = byDate(list);
  const perfectDay = Object.values(days).some(d => { const s = stats(d); return s.total > 0 && s.approved === s.total; });
  const weeks = {};
  for (const t of list) { const ws = weekStart(t.date); if (diffDays(t.date, ws) <= 4) (weeks[ws] ||= []).push(t); }
  const perfectWeek = Object.entries(weeks).some(([ws, l]) => {
    if (addDays(ws, 4) > today) return false;
    const s = stats(l); return s.total > 0 && s.approved === s.total;
  });
  const punctual = ap.filter(t => !t.late).length;
  return [
    { id: 'first', icon: '🌱', name: 'Primer paso', desc: 'Primera actividad aprobada', ok: ap.length >= 1 },
    { id: 'ten', icon: '⭐', name: 'Constante', desc: '10 actividades aprobadas', ok: ap.length >= 10 },
    { id: 'fifty', icon: '🏅', name: 'Responsable', desc: '50 actividades aprobadas', ok: ap.length >= 50 },
    { id: 'hundred', icon: '🏆', name: 'Leyenda de la casa', desc: '100 actividades aprobadas', ok: ap.length >= 100 },
    { id: 'perfect', icon: '💯', name: 'Día perfecto', desc: 'Un día al 100%', ok: perfectDay },
    { id: 'week', icon: '📅', name: 'Semana perfecta', desc: 'Lunes a viernes al 100%', ok: perfectWeek },
    { id: 's3', icon: '🔥', name: 'Racha de 3', desc: '3 días seguidos al 100%', ok: st.best >= 3 },
    { id: 's7', icon: '⚡', name: 'Racha de 7', desc: '7 días seguidos al 100%', ok: st.best >= 7 },
    { id: 's30', icon: '👑', name: 'Racha de 30', desc: '30 días seguidos al 100%', ok: st.best >= 30 },
    { id: 'punct', icon: '⏰', name: 'Puntual', desc: '10 aprobadas a tiempo', ok: punctual >= 10 },
  ];
}

export function motivation(pct, total) {
  if (!total) return 'Hoy no tenés actividades asignadas. ¡Disfrutá el día!';
  if (pct >= 100) return '¡Día completo! Excelente trabajo 🎉';
  if (pct >= 75) return '¡Casi lo lográs! Un último empujón 💪';
  if (pct >= 50) return 'Vas por la mitad, ¡seguí así! 🚀';
  if (pct > 0) return 'Buen comienzo. Cada tarea cuenta ✨';
  return 'Empezá por la más fácil y tomá ritmo 🙌';
}

export function freqText(a) {
  if (a.frequency === 'once') return `Extraordinaria · ${a.once_date ? shortDate(a.once_date) : ''}`;
  const d = [...(a.days || [])].sort();
  if (a.frequency === 'daily' || d.length === 7) return 'Todos los días';
  if (d.join() === '1,2,3,4,5') return 'Lunes a viernes';
  if (a.frequency === 'weekly' && d.length === 1) return `Cada ${DAY_FULL[d[0]]}`;
  return d.map(x => DAY_NAMES[x]).join(', ');
}

// ---------- Catálogo de ejemplo ----------
export const CATEGORIES = ['Habitación y orden personal', 'Limpieza del hogar', 'Cuidado de mascotas', 'Colaboración familiar', 'Hábitos personales', 'Escuela', 'Otras'];

export const CATALOG = [
  ['Habitación y orden personal', '🛏️', 'Arreglar la cama', 'Estirar sábanas, acomodar almohadas y dejar la cama prolija.', true, false],
  ['Habitación y orden personal', '🧺', 'Doblar las mantas', 'Doblar y guardar las mantas en su lugar.', true, false],
  ['Habitación y orden personal', '🧹', 'Ordenar la habitación', 'Nada en el piso, escritorio despejado y cosas en su lugar.', true, false],
  ['Habitación y orden personal', '👕', 'Guardar la ropa', 'Ropa limpia doblada en el ropero y ropa sucia en el canasto.', true, false],
  ['Habitación y orden personal', '✨', 'Mantener limpio el espacio personal', 'Escritorio, mesita y estantes limpios.', true, false],
  ['Limpieza del hogar', '🛋️', 'Limpiar la sala', 'Ordenar almohadones, sacar basura y pasar el trapo a las superficies.', true, false],
  ['Limpieza del hogar', '🌿', 'Barrer el patio', 'Barrer todo el patio y juntar las hojas.', true, false],
  ['Limpieza del hogar', '🏚️', 'Barrer el galpón', 'Barrer el galpón y ordenar las herramientas.', true, false],
  ['Limpieza del hogar', '🏠', 'Ordenar los espacios comunes', 'Dejar ordenados el comedor, pasillo y baño.', true, false],
  ['Limpieza del hogar', '🍽️', 'Ayudar a limpiar la cocina', 'Lavar o secar platos, limpiar la mesada.', true, false],
  ['Cuidado de mascotas', '🐶', 'Dar de comer a los perros', 'Servir la porción indicada a cada perro.', true, false],
  ['Cuidado de mascotas', '🐱', 'Dar de comer a los gatos', 'Servir la porción indicada a cada gato.', true, false],
  ['Cuidado de mascotas', '💧', 'Cambiar el agua de las mascotas', 'Vaciar, enjuagar y llenar con agua fresca.', true, false],
  ['Cuidado de mascotas', '🥣', 'Mantener limpios sus recipientes', 'Lavar los platos de comida y agua.', true, false],
  ['Colaboración familiar', '👩', 'Ayudar a mamá en una actividad', 'Ayudar a mamá en al menos una actividad del día.', true, false],
  ['Colaboración familiar', '👨', 'Ayudar a papá cuando sea necesario', 'Colaborar con papá en lo que necesite.', true, false],
  ['Colaboración familiar', '🤝', 'Tarea doméstica adicional', 'Colaborar con alguna tarea extra de la casa.', true, false],
  ['Hábitos personales', '🚿', 'Bañarse', 'Hábito diario de higiene personal.', false, true],
  ['Hábitos personales', '🪥', 'Cepillarse los dientes', 'Después de cada comida.', false, true],
  ['Hábitos personales', '🎒', 'Mantener ordenadas sus pertenencias', 'Mochila, útiles y objetos personales en orden.', true, true],
].map(([category, icon, title, description, requires_photo, is_habit]) =>
  ({ category, icon, title, description, requires_photo, is_habit }));

export const ICONS = ['✅','🛏️','🧺','🧹','👕','✨','🛋️','🌿','🏚️','🍽️','🐶','🐱','💧','🥣','👩','👨','🤝','🚿','🪥','🎒','📚','✏️','🗑️','🧽','🌱','🚗','🛒','👟','🧸','🎵'];
export const REWARD_ICONS = ['📱','🎮','📺','❄️','🎧','🎁','🍦','🚲','🎨','⚽'];
export const FRIDAY_OPTIONS = { cena: { label: 'Salir a cenar', icon: '🍽️' }, delivery: { label: 'Pedir delivery', icon: '🛵' } };
