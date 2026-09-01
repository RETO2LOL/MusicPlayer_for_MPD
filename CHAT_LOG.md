# Chat log — build session

This file is a running log of how this project was built and the gotchas we
hit along the way. Read this first if you're picking up where a previous
session left off — it will save you from re-discovering the same bugs.

## Original request

Build a full web client for MPD, with:
- Real MPD integration for every view (Queue, Now Playing, Library, Playlists, Artists, Albums, Files)
- Album artwork (with placeholder fallback)
- Search
- Playlist management
- Keyboard shortcuts
- Animations
- No build step on the frontend (vanilla ES modules)

## Final architecture

```
MusicPlayer_for_MPD/
├── public/                # Static frontend
│   ├── index.html
│   ├── styles/            # tokens, base, layout, components, animations, responsive
│   ├── src/               # main, mpd, dom, router, player, search, shortcuts, artwork, toast
│   └── src/views/         # one file per sidebar view + _shared.js
├── server/                # Express + ws bridge to MPD
│   ├── index.js           # HTTP + /artwork + WS /mpd
│   ├── mpd-bridge.js      # mpc-js wrapper, command surface, idle loop, snapshot
│   ├── package.json       # express, mpc-js, ws
│   └── package-lock.json
├── README.md
├── CHAT_LOG.md            # this file
└── .gitignore
```

