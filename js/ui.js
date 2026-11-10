// Utilidades de interfaz: escape, toasts, ventanas, máscaras, imágenes.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, kind = '') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg; t.setAttribute('role', 'status');
  box.append(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => t.remove(), kind === 'err' ? 5000 : 3000);
}

// Ventana tipo "hoja" desde abajo
export function modal(html, { onOpen, onClose } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  const close = () => { ov.remove(); onClose?.(); };
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('[data-close]')) close();
  });
  document.body.append(ov);
  ov.close = close;
  attachMasks(ov);
  onOpen?.(ov.querySelector('.sheet'), close);
  return { el: ov.querySelector('.sheet'), close };
}

export function confirmDlg(msg, okText = 'Aceptar', danger = false) {
  return new Promise(res => {
    let done = false;
    const m = modal(`<h2 style="margin-bottom:10px">${esc(msg)}</h2>
      <div class="btn-row" style="margin-top:18px"><button class="btn ghost" data-close>Cancelar</button>
      <button class="btn ${danger ? 'bad' : ''}" data-yes>${esc(okText)}</button></div>`,
      { onClose: () => { if (!done) res(false); } });
    m.el.querySelector('[data-yes]').onclick = () => { done = true; m.close(); res(true); };
  });
}

export function promptDlg(title, { label = '', placeholder = '', required = false, okText = 'Aceptar', value = '', multiline = true } = {}) {
  return new Promise(res => {
    let done = false;
    const m = modal(`<h2>${esc(title)}</h2><form style="margin-top:14px">
      ${label ? `<label class="f">${esc(label)}</label>` : ''}
      ${multiline ? `<textarea class="input" name="v" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="input" name="v" placeholder="${esc(placeholder)}" value="${esc(value)}">`}
      <div class="btn-row" style="margin-top:16px"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn">${esc(okText)}</button></div></form>`,
      { onClose: () => { if (!done) res(null); } });
    const f = m.el.querySelector('form');
    f.v.focus();
    f.onsubmit = e => {
      e.preventDefault();
      const v = f.v.value.trim();
      if (required && !v) { toast('Escribí una observación', 'err'); return; }
      done = true; m.close(); res(v);
    };
  });
}

export function zoom(url) {
  const z = document.createElement('div');
  z.className = 'zoom'; z.innerHTML = `<img src="${esc(url)}" alt="Evidencia">`;
  z.onclick = () => z.remove();
  document.body.append(z);
}

export function confetti() {
  const c = document.createElement('div'); c.className = 'confetti';
  const colors = ['#f59e0b', '#4f46e5', '#16a34a', '#ef4444', '#06b6d4', '#a855f7'];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * .6 + 's';
    p.style.animationDuration = 1.2 + Math.random() * 1.2 + 's';
    c.append(p);
  }
  document.body.append(c); setTimeout(() => c.remove(), 3200);
}

// Máscaras de escritura: fecha DD/MM/AAAA, hora HH:MM y PIN (el teclado aparece siempre)
export function attachMasks(root) {
  $$('input[data-mask]', root).forEach(inp => {
    if (inp._mask) return; inp._mask = true;
    const kind = inp.dataset.mask;
    inp.setAttribute('inputmode', 'numeric');
    inp.setAttribute('autocomplete', 'off');
    inp.addEventListener('input', () => {
      const d = inp.value.replace(/\D/g, '');
      if (kind === 'date') {
        const s = d.slice(0, 8);
        inp.value = s.length > 4 ? `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4)}` : s.length > 2 ? `${s.slice(0, 2)}/${s.slice(2)}` : s;
      } else if (kind === 'time') {
        const s = d.slice(0, 4);
        inp.value = s.length > 2 ? `${s.slice(0, 2)}:${s.slice(2)}` : s;
      } else if (kind === 'pin') {
        inp.value = d.slice(0, 6);
      } else if (kind === 'num') {
        inp.value = d.slice(0, 5);
      }
    });
  });
}

export function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
export function avatarHTML(m, cls = '', style = '') {
  if (!m) return `<div class="avatar ${cls}" style="background:#999;${style}">?</div>`;
  return `<div class="avatar ${cls}" style="background:${esc(m.color || '#4f46e5')};${style}">${m.avatar ? `<img src="${esc(m.avatar)}" alt="">` : esc(initials(m.display_name))}</div>`;
}

export async function compressImage(file, maxDim = 1280, quality = 0.82) {
  let src, w, h;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width; h = src.height;
  } catch {
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  const s = Math.min(1, maxDim / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', quality));
}
export function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
export function pickFile({ accept = 'image/*', capture = false } = {}) {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    if (capture) i.setAttribute('capture', 'environment');
    i.style.display = 'none';
    document.body.append(i);
    i.onchange = () => { res(i.files[0] || null); i.remove(); };
    i.click();
  });
}
export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export async function busy(btn, fn) {
  const old = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Procesando…'; }
  try { return await fn(); }
  catch (e) { console.error(e); toast(e.message || 'Ocurrió un error', 'err'); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}
