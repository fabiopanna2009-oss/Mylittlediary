// notes.js — what a note is, and how its text is stored safely.
//
// A note:
//   { id, title, html, text, photos, collections, pinned, createdAt, updatedAt }
//
//   html    the formatted text (headings, bold, lists, checklists) with photo placeholders:
//             <figure data-photo="ID" data-caption="…" data-date="2026-09-28"></figure>
//   text    the same content as plain text (used for search and previews)
//   photos  [{ photoId, caption, date }] in the order they appear (used for the gallery)
//
// `text` and `photos` are worked out from `html` every time a note is saved.

import { db } from './db.js';
import { uid } from './util.js';

// ---------- cleaning HTML ----------
// Only these tags are ever stored. Everything else (styles, scripts, pasted junk) is dropped.
const KEEP = { P: 'p', DIV: 'p', H1: 'h2', H2: 'h2', H3: 'h3', B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', UL: 'ul', OL: 'ol', LI: 'li', BR: 'br' };
const BLOCKS = new Set(['P', 'H2', 'H3', 'UL', 'OL', 'FIGURE']);

function cleanInto(source, target, doc) {
  for (const node of source.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      target.append(doc.createTextNode(node.nodeValue));
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'FIGURE' && node.dataset.photo) {
        const fig = doc.createElement('figure');
        fig.setAttribute('data-photo', node.dataset.photo);
        if (node.dataset.caption) fig.setAttribute('data-caption', node.dataset.caption);
        if (node.dataset.date) fig.setAttribute('data-date', node.dataset.date);
        target.append(fig);
        continue;
      }
      const tag = KEEP[node.tagName];
      if (!tag) {
        if (!['SCRIPT', 'STYLE', 'FIGURE', 'INPUT', 'BUTTON', 'IMG'].includes(node.tagName)) cleanInto(node, target, doc); // keep the words, drop the wrapper
        continue;
      }
      const el = doc.createElement(tag);
      if (tag === 'ul' && node.classList.contains('checklist')) el.className = 'checklist';
      if (tag === 'li' && node.dataset.checked === 'true') el.setAttribute('data-checked', 'true');
      cleanInto(node, el, doc);
      target.append(el);
    }
  }
}

// Returns a clean, detached <div> holding the note's content as top-level blocks.
export function cleanDOM(htmlOrElement) {
  const doc = document.implementation.createHTMLDocument('');
  const source = typeof htmlOrElement === 'string'
    ? new DOMParser().parseFromString(`<div>${htmlOrElement}</div>`, 'text/html').body.firstChild
    : htmlOrElement;
  const flat = doc.createElement('div');
  cleanInto(source, flat, doc);

  // Make sure everything sits inside a block (loose text becomes a paragraph; blocks are not nested).
  const out = doc.createElement('div');
  let loose = null;
  const flush = () => { if (loose && (loose.textContent.trim() || loose.querySelector('br'))) out.append(loose); loose = null; };
  for (const node of [...flat.childNodes]) {
    if (node.nodeType === Node.ELEMENT_NODE && BLOCKS.has(node.tagName)) {
      flush();
      // lift figures and blocks that ended up inside a paragraph
      const inner = node.tagName === 'P' ? [...node.querySelectorAll('figure, p, h2, h3, ul, ol')] : [];
      if (inner.length) {
        for (const child of [...node.childNodes]) {
          if (child.nodeType === Node.ELEMENT_NODE && BLOCKS.has(child.tagName)) { flush(); out.append(child); }
          else { loose = loose || doc.createElement('p'); loose.append(child); }
        }
        flush();
      } else out.append(node);
    } else {
      loose = loose || doc.createElement('p');
      loose.append(node);
    }
  }
  flush();
  return out;
}

export const sanitizeHTML = (html) => cleanDOM(html).innerHTML;

// Plain text and photo list from clean HTML.
export function derive(html) {
  const root = cleanDOM(html);
  const lines = [];
  const photos = [];
  for (const block of root.children) {
    if (block.tagName === 'FIGURE') {
      photos.push({ photoId: block.dataset.photo, caption: block.dataset.caption || '', date: block.dataset.date || '' });
    } else if (block.tagName === 'UL' || block.tagName === 'OL') {
      for (const li of block.querySelectorAll('li')) lines.push(li.textContent.trim());
    } else {
      lines.push(block.textContent.trim());
    }
  }
  return { html: root.innerHTML, text: lines.filter(Boolean).join('\n'), photos };
}

