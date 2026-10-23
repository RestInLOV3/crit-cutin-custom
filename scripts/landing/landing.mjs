import { MODULE_ID, setting } from "../config.mjs";
import { k, lazyLabels, t } from "../i18n.mjs";

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

/* Names, hints and labels below are getters: game.i18n is not ready while modules load. */
export const TEMPLATES = {
  cinematic: { get label() { return t("Landing.Templates.cinematic.Label"); }, get hint() { return t("Landing.Templates.cinematic.Hint"); }, accent: "#c9d6e8", particles: "dust" },
  fantasy: { get label() { return t("Landing.Templates.fantasy.Label"); }, get hint() { return t("Landing.Templates.fantasy.Hint"); }, accent: "#d8b45a", particles: "embers" },
  jrpg: { get label() { return t("Landing.Templates.jrpg.Label"); }, get hint() { return t("Landing.Templates.jrpg.Hint"); }, accent: "#5cc8ff", particles: "petals" },
  silhouette: { get label() { return t("Landing.Templates.silhouette.Label"); }, get hint() { return t("Landing.Templates.silhouette.Hint"); }, accent: "#ffb066", particles: "embers" },
  storybook: { get label() { return t("Landing.Templates.storybook.Label"); }, get hint() { return t("Landing.Templates.storybook.Hint"); }, accent: "#b5482e", particles: "petals" },
  neon: { get label() { return t("Landing.Templates.neon.Label"); }, get hint() { return t("Landing.Templates.neon.Hint"); }, accent: "#ff3cac", particles: "dust" },
  dossier: { get label() { return t("Landing.Templates.dossier.Label"); }, get hint() { return t("Landing.Templates.dossier.Hint"); }, accent: "#9b2222", particles: "none" },
  tarot: { get label() { return t("Landing.Templates.tarot.Label"); }, get hint() { return t("Landing.Templates.tarot.Hint"); }, accent: "#e6c46a", particles: "dust" }
};

/** Fonts the GM can pick (loaded from Google Fonts when used; without internet the default is used). */
export const FONTS = {
  "": { get label() { return t("Landing.Fonts.default"); } },
  serif: { get label() { return t("Landing.Fonts.serif"); }, stack: '"Noto Serif KR", "Nanum Myeongjo", "Batang", serif' },
  sans: { get label() { return t("Landing.Fonts.sans"); }, stack: '"Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif' },
  songmyung: { get label() { return t("Landing.Fonts.songmyung"); }, family: "Song Myung", stack: '"Song Myung", serif' },
  gowunbatang: { get label() { return t("Landing.Fonts.gowunbatang"); }, family: "Gowun Batang:wght@400;700", stack: '"Gowun Batang", serif' },
  hahmlet: { get label() { return t("Landing.Fonts.hahmlet"); }, family: "Hahmlet:wght@400;700;900", stack: '"Hahmlet", serif' },
  nanummyeongjo: { get label() { return t("Landing.Fonts.nanummyeongjo"); }, family: "Nanum Myeongjo:wght@400;700;800", stack: '"Nanum Myeongjo", serif' },
  diphylleia: { get label() { return t("Landing.Fonts.diphylleia"); }, family: "Diphylleia", stack: '"Diphylleia", serif' },
  blackhansans: { get label() { return t("Landing.Fonts.blackhansans"); }, family: "Black Han Sans", stack: '"Black Han Sans", sans-serif' },
  dohyeon: { get label() { return t("Landing.Fonts.dohyeon"); }, family: "Do Hyeon", stack: '"Do Hyeon", sans-serif' },
  jua: { get label() { return t("Landing.Fonts.jua"); }, family: "Jua", stack: '"Jua", sans-serif' },
  gowundodum: { get label() { return t("Landing.Fonts.gowundodum"); }, family: "Gowun Dodum", stack: '"Gowun Dodum", sans-serif' },
  orbit: { get label() { return t("Landing.Fonts.orbit"); }, family: "Orbit", stack: '"Orbit", sans-serif' },
  nanumpen: { get label() { return t("Landing.Fonts.nanumpen"); }, family: "Nanum Pen Script", stack: '"Nanum Pen Script", cursive' },
  gaegu: { get label() { return t("Landing.Fonts.gaegu"); }, family: "Gaegu:wght@400;700", stack: '"Gaegu", cursive' },
  typewriter: { get label() { return t("Landing.Fonts.typewriter"); }, family: "Nanum Gothic Coding:wght@400;700", stack: '"Courier Prime", "Courier New", "Nanum Gothic Coding", monospace' },
  cinzel: { get label() { return t("Landing.Fonts.cinzel"); }, family: "Cinzel:wght@400;700;900", stack: '"Cinzel", "Noto Serif KR", serif' }
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
  enter: { get label() { return t("Landing.Actions.enter"); }, icon: "fa-solid fa-door-open", target: false },
  sheet: { get label() { return t("Landing.Actions.sheet"); }, icon: "fa-solid fa-id-card", target: false },
  shop: { get label() { return t("Landing.Actions.shop"); }, icon: "fa-solid fa-store", target: false },
  journal: { get label() { return t("Landing.Actions.journal"); }, icon: "fa-solid fa-book-open", target: "uuid" },
  scene: { get label() { return t("Landing.Actions.scene"); }, icon: "fa-solid fa-map", target: "uuid" },
  url: { get label() { return t("Landing.Actions.url"); }, icon: "fa-solid fa-link", target: "url" },
  macro: { get label() { return t("Landing.Actions.macro"); }, icon: "fa-solid fa-scroll", target: "uuid" },
  stage: { get label() { return t("Landing.Actions.stage"); }, icon: "fa-solid fa-masks-theater", target: false }
};

