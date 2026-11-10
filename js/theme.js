// theme.js — dark or light.
// The journal is dark by default. In Settings you can choose Dark, Light, or "Follow my device".
// The choice is kept in localStorage (not the database) so it can be applied instantly,
// before anything is drawn, without a flash of the wrong colours.

const KEY = 'little-memories-theme';
const COLORS = { dark: '#1d1612', light: '#fbf8f1' };
const device = window.matchMedia('(prefers-color-scheme: dark)');

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'dark'; } catch { return 'dark'; }
}

export function applyTheme(choice = getTheme()) {
  const resolved = choice === 'auto' ? (device.matches ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[resolved]);
}

export function setTheme(choice) {
  try { localStorage.setItem(KEY, choice); } catch { /* private mode: just apply it for now */ }
  applyTheme(choice);
}

device.addEventListener('change', () => applyTheme());
applyTheme();
