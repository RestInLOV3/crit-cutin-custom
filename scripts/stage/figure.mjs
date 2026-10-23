/* ======================================================================== *
 * How big a character stands on stage, and where.
 *
 * Pictures come in every size: one PNG has wide empty margins, another is a
 * tight crop, one is 4000 px and the next 400. So the stage never trusts the
 * file: it measures the visible (non-transparent) part of each picture once
 * and sizes *that* by the creature's size, so a small Lem stands shorter
 * than a human and a cat shorter still, whatever the files are like.
 *
 *   height of the visible figure = available height × size factor × your scale
 *   tiny .42 · small .6 · medium .78 · large .9 · huge 1 · gargantuan 1.06
 *
 * Full-body pictures stand with their feet just behind the dialogue box;
 * waist-up pictures (cut off at the bottom, or with no transparency at all)
 * sink lower so the cut edge stays hidden, and their head lands where a
 * full-body figure of the same size would have it. Very wide figures (wings)
 * may reach over their neighbours (the one talking is always drawn on top),
 * but never across the whole stage. All of it can be overridden per
 * character (size, scale, height, framing).
 * ======================================================================== */

import { lazyLabels } from "../i18n.mjs";

export const SIZE_FACTOR = { tiny: 0.42, sm: 0.6, med: 0.78, lg: 0.9, huge: 1, grg: 1.06 };
/** { size: name }, localized when read. */
export const SIZE_LABELS = lazyLabels({ tiny: "Size.tiny", sm: "Size.sm", med: "Size.med", lg: "Size.lg", huge: "Size.huge", grg: "Size.grg" });

const SIZE_NAMES = {
  tiny: "tiny", sm: "sm", small: "sm", med: "med", medium: "med", lg: "lg", large: "lg",
  huge: "huge", grg: "grg", gargantuan: "grg", grand: "grg"
};

/** Creature size: PF2e / dnd5e traits, else the token's footprint. */
export function sizeOf(actor, tokenDoc) {
  const raw = actor?.system?.traits?.size;
  const value = typeof raw === "string" ? raw : raw?.value;
  if (SIZE_NAMES[value]) return SIZE_NAMES[value];
  const w = Number(tokenDoc?.width ?? actor?.prototypeToken?.width) || 1;
  if (w <= 0.5) return "tiny";
  if (w < 1) return "sm";
  if (w < 2) return "med";
  if (w < 3) return "lg";
  if (w < 4) return "huge";
  return "grg";
}

export const VIDEO_RE = /\.(webm|mp4|m4v|ogv)(\?|#|$)/i;

const metaCache = new Map();

/**
 * The visible part of a loaded picture, as fractions of its size, and whether
 * it is cut off at the bottom (a waist-up picture or a plain rectangle).
 * Pictures from another site that can't be read are used whole.
 */
export function analyzeMedia(el, src) {
  if (src && metaCache.has(src)) return metaCache.get(src);
  const w = el?.naturalWidth || el?.videoWidth || 0;
  const h = el?.naturalHeight || el?.videoHeight || 0;
  let meta = { w: w || 1, h: h || 1, x0: 0, y0: 0, x1: 1, y1: 1, cut: false, measured: false };
  if (w && h && el.tagName === "IMG") {
    try {
      const k = Math.min(1, 240 / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * k));
      const ch = Math.max(1, Math.round(h * k));
      const c = document.createElement("canvas");
      c.width = cw;
      c.height = ch;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(el, 0, 0, cw, ch);
      meta = { ...measureAlpha(g.getImageData(0, 0, cw, ch).data, cw, ch), w, h, measured: true };
    } catch (_) { /* another site's picture: use it whole */ }
  }
  if (src) metaCache.set(src, meta);
  return meta;
}

/** Bounding box of pixels with alpha > 24, and the "cut at the bottom" test. */
export function measureAlpha(data, cw, ch) {
  const A = 24;
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1, solid = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (data[(y * cw + x) * 4 + 3] > A) {
        solid++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: 1, y1: 1, cut: false, fill: 0 };
  // A waist-up picture ends in one wide solid run along the bottom edge;
  // feet are narrow (or two runs). Plain rectangles (no alpha) count as cut.
  let run = 0;
  let best = 0;
  if (y1 >= ch - 2) {
    for (let x = x0; x <= x1; x++) {
      if (data[(y1 * cw + x) * 4 + 3] > A) best = Math.max(best, ++run);
      else run = 0;
    }
  }
  const width = x1 - x0 + 1;
  return { x0: x0 / cw, y0: y0 / ch, x1: (x1 + 1) / cw, y1: (y1 + 1) / ch, cut: best / width >= 0.5, fill: solid / (cw * ch) };
}

