// toast.js — small, dependency-free notification stack.
//
//   toast("Saved!")                    → info (default)
//   toast("Couldn't connect", "error")
//   toast("Rescan started", "ok", 4000)
//
// Each toast animates in, sits for `duration` ms, then animates out.

import { el, $ } from "./dom.js";

const ICONS = { info: "ⓘ", ok: "✓", error: "✕" };

export function toast(message, kind = "info", duration = 3000) {
  const stack = $("#toasts");
  if (!stack) return;

  const node = el("div", { class: `toast toast-${kind}` },
    el("span", { class: "toast-icon" }, ICONS[kind] || "ⓘ"),
    el("span", { class: "toast-msg" }, message),
    el("button", { class: "toast-close", type: "button", "aria-label": "Dismiss" }, "×"),
  );

  const remove = () => {
    node.classList.add("is-leaving");
    node.addEventListener("animationend", () => node.remove(), { once: true });
  };

  node.querySelector(".toast-close").addEventListener("click", remove);
  stack.appendChild(node);
  if (duration > 0) setTimeout(remove, duration);
}
