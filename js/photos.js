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
// keep = true marks a picture that belongs to the journal itself (not to a note): it is never cleaned up.
export async function addPhotoFromFile(file, keep = false) {
  const id = uid();
  const thumb = await makeThumb(file);
  await db.savePhoto({ id, blob: file, thumb, type: file.type || 'image/jpeg', createdAt: Date.now(), ...(keep ? { keep: true } : {}) });
  return id;
}

// Save one of your own drawings (dark lines on white paper).
// The white paper is removed so only the ink remains: every pixel keeps as much ink as it was dark.
// That way the drawing sits directly on the notebook page, in the light and in the dark look.
export async function addDrawingFromFile(file) {
  const source = await createImageBitmap(file);
  const scale = Math.min(1, 1100 / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height); // transparent areas count as paper
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const light = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const ink = Math.max(0, Math.min(255, (255 - light - 14) * 1.35)); // a little contrast, so grey paper vanishes
    px[i] = 42; px[i + 1] = 32; px[i + 2] = 26;                         // the notebook's ink colour
    px[i + 3] = ink;
  }
  ctx.putImageData(image, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const id = uid();
  await db.savePhoto({ id, blob, thumb: blob, type: 'image/png', createdAt: Date.now() });
  return id;
}

// ---------- the one recording you keep ----------
// A single audio file (for example a voice message) kept for the heavy moments.
// Stored on this device only:   keepsake = { id, label, name, addedAt }   (the audio itself is in `photos`)
// Phones often hand over audio without saying what it is (WhatsApp voice messages are ".opus"),
// so the type is worked out from the file name.
const AUDIO_TYPES = { opus: 'audio/ogg; codecs=opus', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', caf: 'audio/x-caf', amr: 'audio/amr', weba: 'audio/webm', mp4: 'audio/mp4' };

// Saves the recording (replacing an earlier one). Returns false if the file is not audio.
export async function saveKeepsake(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = file.type && file.type.startsWith('audio/') ? file.type : AUDIO_TYPES[ext];
  if (!type) return false;
  const old = await db.getSetting('keepsake', null);
  const id = uid();
  // the file is kept exactly as it is; only its type label is added if it was missing
  await db.savePhoto({ id, blob: new Blob([file], { type }), thumb: null, type, createdAt: Date.now() });
  await db.setSetting('keepsake', { id, label: old?.label || '', name: file.name, addedAt: Date.now() });
  if (old?.id) { forgetPhotoURL(old.id); await db.deletePhoto(old.id); }
  return true;
}

export async function removeKeepsake() {
  const old = await db.getSetting('keepsake', null);
  await db.setSetting('keepsake', null);
  if (old?.id) { forgetPhotoURL(old.id); await db.deletePhoto(old.id); }
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
  (await db.getSetting('drawings', []) || []).forEach((id) => used.add(id)); // your own drawings (Settings)
  (await db.getSetting('frontPhotos', []) || []).forEach((id) => used.add(id)); // photographs for the first page (Settings)
  const keepsake = await db.getSetting('keepsake', null);
  if (keepsake?.id) used.add(keepsake.id); // the one recording you keep
  for (const id of photoIds) {
    if (!used.has(id)) {
      // Only pictures that were added to a note are ever removed: anything marked 'keep', anything that
      // is not a photograph (the recording), and anything added in the last day is left alone.
      const p = await db.getPhoto(id);
      if (!p || p.keep || !(p.type || '').startsWith('image/') || Date.now() - (p.createdAt || 0) < 86400000) continue;
      forgetPhotoURL(id);
      await db.deletePhoto(id);
    }
  }
}
