# Little Memories

A private diary app for iPhone. It feels like an old journal: warm paper, leather browns and gold, photos glued between your words.

**Your diary lives only on your phone.** This repository contains just the empty app (the code). None of your entries, photos or names are ever stored here or sent anywhere.

## What it can do

- **Write freely.** Unlimited pages per day, each with a title, date, time and as much text as you want. It saves automatically while you write.
- **Photos like a scrapbook.** Add pictures exactly where your cursor is, between paragraphs, with a caption and a date. They get a soft vintage look, but the original photo stays untouched.
- **Moods and prompts.** An optional mood for each page, and gentle writing prompts that are only there if you want them.
- **Chapters:** Today's thoughts, Journal, Letters (that you may never send), Memories, Little details, Timeline, Collections, Gallery and Favourites.
- **Browse like a book.** A contents page, a calendar, and a reader where you swipe to turn the pages.
- **Search** by words, titles, dates (e.g. `28.09`), moods or collections.
- **Private.** Locked with a PIN or Face ID, and it locks every time you leave the app.
- **Backups.** Export everything (pages + original photos) as one `.zip` file and save it in iCloud Drive. You can restore it on any phone.
- **Warm dark mode** that follows your iPhone setting.
- **Works offline.**

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
| `index.html` | The page skeleton and the lock screen |
| `css/styles.css` | All colours, fonts and layout. The colours are at the top (`--brown`, `--gold`, …) |
| `js/content.js` | **The easiest place to start:** moods, writing prompts, starting collections |
| `js/app.js` | Starts the app and decides which screen to show |
| `js/views.js` | All the screens: contents, chapters, reader, calendar, timeline, gallery, settings |
| `js/editor.js` | Writing a page, including gluing photos between paragraphs |
| `js/db.js` | Saving on the phone with IndexedDB (think of it as a small database with tables) |
| `js/photos.js` | Saving photos and making small preview copies |
| `js/lock.js` | PIN and Face ID |
| `js/backup.js` | Export and import of the `.zip` backup |
| `sw.js` | The service worker that makes the app work offline |

After you change something, bump the version in `sw.js` (`little-memories-v1` → `v2`) so your phone picks up the new version. Close and reopen the app once or twice to see it.

## Fonts

Cormorant Garamond, Nunito Sans and Lora, all under the SIL Open Font License (see `fonts/`).
