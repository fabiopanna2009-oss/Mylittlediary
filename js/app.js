// app.js — starts the app and decides which screen to show.
//
// The address after # decides the screen:
//   #/              Home                       ┐
//   #/notes         all notes                  │ the tabs at the bottom
//   #/memories      collections                │ (photos is part of Memories)
//   #/photos        all photographs            │
//   #/search        search                     ┘
//   #/collection/ID one collection
//   #/note/ID       a note (opens straight in the editor)
//   #/new           a new note   (#/new?c=ID puts it in a collection)
//   #/settings

import { db } from './db.js';
import { uid, autoLockPaused } from './util.js';
import { STARTER_COLLECTIONS } from './content.js';
import { upgradeAll } from './notes.js';
import { initLock, lockNow, isLocked } from './lock.js';
import { renderEditor, closeEditor, saveCurrent } from './editor.js';
import {
  renderHome, renderNotes, renderMemories, renderPhotos, renderCollection, renderSearch, renderSettings, openNotePhoto,
  renderSidebar, renderListPane, renderNotesPlaceholder, playOpening,
} from './views.js';
import { cleanUpUnusedPhotos } from './photos.js';

const root = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const sidebar = document.getElementById('sidebar');
const listPane = document.getElementById('listpane');
// A wide screen (computer, iPad in landscape) gets three panes: sidebar | note list | note.
const wide = window.matchMedia('(min-width: 900px)');
const TAB_OF = { home: '', notes: 'notes', memories: 'memories', photos: 'memories', search: 'search' };

let depth = 0;               // how many screens deep we are (for the back button)
let editorOpen = false;
let rendering = Promise.resolve();
let introPending = true;      // the first page writes itself in once, when you open the journal
let lastDrawn = null;        // the address of the screen currently shown
const scrollMemory = new Map(); // where you were in a list, for when you come back

// iPhone only opens the keyboard during a tap. A new note is drawn a moment after the tap,
// so we hold the keyboard open with this invisible field and then hand it to the note.
const keyboardHolder = document.getElementById('keyboard-holder');

// ---------- navigation ----------
const nav = {
  go(path) {
    const target = `#/${path}`;
    if (location.hash === target) return;
    depth++;
    location.hash = target;
  },
  back() {
    if (depth > 0) { depth--; history.back(); } else { nav.tab(''); }
  },
  tab(path) {
    depth = 0;
    history.replaceState(null, '', `#/${path}`);
    route();
  },
  open(noteId) { nav.go(`note/${noteId}`); },
  compose(collectionId = null) {
    keyboardHolder.focus();
    nav.go(collectionId ? `new?c=${collectionId}` : 'new');
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
  rendering = rendering.then(drawRoute).catch((err) => console.error(err));
}

async function drawRoute() {
  const { parts, params } = parseHash();
  let [name = 'home', id] = parts;
  // On a computer, "Notes" opens the latest note straight away instead of an empty pane.
  if (wide.matches && name === 'notes') {
    const sort = await db.getSetting('noteSort', 'updatedAt');
    const latest = (await db.allEntries()).sort((a, b) => b[sort] - a[sort])[0];
    if (latest) { history.replaceState(null, '', `#/note/${latest.id}`); name = 'note'; id = latest.id; }
  }
  const isEditor = name === 'note' || name === 'new';

  // Leaving a note? Save it first.
  if (editorOpen) {
    editorOpen = false;
    await closeEditor();
  }

  if (lastDrawn) scrollMemory.set(lastDrawn.split('?')[0], window.scrollY);
  lastDrawn = location.hash || '#/';

  const isTab = name in TAB_OF;
  document.body.dataset.screen = isEditor ? 'editor' : name;
  document.body.dataset.tabbar = isTab ? 'on' : 'off';
  tabbar.querySelectorAll('.tab').forEach((t) => {
    if (isTab && t.dataset.tab === TAB_OF[name]) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });

  const showList = wide.matches && (name === 'notes' || isEditor);
  document.body.dataset.list = showList ? 'on' : 'off';
  if (wide.matches) {
    renderSidebar(sidebar, nav, document.body.dataset.screen, id);
    if (showList) renderListPane(listPane, nav, name === 'note' ? id : null);
  }

  await draw(name, id, params);
  window.scrollTo(0, isEditor ? 0 : (scrollMemory.get(lastDrawn.split('?')[0]) || 0));
}

function draw(name, id, params) {
  switch (name) {
    case 'home': { const intro = introPending; introPending = false; return renderHome(root, nav, { intro }); }
    case 'notes': return wide.matches ? renderNotesPlaceholder(root, nav) : renderNotes(root, nav);
    case 'memories': return renderMemories(root, nav);
    case 'photos': return renderPhotos(root, nav);
    case 'search': return renderSearch(root, nav);
    case 'collection': return renderCollection(root, nav, id);
    case 'settings': return renderSettings(root, nav);
    case 'note':
    case 'new':
      editorOpen = true;
      return renderEditor(root, {
        id: name === 'note' ? id : null,
        collection: params.get('c'),
        openPhoto: (note, photoId) => openNotePhoto(note, photoId, nav),
        onDone: () => nav.back(),
      });
    default:
      nav.tab('');
      return null;
  }
}

// ---------- tab bar ----------
tabbar.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab], [data-compose]');
  if (!tab) return;
  if (tab.hasAttribute('data-compose')) { nav.compose(); return; }
  const screen = document.body.dataset.screen;
  if (TAB_OF[screen] === tab.dataset.tab && screen !== 'photos') {
    window.scrollTo({ top: 0, behavior: 'smooth' }); // tapping the current tab scrolls to the top
    return;
  }
  scrollMemory.delete(`#/${tab.dataset.tab}`);
  nav.tab(tab.dataset.tab);
});

