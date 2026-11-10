// editor.js — writing a note.
//
// The note body is one editable area (like Apple Notes). You just write.
// A small toolbar above the keyboard offers: heading, bold, list, checklist, photograph.
// Photographs are placed where your cursor is, between paragraphs, with an optional caption and date.
// Everything saves by itself a moment after you stop typing.

import { db } from './db.js';
import { h, icon, debounce, toast, ask, sheet, fmt, todayISO, pickFiles, uid } from './util.js';
import { derive, newNote, isNoteEmpty } from './notes.js';
import { addPhotoFromFile, photoImg, cleanUpUnusedPhotos } from './photos.js';

let current = null;       // the note being edited (+ _saved: is it in the database yet?)
let dirty = false;        // has anything changed since the last save?
let bodyEl = null;        // the editable area
let titleEl = null;
let saveSoon = null;
let savedRange = null;    // where the cursor was before the photo picker opened
let cleanup = () => {};

const setStatus = (text) => { const el = document.getElementById('save-status'); if (el) el.textContent = text; };

function changed() {
  dirty = true;
  setStatus('Saving…');
  bodyEl?.classList.toggle('empty', isBodyEmpty());
  saveSoon();
}

const isBodyEmpty = () => !bodyEl.textContent.trim() && !bodyEl.querySelector('figure, li');

// Save now. An empty note is never kept.
export async function saveCurrent() {
  if (!current || !bodyEl) return;
  saveSoon?.cancel();
  if (!dirty) return;
  Object.assign(current, derive(bodyEl), { title: titleEl.value.replace(/\n/g, ' ').trim() });
  if (isNoteEmpty(current)) {
    if (current._saved) { await db.deleteEntry(current.id); current._saved = false; window.dispatchEvent(new CustomEvent('notes-changed', { detail: { id: null } })); }
    setStatus('');
    return;
  }
  current.updatedAt = Date.now();
  const { _saved, ...note } = current;
  await db.saveEntry(note);
  if (!current._saved && location.hash.startsWith('#/new')) {
    history.replaceState(null, '', `#/note/${current.id}`); // the new note now has its own address
  }
  current._saved = true;
  dirty = false;
  setStatus('Saved');
  window.dispatchEvent(new CustomEvent('notes-changed', { detail: { id: current.id } }));
}

export async function closeEditor() {
  if (!current) return;
  await saveCurrent();
  cleanup();
  current = null;
  bodyEl = null;
  await cleanUpUnusedPhotos();
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

// ---------- photographs inside the text ----------
// In the saved note a photo is just <figure data-photo="…">. While editing we fill it with
// the picture, a caption field, a date and a Remove button.
function dressFigure(fig, openPhoto) {
  fig.contentEditable = 'false';
  fig.className = 'print';
  const img = photoImg(fig.dataset.photo, 'full');
  img.addEventListener('load', () => { if (img.naturalHeight > img.naturalWidth * 1.08) fig.classList.add('portrait'); });
  img.addEventListener('click', () => openPhoto({ ...current, ...derive(bodyEl) }, fig.dataset.photo));

  const dateText = h('span', { class: 'caption-date' }, fig.dataset.date ? fmt.medium(fig.dataset.date) : 'Add a date');
  fig.replaceChildren(
    h('div', { class: 'print-frame' }, img),
    h('figcaption', {},
      h('input', {
        class: 'caption-input', type: 'text', placeholder: 'Add a caption', value: fig.dataset.caption || '', maxlength: 200, 'aria-label': 'Caption',
        oninput: (e) => { fig.dataset.caption = e.target.value; changed(); },
      }),
      h('div', { class: 'print-tools' },
        h('label', { class: 'photo-date' }, dateText,
          h('input', {
            type: 'date', value: fig.dataset.date || '', 'aria-label': 'Date of the photograph',
            oninput: (e) => { fig.dataset.date = e.target.value; dateText.textContent = e.target.value ? fmt.medium(e.target.value) : 'Add a date'; changed(); },
          })),
        h('button', {
          class: 'remove',
          onclick: async () => {
            if (!await ask({ title: 'Remove this photograph?', message: 'It will be taken out of this note.', ok: 'Remove', danger: true })) return;
            fig.remove();
            ensureWritable();
            changed();
          },
        }, 'Remove'),
      ),
    ),
  );
}

// There must always be a line to type on at the very end.
function ensureWritable() {
  const last = bodyEl.lastElementChild;
  if (!last || last.tagName === 'FIGURE') bodyEl.append(h('p', {}, h('br')));
}

// ---------- formatting ----------
function closestInBody(selector) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const node = sel.anchorNode?.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode?.parentElement;
  const found = node?.closest(selector);
  return found && bodyEl.contains(found) ? found : null;
}

function run(command, value = null) {
  bodyEl.focus();
  document.execCommand(command, false, value);
  changed();
}

