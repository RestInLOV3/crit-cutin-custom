import { MODULE_ID, setting } from "../config.mjs";
import { RECENT_MS, computeStage } from "./state.mjs";
import { dialogueOf, linesWithRefs } from "./text.mjs";
import { canSpeakAs, parseKey, stageLook } from "./cast.mjs";
import { VIDEO_RE, analyzeMedia, placeFigure } from "./figure.mjs";
import { currentSpeaker, initSpeakers, keyOfSpeaker, voiceKeyFor } from "./speakers.mjs";
import { currentBackdrop, isVideo, openBackgroundPicker } from "./backgrounds.mjs";
import { showTipLater } from "../tips.mjs";

/* ======================================================================== *
 * Serious-RP stage (visual-novel mode)
 *
 * The GM switches it on; whoever starts typing walks on, and goes quiet again:
 *   typing / spoke a moment ago (hold, ~4 s) → bright, in front, never pushed off
 *   quiet < dim (~30 s)                      → slightly dimmed
 *   quiet ≥ dim                              → grey and set back
 *   quiet ≥ leave (~2 min)                   → steps off by itself
 * Stage full and someone new speaks → whoever said least lately gives up
 * their spot. The one talking (typing now, else the last to speak) is always
 * drawn in front of everyone else, so a big winged dragon never covers them.
 *
 * Light by design: plain HTML/CSS (no second WebGL canvas, no animation
 * library, no bundled fonts), pictures loaded only when someone walks on, one
 * module socket for "typing", and chat messages for everything else.
 * ======================================================================== */

export const SOCKET = `module.${MODULE_ID}`;
const TYPING_SEND_MS = 1500;
const TYPING_EXPIRE_MS = 4500;
// "@웃음" for a few seconds, "@@웃음" to keep it; never touches @Check[…] / @UUID[…].
const FACE_RE = /(^|[\s>]|&nbsp;)(@@?) ?([^\s@<>[\]{}|&]{1,20})(?=\s|$|<|&nbsp;)/g;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function stageActive() {
  return !!setting("stageActive", false);
}

function opts() {
  const num = (key, d) => { const v = Number(setting(key, d)); return Number.isFinite(v) ? v : d; };
  return {
    slots: [3, 4, 5].includes(num("stageSlots", 3)) ? num("stageSlots", 3) : 3,
    hold: Math.max(1, num("stageHold", 4)) * 1000,
    dim: Math.max(5, num("stageDim", 30)) * 1000,
    leave: Math.max(0, num("stageLeave", 120)) * 1000
  };
}

/** How long a "@표정" lasts: the setting (5 s), longer for a long line so it can be read. */
function faceMs(textLength = 0) {
  const base = Math.max(1, Number(setting("stageFaceSeconds", 5)) || 5) * 1000;
  return Math.max(base, Math.min(base * 2, textLength * 90));
}

function visibleText(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").replace(/ /g, " ").trim();
}

