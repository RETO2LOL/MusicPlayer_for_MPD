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
  // Add a glyph if the container doesn't already have one; reset its
  // visibility in case it was hidden by a previous successful load.
  let g = container.querySelector(".artwork-glyph");
  if (!g) {
    g = document.createElement("span");
    g.className = "artwork-glyph";
    g.textContent = "♪";
    g.setAttribute("aria-hidden", "true");
    container.appendChild(g);
  } else {
    g.style.display = "";
  }
}

/**
 * Mount an artwork image into `container`. If the URI has art, we'll use it;
 * otherwise the container shows a music-note placeholder.
 *
 * Idempotent: if the container already has artwork loaded for the same URI,
 * this is a no-op. State pushes re-render the now-playing footer on every
 * tick of the progress bar; rebuilding the <img> element each time would
 * tear down the loaded bitmap and cause a visible flicker whenever the
 * user hovers over the artwork (or the track changes, or playback starts).
 */
export function mountArtwork(container, { uri, size = 56, rounded = true } = {}) {
  if (!container) return null;

  const prevUri = container.dataset.uri || "";
  const nextUri = uri || "";
  container.dataset.uri = nextUri;
  container.classList.add("has-artwork");

  if (!nextUri) {
    // No art requested — wipe the container and show the placeholder.
    container.replaceChildren();
    showPlaceholder(container);
    return null;
  }

  // Same URI, and we already have a successful <img> in the DOM → nothing to do.
  const existing = container.querySelector("img.artwork-img");
  if (prevUri === nextUri && existing && existing.dataset.loaded === "1") {
    container.classList.add("has-artwork");
    container.classList.remove("is-loading");
    return existing;
  }

  // Different URI (or first mount, or previous load failed): build a fresh image.
  // Add the placeholder first so the gradient shows immediately, then layer
  // the new <img> on top — the placeholder stays visible until the load
  // event hides the glyph.
  showPlaceholder(container);
  container.classList.add("is-loading");

  const img = new Image();
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = "";
  img.className = "artwork-img";
  if (rounded) img.classList.add("artwork-rounded");
  if (size) {
    img.width = size;
    img.height = size;
    img.style.width = size + "px";
    img.style.height = size + "px";
  }

  img.addEventListener("load", () => {
    img.dataset.loaded = "1";
    container.classList.remove("is-loading");
    container.classList.add("has-artwork");
    // Hide the placeholder glyph once we have real art.
    const g = container.querySelector(".artwork-glyph");
    if (g) g.style.display = "none";
  });
  img.addEventListener("error", () => {
    img.dataset.loaded = "0";
    container.classList.remove("is-loading");
    // Keep the placeholder visible.
    showPlaceholder(container);
  });

  // Remove any previous <img> but keep the placeholder glyph.
  const oldImg = container.querySelector("img.artwork-img");
  if (oldImg) oldImg.remove();
  container.appendChild(img);
  img.src = mpd.artworkUrl(nextUri);
  return img;
}

/** Update an existing container in place — preserves the DOM node identity. */
export function refreshArtwork(container, uri, size = 56) {
  if (!container) return;
  if (!uri) {
    container.replaceChildren();
    container.classList.remove("has-artwork", "is-loading");
    container.dataset.uri = "";
    return;
  }
  // Only swap if the URI actually changed; otherwise the existing image stays.
  if (container.dataset.uri === uri) return;
  mountArtwork(container, { uri, size });
}
