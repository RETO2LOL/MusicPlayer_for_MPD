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

export function navigate(name, { value } = {}) {
  if (!views.has(name)) return false;
  const hash = "#" + name + (value !== undefined ? "?" + new URLSearchParams({ value }) : "");
  if (location.hash === hash) _go(name, value);
  else location.hash = hash;
  return true;
}

function _go(name, value) {
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
  container.replaceChildren();
  container.scrollTop = 0;
  syncActiveLink();
  try {
    // `mount` may be async (e.g. whenReady) — swallow any rejection so
    // it doesn't surface as an unhandled promise.
    const r = next.mount(container, { setActions, value });
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
    if (a.classList.contains("is-active")) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

export function start() {
  container = $("#viewBody");
  titleEl   = $("#viewTitle");
  actionsEl = $("#viewActions");
  if (!container) throw new Error("router.start: #viewBody not found");

  const route = () => {
    const [name = "now-playing", query = ""] = (location.hash.slice(1) || "now-playing").split("?");
    if (!views.has(name)) { location.hash = "#now-playing"; return; }
    _go(name, new URLSearchParams(query).get("value"));
  };
  window.addEventListener("hashchange", route);
  route();
}
