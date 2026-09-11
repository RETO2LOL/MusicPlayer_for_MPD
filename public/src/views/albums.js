// views/albums.js — grid of album cards, drill-down to tracks.

import { watchConnection, el, trackRow, emptyState, spinner, mpd, toast, mountArtwork } from "./_shared.js";

let unsub = null;
let request = 0;
let container = null;
let level = "albums"; // "albums" | "tracks"
let current = null;
let data = [];
let loading = true;
let artObserver = null;

async function loadAlbums() {
  const token = ++request;
  level = "albums";
  current = null;
  loading = true; render();
  try { const result = await mpd.list("Album"); if (token !== request) return; data = result.filter(Boolean); }
  catch (err) { if (token !== request) return; toast(err.message, "error"); data = []; }
  loading = false; render();
}

async function loadTracks(album) {
  const token = ++request;
  current = album;
  level = "tracks";
  loading = true; render();
  try { const result = await mpd.find([["Album", album]]); if (token !== request) return; data = result; }
  catch (err) { if (token !== request) return; toast(err.message, "error"); data = []; }
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
  artObserver?.disconnect();
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
    artObserver = new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const slot = entry.target;
        observer.unobserve(slot);
        if (!slot.isConnected) continue;
        fetchAlbumArt(slot.dataset.album).then((uri) => {
          if (uri && slot.isConnected) mountArtwork(slot, { uri, size: 200 });
        });
      }
    }, { root: container, rootMargin: "120px" });
    const grid = el("div", { class: "album-grid" },
      ...data.map((albumName) => {
        const card = el("button", { class: "album-card", type: "button", onClick: () => loadTracks(albumName) },
          el("div", { class: "album-art" }),
          el("div", { class: "album-name" }, albumName),
        );
        const slot = card.querySelector(".album-art");
        mountArtwork(slot);
        slot.dataset.album = albumName;
        artObserver.observe(slot);
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
        mpd.playTracks(data, i)
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
    const results = await mpd.find([["Album", album]]);
    const uri = results[0]?.file || null;
    artCache.set(album, uri);
    return uri;
  } catch {
    return null;
  }
}

export function mount(root, { setActions, value }) {
  container = root;
  unsub = watchConnection(() => value ? loadTracks(value) : loadAlbums(), () => {
    request++;
    container?.replaceChildren(el("div", { class: "loading" }, spinner(), el("span", { class: "muted" }, "Waiting for MPD…")));
  });
}

export function unmount() {
  artObserver?.disconnect();
  artObserver = null;
  request++;
  unsub?.();
  unsub = null;
  container = null;
}
