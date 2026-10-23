import { MODULE_ID, setting } from "../config.mjs";

/* ======================================================================== *
 * Landing page — a title screen for the campaign.
 *
 * Any scene can be a landing scene (scene flag). While someone views it, a
 * full-screen page covers the map: background, title, a menu of buttons and
 * the party's profile cards, lit by a few CSS effects. "입장하기" puts the
 * page away for you; the GM can bring it back for everyone, or send everyone
 * in. All of it is plain HTML/CSS — no extra canvas, no libraries, no fonts.
 *
 * Four looks, all drawn here (no other module's art or layout):
 *   cinematic  — letterbox bars, a slow push-in, title low on the left
 *   fantasy    — dark, gilded frame, centred title and a column of buttons
 *   jrpg       — bright title logo, a menu with a pointer, slanted party panels
 *   silhouette — the party in a row, dark until you point at one
 * ======================================================================== */

export const LANDING_FLAG = "landing";
const SOCKET = `module.${MODULE_ID}`;
const VIDEO_RE = /\.(webm|mp4|m4v|ogv)(\?|#|$)/i;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const TEMPLATES = {
  cinematic: { label: "시네마틱", hint: "위아래 검은 띠, 천천히 다가가는 배경, 왼쪽 아래 큰 제목", accent: "#c9d6e8", particles: "dust" },
  fantasy: { label: "다크 판타지", hint: "어두운 금테 액자, 가운데 제목과 세로 메뉴, 아래에 초상 카드", accent: "#d8b45a", particles: "embers" },
  jrpg: { label: "JRPG 타이틀", hint: "밝은 로고, 오른쪽 메뉴와 화살표 커서, 비스듬한 파티 패널", accent: "#5cc8ff", particles: "petals" },
  silhouette: { label: "실루엣 파티", hint: "검은 판 위에 파티가 한 줄로 — 마우스를 올린 사람만 빛을 받음", accent: "#ffb066", particles: "embers" },
  storybook: { label: "동화책", hint: "양피지 책장 위의 제목과 메뉴, 핀으로 꽂은 사진 같은 초상", accent: "#b5482e", particles: "petals" },
  neon: { label: "사이버 네온", hint: "어둠 속 네온 격자 바닥, 터미널 메뉴, 홀로그램 ID 카드", accent: "#ff3cac", particles: "dust" },
  dossier: { label: "기밀 문서", hint: "책상 위 서류철, 타자기 글씨와 붉은 도장, 클립으로 끼운 사진 (CoC에 잘 어울림)", accent: "#9b2222", particles: "none" },
  tarot: { label: "타로·별자리", hint: "별밤 아래 부채꼴로 펼친 타로 카드, 별 모양 메뉴", accent: "#e6c46a", particles: "dust" }
};

