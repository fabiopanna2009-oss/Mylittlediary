// app.js — starts the app and decides which screen to show.
//
// The address after # decides the screen:
//   #/              Today (home)              ┐
//   #/journal       all pages                 │ the four tabs at the bottom
//   #/calendar      the calendar              │ (calendar is part of Journal)
//   #/gallery       photographs               │
//   #/contents      the table of contents     ┘
//   #/letters, #/memories, …    a chapter
//   #/read/ID       reading a page
//   #/edit/ID       editing a page
//   #/write?kind=letter         a new letter

import { db } from './db.js';
import { uid, autoLockPaused } from './util.js';
import { STARTER_COLLECTIONS } from './content.js';
import { initLock, lockNow, isLocked } from './lock.js';
import { renderEditor, closeEditor, saveCurrent } from './editor.js';
import {
  renderHome, renderJournal, renderCalendar, renderGallery, renderContents, renderList, renderDetails,
  renderReader, renderTimeline, renderCollections, renderCollection, renderSearch, renderSettings,
} from './views.js';
import { cleanUpUnusedPhotos } from './photos.js';

const root = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const TAB_SCREENS = { home: '', journal: 'journal', calendar: 'journal', gallery: 'gallery', contents: 'contents' };

let readingList = null;      // the order of pages for turning pages in the reader
let depth = 0;               // how many screens deep we are (for the back button)
let editorOpen = false;
let rendering = Promise.resolve();
let lastDrawn = null;        // the address of the screen currently shown
const scrollMemory = new Map(); // remembers where you were in a list when you come back to it

// ---------- navigation ----------
const nav = {
  // open a screen on top of the current one
  go(path) {
    const target = `#/${path}`;
    if (location.hash === target) return;
    depth++;
    location.hash = target;
  },
  // change the address without adding a step to "back" (e.g. turning pages)
  replace(path) {
    const target = `#/${path}`;
    if (location.hash !== target) history.replaceState(null, '', target);
  },
  back() {
    if (depth > 0) { depth--; history.back(); } else { nav.tab(''); }
  },
  // switch to one of the main tabs
  tab(path) {
    depth = 0;
    history.replaceState(null, '', `#/${path}`);
    route();
  },
  read(id, list) {
    readingList = list || null;
    nav.go(`read/${id}`);
  },
  lock() { lockNow(); },
};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(query) };
}

function route() {
  if (isLocked()) return;
  // Wait for the previous screen to finish drawing before drawing the next one.
  rendering = rendering.then(drawRoute).catch((err) => console.error(err));
}

async function drawRoute() {
  const { parts, params } = parseHash();
  const [name = 'home', id] = parts;

  // Leaving the editor? Save first.
  if (editorOpen && name !== 'edit' && name !== 'write') {
    editorOpen = false;
    await closeEditor();
  }

  if (lastDrawn) scrollMemory.set(lastDrawn.split('?')[0], window.scrollY);
  lastDrawn = location.hash || '#/';

  const isTab = name in TAB_SCREENS;
  document.body.dataset.screen = name;
  document.body.dataset.tabbar = isTab ? 'on' : 'off';
  tabbar.querySelectorAll('.tab').forEach((t) => {
    if (isTab && t.dataset.tab === TAB_SCREENS[name]) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });

  await draw(name, id, params);

  // Coming back to a list: return to where you were. New screens start at the top.
  const remembered = scrollMemory.get(lastDrawn.split('?')[0]);
  window.scrollTo(0, ['read', 'edit', 'write'].includes(name) ? 0 : (remembered || 0));
}

function draw(name, id, params) {
  switch (name) {
    case 'home': return renderHome(root, nav);
    case 'journal': return renderJournal(root, nav);
    case 'calendar': return renderCalendar(root, nav, params.get('m'), params.get('d'));
    case 'gallery': return renderGallery(root, nav);
    case 'contents': return renderContents(root, nav);
    case 'thoughts': case 'letters': case 'memories': case 'favourites':
      return renderList(root, nav, name);
    case 'details': return renderDetails(root, nav);
    case 'timeline': return renderTimeline(root, nav);
    case 'collections': return renderCollections(root, nav);
    case 'collection': return renderCollection(root, nav, id);
    case 'search': return renderSearch(root, nav);
    case 'settings': return renderSettings(root, nav);
    case 'read': return renderReader(root, nav, id, readingList);
    case 'edit':
    case 'write':
      editorOpen = true;
      return renderEditor(root, {
        id: name === 'edit' ? id : null,
        kind: params.get('kind'),
        date: params.get('date'),
        collection: params.get('collection'),
        milestone: params.get('milestone') === '1',
        prompt: params.get('prompt'),
        onDone: async (result) => {
          editorOpen = false;
          await closeEditor();
          if (result?.deleted && name === 'edit' && depth > 1) {
            // The page is gone, so skip its reading view as well.
            depth -= 2;
            history.go(-2);
          } else {
            nav.back();
          }
        },
      });
    default:
      nav.tab('');
      return null;
  }
}

// ---------- tabs ----------
tabbar.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  const current = TAB_SCREENS[document.body.dataset.screen];
  if (current === tab.dataset.tab && document.body.dataset.screen !== 'calendar') {
    window.scrollTo({ top: 0, behavior: 'smooth' }); // tapping the current tab scrolls to the top
    return;
  }
  scrollMemory.delete(`#/${tab.dataset.tab}`);
  nav.tab(tab.dataset.tab);
});

// ---------- first start ----------
async function firstRunSetup() {
  if (await db.getSetting('initialized')) return;
  const now = Date.now();
  await db.saveCollections(STARTER_COLLECTIONS.map((name, i) => ({ id: uid(), name, createdAt: now + i })));
  await db.setSetting('initialized', true);
}

// ---------- locking when leaving the app ----------
function onHidden() {
  if (autoLockPaused()) return; // the photo picker or share sheet is open, don't lock
  if (editorOpen) saveCurrent();
  lockNow();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') onHidden();
});
window.addEventListener('pagehide', onHidden);

// ---------- start ----------
async function start() {
  document.documentElement.dataset.font = await db.getSetting('writingFont', 'clean');
  await firstRunSetup();

  // Ask the browser never to delete our data to free up space.
  try { await navigator.storage?.persist?.(); } catch { /* ignore */ }

  window.addEventListener('hashchange', route);

  await initLock(() => {
    // Still writing when the journal locked: carry on where you were.
    if (editorOpen && root.querySelector('.editor')) return;
    // Same screen as before locking: keep it exactly as it was (scroll position too).
    if (root.childElementCount && lastDrawn === (location.hash || '#/')) return;
    if (location.hash.startsWith('#/edit') || location.hash.startsWith('#/write')) {
      // The app was closed while writing: start again from Today.
      nav.tab('');
    } else {
      route();
    }
  });

  cleanUpUnusedPhotos();

  // The service worker makes the app work offline.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
