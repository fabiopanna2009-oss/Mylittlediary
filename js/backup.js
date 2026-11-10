// backup.js — export and import a backup of the whole diary.
//
// The backup is a normal .zip file:
//   diary.json          all pages, collections and some settings
//   photos/<id>.jpg     every original picture, unchanged
// You can even open it in the Files app on your iPhone and look at your photos.
//
// We write the zip ourselves (no library). The pictures are stored "as is" (no compression),
// which keeps the code short. Photos are already compressed anyway.

import { db } from './db.js';
import { makeThumb, forgetPhotoURL } from './photos.js';
import { todayISO } from './util.js';
import { upgradeAll } from './notes.js';

// ---------- CRC32 (a checksum every zip file needs) ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- Writing a zip ----------
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

async function makeZip(files) {
  // files: [{ name, data: Blob }]
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const file of files) {
    const name = enc.encode(file.name);
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const crc = crc32(bytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);      // file names are UTF-8
    local.setUint16(8, 0, true);           // 0 = stored, no compression
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, file.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, bytes.length, true);
    cd.setUint32(24, bytes.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, name);

    offset += 30 + name.length + bytes.length;
  }

  const centralSize = central.reduce((sum, p) => sum + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// ---------- Reading a zip (only the kind we write) ----------
async function readZip(blob) {
  const tailSize = Math.min(blob.size, 65557);
  const tail = new DataView(await blob.slice(blob.size - tailSize).arrayBuffer());
  let endPos = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { endPos = i; break; }
  }
  if (endPos < 0) throw new Error('This is not a backup file.');

  const count = tail.getUint16(endPos + 10, true);
  const cdSize = tail.getUint32(endPos + 12, true);
  const cdOffset = tail.getUint32(endPos + 16, true);
  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const files = new Map();

  let p = 0;
  for (let i = 0; i < count; i++) {
    const method = cd.getUint16(p + 10, true);
    const size = cd.getUint32(p + 20, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOffset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (method !== 0) throw new Error('This zip was changed by another app and can’t be read.');

    const lh = new DataView(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
    const start = localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    files.set(name, blob.slice(start, start + size));
  }
  return files;
}

// ---------- Export ----------
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp', 'image/gif': 'gif' };

export async function createBackup() {
  const [entries, collections, photos, bookTitle, noteSort, motto, specialDate, specialLabel, words, drawings] = await Promise.all([
    db.allEntries(), db.allCollections(), db.allPhotos(),
    db.getSetting('bookTitle'), db.getSetting('noteSort'), db.getSetting('motto'), db.getSetting('specialDate'), db.getSetting('specialLabel'), db.getSetting('words'), db.getSetting('drawings', []),
  ]);

  const photoFiles = photos.map((p) => ({
    id: p.id,
    file: `photos/${p.id}.${EXT[p.type] || 'jpg'}`,
    type: p.type,
    createdAt: p.createdAt,
    blob: p.blob,
  }));

  const diary = {
    app: 'little-memories',
    format: 2,
    exportedAt: new Date().toISOString(),
    settings: { bookTitle, noteSort, motto, specialDate, specialLabel, words, drawings },
    collections,
    entries,
    photos: photoFiles.map(({ blob, ...info }) => info),
  };

  const files = [
    { name: 'diary.json', data: new Blob([JSON.stringify(diary, null, 2)], { type: 'application/json' }) },
    ...photoFiles.map((p) => ({ name: p.file, data: p.blob })),
  ];
  const zip = await makeZip(files);
  return new File([zip], `little-memories-backup-${todayISO()}.zip`, { type: 'application/zip' });
}

// Opens the iPhone share sheet ("Save to Files"). Returns true if the backup was saved/shared.
// Must be called directly from a tap, so we create the file first (createBackup) and share it
// on a second tap. iPhone only allows the share sheet right after a tap.
export async function shareBackup(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Diary backup' });
    } catch (err) {
      if (err.name === 'AbortError') return false;
      throw err;
    }
  } else {
    // Computers: normal download.
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  await db.setSetting('lastBackup', Date.now());
  return true;
}

// ---------- Import ----------
// Merges the backup into the diary. If a page exists in both, the newer version wins.
export async function importBackup(file) {
  const files = await readZip(file);
  const json = files.get('diary.json');
  if (!json) throw new Error('This is not a Little Memories backup.');
  const diary = JSON.parse(await json.text());
  if (diary.app !== 'little-memories' || !Array.isArray(diary.entries)) {
    throw new Error('This is not a Little Memories backup.');
  }

  // Collections first, so notes from an older backup can be sorted into them.
  // A collection with the same name as one you already have is treated as the same collection.
  const mine = await db.allCollections();
  const byName = new Map(mine.map((c) => [c.name.trim().toLowerCase(), c]));
  const myIds = new Set(mine.map((c) => c.id));
  const sameAs = new Map(); // id in the backup -> id on this device
  const toSave = [];
  let order = mine.length ? Math.max(...mine.map((c) => c.order ?? 0)) + 1 : 0;
  for (const c of diary.collections || []) {
    if (myIds.has(c.id)) continue;
    const twin = byName.get((c.name || '').trim().toLowerCase());
    if (twin) {
      sameAs.set(c.id, twin.id);
      if (!twin.description && c.description) { twin.description = c.description; toSave.push(twin); }
    } else {
      toSave.push({ ...c, order: order++ });
    }
  }
  await db.saveCollections(toSave);
  const incoming = (await upgradeAll(diary.entries)) // backups from older versions are upgraded to notes
    .map((n) => ({ ...n, collections: [...new Set((n.collections || []).map((id) => sameAs.get(id) || id))] }));

  const existing = new Map((await db.allEntries()).map((e) => [e.id, e]));
  const newer = incoming.filter((e) => {
    const mine = existing.get(e.id);
    return !mine || (e.updatedAt || 0) > (mine.updatedAt || 0);
  });

  const existingPhotoIds = new Set(await db.photoIds());
  for (const info of diary.photos || []) {
    if (existingPhotoIds.has(info.id)) continue;
    const blob = files.get(info.file);
    if (!blob) continue;
    const typed = new Blob([blob], { type: info.type || 'image/jpeg' });
    const thumb = await makeThumb(typed);
    forgetPhotoURL(info.id);
    await db.savePhoto({ id: info.id, blob: typed, thumb, type: typed.type, createdAt: info.createdAt || Date.now() });
  }

  await db.saveEntries(newer);

  // Your personal words (title, line, date): restored only where this device has none yet.
  for (const key of ['bookTitle', 'motto', 'specialDate', 'specialLabel']) {
    const value = diary.settings?.[key];
    if (value && !(await db.getSetting(key))) await db.setSetting(key, value);
  }
  // Your own drawings from the backup are added to the ones on this device.
  if (Array.isArray(diary.settings?.drawings) && diary.settings.drawings.length) {
    const mineDrawings = await db.getSetting('drawings', []) || [];
    await db.setSetting('drawings', [...new Set([...mineDrawings, ...diary.settings.drawings])]);
  }
  // Words and sentences are added to the ones you already have (no duplicates).
  if (diary.settings?.words) {
    const lines = (text) => (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const mineWords = lines(await db.getSetting('words', ''));
    const have = new Set(mineWords.map((l) => l.toLowerCase()));
    const added = lines(diary.settings.words).filter((l) => !have.has(l.toLowerCase()));
    if (added.length) await db.setSetting('words', [...mineWords, ...added].join('\n'));
  }

  return { pages: newer.length, total: diary.entries.length };
}
