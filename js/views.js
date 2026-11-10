// views.js — every screen except the editor and the lock screen.
//
//   Home       greeting, new note, recently edited, a few collections as entrances
//   Notes      all notes: pinned first, then by month; sort by last edited or date created
//   Memories   collections (words you tap) and all photographs
//   Search     notes, collections and photo captions, with an optional month filter
//
// Design rules: text and hairlines instead of boxes; the serif for titles and meaningful words,
// the sans for reading and controls; walnut is the one accent colour.

import { db } from './db.js';
import {
  h, fill, icon, fmt, todayISO, friendlyDate, greeting, toast, ask, sheet, formatBytes, uid,
  pickFiles, pauseAutoLock, resumeAutoLock,
} from './util.js';
import { noteTitle, noteExcerpt, noteWhen } from './notes.js';
import { photoImg, photoURL, addDrawingFromFile, forgetPhotoURL } from './photos.js';
import { ridge, wordScatter, doodle, DOODLES, placeRandomly } from './drawings.js';
import { getTheme, setTheme } from './theme.js';
import { CHATGPT_INSTRUCTIONS, parseImport, applyImport } from './importer.js';
import { changePin, faceIdSupported, faceIdEnabled, enableFaceId, disableFaceId, getGate, addQuestion, removeQuestion, setGateEnabled } from './lock.js';
import { createBackup, shareBackup, importBackup } from './backup.js';

export const APP_VERSION = '4.13.0';

// ================= shared pieces =================

const screen = (...children) => h('main', { class: 'screen enter' }, ...children);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const iso = (ms) => todayISO(new Date(ms));
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt;

function bar(nav, { title = '', actions = [] } = {}) {
  return h('header', { class: 'bar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => nav.back() }, icon('back')),
    h('div', { class: 'bar-title' }, title),
    h('div', { class: 'bar-actions' }, actions),
  );
}

function head({ eyebrow = null, title, lede = null, action = null, tab = false }) {
  return h('header', { class: `head ${tab ? 'tab-head' : ''}` },
    eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null,
    h('div', { class: 'head-row' }, h('h1', { class: 'title-1' }, title), action),
    lede ? h('p', { class: 'lede' }, lede) : null,
  );
}

function textLink(label, onclick, { quiet = false, arrow = false } = {}) {
  return h('button', { class: `link ${quiet ? 'quiet' : ''}`, onclick }, label, arrow ? icon('arrow') : null);
}

// A short, human date: "Today", "Yesterday", "12 March" or "12 March 2024".
function shortDate(ms) {
  const d = iso(ms);
  const today = todayISO();
  if (d === today) return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d === todayISO(new Date(Date.now() - 86400000))) return 'Yesterday';
  return d.slice(0, 4) === today.slice(0, 4) ? fmt.medium(d).replace(/ \d{4}$/, '') : fmt.medium(d);
}

