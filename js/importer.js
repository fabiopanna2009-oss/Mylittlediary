// importer.js — bring notes written elsewhere (for example in ChatGPT) into the journal.
//
// Nothing connects to the internet here. You ask ChatGPT to write your notes in the format below,
// copy its answer, and paste it into the app. You see what would be added before anything is saved.
//
// The format (JSON):
//   {
//     "notes": [
//       {
//         "title": "The hiking day",
//         "text": "First paragraph.\n\nSecond paragraph.\n# A heading\n- a list item\n[ ] a checklist item",
//         "date": "2023-09-28",            (optional, YYYY-MM-DD)
//         "dateKind": "exact",             (optional: exact | around | unknown)
//         "dateWords": "during the trip",  (optional: the date in your own words)
//         "collections": ["Madulain"],     (optional: names; created if they don't exist)
//         "place": { "name": "…", "url": "https://…" },   (optional)
//         "song":  { "title": "…", "url": "https://…" },  (optional)
//         "pinned": false                  (optional)
//       }
//     ],
//     "collections": [ { "name": "…", "description": "…" } ],   (optional)
//     "words": ["a word", "a sentence that matters"],            (optional)
//     "questions": [                                             (optional: questions for the door)
//       { "question": "Where did the trail end?", "keywords": ["the top", "summit"] }
//     ]
//   }
//
// Questions for the door: the key words are scrambled the moment they are imported
// (see js/lock.js). Delete the text or file you imported them from afterwards.

import { db } from './db.js';
import { uid } from './util.js';
import { derive } from './notes.js';
import { getGate, addQuestion, setGateEnabled } from './lock.js';

// The instructions you give ChatGPT once. They contain nothing personal.
export const CHATGPT_INSTRUCTIONS = `I keep a private journal in an app called Little Memories. Whenever I say "export to Little Memories", turn what we talked about into notes for that app.

Answer with ONE code block containing only JSON in exactly this format, and nothing else:

{
  "notes": [
    {
      "title": "short title",
      "text": "the note itself",
      "date": "YYYY-MM-DD",
      "dateKind": "exact",
      "dateWords": "",
      "collections": ["Collection name"],
      "place": { "name": "", "url": "" },
      "song": { "title": "", "url": "" },
      "pinned": false
    }
  ],
  "collections": [ { "name": "Collection name", "description": "" } ],
  "words": ["a word or a short sentence that matters to me"]
}

Rules:
- Write every note in my own voice, in the first person, using my own words from our conversation as much as possible. Keep it honest and simple. Do not make it sound like a poem or a self-help text.
- Never invent facts, dates, names, places or quotes. If I did not say it, leave it out.
- Dates: use "date" only if I gave one. If a date is only roughly known, set "dateKind" to "around". If it is unknown, set "dateKind" to "unknown". In both cases describe it in "dateWords" in my words (for example "the last Friday before summer").
- "text" is plain text. Put an empty line between paragraphs. A line starting with "# " is a heading, "- " is a list item, "[ ] " is an open checklist item and "[x] " a ticked one. Use **double stars** for bold, sparingly.
- "collections" are names of my collections. Reuse the names I already use. Only suggest a new one if nothing fits.
- Leave out "place", "song", "collections" or "words" when there is nothing to put there.
- One note per memory or thought. Do not merge different memories into one note.
- Do not add advice, comments or explanations, neither inside the notes nor around the code block.`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