// ---------- computer layout: keep the panes up to date, keyboard shortcuts ----------
window.addEventListener('notes-changed', (e) => {
  if (!wide.matches || isLocked()) return;
  renderSidebar(sidebar, nav, document.body.dataset.screen, parseHash().parts[1]);
  if (document.body.dataset.list === 'on') renderListPane(listPane, nav, e.detail?.id ?? null);
});
wide.addEventListener('change', () => route());

document.addEventListener('keydown', (e) => {
  if (isLocked() || document.querySelector('.dialog-overlay, .sheet-overlay, .lightbox')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.altKey && !mod && e.key.toLowerCase() === 'n') { e.preventDefault(); nav.compose(); }        // Alt+N  new note
  else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); nav.tab('search'); setTimeout(() => document.querySelector('.search-field')?.focus(), 150); } // Ctrl+K search
  else if (mod && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); nav.lock(); }       // Ctrl+Shift+L lock
});

// ---------- first start, and upgrades from older versions ----------
async function prepareData() {
  if (!await db.getSetting('initialized')) {
    const now = Date.now();
    await db.saveCollections(STARTER_COLLECTIONS.map((c, i) => ({ id: uid(), name: c.name, description: c.description, order: i, createdAt: now + i })));
    await db.setSetting('initialized', true);
  }
  await upgradeAll(); // pages written with an older version become notes (nothing is lost)
  const collections = await db.allCollections();
  if (collections.some((c) => c.order === undefined)) {
    collections.sort((a, b) => a.createdAt - b.createdAt).forEach((c, i) => { if (c.order === undefined) c.order = i; });
    await db.saveCollections(collections);
  }
}

// ---------- locking when leaving the app ----------
function onHidden() {
  if (autoLockPaused()) return; // the photo picker or share sheet is open
  if (editorOpen) saveCurrent();
  lockNow();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onHidden(); });
window.addEventListener('pagehide', onHidden);

// ---------- start ----------
async function start() {
  document.documentElement.dataset.font = await db.getSetting('writingFont', 'clean');
  await prepareData();
  try { await navigator.storage?.persist?.(); } catch { /* ignore */ }

  window.addEventListener('hashchange', route);

  let firstUnlock = true;
  await initLock(async () => {
    // The first time the journal is unlocked after opening the app, the memories play.
    if (firstUnlock) {
      firstUnlock = false;
      const played = playOpening();
      route(); // the first page is drawn underneath meanwhile
      if (await played) introPending = false;
      return;
    }
    if (editorOpen && root.querySelector('.editor')) return;              // still writing: carry on
    if (root.childElementCount && lastDrawn === (location.hash || '#/')) return; // same screen as before
    if (location.hash.startsWith('#/new')) nav.tab('');                    // reopened on an unsaved new note
    else route();
  });

  cleanUpUnusedPhotos();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
