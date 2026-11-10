// lock.js — the PIN / Face ID lock screen.
//
// The PIN itself is never saved. We save a "hash" of it (a fingerprint that can't be turned back
// into the PIN). When you type your PIN, we hash it again and compare the two fingerprints.
//
// Face ID works through "passkeys" (WebAuthn), the same technology websites use for passwordless login.
// iOS shows the Face ID prompt for us. If it ever doesn't work, the PIN always works.

import { db } from './db.js';
import { ridge, wordScatter } from './drawings.js';

const PIN_LENGTH = 4;
const MAX_TRIES = 5;
const WAIT_SECONDS = 30;

let mode = 'unlock';        // 'setup' | 'confirm' | 'unlock' | 'verify-old'
let typed = '';
let firstPin = '';
let wrongTries = 0;
let locked = true;
let onUnlockCallback = () => {};
let afterChange = null;     // set while changing the PIN from Settings

const $ = (id) => document.getElementById(id);

// ---------- Hashing ----------
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

async function hashPin(pin, saltB64) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: 200000 },
    key,
    256,
  );
  return toB64(bits);
}

async function savePin(pin) {
  const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
  await db.setSetting('pinSalt', salt);
  await db.setSetting('pinHash', await hashPin(pin, salt));
}

async function checkPin(pin) {
  const [salt, hash] = await Promise.all([db.getSetting('pinSalt'), db.getSetting('pinHash')]);
  return salt && hash && (await hashPin(pin, salt)) === hash;
}

// ---------- Face ID (passkey) ----------
export async function faceIdSupported() {
  try {
    return !!(window.PublicKeyCredential &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export async function enableFaceId(bookTitle = 'Little Memories') {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: bookTitle },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'My diary', displayName: 'My diary' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
    },
  });
  await db.setSetting('faceIdCredential', toB64(cred.rawId));
}

export async function disableFaceId() {
  await db.setSetting('faceIdCredential', null);
}

export async function faceIdEnabled() {
  return !!(await db.getSetting('faceIdCredential'));
}

async function tryFaceId() {
  const credId = await db.getSetting('faceIdCredential');
  if (!credId) return;
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64(credId) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    unlock();
  } catch {
    setHint('Face ID didn’t work. Use your PIN.');
  }
}

// ---------- Screen ----------
function setTitle(text) { $('lock-title').textContent = text; }
function setHint(text) { $('lock-hint').textContent = text || ' '; }

function renderDots() {
  [...$('pin-dots').children].forEach((dot, i) => dot.classList.toggle('filled', i < typed.length));
}

function shake() {
  const dots = $('pin-dots');
  dots.classList.remove('shake');
  void dots.offsetWidth; // restart the animation
  dots.classList.add('shake');
  if (navigator.vibrate) navigator.vibrate(80);
}

function setMode(newMode) {
  mode = newMode;
  typed = '';
  renderDots();
  const titles = {
    setup: afterChange ? 'Choose a new PIN' : 'Choose a PIN',
    confirm: 'Type it once more',
    unlock: 'Welcome back',
    'verify-old': 'Enter your current PIN',
  };
  setTitle(titles[mode]);
  $('btn-lock-cancel').hidden = !afterChange;
}

async function onDigit(key) {
  if (key === 'back') { typed = typed.slice(0, -1); renderDots(); return; }
  if (typed.length >= PIN_LENGTH) return;
  typed += key;
  renderDots();
  if (typed.length < PIN_LENGTH) return;

  const pin = typed;
  await new Promise((r) => setTimeout(r, 120)); // let the last dot show

  if (mode === 'setup') {
    firstPin = pin;
    setHint('');
    setMode('confirm');
  } else if (mode === 'confirm') {
    if (pin === firstPin) {
      await savePin(pin);
      firstPin = '';
      if (afterChange) {
        const done = afterChange;
        afterChange = null;
        done(true);
      }
      unlock();
    } else {
      shake();
      setHint('The PINs didn’t match. Try again.');
      setMode('setup');
    }
  } else if (mode === 'unlock' || mode === 'verify-old') {
    if (await checkPin(pin)) {
      wrongTries = 0;
      setHint('');
      if (mode === 'verify-old') setMode('setup');
      else unlock();
    } else {
      wrongTries++;
      shake();
      typed = '';
      renderDots();
      if (wrongTries >= MAX_TRIES) waitBeforeRetry();
      else setHint('Wrong PIN');
    }
  }
}