// ---------- reading a note ----------
export function noteTitle(n) {
  if (n.title?.trim()) return n.title.trim();
  const first = (n.text || '').split('\n').find((l) => l.trim());
  if (first) return first.length > 70 ? `${first.slice(0, 68).trim()}…` : first;
  return n.photos?.length ? 'Photograph' : 'New note';
}

export function noteExcerpt(n) {
  const lines = (n.text || '').split('\n').filter((l) => l.trim());
  if (!n.title?.trim()) lines.shift(); // the first line is already shown as the title
  return lines.join(' ').slice(0, 160);
}

// ---------- when did it happen? ----------
// Not every memory has an exact date. A note stores:
//   createdAt   a point in time (used to put notes in order)
//   dateKind    'exact' (default) | 'around' (roughly then) | 'unknown'
//   dateWords   optional: the date in your own words, e.g. "the last Friday before summer"
const MONTH_YEAR = { month: 'long', year: 'numeric' };
const FULL = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
const DAY = { day: 'numeric', month: 'long', year: 'numeric' };

export function noteWhen(n, style = 'long') {
  const d = new Date(n.createdAt);
  if (n.dateKind === 'unknown') return n.dateWords?.trim() || 'Date unknown';
  if (n.dateKind === 'around') return n.dateWords?.trim() || `Around ${d.toLocaleDateString('en-GB', MONTH_YEAR)}`;
  const exact = d.toLocaleDateString('en-GB', style === 'long' ? FULL : DAY);
  return n.dateWords?.trim() ? `${exact} · ${n.dateWords.trim()}` : exact;
}

export const isNoteEmpty = (n) => !n.title?.trim() && !(n.text || '').trim() && !(n.photos || []).length;

export function newNote(extra = {}) {
  const now = Date.now();
  return { id: uid(), title: '', html: '', text: '', photos: [], collections: [], pinned: false, createdAt: now, updatedAt: now, ...extra };
}

// ---------- upgrading notes written with older versions of the app ----------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function blocksToHTML(blocks) {
  return (blocks || []).map((b) => {
    if (b.type === 'photo') return `<figure data-photo="${esc(b.photoId)}" data-caption="${esc(b.caption || '')}" data-date="${esc(b.date || '')}"></figure>`;
    return (b.text || '').split('\n').filter((l) => l.trim()).map((l) => `<p>${esc(l)}</p>`).join('');
  }).join('');
}

// Old pages had a "kind". Letters and little details are gathered into collections instead.
const KIND_COLLECTION = { letter: 'Unspoken words', detail: 'The little things' };

export function upgradeNote(e, collectionIdFor) {
  if (typeof e.html === 'string') return e; // already a note
  const made = e.date ? new Date(`${e.date}T${e.time || '12:00'}`).getTime() : e.createdAt;
  const collections = [...(e.collections || [])];
  const gather = KIND_COLLECTION[e.kind];
  if (gather) {
    const id = collectionIdFor(gather);
    if (!collections.includes(id)) collections.push(id);
  }
  return {
    id: e.id,
    title: e.title || '',
    ...derive(blocksToHTML(e.blocks)),
    collections,
    pinned: !!e.favorite,
    createdAt: Number.isFinite(made) ? made : (e.createdAt || Date.now()),
    updatedAt: e.updatedAt || e.createdAt || Date.now(),
  };
}

// Upgrades everything in the database (or a list from a backup). Safe to run more than once.
export async function upgradeAll(list = null) {
  const entries = list || await db.allEntries();
  const old = entries.filter((e) => typeof e.html !== 'string');
  const collections = await db.allCollections();
  const created = [];
  const collectionIdFor = (name) => {
    let c = collections.find((x) => x.name === name);
    if (!c) {
      c = { id: uid(), name, description: '', order: collections.length, createdAt: Date.now() };
      collections.push(c);
      created.push(c);
    }
    return c.id;
  };
  const upgraded = entries.map((e) => upgradeNote(e, collectionIdFor));
  if (created.length) await db.saveCollections(created);
  if (!list && old.length) await db.saveEntries(upgraded.filter((n, i) => entries[i] !== n));
  return upgraded;
}