/** Fonts the GM can pick (loaded from Google Fonts when used; without internet the default is used). */
export const FONTS = {
  "": { label: "모양 기본값" },
  serif: { label: "기본 명조", stack: '"Noto Serif KR", "Nanum Myeongjo", "Batang", serif' },
  sans: { label: "기본 고딕", stack: '"Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif' },
  songmyung: { label: "송명 — 붓 명조", family: "Song Myung", stack: '"Song Myung", serif' },
  gowunbatang: { label: "고운바탕 — 부드러운 명조", family: "Gowun Batang:wght@400;700", stack: '"Gowun Batang", serif' },
  hahmlet: { label: "함렛 — 굵은 명조", family: "Hahmlet:wght@400;700;900", stack: '"Hahmlet", serif' },
  nanummyeongjo: { label: "나눔명조", family: "Nanum Myeongjo:wght@400;700;800", stack: '"Nanum Myeongjo", serif' },
  diphylleia: { label: "디필레이아 — 우아한", family: "Diphylleia", stack: '"Diphylleia", serif' },
  blackhansans: { label: "블랙한산스 — 아주 굵게", family: "Black Han Sans", stack: '"Black Han Sans", sans-serif' },
  dohyeon: { label: "도현 — 각진 고딕", family: "Do Hyeon", stack: '"Do Hyeon", sans-serif' },
  jua: { label: "주아 — 둥근", family: "Jua", stack: '"Jua", sans-serif' },
  gowundodum: { label: "고운돋움", family: "Gowun Dodum", stack: '"Gowun Dodum", sans-serif' },
  orbit: { label: "오르빗 — SF", family: "Orbit", stack: '"Orbit", sans-serif' },
  nanumpen: { label: "나눔손글씨 펜", family: "Nanum Pen Script", stack: '"Nanum Pen Script", cursive' },
  gaegu: { label: "개구 — 손글씨", family: "Gaegu:wght@400;700", stack: '"Gaegu", cursive' },
  typewriter: { label: "타자기 (고정폭)", family: "Nanum Gothic Coding:wght@400;700", stack: '"Courier Prime", "Courier New", "Nanum Gothic Coding", monospace' },
  cinzel: { label: "Cinzel — 라틴 대문자 (한글은 명조)", family: "Cinzel:wght@400;700;900", stack: '"Cinzel", "Noto Serif KR", serif' }
};

const loadedFonts = new Set();
/** The scene's picture: v14 keeps it on the scene's level (Scene#background is deprecated there). */
function sceneBackground(scene) {
  if (!scene) return "";
  const levels = scene.levels;
  const level = scene.initialLevel ?? levels?.contents?.[0] ?? (Array.isArray(levels) ? levels[0] : null) ?? levels?.values?.().next?.().value;
  const fromLevel = level?.background?.src ?? level?.textures?.background?.src;
  if (fromLevel) return fromLevel;
  if ((game.release?.generation ?? 13) >= 14) return scene.thumb ?? "";
  return scene.background?.src ?? scene.img ?? "";
}

