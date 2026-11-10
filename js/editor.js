// editor.js — writing a page.
//
// A page is a list of "blocks": text, photo, text, photo, text…
// When you add a photo, the text block you are in is split at your cursor and the photo goes in between,
// like gluing a picture into the middle of a page.
// Everything saves automatically while you write.

import { db } from './db.js';
import { h, icon, uid, todayISO, nowTime, debounce, isEntryEmpty, entryText, entryPhotos, toast, ask, fmt, pickFiles } from './util.js';
import { KINDS, MOODS, PROMPTS, LETTER_PROMPTS, DETAIL_PROMPTS, randomFrom } from './content.js';
import { addPhotoFromFile, photoImg, cleanUpUnusedPhotos } from './photos.js';

let current = null;        // the page being edited
let saveSoon = null;       // debounced save
let lastFocus = null;      // { index, caret } — where the cursor was last
let startText = '';        // e.g. "Dear …," that a new letter starts with

// A page counts as empty if nothing was written (a letter with only "Dear …," is empty too).
function isBlank(entry) {
  if (isEntryEmpty(entry)) return true;
  return !!startText && !entry.title?.trim() && entryPhotos(entry).length === 0 && entryText(entry) === startText.trim();
}

export function newEntry(kind = 'entry', extra = {}) {
  const now = Date.now();
  return {
    id: uid(),
    kind,
    title: '',
    date: todayISO(),
    time: nowTime(),
    mood: null,
    blocks: [{ type: 'text', text: '' }],
    collections: [],
    favorite: false,
    milestone: false,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

// Save now (if the page has anything in it).
export async function saveCurrent() {
  if (!current) return;
  saveSoon?.cancel();
  if (isBlank(current)) {
    if (current._saved) {
      await db.deleteEntry(current.id);
      current._saved = false;
    }
    return;
  }
  current.updatedAt = Date.now();
  const { _saved, ...toStore } = current;
  await db.saveEntry(toStore);
  current._saved = true;
  setStatus('Saved');
}

// Called when leaving the editor.
export async function closeEditor() {
  if (!current) return;
  await saveCurrent();
  current = null;
  await cleanUpUnusedPhotos();
}

function setStatus(text) {
  const el = document.getElementById('save-status');
  if (el) el.textContent = text;
}

function changed() {
  setStatus('…');
  saveSoon();
}

// Text areas grow with your text, like a page that never ends.
function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

function placeholderFor(kind, index) {
  if (index > 0) return 'Keep writing…';
  if (kind === 'letter') return 'Dear …';
  if (kind === 'detail') return 'Something small you remember…';
  if (kind === 'thought') return 'Whatever is on your mind…';
  if (kind === 'memory') return 'A moment you never want to forget…';
  return 'Dear diary…';
}

export async function renderEditor(root, { id, kind, date, collection, milestone, prompt, onDone }) {
  // Load or create the page.
  if (id) {
    const stored = await db.getEntry(id);
    if (!stored) { onDone(); return; }
    current = { ...stored, _saved: true };
  } else {
    current = newEntry(kind || 'entry', {
      ...(date ? { date } : {}),
      ...(collection ? { collections: [collection] } : {}),
      ...(milestone ? { milestone: true } : {}),
    });
    if (current.kind === 'letter') {
      const to = await db.getSetting('letterTo', '');
      current.blocks[0].text = to ? `Dear ${to},\n\n` : '';
    }
  }
  saveSoon = debounce(saveCurrent, 700);
  lastFocus = null;
  startText = id ? '' : entryText(current);

  const collections = (await db.allCollections()).sort((a, b) => a.name.localeCompare(b.name));
  const kindInfo = KINDS[current.kind] || KINDS.entry;
  const blocksEl = h('div', { class: 'blocks' });

  // ----- top bar -----
  const favBtn = h('button', {
    class: `icon-btn fav ${current.favorite ? 'on' : ''}`,
    'aria-label': 'Favourite',
    onclick: () => {
      current.favorite = !current.favorite;
      favBtn.classList.toggle('on', current.favorite);
      toast(current.favorite ? 'Added to favourites' : 'Removed from favourites');
      changed();
    },
  }, icon('star'));

  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => onDone() }, icon('back')),
    h('div', { class: 'topbar-center' },
      h('div', { class: 'topbar-kicker' }, kindInfo.one),
      h('div', { class: 'save-status', id: 'save-status' }, current._saved ? 'Saved' : ''),
    ),
    favBtn,
  );

  // ----- date, time -----
  const dateInput = h('input', { type: 'date', class: 'meta-input', value: current.date, oninput: (e) => { current.date = e.target.value || todayISO(); dateLabel.textContent = fmt.long(current.date); changed(); } });
  const timeInput = h('input', { type: 'time', class: 'meta-input', value: current.time || '', oninput: (e) => { current.time = e.target.value; changed(); } });
  const dateLabel = h('span', { class: 'date-label' }, fmt.long(current.date));
  const meta = h('div', { class: 'page-meta' },
    h('label', { class: 'meta-date' }, dateLabel, dateInput),
    h('label', { class: 'meta-time' }, timeInput),
  );

  // ----- title -----
  const titleInput = h('textarea', {
    class: 'page-title-input',
    rows: 1,
    placeholder: current.kind === 'letter' ? 'A letter to…' : 'Title',
    value: current.title,
    oninput: (e) => { current.title = e.target.value.replace(/\n/g, ' '); autoGrow(e.target); changed(); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); blocksEl.querySelector('textarea')?.focus(); } },
  });

  // ----- mood -----
  const moodRow = h('div', { class: 'moods', role: 'radiogroup', 'aria-label': 'Mood' },
    MOODS.map((m) => {
      const btn = h('button', {
        class: `mood ${current.mood === m.id ? 'selected' : ''}`,
        'aria-pressed': current.mood === m.id ? 'true' : 'false',
        onclick: () => {
          current.mood = current.mood === m.id ? null : m.id;
          moodRow.querySelectorAll('.mood').forEach((b) => b.classList.remove('selected'));
          if (current.mood) btn.classList.add('selected');
          changed();
        },
      }, h('span', { class: 'mood-emoji' }, m.emoji), h('span', { class: 'mood-label' }, m.label));
      return btn;
    }),
  );

  // ----- gentle prompt -----
  const promptList = current.kind === 'letter' ? LETTER_PROMPTS : current.kind === 'detail' ? DETAIL_PROMPTS : PROMPTS;
  let shownPrompt = prompt || null;
  const promptText = h('span', { class: 'prompt-text' }, shownPrompt || 'Need a little spark?');
  const promptBox = h('button', {
    class: 'prompt',
    onclick: () => {
      shownPrompt = randomFrom(promptList, shownPrompt);
      promptText.textContent = shownPrompt;
      promptBox.classList.add('has-prompt');
    },
  }, icon('spark'), promptText);
  if (shownPrompt) promptBox.classList.add('has-prompt');

  // ----- blocks -----
  function renderBlocks() {
    blocksEl.replaceChildren(...current.blocks.map((block, index) => (block.type === 'photo' ? photoBlock(block, index) : textBlock(block, index))));
    blocksEl.querySelectorAll('textarea').forEach(autoGrow);
  }

  function textBlock(block, index) {
    const ta = h('textarea', {
      class: 'page-text',
      placeholder: placeholderFor(current.kind, index),
      value: block.text,
      oninput: (e) => { block.text = e.target.value; autoGrow(e.target); rememberCaret(e.target, index); changed(); },
      onfocus: (e) => rememberCaret(e.target, index),
      onkeyup: (e) => rememberCaret(e.target, index),
      onclick: (e) => rememberCaret(e.target, index),
    });
    return ta;
  }

  function rememberCaret(ta, index) {
    lastFocus = { index, caret: ta.selectionStart ?? ta.value.length };
  }

  function photoBlock(block, index) {
    const caption = h('input', {
      class: 'caption-input', type: 'text', placeholder: 'Write a caption…', value: block.caption || '', maxlength: 200,
      oninput: (e) => { block.caption = e.target.value; changed(); },
    });
    const date = h('input', {
      class: 'caption-date', type: 'date', value: block.date || '',
      oninput: (e) => { block.date = e.target.value; changed(); },
    });
    const tilt = ((index * 7919) % 5) - 2; // a small, stable tilt for each photo
    return h('figure', { class: 'polaroid', style: { '--tilt': `${tilt * 0.6}deg` } },
      h('div', { class: 'polaroid-tools' },
        h('button', { class: 'mini-btn', 'aria-label': 'Move up', onclick: () => movePhoto(index, -1) }, icon('up')),
        h('button', { class: 'mini-btn', 'aria-label': 'Move down', onclick: () => movePhoto(index, 1) }, icon('down')),
        h('button', { class: 'mini-btn', 'aria-label': 'Remove photo', onclick: () => removePhoto(index) }, icon('close')),
      ),
      h('span', { class: 'tape tape-left' }), h('span', { class: 'tape tape-right' }),
      h('div', { class: 'polaroid-img' }, photoImg(block.photoId, 'full', 'vintage')),
      h('figcaption', {}, caption, date),
    );
  }

  // Joins text blocks that end up next to each other.
  function mergeTexts() {
    const merged = [];
    for (const b of current.blocks) {
      const prev = merged[merged.length - 1];
      if (b.type === 'text' && prev?.type === 'text') {
        prev.text = [prev.text.replace(/\s+$/, ''), b.text.replace(/^\s+/, '')].filter(Boolean).join('\n\n');
      } else merged.push(b);
    }
    if (merged[merged.length - 1]?.type !== 'text') merged.push({ type: 'text', text: '' });
    if (merged[0]?.type !== 'text') merged.unshift({ type: 'text', text: '' });
    current.blocks = merged;
  }

  function movePhoto(index, dir) {
    // Find the next photo position in that direction (skip over text).
    const blocks = current.blocks;
    let target = index + dir;
    while (target >= 0 && target < blocks.length && blocks[target].type !== 'photo' && blocks[target].text.trim() === '') target += dir;
    if (target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    mergeTexts();
    renderBlocks();
    changed();
  }

  async function removePhoto(index) {
    const ok = await ask({ title: 'Remove this photo?', message: 'It will be removed from this page.', ok: 'Remove', danger: true });
    if (!ok) return;
    current.blocks.splice(index, 1);
    mergeTexts();
    renderBlocks();
    changed();
  }

  // ----- add photos -----
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length) return;
    setStatus('Adding photos…');

    const newBlocks = [];
    for (const file of files) {
      try {
        const photoId = await addPhotoFromFile(file);
        newBlocks.push({ type: 'photo', photoId, caption: '', date: current.date });
      } catch {
        toast('One photo couldn’t be added.');
      }
    }
    if (!newBlocks.length) return;

    // Insert at the cursor: split that text block in two.
    let { index, caret } = lastFocus || { index: current.blocks.length - 1, caret: Infinity };
    if (current.blocks[index]?.type !== 'text') { index = current.blocks.length - 1; caret = Infinity; }
    const block = current.blocks[index];
    const before = block.text.slice(0, caret).replace(/\s+$/, '');
    const after = block.text.slice(caret).replace(/^\s+/, '');
    current.blocks.splice(index, 1,
      { type: 'text', text: before },
      ...newBlocks,
      { type: 'text', text: after });
    // Remove empty text blocks in the middle, keep one at the start and end.
    current.blocks = current.blocks.filter((b, i, arr) => b.type !== 'text' || b.text || i === 0 || i === arr.length - 1);
    mergeTexts();
    renderBlocks();
    await saveCurrent();
    // Put the cursor in the text right after the new photos.
    const lastPhotoIndex = current.blocks.findIndex((b) => b === newBlocks[newBlocks.length - 1]);
    const nextText = blocksEl.children[lastPhotoIndex + 1];
    if (nextText?.tagName === 'TEXTAREA') {
      lastFocus = { index: lastPhotoIndex + 1, caret: 0 };
      nextText.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  const addPhotoBtn = h('button', {
    class: 'tool-btn',
    onclick: () => pickFiles(fileInput), // opens the photo picker without locking the diary
  }, icon('camera'), 'Add photo');

  // ----- collections -----
  const chips = h('div', { class: 'chips' });
  function renderChips() {
    chips.replaceChildren(
      ...collections.map((c) => h('button', {
        class: `chip ${current.collections.includes(c.id) ? 'on' : ''}`,
        onclick: () => {
          current.collections = current.collections.includes(c.id)
            ? current.collections.filter((x) => x !== c.id)
            : [...current.collections, c.id];
          renderChips();
          changed();
        },
      }, c.name)),
      h('button', {
        class: 'chip chip-add',
        onclick: async () => {
          const name = await ask({ title: 'New collection', input: '', placeholder: 'e.g. Summer 2026', ok: 'Create' });
          if (!name) return;
          const c = { id: uid(), name, createdAt: Date.now() };
          await db.saveCollection(c);
          collections.push(c);
          current.collections.push(c.id);
          renderChips();
          changed();
        },
      }, '+ New'),
    );
  }
  renderChips();

  // ----- timeline toggle -----
  const milestoneToggle = h('label', { class: 'switch-row' },
    h('span', {}, h('strong', {}, 'Important date'), h('br'), h('small', { class: 'muted' }, 'Show this page on your timeline')),
    h('input', { type: 'checkbox', class: 'switch', checked: !!current.milestone, onchange: (e) => { current.milestone = e.target.checked; changed(); } }),
  );

  // ----- delete -----
  const deleteBtn = h('button', {
    class: 'danger-link',
    onclick: async () => {
      const ok = await ask({ title: 'Delete this page?', message: 'This can’t be undone.', ok: 'Delete', danger: true });
      if (!ok) return;
      saveSoon.cancel();
      await db.deleteEntry(current.id);
      current = null;
      await cleanUpUnusedPhotos();
      toast('Page deleted');
      onDone({ deleted: true });
    },
  }, icon('trash'), 'Delete page');

  renderBlocks();

  root.replaceChildren(
    topbar,
    h('main', { class: 'content editor' },
      h('article', { class: `paper page kind-${current.kind}` },
        meta,
        titleInput,
        moodRow,
        promptBox,
        blocksEl,
        h('div', { class: 'page-tools' }, addPhotoBtn, fileInput),
      ),
      h('section', { class: 'editor-extras' },
        h('h3', { class: 'small-heading' }, 'Collections'),
        chips,
        milestoneToggle,
        deleteBtn,
      ),
    ),
  );

  requestAnimationFrame(() => {
    autoGrow(titleInput);
    blocksEl.querySelectorAll('textarea').forEach(autoGrow);
    // New page: start writing right away.
    if (!id) {
      const first = blocksEl.querySelector('textarea');
      if (current.kind === 'letter' && first) {
        first.focus();
        first.setSelectionRange(first.value.length, first.value.length);
      } else {
        titleInput.focus();
      }
    }
  });
}
