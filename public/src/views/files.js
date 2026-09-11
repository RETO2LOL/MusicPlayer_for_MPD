// views/files.js — directory tree from MPD's lsinfo.

import { watchConnection, el, emptyState, spinner, mpd, toast, fmtTime, showCtxMenu, mountArtwork } from "./_shared.js";

import { icon } from "../icons.js";

let unsub = null;
let request = 0;
let container = null;
let path = "/";
let entries = [];
let loading = true;

async function load(p) {
  const token = ++request;
  path = p;
  loading = true; render();
  try { const result = await mpd.lsinfo(p); if (token !== request) return; entries = result; }
  catch (err) { if (token !== request) return; toast(err.message, "error"); entries = []; }
  loading = false; render();
}

function breadcrumb() {
  const parts = path.split("/").filter(Boolean);
  const crumbs = [el("a", { href: "#", onClick: (e) => { e.preventDefault(); load("/"); } }, "Files")];
  let acc = "";
  for (const p of parts) {
    acc += (acc ? "/" : "") + p;
    crumbs.push(el("span", { class: "crumb-sep" }, "›"));
    crumbs.push(el("a", { href: "#", onClick: ((to) => (e) => { e.preventDefault(); load(to); })(acc) }, p));
  }
  return el("nav", { class: "crumbs" }, ...crumbs);
}

function render() {
  if (!container) return;
  if (loading) {
    container.replaceChildren(breadcrumb(),
      el("div", { class: "loading" }, spinner(), el("div", { class: "muted" }, "Loading…")));
    return;
  }
  if (!entries.length) {
    container.replaceChildren(breadcrumb(), emptyState({ title: "Empty directory" }));
    return;
  }

  const dirs = entries.filter((e) => e.type === "directory");
  const files = entries.filter((e) => e.type !== "directory" || !e.type); // mpd lsinfo: no "type" for files

  const dirList = el("ul", { class: "browse-list" },
    ...dirs.map((d) =>
      el("li", { class: "browse-row", onClick: () => load(d.file || d.path || d.name) },
        el("span", { class: "browse-icon" }, icon("files")),
        el("div", { class: "browse-meta" }, el("div", { class: "browse-title" }, d.name || d.path?.split("/").pop())),
        el("span", { class: "browse-chevron muted" }, "›"),
      ),
    ),
  );

  const fileList = el("ul", { class: "browse-list" },
    ...files.map((f) => {
      const uri = f.file || f.name;
      const title = f.Title || f.title || (f.file ? f.file.split("/").pop() : f.name);
      const dur = f.duration || Number(f.Time) || 0;
      const artSlot = el("div", { class: "track-art" });
      if (f.file) mountArtwork(artSlot, { uri: f.file, size: 40 });
      const row = el("li", { class: "browse-row", onClick: () => (f.type === "playlist" ? mpd.loadPlaylist(uri) : mpd.add(uri)).then(() => toast("Added to queue", "ok")).catch((e) => toast(e.message, "error")) },
        artSlot,
        el("div", { class: "browse-meta" },
          el("div", { class: "browse-title" }, title),
          el("div", { class: "browse-sub muted" }, f.artist || ""),
        ),
        dur ? el("span", { class: "browse-time muted" }, fmtTime(dur)) : null,
      );
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, [
          { label: "Add to queue", onClick: () => (f.type === "playlist" ? mpd.loadPlaylist(uri) : mpd.add(uri)).then(() => toast("Added to queue", "ok")) },
          { label: "Play now",     onClick: () => (f.type === "playlist" ? mpd.loadPlaylist(uri) : mpd.add(uri)).then(() => mpd.playlist()).then((q) => mpd.playAt(q.length - 1)) },
        ]);
      });
      return row;
    }),
  );

  container.replaceChildren(breadcrumb(), dirList, fileList);
}

export function mount(root, { setActions, value }) {
  container = root;
  unsub = watchConnection(() => load(path), () => {
    request++;
    container?.replaceChildren(el("div", { class: "loading" }, spinner(), el("span", { class: "muted" }, "Waiting for MPD…")));
  });
}

export function unmount() {
  request++;
  unsub?.();
  unsub = null;
  container = null;
}