/**
 * Fill a small square box with the face. Transparent full-body art (dynamic
 * token ring subjects, stage pictures) → the top of the visible figure;
 * ordinary token or portrait art → the middle, a little zoomed in.
 * The box must clip (overflow: hidden); the picture is placed in px inside it.
 */
export function faceCrop(img, box = img.parentElement) {
  if (!img || !box) return;
  const S = Math.min(box.clientWidth, box.clientHeight) || 36;
  const m = analyzeMedia(img, img.currentSrc || img.getAttribute("src"));
  const nw = m.w, nh = m.h;
  let side, cx, top;
  if (m.measured && m.fill < 0.62) {
    const bx0 = m.x0 * nw, bx1 = m.x1 * nw, by0 = m.y0 * nh, by1 = m.y1 * nh;
    const bw = bx1 - bx0, bh = by1 - by0;
    side = bh >= bw ? Math.min(bw, bh * 0.3) : Math.min(bh * 0.7, bw);
    side = Math.max(side, Math.min(nw, nh) * 0.18);
    cx = (bx0 + bx1) / 2;
    top = by0 - side * 0.05;
  } else {
    side = Math.min(nw, nh) * 0.78;
    cx = nw / 2;
    top = (nh - side) / 2 - nh * 0.04;
  }
  const k = S / side;
  Object.assign(img.style, {
    position: "absolute", maxWidth: "none", maxHeight: "none", objectFit: "fill",
    width: `${nw * k}px`, height: `${nh * k}px`, left: `${S / 2 - cx * k}px`, top: `${-top * k}px`
  });
}

/**
 * Where one picture stands, in px of the stage measured from its bottom-left.
 * @returns {{left:number,bottom:number,width:number,height:number,half:boolean}}
 */
export function placeFigure({ W, H, n = 3, index = 1, meta, size = "med", framing = "auto", scale = 1, offsetY = 0, flip = false }) {
  const m = meta ?? { w: 1, h: 1, x0: 0, y0: 0, x1: 1, y1: 1, cut: false };
  const slotW = W / Math.max(1, n);
  const cx = (index + 0.5) * slotW;
  // The dialogue box: bottom max(14px, 3%), about 22% tall.
  const boxBottom = Math.max(14, 0.03 * H);
  const boxH = 0.22 * H;
  const fullBase = boxBottom + boxH * 0.45;    // feet just behind the box
  const halfBase = boxBottom + boxH * 0.08;    // a waist-up cut stays hidden
  const topLine = H * 0.96;
  const factor = (SIZE_FACTOR[size] ?? SIZE_FACTOR.med) * (Number(scale) || 1);
  const half = framing === "half" || (framing === "auto" && !!m.cut);
  const base = half ? halfBase : fullBase;
  // Head height: the same for both framings (a touch lower for busts, which read bigger).
  const headTop = fullBase + (topLine - fullBase) * factor * (half ? 0.92 : 1);
  let contentH = Math.max(H * 0.12, headTop - base);
  const bw = Math.max(1e-3, m.x1 - m.x0) * m.w;
  const bh = Math.max(1e-3, m.y1 - m.y0) * m.h;
  let contentW = contentH * bw / bh;
  // Wide figures (wings) may reach over their neighbours; whoever talks is drawn on top anyway.
  const maxW = Math.min(W * 0.95, slotW * 2.4);
  if (contentW > maxW) { contentH *= maxW / contentW; contentW = maxW; }
  const s = contentH / bh;
  const width = m.w * s;
  const height = m.h * s;
  const x0 = flip ? 1 - m.x1 : m.x0;
  const x1 = flip ? 1 - m.x0 : m.x1;
  const left = cx - ((x0 + x1) / 2) * width;
  const bottom = base + (Number(offsetY) || 0) / 100 * H - (1 - m.y1) * height;
  return { left, bottom, width, height, half };
}