// Browsers glue a new list onto a list right above it. If that list is of the other kind
// (bullets vs. checklist), move the current line into its own list.
function ownList(wantChecklist) {
  const li = closestInBody('li');
  const ul = li?.parentElement;
  if (!ul) return;
  if (ul.children.length > 1 && ul.classList.contains('checklist') !== wantChecklist) {
    const fresh = document.createElement('ul');
    const moving = [];
    for (let n = li; n; n = n.nextElementSibling) moving.push(n);
    ul.after(fresh);
    fresh.append(...moving);
    if (wantChecklist) fresh.className = 'checklist'; else moving.forEach((m) => m.removeAttribute('data-checked'));
    const range = document.createRange();
    range.selectNodeContents(li);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    ul.classList.toggle('checklist', wantChecklist);
    if (!wantChecklist) ul.querySelectorAll('li').forEach((x) => x.removeAttribute('data-checked'));
  }
}

const format = {
  heading() { run('formatBlock', closestInBody('h2') ? 'p' : 'h2'); },
  bold() { run('bold'); },
  list() {
    const ul = closestInBody('ul');
    if (ul?.classList.contains('checklist')) { ownList(false); changed(); return; } // checklist → bullets
    run('insertUnorderedList');
    if (!ul) { ownList(false); changed(); }
  },
  checklist() {
    const ul = closestInBody('ul');
    if (ul?.classList.contains('checklist')) { run('insertUnorderedList'); return; } // checklist → plain text
    if (!ul) run('insertUnorderedList');
    ownList(true);
    changed();
  },
};

