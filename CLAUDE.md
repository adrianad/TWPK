# TWPK — project notes

Static site for Twinpeaks [TWPK] game tools, deployed on **GitHub Pages** from `main` / root.
A public landing page (`index.html`) links to several **password-encrypted** panels, each in its
own subdirectory. Zero build server — the encrypted output is committed.

## Layout

```
index.html                     landing page — PUBLIC, committed, hand-edited
background.webm/.mp4/-poster.jpg   hero video + fallback + poster (committed)
build.mjs                      encrypts src/ -> subdir/index.html
.env                           GITIGNORED — PAGECRYPT_PASSWORD=...
src/                           GITIGNORED — plaintext app sources (edit these!)
src/archive/                   GITIGNORED — sources for unpublished/seasonal tools (see below)
resources/index.html           GENERATED + committed — encrypted; auto-redirects to a Google Sheet
mission-helper/index.html      GENERATED + committed — encrypted
clan-tech-planner/index.html   GENERATED + committed — encrypted
warledger/index.html           GENERATED + committed — encrypted
read/index.html                PLAIN + committed — NOT encrypted (see below)
```

### The `resources` panel is a redirect, not an app

`src/resource-sheet.html` is not a tool — it's a themed loading page that immediately
`location.replace()`s to a Google Sheets URL, with a visible fallback link in case the redirect is
blocked. It's encrypted like any other panel for one reason: **the sheet URL itself must not be
public.** `index.html` is served plaintext on GitHub Pages, so a plain `<a href>` there would leak
the URL to anyone who finds the site. Routing it through pagecrypt means the URL only ever exists in
gitignored `src/` and inside the AES-GCM ciphertext — same guarantee as the app panels. To change the
destination sheet, edit the URL in `src/resource-sheet.html`, then `npm run build`.

### Some panels are deliberately unprotected — they bypass `src/` and `build.mjs` entirely

Not every tool needs the access key (e.g. `read/` — an OCR screenshot reader with nothing
sensitive in it). Those are committed as **plain, readable HTML directly under their own
subdirectory** — no `src/` entry, no `build.mjs` entry, no encryption step. Edit
`read/index.html` in place; there is nothing to rebuild.

**The landing-page card for one of these must omit `data-path`.** The click handler targets
`.card[data-path]` specifically and appends `"#" + <session key>"` to the URL for magic-link
auto-decrypt — that's correct for encrypted panels, but appending the access key to an
unprotected page's URL would leak it into the address bar and browser history for a page that
never needed it and can't even use it. A card without `data-path` just follows its plain `href`,
untouched by that logic.

### Archiving a seasonal tool

Some tools (e.g. a tech-race event calculator) are only relevant for part of a season. To retire one
without losing it:
1. `mv src/<name>.html src/archive/<name>.html` — keeps the source on disk (gitignored either way,
   `archive/` just documents intent) so it can be restored in minutes.
2. `git rm -r <name>/` — unpublishes the encrypted panel from the live site.
3. Remove its entry from the `apps` array in `build.mjs` and its card from `index.html`.

To bring it back next season: reverse the move, re-add the `apps` entry and the card, `npm run
build`, commit.

## The golden rule

**Never commit anything from `src/` or `.env`.** The repo is public. Committing a plaintext app
defeats the encryption entirely, and committing `.env` leaks the password. `.gitignore` already
covers both — do not "fix" it by un-ignoring them.

To change an app: edit the file in `src/`, then `npm run build`, then commit the regenerated
`*/index.html`. Never hand-edit the encrypted files — they are overwritten on every build.

## Build

```sh
npm install        # once
npm run build      # reads .env, encrypts all four apps
```

`npm run build` = `node --env-file=.env build.mjs` (Node ≥20.6 reads `.env` natively; no dotenv).
The build **only ever reads** `.env` — it never writes it.

### Password rotation
Manual and deliberate, only when the user asks: edit `PAGECRYPT_PASSWORD` in `.env` by hand,
run `npm run build`, commit the four regenerated files. Nothing automated changes the password.
Keep the password **URL-fragment-safe (alphanumeric)** — see the magic-link note below.