// Plain text with a few simple marks -> the note's HTML.
function textToHTML(text) {
  const out = [];
  let list = null; // { type: 'ul' | 'checklist', items: [] }
  const closeList = () => {
    if (!list) return;
    out.push(`<ul${list.type === 'checklist' ? ' class="checklist"' : ''}>${list.items.join('')}</ul>`);
    list = null;
  };
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const check = line.match(/^\[( |x|X)\]\s+(.*)$/);
    const bullet = line.match(/^[-•*]\s+(.*)$/);
    if (check) {
      if (list?.type !== 'checklist') { closeList(); list = { type: 'checklist', items: [] }; }
      list.items.push(`<li${check[1].trim() ? ' data-checked="true"' : ''}>${inline(check[2])}</li>`);
    } else if (bullet) {
      if (list?.type !== 'ul') { closeList(); list = { type: 'ul', items: [] }; }
      list.items.push(`<li>${inline(bullet[1])}</li>`);
    } else {
      closeList();
      if (!line) continue;
      const heading = line.match(/^#{1,3}\s+(.*)$/);
      out.push(heading ? `<h2>${inline(heading[1])}</h2>` : `<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('');
}

const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');
const clean = (v, max = 300) => String(v ?? '').trim().slice(0, max);

// Read what was pasted. Accepts JSON with or without a ``` code block around it,
// and tolerates text before or after it. Throws a readable error if it can't be understood.
export function parseImport(pasted) {
  let text = String(pasted || '').trim();
  if (!text) throw new Error('Nothing to import yet. Paste the answer from ChatGPT first.');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('This doesn’t look like a Little Memories export. Ask ChatGPT to “export to Little Memories” and paste its whole answer.');
  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('The text is incomplete or damaged (it could not be read). Copy the whole code block from ChatGPT and try again.');
  }

  const notes = (Array.isArray(data.notes) ? data.notes : []).map((n) => {
    const html = textToHTML(n.text ?? n.content ?? '');
    const title = clean(n.title, 160);
    let dateKind = ['exact', 'around', 'unknown'].includes(n.dateKind) ? n.dateKind : 'exact';
    let createdAt = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(n.date || ''))) {
      const [y, m, d] = n.date.split('-').map(Number);
      const t = new Date(y, m - 1, d, 12, 0).getTime();
      if (Number.isFinite(t)) createdAt = t;
    }
    if (createdAt === null && dateKind === 'exact') dateKind = n.dateWords ? 'unknown' : 'exact'; // no date given
    return {
      title, html, dateKind, createdAt,
      dateWords: clean(n.dateWords, 120),
      collections: (Array.isArray(n.collections) ? n.collections : []).map((c) => clean(c, 60)).filter(Boolean),
      place: n.place && (clean(n.place.name) || safeUrl(n.place.url)) ? { name: clean(n.place.name, 120), url: safeUrl(n.place.url) } : null,
      song: n.song && (clean(n.song.title) || safeUrl(n.song.url)) ? { title: clean(n.song.title, 120), url: safeUrl(n.song.url) } : null,
      pinned: n.pinned === true,
    };
  }).filter((n) => n.title || n.html);

  const collections = (Array.isArray(data.collections) ? data.collections : [])
    .map((c) => (typeof c === 'string' ? { name: clean(c, 60), description: '' } : { name: clean(c?.name, 60), description: clean(c?.description, 400) }))
    .filter((c) => c.name);
  const words = (Array.isArray(data.words) ? data.words : []).map((w) => clean(w, 140)).filter(Boolean);

  const questions = (Array.isArray(data.questions) ? data.questions : [])
    .map((q) => ({ text: clean(q?.question ?? q?.text, 140), keywords: (Array.isArray(q?.keywords) ? q.keywords : []).map((k) => clean(k, 80)).filter(Boolean) }))
    .filter((q) => q.text && q.keywords.length);

  if (!notes.length && !collections.length && !words.length && !questions.length) throw new Error('There is nothing in this export: no notes, collections, words or questions.');
  return { notes, collections, words, questions };
}

// Save what was parsed. Returns how much was really added (things you already have are skipped).
export async function applyImport({ notes, collections, words, questions = [] }) {
  const now = Date.now();
  const mine = await db.allCollections();
  const byName = new Map(mine.map((c) => [c.name.trim().toLowerCase(), c]));
  let order = mine.length ? Math.max(...mine.map((c) => c.order ?? 0)) + 1 : 0;
  const newCollections = [];
  const collectionId = (name, description = '') => {
    const key = name.trim().toLowerCase();
    let c = byName.get(key);
    if (!c) {
      c = { id: uid(), name: name.trim(), description, order: order++, createdAt: now + order };
      byName.set(key, c);
      newCollections.push(c);
    } else if (description && !c.description) {
      c.description = description;
      if (!newCollections.includes(c)) newCollections.push(c);
    }
    return c.id;
  };
  collections.forEach((c) => collectionId(c.name, c.description));

  // a note you already have (same title and same text) is not added twice
  const existing = new Set((await db.allEntries()).map((n) => `${(n.title || '').trim()}\n${(n.text || '').trim()}`));
  const toSave = [];
  notes.forEach((n, i) => {
    const content = derive(n.html);
    const key = `${n.title}\n${content.text.trim()}`;
    if (existing.has(key)) return;
    existing.add(key);
    toSave.push({
      id: uid(), title: n.title, ...content,
      collections: [...new Set(n.collections.map((name) => collectionId(name)))],
      pinned: n.pinned,
      createdAt: n.createdAt ?? now + i, updatedAt: now + i,
      dateKind: n.dateKind, dateWords: n.dateWords, place: n.place, song: n.song,
    });
  });

  const lines = (t) => (t || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const myWords = lines(await db.getSetting('words', ''));
  const have = new Set(myWords.map((w) => w.toLowerCase()));
  const newWords = words.filter((w) => !have.has(w.toLowerCase()) && have.add(w.toLowerCase()));

  if (newCollections.length) await db.saveCollections(newCollections);
  if (toSave.length) await db.saveEntries(toSave);
  if (newWords.length) await db.setSetting('words', [...myWords, ...newWords].join('\n'));
  // Questions for the door. One you already have (same wording) is not added twice.
  // If these are your first questions, the journal starts asking them (the PIN keeps working).
  let newQuestions = 0;
  if (questions.length) {
    const gate = await getGate();
    const hadNone = gate.questions.length === 0;
    const known = new Set(gate.questions.map((q) => q.text.trim().toLowerCase()));
    for (const q of questions) {
      if (known.has(q.text.trim().toLowerCase())) continue;
      if (await addQuestion(q.text, q.keywords)) { newQuestions++; known.add(q.text.trim().toLowerCase()); }
    }
    if (hadNone && newQuestions) await setGateEnabled(true);
  }

  return { notes: toSave.length, skipped: notes.length - toSave.length, collections: newCollections.filter((c) => !mine.includes(c)).length, words: newWords.length, questions: newQuestions };
}
