/*
 * js/lib/member-pass.js
 * ------------------------------------------------------------------
 * Small deterministic helpers for the member pass: the serial printed
 * on the card, the barcode drawn beside it, and the short website label.
 * Kept out of profile.js so the values can be tested without a DOM.
 * ------------------------------------------------------------------
 */

/** FNV-1a, used only for decorative pass values. */
function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * A stable, decorative serial such as FCS-25-4F2A.
 * The profile UUID never appears on the card; only its hash does.
 */
export function passSerial(id, createdAt) {
  const date = new Date(createdAt);
  const year = Number.isNaN(date.getTime())
    ? new Date().getUTCFullYear()
    : date.getUTCFullYear();
  const code = hashString(String(id || createdAt || "fcs"))
    .toString(36)
    .toUpperCase()
    .slice(-4)
    .padStart(4, "0");
  return `FCS-${String(year).slice(-2)}-${code}`;
}

/**
 * Bar widths and gaps for the barcode. Deterministic for a given seed,
 * so a pass always has the same stripe pattern.
 */
export function barcodeBars(seed, count = 34) {
  let hash = hashString(String(seed || "fcs"));
  return Array.from({ length: count }, (_, index) => {
    hash = (Math.imul(hash ^ (hash >>> 15), 2246822507) + index) >>> 0;
    return {
      width: 1 + (hash % 3),
      gap: 1 + ((hash >>> 5) % 3),
    };
  });
}

/** An inline SVG barcode. All values are numeric, so this is safe to inject. */
export function barcodeSVG(seed) {
  let x = 0;
  const rects = barcodeBars(seed)
    .map(({ width, gap }) => {
      const rect = `<rect x="${x}" y="0" width="${width}" height="20"></rect>`;
      x += width + gap;
      return rect;
    })
    .join("");
  return `<svg viewBox="0 0 ${Math.max(1, x)} 20" preserveAspectRatio="none" focusable="false" aria-hidden="true">${rects}</svg>`;
}

/** The hostname shown on the pass, without the scheme or www. */
export function shortHost(value) {
  try {
    const url = new URL(String(value));
    if (!/^https?:$/i.test(url.protocol)) return "";
    return url.host.replace(/^www\./i, "");
  } catch {
    return "";
  }
}
