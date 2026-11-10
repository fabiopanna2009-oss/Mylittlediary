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
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    // Properties like value, checked, placeholder are set directly (a <textarea> ignores a "value" attribute).
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// ---------- Icons (small line drawings) ----------
const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  quill: '<path d="M20 4c-6 1-11 6-13 13l-2 3"/><path d="M20 4c0 6-4 11-10 12"/><path d="M9 13l3 1"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  gear: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
  camera: '<path d="M4 8.5h3l1.5-2.5h7L17 8.5h3v10.5H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  up: '<path d="M6 14l6-6 6 6"/>',
  down: '<path d="M6 10l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  left: '<path d="M14 6l-6 6 6 6"/>',
  right: '<path d="M10 6l6 6-6 6"/>',
  faceid: '<path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16"/><path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 15.5c1.4 1.2 3.6 1.2 5 0"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.5L7 20z"/>',
};

export function icon(name, extraClass = '') {
  const span = document.createElement('span');
  span.className = `icon ${extraClass}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
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

export function greeting(d = new Date()) {
  const hr = d.getHours();
  if (hr < 5) return 'Still awake';
  if (hr < 12) return 'Good morning';
  if (hr < 18) return 'Good afternoon';
  return 'Good evening';
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

export function entryText(entry) {
  return (entry.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim();
}

export function entryPhotos(entry) {
  return (entry.blocks || []).filter((b) => b.type === 'photo');
}

export function isEntryEmpty(entry) {
  return !entry.title?.trim() && !entryText(entry) && entryPhotos(entry).length === 0;
}

// Sort newest first: by date, then time, then when it was created.
export function byNewest(a, b) {
  return (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) || (b.createdAt - a.createdAt);
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
    const field = input !== null ? h('input', { class: 'field', type: 'text', value: input, placeholder, maxlength: 60 }) : null;
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
        h('h3', { class: 'dialog-title' }, title),
        message ? h('p', { class: 'dialog-message' }, message) : null,
        field,
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
