# Little Memories

The simplicity of Apple Notes with the feeling of opening your own school notebook. Writing comes first; collections, dates and photographs give it meaning.

**The look comes from real things:** squared notebook paper with a red margin line, titles handwritten in hazel-brown ink, a dark brown hoodie, peach iced tea, and a mountain ridge drawn across the first page. Photographs are taped in.

**Make it yours** (in Settings): your own title, a line under the title, a date that matters (marked at the top of the mountain), and *words that matter*: nicknames, phrases, places. They are scribbled across the first page between small pen drawings and a spiral of your photographs, and the page writes itself in when you open the journal. All of this is saved only on your device, never in this code.

**The opening.** After the PIN, the journal opens with your words writing themselves in, a few of your photographs landing on the page and one line from one of your notes, different each time (tap to skip, or turn it off in Settings). The lock screen itself shows your words, drawings and the mountain, but never photographs, and the words can be hidden there with a switch.

**Your journal lives only on your phone.** This repository contains just the empty app (the code). None of your notes, photos or names are ever stored here or sent anywhere.

## What it can do

- **Write immediately.** Tap *New note* (or the pen in the bottom bar) and start typing. No templates, no forms. Notes save by themselves.
- **Simple formatting.** Headings, bold, lists and checklists from a small toolbar above the keyboard.
- **Photographs inside notes.** Placed where your cursor is, between paragraphs, with an optional caption and date. Your original photos are kept untouched: no filters, no cropping.
- **Honest dates.** A memory can be dated exactly, "around then", or "I don't know when", optionally in your own words. Undated notes gather under *Sometime*.
- **Places and songs.** Add where it happened (with a map link) and a song that belongs to it; both are searchable.
- **Pin** important notes, **sort** by last edited or date created, **delete** from the note's "…" menu.
- **Memories.** Collections are meaningful words you tap, like *The little things* or *Unspoken words*. Create, rename, describe, reorder and delete them, and choose a cover photograph. A note can be in several collections, or in none.
- **Photographs.** One gallery of every picture; open one to see its note and collections.
- **Search** titles, the words inside notes, collection names and photo captions, with an optional month filter.
- **Private.** Locked with a PIN or Face ID, and it locks every time you leave the app.
- **Backups.** Export everything (notes + original photos) as one `.zip` file and restore it on any phone.
- **Dark by default** (the notebook under a desk lamp), with Light or "Follow my device" in Settings, and **offline** use.

**On a computer** (install it from Chrome or Edge via the install icon in the address bar) the journal shows three panes like Apple Notes on a Mac: sidebar with your collections, the list of notes, and the note you are writing. On large screens the note's details (collections, when, where, song) sit beside it, and the first page becomes a double page. Shortcuts: `Alt+N` new note, `Ctrl+K` search, `Ctrl+B` bold, `Ctrl+Shift+L` lock. Notes are stored separately on each device; move them with *Export backup* / *Restore from a backup*.

Four places at the bottom (on the phone): **Home**, **Notes**, **Memories**, **Search**, with *new note* always in the middle.

## Putting it on your iPhone

The app has to be online once (over HTTPS) so your iPhone can install it. After that it works offline.

### Step 1: Put the app online (free, about 2 minutes)

**Option A: GitHub Pages (easiest).** The repository has to be **public** for this (or you need GitHub Pro). That's okay, because the code contains nothing personal: your diary is never in here.

1. On GitHub, open this repository → **Settings** → **General** → scroll down to **Danger Zone** → **Change visibility** → **Public**.
2. Go to **Settings** → **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose the branch with the app (e.g. `main`, or `claude/focused-meitner-9r8kb0`) and the folder **`/ (root)`**, then click **Save**.
5. After a minute, GitHub shows your link, e.g. `https://<your-username>.github.io/mydiary/`.

**Option B: keep the repository private.** Use a free host that can read private repositories, such as Cloudflare Pages or Netlify. Connect your GitHub, pick this repository, leave the build command empty and set the output folder to `/`.

### Step 2: Install it

1. Open your link in **Safari** on your iPhone.
2. Tap the **Share** button (the square with the arrow), then **Add to Home Screen**.
3. Give it any name you like (for example `28.09`, `September` or `Home`) and tap **Add**.
4. Open it from your Home Screen, choose your PIN, and start writing.

> Always open the diary from the **Home Screen icon**, not in Safari. The Home Screen app has its own storage, separate from Safari.

## Keeping your memories safe

- Everything is saved **only on this iPhone**. If you delete the app from your Home Screen, clear Safari's website data or lose your phone, the diary is gone.
- So go to **Settings → Export backup** every week or two and choose **Save to Files → iCloud Drive**. The app reminds you when it's been a while.
- To move to a new phone: install the app there and use **Settings → Restore from backup**.
- There's **no way to recover a forgotten PIN**. If that happens, you can reinstall the app and restore your latest backup.

## Making changes yourself

There's no build step and no framework, just HTML, CSS and JavaScript. To try it on your computer:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

| File | What's in it |
| --- | --- |
| `index.html` | The page skeleton, the bottom bar and the lock screen |
| `css/styles.css` | The whole design system: colours at the top (`--walnut`, `--caramel`, `--gold`, `--paper`, …), then type, layout and every screen |
| `js/content.js` | **The easiest place to start:** the collections a new journal begins with |
| `js/app.js` | Starts the app and decides which screen to show |
| `js/views.js` | The screens: Home, Notes, Memories, a collection, Photographs, Search, Settings |
| `js/editor.js` | Writing a note: formatting, checklists, photographs, autosave |
| `js/drawings.js` | The hand-drawn parts: the mountain ridge, pen doodles, your words scribbled on a page |
| `js/notes.js` | What a note is, cleaning its HTML, and upgrading notes from older versions |
| `js/db.js` | Saving on the phone with IndexedDB (think of it as a small database with tables) |
| `js/photos.js` | Saving photos and making small preview copies |
| `js/lock.js` | PIN and Face ID |
| `js/backup.js` | Export and import of the `.zip` backup |
| `sw.js` | The service worker that makes the app work offline |

After you change something, bump the version in `sw.js` (e.g. `little-memories-v3` → `v4`) so your phone picks up the new version. Close and reopen the app once or twice to see it.

## Fonts

Reenie Beanie (handwritten titles), Kalam (small handwritten labels and captions) and Hanken Grotesk (the text you write and read), all under the SIL Open Font License (see `fonts/`).

**Using your own handwriting:** write the alphabet on a template from a free tool such as calligraphr.com, export it as a font, convert it to `.woff2`, put it in `fonts/` and change the first `src` line in `css/fonts.css`.
