// views.js — all the screens of the book (except the editor and the lock screen).

import { db } from './db.js';
import {
  h, icon, fmt, todayISO, greeting, entryText, entryPhotos, byNewest, toast, ask, formatBytes, uid,
  pickFiles, pauseAutoLock, resumeAutoLock,
} from './util.js';
import { KINDS, moodById, promptOfTheDay } from './content.js';
import { photoImg, photoURL } from './photos.js';
import { changePin, faceIdSupported, faceIdEnabled, enableFaceId, disableFaceId } from './lock.js';
import { createBackup, shareBackup, importBackup } from './backup.js';

export const APP_VERSION = '1.0.0';

// The chapters shown on the contents page.
export const CHAPTERS = [
  { route: 'thoughts',    kind: 'thought', title: "Today's thoughts", sub: 'Whatever is on your mind' },
  { route: 'journal',     kind: null,      title: 'Journal',          sub: 'Every page, in order' },
  { route: 'letters',     kind: 'letter',  title: 'Letters',          sub: 'Letters you may never send' },
  { route: 'memories',    kind: 'memory',  title: 'Memories',         sub: 'Moments you never want to forget' },
  { route: 'details',     kind: 'detail',  title: 'Little details',   sub: 'The tiny things you remember' },
  { route: 'timeline',    kind: null,      title: 'Timeline',         sub: 'Important dates' },
  { route: 'collections', kind: null,      title: 'Collections',      sub: 'Memories that belong together' },
  { route: 'gallery',     kind: null,      title: 'Gallery',          sub: 'All your photographs' },
  { route: 'favourites',  kind: null,      title: 'Favourites',       sub: 'The pages that mean the most' },
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// ================= shared pieces =================

function topbar(nav, { title = '', back = true, actions = [] } = {}) {
  return h('header', { class: 'topbar' },
    back
      ? h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => nav.back() }, icon('back'))
      : h('span', { class: 'icon-btn-space' }),
    h('div', { class: 'topbar-center' }, title ? h('div', { class: 'topbar-kicker' }, title) : null),
    h('div', { class: 'topbar-actions' }, actions),
  );
}

function chapterHeading(title, sub, numeral) {
  return h('div', { class: 'chapter-heading' },
    numeral ? h('div', { class: 'chapter-numeral' }, `Chapter ${numeral}`) : null,
    h('h1', { class: 'chapter-title' }, title),
    sub ? h('p', { class: 'chapter-sub' }, sub) : null,
    h('div', { class: 'ornament', 'aria-hidden': 'true' }, '❦'),
  );
}

function emptyState(text, buttonLabel, onClick) {
  return h('div', { class: 'empty' },
    h('div', { class: 'ornament big', 'aria-hidden': 'true' }, '✧'),
    h('p', {}, text),
    buttonLabel ? h('button', { class: 'soft-btn', onclick: onClick }, icon('quill'), buttonLabel) : null,
  );
}

function writeButton(label, onClick) {
  return h('button', { class: 'fab', 'aria-label': label, onclick: onClick }, icon('quill'));
}

function groupByMonth(entries) {
  const groups = [];
  for (const e of entries) {
    const key = e.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, label: fmt.monthYear(e.date), items: [] }; groups.push(g); }
    g.items.push(e);
  }
  return groups;
}

function displayTitle(e) {
  return e.title?.trim() || (KINDS[e.kind] || KINDS.entry).emptyTitle;
}

// One page in a list.
function entryCard(e, nav, list) {
  const mood = moodById(e.mood);
  const photos = entryPhotos(e);
  const text = entryText(e);
  const open = () => nav.read(e.id, list);

  if (e.kind === 'letter') {
    return h('button', { class: 'envelope', onclick: open },
      h('span', { class: 'envelope-flap', 'aria-hidden': 'true' }),
      h('span', { class: 'seal', 'aria-hidden': 'true' }, '♥'),
      h('span', { class: 'envelope-body' },
        h('span', { class: 'envelope-date' }, fmt.medium(e.date)),
        h('span', { class: 'envelope-title' }, displayTitle(e)),
        h('span', { class: 'envelope-preview' }, text.replace(/^Dear[^\n]*\n*/i, '').slice(0, 140)),
      ),
      e.favorite ? icon('star', 'card-star') : null,
    );
  }

  if (e.kind === 'detail') {
    return h('button', { class: 'note-card', onclick: open },
      photos[0] ? h('div', { class: 'note-photo' }, photoImg(photos[0].photoId, 'thumb', 'vintage')) : null,
      h('p', { class: 'note-text' }, e.title?.trim() || text.slice(0, 180) || '…'),
      h('span', { class: 'note-date' }, fmt.dots(e.date)),
    );
  }

  return h('button', { class: 'entry-card', onclick: open },
    h('span', { class: 'entry-date' },
      h('span', { class: 'entry-day' }, fmt.day(e.date)),
      h('span', { class: 'entry-weekday' }, fmt.weekdayShort(e.date)),
    ),
    h('span', { class: 'entry-body' },
      h('span', { class: 'entry-kicker' }, [
        e.kind !== 'entry' ? (KINDS[e.kind]?.one || '') : null,
        e.time || null,
      ].filter(Boolean).join(' · ')),
      h('span', { class: 'entry-title' }, displayTitle(e)),
      text ? h('span', { class: 'entry-preview' }, text.slice(0, 200)) : null,
    ),
    h('span', { class: 'entry-side' },
      photos[0] ? h('span', { class: 'entry-thumb' }, photoImg(photos[0].photoId, 'thumb', 'vintage')) : null,
      h('span', { class: 'entry-icons' },
        mood ? h('span', { class: 'entry-mood', title: mood.label }, mood.emoji) : null,
        e.favorite ? icon('star', 'card-star') : null,
      ),
    ),
  );
}