// ---------- the screen ----------
export async function renderEditor(root, { id, collection, onDone, openPhoto }) {
  if (id) {
    const stored = await db.getEntry(id);
    if (!stored) { onDone(); return; }
    current = { ...stored, _saved: true };
  } else {
    current = newNote(collection ? { collections: [collection] } : {});
  }
  dirty = false;
  saveSoon = debounce(saveCurrent, 600);
  savedRange = null;

  // ----- title and body -----
  titleEl = h('textarea', {
    class: 'note-title', rows: 1, placeholder: 'Title', value: current.title, 'aria-label': 'Title',
    oninput: (e) => { autoGrow(e.target); changed(); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); bodyEl.focus(); } },
  });

  bodyEl = h('div', {
    class: 'note-body', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Note',
    'data-placeholder': 'Start writing…', spellcheck: true,
  });
  bodyEl.innerHTML = derive(current.html).html || '<p><br></p>'; // derive() cleans the HTML first
  bodyEl.querySelectorAll('figure[data-photo]').forEach((f) => dressFigure(f, openPhoto));
  ensureWritable();
  bodyEl.classList.toggle('empty', isBodyEmpty());

  bodyEl.addEventListener('input', (e) => {
    if (!bodyEl.firstElementChild) bodyEl.innerHTML = '<p><br></p>';
    // a new checklist line should start unticked
    if (e.inputType === 'insertParagraph') closestInBody('li[data-checked]')?.removeAttribute('data-checked');
    changed();
  });
  // paste as plain text, so no foreign styling sneaks in
  bodyEl.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
  });
  // tap the box of a checklist line to tick it
  bodyEl.addEventListener('click', (e) => {
    const li = e.target.closest?.('ul.checklist > li');
    if (!li || e.clientX - li.getBoundingClientRect().left > 30) return;
    e.preventDefault();
    if (li.dataset.checked === 'true') li.removeAttribute('data-checked'); else li.dataset.checked = 'true';
    changed();
  });
  const rememberRange = () => {
    const sel = window.getSelection();
    if (sel.rangeCount && bodyEl?.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  };
  document.addEventListener('selectionchange', rememberRange);

  // ----- adding photographs -----
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length) return;
    setStatus('Adding…');
    const figures = [];
    for (const file of files) {
      try {
        const fig = document.createElement('figure');
        fig.dataset.photo = await addPhotoFromFile(file);
        dressFigure(fig, openPhoto);
        figures.push(fig);
      } catch { toast('One photograph couldn’t be added'); }
    }
    if (!figures.length || !bodyEl) return;

    // Find the paragraph the cursor was in and place the photos there.
    let block = savedRange && bodyEl.contains(savedRange.startContainer) ? savedRange.startContainer : null;
    while (block && block !== bodyEl && block.parentNode !== bodyEl) block = block.parentNode;
    if (block && block !== bodyEl) {
      let rest = null;
      if (['P', 'H2', 'H3'].includes(block.tagName) && block.lastChild) {
        // split the paragraph at the cursor: the words after it continue below the photo
        const tail = document.createRange();
        tail.setStart(savedRange.startContainer, savedRange.startOffset);
        tail.setEndAfter(block.lastChild);
        const after = tail.extractContents();
        if (after.textContent.trim()) { rest = document.createElement('p'); rest.append(after); }
      }
      block.after(...figures, ...(rest ? [rest] : []));
      if (!block.textContent.trim() && !block.querySelector('figure') && block.tagName !== 'UL') block.remove();
    } else {
      const last = bodyEl.lastElementChild;
      if (last && !last.textContent.trim() && last.tagName === 'P') last.before(...figures); else bodyEl.append(...figures);
    }
    ensureWritable();
    savedRange = null;
    changed();
    await saveCurrent();
    figures[figures.length - 1].scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  const addPhotos = () => pickFiles(fileInput);

  // ----- "more" sheet: pin, date, collections, delete -----
  const moreBtn = h('button', { class: 'icon-btn', 'aria-label': 'More', onclick: openMore }, icon('more'));
  const pinMark = h('span', { class: 'pin-mark', hidden: !current.pinned }, icon('pin'));

  async function openMore() {
    const collections = (await db.allCollections()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    sheet('This note', (close) => {
      const pinRow = h('button', { class: 'set-row' });
      const drawPin = () => { pinRow.replaceChildren(h('span', {}, current.pinned ? 'Unpin from the top' : 'Pin to the top'), icon('pin')); };
      pinRow.addEventListener('click', () => { current.pinned = !current.pinned; pinMark.hidden = !current.pinned; drawPin(); changed(); });
      drawPin();

      const dateText = h('span', { class: 'set-value' }, fmt.medium(todayISO(new Date(current.createdAt))));
      const dateRow = h('label', { class: 'set-row has-input' }, h('span', {}, 'Date'), dateText,
        h('input', {
          type: 'date', value: todayISO(new Date(current.createdAt)), 'aria-label': 'Date of this note',
          oninput: (e) => {
            if (!e.target.value) return;
            const [y, m, d] = e.target.value.split('-').map(Number);
            const old = new Date(current.createdAt);
            current.createdAt = new Date(y, m - 1, d, old.getHours(), old.getMinutes()).getTime();
            dateText.textContent = fmt.medium(e.target.value);
            dateLine.textContent = fmt.long(e.target.value);
            changed();
          },
        }));

      const tags = h('div', { class: 'tags' });
      const drawTags = () => tags.replaceChildren(
        ...collections.map((c) => h('button', {
          class: 'tag', 'aria-pressed': String(current.collections.includes(c.id)),
          onclick: () => {
            current.collections = current.collections.includes(c.id) ? current.collections.filter((x) => x !== c.id) : [...current.collections, c.id];
            drawTags(); changed();
          },
        }, c.name)),
        h('button', {
          class: 'tag add',
          onclick: async () => {
            const name = await ask({ title: 'New collection', input: '', placeholder: 'A word that means something', ok: 'Create' });
            if (!name) return;
            const c = { id: uid(), name, description: '', order: collections.length, createdAt: Date.now() };
            await db.saveCollection(c);
            collections.push(c);
            current.collections.push(c.id);
            drawTags(); changed();
          },
        }, '+ New collection'),
      );
      drawTags();

      return [
        h('div', { class: 'set-list' }, pinRow, dateRow),
        h('h4', { class: 'eyebrow sheet-label' }, 'Collections'),
        tags,
        h('button', {
          class: 'danger-btn',
          onclick: async () => {
            if (!await ask({ title: 'Delete this note?', message: 'This can’t be undone.', ok: 'Delete', danger: true })) return;
            close();
            saveSoon.cancel();
            if (current._saved) await db.deleteEntry(current.id);
            cleanup();
            current = null; bodyEl = null;
            await cleanUpUnusedPhotos();
            toast('Note deleted');
            onDone();
          },
        }, 'Delete note'),
      ];
    });
  }

  // ----- toolbar (stays just above the keyboard) -----
  const tool = (name, label, action) => h('button', {
    class: 'tool', 'aria-label': label,
    onpointerdown: (e) => e.preventDefault(), // keep the cursor where it is
    onclick: action,
  }, icon(name));
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    tool('heading', 'Heading', format.heading),
    tool('bold', 'Bold', format.bold),
    tool('list', 'List', format.list),
    tool('check', 'Checklist', format.checklist),
    tool('photo', 'Add a photograph', addPhotos),
    h('span', { class: 'toolbar-space' }),
    h('button', { class: 'tool', 'aria-label': 'Hide keyboard', onclick: () => document.activeElement?.blur() }, icon('keyboard')),
  );
  const vv = window.visualViewport;
  const placeToolbar = () => {
    const hidden = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    toolbar.style.transform = `translateY(${-hidden}px)`;
  };
  vv?.addEventListener('resize', placeToolbar);
  vv?.addEventListener('scroll', placeToolbar);
  cleanup = () => {
    vv?.removeEventListener('resize', placeToolbar);
    vv?.removeEventListener('scroll', placeToolbar);
    document.removeEventListener('selectionchange', rememberRange);
    cleanup = () => {};
  };

  const dateLine = h('div', { class: 'eyebrow note-date' }, fmt.long(todayISO(new Date(current.createdAt))));

  root.replaceChildren(
    h('header', { class: 'bar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => onDone() }, icon('back')),
      h('div', { class: 'bar-title' }, h('span', { class: 'save-state', id: 'save-status' }, '')),
      h('div', { class: 'bar-actions' }, pinMark, moreBtn),
    ),
    h('main', { class: 'screen editor enter' }, dateLine, titleEl, bodyEl, fileInput),
    toolbar,
  );

  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* not supported everywhere */ }
  requestAnimationFrame(() => {
    autoGrow(titleEl);
    placeToolbar();
    if (!id) bodyEl.focus(); // a new note: start writing right away
  });
}
