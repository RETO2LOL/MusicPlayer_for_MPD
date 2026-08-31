// artwork.js — central artwork loader with a placeholder fallback.
//
// Used by the now-playing tile, every track row, the queue list, the
// files browser, and the album grid. When MPD has no embedded cover art,
// we render a tasteful placeholder: a soft gradient + a music-note glyph,
// keyed by the URI so the same track always gets the same color.

import { mpd } from "./mpd.js";

/** 32-bit FNV-1a hash for a stable, fast seed from a string. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

/** Pick two pleasant HSL stops from a numeric seed. */
function gradientColors(seed) {
  const h1 = seed % 360;
  const h2 = (h1 + 35 + (seed % 25)) % 360;
  return [
    `hsl(${h1} 55% 22%)`,
    `hsl(${h2} 65% 14%)`,
  ];
}

function gradientFor(uri) {
  const seed = hash(uri || "unknown");
  const [a, b] = gradientColors(seed);
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}

/** Build a placeholder glyph (♪) into a container. */
function showPlaceholder(container) {
  container.classList.remove("has-artwork", "is-loading");
  container.style.background = gradientFor(container.dataset.uri || "");
  // Add a glyph if the container doesn't already have one.
  if (!container.querySelector(".artwork-glyph")) {
    const g = document.createElement("span");
    g.className = "artwork-glyph";
    g.textContent = "♪";
    g.setAttribute("aria-hidden", "true");
    container.appendChild(g);
  }
}

/**
 * Mount an artwork image into `container`. If the URI has art, we'll use it;
 * otherwise the container shows a music-note placeholder.
 */
export function mountArtwork(container, { uri, size = 56, rounded = true } = {}) {
  if (!container) return null;

  container.dataset.uri = uri || "";
  showPlaceholder(container);
  container.classList.add("has-artwork");

  if (!uri) return null;

  const img = new Image();
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = "";
  img.className = "artwork-img";
  if (size) {
    img.width = size;
    img.height = size;
    img.style.width = size + "px";
    img.style.height = size + "px";
  }
  if (rounded) img.classList.add("artwork-rounded");

  container.classList.add("is-loading");

  img.addEventListener("load", () => {
    container.classList.remove("is-loading");
    // Hide the placeholder glyph once we have real art.
    const g = container.querySelector(".artwork-glyph");
    if (g) g.style.display = "none";
  });
  img.addEventListener("error", () => {
    container.classList.remove("is-loading");
    // Keep the placeholder visible.
    showPlaceholder(container);
  });

  img.src = mpd.artworkUrl(uri);
  container.appendChild(img);
  return img;
}

/** Update an existing container in place — preserves the DOM node identity. */
export function refreshArtwork(container, uri, size = 56) {
  if (!container) return;
  if (!uri) {
    container.replaceChildren();
    container.classList.remove("has-artwork", "is-loading");
    return;
  }
  mountArtwork(container, { uri, size });
}
