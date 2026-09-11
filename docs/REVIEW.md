# v0.2.0 project review — 2026-09-11

Read `CHAT_LOG.md`, the README, all frontend modules and styles, the bridge, and the installed `mpc-js` implementation before making changes.

## Fixed

| Area | Problem and resulting behavior |
| --- | --- |
| Playback | Volume, shuffle, and repeat used nonexistent `mpc.playback` methods. They now use `playbackOptions`. Seeking now uses `seekCur(seconds)`. |
| Repeat | Repeat-one previously stopped after one song and reported the wrong mode. Both repeat and single are now enabled for repeat-one; the UI cycles off → all → one → off. |
| Connections | The browser marked MPD connected as soon as its WebSocket opened, and the status pill could display a fabricated status on click. It now follows confirmed bridge state. Browse views recover automatically after reconnection. |
| Socket failures | Startup/reconnect attempts could hang, and `mpc-js` could crash the server with an unhandled stream rejection during connection reset. A small socket adapter handles end/error events, preserves buffer boundaries, and gives connection attempts a timeout. Startup and recovery share one connection attempt. |
| WebSocket requests | Early commands could arrive before the server registered its handler. Handlers now register immediately. Pending browser requests time out and reject on socket close. Malformed messages and inherited object-property command names are rejected. |
| Artist browsing | Album objects were rendered as names, breaking drill-down. Artist albums now use exact filters; tracks are filtered by both artist and album. |
| Album browsing | Album matching used substring search. Drill-down now uses exact matching. Cover lookup runs as cards approach the visible area. |
| Files | Nested folders lost their parent paths, breadcrumbs added unwanted leading slashes, and durations used an obsolete field. Paths and normalized durations now survive navigation. |
| Playlists | “New” copied the current queue. It now creates an empty saved playlist. Playing a saved playlist replaces the queue and starts the selected index instead of appending it and playing an unrelated queued track. Quoted names are escaped. |
| Queue loading | Clicking a library/album track previously issued a browser request and full state snapshot for every added song. Queue replacement now uses one browser command, preserves track order, and returns one final snapshot. Read-only commands do not broadcast redundant queue snapshots. |
| Search | Search navigation dispatched an event before the destination view mounted. Selection now travels in the URL. Hover selection uses the correct row index, and outdated results cannot overwrite a newer query or reopen after clearing. |
| Artwork | Loading or missing covers could be requested repeatedly on state updates. The same image is reused, stale image callbacks are ignored, and image dimensions follow their container. Missing/invalid images keep a visible fallback. |
| Now Playing | The view could render literal `null`, show a stale play/pause label, and display unresponsive Up next rows. These now update correctly; unchanged artwork and upcoming rows retain their DOM nodes. |
| Navigation and controls | Mobile navigation was blank because CSS hid its only labels. Every view now has a visible icon and an accessible name. Focus states, keyboard row activation, button states, and keyboard/pointer seeking were improved. Seeking sends a command on release rather than every drag pixel. |
| Documentation | Missing screenshot references were replaced with actual desktop and mobile captures. |

Repeat behavior was checked against the [MPD protocol documentation](https://mpd.readthedocs.io/en/stable/protocol.html#playback-options). This corrects the older repeat-one guidance in the chat log.

## Visual changes

Charcoal surfaces, a muted green accent, clearer typography, consistent monochrome icons, quieter borders, more space around artwork, and simpler hover/motion effects. Mobile navigation stays visible above the content; the player stays at the bottom. The library initially renders 200 tracks and offers Show more.

- [Desktop Now Playing](now-playing.png)
- [Albums](albums.png)
- [Mobile Now Playing](mobile.png)

Screenshots use synthetic track metadata and placeholder covers.

## Validation

- JavaScript syntax checks for every frontend and server module; `git diff --check`.
- Firefox via Playwright, using an isolated real MPD with four silent FLAC tracks, three albums, two artists, nested folders, and saved playlists.
- Direct startup into Library; playback, volume, shuffle, all repeat modes, seeking, Up next, exact artist/album browsing, file breadcrumbs, search navigation, playlist creation and selected-track playback, and queue context menus.
- Responsive checks at 320, 390, 600, 768, 860, and 1440 pixels, including horizontal overflow and navigation visibility.
- Invalid WebSocket messages; MPD shutdown/restart; repeated offline connection attempts; automatic recovery of the open view. No browser errors in the main checks.
- Separate checks for startup before MPD is available, a password containing spaces, search hover/clearing, and pending-request rejection on WebSocket closure.
- Embedded artwork: exact binary response, 200 for a valid image, 204 for missing art, successful browser decoding, image-node reuse, and sizing to the artwork container. A malformed test PNG correctly displayed its fallback before the fixture checksum was corrected.

Temporary browser tools, checks, audio fixtures, and MPD configuration stayed in `/tmp`; no test framework or application dependency was added. The existing idle event subscription and 60 ms debounce were preserved.

## Remaining limitations

- Library fetching still retrieves the full database. Incremental rendering reduces DOM work, but server-side pagination and a large-library load check remain future work.
- The Albums view groups by album title. Different artists with identically named albums still appear together there; artist drill-down filters correctly.
- A completed database rescan or playlist edit from another client does not automatically refresh every browse view. Reopening the view reloads it; search artist/album caches expire after five minutes.
- Playback remains controlled through queue positions, so simultaneous changes from another MPD client can race position-based actions.
- Verification used an isolated fixture, not the user's full library or audio device. No persistent automated suite was added, respecting the previous preference recorded in the chat log.
