// editor.js — writing a page.
//
// A page is a list of "blocks": text, photo, text, photo, text…
// When you add a photo, the text block you are in is split at your cursor and the photo goes in between,
// like gluing a picture into the middle of a page.
// Everything saves automatically while you write.

import { db } from './db.js';
import { h, fill, icon, uid, todayISO, nowTime, debounce, isEntryEmpty, entryText, entryPhotos, toast, ask, fmt, pickFiles } from './util.js';
import { KINDS, MOODS, PROMPTS, LETTER_PROMPTS, DETAIL_PROMPTS, randomFrom } from './content.js';
import { addPhotoFromFile, printFigure, cleanUpUnusedPhotos } from './photos.js';

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
  setStatus('Saving…');
  saveSoon();
}

// Text areas grow with your text, like a page that never ends.
function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

function placeholderFor(kind, index) {
  if (index > 0) return 'Continue writing…';
  if (kind === 'letter') return 'Dear …';
  if (kind === 'detail') return 'Something small you remember…';
  if (kind === 'thought') return 'What’s on your mind?';
  if (kind === 'memory') return 'A moment you never want to forget…';
  return 'Begin anywhere…';
}

export async function renderEditor(root, { id, kind, date, collection, milestone, prompt, onDone }) {
  // ----- load or create the page -----
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
    class: `icon-btn ${current.favorite ? 'on' : ''}`,
    'aria-label': 'Favourite',
    'aria-pressed': String(!!current.favorite),
    onclick: () => {
      current.favorite = !current.favorite;
      favBtn.classList.toggle('on', current.favorite);
      favBtn.setAttribute('aria-pressed', String(current.favorite));
      toast(current.favorite ? 'Added to favourites' : 'Removed from favourites');
      changed();
    },
  }, icon('star'));

  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const addPhotos = () => pickFiles(fileInput); // opens the photo picker without locking the journal

  const topbar = h('header', { class: 'bar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Done', onclick: () => onDone() }, icon('back')),
    h('div', { class: 'bar-title' }, h('span', { class: 'save-state', id: 'save-status' }, current._saved ? 'Saved' : kindInfo.one)),
    h('div', { class: 'bar-actions' },
      h('button', { class: 'icon-btn', 'aria-label': 'Add a photograph', onclick: addPhotos }, icon('photo')),
      favBtn,
    ),
  );

  // ----- date & time -----
  const dateLabel = h('span', { class: 'eyebrow' }, fmt.long(current.date));
  const timeLabel = h('span', { class: 'eyebrow muted' }, current.time || 'Add time');
  const meta = h('div', { class: 'ed-meta' },
    h('label', { class: 'ed-date' }, dateLabel,
      h('input', {
        type: 'date', value: current.date, 'aria-label': 'Date',
        oninput: (e) => { current.date = e.target.value || todayISO(); dateLabel.textContent = fmt.long(current.date); changed(); },
      })),
    h('label', { class: 'ed-time' }, timeLabel,
      h('input', {
        type: 'time', value: current.time || '', 'aria-label': 'Time',
        oninput: (e) => { current.time = e.target.value; timeLabel.textContent = current.time || 'Add time'; changed(); },
      })),
  );

  // ----- title -----
  const titleInput = h('textarea', {
    class: 'ed-title',
    rows: 1,
    placeholder: current.kind === 'letter' ? 'A title for this letter' : 'Title',
    value: current.title,
    'aria-label': 'Title',
    oninput: (e) => { current.title = e.target.value.replace(/\n/g, ' '); autoGrow(e.target); changed(); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); blocksEl.querySelector('textarea')?.focus(); } },
  });

  // ----- mood (optional) -----
  const moodRow = h('div', { class: 'moods', role: 'group', 'aria-label': 'Mood' },
    h('span', { class: 'moods-label' }, 'Feeling'),
    MOODS.map((m) => h('button', {
      class: 'mood',
      'aria-pressed': String(current.mood === m.id),
      onclick: (ev) => {
        current.mood = current.mood === m.id ? null : m.id;
        moodRow.querySelectorAll('.mood').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        if (current.mood) ev.currentTarget.setAttribute('aria-pressed', 'true');
        changed();
      },
    }, m.label)),
  );

  // ----- a gentle prompt, only if wanted -----
  const promptList = current.kind === 'letter' ? LETTER_PROMPTS : current.kind === 'detail' ? DETAIL_PROMPTS : PROMPTS;
  let shownPrompt = prompt || null;
  const promptBtn = h('button', { class: 'ed-prompt' });
  function drawPrompt() {
    if (!shownPrompt) {
      promptBtn.className = 'ed-prompt';
      promptBtn.replaceChildren('A prompt, if you’d like one');
    } else {
      promptBtn.className = 'ed-prompt shown';
      promptBtn.replaceChildren(shownPrompt, h('span', { class: 'ed-prompt-again' }, 'Another prompt'));
    }
  }
  promptBtn.addEventListener('click', () => { shownPrompt = randomFrom(promptList, shownPrompt); drawPrompt(); });
  drawPrompt();

  // ----- the page itself: text and photographs -----
  function renderBlocks() {
    let photoCount = 0;
    blocksEl.replaceChildren(...current.blocks.map((block, index) => (block.type === 'photo'
      ? photoBlock(block, index, photoCount++ % 2 === 1)
      : textBlock(block, index))));
    blocksEl.querySelectorAll('textarea').forEach(autoGrow);
  }

  function rememberCaret(ta, index) {
    lastFocus = { index, caret: ta.selectionStart ?? ta.value.length };
  }

  function textBlock(block, index) {
    return h('textarea', {
      class: 'ed-text',
      placeholder: placeholderFor(current.kind, index),
      value: block.text,
      'aria-label': 'Text',
      oninput: (e) => { block.text = e.target.value; autoGrow(e.target); rememberCaret(e.target, index); changed(); },
      onfocus: (e) => rememberCaret(e.target, index),
      onkeyup: (e) => rememberCaret(e.target, index),
      onclick: (e) => rememberCaret(e.target, index),
      onblur: (e) => rememberCaret(e.target, index),
    });
  }

  function photoBlock(block, index, alt) {
    const caption = h('figcaption', {},
      h('input', {
        class: 'caption-input', type: 'text', placeholder: 'Add a caption', value: block.caption || '', maxlength: 200, 'aria-label': 'Caption',
        oninput: (e) => { block.caption = e.target.value; changed(); },
      }),
      photoDate(block),
    );
    const { figure } = printFigure(block.photoId, { alt, caption });
    figure.append(h('div', { class: 'print-tools' },
      h('button', { onclick: () => movePhoto(index, -1), disabled: moveTarget(index, -1) < 0 }, 'Move up'),
      h('button', { onclick: () => movePhoto(index, 1), disabled: moveTarget(index, 1) < 0 }, 'Move down'),
      h('button', { class: 'remove', onclick: () => removePhoto(index) }, 'Remove'),
    ));
    return figure;
  }

  // The photo's date as quiet text; tapping it opens the iPhone date picker.
  function photoDate(block) {
    const label = h('span', { class: 'caption-date' }, block.date ? fmt.medium(block.date) : 'Add a date');
    return h('label', { class: 'photo-date' }, label,
      h('input', {
        type: 'date', value: block.date || '', 'aria-label': 'Date of the photograph',
        oninput: (e) => { block.date = e.target.value; label.textContent = block.date ? fmt.medium(block.date) : 'Add a date'; changed(); },
      }));
  }

  // Joins text blocks that end up next to each other; keeps a text block at the start and end.
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

  // Where a photo would move to: past the next paragraph or photo (empty text is skipped). -1 = can't move.
  function moveTarget(index, dir) {
    const blocks = current.blocks;
    let target = index + dir;
    while (target >= 0 && target < blocks.length && blocks[target].type === 'text' && blocks[target].text.trim() === '') target += dir;
    return target >= 0 && target < blocks.length ? target : -1;
  }

  function movePhoto(index, dir) {
    const blocks = current.blocks;
    const target = moveTarget(index, dir);
    if (target < 0) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    mergeTexts();
    renderBlocks();
    changed();
  }

  async function removePhoto(index) {
    const ok = await ask({ title: 'Remove this photograph?', message: 'It will be taken out of this page.', ok: 'Remove', danger: true });
    if (!ok) return;
    current.blocks.splice(index, 1);
    mergeTexts();
    renderBlocks();
    changed();
  }

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length) return;
    setStatus('Adding photographs…');

    const newBlocks = [];
    for (const file of files) {
      try {
        const photoId = await addPhotoFromFile(file);
        newBlocks.push({ type: 'photo', photoId, caption: '', date: current.date });
      } catch {
        toast('One photograph couldn’t be added');
      }
    }
    if (!newBlocks.length) { setStatus(current._saved ? 'Saved' : ''); return; }

    // Insert where the cursor was: split that paragraph in two and place the photos in between.
    let { index, caret } = lastFocus || { index: current.blocks.length - 1, caret: Infinity };
    if (current.blocks[index]?.type !== 'text') { index = current.blocks.length - 1; caret = Infinity; }
    const block = current.blocks[index];
    const before = block.text.slice(0, caret).replace(/\s+$/, '');
    const after = block.text.slice(caret).replace(/^\s+/, '');
    current.blocks.splice(index, 1, { type: 'text', text: before }, ...newBlocks, { type: 'text', text: after });
    current.blocks = current.blocks.filter((b, i, arr) => b.type !== 'text' || b.text || i === 0 || i === arr.length - 1);
    mergeTexts();
    renderBlocks();
    await saveCurrent();

    const lastPhotoIndex = current.blocks.indexOf(newBlocks[newBlocks.length - 1]);
    lastFocus = { index: lastPhotoIndex + 1, caret: 0 };
    blocksEl.children[lastPhotoIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  // ----- collections -----
  const tags = h('div', { class: 'tags' });
  function renderTags() {
    tags.replaceChildren(
      ...collections.map((c) => h('button', {
        class: 'tag',
        'aria-pressed': String(current.collections.includes(c.id)),
        onclick: () => {
          current.collections = current.collections.includes(c.id)
            ? current.collections.filter((x) => x !== c.id)
            : [...current.collections, c.id];
          renderTags();
          changed();
        },
      }, c.name)),
      h('button', {
        class: 'tag add',
        onclick: async () => {
          const name = await ask({ title: 'New collection', input: '', placeholder: 'e.g. Summer 2026', ok: 'Create' });
          if (!name) return;
          const c = { id: uid(), name, createdAt: Date.now() };
          await db.saveCollection(c);
          collections.push(c);
          current.collections.push(c.id);
          renderTags();
          changed();
        },
      }, '+ New collection'),
    );
  }
  renderTags();

  const deleteBtn = h('button', {
    class: 'danger-btn',
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
  }, 'Delete this page');

  renderBlocks();

  fill(root, 
    topbar,
    h('main', { class: `screen editor enter kind-${current.kind}` },
      meta,
      titleInput,
      moodRow,
      promptBtn,
      h('hr', { class: 'short-rule' }),
      blocksEl,
      h('button', { class: 'ed-add', onclick: addPhotos }, icon('photo'), 'Add a photograph'),
      fileInput,
      h('section', { class: 'ed-extras' },
        h('div', { class: 'ed-section' }, h('h2', { class: 'eyebrow' }, 'Collections'), tags),
        h('div', { class: 'ed-section' },
          h('label', { class: 'toggle-row' },
            h('span', {}, h('strong', {}, 'Important date'), h('small', {}, 'Show this page on your timeline')),
            h('input', { type: 'checkbox', class: 'switch', checked: !!current.milestone, onchange: (e) => { current.milestone = e.target.checked; changed(); } }),
          ),
        ),
        deleteBtn,
      ),
    ),
  );

  requestAnimationFrame(() => {
    autoGrow(titleInput);
    blocksEl.querySelectorAll('textarea').forEach(autoGrow);
    if (!id) {
      const first = blocksEl.querySelector('textarea');
      if ((current.kind === 'letter' || current.kind === 'thought' || current.kind === 'detail') && first) {
        first.focus();
        first.setSelectionRange(first.value.length, first.value.length);
      } else {
        titleInput.focus();
      }
    }
  });
}