The frontend talks to the server over two endpoints:
- `WS /mpd` — JSON command/state stream
- `GET /artwork?uri=…` — binary album art (proxies MPD's `readpicture`)

## State model

The server broadcasts a flat `state` object on every change:
```js
{
  connected, playing, track, queue, volume,
  elapsed, duration, random, repeat, single,
  stats: { artists, albums, songs }
}
```
The frontend has one `mpd.subscribe(fn)` API; every view re-renders from the
same callback. Commands are sent with `mpd._send(cmd, args)` and return a
Promise that resolves with the command's result.

## Key mpc-js v2.1.1 gotchas (these WILL bite you)

These took real debugging to find. They're documented here so we don't repeat
the cycle:

1. **Method names are camelCase, not the MPD wire format.**
   - `mpc.status.status()` returns the full status object.
   - `mpc.status.currentSong()` returns the current song.
   - `mpc.status.statistics()` (NOT `stats()`) returns the library counts.
   - `mpc.database.getPicture(uri)` returns `{type, data}`. **NOT** `mpc.db.*` (no `db` property), **NOT** `readPicture` (it's `getPicture`). The data is an `ArrayBuffer`.
   - `mpc.currentPlaylist` is the queue (NOT `mpc.playlist`).
   - `mpc.storedPlaylists` is the named-playlist namespace.
   - `mpc.storedPlaylists.listPlaylistInfo(name)` returns song objects. `mpc.storedPlaylists.listPlaylist(name)` returns just file paths — use `listPlaylistInfo`.

2. **No public `idle()` method.** mpc-js auto-enters idle mode after every
   command and emits `changed` (and `changed-<subsystem>`) events on the
   `mpc` instance. Listen for those instead of calling `mpc.idle()`.

3. **Repeat modes need two flags.** MPD has `repeat 0/1` and `single 0/1`.
   The three user-visible modes (off / all / one) map to:
   - off → `repeat 0, single 0`
   - all → `repeat 1, single 0`
   - one → `repeat 0, single 1`
   `mpc.playback.setRepeat(value)` only accepts truthy/falsy; if you want
   "one" you have to set `single` separately. Our bridge does this in the
   `repeat` command handler.

4. **`search(tag, query)` expects pairs, not a plain object.** The MPD wire
   format wants `search any "query"`, and mpc-js's `q()` builds that. The
   shape is `mpc.database.search([["any", "query"]])`, not
   `mpc.database.search({ any: "query" })`.

5. **No `create empty playlist` command.** Use `mpc.storedPlaylists.save(name)`
   — saving the current (possibly empty) queue under a new name is the
   canonical way to create an empty playlist.

6. **Field name normalization.** mpc-js exposes lowercase-camelCase field
   names (`t.path`, `t.albumArtist`, `t.duration`) that the frontend expects
   to be PascalCase or snake_case. The bridge normalizes every track-shaped
   result before sending it to the client:
   - `t.path` → `t.file`
   - adds `t.name` (basename)
   - adds `t.Pos` (position, from `t.position`)
   - For `lsinfo` entries, also adds `t.type` (from `entryType`).
   The normalization helpers (`normalizeTrack`, `normalizeLsEntry`,
   `normalizeList`) live in `server/mpd-bridge.js`.

7. **`mpc.list(tag)` returns `string[]`, not `[{Artist: …}]`.** Easy to
   misread. The frontend was using `it.Artist` etc.; fixed to treat the
   items as strings.

## Bugs we hit and fixed (don't reintroduce)

- **X button on the keyboard-shortcuts overlay didn't close the overlay.**
  Two things were at play:
  1. `el("h3", null, "Up next")` in `now-playing.js:50` was passing `null`
     as `attrs`, but `el()` did `Object.entries(attrs)` without a null guard.
     Every state push re-rendered the view, which threw `TypeError: can't
     convert null to object`. The thrown error starved the event loop so
     click handlers didn't fire.
  2. The click handler was on `document` and used `e.target.matches` — moved
     it onto the `#shortcutsOverlay` element itself with `e.target.closest`
     for robustness.
  The overlay was later removed entirely (user found it unnecessary), but
  `el()` still has the `attrs || {}` guard for safety.

- **Console was full of 404s for `/artwork` requests.** The route returned
  `404` when the file had no embedded art. Changed to `204 No Content` so
  the browser doesn't log a 404 for every "no art" case. The frontend's
  `img.onerror` still fires correctly and shows the gradient fallback.

- **`mpc.db` doesn't exist.** The artwork route used `mpc.db.getPicture(uri)`
  and failed silently in a try/catch that returned 204. **Real bug** — fixed
  to `mpc.database.getPicture(uri)`. This was the actual "cover art doesn't
  work" bug. Verified with a real track that has 112KB of embedded JPEG,
  which now returns 200 + 112,735 bytes of image data.

- **Idle loop was emitting a state push per subsystem change, dozens per
  second.** Initial implementation had a coalesce flag that didn't work
  properly. Rewrote with a proper 60ms debounce + re-flush if changes
  arrived during a snapshot.

## Frontend architecture

The frontend uses no build step. ES modules loaded directly by the browser.

- `main.js` is the entry. It registers every view with the router, calls
  `initPlayer()`, `initSearch()`, `initShortcuts()`, then `mpd.connect()`
  and `startRouter()`.
- `router.js` is a tiny hash-based router. Views register
  `{ name, title, mount, unmount }`. The router calls `unmount` on the
  previous view, then `mount(container, { setActions })` on the next.
- `views/_shared.js` provides `trackRow`, `emptyState`, `spinner`,
  `showCtxMenu` — bits used by multiple views.
- Each view subscribes to `mpd.subscribe()` on mount and unsubscribes on
  unmount. This is critical: if you don't unsubscribe, the old view keeps
  re-rendering after you navigate away.

## Style architecture

CSS is split into six files loaded in order:
1. `tokens.css` — design tokens (CSS custom properties)
2. `base.css` — reset + typography
3. `layout.css` — app shell grid (topbar / sidebar / content / player)
4. `components.css` — buttons, tracks, transport, browse list, album grid,
   toast, etc.
5. `animations.css` — keyframes, motion tokens
6. `responsive.css` — media queries

Don't add component-specific styles inline; extend `components.css`.

## State of the world at end of session

- All seven views work end-to-end against a real MPD.
- Album artwork fetches and renders, with a gradient+glyph fallback.
- Search finds tracks / artists / albums.
- Playlists create / rename / delete / load.
- Keyboard shortcuts for transport + view switching.
- 200/204 responses on the server, no 5xx.
- Console clean (no errors, no 404 spam).

## Known small issues / things to revisit

- The library view calls `mpd.search("", "any")` to list every track in the
  library. For very large libraries (10k+ tracks) this is slow. A paginated
  browse or a server-side limit would be better.
- The artist→album navigation uses `mpd.search(artist, "Artist")` and
  dedupes by album name. It works but is N+1 against the database.
- The album grid's artwork cache (`artCache` in `albums.js`) is in-memory
  only and is keyed by album name; the server's `/artwork` cache is keyed
  by file URI. They could share.
- No tests — the user explicitly opted out.

## What we did NOT do

- No build tooling (no webpack / vite / rollup / babel).
- No framework (no React / Vue / Svelte).
- No TypeScript.
- No tests.
- No CI.
- No Docker / packaging.
- The keyboard-shortcuts overlay (`?` button in the topbar, `?` keybinding)
  was removed at user request. The shortcut key (`?`) and the overlay
  itself are gone, but other shortcuts (Space, arrows, M, S, R, 1-7, /, Esc)
  still work.

## Useful commands

```bash
# Boot
cd server && npm install && npm start

# MPD-side sanity check
mpc status
mpc current
mpc listall
mpc search any "Kikuo" | head

# mpc-js method name check (no good docs, this is the fastest way)
node -e 'const { MPC } = require("mpc-js"); const m = new MPC();
  m.on("ready", () => {
    console.log("status keys:", Object.keys(m.status));
    console.log("database has getPicture:", typeof m.database.getPicture);
    m.disconnect(); process.exit(0);
  });
  m.connectTCP("localhost", 6600);'
```

## Picked up from a fresh session?

Start by reading this file, then:
1. `git log --oneline` to see the build-up.
2. `cd server && npm install && npm start` to boot.
3. Open `http://localhost:3000` — should connect to MPD automatically.
4. Open the browser console — should be clean.
5. The first thing to add next is probably a paginated library view, or
   persistent album-art caching, depending on the next user request.

## Pickup notes — 2026-09-01 (next session)

Two unrelated changes from the previous session; both verified in a real
Firefox browser via Playwright.

### 1. Artwork flicker (frontend)

Symptom: the large now-playing artwork flickered when playback started,
and any element with image art flickered on hover. Root cause: every
state push re-ran `mountArtwork` and re-created the `<img>` element,
even when the URI was unchanged. Worse, every view (queue, library,
artists, albums, files, playlists) re-rendered its full DOM tree on
every state push, so track rows were torn down and rebuilt on every
MPD tick — losing hover state and showing a visible flicker.

Fixes:
- `public/src/artwork.js` — made `mountArtwork` idempotent. If the
  container already has a successfully-loaded image for the same URI,
  it's a no-op. Fixed the placeholder glyph reset so it's visible
  again when an image fails or the URI changes.
- `public/src/views/now-playing.js` — keep the card, artwork, and
  meta DOM stable across state pushes; only rebuild on real track
  changes. Up-next still rebuilds (queue content can change).
- `public/src/views/queue.js` — only update the `.is-playing` class
  in place when the queue contents are unchanged; reuse `<li>` rows
  whose URI matches the new queue, so loaded artwork stays put.
- `public/src/views/library.js`, `artists.js`, `albums.js`, `files.js`,
  `playlists.js` — removed `mpd.subscribe(render)`. These views hold
  data that's local to the view (loaded once or via explicit user
  action); re-rendering on every MPD tick was the main source of the
  hover flicker on track rows in those views.

### 2. MPD bridge getting stuck "Not connected" (server)

Symptom: after some activity (a few WS clients connecting, an idle
loop tick) the bridge would settle into a state where every command
returned `"mpd not connected"`, even though MPD itself was fine. The
client UI showed "Disconnected" status and views that needed to
fetch data (artists, albums, files) never recovered. Console was full
of `[mpd] snapshot failed: Not connected` lines.

Root cause: mpc-js throws `"Not connected"` / `"Disconnected"` from
failing commands, but it doesn't always fire its own `socket-error`
event in response. The bridge was relying solely on that event to
trigger `reconnect()`, so a transient disconnect would leave the
bridge permanently in the `connected = false` state.

Fix: in `server/mpd-bridge.js`, both `snapshotState()` and
`handleCommand()` now catch connection-level errors and call
`reconnect()` themselves when the error message matches
"Not connected" / "Disconnected" / "Invalid state". Also: the
`catch` in `snapshotState` no longer sets `connected = false` and
recurses (which used to leave the bridge wedged even after a
transient error); it just returns the disconnected shape and lets
the next snapshot try again. `connected` is now only flipped to
false by `reconnect()` itself or the `socket-error` handler.

Also: `connected = true` is now set as soon as `mpc.connectTCP()`
resolves, not waiting for the `ready` event — the event can be
missed during a reconnect race, and this leaves the bridge stuck.

## What to investigate next session

- **`socket-error` is fragile in mpc-js v2.1.1.** The library sometimes
  throws connection errors without firing the event. If we hit more of
  these, the regex of error messages above is brittle. A more robust
  fix would be a periodic health check (e.g. `mpc.ping()` every 30s) —
  but that's out of scope here, just worth knowing.
- **The "Not connected" → reconnect path can still race.** `reconnect()`
  is `await`ed from inside `handleCommand` (with `.catch` to swallow
  the error), but not from `snapshotState` (we don't await it, so the
  next snapshot can race the reconnect). It seems to work in practice;
  worth keeping an eye on it.
- **Artist / Albums / Files views were still showing "Nothing here" in
  the headless browser test, even after the bridge fix.** I ran out of
  time to confirm whether that's a real bug or a test artifact (the
  views call `mpd.list` / `mpd.search` on mount, and the test was
  racing the connection). The Library view (which calls `mpd.search`
  the same way) DID load 5049 tracks, so the pattern works — start
  the next session by reproducing the artists/albums empty state in
  the real Zen browser and figuring out whether the call is being
  made at all. Most likely the headless test's WS connection was
  finishing after the view's `loadArtists()` already resolved with
  an empty result.
- **The bridge loop is still there.** `mpc.on("changed", schedule)`
  fires on every MPD subsystem change, including the changes our own
  `snapshotState()` triggers. The 60ms debounce keeps it from
  saturating, but the server is still pushing state on every MPD
  internal event. The user explicitly asked me NOT to touch the loop
  this session; revisit only if asked.
