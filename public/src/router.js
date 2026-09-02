// router.js — minimal hash-based router.
//
// Views register themselves with `register({ name, title, mount, unmount })`.
// The router reads `location.hash`, picks the matching view, calls
// `unmount()` on the previous view, and `mount(container)` on the next one.
//
//   import { register, navigate } from "./router.js";
//   register({ name: "queue", title: "Queue", mount: mountQueue });
//   navigate("artists");
//
// Sidebar <a href="#name"> links and back/forward navigation Just Work.

import { $ } from "./dom.js";

const views = new Map();
let current = null;
let container = null;
let titleEl = null;
let actionsEl = null;

export function register(view) {
  if (!view?.name || typeof view.mount !== "function") {
    throw new Error("router.register: view needs { name, mount }");
  }
  views.set(view.name, view);
}

export function navigate(name, { silent = false } = {}) {
  if (!views.has(name)) return false;
  if (location.hash !== "#" + name) {
    if (silent) {
      _go(name);
    } else {
      location.hash = "#" + name;
    }
    return true;
  }
  _go(name);
  return true;
}

function _go(name) {
  const next = views.get(name);
  if (!next) return;
  if (current?.unmount) {
    try { current.unmount(); } catch (e) { console.error(e); }
  }
  if (titleEl && next.title) titleEl.textContent = next.title;
  if (actionsEl) actionsEl.replaceChildren(); // views can re-fill via setActions()
  // Animate the content area: add .view-enter, remove on animationend.
  if (container) {
    container.classList.remove("view-enter");
    void container.offsetWidth; // reflow to restart animation
    container.classList.add("view-enter");
  }
  current = next;
  try {
    // `mount` may be async (e.g. whenReady) — swallow any rejection so
    // it doesn't surface as an unhandled promise.
    const r = next.mount(container, { setActions });
    if (r && typeof r.catch === "function") r.catch((e) => console.error("view mount failed:", e));
  } catch (e) { console.error("view mount failed:", e); }
}

/** Views call this to put buttons in the content-header actions slot. */
function setActions(...buttons) {
  if (!actionsEl) return;
  actionsEl.replaceChildren(...buttons);
}

function syncActiveLink() {
  const items = document.querySelectorAll(".nav-item");
  items.forEach((a) => {
    a.classList.toggle("is-active", a.getAttribute("href") === "#" + (current?.name || ""));
  });
}

export function start() {
  container = $("#viewBody");
  titleEl   = $("#viewTitle");
  actionsEl = $("#viewActions");
  if (!container) throw new Error("router.start: #viewBody not found");

  // React to hash changes (back/forward, sidebar clicks).
  window.addEventListener("hashchange", () => {
    const name = location.hash.replace(/^#/, "") || "now-playing";
    _go(name);
    syncActiveLink();
  });

  // Initial mount.
  const name = location.hash.replace(/^#/, "") || "now-playing";
  if (!views.has(name)) {
    location.hash = "#now-playing";
  } else {
    _go(name);
  }
  syncActiveLink();
}
