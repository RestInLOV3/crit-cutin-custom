/* ======================================================================== *
 * Cut-in templates
 *
 * Each template is plain markup plus CSS (styles/cutin.css). Everything is
 * sized in container units, so the same markup renders the full-screen
 * cut-in and the small live preview in the editor identically.
 *
 * The CSS is written so that the un-animated styles are the "hold" pose:
 * the editor shows that still frame, and the overlay adds `.play`, whose
 * keyframes run in → hold → out over --dur.
 * ======================================================================== */

export const TEMPLATES = {
  strike: {
    label: "스트라이크 — 붉은 사선 · 큰 글자",
    hint: "사선으로 화면을 가르는 띠, 망점 무늬, 비스듬한 초상화 패널과 튀어나오는 글자.",
    crop: { x: 50, y: 18, zoom: 1.15 },
    accent: "#e3262f", accent2: "#0b0b0d"
  },
  band: {
    label: "엠블럼 — 가로 띠 · 빛줄기",
    hint: "위아래가 검게 닫히고 가운데 띠로 얼굴이 미끄러져 들어온 뒤 빛이 훑고 지나갑니다.",
    crop: { x: 50, y: 30, zoom: 1 },
    accent: "#f2c14e", accent2: "#0d1b3a"
  },
  eyes: {
    label: "아이라인 — 눈가 클로즈업 띠",
    hint: "가늘고 긴 띠에 눈가만 확대해 스치듯 지나갑니다. 위치를 눈에 맞춰 주세요.",
    crop: { x: 50, y: 33, zoom: 1.1 },
    accent: "#39c6f0", accent2: "#050608"
  },
  simple: {
    label: "심플 — 초상화 · 금빛 글자",
    hint: "초상화가 아래에서 떠오르고 글자가 빛납니다. 가장 덜 요란한 연출.",
    crop: { x: 50, y: 15, zoom: 1 },
    accent: "#e2b93b", accent2: "#120f0b"
  }
};

export const DEFAULT_TEMPLATE = "strike";

/** The fumble look's colours per template (cold, washed out). */
export const FUMBLE_COLORS = {
  strike: ["#4a5578", "#07080d"],
  band: ["#7d8bb5", "#0b0e1a"],
  eyes: ["#6f86a8", "#040507"],
  simple: ["#9aa3b8", "#0b0c10"]
};

