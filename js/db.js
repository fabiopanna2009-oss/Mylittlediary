// db.js — everything is saved ON THE PHONE with IndexedDB (a database built into the browser).
// Nothing is ever sent to a server.
//
// If you know SQL, think of it like this:
//   object store = table, keyPath = PRIMARY KEY, index = CREATE INDEX
//
// Stores ("tables"):
//   entries      { id, kind, title, date, time, mood, blocks, collections, favorite, milestone, createdAt, updatedAt }
//                kind = 'entry' | 'thought' | 'letter' | 'memory' | 'detail'
//                blocks = [ { type: 'text', text }, { type: 'photo', photoId, caption, date } ... ]
//   photos       { id, blob, thumb, createdAt }   blob = the original picture, thumb = small version for the gallery
//   collections  { id, name, createdAt }
//   settings     { key, value }

const DB_NAME = 'little-memories';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('kind', 'kind');
      }
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Runs fn(store) inside a transaction and resolves when the transaction is finished.
async function tx(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const result = fn(t.objectStore(storeName));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
const get = (store, id) => tx(store, 'readonly', (s) => s.get(id));
const put = (store, value) => tx(store, 'readwrite', (s) => s.put(value));
const del = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));
const putMany = (store, values) => tx(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); });

export const db = {
  // entries
  allEntries: () => getAll('entries'),
  getEntry: (id) => get('entries', id),
  saveEntry: (e) => put('entries', e),
  deleteEntry: (id) => del('entries', id),
  saveEntries: (list) => putMany('entries', list),

  // photos
  allPhotos: () => getAll('photos'),
  photoIds: () => tx('photos', 'readonly', (s) => s.getAllKeys()),
  getPhoto: (id) => get('photos', id),
  savePhoto: (p) => put('photos', p),
  deletePhoto: (id) => del('photos', id),
  savePhotos: (list) => putMany('photos', list),

  // collections
  allCollections: () => getAll('collections'),
  saveCollection: (c) => put('collections', c),
  deleteCollection: (id) => del('collections', id),
  saveCollections: (list) => putMany('collections', list),

  // settings
  async getSetting(key, fallback = null) {
    const row = await get('settings', key);
    return row ? row.value : fallback;
  },
  setSetting: (key, value) => put('settings', { key, value }),
};