export function loadFont(key) {
  const f = FONTS[key];
  if (!f?.family || loadedFonts.has(f.family)) return;
  loadedFonts.add(f.family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${f.family.replace(/ /g, "+")}&display=swap`;
  link.dataset.rclFont = key;
  document.head.appendChild(link);
}

/** CSS variables for the chosen fonts and colours (empty = the look's own). */
export function landingVars(cfg) {
  const vars = { "--accent": cfg.accent || "#d8b45a" };
  const t = FONTS[cfg.titleFont]?.stack;
  const b = FONTS[cfg.bodyFont]?.stack;
  if (t) { vars["--title-font"] = t; loadFont(cfg.titleFont); }
  if (b) { vars["--body-font"] = b; loadFont(cfg.bodyFont); }
  if (cfg.titleColor) vars["--title-color"] = cfg.titleColor;
  if (cfg.textColor) vars["--ink"] = cfg.textColor;
  return vars;
}

export const ACTIONS = {
  enter: { label: "입장하기 (이 화면 닫기)", icon: "fa-solid fa-door-open", target: false },
  sheet: { label: "내 캐릭터 시트", icon: "fa-solid fa-id-card", target: false },
  shop: { label: "상점 — 아이템 브라우저", icon: "fa-solid fa-store", target: false },
  journal: { label: "저널 열기", icon: "fa-solid fa-book-open", target: "uuid" },
  scene: { label: "장면으로 이동", icon: "fa-solid fa-map", target: "uuid" },
  url: { label: "웹 링크 (새 탭)", icon: "fa-solid fa-link", target: "url" },
  macro: { label: "매크로 실행", icon: "fa-solid fa-scroll", target: "uuid" },
  stage: { label: "진지 RP 모드 켜기 (GM)", icon: "fa-solid fa-masks-theater", target: false }
};

export const PARTICLES = { none: "없음", embers: "불티 (위로)", dust: "먼지·빛가루", snow: "눈", petals: "꽃잎" };

export const DEFAULT_LANDING = Object.freeze({
  enabled: false,
  template: "fantasy",
  cover: "board",                 // "board" (chat stays) | "all"
  title: "",
  subtitle: "",
  tagline: "",
  note: "",
  logo: "",
  background: "",                 // "" → the scene's own background
  bgMode: "image",                // "image" | "dark" (no picture: darkness and light)
  accent: "#d8b45a",
  titleFont: "",
  bodyFont: "",
  titleColor: "",
  textColor: "",
  lighting: { vignette: 0.55, rays: true, fog: true, particles: "embers", flicker: false, grade: 0.25 },
  menu: [
    { label: "입장하기", icon: "fa-solid fa-door-open", action: "enter", target: "" },
    { label: "상점", icon: "fa-solid fa-store", action: "shop", target: "" },
    { label: "내 캐릭터", icon: "fa-solid fa-id-card", action: "sheet", target: "" }
  ],
  cards: { show: true, actors: [], level: true, player: true }
});

export function landingConfig(scene) {
  const raw = scene?.getFlag?.(MODULE_ID, LANDING_FLAG) ?? {};
  return {
    ...DEFAULT_LANDING, ...raw,
    lighting: { ...DEFAULT_LANDING.lighting, ...(raw.lighting ?? {}) },
    cards: { ...DEFAULT_LANDING.cards, ...(raw.cards ?? {}) },
    menu: Array.isArray(raw.menu) ? raw.menu : DEFAULT_LANDING.menu.map(m => ({ ...m }))
  };
}

/* ---------------- the party ---------------- */

function ownerOf(actor) {
  return game.users.find(u => !u.isGM && (u.character?.id === actor.id))
    ?? game.users.find(u => !u.isGM && actor.testUserPermission?.(u, "OWNER")) ?? null;
}

function partyActors(cfg) {
  const picked = (cfg.cards.actors ?? []).map(id => game.actors.get(id)).filter(Boolean);
  if (picked.length) return picked;
  return game.actors.filter(a => a.type === "character" && a.hasPlayerOwner)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** "엘프 위저드 5" (PF2e) or whatever the system offers. */
function cardLine(actor) {
  const sys = actor.system ?? {};
  const level = actor.level ?? sys.details?.level?.value ?? sys.details?.level ?? null;
  const parts = [actor.ancestry?.name, actor.class?.name].filter(Boolean);
  if (!parts.length && sys.details?.occupation) parts.push(sys.details.occupation);       // CoC
  if (!parts.length && typeof sys.details?.race === "string") parts.push(sys.details.race);
  if (!parts.length && typeof sys.details?.class === "string") parts.push(sys.details.class);
  return { line: parts.join(" "), level: Number.isFinite(Number(level)) && level !== null && level !== "" ? Number(level) : null };
}

/* ---------------- building the page ---------------- */

function particleHtml(kind) {
  if (!kind || kind === "none") return "";
  const n = kind === "snow" ? 46 : kind === "dust" ? 36 : 28;
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = Math.random() * 100;
    const d = (kind === "snow" ? 9 : 7) + Math.random() * 9;
    const delay = -Math.random() * d;
    const size = (kind === "petals" ? 7 : kind === "snow" ? 3 : 2) + Math.random() * (kind === "petals" ? 6 : 3);
    const drift = (Math.random() * 2 - 1) * 8;
    out += `<i style="--x:${x.toFixed(1)}%;--d:${d.toFixed(1)}s;--delay:${delay.toFixed(1)}s;--s:${size.toFixed(1)}px;--drift:${drift.toFixed(1)}cqw;--o:${(0.35 + Math.random() * 0.6).toFixed(2)}"></i>`;
  }
  return `<div class="rcl-parts ${kind}">${out}</div>`;
}

/** The page's inner HTML for a scene's config (also used by the editor's preview). */
export function landingHtml(cfg, scene, { preview = false } = {}) {
  const L = cfg.lighting;
  const bg = cfg.bgMode === "dark" ? "" : (cfg.background || sceneBackground(scene) || "");
  const media = bg ? (VIDEO_RE.test(bg) ? `<video src="${esc(bg)}" autoplay muted loop playsinline></video>` : `<img src="${esc(bg)}" alt="">`) : "";
  const title = cfg.logo ? `<img class="logo" src="${esc(cfg.logo)}" alt="${esc(cfg.title)}">` : `<h1>${esc(cfg.title || scene?.navName || scene?.name || "")}</h1>`;
  const menu = (cfg.menu ?? []).map((m, i) => (m?.label ?
    `<button type="button" class="rcl-btn" data-i="${i}"><i class="${esc(m.icon || ACTIONS[m.action]?.icon || "fa-solid fa-circle")}"></i><span>${esc(m.label)}</span></button>` : "")).join("");
  const party = cfg.cards.show ? partyActors(cfg) : [];
  const cards = party.map((actor, i) => {
    const { line, level } = cardLine(actor);
    const owner = ownerOf(actor);
    const color = owner?.color?.css ?? owner?.color ?? "#999";
    return `<article class="rcl-card" data-actor="${actor.id}" style="--pc:${esc(color)};--i:${i};--n:${party.length}">
      <div class="pic"><img src="${esc(actor.img)}" alt=""></div>
      <div class="info"><b>${esc(actor.name)}</b>
        ${(line || (cfg.cards.level && level !== null)) ? `<small>${esc(line)}${cfg.cards.level && level !== null ? ` <em>Lv ${level}</em>` : ""}</small>` : ""}
        ${cfg.cards.player && owner ? `<span class="player ${owner.active ? "on" : ""}"><i></i>${esc(owner.name)}</span>` : ""}
      </div></article>`;
  }).join("");
  const gm = game.user?.isGM && !preview ? `<div class="rcl-gm">
      <button type="button" data-gm="edit" data-tooltip="랜딩 페이지 꾸미기"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
      <button type="button" data-gm="showAll" data-tooltip="모두에게 다시 보이기"><i class="fa-solid fa-eye"></i></button>
      <button type="button" data-gm="enterAll" data-tooltip="모두 입장시키기 (모두의 화면에서 닫기)"><i class="fa-solid fa-person-walking-arrow-right"></i></button>
      <button type="button" data-gm="close" data-tooltip="내 화면에서만 닫기"><i class="fa-solid fa-xmark"></i></button></div>` : "";
  return `
    <div class="rcl-bg">${media}</div>
    <div class="rcl-grade" style="--g:${Number(L.grade) || 0}"></div>
    <div class="rcl-fx">
      ${L.rays ? `<div class="rcl-rays"><i></i><i></i><i></i><i></i></div>` : ""}
      ${L.fog ? `<div class="rcl-fog"><i></i><i></i></div>` : ""}
      ${particleHtml(L.particles)}
    </div>
    <div class="rcl-vignette" style="--v:${Number(L.vignette) || 0}"></div>
    <div class="rcl-frame"></div>
    <div class="rcl-layout">
      <header class="rcl-title">
        ${cfg.subtitle ? `<div class="sub">${esc(cfg.subtitle)}</div>` : ""}
        ${title}
        <div class="divider"><span></span></div>
        ${cfg.tagline ? `<div class="tagline">${esc(cfg.tagline)}</div>` : ""}
      </header>
      ${menu ? `<nav class="rcl-menu">${menu}</nav>` : ""}
      ${cards ? `<div class="rcl-cards">${cards}</div>` : ""}
      ${cfg.note ? `<footer class="rcl-note">${esc(cfg.note)}</footer>` : ""}
    </div>
    ${gm}`;
}

export function landingClasses(cfg) {
  const motion = setting("landingMotion", "full") !== "reduced" && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  return ["rcl-landing", `rcl-tpl-${TEMPLATES[cfg.template] ? cfg.template : "fantasy"}`, motion ? "motion" : "still",
    cfg.lighting.flicker ? "flicker" : "", cfg.titleColor ? "own-title-color" : "", cfg.bgMode === "dark" ? "dark-bg" : ""].filter(Boolean).join(" ");
}

/* ======================================================================== */

export class Landing {
  constructor() {
    this.el = null;
    this.dismissed = new Set();   // scene ids you entered from (this session)
  }

  mount() {
    if (this.el) return;
    const el = document.createElement("section");
    el.id = "rcl-landing";
    el.className = "hidden";
    el.addEventListener("click", ev => this._onClick(ev));
    document.body.appendChild(el);
    this.el = el;
    window.addEventListener("resize", () => this.place());
    Hooks.on("collapseSidebar", () => setTimeout(() => this.place(), 260));
    Hooks.on("canvasReady", () => this.sync());
    Hooks.on("updateScene", (scene, changes) => { if (scene.id === canvas.scene?.id && changes.flags?.[MODULE_ID]) this.sync(true); });
    for (const hook of ["userConnected", "updateActor", "updateUser"]) Hooks.on(hook, () => { if (this.shown) this.sync(true); });
    this.sync();
  }

  get shown() {
    return !!this.el && !this.el.classList.contains("hidden");
  }

  sync(redraw = false) {
    if (!this.el) return;
    const scene = globalThis.canvas?.scene;
    const cfg = landingConfig(scene);
    const on = !!scene && cfg.enabled && setting("landingShow", true) !== false && !this.dismissed.has(scene.id);
    const was = this.shown;
    document.body.classList.toggle("rcl-on", on);
    document.body.classList.toggle("rcl-cover-all", on && cfg.cover === "all");
    if (!on) {
      if (was) { this.el.classList.add("leaving"); setTimeout(() => { this.el.classList.add("hidden"); this.el.classList.remove("leaving"); this.el.innerHTML = ""; }, 600); }
      return;
    }
    if (!was || redraw || this.el.dataset.scene !== scene.id) {
      this.cfg = cfg;
      this.el.dataset.scene = scene.id;
      this.el.className = `${landingClasses(cfg)} ${was ? "" : "entering"}`;
      this.el.removeAttribute("style");
      for (const [k, v] of Object.entries(landingVars(cfg))) this.el.style.setProperty(k, v);
      this.el.innerHTML = landingHtml(cfg, scene);
      requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.remove("entering")));
    }
    this.place();
  }

  place() {
    if (!this.shown) return;
    if (this.cfg?.cover === "all") { Object.assign(this.el.style, { left: "0px", top: "0px", width: "100vw", height: "100vh" }); return; }
    const board = document.getElementById("board")?.getBoundingClientRect?.();
    let right = window.innerWidth;
    const sidebar = document.getElementById("sidebar");
    if (sidebar && sidebar.offsetParent !== null) {
      const side = sidebar.getBoundingClientRect();
      if (side.left > 0 && side.left < right) right = side.left - 4;
    }
    const left = Math.max(0, board?.left ?? 0);
    Object.assign(this.el.style, { left: `${left}px`, top: "0px", width: `${Math.max(0, right - left)}px`, height: `${window.innerHeight}px` });
  }

  /** Put the page away on this screen (until you come back to the scene, or the GM shows it again). */
  enter() {
    const id = globalThis.canvas?.scene?.id;
    if (id) this.dismissed.add(id);
    this.sync();
  }

  showAgain() {
    const id = globalThis.canvas?.scene?.id;
    if (id) this.dismissed.delete(id);
    this.sync(true);
  }

  async _onClick(ev) {
    const gm = ev.target.closest("[data-gm]")?.dataset.gm;
    if (gm && game.user.isGM) {
      if (gm === "edit") return game.rutzCutin?.landingEditor?.();
      if (gm === "close") return this.enter();
      if (gm === "showAll") { game.socket.emit(SOCKET, { action: "landing-show" }); return this.showAgain(); }
      if (gm === "enterAll") { game.socket.emit(SOCKET, { action: "landing-enter" }); return this.enter(); }
    }
    const card = ev.target.closest(".rcl-card");
    if (card) {
      const actor = game.actors.get(card.dataset.actor);
      const LIMITED = CONST.DOCUMENT_OWNERSHIP_LEVELS?.LIMITED ?? 1;
      if (actor?.testUserPermission?.(game.user, LIMITED)) actor.sheet?.render(true);
      return;
    }
    const btn = ev.target.closest(".rcl-btn");
    if (!btn) return;
    const item = this.cfg?.menu?.[Number(btn.dataset.i)];
    if (item) runAction(item, this);
  }
}

export async function runAction(item, landing) {
  const target = String(item.target ?? "").trim();
  switch (item.action) {
    case "enter": return landing?.enter();
    case "sheet": {
      const actor = game.user.character ?? game.actors.find(a => a.type === "character" && a.isOwner && a.hasPlayerOwner);
      if (!actor) return ui.notifications.info("할당된 캐릭터가 없습니다.");
      return actor.sheet?.render(true);
    }
    case "journal": {
      const doc = target ? await fromUuid(target).catch(() => null) : null;
      if (!doc) return ui.notifications.warn("연결된 저널을 찾을 수 없습니다.");
      if (doc.documentName === "JournalEntryPage") return doc.parent?.sheet?.render(true, { pageId: doc.id });
      return doc.sheet?.render(true);
    }
    case "scene": {
      const doc = target ? await fromUuid(target).catch(() => null) : null;
      if (!doc) return ui.notifications.warn("연결된 장면을 찾을 수 없습니다.");
      return doc.view?.();
    }
    case "shop": {
      // PF2e: the compendium browser's equipment tab; elsewhere: the compendium sidebar.
      const browser = game.pf2e?.compendiumBrowser;
      if (browser?.openTab) return browser.openTab("equipment");
      ui.sidebar?.expand?.();
      return ui.sidebar?.changeTab?.("compendium", "primary") ?? ui.sidebar?.activateTab?.("compendium");
    }
    case "url":
      if (/^https?:\/\//i.test(target)) window.open(target, "_blank", "noopener");
      return;
    case "macro": {
      const doc = target ? await fromUuid(target).catch(() => null) : null;
      if (!doc) return ui.notifications.warn("연결된 매크로를 찾을 수 없습니다.");
      return doc.execute?.();
    }
    case "stage":
      if (game.user.isGM) { await game.rutzCutin?.stageOn?.(); return landing?.enter(); }
      return;
  }
}

/* ======================================================================== */

export function registerLandingSettings() {
  const redraw = () => game.rutzCutin?.landing?.sync(true);
  game.settings.register(MODULE_ID, "landingShow", {
    name: "랜딩 페이지: 내 화면에 보이기", hint: "끄면 랜딩 장면에서도 바로 맵이 보입니다.",
    scope: "client", config: true, type: Boolean, default: true, onChange: redraw
  });
  game.settings.register(MODULE_ID, "landingMotion", {
    name: "랜딩 페이지: 움직임", hint: "빛줄기·안개·불티와 천천히 다가가는 배경. '줄이기'면 멈춘 그림만.",
    scope: "client", config: true, type: String, default: "full", choices: { full: "켜기", reduced: "줄이기" }, onChange: redraw
  });
}

export function onLandingSocket(data) {
  const landing = game.rutzCutin?.landing;
  if (data?.action === "landing-show") { landing?.showAgain(); return true; }
  if (data?.action === "landing-enter") { landing?.enter(); return true; }
  return false;
}

export function initLanding() {
  const landing = new Landing();
  landing.mount();
  return landing;
}
