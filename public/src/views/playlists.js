// views/playlists.js — saved playlists, plus create / save-current / rename / delete.

import { el, trackRow, emptyState, spinner, mpd, toast, showCtxMenu } from "./_shared.js";

let unsub = null;
let container = null;
let playlists = [];
let openName = null;
let openTracks = [];
let loading = true;
let detailLoading = false;

async function loadList() {
  loading = true; render();
  try { playlists = await mpd.listPlaylists(); }
  catch (err) { toast(err.message, "error"); playlists = []; }
  loading = false; render();
}

async function openPlaylist(name) {
  openName = name;
  detailLoading = true; render();
  try { openTracks = await mpd.listPlaylist(name); }
  catch (err) { toast(err.message, "error"); openTracks = []; }
  detailLoading = false; render();
}

function askName(title, def = "") {
  // Modal-ish prompt using a single text input. The browser's `prompt` is
  // fine for a desktop client, but a themed modal would be nicer — keep it
  // simple for now.
  const v = window.prompt(title, def);
  return v && v.trim() ? v.trim() : null;
}

function actions(setActions) {
  setActions(
    el("button", {
      class: "btn btn-ghost",
      type: "button",
      onClick: async () => {
        const name = askName("New playlist name");
        if (!name) return;
        try { await mpd.createPlaylist(name); toast(`Created "${name}"`, "ok"); loadList(); }
        catch (e) { toast(e.message, "error"); }
      },
    }, "New"),
    el("button", {
      class: "btn btn-primary",
      type: "button",
      onClick: async () => {
        const name = askName("Save current queue as…");
        if (!name) return;
        try { await mpd.savePlaylist(name); toast(`Saved as "${name}"`, "ok"); loadList(); }
        catch (e) { toast(e.message, "error"); }
      },
    }, "Save queue"),
  );
}

function breadcrumb() {
  return el("nav", { class: "crumbs" },
    el("a", { href: "#", onClick: (e) => { e.preventDefault(); openName = null; render(); } }, "Playlists"),
    openName ? el("span", { class: "crumb-sep" }, "›") : null,
    openName ? el("span", { class: "crumb-current" }, openName) : null,
  );
}

function render() {
  if (!container) return;
  if (loading) {
    container.replaceChildren(breadcrumb(),
      el("div", { class: "loading" }, spinner(), el("div", { class: "muted" }, "Loading…")));
    return;
  }

  if (openName) {
    if (detailLoading) {
      container.replaceChildren(breadcrumb(),
        el("div", { class: "loading" }, spinner(), el("div", { class: "muted" }, "Loading…")));
      return;
    }
    const list = el("ol", { class: "track-list" },
      ...openTracks.map((t, i) => {
        const row = trackRow(t, i, { playing: false });
        row.addEventListener("click", () => mpd.loadPlaylist(openName).then(() => mpd.playAt(i)).catch((e) => toast(e.message, "error")));
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showCtxMenu(e.clientX, e.clientY, [
            { label: "Remove from playlist", onClick: () => mpd.removeFromPlaylist(openName, i).then(() => openPlaylist(openName)) },
          ]);
        });
        return row;
      }),
    );
    container.replaceChildren(breadcrumb(), list);
    return;
  }

  if (!playlists.length) {
    container.replaceChildren(breadcrumb(),
      emptyState({ icon: "♬", title: "No playlists", sub: "Use New or Save queue to create one." }));
    return;
  }

  const list = el("ul", { class: "browse-list" },
    ...playlists.map((p) => {
      const name = p.playlist || p.name;
      return el("li", { class: "browse-row", onClick: () => openPlaylist(name) },
        el("span", { class: "browse-icon" }, "♬"),
        el("div", { class: "browse-meta" },
          el("div", { class: "browse-title" }, name),
          el("div", { class: "browse-sub muted" }, "Playlist"),
        ),
        el("div", { class: "browse-actions" },
          el("button", {
            class: "btn btn-ghost btn-icon",
            type: "button",
            title: "Play",
            onClick: (e) => { e.stopPropagation(); mpd.loadPlaylist(name).then(() => mpd.playAt(0)).catch((err) => toast(err.message, "error")); },
          }, "▶"),
          el("button", {
            class: "btn btn-ghost btn-icon",
            type: "button",
            title: "Rename",
            onClick: (e) => {
              e.stopPropagation();
              const newName = askName("Rename playlist to…", name);
              if (!newName || newName === name) return;
              mpd.renamePlaylist(name, newName).then(() => loadList()).catch((err) => toast(err.message, "error"));
            },
          }, "✎"),
          el("button", {
            class: "btn btn-ghost btn-icon",
            type: "button",
            title: "Delete",
            onClick: (e) => {
              e.stopPropagation();
              if (!confirm(`Delete playlist "${name}"?`)) return;
              mpd.deletePlaylist(name).then(() => loadList()).catch((err) => toast(err.message, "error"));
            },
          }, "🗑"),
        ),
      );
    }),
  );
  container.replaceChildren(breadcrumb(), list);
}

export function mount(root, { setActions }) {
  container = root;
  actions(setActions);
  loadList();
  unsub = mpd.subscribe(render);
}

export function unmount() {
  unsub?.();
  unsub = null;
  container = null;
  openName = null;
  openTracks = [];
  loading = true;
}