/** The visible part of the board (the sidebar excluded), like the HUD uses. */
function boardRect() {
  const board = document.getElementById("board")?.getBoundingClientRect?.();
  const left = Math.max(0, board?.left ?? 0);
  const top = Math.max(0, board?.top ?? 0);
  let right = Math.min(window.innerWidth, board?.right ?? window.innerWidth);
  const bottom = Math.min(window.innerHeight, board?.bottom ?? window.innerHeight);
  const sidebar = document.getElementById("sidebar");
  if (sidebar && sidebar.offsetParent !== null) {
    const side = sidebar.getBoundingClientRect();
    if (side.left > left && side.left < right) right = Math.min(right, side.left - 4);
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/* ---------------- players' view stays put while a backdrop covers the map ---------------- */

function lockPan(lock) {
  const c = globalThis.canvas;
  if (!c) return;
  if (lock && !c._rcsPan) {
    const pan = c.pan;
    const animatePan = c.animatePan;
    c._rcsPan = true;
    c.pan = function (...args) { return this.loading ? pan.apply(this, args) : undefined; };
    c.animatePan = function (...args) { return this.loading ? animatePan.apply(this, args) : Promise.resolve(false); };
  } else if (!lock && c._rcsPan) {
    delete c.pan;
    delete c.animatePan;
    delete c._rcsPan;
  }
}

/* ======================================================================== */

export class Stage {
  constructor() {
    this.el = null;
    this.entries = new Map();       // key → { last, typing, typingUntil, lines }
    this.layout = [];
    this.focus = null;              // key in front
    this.faces = new Map();         // key → { base, temp: { key, until } }
    this.line = null;               // { key, text, at, narration }
    this.timer = 0;
    this.faceTimer = 0;
    this.amTyping = null;           // key you are typing as
    this.lastSent = 0;
    this.figures = [];
  }

  /* ---------- mount / show ---------- */

  mount() {
    if (this.el) return;
    const el = document.createElement("section");
    el.id = "rcs-stage";
    el.className = "hidden";
    el.setAttribute("aria-label", "RP 무대");
    el.innerHTML = `
      <div class="rcs-bg"></div>
      <div class="rcs-cast"></div>
      <div class="rcs-box hidden"><div class="rcs-name"></div><div class="rcs-text"></div><div class="rcs-typing"></div></div>
      <div class="rcs-paused hidden" data-tooltip="일시정지 중"><i class="fa-solid fa-pause"></i></div>`;
    // Behind a framed stage: the battle map, darkened.
    this.veil = document.createElement("div");
    this.veil.id = "rcs-stage-veil";
    this.veil.className = "hidden";
    document.body.appendChild(this.veil);
    document.body.appendChild(el);
    this.el = el;
    this.bgEl = el.querySelector(".rcs-bg");
    this.castEl = el.querySelector(".rcs-cast");
    this.box = el.querySelector(".rcs-box");
    this.pausedEl = el.querySelector(".rcs-paused");
    this.box.addEventListener("pointerover", ev => this._refHover(ev));
    this.box.addEventListener("click", ev => this._refClick(ev));
    window.addEventListener("resize", () => this.place());
    Hooks.on("collapseSidebar", () => setTimeout(() => this.place(), 260));
    Hooks.on("canvasInit", () => lockPan(false));
    Hooks.on("canvasReady", () => this.refreshBackground());
    Hooks.on("updateScene", (scene, changes) => { if (scene.id === canvas.scene?.id && changes.flags?.[MODULE_ID]) this.refreshBackground(); });
    Hooks.on("pauseGame", () => this._syncPaused());
    this.sync();
  }

  get shown() {
    return !!this.el && !this.el.classList.contains("hidden");
  }

  sync() {
    const active = stageActive();
    const on = active && setting("stageShow", true) !== false;
    this.el.classList.toggle("hidden", !on);
    if (!on) this.veil?.classList.add("hidden");
    document.body.classList.toggle("rcs-stage-on", on);
    document.body.classList.toggle("rcs-hide-hud", on && setting("stageHideHud", true) !== false);
    document.body.classList.toggle("rcs-hide-pause", active && setting("stageHidePause", true) !== false);
    clearInterval(this.timer);
    this.bar?.render();
    if (!on) {
      this.stopTyping();
      this._syncLock();
      return;
    }
    this.place();
    this.refreshBackground();
    this._syncPaused();
    this.timer = setInterval(() => this.tick(), 1000);
    this.render();
  }

  place() {
    if (!this.shown) return;
    const r = boardRect();
    // Optional "scene window": the stage shrinks by a margin on every side.
    const inset = Math.min(15, Math.max(0, Number(setting("stageInset", 0)) || 0)) / 100;
    const dx = Math.round(r.width * inset);
    const dy = Math.round(r.height * inset);
    this.el.classList.toggle("framed", inset > 0);
    Object.assign(this.el.style, { left: `${r.left + dx}px`, top: `${r.top + dy}px`, width: `${r.width - 2 * dx}px`, height: `${r.height - 2 * dy}px` });
    this.veil.classList.toggle("hidden", !(inset > 0));
    Object.assign(this.veil.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    for (const fig of this.figures) this._layoutFig(fig);
  }

  refreshBackground() {
    if (!this.el) return;
    const { src, dim } = currentBackdrop();
    this.el.classList.toggle("has-bg", !!src);
    this.previewDim(dim);
    const current = this.bgEl.querySelector(".rcs-bg-media.on");
    if ((current?.dataset.src ?? "") !== (src ?? "")) {
      current?.classList.remove("on");
      if (current) setTimeout(() => current.remove(), 700);
      if (src) {
        const video = isVideo(src);
        const media = document.createElement(video ? "video" : "img");
        media.className = "rcs-bg-media";
        media.dataset.src = src;
        if (video) Object.assign(media, { muted: true, loop: true, autoplay: true, playsInline: true });
        else media.alt = "";
        const show = () => requestAnimationFrame(() => media.classList.add("on"));
        media.addEventListener(video ? "loadeddata" : "load", show, { once: true });
        media.addEventListener("error", show, { once: true });
        this.bgEl.appendChild(media);
        media.src = src;
      }
    }
    this._syncLock();
  }

  previewDim(dim) {
    this.el?.style.setProperty("--rcs-dim", String(Math.min(0.9, Math.max(0, Number(dim) || 0))));
  }

  _syncLock() {
    const locked = this.shown && !game.user.isGM && !!currentBackdrop().src && setting("stageLockView", true) !== false;
    document.body.classList.toggle("rcs-view-locked", locked);
    lockPan(locked);
  }

  _syncPaused() {
    this.pausedEl?.classList.toggle("hidden", !game.paused);
  }

  /* ---------- events in ---------- */

  _entry(key) {
    const e = this.entries.get(key) ?? { last: 0, typing: false, typingUntil: 0, lines: [] };
    this.entries.set(key, e);
    return e;
  }

  /**
   * One figure per character. A key for the actor alone and a key for one of
   * its tokens are the same speaker (whichever way a line or the typing
   * signal named it); only two different tokens of one actor are two speakers.
   */
  _canon(key) {
    const p = parseKey(key);
    if (!p || this.entries.has(key)) return key;
    const same = [...this.entries.keys()].filter(k => parseKey(k)?.actor === p.actor);
    if (!same.length) return key;
    if (!p.token) return same.sort((a, b) => (this.entries.get(b).last || 0) - (this.entries.get(a).last || 0))[0];
    const plain = same.find(k => !parseKey(k).token);
    if (!plain) return key;
    // The actor-only entry becomes this token's entry (same spot, no fade).
    this.entries.set(key, this.entries.get(plain));
    this.entries.delete(plain);
    this.layout = this.layout.map(k => (k === plain ? key : k));
    if (this.focus === plain) this.focus = key;
    for (const fig of this.figures) {
      if (fig.id === plain) fig.id = key;
      if (fig.target === plain) fig.target = key;
    }
    if (this.faces.has(plain)) { this.faces.set(key, this.faces.get(plain)); this.faces.delete(plain); }
    if (this.line?.key === plain) this.line.key = key;
    return key;
  }

  /** RP mode switched: a fresh, empty stage. */
  reset() {
    this.entries.clear();
    this.faces.clear();
    this.layout = [];
    this.focus = null;
    this.line = null;
    for (const fig of this.figures) { clearTimeout(fig.swap); fig.el.remove(); }
    this.figures = [];
    if (this.box) { this.box.classList.add("hidden"); this.box.dataset.key = ""; }
  }

  /** Someone (maybe you) is typing as `key`. */
  noteTyping(key, typing) {
    if (!key || !stageActive()) return;
    key = this._canon(key);
    const now = Date.now();
    const e = this._entry(key);
    e.typing = !!typing;
    e.typingUntil = typing ? now + TYPING_EXPIRE_MS : 0;
    e.last = now;
    this.render();
  }

  /** A line was spoken as `key`. */
  noteLine(key, message) {
    if (!key || !stageActive()) return;
    const text = dialogueOf(message);
    const face = message.getFlag?.(MODULE_ID, "face") ?? message.flags?.["pf2e-kr-hud"]?.face;
    if (!text && !face?.key) return;              // rolls and cards don't bring anyone on stage
    key = this._canon(key);
    const now = Date.now();
    const e = this._entry(key);
    e.typing = false;
    e.typingUntil = 0;
    e.last = now;
    e.lines = [...(e.lines ?? []).filter(t => now - t < RECENT_MS), now];
    if (face?.key && (!face.actor || face.actor === parseKey(key)?.actor)) this._setFace(key, face.key, !!face.keep || !!face.actor, text.length);
    if (text) this.line = { key, text, at: now, narration: false };
    this.render();
  }

  /** "@웃음" sent on its own: only the expression changes. */
  noteFace(key, face, keep) {
    if (!key || !stageActive()) return;
    key = this._canon(key);
    const e = this._entry(key);
    e.last = Date.now();
    this._setFace(key, face, keep, 0);
    this.render();
  }

  /** Someone talking in the voice channel (Discord, through the HUD's voice bridge). */
  noteVoice(key, speaking) {
    if (!key || !stageActive()) return;
    key = this._canon(key);
    const now = Date.now();
    const e = this._entry(key);
    // A burst of talking counts as one line for "who said least" (at most one per 10 s).
    if (speaking && !e.voice && now - (e.voiceLine ?? 0) > 10000) {
      e.lines = [...(e.lines ?? []).filter(t => now - t < RECENT_MS), now];
      e.voiceLine = now;
    }
    e.voice = !!speaking;
    e.typing = !!speaking;
    e.typingUntil = speaking ? now + 15000 : 0;
    e.last = now;
    this.render();
  }

  /** The GM's narrator: a narration line, no name plate. */
  noteNarration(message) {
    if (!stageActive()) return;
    const text = dialogueOf(message);
    if (!text) return;
    this.line = { key: null, text, at: Date.now(), narration: true };
    this.render();
  }

  _setFace(key, face, keep, textLength) {
    const f = this.faces.get(key) ?? { base: null, temp: null };
    if (face === "기본") { f.base = null; f.temp = null; }
    else if (keep) { f.base = face; f.temp = null; }
    else {
      f.temp = { key: face, until: Date.now() + faceMs(textLength) };
      clearTimeout(this.faceTimer);
      this.faceTimer = setTimeout(() => this.render(), f.temp.until - Date.now() + 40);
    }
    this.faces.set(key, f);
  }

  faceOf(key) {
    const f = this.faces.get(key);
    if (!f) return null;
    if (f.temp && f.temp.until > Date.now()) return f.temp.key;
    return f.base;
  }

  tick() {
    const now = Date.now();
    for (const e of this.entries.values()) {
      if (e.typing && e.typingUntil < now) { e.typing = false; e.voice = false; }
    }
    this.render();
  }

  /* ---------- drawing ---------- */

  render() {
    if (!this.shown) return;
    const o = opts();
    for (const key of [...this.entries.keys()]) if (!parseKey(key) || !game.actors.get(parseKey(key).actor)) this.entries.delete(key);
    const { slots, states, waiting, focus } = computeStage(this.layout, this.entries, Date.now(), { ...o, focus: this.focus });
    this.layout = slots;
    this.focus = focus;
    while (this.figures.length < o.slots) this.figures.push(this._figure());
    while (this.figures.length > o.slots) this.figures.pop().el.remove();
    slots.forEach((key, i) => this._updateFigure(this.figures[i], key, states[key], i, o.slots, key && key === focus));
    this._renderBox(waiting);
  }

  _figure() {
    const el = document.createElement("div");
    el.className = "rcs-fig empty";
    this.castEl.appendChild(el);
    return { el, id: null, target: null, swap: 0, src: null, layers: [], look: null, index: 0, total: 3 };
  }

  _updateFigure(fig, key, state, index, total, focus) {
    const moved = fig.index !== index || fig.total !== total;
    fig.index = index;
    fig.total = total;
    if (fig.target !== key) {
      // Swap who stands here: fade out, change, fade in. Nothing slides.
      fig.target = key;
      clearTimeout(fig.swap);
      if (fig.id) fig.el.classList.add("leaving");
      fig.swap = setTimeout(() => {
        fig.swap = 0;
        fig.id = fig.target;
        fig.src = null;
        for (const layer of fig.layers) layer.remove();
        fig.layers = [];
        fig.el.classList.remove("leaving");
        fig.el.classList.toggle("empty", !fig.id);
        if (!fig.id) return;
        fig.el.classList.add("entering");
        this._applyLook(fig, fig.id);
      }, fig.id ? 260 : 0);
    } else if (key && !fig.swap) {
      this._applyLook(fig, key);
      if (moved) this._layoutFig(fig);
    }
    fig.el.classList.remove("speaking", "listening", "idle", "focus");
    if (key && state) fig.el.classList.add(state);
    if (key && focus) fig.el.classList.add("focus");
    // The one talking is always in front; then the others by how lively they are.
    fig.el.style.zIndex = String(focus ? 10 : { speaking: 6, listening: 4, idle: 2 }[state] ?? 1);
  }

  /** Picture and expression; a changed expression cross-fades between two layers. */
  _applyLook(fig, key) {
    const look = stageLook(key);
    const face = this.faceOf(key);
    const src = (face && look.faces.find(f => f.key === face)?.img) || look.image;
    const sizeChanged = JSON.stringify([fig.look?.size, fig.look?.scale, fig.look?.offsetY, fig.look?.framing, fig.look?.flip])
      !== JSON.stringify([look.size, look.scale, look.offsetY, look.framing, look.flip]);
    fig.look = look;
    fig.el.dataset.name = look.name;
    if (fig.src !== src) this._setSrc(fig, src);
    else if (sizeChanged) this._layoutFig(fig);
  }

  _setSrc(fig, src) {
    fig.src = src;
    const video = VIDEO_RE.test(src);
    const layer = document.createElement(video ? "video" : "img");
    layer.className = "rcs-layer";
    if (video) Object.assign(layer, { muted: true, loop: true, autoplay: true, playsInline: true });
    else { layer.alt = ""; layer.decoding = "async"; layer.draggable = false; }
    const ready = ok => {
      if (fig.src !== src || !layer.isConnected) { layer.remove(); return; }
      if (!ok) {
        // A missing expression picture: fall back to the normal one.
        layer.remove();
        if (fig.look && src !== fig.look.image) this._setSrc(fig, fig.look.image);
        return;
      }
      layer._meta = analyzeMedia(layer, src);
      this._layoutLayer(fig, layer);
      const old = fig.layers;
      fig.layers = [layer];
      requestAnimationFrame(() => {
        layer.classList.add("on");
        fig.el.classList.remove("entering");
        for (const o of old) { o.classList.remove("on"); setTimeout(() => o.remove(), 340); }
      });
    };
    layer.addEventListener(video ? "loadeddata" : "load", () => ready(true), { once: true });
    layer.addEventListener("error", () => ready(false), { once: true });
    fig.el.appendChild(layer);
    layer.src = src;
  }

  _layoutFig(fig) {
    for (const layer of fig.layers) this._layoutLayer(fig, layer);
  }

  _layoutLayer(fig, layer) {
    if (!layer._meta || !fig.look) return;
    const W = this.el.clientWidth || boardRect().width;
    const H = this.el.clientHeight || boardRect().height;
    const look = fig.look;
    const r = placeFigure({ W, H, n: fig.total, index: fig.index, meta: layer._meta, size: look.size, framing: look.framing, scale: look.scale, offsetY: look.offsetY, flip: look.flip });
    layer.style.left = `${r.left.toFixed(1)}px`;
    layer.style.bottom = `${r.bottom.toFixed(1)}px`;
    layer.style.width = `${r.width.toFixed(1)}px`;
    layer.style.height = `${r.height.toFixed(1)}px`;
    layer.classList.toggle("flip", look.flip);
  }

  _renderBox(waiting) {
    const typing = [...this.entries].filter(([, e]) => e.typing);
    const typingNames = typing.map(([key]) => stageLook(key).name);
    const typingEl = this.box.querySelector(".rcs-typing");
    const typingText = typing.length ? `${typingNames.slice(0, 3).join(", ")} ${typing.every(([, e]) => e.voice) ? "말하는 중…" : "입력 중…"}` : "";
    // A line fades out after a while (setting, 1 minute), so nothing hangs around
    // while the table talks it over somewhere else.
    const life = Math.max(0, Number(setting("stageLineSeconds", 60)) || 0) * 1000;
    const line = this.line && (!life || Date.now() - this.line.at < life) ? this.line : null;
    if (typingEl.textContent !== typingText) typingEl.textContent = typingText;
    if (!line) {
      this.box.classList.toggle("hidden", !typingText);
      if (typingText) this.box.querySelector(".rcs-name").textContent = waiting.length ? stageLook(waiting[0]).name : typingNames[0] ?? "";
      return;
    }
    this.box.classList.remove("hidden");
    const id = `${line.key}|${line.at}`;
    if (this.box.dataset.key !== id) {
      this.box.dataset.key = id;
      this.box.classList.toggle("narration", !!line.narration);
      this.box.querySelector(".rcs-name").textContent = line.narration ? "" : stageLook(line.key).name;
      const textEl = this.box.querySelector(".rcs-text");
      textEl.innerHTML = linesWithRefs(line.text);
      if (setting("stageTypewriter", false)) this._typewriter(textEl);
    }
  }

  /** Optional: reveal the line letter by letter (about 40 a second; no shaking, no effects). */
  _typewriter(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push([walker.currentNode, walker.currentNode.textContent]);
    nodes.forEach(([n]) => { n.textContent = ""; });
    let i = 0;
    let shown = 0;
    clearInterval(this._tw);
    this._tw = setInterval(() => {
      if (i >= nodes.length) return clearInterval(this._tw);
      const [node, full] = nodes[i];
      shown += 1;
      node.textContent = full.slice(0, shown);
      if (shown >= full.length) { i++; shown = 0; }
    }, 25);
  }

  /** Click a highlighted word: open that item / journal page / actor, if you may see it. */
  async _refClick(ev) {
    const ref = ev.target.closest(".rcs-ref");
    if (!ref) return;
    ev.preventDefault();
    ev.stopPropagation();
    let doc = null;
    try { doc = await fromUuid(ref.dataset.uuid); } catch (_) { /* gone */ }
    if (!doc) return ui.notifications.warn(`'${ref.textContent}'을(를) 찾을 수 없습니다.`);
    const LIMITED = CONST.DOCUMENT_OWNERSHIP_LEVELS?.LIMITED ?? 1;
    if (!doc.pack && doc.testUserPermission && !doc.testUserPermission(game.user, LIMITED)) {
      return ui.notifications.warn(`'${doc.name}'을(를) 볼 권한이 없습니다.`);
    }
    game.tooltip?.deactivate?.();
    if (doc.documentName === "JournalEntryPage") return doc.parent?.sheet?.render(true, { pageId: doc.id });
    return doc.sheet?.render(true);
  }

  /** Hover a highlighted word: the item's name and a short summary. */
  async _refHover(ev) {
    const ref = ev.target.closest(".rcs-ref");
    if (!ref || ref.dataset.tooltip || ref.dataset.rtip || ref.dataset.rcsTip) return;
    ref.dataset.rcsTip = "1";
    let tip = esc(ref.textContent);
    try {
      const doc = await fromUuid(ref.dataset.uuid);
      const raw = String(doc?.system?.description?.value ?? doc?.text?.content ?? "");
      const div = document.createElement("div");
      div.innerHTML = raw.replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1");
      const summary = (div.textContent ?? "").replace(/\s+/g, " ").trim();
      tip = `<strong>${esc(doc?.name ?? ref.textContent)}</strong>${summary ? `<br>${esc(summary.length > 220 ? `${summary.slice(0, 219)}…` : summary)}` : ""}<br><small>눌러서 열기</small>`;
    } catch (_) { /* name only */ }
    ref.dataset.tooltip = tip;
    showTipLater(ref);
  }

  /* ---------- your own typing ---------- */

  onLocalInput(text) {
    if (!stageActive()) return;
    const key = currentSpeaker()?.key;
    if (!key || !canSpeakAs(game.user.id, parseKey(key).actor)) return this.stopTyping();
    if (!text || /^\/(w|whisper|ooc|gm|r|roll|gmr|br|sr|pr)\b/i.test(text) || /^\(\(|^\/\//.test(text)) return this.stopTyping();
    const now = Date.now();
    if (this.amTyping !== key || now - this.lastSent > TYPING_SEND_MS) {
      if (this.amTyping && this.amTyping !== key) this.stopTyping();
      this.amTyping = key;
      this.lastSent = now;
      game.socket.emit(SOCKET, { action: "stage-typing", userId: game.user.id, key, typing: true });
      this.noteTyping(key, true);
    }
  }

  stopTyping() {
    const key = this.amTyping;
    if (!key) return;
    this.amTyping = null;
    game.socket.emit(SOCKET, { action: "stage-typing", userId: game.user.id, key, typing: false });
    this.noteTyping(key, false);
  }
}

/* ======================================================================== *
 * Settings, switch, wiring
 * ======================================================================== */

function chatField(target) {
  return target?.closest?.("#chat-message") ?? target?.closest?.(":is(#chat-form, .chat-form) :is(textarea, [contenteditable='true'])") ?? null;
}

function fieldText(field) {
  if (typeof field.value === "string") return field.value.trim();
  const editable = field.matches?.("[contenteditable]") ? field : field.querySelector?.("[contenteditable]");
  return String((editable ?? field).innerText ?? "").trim();
}

export function registerStageSettings() {
  const stage = () => game.rutzCutin?.stage;
  const sync = () => stage()?.sync();
  const redraw = () => stage()?.render();
  const bar = () => stage()?.bar?.render();
  const s = (key, data) => game.settings.register(MODULE_ID, key, { config: true, ...data });
  const hidden = (key, type, def, onChange) => s(key, { scope: "world", config: false, type, default: def, onChange });
  hidden("stageActive", Boolean, false, () => { stage()?.reset(); sync(); refreshControls(); });
  hidden("stageCast", Object, {}, () => { bar(); redraw(); });
  hidden("stageBackdrop", Object, {}, () => stage()?.refreshBackground());
  hidden("stageBgLibrary", Object, {});
  hidden("stagePausedByUs", Boolean, false);

  s("stageSlots", { name: "RP 무대: 한 번에 서는 인원", hint: "5명은 넓은 화면에서만 권합니다. 칸이 좁아져 그림이 작아지고, 날개 같은 넓은 그림은 옆 칸에 겹칩니다.", scope: "world", type: Number, default: 3, choices: { 3: "3명", 4: "4명 (큰 화면)", 5: "5명 (아주 넓은 화면)" }, onChange: redraw });
  s("stageInset", { name: "RP 무대: 화면 가장자리 여백 (%)", hint: "0이면 화면 전체가 무대입니다. 값을 주면 사방이 그만큼 줄어든 '장면 창'이 되고, 바깥은 어둡게 가린 배틀맵이 보입니다. 권장 5~8.", scope: "world", type: Number, default: 0, range: { min: 0, max: 15, step: 1 }, onChange: () => stage()?.place() });
  s("stageHold", { name: "RP 무대: 발언권 (초)", hint: "말을 마친 뒤 이 시간 동안은 새로 온 캐릭터에게 밀려나지 않습니다. 입력 중일 때는 항상 지켜집니다.", scope: "world", type: Number, default: 4, range: { min: 1, max: 30, step: 1 }, onChange: redraw });
  s("stageDim", { name: "RP 무대: 회색으로 물러나기까지 (초)", scope: "world", type: Number, default: 30, range: { min: 10, max: 180, step: 5 }, onChange: redraw });
  s("stageLeave", { name: "RP 무대: 저절로 퇴장 (초)", hint: "이 시간 동안 아무 말이 없으면 새 화자가 없어도 무대에서 내려갑니다. 0이면 자리를 내줄 때까지 남습니다.", scope: "world", type: Number, default: 120, range: { min: 0, max: 600, step: 10 }, onChange: redraw });
  s("stageFaceSeconds", { name: "RP 무대: 표정 유지 (초)", hint: "대사의 \"@웃음\"은 이 시간(긴 대사는 조금 더) 뒤 기본 얼굴로 돌아옵니다. \"@@웃음\"은 바꿀 때까지 유지됩니다.", scope: "world", type: Number, default: 5, range: { min: 2, max: 20, step: 1 } });
  s("stageNarration", { name: "RP 무대: GM 나레이션", hint: "말하는 캐릭터 바의 🪶(나레이션)로 쓴 말을 이름표 없는 나레이션으로 대사창에 띄웁니다.", scope: "world", type: Boolean, default: true });
  s("stageLineSeconds", { name: "RP 무대: 대사가 사라지기까지 (초)", hint: "마지막 대사가 이 시간 뒤 대사창에서 사라집니다. 0이면 다음 대사까지 남습니다.", scope: "world", type: Number, default: 60, range: { min: 0, max: 600, step: 10 }, onChange: redraw });
  s("stageVoice", { name: "RP 무대: 음성(디스코드)으로도 등장", hint: "디스코드 음성 연동이 있으면, 말을 하는 사람의 캐릭터(바에 고정한 캐릭터, 없으면 할당된 캐릭터)가 입력할 때처럼 무대에 오릅니다. 바의 🎙 버튼으로도 켜고 끕니다.", scope: "world", type: Boolean, default: false, onChange: () => { bar(); redraw(); } });
  s("stageOwnedCast", { name: "RP 무대: 플레이어는 소유한 캐릭터로 말할 수 있음", hint: "끄면 GM이 'RP 발언권'에서 정해 준 캐릭터로만 말할 수 있습니다.", scope: "world", type: Boolean, default: true, onChange: () => { bar(); redraw(); } });
  s("stageTypewriter", { name: "RP 무대: 대사 타자기 효과", hint: "대사가 한 글자씩(초당 약 40자) 나타납니다. 끄면 한 번에 보입니다.", scope: "world", type: Boolean, default: false });
  s("stagePause", { name: "RP 모드 동안 게임 일시정지", hint: "RP 모드를 켜면 일시정지하고, 끌 때 원래대로 풀어 줍니다(이미 일시정지였으면 그대로 둡니다).", scope: "world", type: Boolean, default: true });
  s("stageHidePause", { name: "RP 모드 동안 일시정지 표시 숨기기", hint: "화면 가운데의 일시정지 그림·글자(Alternative Pause Text 포함)를 숨기고, 무대 구석에 작은 ⏸ 표시만 둡니다.", scope: "world", type: Boolean, default: true, onChange: sync });
  s("stagePickBg", { name: "RP 모드를 켤 때 배경 고르기 창 열기", scope: "world", type: Boolean, default: true });
  s("stageLockView", { name: "배경이 맵을 가리는 동안 플레이어 화면 고정", hint: "RP 배경 그림이 깔려 있으면 플레이어가 맵을 끌어 옮기거나 확대하거나 토큰 위에 마우스를 올릴 수 없습니다.", scope: "world", type: Boolean, default: true, onChange: () => stage()?.refreshBackground() });
  s("stageHideHud", { name: "RP 무대 중 파티 초상화·턴 트래커 숨기기", scope: "world", type: Boolean, default: true, onChange: sync });
  s("stageShow", { name: "내 화면에 RP 무대 보이기", scope: "client", type: Boolean, default: true, onChange: sync });
  s("speakerBar", {
    name: "말하는 캐릭터 바", hint: "채팅 입력창 위의 얼굴 줄. 누르면 그 캐릭터로 말하기가 고정됩니다(다른 토큰을 눌러도 안 바뀜). 자동: GM은 RP 모드이거나 바에 누가 있을 때, 플레이어는 캐릭터가 둘 이상일 때 보입니다.",
    scope: "client", type: String, default: "auto", choices: { auto: "자동", always: "항상", off: "끄기 (Foundry 기본대로)" }, onChange: bar
  });
}

function refreshControls() {
  try {
    const tools = ui.controls?.controls?.rutzToolkit?.tools ?? ui.controls?.controls?.tokens?.tools;
    if (tools?.rcsStage) tools.rcsStage.active = stageActive();
    ui.controls?.render?.();
  } catch (_) { /* older UI */ }
}

function togglePause(paused) {
  try { game.togglePause(paused, { broadcast: true }); } catch (_) { /* nothing to pause */ }
}

/** GM: RP mode on/off — pauses the game and opens the backdrop picker (settings). */
export async function setStageActive(on) {
  if (!game.user.isGM) return;
  on = !!on;
  if (on === stageActive()) { if (on && setting("stagePickBg", true)) openBackgroundPicker(); return; }
  await game.settings.set(MODULE_ID, "stageActive", on);
  if (setting("stagePause", true) !== false) {
    if (on && !game.paused) {
      await game.settings.set(MODULE_ID, "stagePausedByUs", true);
      togglePause(true);
    } else if (!on && setting("stagePausedByUs", false)) {
      await game.settings.set(MODULE_ID, "stagePausedByUs", false);
      if (game.paused) togglePause(false);
    }
  }
  if (on && setting("stagePickBg", true) !== false) openBackgroundPicker();
}

export function toggleStage() {
  return setStageActive(!stageActive());
}

export function initStage() {
  const stage = new Stage();
  stage.mount();
  stage.bar = initSpeakers();

  // Typing in the chat box.
  const onInput = ev => { const f = chatField(ev.target); if (f) stage.onLocalInput(fieldText(f)); };
  document.addEventListener("input", onInput, true);
  document.addEventListener("keyup", onInput, true);
  document.addEventListener("focusout", ev => { if (chatField(ev.target)) stage.stopTyping(); }, true);

  // Lines spoken on stage carry who said them; "@표정" keywords go into a flag.
  Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
    if (userId !== game.user.id || !stageActive()) return;
    if (message.rolls?.length || message.whisper?.length || message.blind) return;
    const key = keyOfSpeaker(message.speaker, userId);
    if (!key) return;
    const look = stageLook(key);
    const update = { [`flags.${MODULE_ID}.speaker`]: key };
    const content = String(message.content ?? "");
    const keys = new Set(look.faces.map(f => f.key).concat("기본"));
    let face = null;
    let keep = false;
    const stripped = content.replace(FACE_RE, (m, pre, at, word) => {
      if (!keys.has(word)) return m;
      face = word;
      keep = at.length === 2;
      return pre;
    });
    stage.stopTyping();
    if (face) {
      if (!visibleText(stripped)) {
        // Only a keyword: the expression changes for everyone, nothing is posted.
        stage.noteFace(key, face, keep);
        game.socket.emit(SOCKET, { action: "stage-face", userId, key, face, keep });
        return false;
      }
      update.content = stripped.replace(/(^|<p>|<br\s*\/?>)(\s|&nbsp;)+/g, "$1").trim();
      update[`flags.${MODULE_ID}.face`] = { key: face, keep };
    }
    if (!message.speaker?.alias) update["speaker.alias"] = look.name;
    message.updateSource(update);
  });

  Hooks.on("createChatMessage", message => {
    if (!stageActive() || message.visible === false || message.whisper?.length) return;
    const authorId = message.author?.id ?? message.user?.id;
    const flagged = message.getFlag?.(MODULE_ID, "speaker");
    const key = flagged && canSpeakAs(authorId, parseKey(flagged)?.actor) ? flagged : keyOfSpeaker(message.speaker, authorId);
    if (message.getFlag?.(MODULE_ID, "narration")) {
      if (game.users.get(authorId)?.isGM && setting("stageNarration", true) !== false) stage.noteNarration(message);
      return;
    }
    if (key) return stage.noteLine(key, message);
  });
  // Discord voice (the HUD's voice bridge fires this on every client).
  Hooks.on("rutzVoiceSpeaking", (userId, speaking) => {
    if (!stageActive() || setting("stageVoice", false) !== true) return;
    stage.noteVoice(voiceKeyFor(game.users.get(userId)), speaking);
  });
  return stage;
}

/** Socket messages for the stage (called from main.mjs). */
export function onStageSocket(data) {
  const stage = game.rutzCutin?.stage;
  if (data?.action === "stage-typing") {
    if (canSpeakAs(data.userId, parseKey(data.key)?.actor)) stage?.noteTyping(data.key, data.typing);
    return true;
  }
  if (data?.action === "stage-face") {
    if (canSpeakAs(data.userId, parseKey(data.key)?.actor)) stage?.noteFace(data.key, data.face, !!data.keep);
    return true;
  }
  return false;
}
