// shortcuts.js — global keyboard shortcuts.
//
// Bindings (only fire when focus isn't in a text input):
//   Space       toggle play / pause
//   → / ←       next / previous
//   ↑ / ↓       volume up / down
//   M           mute
//   S           toggle shuffle
//   R           cycle repeat (off → all → one)
//   1-7         switch to a sidebar view
//   Esc         close search results
//
// The volume, play, etc. logic lives in player.js — shortcuts.js only
// dispatches the actions.

import { $ } from "./dom.js";
import { mpd } from "./mpd.js";
import { navigate } from "./router.js";
import { toast } from "./toast.js";

const VIEW_KEYS = ["now-playing", "queue", "library", "playlists", "artists", "albums", "files"];

function isTextInput(node) {
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
}

function bumpVolume(delta) {
  const cur = Number(mpd._state.volume || 0);
  mpd.setVolume(Math.max(0, Math.min(100, cur + delta))).catch(() => {});
}

function cycleRepeat() {
  const cur = mpd._state.repeat ?? 0;
  const next = (cur + 1) % 3; // 0 off → 1 all → 2 one → 0
  mpd.setRepeat(next).catch(() => {});
  toast(next === 0 ? "Repeat off" : next === 1 ? "Repeat all" : "Repeat one");
}

function toggleShuffle() {
  const next = !mpd._state.random;
  mpd.setShuffle(next).catch(() => {});
  toast(next ? "Shuffle on" : "Shuffle off");
}

function clearSearch() {
  const input = $("#searchInput");
  const panel = $("#searchResults");
  if (input) input.value = "";
  if (panel) {
    panel.hidden = true;
    panel.replaceChildren();
  }
}

export function initShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Allow typing in inputs and textareas unimpeded.
    if (isTextInput(document.activeElement)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case " ":
        e.preventDefault();
        mpd.toggle().catch((err) => toast(err.message, "error"));
        break;
      case "ArrowRight":
        e.preventDefault();
        mpd.next().catch(() => {});
        break;
      case "ArrowLeft":
        e.preventDefault();
        mpd.previous().catch(() => {});
        break;
      case "ArrowUp":
        e.preventDefault();
        bumpVolume(5);
        break;
      case "ArrowDown":
        e.preventDefault();
        bumpVolume(-5);
        break;
      case "m": case "M":
        e.preventDefault();
        mpd.setVolume(mpd._state.volume > 0 ? 0 : 70).catch(() => {});
        break;
      case "s": case "S":
        e.preventDefault();
        toggleShuffle();
        break;
      case "r": case "R":
        e.preventDefault();
        cycleRepeat();
        break;
      case "1": case "2": case "3": case "4": case "5": case "6": case "7": {
        const i = Number(e.key) - 1;
        if (VIEW_KEYS[i]) navigate(VIEW_KEYS[i]);
        break;
      }
      case "Escape":
        clearSearch();
        break;
    }
  });
}