function monthList(entries, nav) {
  const sorted = [...entries].sort(byNewest);
  // The reader flips forward in time, so give it the list oldest → newest.
  const readingOrder = [...sorted].reverse().map((e) => e.id);
  return groupByMonth(sorted).map((g) => h('section', { class: 'month-group' },
    h('h2', { class: 'month-label' }, g.label),
    h('div', { class: g.items.every((e) => e.kind === 'detail') ? 'notes-grid' : 'cards' },
      g.items.map((e) => entryCard(e, nav, readingOrder))),
  ));
}

// ================= HOME / CONTENTS =================

export async function renderHome(root, nav) {
  const [entries, bookTitle, lastBackup] = await Promise.all([
    db.allEntries(), db.getSetting('bookTitle', 'Little Memories'), db.getSetting('lastBackup'),
  ]);
  const now = new Date();
  const today = todayISO(now);
  const monthDay = today.slice(5);

  const counts = {
    thoughts: entries.filter((e) => e.kind === 'thought').length,
    journal: entries.length,
    letters: entries.filter((e) => e.kind === 'letter').length,
    memories: entries.filter((e) => e.kind === 'memory').length,
    details: entries.filter((e) => e.kind === 'detail').length,
    timeline: entries.filter((e) => e.milestone).length,
    collections: (await db.allCollections()).length,
    gallery: entries.reduce((n, e) => n + entryPhotos(e).length, 0),
    favourites: entries.filter((e) => e.favorite).length,
  };

  const onThisDay = entries
    .filter((e) => e.date.slice(5) === monthDay && e.date.slice(0, 4) < today.slice(0, 4))
    .sort(byNewest);

  const needsBackup = entries.length > 0 && (!lastBackup || Date.now() - lastBackup > 14 * 86400000);

  root.replaceChildren(
    h('header', { class: 'topbar transparent' },
      h('button', { class: 'icon-btn', 'aria-label': 'Lock', onclick: () => nav.lock() }, icon('lock')),
      h('div', { class: 'topbar-center' }),
      h('div', { class: 'topbar-actions' },
        h('button', { class: 'icon-btn', 'aria-label': 'Search', onclick: () => nav.go('search') }, icon('search')),
        h('button', { class: 'icon-btn', 'aria-label': 'Calendar', onclick: () => nav.go('calendar') }, icon('calendar')),
        h('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: () => nav.go('settings') }, icon('gear')),
      ),
    ),
    h('main', { class: 'content home' },
      h('div', { class: 'cover' },
        h('div', { class: 'cover-ornament', 'aria-hidden': 'true' }, '❦'),
        h('h1', { class: 'cover-title' }, bookTitle),
        h('p', { class: 'cover-sub' }, `${greeting(now)} · ${fmt.long(today)}`),
      ),

      h('button', { class: 'prompt-card', onclick: () => nav.go(`write?kind=entry&prompt=${encodeURIComponent(promptOfTheDay(now))}`) },
        h('span', { class: 'prompt-label' }, 'Today’s prompt'),
        h('span', { class: 'prompt-quote' }, `“${promptOfTheDay(now)}”`),
        h('span', { class: 'prompt-hint' }, 'Only if you feel like it'),
      ),

      h('div', { class: 'write-row' },
        h('button', { class: 'primary-btn', onclick: () => nav.go('write?kind=entry') }, icon('quill'), 'Write a page'),
        h('button', { class: 'secondary-btn', onclick: () => nav.go('write?kind=thought') }, 'A quick thought'),
      ),

      needsBackup ? h('button', { class: 'backup-nudge', onclick: () => nav.go('settings') },
        h('strong', {}, lastBackup ? 'It’s been a while since your last backup.' : 'You haven’t made a backup yet.'),
        h('span', {}, 'Keep your memories safe →'),
      ) : null,

      onThisDay.length ? h('section', { class: 'on-this-day' },
        h('h2', { class: 'small-heading' }, 'On this day'),
        onThisDay.slice(0, 3).map((e) => h('button', { class: 'otd-item', onclick: () => nav.read(e.id, onThisDay.map((x) => x.id).reverse()) },
          h('span', { class: 'otd-year' }, e.date.slice(0, 4)),
          h('span', { class: 'otd-title' }, displayTitle(e)),
        )),
      ) : null,

      h('section', { class: 'contents' },
        h('h2', { class: 'contents-heading' }, 'Contents'),
        h('ol', { class: 'toc' },
          CHAPTERS.map((c, i) => h('li', {},
            h('button', { class: 'toc-item', onclick: () => nav.go(c.route) },
              h('span', { class: 'toc-num' }, ROMAN[i]),
              h('span', { class: 'toc-title' }, c.title),
              h('span', { class: 'toc-dots', 'aria-hidden': 'true' }),
              h('span', { class: 'toc-count' }, counts[c.route] || '–'),
            ))),
        ),
      ),
      h('p', { class: 'colophon' }, 'This book belongs to you.'),
    ),
  );
}

// ================= LISTS (journal, thoughts, letters, memories, favourites) =================

export async function renderList(root, nav, route) {
  const chapterIndex = CHAPTERS.findIndex((c) => c.route === route);
  const chapter = CHAPTERS[chapterIndex];
  let entries = await db.allEntries();
  let writeKind = chapter.kind || 'entry';

  if (route === 'favourites') entries = entries.filter((e) => e.favorite);
  else if (chapter.kind) entries = entries.filter((e) => e.kind === chapter.kind);

  const listArea = h('div', {});
  let filter = 'all';

  function draw() {
    const shown = route === 'journal' && filter !== 'all' ? entries.filter((e) => e.kind === filter) : entries;
    if (!shown.length) {
      const msg = {
        thoughts: 'No thoughts yet. Write whatever is on your mind, no title needed.',
        journal: 'Your book is still empty. The first page is waiting.',
        letters: 'No letters yet. Write one you may never send.',
        memories: 'No memories yet. Save a moment you never want to forget.',
        favourites: 'No favourites yet. Tap the ☆ on a page that means a lot to you.',
      }[route] || 'Nothing here yet.';
      listArea.replaceChildren(emptyState(msg, route === 'favourites' ? null : 'Write', () => nav.go(`write?kind=${writeKind}`)));
    } else {
      listArea.replaceChildren(...monthList(shown, nav));
    }
  }

  let filters = null;
  if (route === 'journal') {
    const kinds = [['all', 'All'], ['entry', 'Pages'], ['thought', 'Thoughts'], ['letter', 'Letters'], ['memory', 'Memories'], ['detail', 'Details']];
    filters = h('div', { class: 'chips filter-chips' },
      kinds.map(([k, label]) => h('button', {
        class: `chip ${k === filter ? 'on' : ''}`,
        onclick: (ev) => {
          filter = k;
          writeKind = k === 'all' ? 'entry' : k;
          filters.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
          ev.currentTarget.classList.add('on');
          draw();
        },
      }, label)));
  }

  draw();

  // The first time you open Letters, ask who they are for. The name is saved only on this phone.
  if (route === 'letters' && (await db.getSetting('letterTo')) === null) {
    setTimeout(async () => {
      const name = await ask({
        title: 'Who are your letters for?',
        message: 'New letters will start with “Dear …”. The name stays only on this phone, and you can change it in Settings.',
        input: '', placeholder: 'A name', ok: 'Save', cancel: 'Skip',
      });
      await db.setSetting('letterTo', name || '');
    }, 300);
  }

  root.replaceChildren(
    topbar(nav),
    h('main', { class: 'content' },
      chapterHeading(chapter.title, chapter.sub, ROMAN[chapterIndex]),
      filters,
      listArea,
    ),
    route === 'favourites' ? null : writeButton('Write', () => nav.go(`write?kind=${writeKind}`)),
  );
}

// ================= LITTLE DETAILS =================

export async function renderDetails(root, nav) {
  const chapterIndex = CHAPTERS.findIndex((c) => c.route === 'details');
  const entries = (await db.allEntries()).filter((e) => e.kind === 'detail');
  const quick = h('textarea', { class: 'quick-input', rows: 2, placeholder: 'The way she laughs… her voice when… write it down before it fades.' });
  const addBtn = h('button', {
    class: 'soft-btn',
    onclick: async () => {
      const text = quick.value.trim();
      if (!text) { quick.focus(); return; }
      const now = Date.now();
      await db.saveEntry({
        id: uid(), kind: 'detail', title: '', date: todayISO(), time: '', mood: null,
        blocks: [{ type: 'text', text }], collections: [], favorite: false, milestone: false,
        createdAt: now, updatedAt: now,
      });
      toast('Kept safe');
      renderDetails(root, nav);
    },
  }, 'Keep this');

  root.replaceChildren(
    topbar(nav),
    h('main', { class: 'content' },
      chapterHeading('Little details', 'Her laugh, her voice, the way she smiled. All the tiny things you remember.', ROMAN[chapterIndex]),
      h('div', { class: 'paper quick-card' }, quick, h('div', { class: 'quick-actions' }, addBtn)),
      entries.length ? monthList(entries, nav) : emptyState('Nothing here yet. Even the smallest detail is worth keeping.'),
    ),
    writeButton('New little detail with photo', () => nav.go('write?kind=detail')),
  );
}

// ================= READER (flip through pages) =================

export async function renderReader(root, nav, id, readingList) {
  const all = await db.allEntries();
  let order = (readingList && readingList.includes(id))
    ? readingList.filter((x) => all.some((e) => e.id === x))
    : [...all].sort(byNewest).reverse().map((e) => e.id);
  let index = order.indexOf(id);
  const byId = new Map(all.map((e) => [e.id, e]));
  const collections = new Map((await db.allCollections()).map((c) => [c.id, c]));

  const pageWrap = h('div', { class: 'page-wrap' });
  const favBtn = h('button', { class: 'icon-btn fav', 'aria-label': 'Favourite' }, icon('star'));
  const counter = h('span', { class: 'page-counter' });
  const prevBtn = h('button', { class: 'flip-btn', 'aria-label': 'Previous page', onclick: () => flip(-1) }, icon('left'));
  const nextBtn = h('button', { class: 'flip-btn', 'aria-label': 'Next page', onclick: () => flip(1) }, icon('right'));

  favBtn.addEventListener('click', async () => {
    const e = byId.get(order[index]);
    e.favorite = !e.favorite;
    e.updatedAt = Date.now();
    await db.saveEntry(e);
    favBtn.classList.toggle('on', e.favorite);
    toast(e.favorite ? 'Added to favourites' : 'Removed from favourites');
  });

  function drawPage() {
    const e = byId.get(order[index]);
    nav.replace(`read/${e.id}`);
    favBtn.classList.toggle('on', !!e.favorite);
    counter.textContent = `${index + 1} / ${order.length}`;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === order.length - 1;
    const mood = moodById(e.mood);
    const photosInPage = entryPhotos(e);

    pageWrap.replaceChildren(h('article', { class: `paper page reading kind-${e.kind}` },
      h('div', { class: 'reading-meta' },
        h('span', {}, fmt.long(e.date)),
        e.time ? h('span', {}, e.time) : null,
      ),
      e.kind !== 'entry' ? h('div', { class: 'reading-kind' }, KINDS[e.kind]?.one) : null,
      h('h1', { class: 'reading-title' }, displayTitle(e)),
      mood ? h('div', { class: 'reading-mood' }, `${mood.emoji} ${mood.label}`) : null,
      h('div', { class: 'reading-body' },
        (e.blocks || []).map((b) => {
          if (b.type === 'photo') {
            const i = photosInPage.indexOf(b);
            return h('figure', { class: 'polaroid', style: { '--tilt': `${((i % 3) - 1) * 1.2}deg` } },
              h('span', { class: 'tape tape-left' }), h('span', { class: 'tape tape-right' }),
              h('button', { class: 'polaroid-img', 'aria-label': 'Open photo', onclick: () => openLightbox(photosInPage.map((p) => ({ ...p, entry: e })), i, nav) },
                photoImg(b.photoId, 'full', 'vintage')),
              (b.caption || b.date) ? h('figcaption', {},
                b.caption ? h('span', { class: 'caption-text' }, b.caption) : null,
                b.date ? h('span', { class: 'caption-date-text' }, fmt.dots(b.date)) : null,
              ) : null,
            );
          }
          return b.text ? h('div', { class: 'reading-text' }, b.text) : null;
        }),
      ),
      (e.collections || []).length ? h('div', { class: 'chips reading-chips' },
        e.collections.map((cid) => collections.get(cid)).filter(Boolean)
          .map((c) => h('button', { class: 'chip on', onclick: () => nav.go(`collection/${c.id}`) }, c.name)),
      ) : null,
      e.milestone ? h('div', { class: 'reading-milestone' }, '✦ On your timeline') : null,
    ));
    window.scrollTo(0, 0);
  }

  let flipping = false;
  function flip(dir) {
    const next = index + dir;
    if (flipping || next < 0 || next >= order.length) return;
    flipping = true;
    pageWrap.classList.add(dir > 0 ? 'turn-out-left' : 'turn-out-right');
    setTimeout(() => {
      index = next;
      drawPage();
      pageWrap.classList.remove('turn-out-left', 'turn-out-right');
      pageWrap.classList.add(dir > 0 ? 'turn-in-right' : 'turn-in-left');
      setTimeout(() => { pageWrap.classList.remove('turn-in-right', 'turn-in-left'); flipping = false; }, 280);
    }, 230);
  }

  // Swipe left/right to turn the page.
  let startX = 0; let startY = 0;
  pageWrap.addEventListener('touchstart', (ev) => { startX = ev.touches[0].clientX; startY = ev.touches[0].clientY; }, { passive: true });
  pageWrap.addEventListener('touchend', (ev) => {
    const dx = ev.changedTouches[0].clientX - startX;
    const dy = ev.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) flip(dx < 0 ? 1 : -1);
  });

  if (index < 0) { nav.back(); return; }
  root.replaceChildren(
    topbar(nav, {
      actions: [
        favBtn,
        h('button', { class: 'icon-btn', 'aria-label': 'Edit', onclick: () => nav.go(`edit/${order[index]}`) }, icon('edit')),
      ],
    }),
    h('main', { class: 'content reader' }, pageWrap),
    h('nav', { class: 'flip-bar' }, prevBtn, counter, nextBtn),
  );
  drawPage();
}

