// sw.js — the "service worker". It keeps a copy of the app on the phone so it opens without internet.
// It only stores the APP (code, fonts, icons). Your diary lives in IndexedDB, not here.
//
// How updates work: the app opens instantly from the saved copy, and in the background
// it checks GitHub for a newer version. The next time you open the app, you get the new one.

const CACHE = 'little-memories-v4';

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'css/fonts.css',
  'js/app.js',
  'js/db.js',
  'js/util.js',
  'js/content.js',
  'js/photos.js',
  'js/notes.js',
  'js/lock.js',
  'js/backup.js',
  'js/editor.js',
  'js/views.js',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/newsreader-latin-opsz-normal.woff2',
  'fonts/newsreader-latin-opsz-italic.woff2',
  'fonts/hanken-grotesk-latin-wght-normal.woff2',
  'fonts/hanken-grotesk-latin-wght-italic.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// "Stale while revalidate": answer from the saved copy right away, then refresh the copy in the background.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    const fresh = fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(fresh);
      return cached;
    }
    return (await fresh) || (request.mode === 'navigate' ? cache.match('index.html') : Response.error());
  })());
});
