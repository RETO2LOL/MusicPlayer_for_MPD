// views/albums.js — grid of album cards, drill-down to tracks.

import { el, trackRow, emptyState, spinner, mpd, toast, mountArtwork } from "./_shared.js";

let unsub = null;
let container = null;
let level = "albums"; // "albums" | "tracks"
let current = null;
let data = [];
let loading = true;

async function loadAlbums() {
  level = "albums";
  current = null;
  loading = true; render();
  try { data = await mpd.list("Album"); }
  catch (err) { toast(err.message, "error"); data = []; }
  loading = false; render();
}

async function loadTracks(album) {
  current = album;
  level = "tracks";
  loading = true; render();
  try { data = await mpd.search(album, "Album"); }
  catch (err) { toast(err.message, "error"); data = []; }
  loading = false; render();
}

function breadcrumb() {
  return el("nav", { class: "crumbs" },
    el("a", { href: "#", onClick: (e) => { e.preventDefault(); loadAlbums(); } }, "Albums"),
    current ? el("span", { class: "crumb-sep" }, "›") : null,
    current ? el("span", { class: "crumb-current" }, current) : null,
  );
}

function render() {
  if (!container) return;
  if (loading) {
    container.replaceChildren(breadcrumb(),
      el("div", { class: "loading" }, spinner(), el("div", { class: "muted" }, "Loading…")));
    return;
  }
  if (!data.length) {
    container.replaceChildren(breadcrumb(), emptyState({ title: "Nothing here" }));
    return;
  }

  if (level === "albums") {
    const grid = el("div", { class: "album-grid" },
      ...data.map((albumName) => {
        const card = el("div", { class: "album-card", onClick: () => loadTracks(albumName) },
          el("div", { class: "album-art" }),
          el("div", { class: "album-name" }, albumName),
        );
        // Lazy-load artwork once the card is on screen — pick a file from
        // this album and use it for cover art.
        const slot = card.querySelector(".album-art");
        fetchAlbumArt(albumName).then((uri) => {
          if (uri) mountArtwork(slot, { uri, size: 200 });
        });
        return card;
      }),
    );
    container.replaceChildren(breadcrumb(), grid);
    return;
  }

  // Tracks
  const list = el("ol", { class: "track-list" },
    ...data.map((t, i) => {
      const row = trackRow(t, i, { playing: false });
      row.addEventListener("click", () => {
        mpd.clear()
          .then(() => Promise.all(data.map((tr) => mpd.add(tr.file))))
          .then(() => mpd.playAt(i))
          .catch((e) => toast(e.message, "error"));
      });
      return row;
    }),
  );
  container.replaceChildren(breadcrumb(), list);
}

// Cache { albumName → uri } so we don't search the DB for every card.
const artCache = new Map();
async function fetchAlbumArt(album) {
  if (artCache.has(album)) return artCache.get(album);
  try {
    const results = await mpd.search(album, "Album");
    const uri = results[0]?.file || null;
    artCache.set(album, uri);
    return uri;
  } catch {
    return null;
  }
}

function onSearchFocus(e) {
  if (e.detail?.kind !== "albums") return;
  loadTracks(e.detail.value);
}

export async function mount(root) {
  container = root;
  window.addEventListener("search:focus", onSearchFocus);
  // Wait for the WS to open before issuing the first command.
  try { await mpd.whenReady(); } catch { /* see artists.js for rationale */ }
  if (!container) return;
  loadAlbums();
  // Data is local to this view — re-rendering on every MPD state push
  // would tear down the album grid's <img> elements and flicker on hover.
}

export function unmount() {
  unsub?.();
  unsub = null;
  container = null;
  window.removeEventListener("search:focus", onSearchFocus);
}