// ================= LIGHTBOX (a photo in full size) =================

export function openLightbox(items, startIndex, nav) {
  let index = startIndex;
  let vintage = false; // show the untouched original by default
  const img = h('img', { class: 'lightbox-img', alt: '' });
  const caption = h('div', { class: 'lightbox-caption' });
  const counter = h('span', { class: 'lightbox-counter' });

  async function draw() {
    const item = items[index];
    img.src = (await photoURL(item.photoId, 'full')) || '';
    img.classList.toggle('vintage', vintage);
    caption.replaceChildren(
      item.caption ? h('p', { class: 'lightbox-caption-text' }, item.caption) : null,
      h('p', { class: 'lightbox-caption-date' }, fmt.medium(item.date || item.entry.date)),
      h('button', { class: 'lightbox-link', onclick: () => { close(); nav.read(item.entry.id); } }, `From “${displayTitle(item.entry)}” →`),
    );
    counter.textContent = items.length > 1 ? `${index + 1} / ${items.length}` : '';
  }

  const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
  const move = (d) => { const n = index + d; if (n >= 0 && n < items.length) { index = n; draw(); } };

  const overlay = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'lightbox-top' },
      h('button', { class: 'icon-btn light', 'aria-label': 'Close', onclick: close }, icon('close')),
      counter,
      h('button', { class: 'text-chip', onclick: (ev) => { vintage = !vintage; img.classList.toggle('vintage', vintage); ev.currentTarget.textContent = vintage ? 'Original' : 'Vintage'; } }, 'Vintage'),
    ),
    h('div', { class: 'lightbox-stage' }, img),
    caption,
  );

  let sx = 0;
  overlay.addEventListener('touchstart', (ev) => { sx = ev.touches[0].clientX; }, { passive: true });
  overlay.addEventListener('touchend', (ev) => {
    const dx = ev.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 60) move(dx < 0 ? 1 : -1);
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

// ================= CALENDAR =================

export async function renderCalendar(root, nav, monthParam, selectedParam) {
  const entries = await db.allEntries();
  const byDate = new Map();
  entries.forEach((e) => { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); });

  const today = todayISO();
  let selected = selectedParam || today;
  let month = monthParam || selected.slice(0, 7);

  const grid = h('div', { class: 'cal-grid' });
  const title = h('h2', { class: 'cal-title' });
  const dayList = h('div', { class: 'cal-day-list' });

  function draw() {
    const [y, m] = month.split('-').map(Number);
    title.textContent = fmt.monthYear(`${month}-01`);
    const first = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const offset = (first.getDay() + 6) % 7; // weeks start on Monday
    const cells = [];
    ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].forEach((d) => cells.push(h('div', { class: 'cal-wd' }, d)));
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`;
      const items = byDate.get(iso) || [];
      const photo = items.flatMap(entryPhotos)[0];
      cells.push(h('button', {
        class: ['cal-cell', items.length && 'has', iso === today && 'today', iso === selected && 'selected', photo && 'has-photo'].filter(Boolean).join(' '),
        onclick: () => { selected = iso; nav.replace(`calendar?m=${month}&d=${selected}`); draw(); },
        // the 1st of the month starts in the right weekday column
        style: d === 1 ? { gridColumnStart: String(offset + 1) } : null,
      },
      photo ? h('span', { class: 'cal-photo' }, photoImg(photo.photoId, 'thumb', 'vintage')) : null,
      h('span', { class: 'cal-num' }, d),
      items.length ? h('span', { class: 'cal-dots' }, '•'.repeat(Math.min(items.length, 3))) : null));
    }
    grid.replaceChildren(...cells);

    const dayEntries = (byDate.get(selected) || []).sort(byNewest);
    const order = [...dayEntries].reverse().map((e) => e.id);
    dayList.replaceChildren(
      h('h3', { class: 'small-heading' }, fmt.long(selected)),
      dayEntries.length
        ? h('div', { class: 'cards' }, dayEntries.map((e) => entryCard(e, nav, order)))
        : h('p', { class: 'muted center' }, 'No pages on this day.'),
      h('button', { class: 'soft-btn', onclick: () => nav.go(`write?kind=entry&date=${selected}`) }, icon('quill'), 'Write for this day'),
    );
  }

  const shift = (d) => {
    const [y, m] = month.split('-').map(Number);
    const n = new Date(y, m - 1 + d, 1);
    month = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
    nav.replace(`calendar?m=${month}&d=${selected}`);
    draw();
  };

  draw();
  root.replaceChildren(
    topbar(nav, { title: 'Calendar' }),
    h('main', { class: 'content' },
      h('div', { class: 'paper cal' },
        h('div', { class: 'cal-head' },
          h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('left')),
          title,
          h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('right')),
        ),
        grid,
      ),
      dayList,
    ),
  );
}

// ================= TIMELINE =================

export async function renderTimeline(root, nav) {
  const chapterIndex = CHAPTERS.findIndex((c) => c.route === 'timeline');
  const items = (await db.allEntries()).filter((e) => e.milestone).sort(byNewest).reverse();
  const order = items.map((e) => e.id);

  root.replaceChildren(
    topbar(nav),
    h('main', { class: 'content' },
      chapterHeading('Timeline', 'The dates that changed something', ROMAN[chapterIndex]),
      items.length
        ? h('ol', { class: 'timeline' }, items.map((e) => {
          const photo = entryPhotos(e)[0];
          return h('li', { class: 'tl-item' },
            h('button', { class: 'tl-card', onclick: () => nav.read(e.id, order) },
              h('span', { class: 'tl-date' }, fmt.dots(e.date)),
              h('span', { class: 'tl-title' }, displayTitle(e)),
              photo ? h('span', { class: 'tl-photo' }, photoImg(photo.photoId, 'full', 'vintage')) : null,
              entryText(e) ? h('span', { class: 'tl-text' }, entryText(e).slice(0, 140)) : null,
            ));
        }))
        : emptyState('No important dates yet. Turn on “Important date” on any page, or add one here.', 'Add an important date', () => nav.go('write?kind=memory&milestone=1')),
    ),
    writeButton('Add an important date', () => nav.go('write?kind=memory&milestone=1')),
  );
}

// ================= COLLECTIONS =================

export async function renderCollections(root, nav) {
  const chapterIndex = CHAPTERS.findIndex((c) => c.route === 'collections');
  const [collections, entries] = await Promise.all([db.allCollections(), db.allEntries()]);
  collections.sort((a, b) => a.createdAt - b.createdAt);

  const cards = collections.map((c) => {
    const inside = entries.filter((e) => (e.collections || []).includes(c.id)).sort(byNewest);
    const photo = inside.flatMap(entryPhotos)[0];
    return h('button', { class: 'collection-card', onclick: () => nav.go(`collection/${c.id}`) },
      h('span', { class: 'collection-cover' },
        photo ? photoImg(photo.photoId, 'thumb', 'vintage') : h('span', { class: 'collection-ornament' }, '❦')),
      h('span', { class: 'collection-name' }, c.name),
      h('span', { class: 'collection-count' }, inside.length === 1 ? '1 page' : `${inside.length} pages`),
    );
  });

  const newBtn = h('button', {
    class: 'collection-card new',
    onclick: async () => {
      const name = await ask({ title: 'New collection', input: '', placeholder: 'e.g. Summer 2026', ok: 'Create' });
      if (!name) return;
      await db.saveCollection({ id: uid(), name, createdAt: Date.now() });
      renderCollections(root, nav);
    },
  }, h('span', { class: 'collection-cover' }, h('span', { class: 'collection-ornament' }, '+')), h('span', { class: 'collection-name' }, 'New collection'));

  root.replaceChildren(
    topbar(nav),
    h('main', { class: 'content' },
      chapterHeading('Collections', 'Memories that belong together', ROMAN[chapterIndex]),
      h('div', { class: 'collection-grid' }, cards, newBtn),
    ),
  );
}

export async function renderCollection(root, nav, id) {
  const collection = (await db.allCollections()).find((c) => c.id === id);
  if (!collection) { nav.go('collections'); return; }
  const entries = (await db.allEntries()).filter((e) => (e.collections || []).includes(id));

  const rename = async () => {
    const name = await ask({ title: 'Rename collection', input: collection.name, ok: 'Save' });
    if (!name) return;
    collection.name = name;
    await db.saveCollection(collection);
    renderCollection(root, nav, id);
  };
  const remove = async () => {
    const ok = await ask({ title: `Delete “${collection.name}”?`, message: 'The pages stay in your diary. Only the collection is removed.', ok: 'Delete', danger: true });
    if (!ok) return;
    const all = await db.allEntries();
    const changed = all.filter((e) => (e.collections || []).includes(id)).map((e) => ({ ...e, collections: e.collections.filter((x) => x !== id) }));
    await db.saveEntries(changed);
    await db.deleteCollection(id);
    toast('Collection deleted');
    nav.back();
  };

  root.replaceChildren(
    topbar(nav, {
      actions: [
        h('button', { class: 'icon-btn', 'aria-label': 'Rename', onclick: rename }, icon('edit')),
        h('button', { class: 'icon-btn', 'aria-label': 'Delete collection', onclick: remove }, icon('trash')),
      ],
    }),
    h('main', { class: 'content' },
      chapterHeading(collection.name, entries.length === 1 ? '1 page' : `${entries.length} pages`),
      entries.length ? monthList(entries, nav) : emptyState('This collection is still empty.', 'Write a page for it', () => nav.go(`write?kind=memory&collection=${id}`)),
    ),
    writeButton('Write', () => nav.go(`write?kind=memory&collection=${id}`)),
  );
}

// ================= GALLERY =================

export async function renderGallery(root, nav) {
  const chapterIndex = CHAPTERS.findIndex((c) => c.route === 'gallery');
  const entries = (await db.allEntries()).sort(byNewest);
  const items = entries.flatMap((e) => entryPhotos(e).map((p) => ({ ...p, entry: e })));

  const groups = [];
  for (const it of items) {
    const key = (it.date || it.entry.date).slice(0, 7);
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, items: [] }; groups.push(g); }
    g.items.push(it);
  }
  groups.sort((a, b) => b.key.localeCompare(a.key));
  const flat = groups.flatMap((g) => g.items);

  root.replaceChildren(
    topbar(nav),
    h('main', { class: 'content' },
      chapterHeading('Gallery', 'All your photographs', ROMAN[chapterIndex]),
      items.length
        ? groups.map((g) => h('section', { class: 'month-group' },
          h('h2', { class: 'month-label' }, fmt.monthYear(`${g.key}-01`)),
          h('div', { class: 'gallery-grid' }, g.items.map((it) => h('button', {
            class: 'gallery-item',
            'aria-label': it.caption || 'Photo',
            onclick: () => openLightbox(flat, flat.indexOf(it), nav),
          }, photoImg(it.photoId, 'thumb', 'vintage')))),
        ))
        : emptyState('No photographs yet. Add pictures to any page and they will appear here.'),
    ),
  );
}

// ================= SEARCH =================

export async function renderSearch(root, nav) {
  const [entries, collections] = await Promise.all([db.allEntries(), db.allCollections()]);
  const colNames = new Map(collections.map((c) => [c.id, c.name]));

  // Everything you could search for, in one lowercase string per page.
  const haystack = new Map(entries.map((e) => [e.id, [
    e.title, entryText(e),
    ...entryPhotos(e).map((p) => p.caption),
    fmt.long(e.date), fmt.dots(e.date), e.date, fmt.dots(e.date).slice(0, 5),
    KINDS[e.kind]?.label, moodById(e.mood)?.label,
    ...(e.collections || []).map((id) => colNames.get(id)),
  ].filter(Boolean).join(' \n ').toLowerCase()]));

  const input = h('input', { class: 'search', type: 'search', placeholder: 'Words, a title, or a date like 28.09', autocomplete: 'off', enterkeyhint: 'search' });
  const results = h('div', {});

  const run = () => {
    const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    nav.replace(words.length ? `search?q=${encodeURIComponent(input.value)}` : 'search');
    if (!words.length) { results.replaceChildren(h('p', { class: 'muted center' }, 'Search by title, words, dates, collections or moods.')); return; }
    const found = entries.filter((e) => words.every((w) => haystack.get(e.id).includes(w)));
    results.replaceChildren(
      h('p', { class: 'muted result-count' }, found.length === 1 ? '1 page found' : `${found.length} pages found`),
      ...monthList(found, nav),
    );
  };
  input.addEventListener('input', run);
  input.value = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
  run();

  root.replaceChildren(
    topbar(nav, { title: 'Search' }),
    h('main', { class: 'content' }, input, results),
  );
  if (!input.value) setTimeout(() => input.focus(), 50);
}

// ================= SETTINGS =================

export async function renderSettings(root, nav) {
  const [bookTitle, letterTo, writingFont, lastBackup, entries, photoIds, canFaceId, hasFaceId] = await Promise.all([
    db.getSetting('bookTitle', 'Little Memories'),
    db.getSetting('letterTo', ''),
    db.getSetting('writingFont', 'clean'),
    db.getSetting('lastBackup'),
    db.allEntries(),
    db.photoIds(),
    faceIdSupported(),
    faceIdEnabled(),
  ]);
  let storage = null;
  try { storage = await navigator.storage?.estimate(); } catch { /* not available */ }

  const textSetting = (label, key, value, placeholder) => h('label', { class: 'row' },
    h('span', {}, label),
    h('input', {
      class: 'row-input', type: 'text', value: value || '', placeholder, maxlength: 40,
      onchange: async (e) => { await db.setSetting(key, e.target.value.trim()); toast('Saved'); },
    }),
  );

  const fontSelect = h('select', {
    class: 'row-select',
    onchange: async (e) => {
      await db.setSetting('writingFont', e.target.value);
      document.documentElement.dataset.font = e.target.value;
    },
  },
  h('option', { value: 'clean', selected: writingFont === 'clean' }, 'Clean'),
  h('option', { value: 'book', selected: writingFont === 'book' }, 'Book'));

  const faceIdRow = h('label', { class: 'row' },
    h('span', {}, 'Unlock with Face ID'),
    h('input', {
      type: 'checkbox', class: 'switch', checked: hasFaceId, disabled: !canFaceId,
      onchange: async (e) => {
        if (e.target.checked) {
          try {
            await enableFaceId(bookTitle);
            toast('Face ID is on');
          } catch {
            e.target.checked = false;
            toast('Face ID couldn’t be turned on.');
          }
        } else {
          await disableFaceId();
          toast('Face ID is off');
        }
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
      toast(`Restored ${pages} of ${total} pages`);
      renderSettings(root, nav);
    } catch (err) {
      ask({ title: 'Couldn’t import', message: err.message || 'Something went wrong.', ok: 'OK', cancel: 'Close' });
    }
  });

  const exportBtn = h('button', {
    class: 'row',
    onclick: async () => {
      exportBtn.disabled = true;
      toast('Preparing your backup…');
      try {
        const file = await createBackup();
        exportBtn.disabled = false;
        const go = await ask({
          title: 'Your backup is ready',
          message: `${formatBytes(file.size)}. Choose “Save to Files” and put it in iCloud Drive or another safe place.`,
          ok: 'Save backup',
        });
        if (!go) return;
        pauseAutoLock();
        const saved = await shareBackup(file).finally(resumeAutoLock);
        if (saved) {
          toast('Backup saved');
          renderSettings(root, nav);
        }
      } catch (err) {
        exportBtn.disabled = false;
        ask({ title: 'Backup failed', message: err.message || 'Something went wrong.', ok: 'OK', cancel: 'Close' });
      }
    },
  }, h('span', {}, 'Export backup'), h('span', { class: 'chev' }, '›'));

  root.replaceChildren(
    topbar(nav, { title: 'Settings' }),
    h('main', { class: 'content settings' },
      h('h2', { class: 'group-title' }, 'Your book'),
      h('div', { class: 'group' },
        textSetting('Book title', 'bookTitle', bookTitle, 'Little Memories'),
        textSetting('Letters to', 'letterTo', letterTo, 'Name'),
        h('label', { class: 'row' }, h('span', {}, 'Writing font'), fontSelect),
      ),

      h('h2', { class: 'group-title' }, 'Privacy'),
      h('div', { class: 'group' },
        h('button', { class: 'row', onclick: async () => { if (await changePin()) toast('PIN changed'); } }, h('span', {}, 'Change PIN'), h('span', { class: 'chev' }, '›')),
        faceIdRow,
      ),
      h('p', { class: 'note' }, canFaceId
        ? 'The diary locks every time you leave the app. Face ID uses a passkey saved in your iPhone’s Passwords app.'
        : 'The diary locks every time you leave the app. Face ID is available once the diary is opened from your Home Screen on your iPhone.'),

      h('h2', { class: 'group-title' }, 'Backup'),
      h('div', { class: 'group' },
        exportBtn,
        h('button', { class: 'row', onclick: () => pickFiles(importInput) }, h('span', {}, 'Restore from backup'), h('span', { class: 'chev' }, '›')),
        importInput,
        h('div', { class: 'row static' }, h('span', {}, 'Last backup'), h('span', { class: 'muted' }, lastBackup ? fmt.medium(todayISO(new Date(lastBackup))) : 'Never')),
      ),
      h('p', { class: 'note' }, 'Everything is stored only on this iPhone, never on the internet. If you delete the app from your Home Screen or lose your phone, your diary is gone. Make a backup every week or two and keep it in iCloud Drive.'),

      h('h2', { class: 'group-title' }, 'About'),
      h('div', { class: 'group' },
        h('div', { class: 'row static' }, h('span', {}, 'Pages'), h('span', { class: 'muted' }, entries.length)),
        h('div', { class: 'row static' }, h('span', {}, 'Photographs'), h('span', { class: 'muted' }, photoIds.length)),
        storage ? h('div', { class: 'row static' }, h('span', {}, 'Space used'), h('span', { class: 'muted' }, formatBytes(storage.usage))) : null,
        h('div', { class: 'row static' }, h('span', {}, 'Version'), h('span', { class: 'muted' }, APP_VERSION)),
      ),
      h('p', { class: 'colophon' }, 'Made with care, for you.'),
    ),
  );
}

