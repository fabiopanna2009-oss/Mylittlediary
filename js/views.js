// views.js — every screen of the journal except the editor and the lock screen.
//
// Design rules used throughout:
//   - text and hairlines instead of boxes; not everything needs a container
//   - the serif (Newsreader) for titles and quotes, the sans (Hanken Grotesk) for reading and navigation
//   - walnut brown is the one accent colour; gold only for tiny details
//   - photographs are shown as they are, with a thin white border at most

import { db } from './db.js';
import {
  h, fill, icon, fmt, todayISO, friendlyDate, greeting, entryText, entryPhotos, byNewest, toast, ask, formatBytes, uid,
  pickFiles, pauseAutoLock, resumeAutoLock,
} from './util.js';
import { KINDS, moodById, promptOfTheDay } from './content.js';
import { photoImg, photoURL, printFigure } from './photos.js';
import { changePin, faceIdSupported, faceIdEnabled, enableFaceId, disableFaceId } from './lock.js';
import { createBackup, shareBackup, importBackup } from './backup.js';

export const APP_VERSION = '2.0.0';

// Chapters listed on the Contents screen (Journal and Photos have their own tabs).
export const CHAPTERS = [
  { route: 'thoughts',    kind: 'thought', title: 'Today’s thoughts', sub: 'Whatever is on your mind' },
  { route: 'letters',     kind: 'letter',  title: 'Letters',          sub: 'Written, perhaps never sent' },
  { route: 'memories',    kind: 'memory',  title: 'Memories',         sub: 'Moments to keep' },
  { route: 'details',     kind: 'detail',  title: 'Little details',   sub: 'The small things you remember' },
  { route: 'timeline',    kind: null,      title: 'Timeline',         sub: 'The dates that mattered' },
  { route: 'collections', kind: null,      title: 'Collections',      sub: 'Memories that belong together' },
  { route: 'favourites',  kind: null,      title: 'Favourites',       sub: 'The pages that mean the most' },
];
const chapter = (route) => CHAPTERS.find((c) => c.route === route);

// ================= shared pieces =================

function screen(...children) {
  return h('main', { class: 'screen enter' }, ...children);
}

// Top bar for screens you navigated into (with a back button).
function bar(nav, { title = '', actions = [] } = {}) {
  return h('header', { class: 'bar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => nav.back() }, icon('back')),
    h('div', { class: 'bar-title' }, title),
    h('div', { class: 'bar-actions' }, actions),
  );
}

function head({ eyebrow = null, title, lede = null, action = null, display = false, tab = false }) {
  return h('header', { class: `head ${tab ? 'tab-head' : ''}` },
    eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null,
    h('div', { class: 'head-row' },
      h('h1', { class: display ? 'display' : 'title-1' }, title),
      action,
    ),
    lede ? h('p', { class: 'lede' }, lede) : null,
  );
}

function textLink(label, onclick, { quiet = false, arrow = false } = {}) {
  return h('button', { class: `link ${quiet ? 'quiet' : ''}`, onclick }, label, arrow ? icon('arrow') : null);
}

function emptyBlock(text, linkLabel, onClick) {
  return h('div', { class: 'empty' },
    h('p', {}, text),
    linkLabel ? textLink(linkLabel, onClick, { arrow: true }) : null,
  );
}

// Thoughts and little details usually have no title: their own words become the title.
function displayTitle(e) {
  if (e.title?.trim()) return e.title.trim();
  if (e.kind === 'thought' || e.kind === 'detail') {
    const first = entryText(e).split('\n').find((l) => l.trim());
    if (first) return first.length > 90 ? `${first.slice(0, 88).trim()}…` : first;
  }
  return (KINDS[e.kind] || KINDS.entry).emptyTitle;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// One page in a list: the day on the left, title and first lines, a small photo on the right.
function entryRow(e, nav, order) {
  const photo = entryPhotos(e)[0];
  const wordsAsTitle = !e.title?.trim() && (e.kind === 'thought' || e.kind === 'detail');
  const text = wordsAsTitle ? '' : entryText(e).replace(/^Dear[^\n]*\n+/i, '');
  const meta = [e.kind !== 'entry' ? KINDS[e.kind]?.one.replace(/^An? /, '') : null, e.time || null].filter(Boolean).join(' · ');
  return h('li', {},
    h('button', { class: `entry-row kind-${e.kind}`, onclick: () => nav.read(e.id, order) },
      h('span', { class: 'row-date' },
        h('span', { class: 'row-day' }, fmt.day(e.date)),
        h('span', { class: 'row-wd' }, fmt.weekdayShort(e.date)),
      ),
      h('span', { class: 'row-body' },
        meta ? h('span', { class: 'row-meta' }, meta) : null,
        h('span', { class: 'row-title' }, displayTitle(e), e.favorite ? icon('star', 'row-flag') : null),
        text ? h('span', { class: 'row-excerpt' }, text.slice(0, 220)) : null,
      ),
      photo ? h('span', { class: 'row-thumb' }, photoImg(photo.photoId, 'thumb')) : h('span', {}),
    ),
  );
}

// Entries grouped by month, newest first. The reader flips forward in time (oldest → newest).
function monthGroups(entries, nav) {
  const sorted = [...entries].sort(byNewest);
  const order = [...sorted].reverse().map((e) => e.id);
  const groups = [];
  for (const e of sorted) {
    const key = e.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, items: [] }; groups.push(g); }
    g.items.push(e);
  }
  return groups.map((g) => h('section', { class: 'month' },
    h('div', { class: 'month-head' },
      h('h2', { class: 'month-name' }, fmt.monthYear(`${g.key}-01`)),
      h('span', { class: 'month-count' }, plural(g.items.length, 'page', 'pages')),
    ),
    h('ul', { class: 'rows' }, g.items.map((e) => entryRow(e, nav, order))),
  ));
}

