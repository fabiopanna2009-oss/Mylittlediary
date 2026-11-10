// lock.js — the PIN / Face ID lock screen.
//
// The PIN itself is never saved. We save a "hash" of it (a fingerprint that can't be turned back
// into the PIN). When you type your PIN, we hash it again and compare the two fingerprints.
//
// Face ID works through "passkeys" (WebAuthn), the same technology websites use for passwordless login.
// iOS shows the Face ID prompt for us. If it ever doesn't work, the PIN always works.

import { db } from './db.js';
import { ridge, doodle, DOODLES, scribbleWord, placeRandomly } from './drawings.js';

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

// ---------- A question instead of the PIN ----------
// You can let the journal ask you a question when it opens ("Who is she?").
// You answer in your own words; it opens if your answer contains one of your key words.
//
// Stored on this device only:   gate = { enabled, questions: [{ id, text, salt, hashes: [...] }] }
// The question text is readable (it is shown on the lock screen). The key words are NOT stored:
// only a scrambled fingerprint of each one, like the PIN.

// "It's Lulubär!" -> "its lulubar" : lower case, no accents, no punctuation
const normalize = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();

async function hashWord(word, saltB64) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(word), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: 20000 }, key, 256);
  return toB64(bits);
}

// Every word and every run of up to four words in the answer is tried against the key words.
async function answerOpens(question, answer) {
  const words = normalize(answer).split(' ').filter(Boolean).slice(0, 40);
  const tries = new Set();
  for (let i = 0; i < words.length; i++) for (let n = 1; n <= 4 && i + n <= words.length; n++) tries.add(words.slice(i, i + n).join(' '));
  tries.add(words.join('')); // also the answer written together
  for (const candidate of tries) {
    if (question.hashes.includes(await hashWord(candidate, question.salt))) return true;
  }
  return false;
}

export async function getGate() {
  const gate = await db.getSetting('gate', null);
  return gate && Array.isArray(gate.questions) ? gate : { enabled: false, questions: [] };
}

// Returns false if no usable key word was given.
export async function addQuestion(text, keyWords) {
  const words = [...new Set(keyWords.map(normalize).filter((w) => w.length >= 2))];
  if (!text.trim() || !words.length) return false;
  const gate = await getGate();
  const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
  const hashes = [];
  for (const w of words) { hashes.push(await hashWord(w, salt)); hashes.push(await hashWord(w.replace(/ /g, ''), salt)); }
  gate.questions.push({ id: toB64(crypto.getRandomValues(new Uint8Array(9))), text: text.trim().slice(0, 140), salt, hashes: [...new Set(hashes)], count: words.length });
  await db.setSetting('gate', gate);
  givesAway.clear();
  return true;
}

export async function removeQuestion(id) {
  const gate = await getGate();
  gate.questions = gate.questions.filter((q) => q.id !== id);
  if (!gate.questions.length) gate.enabled = false;
  await db.setSetting('gate', gate);
}

export async function setGateEnabled(on) {
  const gate = await getGate();
  gate.enabled = !!on && gate.questions.length > 0;
  await db.setSetting('gate', gate);
  return gate.enabled;
}

let currentQuestion = null;
let lastQuestionId = null;

function showQuestion(on) {
  $('lock').classList.toggle('by-question', on);
  $('btn-use-pin').hidden = !(on && currentQuestion);
  $('btn-use-question').hidden = !(!on && currentQuestion && mode === 'unlock');
  if (on) { setTitle(currentQuestion.text); $('lock-answer').value = ''; } else setTitle('Welcome back');
}