// The date of the memory itself, as honest as the note says it is.
function rowWhen(n) {
  if (n.dateKind === 'unknown') return n.dateWords?.trim() || 'undated';
  if (n.dateKind === 'around') return n.dateWords?.trim() || `~ ${new Date(n.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;
  return shortDate(n.createdAt);
}

// On a computer the note list stays visible next to the editor; this is the note that is open.
let activeNoteId = null;

// One note in a list: title, then date and the first words; a small photo if it has one.
function noteRow(n, nav, dateKey = 'updatedAt') {
  const excerpt = noteExcerpt(n);
  const photo = (n.photos || [])[0];
  return h('li', {},
    h('button', { class: 'note-row', 'aria-current': n.id === activeNoteId ? 'true' : null, onclick: () => nav.open(n.id) },
      h('span', { class: 'note-row-body' },
        h('span', { class: 'note-row-title' }, n.pinned ? icon('pin', 'row-pin') : null, noteTitle(n)),
        h('span', { class: 'note-row-sub' },
          h('span', { class: 'note-row-date' }, dateKey === 'createdAt' ? rowWhen(n) : shortDate(n[dateKey])),
          excerpt ? h('span', { class: 'note-row-text' }, excerpt) : (photo ? h('span', { class: 'note-row-text' }, plural(n.photos.length, 'photograph', 'photographs')) : null),
        ),
      ),
      photo ? h('span', { class: 'row-thumb' }, photoImg(photo.photoId, 'thumb')) : null,
    ),
  );
}

function noteList(notes, nav, dateKey) {
  return h('ul', { class: 'rows' }, notes.map((n) => noteRow(n, nav, dateKey)));
}

// Notes grouped by month (newest first).
function monthGroups(notes, nav, dateKey) {
  // When sorting by the date of the memory, notes without a known date are gathered at the end.
  const undated = (n) => dateKey === 'createdAt' && n.dateKind === 'unknown';
  const sorted = [...notes].sort((a, b) => (undated(a) - undated(b)) || (b[dateKey] - a[dateKey]));
  const groups = [];
  for (const n of sorted) {
    const key = undated(n) ? 'unknown' : iso(n[dateKey]).slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, items: [] }; groups.push(g); }
    g.items.push(n);
  }
  return groups.map((g) => h('section', { class: 'month' },
    h('div', { class: 'month-head' },
      h('h2', { class: 'month-name' }, g.key === 'unknown' ? 'Sometime' : fmt.monthYear(`${g.key}-01`)),
      h('span', { class: 'month-count' }, g.items.length),
    ),
    noteList(g.items, nav, dateKey),
  ));
}

// ---------- the first page: a spiral of photographs (words and drawings live in drawings.js) ----------

// Photographs winding inwards along a spiral. The newest is on the outside.
function photoSpiral(items, nav, collections) {
  const shown = items.slice(0, 18);
  const size = 100; // everything is placed in percent, so the spiral scales with the page
  const spiral = h('div', { class: 'spiral' });
  spiral.innerHTML = `<svg class="spiral-line" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="0.35" stroke-linecap="round" aria-hidden="true"><path pathLength="1" d="${spiralPath()}"/></svg>`;
  shown.forEach((it, i) => {
    const t = shown.length > 1 ? i / (shown.length - 1) : 0;
    const angle = -1.3 + t * 3.6 * Math.PI;            // how far around
    const radius = 41 - t * 31;                          // how far from the middle
    const w = 25 - t * 10;                               // outer photos are larger
    const x = size / 2 + Math.cos(angle) * radius;
    const y = size / 2 + Math.sin(angle) * radius;
    spiral.append(h('button', {
      class: 'spiral-photo',
      'aria-label': it.caption || 'Photograph',
      style: { left: `${x}%`, top: `${y}%`, width: `${w}%`, '--tilt': `${((i * 53) % 19) - 9}deg`, '--i': String(i), zIndex: String(shown.length - i) },
      onclick: () => openLightbox(shown, i, nav, collections),
    }, photoImg(it.photoId, 'thumb')));
  });
  if (!shown.length) spiral.append(h('span', { class: 'spiral-empty' }, 'your photographs will wind in here'));
  return spiral;
}

function spiralPath() {
  const pts = [];
  for (let k = 0; k <= 120; k++) {
    const t = k / 120;
    const angle = -1.3 + t * 3.6 * Math.PI;
    const radius = 44 - t * 37;
    pts.push(`${k ? 'L' : 'M'}${(50 + Math.cos(angle) * radius).toFixed(2)} ${(50 + Math.sin(angle) * radius).toFixed(2)}`);
  }
  return pts.join(' ');
}

// A collection as an entrance: a meaningful word you tap.
function wordEntrance(c, notes, nav, extra = null) {
  const inside = notes.filter((n) => (n.collections || []).includes(c.id));
  const photos = inside.reduce((sum, n) => sum + (n.photos || []).length, 0);
  const sub = c.description?.trim()
    || [inside.length ? plural(inside.length, 'note', 'notes') : 'Nothing here yet', photos ? plural(photos, 'photograph', 'photographs') : null].filter(Boolean).join(' · ');
  return h('li', { class: 'word-item' },
    h('button', { class: 'word', onclick: () => nav.go(`collection/${c.id}`) },
      h('span', { class: 'word-text' },
        h('span', { class: 'word-name' }, c.name),
        h('span', { class: 'word-sub' }, sub),
      ),
      c.coverPhotoId ? h('span', { class: 'word-cover' }, photoImg(c.coverPhotoId, 'thumb')) : null,
    ),
    extra,
  );
}

async function createCollection() {
  const name = await ask({ title: 'New collection', message: 'A word or a name that means something to you.', input: '', placeholder: 'e.g. September', ok: 'Create' });
  if (!name) return null;
  const all = await db.allCollections();
  const c = { id: uid(), name, description: '', order: all.length ? Math.max(...all.map((x) => x.order ?? 0)) + 1 : 0, createdAt: Date.now() };
  await db.saveCollection(c);
  return c;
}

// ================= HOME =================

export async function renderHome(root, nav, { intro = false } = {}) {
  const [notes, collections, bookTitle, lastBackup, motto, specialDate, specialLabel] = await Promise.all([
    db.allEntries(), db.allCollections(), db.getSetting('bookTitle', 'Little Memories'), db.getSetting('lastBackup'),
    db.getSetting('motto', ''), db.getSetting('specialDate', ''), db.getSetting('specialLabel', ''),
  ]);
  const homeDrawings = (await db.getSetting('drawings', []) || []).slice(0, 4);
  const hasOwnWords = !!(await db.getSetting('words', '') || '').trim();
  const words = (await wordsThatMatter()).filter((w) => w.length <= 22).slice(0, 24); // sentences are kept for the opening
  const photos = [...notes].sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((n) => (n.photos || []).map((p) => ({ ...p, note: n, when: p.date || iso(n.createdAt) })));
  const now = new Date();
  const isTheDay = specialDate && specialDate.slice(5) === todayISO(now).slice(5);
  const ridgeLabel = specialDate ? [fmt.dots(specialDate).slice(0, 5), specialLabel].filter(Boolean).join(' · ') : '';
  const recent = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  const needsBackup = notes.length > 0 && (!lastBackup || Date.now() - lastBackup > 14 * 86400000);

  const wordsCol = [...collections].sort(byOrder).slice(0, 12);
  const main = h('div', { class: 'home-main' },
    h('p', { class: 'home-greeting' }, isTheDay ? `Today is ${specialLabel || 'the day'}.` : greeting(now)),
    h('h1', { class: 'display home-title' }, bookTitle || 'Little Memories'),
    motto ? h('p', { class: 'home-motto' }, motto) : null,
    ridge(ridgeLabel),

    h('button', { class: 'new-note', onclick: () => nav.compose() },
      h('span', { class: 'new-note-text' }, 'New note'),
      icon('compose'),
    ),
    h('button', { class: 'search-entry', onclick: () => nav.tab('search') }, icon('search'), 'Search your journal'),

    h('section', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', { class: 'eyebrow' }, 'Recently edited'),
        notes.length > recent.length ? textLink('All notes', () => nav.tab('notes'), { arrow: true }) : null,
      ),
      recent.length
        ? noteList(recent, nav, 'updatedAt')
        : h('p', { class: 'empty-note' }, 'Nothing written yet. A thought, a memory, a single line. Begin anywhere.'),
    ),
  );

  // The page of scribbles: your words, drawings, and the spiral of photographs.
  const collage = h('div', { class: 'home-collage' },
    h('div', { class: 'block-label' },
      h('h2', { class: 'eyebrow' }, 'Words that matter'),
      textLink(hasOwnWords ? 'Edit' : 'Add yours', () => nav.go('settings')),
    ),
    wordScatter(words),
    homeDrawings.length ? h('div', { class: 'drawing-row' }, homeDrawings.map((id) => photoImg(id, 'full', 'drawing'))) : null,
    h('div', { class: 'block-label', style: { marginTop: '26px' } },
      h('h2', { class: 'eyebrow' }, 'Photographs'),
      photos.length ? textLink('All', () => nav.tab('photos'), { arrow: true }) : null,
    ),
    photoSpiral(photos, nav, collections),
  );

  const memories = h('section', { class: 'section home-memories' },
    h('div', { class: 'section-head' },
      h('h2', { class: 'eyebrow' }, 'Memories'),
      textLink(collections.length > wordsCol.length ? 'All collections' : 'Open', () => nav.tab('memories'), { arrow: true }),
    ),
    wordsCol.length
      ? h('ul', { class: 'words grid' }, wordsCol.map((c) => wordEntrance(c, notes, nav)))
      : h('p', { class: 'empty-note' }, 'Collections gather notes that belong together, under a word that means something to you.'),
  );

  fill(root, h('main', { class: `screen enter home ${intro ? 'intro' : ''}` },
    h('div', { class: 'home-top' },
      h('div', { class: 'eyebrow' }, friendlyDate(todayISO(now))),
      h('div', { class: 'bar-actions' },
        h('button', { class: 'icon-btn', 'aria-label': 'Lock the journal', onclick: () => nav.lock() }, icon('lock')),
        h('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: () => nav.go('settings') }, icon('settings')),
      ),
    ),
    h('div', { class: 'home-grid' }, main, collage, memories),
    needsBackup ? h('button', { class: 'backup-note', onclick: () => nav.go('settings') },
      h('span', {}, lastBackup ? 'It’s been a while since your last backup.' : 'You haven’t made a backup yet.'),
      h('span', {}, 'Back up now'),
    ) : null,
  ));
}

// ================= THE OPENING (plays once after the PIN) =================
// Words, sentences, places and photographs pop up one after another all over the page,
// each at its own angle and size. A different mix every time. Tap anywhere to skip.

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const between = (min, max) => min + Math.random() * (max - min);

// Your own words; until you have typed some, the names of your collections stand in for them.
async function wordsThatMatter() {
  const typed = (await db.getSetting('words', '') || '').split('\n').map((w) => w.trim()).filter(Boolean);
  if (typed.length) return typed;
  return (await db.allCollections()).sort(byOrder).map((c) => c.name);
}

export async function playOpening({ force = false } = {}) {
  if (!force && await db.getSetting('opening', true) === false) return false;
  const [notes, bookTitle, typed, motto, specialDate, specialLabel] = await Promise.all([
    db.allEntries(), db.getSetting('bookTitle', 'Little Memories'), wordsThatMatter(),
    db.getSetting('motto', ''), db.getSetting('specialDate', ''), db.getSetting('specialLabel', ''),
  ]);
  const big = window.innerWidth >= 900;

  // ----- gather what could appear -----
  const short = typed.filter((w) => w.length <= 22);
  const sentences = typed.filter((w) => w.length > 22);
  // lines from your notes: your own sentences
  const noteLines = notes.flatMap((n) => (n.text || '').split('\n').map((l) => l.trim()).filter((l) => l.length > 14 && l.length < 110));
  const places = [...new Set(notes.map((n) => n.place?.name?.trim()).filter(Boolean))];
  const photos = notes.flatMap((n) => (n.photos || []).map((p) => ({ ...p, note: n })));

  const drawingIds = await db.getSetting('drawings', []) || [];
  const pick = (list, n) => shuffled(list).slice(0, n);
  const items = [
    ...pick(drawingIds, big ? 4 : 2).map((id) => ({ kind: 'drawing', id })),
    ...pick(short, big ? 13 : 8).map((text) => ({ kind: 'word', text })),
    ...pick([...sentences, ...noteLines], big ? 6 : 4).map((text) => ({ kind: 'line', text })),
    ...pick(places, big ? 3 : 2).map((text) => ({ kind: 'place', text })),
    // your special date, unless it is already among your words
    ...(specialDate && !typed.some((w) => w.includes(fmt.dots(specialDate).slice(0, 5))) ? [{ kind: 'word', text: [fmt.dots(specialDate).slice(0, 5), specialLabel].filter(Boolean).join(' · ') }] : []),
    ...(motto ? [{ kind: 'line', text: motto }] : []),
    ...pick(photos, big ? 6 : 4).map((photo) => ({ kind: 'photo', photo })),
  ];
  // a few drawings between them
  const doodleNames = pick(Object.keys(DOODLES), drawingIds.length ? 2 : Math.max(2, Math.round(items.length / 4)));
  doodleNames.forEach((name) => items.push({ kind: 'doodle', name }));

  // ----- build them (hidden for now; each gets its own random spot below) -----
  const colours = ['var(--pen)', 'var(--caramel)', 'var(--ink-2)', 'var(--pen)', 'var(--ink-3)'];
  const els = shuffled(items).map((it, i) => {
    const tilt = between(-16, 16);
    const style = { '--tilt': `${tilt.toFixed(1)}deg`, color: colours[i % colours.length] };
    let el;
    if (it.kind === 'photo') {
      el = h('figure', { class: 'pop pop-photo', style },
        photoImg(it.photo.photoId, 'thumb'),
        (it.photo.caption || it.photo.date) ? h('figcaption', {}, it.photo.caption || fmt.medium(it.photo.date)) : null);
    } else if (it.kind === 'drawing') {
      el = h('span', { class: 'pop pop-drawing', style: { '--tilt': `${between(-7, 7).toFixed(1)}deg` } }, photoImg(it.id, 'full', 'drawing'));
    } else if (it.kind === 'doodle') {
      el = doodle(it.name, i); el.classList.add('pop'); el.style.setProperty('--tilt', `${tilt.toFixed(1)}deg`);
    } else if (it.kind === 'line') {
      el = h('span', { class: 'pop pop-line', style: { ...style, '--tilt': `${between(-8, 8).toFixed(1)}deg` } }, `“${it.text}”`);
    } else if (it.kind === 'place') {
      el = h('span', { class: 'pop pop-place', style }, it.text);
    } else {
      const size = it.text.length <= 8 ? between(big ? 54 : 38, big ? 82 : 54) : between(big ? 36 : 26, big ? 54 : 36);
      const penHand = i % 3 === 0; // some in the clearer pen hand (which runs larger, so it is scaled down)
      el = h('span', { class: `pop pop-word ${penHand ? 'pen-hand' : ''}`, style: { ...style, fontSize: `${(size * (penHand ? 0.62 : 1)).toFixed(0)}px` } }, it.text);
    }
    el.dataset.kind = it.kind;
    return el;
  });

  const cloud = h('div', { class: 'opening-cloud' }, els);
  const overlay = h('div', { class: 'opening', role: 'button', 'aria-label': 'Open the journal' },
    h('div', { class: 'opening-title' }, bookTitle || 'Little Memories'),
    cloud,
    h('span', { class: 'opening-hint', style: { animationDelay: '2.5s' } }, 'tap to open'),
  );

  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      overlay.classList.add('leaving');
      setTimeout(() => overlay.remove(), 500);
      resolve(true);
    };
    overlay.addEventListener('click', finish);
    document.addEventListener('keydown', function onKey() { document.removeEventListener('keydown', onKey); finish(); });
    // if the app goes to the background while this plays, end it
    document.addEventListener('visibilitychange', function onHide() { if (document.visibilityState === 'hidden') { document.removeEventListener('visibilitychange', onHide); finish(); } });
    document.body.append(overlay);

    // Sizes are only known once the handwriting fonts and the photographs have loaded.
    const loaded = [...cloud.querySelectorAll('img')].map((img) => new Promise((ok) => {
      if (img.complete && img.naturalWidth) ok(); else { img.addEventListener('load', ok); img.addEventListener('error', ok); }
    }));
    const ready = Promise.race([Promise.all([document.fonts?.ready, ...loaded]), new Promise((ok) => setTimeout(ok, 1800))]);
    ready.then(() => {
      if (done) return;
      const shown = shuffled(placeRandomly(cloud, els)); // each gets a random free spot; then they pop up in a random order
      const step = Math.min(0.3, 5 / Math.max(shown.length, 1));
      shown.forEach((el, i) => { el.style.animationDelay = `${0.35 + i * step}s`; el.classList.add('go'); });
      timer = setTimeout(finish, (0.35 + shown.length * step + 3) * 1000);
    });
  });
}

// ================= NOTES =================

export async function renderNotes(root, nav) {
  const notes = await db.allEntries();
  let sort = await db.getSetting('noteSort', 'updatedAt');
  const list = h('div', {});
  const sortBtn = h('button', { class: 'link quiet sort' });

  function draw() {
    sortBtn.textContent = sort === 'updatedAt' ? 'Sorted by last edited' : 'Sorted by date of the memory';
    const pinned = notes.filter((n) => n.pinned).sort((a, b) => b[sort] - a[sort]);
    const rest = notes.filter((n) => !n.pinned);
    fill(list,
      pinned.length ? h('section', { class: 'month' },
        h('div', { class: 'month-head' }, h('h2', { class: 'month-name' }, 'Pinned'), h('span', { class: 'month-count' }, pinned.length)),
        noteList(pinned, nav, sort),
      ) : null,
      monthGroups(rest, nav, sort),
      notes.length ? null : h('div', { class: 'empty' },
        h('p', {}, 'Your notes will gather here. The first one is waiting.'),
        textLink('Write a note', () => nav.compose(), { arrow: true }),
      ),
    );
  }
  sortBtn.addEventListener('click', async () => {
    sort = sort === 'updatedAt' ? 'createdAt' : 'updatedAt';
    await db.setSetting('noteSort', sort);
    draw();
  });
  draw();

  fill(root, screen(
    head({ title: 'Notes', tab: true, lede: notes.length ? plural(notes.length, 'note', 'notes') : null }),
    notes.length > 1 ? h('div', { class: 'list-tools' }, sortBtn) : null,
    list,
  ));
}

// ================= COMPUTER LAYOUT: sidebar and note list =================
// On a wide screen the journal has three panes, like Apple Notes on a Mac:
//   sidebar (places + collections)  |  list of notes  |  the note you are writing

export async function renderSidebar(el, nav, screenName, collectionId) {
  const [notes, collections, bookTitle, motto] = await Promise.all([db.allEntries(), db.allCollections(), db.getSetting('bookTitle', 'Little Memories'), db.getSetting('motto', '')]);
  collections.sort(byOrder);
  const item = (label, route, names, count = null) => h('button', {
    class: 'side-item', 'aria-current': names.includes(screenName) ? 'page' : null, onclick: () => nav.tab(route),
  }, h('span', {}, label), count !== null ? h('span', { class: 'side-count' }, count) : null);

  fill(el,
    h('div', { class: 'side-label' },
      h('div', { class: 'side-title' }, bookTitle || 'Little Memories'),
      motto ? h('div', { class: 'side-motto' }, motto) : null,
    ),
    h('button', { class: 'new-note side-new', onclick: () => nav.compose() }, h('span', { class: 'new-note-text' }, 'New note'), icon('compose')),
    h('nav', { class: 'side-nav', 'aria-label': 'Places' },
      item('Home', '', ['home']),
      item('Notes', 'notes', ['notes', 'editor'], notes.length),
      item('Photographs', 'photos', ['photos']),
      item('Search', 'search', ['search']),
    ),
    h('div', { class: 'side-head' },
      h('button', { class: 'eyebrow side-head-link', onclick: () => nav.tab('memories') }, 'Memories'),
      h('button', { class: 'side-add', 'aria-label': 'New collection', onclick: async () => { const c = await createCollection(); if (c) nav.tab(`collection/${c.id}`); } }, '+'),
    ),
    h('nav', { class: 'side-words', 'aria-label': 'Collections' }, collections.map((c) => h('button', {
      class: 'side-word', 'aria-current': screenName === 'collection' && collectionId === c.id ? 'page' : null,
      onclick: () => nav.tab(`collection/${c.id}`),
    }, h('span', {}, c.name), h('span', { class: 'side-count' }, notes.filter((n) => (n.collections || []).includes(c.id)).length || '')))),
    h('div', { class: 'side-foot' },
      h('button', { class: 'side-item quiet', 'aria-current': screenName === 'settings' ? 'page' : null, onclick: () => nav.tab('settings') }, 'Settings & backup'),
      h('button', { class: 'side-item quiet', onclick: () => nav.lock() }, 'Lock'),
    ),
  );
}

let listFilter = '';

export async function renderListPane(el, nav, noteId) {
  activeNoteId = noteId;
  const notes = await db.allEntries();
  let sort = await db.getSetting('noteSort', 'updatedAt');
  const keepScroll = el.querySelector('.list-scroll')?.scrollTop || 0;
  const list = h('div', { class: 'list-scroll' });
  const sortBtn = h('button', { class: 'link quiet sort' });
  const filter = h('input', { class: 'list-filter', type: 'search', placeholder: 'Filter notes', value: listFilter, 'aria-label': 'Filter notes', autocomplete: 'off' });

  function draw() {
    sortBtn.textContent = sort === 'updatedAt' ? 'Last edited' : 'Date of the memory';
    const words = listFilter.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const shown = words.length ? notes.filter((n) => words.every((w) => `${n.title}\n${n.text}`.toLowerCase().includes(w))) : notes;
    const pinned = shown.filter((n) => n.pinned).sort((a, b) => b[sort] - a[sort]);
    fill(list,
      pinned.length ? h('section', { class: 'month' },
        h('div', { class: 'month-head' }, h('h2', { class: 'month-name' }, 'Pinned')),
        noteList(pinned, nav, sort),
      ) : null,
      monthGroups(shown.filter((n) => !n.pinned), nav, sort),
      shown.length ? null : h('p', { class: 'empty-note' }, notes.length ? 'No notes match.' : 'No notes yet.'),
    );
  }
  filter.addEventListener('input', () => { listFilter = filter.value; draw(); });
  sortBtn.addEventListener('click', async () => {
    sort = sort === 'updatedAt' ? 'createdAt' : 'updatedAt';
    await db.setSetting('noteSort', sort);
    draw();
  });
  draw();

  const hadFocus = document.activeElement?.classList?.contains('list-filter');
  fill(el,
    h('div', { class: 'list-top' },
      h('div', { class: 'list-top-row' }, h('h2', { class: 'title-2' }, 'Notes'), sortBtn),
      filter,
    ),
    list,
  );
  list.scrollTop = keepScroll;
  if (hadFocus) { filter.focus(); filter.setSelectionRange(filter.value.length, filter.value.length); }
}

// The main pane on a computer when no note is open.
export function renderNotesPlaceholder(root, nav) {
  activeNoteId = null;
  fill(root, h('main', { class: 'screen enter pane-empty' },
    h('p', { class: 'empty-note' }, 'Choose a note on the left, or begin a new one.'),
    textLink('New note', () => nav.compose(), { arrow: true }),
  ));
}

// ================= MEMORIES (collections + photographs) =================

function memoriesHead(nav, mode, action) {
  return h('div', {},
    head({ title: 'Memories', tab: true, action }),
    h('div', { class: 'segments', role: 'tablist' },
      h('button', { class: 'segment', role: 'tab', 'aria-selected': String(mode === 'collections'), onclick: () => mode !== 'collections' && nav.tab('memories') }, 'Collections'),
      h('button', { class: 'segment', role: 'tab', 'aria-selected': String(mode === 'photos'), onclick: () => mode !== 'photos' && nav.tab('photos') }, 'Photographs'),
    ),
  );
}

let arranging = false;

export async function renderMemories(root, nav) {
  const [notes, collections] = await Promise.all([db.allEntries(), db.allCollections()]);
  collections.sort(byOrder);

  const move = async (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= collections.length) return;
    [collections[index], collections[target]] = [collections[target], collections[index]];
    collections.forEach((c, i) => { c.order = i; });
    await db.saveCollections(collections);
    renderMemories(root, nav);
  };

  fill(root, screen(
    memoriesHead(nav, 'collections', textLink('New', async () => { if (await createCollection()) renderMemories(root, nav); })),
    collections.length
      ? h('ul', { class: `words ${arranging ? 'arranging' : ''}` }, collections.map((c, i) => wordEntrance(c, notes, nav, arranging ? h('div', { class: 'word-move' },
        h('button', { class: 'link quiet', disabled: i === 0, onclick: () => move(i, -1) }, 'Move up'),
        h('button', { class: 'link quiet', disabled: i === collections.length - 1, onclick: () => move(i, 1) }, 'Move down'),
      ) : null)))
      : h('p', { class: 'empty-note' }, 'No collections yet. Create one for a place, a person, a season, or anything that holds memories together.'),
    collections.length > 1 ? h('div', { class: 'list-foot' },
      textLink(arranging ? 'Done arranging' : 'Change the order', () => { arranging = !arranging; renderMemories(root, nav); }, { quiet: !arranging }),
    ) : null,
  ));
}

export async function renderPhotos(root, nav) {
  const [notes, collections] = await Promise.all([db.allEntries(), db.allCollections()]);
  const items = notes.flatMap((n) => (n.photos || []).map((p) => ({ ...p, note: n, when: p.date || iso(n.createdAt) })))
    .sort((a, b) => b.when.localeCompare(a.when));

  const groups = [];
  for (const it of items) {
    const key = it.when.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, items: [] }; groups.push(g); }
    g.items.push(it);
  }

  fill(root, screen(
    memoriesHead(nav, 'photos', null),
    items.length
      ? groups.map((g) => h('section', { class: 'month' },
        h('div', { class: 'month-head' },
          h('h2', { class: 'month-name' }, fmt.monthYear(`${g.key}-01`)),
          h('span', { class: 'month-count' }, g.items.length),
        ),
        h('div', { class: 'gallery-grid' }, g.items.map((it) => h('button', {
          class: 'gallery-item',
          'aria-label': it.caption || `Photograph from ${fmt.medium(it.when)}`,
          onclick: () => openLightbox(items, items.indexOf(it), nav, collections),
        }, photoImg(it.photoId, 'thumb')))),
      ))
      : h('p', { class: 'empty-note' }, 'Photographs you add to your notes will gather here.'),
  ));
}

// ================= ONE COLLECTION =================

export async function renderCollection(root, nav, id) {
  const [allNotes, collections] = await Promise.all([db.allEntries(), db.allCollections()]);
  const col = collections.find((c) => c.id === id);
  if (!col) { nav.back(); return; }
  const notes = allNotes.filter((n) => (n.collections || []).includes(id)).sort((a, b) => b.createdAt - a.createdAt);
  const photos = notes.flatMap((n) => (n.photos || []).map((p) => ({ ...p, note: n, when: p.date || iso(n.createdAt) })));
  const redraw = () => renderCollection(root, nav, id);
  let deleted = false;

  const edit = () => sheet('Collection', (close) => {
    const name = h('input', { class: 'sheet-input serif', type: 'text', value: col.name, maxlength: 60, 'aria-label': 'Name', placeholder: 'Name' });
    const desc = h('textarea', { class: 'sheet-input', rows: 3, value: col.description || '', maxlength: 400, 'aria-label': 'Description', placeholder: 'A few words about what this holds (optional)' });
    const save = async () => {
      col.name = name.value.trim() || col.name;
      col.description = desc.value.trim();
      await db.saveCollection(col);
    };
    name.addEventListener('change', save);
    desc.addEventListener('change', save);

    const covers = h('div', { class: 'cover-choices' });
    const drawCovers = () => fill(covers,
      h('button', { class: `cover-choice none ${col.coverPhotoId ? '' : 'on'}`, onclick: async () => { col.coverPhotoId = null; await db.saveCollection(col); drawCovers(); } }, 'None'),
      photos.map((p) => h('button', {
        class: `cover-choice ${col.coverPhotoId === p.photoId ? 'on' : ''}`, 'aria-label': p.caption || 'Use this photograph',
        onclick: async () => { col.coverPhotoId = p.photoId; await db.saveCollection(col); drawCovers(); },
      }, photoImg(p.photoId, 'thumb'))),
    );
    drawCovers();

    return [
      h('h4', { class: 'eyebrow sheet-label' }, 'Name'), name,
      h('h4', { class: 'eyebrow sheet-label' }, 'Description'), desc,
      h('h4', { class: 'eyebrow sheet-label' }, 'Cover photograph'),
      photos.length ? covers : h('p', { class: 'set-note' }, 'Add photographs to notes in this collection, then choose one as its cover.'),
      h('button', {
        class: 'danger-btn',
        onclick: async () => {
          if (!await ask({ title: `Delete “${col.name}”?`, message: 'The notes stay in your journal. Only the collection is removed.', ok: 'Delete', danger: true })) return;
          deleted = true;
          close();
          const touched = allNotes.filter((n) => (n.collections || []).includes(id)).map((n) => ({ ...n, collections: n.collections.filter((x) => x !== id) }));
          await db.saveEntries(touched);
          await db.deleteCollection(id);
          toast('Collection deleted');
          nav.back();
        },
      }, 'Delete collection'),
    ];
  }, async () => {
    // the sheet was closed: keep what was typed and show it
    if (deleted) return;
    const [name, desc] = document.querySelectorAll('.sheet .sheet-input');
    if (name) { col.name = name.value.trim() || col.name; col.description = desc.value.trim(); await db.saveCollection(col); }
    redraw();
  });

  fill(root,
    bar(nav, { actions: [h('button', { class: 'icon-btn', 'aria-label': 'Edit collection', onclick: edit }, icon('more'))] }),
    screen(
      h('header', { class: 'head collection-head' },
        h('div', { class: 'eyebrow' }, [plural(notes.length, 'note', 'notes'), photos.length ? plural(photos.length, 'photograph', 'photographs') : null].filter(Boolean).join(' · ')),
        h('h1', { class: 'display' }, col.name),
        col.description ? h('p', { class: 'lede' }, col.description) : null,
      ),
      col.coverPhotoId ? h('div', { class: 'collection-cover' }, photoImg(col.coverPhotoId, 'full')) : null,
      h('button', { class: 'new-note slim', onclick: () => nav.compose(id) }, h('span', { class: 'new-note-text' }, 'New note here'), icon('compose')),
      notes.length
        ? h('section', { class: 'section tight' }, noteList(notes, nav, 'createdAt'))
        : h('p', { class: 'empty-note' }, 'Nothing here yet. Write a note here, or add an existing note from its “…” menu.'),
      photos.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'eyebrow' }, 'Photographs')),
        h('div', { class: 'gallery-grid' }, photos.map((p, i) => h('button', {
          class: 'gallery-item', 'aria-label': p.caption || 'Photograph',
          onclick: () => openLightbox(photos, i, nav, collections),
        }, photoImg(p.photoId, 'thumb')))),
      ) : null,
    ),
  );
}

// ================= LIGHTBOX (one photograph, with where it belongs) =================

export function openLightbox(items, startIndex, nav, collections = []) {
  let index = startIndex;
  const img = h('img', { class: 'lightbox-img', alt: '' });
  const foot = h('div', { class: 'lightbox-foot' });
  const count = h('span', { class: 'lightbox-count' });
  const colById = new Map(collections.map((c) => [c.id, c]));

  async function draw() {
    const item = items[index];
    img.src = (await photoURL(item.photoId, 'full')) || '';
    img.alt = item.caption || '';
    count.textContent = items.length > 1 ? `${index + 1} of ${items.length}` : '';
    const cols = (item.note?.collections || []).map((id) => colById.get(id)).filter(Boolean);
    fill(foot,
      item.caption ? h('p', { class: 'lightbox-caption' }, item.caption) : null,
      h('div', { class: 'lightbox-meta' },
        h('span', { class: 'caption-date' }, fmt.medium(item.date || item.when || iso(item.note.createdAt))),
        item.note ? h('button', { onclick: () => { close(); nav.open(item.note.id); } }, `${noteTitle(item.note)} →`) : null,
      ),
      cols.length ? h('p', { class: 'lightbox-cols' }, 'In ', cols.flatMap((c, i) => [
        i ? ', ' : null,
        h('button', { onclick: () => { close(); nav.go(`collection/${c.id}`); } }, c.name),
      ])) : null,
    );
  }

  const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 220); };
  const move = (d) => { const n = index + d; if (n >= 0 && n < items.length) { index = n; draw(); } };

  const overlay = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photograph' },
    h('div', { class: 'lightbox-top' },
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close')),
      count,
      h('span', { class: 'bar-spacer' }),
    ),
    h('div', { class: 'lightbox-stage' }, img),
    foot,
  );

  let sx = 0; let sy = 0;
  overlay.addEventListener('touchstart', (ev) => { sx = ev.touches[0].clientX; sy = ev.touches[0].clientY; }, { passive: true });
  overlay.addEventListener('touchend', (ev) => {
    const dx = ev.changedTouches[0].clientX - sx;
    const dy = ev.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
    else if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.5) close(); // swipe down to close
  });
  document.addEventListener('keydown', function onKey(ev) {
    if (!overlay.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (ev.key === 'Escape') close();
    if (ev.key === 'ArrowRight') move(1);
    if (ev.key === 'ArrowLeft') move(-1);
  });

  document.body.append(overlay);
  draw();
  requestAnimationFrame(() => overlay.classList.add('show'));
}

// Used by the editor: open one of a note's photographs.
export async function openNotePhoto(note, photoId, nav) {
  const collections = await db.allCollections();
  const items = (note.photos || []).map((p) => ({ ...p, note }));
  const index = Math.max(0, items.findIndex((p) => p.photoId === photoId));
  if (items.length) openLightbox(items, index, nav, collections);
}

// ================= SEARCH =================

let lastQuery = '';
let lastMonth = '';

export async function renderSearch(root, nav) {
  const [notes, collections] = await Promise.all([db.allEntries(), db.allCollections()]);
  const colNames = new Map(collections.map((c) => [c.id, c.name]));

  // Everything searchable about a note, in one lowercase string.
  const haystack = new Map(notes.map((n) => [n.id, [
    n.title, n.text,
    ...(n.photos || []).map((p) => p.caption),
    ...(n.collections || []).map((id) => colNames.get(id)),
    n.place?.name, n.song?.title, n.dateWords,
    ...(n.dateKind === 'unknown' ? [] : [fmt.long(iso(n.createdAt)), fmt.dots(iso(n.createdAt)), fmt.dots(iso(n.createdAt)).slice(0, 5)]),
  ].filter(Boolean).join(' \n ').toLowerCase()]));

  const months = [...new Set(notes.map((n) => iso(n.createdAt).slice(0, 7)))].sort().reverse();
  const input = h('input', { class: 'search-field', type: 'search', placeholder: 'Search', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Search', value: lastQuery });
  const monthSelect = h('select', { class: 'search-month', 'aria-label': 'Filter by month' },
    h('option', { value: '' }, 'Any time'),
    months.map((m) => h('option', { value: m, selected: m === lastMonth }, fmt.monthYear(`${m}-01`))),
  );
  const results = h('div', {});

  const run = () => {
    lastQuery = input.value;
    lastMonth = monthSelect.value;
    const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const inMonth = (n) => !lastMonth || iso(n.createdAt).startsWith(lastMonth);
    if (!words.length && !lastMonth) {
      fill(results, h('p', { class: 'search-hint' }, 'Search titles, the words inside your notes, collections, photo captions, places and songs. A date like 28.09 works too.'));
      return;
    }
    const match = (text) => words.every((w) => (text || '').toLowerCase().includes(w));
    const foundNotes = notes.filter((n) => inMonth(n) && words.every((w) => haystack.get(n.id).includes(w))).sort((a, b) => b.createdAt - a.createdAt);
    const foundCols = words.length ? collections.filter((c) => match(`${c.name} ${c.description || ''}`)) : [];
    const foundPhotos = words.length
      ? notes.filter(inMonth).flatMap((n) => (n.photos || []).filter((p) => p.caption && match(p.caption)).map((p) => ({ ...p, note: n })))
      : [];

    fill(results,
      foundCols.length ? h('section', { class: 'section tight' },
        h('div', { class: 'section-head' }, h('h2', { class: 'eyebrow' }, 'Collections')),
        h('ul', { class: 'words small' }, foundCols.map((c) => wordEntrance(c, notes, nav))),
      ) : null,
      foundNotes.length ? h('section', { class: 'section tight' },
        h('div', { class: 'section-head' }, h('h2', { class: 'eyebrow' }, plural(foundNotes.length, 'note', 'notes'))),
        noteList(foundNotes, nav, 'createdAt'),
      ) : null,
      foundPhotos.length ? h('section', { class: 'section tight' },
        h('div', { class: 'section-head' }, h('h2', { class: 'eyebrow' }, 'Photographs')),
        h('ul', { class: 'rows' }, foundPhotos.map((p, i) => h('li', {},
          h('button', { class: 'note-row', onclick: () => openLightbox(foundPhotos, i, nav, collections) },
            h('span', { class: 'note-row-body' },
              h('span', { class: 'note-row-title caption' }, p.caption),
              h('span', { class: 'note-row-sub' }, h('span', { class: 'note-row-text' }, `In “${noteTitle(p.note)}”`)),
            ),
            h('span', { class: 'row-thumb' }, photoImg(p.photoId, 'thumb')),
          )))),
      ) : null,
      !foundCols.length && !foundNotes.length && !foundPhotos.length ? h('p', { class: 'search-hint' }, 'Nothing found.') : null,
    );
  };
  input.addEventListener('input', run);
  monthSelect.addEventListener('change', run);
  run();

  fill(root, screen(
    head({ title: 'Search', tab: true }),
    input,
    months.length ? h('label', { class: 'search-filter' }, h('span', { class: 'eyebrow' }, 'When'), monthSelect) : null,
    results,
  ));
}

// ================= SETTINGS =================

export async function renderSettings(root, nav) {
  const [motto, specialDate, specialLabel, wordsText] = await Promise.all([db.getSetting('motto', ''), db.getSetting('specialDate', ''), db.getSetting('specialLabel', ''), db.getSetting('words', '')]);
  const lockWords = await db.getSetting('lockWords', true);
  const openingOn = await db.getSetting('opening', true);
  const [bookTitle, writingFont, lastBackup, notes, photoIds, canFaceId, hasFaceId] = await Promise.all([
    db.getSetting('bookTitle', 'Little Memories'),
    db.getSetting('writingFont', 'clean'),
    db.getSetting('lastBackup'),
    db.allEntries(),
    db.photoIds(),
    faceIdSupported(),
    faceIdEnabled(),
  ]);
  let storage = null;
  try { storage = await navigator.storage?.estimate(); } catch { /* not available */ }

  const fontSelect = h('select', {
    class: 'set-select',
    onchange: async (e) => {
      await db.setSetting('writingFont', e.target.value);
      document.documentElement.dataset.font = e.target.value;
    },
  },
  h('option', { value: 'clean', selected: writingFont === 'clean' }, 'Sans-serif'),
  h('option', { value: 'book', selected: writingFont === 'book' }, 'Handwriting'));

  const faceIdRow = h('label', { class: 'set-row' },
    h('span', {}, 'Unlock with Face ID'),
    h('input', {
      type: 'checkbox', class: 'switch', checked: hasFaceId, disabled: !canFaceId,
      onchange: async (e) => {
        if (e.target.checked) {
          try { await enableFaceId(bookTitle); toast('Face ID is on'); } catch { e.target.checked = false; toast('Face ID couldn’t be turned on'); }
        } else { await disableFaceId(); toast('Face ID is off'); }
      },
    }),
  );

  const importInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file) return;
    try {
      toast('Reading backup…');
      const { pages, total } = await importBackup(file);
      toast(`Restored ${pages} of ${total} notes`);
      renderSettings(root, nav);
    } catch (err) {
      ask({ title: 'Couldn’t restore', message: err.message || 'Something went wrong.', ok: 'OK', cancel: 'Close' });
    }
  });

  const exportBtn = h('button', {
    class: 'set-row',
    onclick: async () => {
      exportBtn.disabled = true;
      toast('Preparing your backup…');
      try {
        const file = await createBackup();
        exportBtn.disabled = false;
        const go = await ask({
          title: 'Your backup is ready',
          message: `${formatBytes(file.size)}. Choose “Save to Files” and keep it in iCloud Drive or another safe place.`,
          ok: 'Save',
        });
        if (!go) return;
        pauseAutoLock();
        const saved = await shareBackup(file).finally(resumeAutoLock);
        if (saved) { toast('Backup saved'); renderSettings(root, nav); }
      } catch (err) {
        exportBtn.disabled = false;
        ask({ title: 'Backup failed', message: err.message || 'Something went wrong.', ok: 'OK', cancel: 'Close' });
      }
    },
  }, h('span', {}, 'Export backup'), icon('chevron'));

  const textRow = (label, key, value, placeholder) => h('label', { class: 'set-row' }, h('span', {}, label),
    h('input', {
      class: 'set-input', type: 'text', value: value || '', placeholder, maxlength: 60,
      onchange: async (e) => { await db.setSetting(key, e.target.value.trim()); toast('Saved'); window.dispatchEvent(new CustomEvent('notes-changed', { detail: {} })); },
    }));
  const dateText = h('span', { class: 'set-value' }, specialDate ? fmt.medium(specialDate) : 'Choose');
  // ----- your own drawings -----
  let drawings = await db.getSetting('drawings', []) || [];
  const drawingGrid = h('div', { class: 'drawing-grid' });
  const drawingInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const drawDrawings = () => fill(drawingGrid,
    drawings.map((id) => h('button', {
      class: 'drawing-tile', 'aria-label': 'Remove this drawing',
      onclick: async () => {
        if (!await ask({ title: 'Remove this drawing?', ok: 'Remove', danger: true })) return;
        drawings = drawings.filter((x) => x !== id);
        await db.setSetting('drawings', drawings);
        forgetPhotoURL(id);
        await db.deletePhoto(id);
        drawDrawings();
      },
    }, photoImg(id, 'full', 'drawing'))),
    h('button', { class: 'drawing-tile add', onclick: () => pickFiles(drawingInput) }, '+ Add'),
  );
  drawingInput.addEventListener('change', async () => {
    const files = [...drawingInput.files];
    drawingInput.value = '';
    for (const file of files) {
      try { drawings = [...drawings, await addDrawingFromFile(file)]; } catch { toast('One drawing couldn’t be added'); }
    }
    await db.setSetting('drawings', drawings);
    drawDrawings();
    if (files.length) toast('Added');
  });
  drawDrawings();

  // ----- opening the journal with a question instead of the PIN -----
  const openQuestions = () => sheet('A question at the door', () => {
    const list = h('div', { class: 'gate-list' });
    const toggle = h('input', { type: 'checkbox', class: 'switch', onchange: async (e) => { e.target.checked = await setGateEnabled(e.target.checked); toast(e.target.checked ? 'The journal now asks a question' : 'Back to the PIN'); } });
    const qInput = h('input', { class: 'sheet-input', type: 'text', maxlength: 140, placeholder: 'The question, e.g. “Do you remember the mountain?”', 'aria-label': 'Question' });
    const kInput = h('input', { class: 'sheet-input', type: 'text', maxlength: 300, placeholder: 'Key words, separated by commas', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Key words' });

    const draw = async () => {
      const gate = await getGate();
      toggle.checked = gate.enabled;
      toggle.disabled = !gate.questions.length;
      fill(list, gate.questions.length
        ? gate.questions.map((q) => h('div', { class: 'gate-item' },
          h('span', {}, h('strong', {}, q.text), h('small', {}, `${q.count || 'some'} key ${q.count === 1 ? 'word' : 'words'} (kept secret)`)),
          h('button', { class: 'link quiet', onclick: async () => { await removeQuestion(q.id); draw(); } }, 'Remove'),
        ))
        : h('p', { class: 'set-note' }, 'No questions yet. Add one below.'));
    };
    draw();

    return [
      h('p', { class: 'set-note first' }, 'When the journal opens, it asks one of your questions. You answer in your own words, as short or as long as you like. It opens if your answer contains one of the key words. Capital letters, accents and punctuation don’t matter.'),
      h('label', { class: 'set-row' }, h('span', {}, 'Ask a question instead of the PIN'), toggle),
      h('h4', { class: 'eyebrow sheet-label' }, 'Your questions'),
      list,
      h('h4', { class: 'eyebrow sheet-label' }, 'Add a question'),
      qInput, kInput,
      h('div', { class: 'import-actions' },
        h('span', { class: 'set-note', style: { margin: '0' } }, 'Any one key word opens it.'),
        h('button', {
          class: 'link',
          onclick: async () => {
            const ok = await addQuestion(qInput.value, kInput.value.split(','));
            if (!ok) { toast('Write a question and at least one key word'); return; }
            qInput.value = ''; kInput.value = '';
            const gate = await getGate();
            if (gate.questions.length === 1) await setGateEnabled(true); // the first question turns it on
            draw();
            toast('Question added');
          },
        }, 'Add question'),
      ),
      h('p', { class: 'set-note' }, 'Key words are stored scrambled and can’t be shown again, so remember them. The PIN always works too: tap “Use PIN instead” on the lock screen. A question is easier to guess than a PIN for someone who knows you, so choose key words only you would think of.'),
    ];
  });

  // ----- import from ChatGPT (or any text in the same format) -----
  const openImport = () => sheet('Import from ChatGPT', (close) => {
    const box = h('textarea', { class: 'sheet-input import-box', rows: 7, placeholder: 'Paste ChatGPT’s answer here', 'aria-label': 'Text to import', spellcheck: false });
    const preview = h('div', { class: 'import-preview' });
    const fileInput = h('input', { type: 'file', accept: '.json,.txt,application/json,text/plain', hidden: true });
    fileInput.addEventListener('change', async () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) { box.value = await f.text(); check(); } });
    let parsed = null;

    const check = () => {
      try {
        parsed = parseImport(box.value);
        const plural2 = (n, one, many) => `${n} ${n === 1 ? one : many}`;
        fill(preview,
          h('p', { class: 'import-summary' }, [
            parsed.notes.length ? plural2(parsed.notes.length, 'note', 'notes') : null,
            parsed.collections.length ? plural2(parsed.collections.length, 'collection', 'collections') : null,
            parsed.words.length ? plural2(parsed.words.length, 'word or sentence', 'words and sentences') : null,
          ].filter(Boolean).join(' · ')),
          parsed.notes.length ? h('ul', { class: 'import-list' }, parsed.notes.map((n) => h('li', {},
            h('strong', {}, n.title || 'Untitled'),
            h('span', {}, [
              n.dateKind === 'exact' && n.createdAt ? fmt.medium(iso(n.createdAt)) : (n.dateWords || (n.dateKind === 'unknown' ? 'date unknown' : 'today')),
              n.collections.join(', ') || null,
            ].filter(Boolean).join(' · ')),
          ))) : null,
          h('button', {
            class: 'new-note slim import-go',
            onclick: async () => {
              const r = await applyImport(parsed);
              close();
              toast(r.notes || r.words || r.collections
                ? `Added ${[r.notes ? `${r.notes} ${r.notes === 1 ? 'note' : 'notes'}` : null, r.collections ? `${r.collections} ${r.collections === 1 ? 'collection' : 'collections'}` : null, r.words ? `${r.words} ${r.words === 1 ? 'word' : 'words'}` : null].filter(Boolean).join(', ')}${r.skipped ? ` (${r.skipped} already there)` : ''}`
                : 'Everything was already in your journal');
              window.dispatchEvent(new CustomEvent('notes-changed', { detail: {} }));
              renderSettings(root, nav);
            },
          }, h('span', { class: 'new-note-text' }, 'Add to my journal')),
        );
      } catch (err) {
        parsed = null;
        fill(preview, h('p', { class: 'import-error' }, err.message));
      }
    };

    return [
      h('ol', { class: 'import-steps' },
        h('li', {}, 'Give ChatGPT the instructions once ', h('button', {
          class: 'link',
          onclick: async (e) => {
            const button = e.currentTarget; // (after "await" the event no longer knows its button)
            try { await navigator.clipboard.writeText(CHATGPT_INSTRUCTIONS); button.textContent = 'Copied ✓'; } catch { toast('Copying isn’t allowed here. The instructions are in the README.'); }
          },
        }, 'Copy instructions')),
        h('li', {}, 'After talking, tell it: “export to Little Memories”.'),
        h('li', {}, 'Copy its answer and paste it below. You see what would be added before anything is saved.'),
      ),
      box,
      h('div', { class: 'import-actions' },
        h('button', { class: 'link quiet', onclick: () => pickFiles(fileInput) }, 'Choose a file instead'),
        h('button', { class: 'link', onclick: check }, 'Check'),
      ),
      fileInput,
      preview,
    ];
  });

  const group = (title, ...rows) => h('section', { class: 'set-group' }, h('h2', { class: 'eyebrow' }, title), h('div', { class: 'set-list' }, rows));
  const info = (label, value) => h('div', { class: 'set-row static' }, h('span', {}, label), h('span', { class: 'set-value' }, value));

  fill(root,
    bar(nav),
    screen(
      head({ title: 'Settings' }),
      group('Make it yours',
        textRow('Title', 'bookTitle', bookTitle, 'Little Memories'),
        textRow('A line under the title', 'motto', motto, 'Something only you understand'),
        h('label', { class: 'set-row has-input' }, h('span', {}, 'A date that matters'), dateText,
          h('input', {
            type: 'date', value: specialDate || '', 'aria-label': 'A date that matters',
            oninput: async (e) => { await db.setSetting('specialDate', e.target.value); dateText.textContent = e.target.value ? fmt.medium(e.target.value) : 'Choose'; toast('Saved'); },
          })),
        textRow('What that day is', 'specialLabel', specialLabel, 'A word or two'),
        h('label', { class: 'set-row' }, h('span', {}, 'Appearance'),
          h('select', { class: 'set-select', onchange: (e) => setTheme(e.target.value) },
            h('option', { value: 'dark', selected: getTheme() === 'dark' }, 'Dark'),
            h('option', { value: 'light', selected: getTheme() === 'light' }, 'Light'),
            h('option', { value: 'auto', selected: getTheme() === 'auto' }, 'Follow my device'),
          )),
        h('label', { class: 'set-row' }, h('span', {}, 'Writing font'), fontSelect),
        h('label', { class: 'set-row' },
          h('span', {}, 'Play memories when opening'),
          h('input', { type: 'checkbox', class: 'switch', checked: openingOn !== false, onchange: async (e) => { await db.setSetting('opening', e.target.checked); toast('Saved'); } }),
        ),
        h('button', { class: 'set-row', onclick: () => playOpening({ force: true }) }, h('span', {}, 'Play the opening now'), icon('chevron')),
      ),
      h('section', { class: 'set-group' },
        h('h2', { class: 'eyebrow' }, 'Words and sentences that matter'),
        h('textarea', {
          class: 'sheet-input words-input', rows: 8, value: wordsText, 'aria-label': 'Words that matter', maxlength: 3000,
          placeholder: 'One per line: a nickname, a phrase, a place, a date, a sentence you never want to forget…',
          onchange: async (e) => { await db.setSetting('words', e.target.value); toast('Saved'); },
        }),
      ),
      h('section', { class: 'set-group' },
        h('h2', { class: 'eyebrow' }, 'Your drawings'),
        drawingGrid,
        drawingInput,
      ),
      h('p', { class: 'set-note' }, 'Pen sketches of moments: holding hands, a dance, falling asleep on a shoulder. Draw them yourself or have them drawn, as dark lines on a white background. They appear in the opening and on the first page, and stay only on this device.'),
      h('p', { class: 'set-note' }, 'One per line: single words, or whole sentences. After the PIN, the journal opens with them popping up across the page, together with your places, photographs and lines from your notes, different each time (tap to skip). Your words are also scribbled across the first page, between small drawings and a spiral of your photographs. Everything here is saved only on this device: the line appears under the title, and the date is marked at the top of the mountain.'),
      group('Privacy',
        h('button', { class: 'set-row', onclick: openQuestions }, h('span', {}, 'Open with a question'), icon('chevron')),
        h('button', { class: 'set-row', onclick: async () => { if (await changePin()) toast('PIN changed'); } }, h('span', {}, 'Change PIN'), icon('chevron')),
        faceIdRow,
        h('label', { class: 'set-row' },
          h('span', {}, 'Show my words on the lock screen'),
          h('input', { type: 'checkbox', class: 'switch', checked: lockWords !== false, onchange: async (e) => { await db.setSetting('lockWords', e.target.checked); toast('Saved'); } }),
        ),
        h('button', { class: 'set-row', onclick: () => nav.lock() }, h('span', {}, 'Lock now'), icon('lock')),
      ),
      h('p', { class: 'set-note' }, 'The lock screen can be seen before the PIN is entered. It shows your title, your words and small drawings, never photographs. Turn the switch off to keep the words hidden there too.'),
      h('p', { class: 'set-note' }, canFaceId
        ? 'The journal locks every time you leave the app. Face ID uses a passkey saved in your iPhone’s Passwords app.'
        : 'The journal locks every time you leave the app. Face ID becomes available when the journal is opened from your Home Screen.'),
      group('Bring in notes',
        h('button', { class: 'set-row', onclick: openImport }, h('span', {}, 'Import from ChatGPT'), icon('chevron')),
      ),
      h('p', { class: 'set-note' }, 'Turn a conversation into notes: ChatGPT writes them in a simple format, you paste them here. The app never connects to ChatGPT; you decide what comes in.'),
      group('Backup',
        exportBtn,
        h('button', { class: 'set-row', onclick: () => pickFiles(importInput) }, h('span', {}, 'Restore from a backup'), icon('chevron')),
        info('Last backup', lastBackup ? fmt.medium(iso(lastBackup)) : 'Never'),
      ),
      importInput,
      h('p', { class: 'set-note' }, 'Everything is stored only on this iPhone, never on the internet. If you remove the app from your Home Screen or lose your phone, the journal is gone with it. Export a backup every week or two and keep it in iCloud Drive. The backup is a zip file with all your notes and original photographs.'),
      group('About',
        info('Notes', notes.length),
        info('Photographs', photoIds.length),
        storage ? info('Space used', formatBytes(storage.usage)) : null,
        info('Version', APP_VERSION),
      ),
      h('p', { class: 'colophon' }, 'This book belongs to you.'),
    ),
  );
}