// A number that changes every day, so the featured memory changes daily but not on every visit.
function daySeed() {
  return Math.floor(Date.now() / 86400000);
}

// ================= TODAY (home) =================

export async function renderHome(root, nav) {
  const [entries, bookTitle, lastBackup] = await Promise.all([
    db.allEntries(), db.getSetting('bookTitle', 'Little Memories'), db.getSetting('lastBackup'),
  ]);
  const now = new Date();
  const today = todayISO(now);
  const prompt = promptOfTheDay(now);
  const writtenToday = entries.filter((e) => e.date === today).length;
  const sorted = [...entries].sort(byNewest);

  // ----- featured memory -----
  let featured = null;
  const withPhotos = sorted.filter((e) => entryPhotos(e).length);
  const seed = daySeed();
  const pickSeeded = (list) => list[seed % list.length];
  const otd = withPhotos.filter((e) => e.date.slice(5) === today.slice(5) && e.date < today);
  const favPhotos = withPhotos.filter((e) => e.favorite);
  const olderPhotos = withPhotos.filter((e) => (now - new Date(e.createdAt)) > 3 * 86400000);
  if (otd.length) featured = { entry: otd[0], label: `On this day, ${otd[0].date.slice(0, 4)}` };
  else if (favPhotos.length) featured = { entry: pickSeeded(favPhotos), label: 'A favourite' };
  else if (olderPhotos.length) featured = { entry: pickSeeded(olderPhotos), label: 'From your pages' };
  else if (withPhotos.length) featured = { entry: withPhotos[0], label: 'Recently' };
  if (featured) {
    const photos = entryPhotos(featured.entry);
    featured.photo = photos[seed % photos.length];
  } else if (entries.length >= 3) {
    const candidates = sorted.filter((e) => entryText(e).length > 40 && (e.favorite || e.kind === 'memory' || e.milestone || e.kind === 'detail'));
    const pool = candidates.length ? candidates : sorted.slice(2).filter((e) => entryText(e).length > 40);
    if (pool.length) featured = { entry: pickSeeded(pool), label: 'From your pages' };
  }

  const recent = sorted.slice(0, 3);
  const order = [...sorted].reverse().map((e) => e.id);
  const needsBackup = entries.length > 0 && (!lastBackup || Date.now() - lastBackup > 14 * 86400000);

  let featuredEl = null;
  if (featured?.photo) {
    const e = featured.entry;
    const open = () => nav.read(e.id, order);
    featuredEl = h('section', { class: 'featured' },
      h('div', { class: 'eyebrow' }, featured.label),
      h('button', { class: 'featured-photo', 'aria-label': 'Open this memory', onclick: open }, photoImg(featured.photo.photoId, 'full')),
      h('button', { class: 'featured-caption', onclick: open },
        h('span', { class: 'quote' }, featured.photo.caption || displayTitle(e)),
        h('span', { class: 'link' }, fmt.dots(featured.photo.date || e.date)),
      ),
    );
  } else if (featured) {
    const e = featured.entry;
    featuredEl = h('section', { class: 'featured' },
      h('div', { class: 'eyebrow' }, featured.label),
      h('button', { class: 'featured-text', onclick: () => nav.read(e.id, order) },
        `“${entryText(e).replace(/\s+/g, ' ').slice(0, 170).trim()}${entryText(e).length > 170 ? '…' : ''}”`,
        h('span', { class: 'eyebrow' }, `${displayTitle(e)} · ${fmt.medium(e.date)}`),
      ),
    );
  }

  fill(root, screen(
    h('div', { class: 'home-top' },
      h('div', { class: 'eyebrow' }, friendlyDate(today)),
      h('button', { class: 'icon-btn', 'aria-label': 'Lock the journal', onclick: () => nav.lock() }, icon('lock')),
    ),
    h('p', { class: 'home-greeting' }, greeting(now)),
    h('h1', { class: 'display home-title' }, bookTitle || 'Little Memories'),

    h('section', { class: 'invite' },
      h('button', { class: 'invite-main', onclick: () => nav.go(`write?kind=entry&prompt=${encodeURIComponent(prompt)}`) },
        h('span', { class: 'eyebrow' }, writtenToday ? `Today · ${plural(writtenToday, 'page', 'pages')} written` : 'Today’s page'),
        h('span', { class: 'invite-prompt' }, prompt),
        h('span', { class: 'invite-begin' }, writtenToday ? 'Write another page' : 'Begin writing', icon('arrow')),
      ),
      h('div', { class: 'invite-alt' },
        h('span', { class: 'muted' }, 'Or write'),
        textLink('a thought', () => nav.go('write?kind=thought')),
        textLink('a letter', () => nav.go('write?kind=letter')),
        textLink('a memory', () => nav.go('write?kind=memory')),
      ),
    ),

    featuredEl,

    recent.length
      ? h('section', { class: 'section' },
        h('div', { class: 'section-head' },
          h('h2', { class: 'eyebrow' }, 'Recently'),
          textLink('All pages', () => nav.tab('journal'), { arrow: true }),
        ),
        h('ul', { class: 'rows' }, recent.map((e) => entryRow(e, nav, order))),
      )
      : h('p', { class: 'empty-note' }, 'This book is still empty. Nothing you write here has to be perfect. It only has to be yours.'),

    needsBackup ? h('button', { class: 'backup-note', onclick: () => nav.go('settings') },
      h('span', {}, lastBackup ? 'It’s been a while since your last backup.' : 'You haven’t made a backup yet.'),
      h('span', {}, 'Back up now'),
    ) : null,
  ));
}