async function submitAnswer() {
  const input = $('lock-answer');
  if (!currentQuestion || !input.value.trim() || input.disabled) return;
  input.disabled = true;
  const ok = await answerOpens(currentQuestion, input.value);
  input.disabled = false;
  if (ok) {
    wrongTries = 0;
    input.blur();
    unlock();
    return;
  }
  wrongTries++;
  const box = $('lock-question');
  box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
  if (wrongTries >= MAX_TRIES) waitBeforeRetry(); else setHint('Not quite. Try other words.');
  input.select();
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
  const keys = [...$('keypad').querySelectorAll('button'), $('lock-answer'), $('btn-answer')];
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

// The lock screen is a page of the notebook too: your words (if you allow it) and small drawings
// are scattered at random spots and angles around the PIN pad, with the mountain along the bottom.
// Photographs and your own drawings are never shown here, because this screen is visible before the PIN.
let lockPageShown = false;
const givesAway = new Map(); // word -> would it open the journal? (remembered while the app is open)
async function drawLockPage() {
  const wide = window.innerWidth >= 900;
  const showWords = await db.getSetting('lockWords', true);
  let words = [];
  if (showWords !== false) {
    words = (await db.getSetting('words', '') || '').split('\n').map((w) => w.trim()).filter(Boolean);
    // until you have typed your own words, the names of your collections stand in
    if (!words.length) words = (await db.allCollections()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((c) => c.name);
    words = words.filter((w) => w.length <= 22).sort(() => Math.random() - 0.5);
    // Never show a word here that would open the journal: it would give the answer away.
    const gate = await getGate();
    if (gate.enabled) {
      const safe = [];
      for (const w of words) {
        if (!givesAway.has(w)) {
          let opens = false;
          for (const q of gate.questions) { if (await answerOpens(q, w)) { opens = true; break; } }
          givesAway.set(w, opens);
        }
        if (!givesAway.get(w)) safe.push(w);
        if (safe.length >= (wide ? 18 : 9)) break;
      }
      words = safe;
    }
    words = words.slice(0, wide ? 18 : 9);
  }
  const names = Object.keys(DOODLES).sort(() => Math.random() - 0.5).slice(0, wide ? 7 : 4);
  const pieces = [
    ...words.map((w, i) => scribbleWord(w, i, wide)),
    ...names.map((n, i) => { const d = doodle(n, i); d.classList.add('pop'); d.dataset.kind = 'doodle'; d.style.setProperty('--tilt', `${(Math.random() * 30 - 15).toFixed(1)}deg`); return d; }),
  ];
  const deco = $('lock-deco');
  deco.replaceChildren(...pieces);

  const hill = ridge('');
  hill.querySelector('svg').setAttribute('preserveAspectRatio', 'none'); // stretch along the whole bottom edge
  $('lock-ridge').replaceChildren(hill);

  // place them once the handwriting fonts are ready (sizes are only known then)
  const first = !lockPageShown;
  lockPageShown = true;
  await Promise.race([document.fonts?.ready, new Promise((ok) => setTimeout(ok, 1500))]);
  if (!deco.isConnected || deco.firstElementChild !== pieces[0]) return; // the page was redrawn meanwhile
  const frame = deco.getBoundingClientRect();
  const pad = $('lock').querySelector('.lock-inner').getBoundingClientRect();
  const room = wide ? 46 : 14; // clear space around the PIN pad
  const shown = placeRandomly(deco, pieces, [{ left: pad.left - frame.left - room, top: pad.top - frame.top - room, right: pad.right - frame.left + room, bottom: pad.bottom - frame.top + room }]);
  shown.sort(() => Math.random() - 0.5).forEach((el, i) => {
    el.style.animationDelay = first ? `${0.25 + i * 0.12}s` : '0s';
    el.classList.add(first ? 'go' : 'shown');
  });
  $('lock').classList.toggle('intro', first);
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
  setMode((await db.getSetting('pinHash')) ? 'unlock' : 'setup');
  setHint('');
  $('btn-faceid').hidden = mode !== 'unlock' || !(await faceIdEnabled());

  // a question instead of the PIN? pick one (not the same as last time, if there are several)
  const gate = await getGate();
  currentQuestion = null;
  if (mode === 'unlock' && gate.enabled && gate.questions.length) {
    const pool = gate.questions.length > 1 ? gate.questions.filter((q) => q.id !== lastQuestionId) : gate.questions;
    currentQuestion = pool[Math.floor(Math.random() * pool.length)];
    lastQuestionId = currentQuestion.id;
  }
  showQuestion(!!currentQuestion);
  await drawLockPage(); // the words are scattered around whatever is shown in the middle
}

// Called from Settings → Change PIN. Resolves true when changed, false when cancelled.
export function changePin() {
  return new Promise((resolve) => {
    afterChange = resolve;
    locked = true;
    $('lock').classList.add('show');
    $('btn-faceid').hidden = true;
    currentQuestion = null;
    showQuestion(false);
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
    if (e.target === $('lock-answer')) { if (e.key === 'Enter') submitAnswer(); return; } // typing an answer, not a PIN
    if ($('lock').classList.contains('by-question')) return;
    if (/^[0-9]$/.test(e.key)) onDigit(e.key);
    if (e.key === 'Backspace') onDigit('back');
  });

  $('btn-answer').addEventListener('click', submitAnswer);
  $('btn-use-pin').addEventListener('click', () => { showQuestion(false); setHint(''); drawLockPage(); });
  $('btn-use-question').addEventListener('click', () => { showQuestion(true); setHint(''); drawLockPage(); });

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