## ⚠️ build.mjs post-processes pagecrypt's output — do not remove this

`build.mjs` does more than call pagecrypt's `encrypt()`. After each file is written it runs
`namespaceSessionKey()`, which rewrites the generated decryptor. **This is load-bearing.** If you
regenerate the files without it, you reintroduce a confusing intermittent bug.

**Why:** pagecrypt caches its derived AES key in `sessionStorage` under the fixed name `"k"`, and
on load it *prefers that cached key over the magic-link password*:

```js
o = sessionStorage.k ? await I(JSON.parse(sessionStorage.k)) : await C(salt, password, iters)
```

`sessionStorage` is shared across all paths on one origin, but every page is encrypted with its own
random salt → its own derived key. So opening panel A caches key A; opening panel B then reuses
key A, fails to decrypt, wipes `k`, and shows the password prompt. Symptom reported by the user:
*"works every second click."*

**Fix:** give each page its own cache slot. `namespaceSessionKey()` rewrites, per output dir:
- `sessionStorage.k` → `sessionStorage.k_<dir>` (boundary-safe regex `/sessionStorage\.k(?![A-Za-z0-9_$])/g`)
- `removeItem("k")` → `removeItem("k_<dir>")`

e.g. `mission-helper/` → `k_mission_helper`. Verify after any build:

```sh
for f in mission-helper clan-tech-planner clantechrace warledger; do
  echo "$f: $(grep -oE 'sessionStorage\.k_[A-Za-z0-9_]+' $f/index.html | sort -u)"
done
```

Each must print a **distinct** name, and no bare `sessionStorage.k` may remain. If pagecrypt is
ever upgraded, re-check that its minified output still uses these exact token shapes.

## Landing page unlock flow

The password must never appear in the committed `index.html`. Instead:
1. Visitor types the access key once → stored in `sessionStorage` under `twpk_access_key`
   (per-tab, cleared on tab close — deliberately not `localStorage`).
2. Clicking a panel card navigates to `panel/#<key>`; pagecrypt reads
   `location.href.split("#")[1]` and auto-decrypts, then strips the hash via `replaceState`.
3. No stored key → the panel shows pagecrypt's own password prompt. Never a lockout.

The fragment is passed **raw, not `encodeURIComponent`'d**, because pagecrypt does not decode it —
hence the alphanumeric-password rule above.

After a password rotation, a stale stored key simply fails into pagecrypt's prompt; the visitor
re-enters the new key. Nothing needs manual resetting.

## Hero video

Source originals live on the user's **Desktop** (`~/Desktop/background-animated.mp4`,
`~/Desktop/background.png`), intentionally *not* in the repo — they are ~2.4 MB and ~2.9 MB.
Committed derivatives total ~1.26 MB.

Recipe used to shrink 2.4 MB → 626 KB (needs `brew install ffmpeg`). Strip audio (`-an`) — it is a
silent background loop and the source carried a useless 128 kbps AAC track:

```sh
# VP9 WebM, two-pass, primary source
ffmpeg -y -i in.mp4 -an -c:v libvpx-vp9 -b:v 0 -crf 44 -row-mt 1 -tile-columns 2 \
  -threads 8 -speed 1 -g 240 -pix_fmt yuv420p -pass 1 -f null /dev/null
ffmpeg -y -i in.mp4 -an -c:v libvpx-vp9 -b:v 0 -crf 44 -row-mt 1 -tile-columns 2 \
  -threads 8 -speed 1 -g 240 -pix_fmt yuv420p -pass 2 background.webm

# H.264 fallback for older Safari/iOS lacking VP9
ffmpeg -y -i in.mp4 -an -c:v libx264 -crf 30 -preset slow -profile:v high \
  -pix_fmt yuv420p -movflags +faststart background.mp4

# Poster (first frame). This ffmpeg build has no libwebp, so JPEG.
ffmpeg -y -i in.mp4 -frames:v 1 -q:v 6 background-poster.jpg

rm -f ffmpeg2pass-0.log   # two-pass leaves this behind in the repo root
```