// ================= JOURNAL (list + calendar) =================

let journalFilter = 'all';

function journalHead(nav, mode) {
  return h('div', {},
    head({
      title: 'Journal',
      tab: true,
      action: h('div', { class: 'bar-actions' },
        h('button', { class: 'icon-btn', 'aria-label': 'Search', onclick: () => nav.go('search') }, icon('search')),
        h('button', { class: 'icon-btn', 'aria-label': 'New page', onclick: () => nav.go('write?kind=entry') }, icon('compose')),
      ),
    }),
    h('div', { class: 'segments', role: 'tablist' },
      h('button', { class: 'segment', role: 'tab', 'aria-selected': String(mode === 'list'), onclick: () => mode !== 'list' && nav.tab('journal') }, 'Pages'),
      h('button', { class: 'segment', role: 'tab', 'aria-selected': String(mode === 'calendar'), onclick: () => mode !== 'calendar' && nav.tab('calendar') }, 'Calendar'),
    ),
  );
}

export async function renderJournal(root, nav) {
  const entries = await db.allEntries();
  const list = h('div', {});
  const kinds = [['all', 'All'], ['entry', 'Entries'], ['thought', 'Thoughts'], ['letter', 'Letters'], ['memory', 'Memories'], ['detail', 'Details']]
    .filter(([k]) => k === 'all' || entries.some((e) => e.kind === k));
  if (!kinds.some(([k]) => k === journalFilter)) journalFilter = 'all';

  const filters = h('div', { class: 'filters' }, kinds.map(([k, label]) => h('button', {
    class: 'filter',
    'aria-pressed': String(k === journalFilter),
    onclick: (ev) => {
      journalFilter = k;
      filters.querySelectorAll('.filter').forEach((f) => f.setAttribute('aria-pressed', 'false'));
      ev.currentTarget.setAttribute('aria-pressed', 'true');
      draw();
    },
  }, label)));

  function draw() {
    const shown = journalFilter === 'all' ? entries : entries.filter((e) => e.kind === journalFilter);
    list.replaceChildren(...(shown.length
      ? monthGroups(shown, nav)
      : [emptyBlock('Your journal is still empty. The first page is waiting for you.', 'Begin writing', () => nav.go('write?kind=entry'))]));
  }
  draw();

  fill(root, screen(
    journalHead(nav, 'list'),
    kinds.length > 2 ? filters : null,
    list,
  ));
}

