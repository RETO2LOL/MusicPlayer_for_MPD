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