Pick CRF by measuring, not guessing — check SSIM against the original (>0.97 is visually
transparent, especially behind the hero's dark gradient):

```sh
ffmpeg -i background.webm -i in.mp4 -lavfi "[0:v][1:v]ssim" -f null -
```

For reference: CRF 36 → 1.07 MB, 40 → 832 KB (SSIM 0.975), 44 → 628 KB (SSIM 0.970). Chose 44.

**Responsive behaviour:** desktop crops to a cinematic band (`object-fit:cover`, `max-height:56vh`);
at ≤700px the full uncropped 16:9 frame is shown (`object-fit:contain`). A `prefers-reduced-motion`
rule hides the video and falls back to the static poster.

When swapping in a new video, keep the three filenames so `index.html` needs no edit, and re-check
the aspect ratio if it is not 16:9 (the mobile `aspect-ratio:16/9` rule would need updating).

## Local testing

```sh
python3 -m http.server 8642     # then open http://localhost:8642/
```

Must be served over HTTP — opening `index.html` via `file://` breaks `sessionStorage` scoping and
the relative panel links.

Worth re-testing after any change to the unlock path: enter the key, then click **several different
panels in a row**, plus refresh and browser back/forward. That sequence is what exposed the
`sessionStorage` collision above; a single panel opening correctly proves nothing.

## Favicon

Source art is the user's clan banner image (kept outside the repo, currently
`~/Downloads/Gemini_Generated_Image_*.jpg`). It's a JPEG with a **checkerboard baked into the
pixels** as a stand-in for transparency — JPEG has no alpha channel. A plain colour key fails
because the triskelion and banner rod are near-white/near-grey, same tone family as the checker
squares, so keying by colour punches holes in the logo.

**Correct approach: flood-fill inward from the image border** (4-neighbour BFS over
near-neutral, bright pixels — `max-min <= 46 and max >= 140` — seeded from every border pixel).
This only removes the checkerboard, because it's connected to the border, and stops at the
shield's continuous dark outline, leaving enclosed whites/greys opaque. Feather the resulting
alpha mask with a ~0.6px Gaussian blur to soften JPEG ringing, crop to the opaque bbox, pad to a
square, then downscale with `LANCZOS` per output size.

Generated, committed files: `favicon.ico` (16/32/48/64, transparent — **must be saved from the
full-resolution master**; saving from an already-downscaled frame silently yields only one size),
`favicon-32.png` (transparent), `apple-touch-icon.png` (180×180, composited on the site's navy
`#0a1220` since iOS flattens alpha to black), `icon-512.png` (transparent master, kept for any
future PWA/social use).

### Wiring — every page links its own favicon, no root-relative paths

`index.html` links them with **relative** paths (`favicon.ico`, no leading slash), not
root-relative (`/favicon.ico`). A leading slash resolves against the *origin's* root — under
`http://localhost:8642/` that's the served folder, so it happens to work, but under `file://`
(the user just opens `index.html` from disk) there is no server, so "root" means the filesystem
root and the browser looks for `/favicon.ico` on disk. Relative paths resolve next to the HTML
file under any origin — `file://`, localhost, and the deployed site alike.

The four `src/*.html` panel sources **each carry the same three `<link>` tags too**, with
`../favicon.ico` etc. (one level up, since each panel is served from its own subdirectory). Do
not rely on the browser's `/favicon.ico`-at-domain-root fallback instead — it doesn't apply under
`file://` at all, and even over real HTTP it's a fallback of last resort that pagecrypt's
`document.write()`-based page replacement can interfere with. Because the links live in `src/`,
**changing the favicon requires `npm run build`** to propagate into the encrypted panels, same as
any other source edit.

## Deploy

Commit and push to `main`; GitHub Pages serves from root. `.nojekyll` is present so Jekyll does not
process the files. Live at `https://adrianad.github.io/TWPK/`.
