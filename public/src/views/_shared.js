// views/_shared.js — bits shared by every view module.
import { el, fmtTime, truncate } from "../dom.js";
import { mpd } from "../mpd.js";
import { mountArtwork } from "../artwork.js";
import { toast } from "../toast.js";

/** Empty state element used when a view has no data yet. */
export function emptyState({ icon = "♪", title = "Nothing here", sub = "" } = {}) {
  return el("div", { class: "empty-state" },
    el("div", { class: "empty-icon" }, icon),
    el("div", { class: "empty-title" }, title),
    sub ? el("div", { class: "empty-sub muted" }, sub) : null,
  );
}

/** Loading spinner. */
export function spinner() {
  return el("div", { class: "spinner" },
    el("div", { class: "spinner-ring" }),
  );
}

/** Build a single track row. */
export function trackRow(track, index, { playing = false, showArt = false } = {}) {
  const title  = track.title  || track.Title  || track.name || track.file?.split("/").pop() || "(untitled)";
  const artist = track.artist || track.Artist || "";
  const album  = track.album  || track.Album  || "";
  const dur    = track.duration ?? (track.Time ? Number(track.Time) : 0);
  const uri    = track.file || track.uri || "";

  const row = el("li", {
    class: "track" + (playing ? " is-playing" : ""),
    dataset: { index: String(index), uri, title, artist, album },
  });

  if (showArt && uri) {
    const slot = el("div", { class: "track-art" });
    mountArtwork(slot, { uri, size: 40 });
    row.appendChild(slot);
  } else {
    row.appendChild(el("span", { class: "track-index" }, String(index + 1)));
  }

  row.appendChild(
    el("div", { class: "track-meta" },
      el("div", { class: "track-title" }, title),
      el("div", { class: "track-artist" },
        artist && album ? `${artist} — ${album}` : (artist || album || "—")),
    ),
  );
  row.appendChild(el("span", { class: "track-duration" }, fmtTime(dur)));

  // Right-click context menu (queue view adds to it; library view just plays).
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showCtxMenu(e.clientX, e.clientY, [
      { label: "Play now",  onClick: () => { mpd.clear().then(() => addAndPlay(index, track)); } },
      { label: "Add to queue", onClick: () => mpd.add(uri).then(() => toast("Added to queue", "ok")) },
    ]);
  });

  return row;
}

/** Re-export commonly used items for view modules. */
export { el, fmtTime, truncate, mpd, toast, mountArtwork };

/** Helper: add a track and start it. */
function addAndPlay(_index, track) {
  const uri = track.file || track.uri;
  if (!uri) return;
  mpd.add(uri).then(() => mpd.playlist()).then((q) => mpd.playAt(q.length - 1)).catch((e) => toast(e.message, "error"));
}

// ---------- Tiny context menu ----------

let activeMenu = null;

function closeCtxMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
  document.removeEventListener("click", closeCtxMenu);
  document.removeEventListener("keydown", onEsc);
}
function onEsc(e) { if (e.key === "Escape") closeCtxMenu(); }

export function showCtxMenu(x, y, items) {
  closeCtxMenu();
  const menu = el("ul", { class: "ctx-menu", style: { left: x + "px", top: y + "px" } },
    ...items.map((it) =>
      el("li", { class: "ctx-item", onClick: () => { closeCtxMenu(); it.onClick(); } }, it.label),
    ),
  );
  document.body.appendChild(menu);
  activeMenu = menu;
  setTimeout(() => {
    document.addEventListener("click", closeCtxMenu);
    document.addEventListener("keydown", onEsc);
  }, 0);

  // Keep it inside the viewport.
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right  > innerWidth)  menu.style.left = (innerWidth  - r.width  - 8) + "px";
    if (r.bottom > innerHeight) menu.style.top  = (innerHeight - r.height - 8) + "px";
  });
}