/** Cracks across the screen, cold rain, a heavy vignette — laid over any template. */
function fumbleFx() {
  let rain = "";
  for (let i = 0; i < 26; i++) {
    const x = (i * 41 + 3) % 100;
    const len = 6 + (i * 7) % 9;
    const sp = 520 + (i * 83) % 380;
    const d = -((i * 157) % 900);
    rain += `<i style="--x:${x}cqw;--l:${len}cqh;--s:${sp}ms;--d:${d}ms"></i>`;
  }
  const cracks = [
    "M50 28 L44 20 L46 13 L39 4 L38 -2", "M50 28 L58 22 L63 24 L71 15 L80 12", "M50 28 L57 33 L56 40 L64 47 L67 58",
    "M50 28 L42 31 L35 29 L27 36 L18 38", "M50 28 L47 37 L41 42 L40 52", "M44 20 L36 19", "M63 24 L66 31", "M35 29 L33 23", "M56 40 L50 44"
  ].map((d, i) => `<path d="${d}" pathLength="1" style="--i:${i}"/>`).join("");
  return `<div class="rcc-fumble"><div class="vignette"></div><div class="rain">${rain}</div>
    <svg class="crack" viewBox="0 0 100 56" preserveAspectRatio="none">${cracks}</svg></div>`;
}
const VIDEO = /\.(webm|mp4|m4v|ogv)(\?|$)/i;

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cssUrl = value => String(value ?? "").replace(/["\\\n\r]/g, "");
const cssColor = (value, fallback) => (/^#[0-9a-f]{3,8}$/i.test(String(value ?? "")) ? value : fallback);
const num = (value, lo, hi, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function templateOf(key) {
  return TEMPLATES[key] ? key : DEFAULT_TEMPLATE;
}

/** The crop for a template, falling back to that template's own default. */
export function cropFor(crops, template) {
  const base = TEMPLATES[templateOf(template)].crop;
  const own = crops?.[template] ?? {};
  return {
    x: num(own.x, 0, 100, base.x),
    y: num(own.y, 0, 100, base.y),
    zoom: num(own.zoom, 1, 4, base.zoom)
  };
}

/** Letters as spans, so they can pop in one by one. */
function letters(text) {
  return [...String(text)].map((ch, i) => ch === " "
    ? `<span class="sp" style="--i:${i}">&nbsp;</span>`
    : `<span style="--i:${i}">${escapeHtml(ch)}</span>`).join("");
}

function art(spec, extraClass = "") {
  const crop = spec.crop;
  const style = `--fx:${crop.x}%;--fy:${crop.y}%;--z:${crop.zoom}`;
  const src = escapeHtml(spec.image);
  const media = VIDEO.test(spec.image)
    ? `<video src="${src}" autoplay muted loop playsinline style="${style}"></video>`
    : `<img src="${src}" alt="" draggable="false" style="${style}">`;
  return `<div class="rcc-art ${extraClass}"><div class="pan">${media}</div></div>`;
}

function textBlock(spec, { title = true } = {}) {
  const name = spec.name ? `<div class="name">${escapeHtml(spec.name)}</div>` : "";
  const quote = spec.quote ? `<div class="quote">${escapeHtml(spec.quote)}</div>` : "";
  const badge = spec.nat20 && spec.badge ? `<div class="badge">${escapeHtml(spec.badge)}</div>` : "";
  const big = title ? `<div class="title">${letters(spec.title)}</div>` : "";
  return { name, quote, badge, big };
}

/** A few speed lines with their own tops, lengths and speeds (fixed, so preview and play match). */
function speedLines(count) {
  let out = "";
  for (let i = 0; i < count; i++) {
    const top = (i * 37 + 11) % 100;
    const width = 18 + (i * 23) % 40;
    const speed = 380 + (i * 97) % 420;
    const delay = -((i * 131) % 600);
    const x = (i * 53 + 7) % 90;
    out += `<i style="--t:${top}%;--w:${width}cqw;--x:${x}cqw;--s:${speed}ms;--d:${delay}ms"></i>`;
  }
  return `<div class="lines">${out}</div>`;
}

const LAYOUTS = {
  strike(spec) {
    const t = textBlock(spec);
    return `
      <div class="dim"></div>
      <div class="band"><div class="dots"></div><div class="streaks"></div></div>
      <div class="slash s1"></div><div class="slash s2"></div>
      <div class="panel"><div class="shadow"></div><div class="frame">${art(spec)}</div></div>
      <div class="text">${t.badge}${t.big}${t.name}${t.quote}</div>
      <div class="flash"></div>`;
  },
  band(spec) {
    const t = textBlock(spec);
    return `
      <div class="dim"></div>
      <div class="bar top"><div class="text-top">${t.name}${t.badge}</div></div>
      <div class="strip">${speedLines(10)}${art(spec)}<div class="glint"></div></div>
      <div class="bar bottom"><div class="text-bottom">${t.quote}${t.big}</div></div>
      <div class="flash"></div>`;
  },
  eyes(spec) {
    const t = textBlock(spec);
    return `
      <div class="dim"></div>
      <div class="echo"></div>
      <div class="strip">${art(spec)}<div class="glint"></div></div>
      <div class="text-top">${t.badge}${t.big}</div>
      <div class="text-bottom">${t.name}${t.quote}</div>
      <div class="flash"></div>`;
  },
  simple(spec) {
    const t = textBlock(spec);
    return `
      <div class="dim"></div>
      <div class="glow"></div>
      ${art(spec)}
      <div class="text">${t.badge}${t.big}${t.name}${t.quote}</div>`;
  }
};

/**
 * Markup for one cut-in.
 * @param {object} spec  { template, image, crop, flip, accent, accent2, title, name, quote, nat20, duration }
 * @param {object} opts  { play: boolean, reduced: boolean }
 */
export function renderCutin(spec, { play = false, reduced = false } = {}) {
  const key = templateOf(spec.template);
  const def = TEMPLATES[key];
  const s = {
    ...spec,
    template: key,
    crop: spec.crop ?? def.crop,
    title: String(spec.title || "CRITICAL!").slice(0, 24),
    image: cssUrl(spec.image) || "icons/svg/mystery-man.svg"
  };
  const fumble = !!spec.fumble;
  const fc = FUMBLE_COLORS[key] ?? FUMBLE_COLORS.strike;
  const style = [
    `--a1:${fumble ? fc[0] : cssColor(spec.accent, def.accent)}`,
    `--a2:${fumble ? fc[1] : cssColor(spec.accent2, def.accent2)}`,
    `--dur:${Math.round(num(spec.duration, 800, 6000, 2200))}ms`
  ].join(";");
  const classes = ["rcc-stage", `rcc-t-${key}`, play ? "play" : "still", reduced ? "reduced" : "", s.flip ? "flip" : "", s.nat20 ? "nat20" : "", fumble ? "fumble" : ""]
    .filter(Boolean).join(" ");
  if (fumble) s.title = String(spec.title || "FUMBLE…").slice(0, 24);
  return `<div class="${classes}" style="${style}">${LAYOUTS[key](s)}${fumble ? fumbleFx() : ""}</div>`;
}
