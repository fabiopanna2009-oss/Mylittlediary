// db.js — saves everything on the phone using IndexedDB (a small database built into the browser).
//
// There are two "tables" (IndexedDB calls them object stores):
//   entries  -> your diary entries   { id, date, mood, title, text, createdAt, updatedAt }
//   settings -> app settings          { key, value }   e.g. the PIN hash
//
// If you know SQL: an object store is like a table, the keyPath is the PRIMARY KEY,
// and an index is like CREATE INDEX so we can quickly sort by date.

const DB = (() => {
  const DB_NAME = 'mydiary';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      // Runs only the first time (or when DB_VERSION goes up): create the "tables".
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('entries')) {
          const entries = db.createObjectStore('entries', { keyPath: 'id' });
          entries.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  // Small helper: run one operation on a store and wait for it to finish.
  async function run(storeName, mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = operation(store);
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    // ----- entries -----
    getAllEntries: () => run('entries', 'readonly', (s) => s.getAll()),
    getEntry: (id) => run('entries', 'readonly', (s) => s.get(id)),
    saveEntry: (entry) => run('entries', 'readwrite', (s) => s.put(entry)),
    deleteEntry: (id) => run('entries', 'readwrite', (s) => s.delete(id)),

    // Save many entries in one transaction (used by "Import backup").
    async saveEntries(list) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('entries', 'readwrite');
        const store = tx.objectStore('entries');
        list.forEach((entry) => store.put(entry));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    // ----- settings -----
    async getSetting(key, fallback = null) {
      const row = await run('settings', 'readonly', (s) => s.get(key));
      return row ? row.value : fallback;
    },
    setSetting: (key, value) => run('settings', 'readwrite', (s) => s.put({ key, value })),
  };
})();
