// main.js — app entry. Composes the modules, connects MPD, mounts the router.

import { mpd } from "./mpd.js";
import { register, start as startRouter } from "./router.js";
import { initPlayer } from "./player.js";
import { initSearch } from "./search.js";
import { initShortcuts } from "./shortcuts.js";

import * as nowPlaying from "./views/now-playing.js";
import * as queue      from "./views/queue.js";
import * as library    from "./views/library.js";
import * as playlists  from "./views/playlists.js";
import * as artists    from "./views/artists.js";
import * as albums     from "./views/albums.js";
import * as files      from "./views/files.js";

document.addEventListener("DOMContentLoaded", () => {
  // Register all views with the router.
  register({ name: "now-playing", title: "Now Playing", mount: nowPlaying.mount, unmount: nowPlaying.unmount });
  register({ name: "queue",        title: "Queue",        mount: queue.mount,      unmount: queue.unmount });
  register({ name: "library",      title: "Library",      mount: library.mount,    unmount: library.unmount });
  register({ name: "playlists",    title: "Playlists",    mount: playlists.mount,  unmount: playlists.unmount });
  register({ name: "artists",      title: "Artists",      mount: artists.mount,    unmount: artists.unmount });
  register({ name: "albums",       title: "Albums",       mount: albums.mount,     unmount: albums.unmount });
  register({ name: "files",        title: "Files",        mount: files.mount,      unmount: files.unmount });

  // Player + global UI before any state arrives.
  initPlayer();
  initSearch();
  initShortcuts();

  // Connect to the MPD bridge.
  mpd.connect();

  // Start the router. Initial route falls back to #now-playing.
  startRouter();
});