export const PARTICLES = lazyLabels({ none: "Landing.Particles.none", embers: "Landing.Particles.embers", dust: "Landing.Particles.dust", snow: "Landing.Particles.snow", petals: "Landing.Particles.petals" });

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
  // The default buttons (editable, saved with the scene) in the viewer's language.
  get menu() {
    return [
      { label: t("Landing.Menu.enter"), icon: "fa-solid fa-door-open", action: "enter", target: "" },
      { label: t("Landing.Menu.shop"), icon: "fa-solid fa-store", action: "shop", target: "" },
      { label: t("Landing.Menu.sheet"), icon: "fa-solid fa-id-card", action: "sheet", target: "" }
    ];
  },
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
      <button type="button" data-gm="edit" data-tooltip="${esc(t("Landing.Design"))}"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
      <button type="button" data-gm="showAll" data-tooltip="${esc(t("Landing.ShowAll"))}"><i class="fa-solid fa-eye"></i></button>
      <button type="button" data-gm="enterAll" data-tooltip="${esc(t("Landing.EnterAll"))}"><i class="fa-solid fa-person-walking-arrow-right"></i></button>
      <button type="button" data-gm="close" data-tooltip="${esc(t("Landing.CloseMine"))}"><i class="fa-solid fa-xmark"></i></button></div>` : "";
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
      if (!actor) return ui.notifications.info(t("Landing.NoCharacter"));
      return actor.sheet?.render(true);
    }
    case "journal": {
      const doc = target ? await fromUuid(target).catch(() => null) : null;
      if (!doc) return ui.notifications.warn(t("Landing.NoJournal"));
      if (doc.documentName === "JournalEntryPage") return doc.parent?.sheet?.render(true, { pageId: doc.id });
      return doc.sheet?.render(true);
    }
    case "scene": {
      const doc = target ? await fromUuid(target).catch(() => null) : null;
      if (!doc) return ui.notifications.warn(t("Landing.NoScene"));
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
      if (!doc) return ui.notifications.warn(t("Landing.NoMacro"));
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
    name: k("Settings.landingShow.Name"), hint: k("Settings.landingShow.Hint"),
    scope: "client", config: true, type: Boolean, default: true, onChange: redraw
  });
  game.settings.register(MODULE_ID, "landingMotion", {
    name: k("Settings.landingMotion.Name"), hint: k("Settings.landingMotion.Hint"),
    scope: "client", config: true, type: String, default: "full", choices: { full: k("Settings.landingMotion.Choices.full"), reduced: k("Settings.landingMotion.Choices.reduced") }, onChange: redraw
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
