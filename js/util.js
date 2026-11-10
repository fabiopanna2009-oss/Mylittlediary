// util.js — small helpers used everywhere.

// ---------- Creating HTML elements ----------
// h('div', { class: 'card', onclick: fn }, 'Hello', otherElement)
// We build elements this way instead of innerHTML, so text you write can never break the page.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') {
      // CSS variables (--name) need setProperty; normal properties can be assigned directly
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v); else el.style[prop] = v;
      }
    }
    else if (key === 'dataset') Object.assign(el.dataset, value);
    // Properties like value, checked, placeholder are set directly (a <textarea> ignores a "value" attribute).
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

// Replace an element's content, skipping empty values and flattening lists (unlike el.replaceChildren).
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// ---------- Icons (thin line drawings, used sparingly) ----------
const ICONS = {
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  arrow: '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>',
  star: '<path d="M12 4l2.35 4.9 5.35.75-3.9 3.7.95 5.3L12 16.1l-4.75 2.55.95-5.3-3.9-3.7 5.35-.75z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>',
  photo: '<rect x="3.5" y="5.5" width="17" height="13" rx="1"/><path d="M3.5 15l4.5-4 4 3.5 3-2.5 5.5 4.5"/><circle cx="15.5" cy="9.5" r="1.3"/>',
  compose: '<path d="M12 4.5H6A1.5 1.5 0 004.5 6v12A1.5 1.5 0 006 19.5h12a1.5 1.5 0 001.5-1.5v-6"/><path d="M17.5 4l2.5 2.5-7.5 7.5-3.2.7.7-3.2z"/>',
  edit: '<path d="M4.5 19.5l1-4L16 5l3 3L8.5 18.5z"/><path d="M14 7l3 3"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  left: '<path d="M14.5 6L8.5 12l6 6"/>',
  right: '<path d="M9.5 6l6 6-6 6"/>',
  chevron: '<path d="M9.5 6l6 6-6 6"/>',
  more: '<circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/>',
  settings: '<path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9"/><circle cx="15" cy="7.5" r="2"/><circle cx="9" cy="16.5" r="2"/>',
  pin: '<path d="M9 4.5h6l-1 5 3 3.5H7l3-3.5z"/><path d="M12 13v6.5"/>',
  heading: '<path d="M5 6v12M13 6v12M5 12h8"/><path d="M17 11l2.5-1.5V18"/>',
  bold: '<path d="M7.5 5.5h5.2a3.2 3.2 0 010 6.4H7.5zM7.5 11.9h6a3.3 3.3 0 010 6.6h-6z"/>',
  list: '<path d="M9.5 7h10M9.5 12h10M9.5 17h10"/><circle cx="5.2" cy="7" r=".8"/><circle cx="5.2" cy="12" r=".8"/><circle cx="5.2" cy="17" r=".8"/>',
  check: '<rect x="4" y="5" width="6" height="6" rx="1"/><path d="M5.5 16.5l1.6 1.6 3-3.4"/><path d="M13.5 8h6.5M13.5 16.5h6.5"/>',
  keyboard: '<path d="M6 9.5l6 6 6-6"/>',
};

export function icon(name, extraClass = '') {
  const span = document.createElement('span');
  span.className = `icon ${extraClass}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

// ---------- IDs ----------
export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------- Dates ----------
const pad = (n) => String(n).padStart(2, '0');

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowTime(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// '2026-09-28' -> Date (local time, not UTC, so the day never shifts)
export function parseISO(iso) {
  const [y, m, d] = (iso || todayISO()).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const LOCALE = 'en-GB';
export const fmt = {
  long: (iso) => parseISO(iso).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  medium: (iso) => parseISO(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }),
  dots: (iso) => { const d = parseISO(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; },
  monthYear: (iso) => parseISO(iso).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }),
  day: (iso) => parseISO(iso).getDate(),
  weekdayShort: (iso) => parseISO(iso).toLocaleDateString(LOCALE, { weekday: 'short' }),
  monthShort: (iso) => parseISO(iso).toLocaleDateString(LOCALE, { month: 'short' }),
};

// 'Tuesday, 10 November' (no year when it's this year)
export function friendlyDate(iso) {
  const d = parseISO(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(LOCALE, sameYear ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' });
}

export function greeting(d = new Date()) {
  const hr = d.getHours();
  if (hr < 5) return 'Still awake.';
  if (hr < 12) return 'Good morning.';
  if (hr < 18) return 'Good afternoon.';
  return 'Good evening.';
}

// ---------- Auto-lock pause ----------
// While the photo picker or the share sheet is open, iPhone may say the app is "hidden".
// We pause the auto-lock for that moment so the diary doesn't lock in the middle of adding a photo.
let autoLockPausedUntil = 0;
export const pauseAutoLock = (ms = 120000) => { autoLockPausedUntil = Date.now() + ms; };
export const resumeAutoLock = () => { autoLockPausedUntil = 0; };
export const autoLockPaused = () => Date.now() < autoLockPausedUntil;

// Opens a hidden <input type="file"> without locking the diary meanwhile.
export function pickFiles(input) {
  pauseAutoLock();
  const done = () => resumeAutoLock();
  input.addEventListener('change', done, { once: true });
  input.addEventListener('cancel', done, { once: true });
  input.click();
}

// ---------- Misc ----------
export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.flush = (...args) => { clearTimeout(t); return fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb < 1024 ? `${mb.toFixed(mb < 10 ? 1 : 0)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}

// ---------- Toast (small message at the bottom) ----------
let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- Dialogs (nicer than the browser's confirm/prompt) ----------
// ask({ title, message, ok: 'Delete', danger: true }) -> Promise<boolean>
// ask({ title, input: 'default text' })              -> Promise<string|null>
export function ask({ title, message = '', ok = 'OK', cancel = 'Cancel', danger = false, input = null, placeholder = '' }) {
  return new Promise((resolve) => {
    const field = input !== null ? h('input', { class: 'field', type: 'text', value: input, placeholder, maxlength: 20000 }) : null;
    const close = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };
    const confirmBtn = h('button', {
      class: `dialog-btn ${danger ? 'danger' : 'strong'}`,
      onclick: () => close(field ? (field.value.trim() || null) : true),
    }, ok);
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(field ? null : false); } },
      h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'dialog-body' },
          h('h3', { class: 'dialog-title' }, title),
          message ? h('p', { class: 'dialog-message' }, message) : null,
          field,
        ),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'dialog-btn', onclick: () => close(field ? null : false) }, cancel),
          confirmBtn,
        ),
      ),
    );
    if (field) field.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmBtn.click(); });
    document.body.append(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add('show');
      if (field) field.focus();
    });
  });
}

// ---------- Sheet (slides up from the bottom, like on iPhone) ----------
// sheet(title, (close) => [elements…], onClose) — returns a function that closes it.
export function sheet(title, build, onClose = null) {
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 240);
    if (onClose) onClose();
  };
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('h3', { class: 'sheet-title' }, title),
      h('button', { class: 'link', onclick: () => close() }, 'Done'),
    ),
  );
  const body = h('div', { class: 'sheet-body' });
  panel.append(body);
  const overlay = h('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, panel);
  fill(body, build(close));
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  return close;
}
