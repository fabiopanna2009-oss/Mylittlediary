// app.js — starts the app and decides which screen to show.
//
// The address after # decides the screen, for example:
//   #/            contents page
//   #/letters     the letters chapter
//   #/read/ID     reading a page
//   #/edit/ID     editing a page
//   #/write?kind=letter   a new letter

import { db } from './db.js';
import { uid, autoLockPaused } from './util.js';
import { STARTER_COLLECTIONS } from './content.js';
import { initLock, lockNow, isLocked } from './lock.js';
import { renderEditor, closeEditor, saveCurrent } from './editor.js';
import {
  renderHome, renderList, renderDetails, renderReader, renderCalendar, renderTimeline,
  renderCollections, renderCollection, renderGallery, renderSearch, renderSettings,
} from './views.js';
import { cleanUpUnusedPhotos } from './photos.js';

const root = document.getElementById('app');
let readingList = null;      // the order of pages for flipping in the reader
let depth = 0;               // how many screens deep we are (for the back button)
let replacing = false;
let editorOpen = false;
let rendering = Promise.resolve();
let lastDrawn = null;        // the address of the screen that is currently shown

// ---------- navigation ----------
const nav = {
  go(path) {
    depth++;
    location.hash = `#/${path}`;
  },
  replace(path) {
    const target = `#/${path}`;
    if (location.hash === target) return;
    replacing = true;
    history.replaceState(null, '', target);
    replacing = false;
  },
  back() {
    if (depth > 0) { depth--; history.back(); } else { location.hash = '#/'; }
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

async function route() {
  if (replacing || isLocked()) return;
  // Wait for the previous screen to finish drawing before drawing the next one.
  rendering = rendering.then(drawRoute).catch((err) => console.error(err));
}

async function drawRoute() {
  const { parts, params } = parseHash();
  const [name, id] = parts;

  // Leaving the editor? Save first.
  if (editorOpen && name !== 'edit' && name !== 'write') {
    editorOpen = false;
    await closeEditor();
  }

  lastDrawn = location.hash;
  document.body.dataset.screen = name || 'home';
  window.scrollTo(0, 0);

  switch (name) {
    case undefined: return renderHome(root, nav);
    case 'journal': case 'thoughts': case 'letters': case 'memories': case 'favourites':
      return renderList(root, nav, name);
    case 'details': return renderDetails(root, nav);
    case 'timeline': return renderTimeline(root, nav);
    case 'collections': return renderCollections(root, nav);
    case 'collection': return renderCollection(root, nav, id);
    case 'gallery': return renderGallery(root, nav);
    case 'calendar': return renderCalendar(root, nav, params.get('m'), params.get('d'));
    case 'search': return renderSearch(root, nav);
    case 'settings': return renderSettings(root, nav);
    case 'read': return renderReader(root, nav, id, readingList);
    case 'edit':
    case 'write': {
      if (editorOpen) await closeEditor();
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
            // Skip the reader of the page that no longer exists.
            depth -= 2;
            history.go(-2);
          } else {
            nav.back();
          }
        },
      });
    }
    default:
      location.hash = '#/';
  }
}

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

  // Ask the browser to never delete our data to free up space.
  try { await navigator.storage?.persist?.(); } catch { /* ignore */ }

  window.addEventListener('hashchange', route);

  await initLock(() => {
    // Unlocked: show the current screen (or keep editing where you were).
    if (editorOpen && root.querySelector('.editor')) return;
    // Same screen as before locking: keep it exactly as it was (scroll position too).
    if (root.childElementCount && lastDrawn === location.hash) return;
    if (location.hash.startsWith('#/edit') || location.hash.startsWith('#/write')) {
      // The app was closed while writing: start again from the contents page.
      depth = 0;
      location.hash = '#/';
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