function waitBeforeRetry() {
  const keys = $('keypad').querySelectorAll('button');
  keys.forEach((k) => { k.disabled = true; });
  let left = WAIT_SECONDS;
  const tick = () => {
    setHint(`Too many tries. Wait ${left}s`);
    if (left-- <= 0) {
      keys.forEach((k) => { k.disabled = false; });
      wrongTries = 0;
      setHint('');
      return;
    }
    setTimeout(tick, 1000);
  };
  tick();
}

function unlock() {
  locked = false;
  $('lock').classList.remove('show');
  document.body.classList.remove('is-locked');
  setHint('');
  onUnlockCallback();
}

// The lock screen is a page of the notebook too: your words (if you allow it), drawings and the mountain.
// Photographs are never shown here, because this screen is visible before the PIN is entered.
let lockPageShown = false;
async function drawLockPage() {
  const showWords = await db.getSetting('lockWords', true);
  const words = showWords === false ? [] : (await db.getSetting('words', '') || '').split('\n').map((w) => w.trim()).filter(Boolean).slice(0, window.innerWidth >= 900 ? 14 : 7); // fewer on a phone, so nothing is cut off
  const deco = $('lock-deco');
  deco.replaceChildren(wordScatter(words));
  $('lock-ridge').replaceChildren(ridge(''));
  // the page writes itself in the first time it is shown
  $('lock').classList.toggle('intro', !lockPageShown);
  lockPageShown = true;
}

// ---------- Public ----------
export function isLocked() { return locked; }

export async function lockNow() {
  if (afterChange) return; // don't interrupt changing the PIN
  locked = true;
  document.body.classList.add('is-locked');
  $('lock').classList.add('show');
  $('lock-book').textContent = await db.getSetting('bookTitle', 'Little Memories') || 'Little Memories';
  $('lock-motto').textContent = await db.getSetting('motto', '') || '';
  await drawLockPage();
  setMode((await db.getSetting('pinHash')) ? 'unlock' : 'setup');
  setHint('');
  $('btn-faceid').hidden = mode !== 'unlock' || !(await faceIdEnabled());
}

// Called from Settings → Change PIN. Resolves true when changed, false when cancelled.
export function changePin() {
  return new Promise((resolve) => {
    afterChange = resolve;
    locked = true;
    $('lock').classList.add('show');
    $('btn-faceid').hidden = true;
    setHint('');
    setMode('verify-old');
  });
}

export async function initLock(onUnlock) {
  onUnlockCallback = onUnlock;

  $('keypad').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-key]');
    if (btn && !btn.disabled) onDigit(btn.dataset.key);
  });

  // Typing on a real keyboard also works (handy when testing on a computer).
  document.addEventListener('keydown', (e) => {
    if (!$('lock').classList.contains('show')) return;
    if (/^[0-9]$/.test(e.key)) onDigit(e.key);
    if (e.key === 'Backspace') onDigit('back');
  });

  $('btn-faceid').addEventListener('click', tryFaceId);

  $('btn-lock-cancel').addEventListener('click', () => {
    const done = afterChange;
    afterChange = null;
    locked = false;
    $('lock').classList.remove('show');
    if (done) done(false);
  });

  await lockNow();
  const hasPin = await db.getSetting('pinHash');
  if (!hasPin) setHint('Four digits only you know. It can’t be recovered, so keep it safe.');
}
