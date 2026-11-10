// sw.js — the "service worker". It keeps a copy of the app on the phone so it opens without internet.
// It only stores the APP (code, fonts, icons). Your diary lives in IndexedDB, not here.
//
// How updates work: the app opens instantly from the saved copy. When this file changes (the
// version below), the browser downloads the whole new version in the background and switches
// to it; the next time you open the app, you get the new one, complete.

const CACHE = 'little-memories-v27';

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
  'js/theme.js',
  'js/importer.js',
  'js/drawings.js',
  'js/lock.js',
  'js/backup.js',
  'js/editor.js',
  'js/views.js',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/reenie-beanie-latin-400-normal.woff2',
  'fonts/kalam-latin-300-normal.woff2',
  'fonts/kalam-latin-400-normal.woff2',
  'fonts/kalam-latin-700-normal.woff2',
  'fonts/hanken-grotesk-latin-wght-normal.woff2',
  'fonts/hanken-grotesk-latin-wght-italic.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    // Every file comes from this version's saved copy, so the app never runs as a mix of an old
    // and a new version. A new version arrives as a whole (see 'install') and replaces this one.
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const fresh = await fetch(request, { cache: 'no-cache' }).catch(() => null);
    return fresh || (request.mode === 'navigate' ? cache.match('index.html') : Response.error());
  })());
});
