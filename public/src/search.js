// search.js — global search box with debounced results.
//
// The search input is shared across views; typing into it shows a dropdown
// of grouped results (Tracks / Artists / Albums). Selecting a result either
// plays it (tracks) or navigates to the appropriate view (artists/albums).
//
// Keyboard:
//   /        → focus the search box
//   ↑/↓      → move selection
//   Enter    → activate the selected result
//   Esc      → clear / blur

import { $, el, debounce, truncate, fmtTime } from "./dom.js";
import { mpd } from "./mpd.js";
import { navigate } from "./router.js";
import { toast } from "./toast.js";

let active = -1;
let lastResults = null;
let lastQuery = "";
let installed = false;

function isTextInput(node) {
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
}

function groupResults(tracks, artists, albums) {
  return [
    { label: "Tracks",  items: tracks.slice(0, 8) },
    { label: "Artists", items: artists.slice(0, 5) },
    { label: "Albums",  items: albums.slice(0, 5) },
  ].filter((g) => g.items.length > 0);
}

function renderResults(panel, groups) {
  if (!groups.length || !lastQuery) {
    panel.hidden = true;
    panel.replaceChildren();
    return;
  }
  active = -1;
  const rows = [];
  let absoluteIndex = 0;
  for (const group of groups) {
    rows.push(el("li", { class: "search-group" }, group.label));
    for (const item of group.items) {
      const kind = group.label.toLowerCase(); // tracks | artists | albums
      const row = el("li", {
        class: "search-item",
        dataset: { kind, index: String(absoluteIndex) },
        onMouseenter: () => setActive(panel, absoluteIndex),
        onClick:      () => activate(panel, kind, item),
      },
        el("span", { class: "search-item-kind" }, kind[0].toUpperCase()),
        el("div", { class: "search-item-meta" },
          el("div", { class: "search-item-title" },
            kind === "tracks"  ? (item.title || item.file?.split("/").pop() || "?") :
            kind === "artists" ? item :
            item),
          el("div", { class: "search-item-sub muted" },
            kind === "tracks"
              ? `${item.artist || "?"} — ${item.album || "?"}`
              : kind === "artists" ? "Artist" : "Album"),
        ),
        kind === "tracks" && (item.duration || item.Time)
          ? el("span", { class: "search-item-time muted" }, fmtTime(item.duration || item.Time))
          : null,
      );
      rows.push(row);
      absoluteIndex++;
    }
  }
  panel.replaceChildren(...rows);
  panel.hidden = false;
}

function setActive(panel, idx) {
  if (active >= 0) {
    const prev = panel.querySelector(`[data-index="${active}"]`);
    prev?.classList.remove("is-active");
  }
  active = idx;
  if (active < 0) return;
  const cur = panel.querySelector(`[data-index="${active}"]`);
  cur?.classList.add("is-active");
  cur?.scrollIntoView({ block: "nearest" });
}

function activate(panel, kind, item) {
  panel.hidden = true;
  const input = $("#searchInput");
  if (input) input.value = "";
  lastQuery = "";
  if (kind === "tracks") {
    mpd.add(item.file).then(() => {
      // Play the last queued track.
      mpd.playlist().then((q) => {
        const pos = q.length - 1;
        mpd.playAt(pos).catch((e) => toast(e.message, "error"));
      });
    }).catch((e) => toast(e.message, "error"));
  } else if (kind === "artists") {
    navigate("artists");
    // Pre-filter via a custom event the artists view can listen for.
    window.dispatchEvent(new CustomEvent("search:focus", { detail: { kind, value: item } }));
  } else if (kind === "albums") {
    navigate("albums");
    window.dispatchEvent(new CustomEvent("search:focus", { detail: { kind, value: item } }));
  }
}

function moveActive(panel, delta) {
  if (!lastResults || panel.hidden) return;
  const total = lastResults.reduce((n, g) => n + g.items.length, 0);
  if (total === 0) return;
  const next = (active + delta + total) % total;
  setActive(panel, next);
}

function activateCurrent(panel) {
  if (active < 0 || !lastResults) return;
  let idx = active;
  for (const group of lastResults) {
    if (idx < group.items.length) return activate(panel, group.label.toLowerCase(), group.items[idx]);
    idx -= group.items.length;
  }
}

const runSearch = debounce(async (q) => {
  const panel = $("#searchResults");
  if (!panel) return;
  if (!q || q.length < 2) {
    panel.hidden = true;
    panel.replaceChildren();
    lastResults = null;
    return;
  }
  const qLower = q.toLowerCase();
  try {
    // mpc-js's `list(tag, filter)` is exact-match; for typeahead we want
    // case-insensitive substring, so we fetch the full lists and filter
    // client-side. Caches the lists so we don't refetch on every keystroke.
    const [tracks, allArtists, allAlbums] = await Promise.all([
      mpd.search(q, "any").catch(() => []),
      allArtistsCache || mpd.list("Artist").then((r) => (allArtistsCache = r, r)).catch(() => []),
      allAlbumsCache  || mpd.list("Album").then((r)  => (allAlbumsCache = r, r)).catch(() => []),
    ]);
    const artists = allArtists.filter((name) => String(name).toLowerCase().includes(qLower));
    const albums  = allAlbums.filter((name)  => String(name).toLowerCase().includes(qLower));
    lastResults = groupResults(tracks, artists, albums);
    renderResults(panel, lastResults);
  } catch (err) {
    toast(err.message, "error");
  }
}, 220);

let allArtistsCache = null;
let allAlbumsCache  = null;

// Invalidate caches when the database changes (server pushes no "db changed"
// event today, so we just re-fetch on next mount / on a 5-minute interval).
setInterval(() => { allArtistsCache = null; allAlbumsCache = null; }, 5 * 60 * 1000);

export function initSearch() {
  if (installed) return;
  installed = true;

  const input  = $("#searchInput");
  const panel  = $("#searchResults");
  const wrap   = $("#searchWrap");
  if (!input || !panel || !wrap) return;

  input.addEventListener("input", () => {
    lastQuery = input.value.trim();
    runSearch(lastQuery);
  });

  input.addEventListener("focus", () => {
    if (lastResults) panel.hidden = false;
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveActive(panel, 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(panel, -1); }
    else if (e.key === "Enter")  { e.preventDefault(); activateCurrent(panel); }
    else if (e.key === "Escape") {
      input.value = "";
      lastQuery = "";
      panel.hidden = true;
      input.blur();
    }
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) {
      panel.hidden = true;
    }
  });

  // Global "/" focuses search (unless already in a text field).
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !isTextInput(document.activeElement) && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}
