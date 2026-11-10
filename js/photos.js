// photos.js — saving pictures and showing them.
// The ORIGINAL picture is always kept unchanged and shown as it is (no filters).
// We also keep a small "thumb" copy so lists and the gallery load fast.

import { db } from './db.js';
import { uid } from './util.js';

const THUMB_SIZE = 480;

// Make a small JPEG copy of a picture.
export async function makeThumb(blob) {
  let source;
  try {
    source = await createImageBitmap(blob);
  } catch {
    // Fallback for older browsers: load it through an <img>.
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  }
  const w = source.width || source.naturalWidth;
  const hgt = source.height || source.naturalHeight;
  const scale = Math.min(1, THUMB_SIZE / Math.max(w, hgt));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(hgt * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || blob), 'image/jpeg', 0.82));
}

// Save a picture from the photo picker. Returns the new photo id.
export async function addPhotoFromFile(file) {
  const id = uid();
  const thumb = await makeThumb(file);
  await db.savePhoto({ id, blob: file, thumb, type: file.type || 'image/jpeg', createdAt: Date.now() });
  return id;
}

// Object URLs let an <img> show a picture stored in the database.
// We remember them so the same picture isn't loaded twice.
const urlCache = new Map();

export async function photoURL(id, size = 'full') {
  const key = `${id}:${size}`;
  if (urlCache.has(key)) return urlCache.get(key);
  const photo = await db.getPhoto(id);
  if (!photo) return null;
  const blob = size === 'thumb' ? (photo.thumb || photo.blob) : photo.blob;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

export function forgetPhotoURL(id) {
  for (const size of ['full', 'thumb']) {
    const key = `${id}:${size}`;
    if (urlCache.has(key)) {
      URL.revokeObjectURL(urlCache.get(key));
      urlCache.delete(key);
    }
  }
}

// <img> that fills itself in once the picture is loaded from the database.
export function photoImg(id, size = 'full', className = '') {
  const img = document.createElement('img');
  if (className) img.className = className;
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  photoURL(id, size).then((url) => { if (url) img.src = url; });
  return img;
}

// Delete pictures that nothing uses anymore (e.g. after a photo was removed from a note).
export async function cleanUpUnusedPhotos() {
  const [notes, collections, photoIds] = await Promise.all([db.allEntries(), db.allCollections(), db.photoIds()]);
  const used = new Set();
  notes.forEach((n) => {
    (n.photos || []).forEach((p) => used.add(p.photoId));
    (n.blocks || []).forEach((b) => { if (b.type === 'photo') used.add(b.photoId); }); // notes from older versions
  });
  collections.forEach((c) => { if (c.coverPhotoId) used.add(c.coverPhotoId); });
  for (const id of photoIds) {
    if (!used.has(id)) {
      forgetPhotoURL(id);
      await db.deletePhoto(id);
    }
  }
}