export async function renderCalendar(root, nav, monthParam, selectedParam) {
  const entries = await db.allEntries();
  const byDate = new Map();
  entries.forEach((e) => { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); });

  const today = todayISO();
  let selected = selectedParam || today;
  let month = monthParam || selected.slice(0, 7);

  const title = h('h2', { class: 'cal-month' });
  const grid = h('div', { class: 'cal-grid', role: 'grid' });
  const dayList = h('div', { class: 'cal-list' });

  function draw() {
    const [y, m] = month.split('-').map(Number);
    title.textContent = fmt.monthYear(`${month}-01`);
    const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // weeks start on Monday
    const days = new Date(y, m, 0).getDate();
    const cells = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => h('div', { class: 'cal-wd', role: 'columnheader' }, d));
    for (let d = 1; d <= days; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`;
      const count = (byDate.get(iso) || []).length;
      cells.push(h('button', {
        class: ['cal-day', count && 'has', iso === today && 'today', iso === selected && 'selected'].filter(Boolean).join(' '),
        'aria-label': `${fmt.long(iso)}${count ? `, ${plural(count, 'page', 'pages')}` : ''}`,
        style: d === 1 ? { gridColumnStart: String(offset + 1) } : null,
        onclick: () => { selected = iso; nav.replace(`calendar?m=${month}&d=${selected}`); draw(); },
      }, h('span', { class: 'cal-num' }, d)));
    }
    grid.replaceChildren(...cells);

    const dayEntries = (byDate.get(selected) || []).sort(byNewest);
    const order = [...dayEntries].reverse().map((e) => e.id);
    fill(dayList, 
      h('div', { class: 'cal-list-head' },
        h('h3', { class: 'eyebrow' }, fmt.long(selected)),
        textLink(dayEntries.length ? 'Add a page' : 'Write on this day', () => nav.go(`write?kind=entry&date=${selected}`)),
      ),
      dayEntries.length
        ? h('ul', { class: 'rows' }, dayEntries.map((e) => entryRow(e, nav, order)))
        : h('p', { class: 'empty-note' }, 'Nothing written on this day.'),
    );
  }

  const shift = (d) => {
    const [y, m] = month.split('-').map(Number);
    const n = new Date(y, m - 1 + d, 1);
    month = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
    nav.replace(`calendar?m=${month}&d=${selected}`);
    draw();
  };

  // Swipe left/right on the month to change it.
  let sx = 0;
  grid.addEventListener('touchstart', (ev) => { sx = ev.touches[0].clientX; }, { passive: true });
  grid.addEventListener('touchend', (ev) => {
    const dx = ev.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 60) shift(dx < 0 ? 1 : -1);
  });

  draw();
  fill(root, screen(
    journalHead(nav, 'calendar'),
    h('div', { class: 'cal-head' },
      title,
      h('div', { class: 'cal-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('left')),
        h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('right')),
      ),
    ),
    grid,
    dayList,
  ));
}

// ================= PHOTOGRAPHS =================

export async function renderGallery(root, nav) {
  const entries = (await db.allEntries()).sort(byNewest);
  const items = entries.flatMap((e) => entryPhotos(e).map((p) => ({ ...p, entry: e })));
  const pages = new Set(items.map((i) => i.entry.id)).size;

  const groups = [];
  for (const it of items) {
    const key = (it.date || it.entry.date).slice(0, 7);
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, items: [] }; groups.push(g); }
    g.items.push(it);
  }
  groups.sort((a, b) => b.key.localeCompare(a.key));
  const flat = groups.flatMap((g) => g.items);

  fill(root, screen(
    head({
      title: 'Photographs',
      tab: true,
      lede: items.length ? `${plural(items.length, 'photograph', 'photographs')}, from ${plural(pages, 'page', 'pages')}` : null,
    }),
    items.length
      ? groups.map((g) => h('section', { class: 'month' },
        h('div', { class: 'month-head' },
          h('h2', { class: 'month-name' }, fmt.monthYear(`${g.key}-01`)),
          h('span', { class: 'month-count' }, g.items.length),
        ),
        h('div', { class: 'gallery-grid' }, g.items.map((it, i) => h('button', {
          class: `gallery-item ${i === 0 && g.items.length >= 3 ? 'lead' : ''}`,
          'aria-label': it.caption || `Photo from ${fmt.medium(it.entry.date)}`,
          onclick: () => openLightbox(flat, flat.indexOf(it), nav),
        }, photoImg(it.photoId, i === 0 && g.items.length >= 3 ? 'full' : 'thumb')))),
      ))
      : emptyBlock('No photographs yet. Add pictures to any page and they will gather here.', 'Write a page', () => nav.go('write?kind=entry')),
  ));
}

// ================= CONTENTS =================

export async function renderContents(root, nav) {
  const [entries, collections] = await Promise.all([db.allEntries(), db.allCollections()]);
  const count = {
    thoughts: entries.filter((e) => e.kind === 'thought').length,
    letters: entries.filter((e) => e.kind === 'letter').length,
    memories: entries.filter((e) => e.kind === 'memory').length,
    details: entries.filter((e) => e.kind === 'detail').length,
    timeline: entries.filter((e) => e.milestone).length,
    collections: collections.length,
    favourites: entries.filter((e) => e.favorite).length,
  };

  fill(root, screen(
    head({ title: 'Contents', tab: true }),
    h('ol', { class: 'toc' }, CHAPTERS.map((c, i) => h('li', {},
      h('button', { class: 'toc-item', onclick: () => nav.go(c.route) },
        h('span', { class: 'toc-num' }, String(i + 1).padStart(2, '0')),
        h('span', {}, h('span', { class: 'toc-name' }, c.title), h('span', { class: 'toc-sub' }, c.sub)),
        h('span', { class: 'toc-count' }, count[c.route] || ''),
      )))),
    h('ul', { class: 'plain-list' },
      h('li', {}, h('button', { class: 'plain-item', onclick: () => nav.go('search') }, 'Search', icon('search'))),
      h('li', {}, h('button', { class: 'plain-item', onclick: () => nav.go('settings') }, 'Settings & backup', icon('chevron'))),
      h('li', {}, h('button', { class: 'plain-item', onclick: () => nav.lock() }, 'Lock now', icon('lock'))),
    ),
  ));
}

// ================= CHAPTER LISTS =================

export async function renderList(root, nav, route) {
  const c = chapter(route);
  let entries = await db.allEntries();
  entries = route === 'favourites' ? entries.filter((e) => e.favorite) : entries.filter((e) => e.kind === c.kind);
  const kind = c.kind || 'entry';

  const emptyText = {
    thoughts: 'No thoughts yet. Write whatever is on your mind. No title needed.',
    letters: 'No letters yet. Write one you may never send.',
    memories: 'No memories yet. Keep a moment you never want to forget.',
    favourites: 'No favourites yet. Tap the star on a page that means a lot to you.',
  }[route];

  // The first time you open Letters, ask who they are for. The name is saved only on this phone.
  if (route === 'letters' && (await db.getSetting('letterTo')) === null) {
    setTimeout(async () => {
      const name = await ask({
        title: 'Who are your letters for?',
        message: 'New letters will begin with “Dear …”. The name stays only on this phone, and you can change it in Settings.',
        input: '', placeholder: 'A name', ok: 'Save', cancel: 'Skip',
      });
      await db.setSetting('letterTo', name || '');
    }, 350);
  }

  fill(root, 
    bar(nav),
    screen(
      head({
        title: c.title,
        lede: c.sub,
        action: route === 'favourites' ? null : textLink('New', () => nav.go(`write?kind=${kind}`)),
      }),
      entries.length ? monthGroups(entries, nav) : emptyBlock(emptyText, route === 'favourites' ? null : 'Begin writing', () => nav.go(`write?kind=${kind}`)),
    ),
  );
}

// ================= LITTLE DETAILS =================

export async function renderDetails(root, nav) {
  const c = chapter('details');
  const entries = (await db.allEntries()).filter((e) => e.kind === 'detail').sort(byNewest);
  const order = [...entries].reverse().map((e) => e.id);

  const quick = h('textarea', {
    rows: 2,
    placeholder: 'The way she laughs… her voice when… write it down before it fades.',
    oninput: (e) => { e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; },
  });
  const keep = async () => {
    const text = quick.value.trim();
    if (!text) { quick.focus(); return; }
    const now = Date.now();
    await db.saveEntry({
      id: uid(), kind: 'detail', title: '', date: todayISO(), time: '', mood: null,
      blocks: [{ type: 'text', text }], collections: [], favorite: false, milestone: false,
      createdAt: now, updatedAt: now,
    });
    toast('Kept');
    renderDetails(root, nav);
  };

  fill(root, 
    bar(nav),
    screen(
      head({ title: c.title, lede: 'Her laugh, her voice, the way she smiled. All the tiny things you remember.' }),
      h('div', { class: 'quick' },
        quick,
        h('div', { class: 'quick-row' },
          textLink('Add with a photo', () => nav.go('write?kind=detail'), { quiet: true }),
          textLink('Keep', keep, { arrow: true }),
        ),
      ),
      entries.length
        ? h('div', { class: 'fragments' }, entries.map((e) => {
          const photo = entryPhotos(e)[0];
          return h('button', { class: 'fragment', onclick: () => nav.read(e.id, order) },
            photo ? h('div', { class: 'fragment-photo' }, photoImg(photo.photoId, 'thumb')) : null,
            h('span', { class: 'fragment-text' }, e.title?.trim() || entryText(e).slice(0, 240) || '…'),
            h('span', { class: 'caption-date' }, fmt.medium(e.date)),
          );
        }))
        : h('p', { class: 'empty-note' }, 'Nothing here yet. Even the smallest detail is worth keeping.'),
    ),
  );
}

// ================= TIMELINE =================

export async function renderTimeline(root, nav) {
  const c = chapter('timeline');
  const items = (await db.allEntries()).filter((e) => e.milestone).sort(byNewest).reverse();
  const order = items.map((e) => e.id);

  const list = [];
  let year = null;
  for (const e of items) {
    const y = e.date.slice(0, 4);
    if (y !== year) { year = y; list.push(h('li', { class: 'tl-year', 'aria-hidden': 'true' }, y)); }
    const photo = entryPhotos(e)[0];
    const text = entryText(e);
    list.push(h('li', { class: 'tl-item' },
      h('button', { class: 'tl-card', onclick: () => nav.read(e.id, order) },
        h('span', { class: 'eyebrow' }, fmt.medium(e.date)),
        h('span', { class: 'tl-title' }, displayTitle(e)),
        text ? h('span', { class: 'tl-text' }, text.slice(0, 150)) : null,
        photo ? h('span', { class: 'tl-photo' }, photoImg(photo.photoId, 'full')) : null,
      )));
  }

  fill(root, 
    bar(nav),
    screen(
      head({ title: c.title, lede: c.sub, action: textLink('Add a date', () => nav.go('write?kind=memory&milestone=1')) }),
      items.length
        ? h('ol', { class: 'timeline' }, list)
        : emptyBlock('No important dates yet. Turn on “Important date” on any page, or add one here.', 'Add a date', () => nav.go('write?kind=memory&milestone=1')),
    ),
  );
}

// ================= COLLECTIONS =================

export async function renderCollections(root, nav) {
  const c = chapter('collections');
  const [collections, entries] = await Promise.all([db.allCollections(), db.allEntries()]);

  const shelf = collections.map((col) => {
    const inside = entries.filter((e) => (e.collections || []).includes(col.id)).sort(byNewest);
    return { col, inside, photo: inside.flatMap(entryPhotos)[0], latest: inside[0]?.date || '' };
  }).sort((a, b) => b.latest.localeCompare(a.latest) || a.col.createdAt - b.col.createdAt);

  const create = async () => {
    const name = await ask({ title: 'New collection', input: '', placeholder: 'e.g. Summer 2026', ok: 'Create' });
    if (!name) return;
    await db.saveCollection({ id: uid(), name, createdAt: Date.now() });
    renderCollections(root, nav);
  };

  fill(root, 
    bar(nav),
    screen(
      head({ title: c.title, lede: c.sub, action: textLink('New', create) }),
      shelf.some((x) => x.inside.length)
        ? h('div', { class: 'shelf' }, shelf.filter((x) => x.inside.length).map(({ col, inside, photo }, i) => h('button', {
          class: `shelf-item ${i === 0 && inside.length ? 'lead' : ''}`,
          onclick: () => nav.go(`collection/${col.id}`),
        },
        h('span', { class: `shelf-cover ${photo ? '' : 'no-photo'}` },
          photo ? photoImg(photo.photoId, i === 0 ? 'full' : 'thumb') : h('span', { class: 'shelf-initial', 'aria-hidden': 'true' }, col.name.trim().charAt(0).toUpperCase())),
        h('span', { class: 'shelf-name' }, col.name),
        h('span', { class: 'eyebrow shelf-count' }, plural(inside.length, 'page', 'pages')),
        )))
        : h('p', { class: 'empty-note' }, 'Add a page to a collection from the bottom of any page while writing.'),
      // Collections without pages yet: a quiet list instead of empty boxes.
      shelf.some((x) => !x.inside.length) ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'eyebrow' }, 'Not started yet')),
        h('ul', { class: 'plain-list flush' }, shelf.filter((x) => !x.inside.length).map(({ col }) => h('li', {},
          h('button', { class: 'plain-item', onclick: () => nav.go(`collection/${col.id}`) },
            h('span', { class: 'plain-serif' }, col.name), icon('chevron'))))),
      ) : null,
    ),
  );
}

export async function renderCollection(root, nav, id) {
  const col = (await db.allCollections()).find((c) => c.id === id);
  if (!col) { nav.back(); return; }
  const entries = (await db.allEntries()).filter((e) => (e.collections || []).includes(id));

  const rename = async () => {
    const name = await ask({ title: 'Rename collection', input: col.name, ok: 'Save' });
    if (!name) return;
    col.name = name;
    await db.saveCollection(col);
    renderCollection(root, nav, id);
  };
  const remove = async () => {
    const ok = await ask({ title: `Delete “${col.name}”?`, message: 'The pages stay in your journal. Only the collection is removed.', ok: 'Delete', danger: true });
    if (!ok) return;
    const all = await db.allEntries();
    await db.saveEntries(all.filter((e) => (e.collections || []).includes(id)).map((e) => ({ ...e, collections: e.collections.filter((x) => x !== id) })));
    await db.deleteCollection(id);
    toast('Collection deleted');
    nav.back();
  };

  fill(root, 
    bar(nav, { actions: [h('button', { class: 'icon-btn', 'aria-label': 'Rename collection', onclick: rename }, icon('edit'))] }),
    screen(
      head({
        eyebrow: 'Collection',
        title: col.name,
        lede: entries.length ? plural(entries.length, 'page', 'pages') : null,
        action: textLink('New', () => nav.go(`write?kind=memory&collection=${id}`)),
      }),
      entries.length ? monthGroups(entries, nav) : emptyBlock('This collection is still empty.', 'Write a page for it', () => nav.go(`write?kind=memory&collection=${id}`)),
      h('button', { class: 'danger-btn', onclick: remove }, 'Delete collection'),
    ),
  );
}

// ================= READER =================

export async function renderReader(root, nav, id, readingList) {
  const all = await db.allEntries();
  const byId = new Map(all.map((e) => [e.id, e]));
  const order = (readingList && readingList.includes(id))
    ? readingList.filter((x) => byId.has(x))
    : [...all].sort(byNewest).reverse().map((e) => e.id);
  let index = order.indexOf(id);
  if (index < 0) { nav.back(); return; }
  const collections = new Map((await db.allCollections()).map((c) => [c.id, c]));

  const page = h('article', { class: 'reader-page' });
  const favBtn = h('button', { class: 'icon-btn', 'aria-label': 'Favourite' }, icon('star'));
  const count = h('span', { class: 'pager-count' });
  const prevBtn = h('button', { class: 'pager-btn', onclick: () => turn(-1) }, icon('left'), 'Earlier');
  const nextBtn = h('button', { class: 'pager-btn', onclick: () => turn(1) }, 'Later', icon('right'));

  favBtn.addEventListener('click', async () => {
    const e = byId.get(order[index]);
    e.favorite = !e.favorite;
    e.updatedAt = Date.now();
    await db.saveEntry(e);
    favBtn.classList.toggle('on', e.favorite);
    favBtn.setAttribute('aria-pressed', String(e.favorite));
    toast(e.favorite ? 'Added to favourites' : 'Removed from favourites');
  });

  function drawPage() {
    const e = byId.get(order[index]);
    nav.replace(`read/${e.id}`);
    favBtn.classList.toggle('on', !!e.favorite);
    favBtn.setAttribute('aria-pressed', String(!!e.favorite));
    count.textContent = `${index + 1} of ${order.length}`;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === order.length - 1;

    const mood = moodById(e.mood);
    const photos = entryPhotos(e);
    let photoCount = 0;
    const cols = (e.collections || []).map((cid) => collections.get(cid)).filter(Boolean);

    page.className = `reader-page kind-${e.kind}`;
    fill(page,
      h('div', { class: 'reader-meta' },
        h('span', { class: 'eyebrow' }, fmt.long(e.date)),
        e.time ? h('span', { class: 'eyebrow muted' }, e.time) : null,
      ),
      e.kind !== 'entry' ? h('div', { class: 'reader-kind' }, KINDS[e.kind]?.one) : null,
      h('h1', { class: 'title-1 reader-title' }, displayTitle(e)),
      mood ? h('p', { class: 'reader-mood' }, `Feeling ${mood.label.toLowerCase()}`) : null,
      h('hr', { class: 'short-rule' }),
      (e.blocks || []).map((b) => {
        if (b.type === 'photo') {
          const i = photos.indexOf(b);
          const caption = (b.caption || (b.date && b.date !== e.date)) ? h('figcaption', {},
            b.caption ? h('span', { class: 'caption' }, b.caption) : null,
            b.date && b.date !== e.date ? h('span', { class: 'caption-date' }, fmt.medium(b.date)) : null,
          ) : null;
          const { figure, frame } = printFigure(b.photoId, { alt: photoCount++ % 2 === 1, caption });
          frame.setAttribute('role', 'button');
          frame.setAttribute('aria-label', 'View photo');
          frame.addEventListener('click', () => openLightbox(photos.map((p) => ({ ...p, entry: e })), i, nav));
          return figure;
        }
        return b.text ? h('p', { class: 'reader-text' }, b.text) : null;
      }),
      (cols.length || e.milestone) ? h('footer', { class: 'reader-foot' },
        cols.length ? h('p', {}, 'Kept in ', cols.flatMap((c, i) => [
          i ? (i === cols.length - 1 ? ' and ' : ', ') : null,
          h('button', { onclick: () => nav.go(`collection/${c.id}`) }, c.name),
        ]), '.') : null,
        e.milestone ? h('p', {}, 'Marked as an important date.') : null,
      ) : null,
    );
  }

  let turning = false;
  function turn(dir) {
    const next = index + dir;
    if (turning || next < 0 || next >= order.length) return;
    turning = true;
    page.classList.add(dir > 0 ? 'leaving-next' : 'leaving-prev');
    setTimeout(() => {
      index = next;
      drawPage();
      window.scrollTo(0, 0);
      page.classList.add(dir > 0 ? 'arriving-next' : 'arriving-prev');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        page.classList.remove('arriving-next', 'arriving-prev');
        turning = false;
      }));
    }, 180);
  }

  // Swipe left/right to turn the page.
  let sx = 0; let sy = 0;
  page.addEventListener('touchstart', (ev) => { sx = ev.touches[0].clientX; sy = ev.touches[0].clientY; }, { passive: true });
  page.addEventListener('touchend', (ev) => {
    const dx = ev.changedTouches[0].clientX - sx;
    const dy = ev.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) turn(dx < 0 ? 1 : -1);
  });

  fill(root, 
    bar(nav, {
      actions: [
        favBtn,
        h('button', { class: 'icon-btn', 'aria-label': 'Edit page', onclick: () => nav.go(`edit/${order[index]}`) }, icon('edit')),
      ],
    }),
    h('main', { class: 'screen reader enter' }, page),
    order.length > 1 ? h('nav', { class: 'pager', 'aria-label': 'Turn pages' }, prevBtn, count, nextBtn) : null,
  );
  drawPage();
}

// ================= LIGHTBOX =================

export function openLightbox(items, startIndex, nav) {
  let index = startIndex;
  const img = h('img', { class: 'lightbox-img', alt: '' });
  const foot = h('div', { class: 'lightbox-foot' });
  const count = h('span', { class: 'lightbox-count' });

  async function draw() {
    const item = items[index];
    img.src = (await photoURL(item.photoId, 'full')) || '';
    img.alt = item.caption || '';
    count.textContent = items.length > 1 ? `${index + 1} of ${items.length}` : '';
    fill(foot,
      item.caption ? h('p', { class: 'lightbox-caption' }, item.caption) : null,
      h('div', { class: 'lightbox-meta' },
        h('span', { class: 'caption-date' }, fmt.medium(item.date || item.entry.date)),
        h('button', { onclick: () => { close(); nav.read(item.entry.id); } }, `${displayTitle(item.entry)} →`),
      ),
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

  const input = h('input', { class: 'search-field', type: 'search', placeholder: 'Search your pages', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Search' });
  const results = h('div', {});

  const run = () => {
    const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    nav.replace(words.length ? `search?q=${encodeURIComponent(input.value)}` : 'search');
    if (!words.length) {
      fill(results, h('p', { class: 'search-hint' }, 'Words, titles, captions, moods, collections, or a date like 28.09'));
      return;
    }
    const found = entries.filter((e) => words.every((w) => haystack.get(e.id).includes(w)));
    fill(results, 
      h('p', { class: 'search-hint' }, found.length ? plural(found.length, 'page', 'pages') : 'Nothing found.'),
      ...monthGroups(found, nav),
    );
  };
  input.addEventListener('input', run);
  input.value = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
  run();

  fill(root, bar(nav, { title: 'Search' }), screen(input, results));
  if (!input.value) setTimeout(() => input.focus(), 60);
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

  const textSetting = (label, key, value, placeholder) => h('label', { class: 'set-row' },
    h('span', {}, label),
    h('input', {
      class: 'set-input', type: 'text', value: value || '', placeholder, maxlength: 40,
      onchange: async (e) => { await db.setSetting(key, e.target.value.trim()); toast('Saved'); },
    }),
  );

  const fontSelect = h('select', {
    class: 'set-select',
    onchange: async (e) => {
      await db.setSetting('writingFont', e.target.value);
      document.documentElement.dataset.font = e.target.value;
    },
  },
  h('option', { value: 'clean', selected: writingFont === 'clean' }, 'Sans-serif'),
  h('option', { value: 'book', selected: writingFont === 'book' }, 'Serif'));

  const faceIdRow = h('label', { class: 'set-row' },
    h('span', {}, 'Unlock with Face ID'),
    h('input', {
      type: 'checkbox', class: 'switch', checked: hasFaceId, disabled: !canFaceId,
      onchange: async (e) => {
        if (e.target.checked) {
          try { await enableFaceId(bookTitle); toast('Face ID is on'); } catch { e.target.checked = false; toast('Face ID couldn’t be turned on'); }
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

  const group = (title, ...rows) => h('section', { class: 'set-group' },
    h('h2', { class: 'eyebrow' }, title),
    h('div', { class: 'set-list' }, rows),
  );
  const info = (label, value) => h('div', { class: 'set-row static' }, h('span', {}, label), h('span', { class: 'set-value' }, value));

  fill(root, 
    bar(nav),
    screen(
      head({ title: 'Settings' }),
      group('Your journal',
        textSetting('Title', 'bookTitle', bookTitle, 'Little Memories'),
        textSetting('Letters to', 'letterTo', letterTo, 'A name'),
        h('label', { class: 'set-row' }, h('span', {}, 'Writing font'), fontSelect),
      ),
      group('Privacy',
        h('button', { class: 'set-row', onclick: async () => { if (await changePin()) toast('PIN changed'); } }, h('span', {}, 'Change PIN'), icon('chevron')),
        faceIdRow,
        h('button', { class: 'set-row', onclick: () => nav.lock() }, h('span', {}, 'Lock now'), icon('lock')),
      ),
      h('p', { class: 'set-note' }, canFaceId
        ? 'The journal locks every time you leave the app. Face ID uses a passkey saved in your iPhone’s Passwords app.'
        : 'The journal locks every time you leave the app. Face ID becomes available when the journal is opened from your Home Screen.'),
      group('Backup',
        exportBtn,
        h('button', { class: 'set-row', onclick: () => pickFiles(importInput) }, h('span', {}, 'Restore from a backup'), icon('chevron')),
        info('Last backup', lastBackup ? fmt.medium(todayISO(new Date(lastBackup))) : 'Never'),
      ),
      importInput,
      h('p', { class: 'set-note' }, 'Everything is stored only on this iPhone, never on the internet. If you remove the app from your Home Screen or lose your phone, the journal is gone with it. Export a backup every week or two and keep it in iCloud Drive.'),
      group('About',
        info('Pages', entries.length),
        info('Photographs', photoIds.length),
        storage ? info('Space used', formatBytes(storage.usage)) : null,
        info('Version', APP_VERSION),
      ),
      h('p', { class: 'colophon' }, 'This book belongs to you.'),
    ),
  );
}
