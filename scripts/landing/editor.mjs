import { MODULE_ID } from "../config.mjs";
import { ACTIONS, DEFAULT_LANDING, FONTS, LANDING_FLAG, PARTICLES, TEMPLATES, landingClasses, landingConfig, landingHtml, landingVars } from "./landing.mjs";
import { t } from "../i18n.mjs";

/* ======================================================================== *
 * GM: dress up a scene's landing page. A live preview on the left (the very
 * same page, scaled down), four tabs on the right: 기본 · 메뉴 · 카드 · 조명.
 * Saved on the scene, so each landing scene can look different.
 * ======================================================================== */

const AppV2 = foundry.applications.api.ApplicationV2;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = x => foundry.utils?.deepClone?.(x) ?? structuredClone(x);
const MAX_MENU = 8;
const PREVIEW_W = 1280;
const PREVIEW_H = 720;
/** The new-button label saved by versions before the English translation (still replaced by a dropped document's name). */
const OLD_NEW_BUTTON = "새 버튼";

function filePicker(type, current, callback) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  try { new FP({ type, current, callback }).render(true); }
  catch (_) { ui.notifications.warn(t("Common.NoFilePickerPaste")); }
}

let editor = null;

export function openLandingEditor(scene = globalThis.canvas?.scene) {
  if (!game.user.isGM) return;
  if (!scene) return ui.notifications.warn(t("LandingEditor.NoScene"));
  // One editor; a second click (or a button firing twice) never closes the one opening.
  if (editor && editor.scene === scene) { if (editor.rendered) editor.bringToFront?.(); return editor; }
  if (editor?.rendered) editor.close();
  editor = new LandingEditor(scene);
  editor.render(true);
  return editor;
}

/** For the settings menu button: always the scene in view. */
export class LandingMenu extends AppV2 {
  render() { openLandingEditor(); return this; }
}

export class LandingEditor extends AppV2 {
  static DEFAULT_OPTIONS = {
    classes: ["rcl-editor"],
    window: { icon: "fa-solid fa-wand-magic-sparkles", resizable: true },
    position: { width: 1100, height: "auto" }
  };

  constructor(scene) {
    super({ id: `rcl-editor-${scene.id}`, window: { title: t("LandingEditor.Title", { name: scene.navName || scene.name }) } });
    this.scene = scene;
    this.draft = clone(landingConfig(scene));
    this.tab = "basic";
  }

  async _renderHTML() {
    const d = this.draft;
    const tabs = [["basic", t("LandingEditor.Tabs.basic"), "fa-solid fa-heading"], ["type", t("LandingEditor.Tabs.type"), "fa-solid fa-font"], ["menu", t("LandingEditor.Tabs.menu"), "fa-solid fa-list"], ["cards", t("LandingEditor.Tabs.cards"), "fa-solid fa-id-badge"], ["light", t("LandingEditor.Tabs.light"), "fa-solid fa-lightbulb"]];
    const nav = tabs.map(([id, label, icon]) => `<button type="button" class="${this.tab === id ? "active" : ""}" data-tab="${id}"><i class="${icon}"></i> ${label}</button>`).join("");
    return `
      <div class="rcl-ed">
        <div class="rcl-ed-left">
          <div class="rcl-preview"><div class="rcl-preview-inner"></div></div>
          <p class="hint">${t("LandingEditor.PreviewHint")}</p>
        </div>
        <div class="rcl-ed-right">
          <nav class="rcl-ed-tabs">${nav}</nav>
          <div class="rcl-ed-body">${this._tabHtml()}</div>
        </div>
      </div>
      <footer class="rcl-ed-foot">
        <label class="on"><input type="checkbox" data-f="enabled" ${d.enabled ? "checked" : ""}> ${t("LandingEditor.Enabled")}</label>
        <span class="grow"></span>
        <button type="button" data-act="reset"><i class="fa-solid fa-rotate-left"></i> ${t("LandingEditor.Reset")}</button>
        <button type="button" data-act="close">${t("Common.Close")}</button>
        <button type="button" data-act="save" class="primary"><i class="fa-solid fa-floppy-disk"></i> ${t("Common.Save")}</button>
      </footer>`;
  }

  _tabHtml() {
    const d = this.draft;
    const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? "selected" : ""}>${esc(label)}</option>`;
    const pick = (field, value, type, ph) => `<div class="pick"><input type="text" data-f="${field}" value="${esc(value)}" placeholder="${esc(ph)}"><button type="button" data-pick="${field}" data-type="${type}"><i class="fa-solid fa-file-image"></i></button></div>`;
    if (this.tab === "basic") {
      const tpl = Object.entries(TEMPLATES).map(([id, t]) => `<button type="button" class="tpl ${d.template === id ? "on" : ""}" data-tpl="${id}"><b>${esc(t.label)}</b><small>${esc(t.hint)}</small></button>`).join("");
      return `
        <div class="field">${t("LandingEditor.Look")}<div class="tpls">${tpl}</div></div>
        <label class="field">${t("LandingEditor.TitleField")} <input type="text" data-f="title" value="${esc(d.title)}" placeholder="${esc(t("LandingEditor.TitlePlaceholder"))}"></label>
        <div class="row2">
          <label class="field">${t("LandingEditor.Subtitle")} <input type="text" data-f="subtitle" value="${esc(d.subtitle)}" placeholder="${esc(t("LandingEditor.SubtitlePlaceholder"))}"></label>
          <label class="field">${t("LandingEditor.Tagline")} <input type="text" data-f="tagline" value="${esc(d.tagline)}" placeholder="${esc(t("LandingEditor.TaglinePlaceholder"))}"></label>
        </div>
        <label class="field">${t("LandingEditor.Note")} <input type="text" data-f="note" value="${esc(d.note)}" placeholder="${esc(t("LandingEditor.NotePlaceholder"))}"></label>
        <div class="row2">
          <label class="field">${t("LandingEditor.Background")} <select data-f="bgMode">${opt("image", t("LandingEditor.BgImage"), d.bgMode)}${opt("dark", t("LandingEditor.BgDark"), d.bgMode)}</select></label>
          <span></span>
        </div>
        ${d.bgMode === "dark" ? "" : `<div class="field">${t("LandingEditor.BgMedia")} ${pick("background", d.background, "imagevideo", t("LandingEditor.BgPlaceholder"))}</div>`}
        <div class="field">${t("LandingEditor.Logo")} ${pick("logo", d.logo, "image", t("LandingEditor.LogoPlaceholder"))}</div>
        <label class="field">${t("LandingEditor.Cover")} <select data-f="cover">${opt("board", t("LandingEditor.CoverBoard"), d.cover)}${opt("all", t("LandingEditor.CoverAll"), d.cover)}</select></label>`;
    }
    if (this.tab === "type") {
      const fonts = cur => Object.entries(FONTS).map(([k, f]) => opt(k, f.label, cur ?? "")).join("");
      const color = (field, label, fallback) => `<label class="field">${label}
        <div class="colorrow"><input type="color" data-f="${field}" value="${esc(d[field] || fallback)}"><label class="check"><input type="checkbox" data-own="${field}" ${d[field] ? "checked" : ""}> ${t("LandingEditor.Custom")}</label></div></label>`;
      return `
        <div class="row2">
          <label class="field">${t("LandingEditor.TitleFont")} <select data-f="titleFont">${fonts(d.titleFont)}</select></label>
          <label class="field">${t("LandingEditor.BodyFont")} <select data-f="bodyFont">${fonts(d.bodyFont)}</select></label>
        </div>
        <p class="hint">${t("LandingEditor.FontHint")}</p>
        <div class="row2">
          ${color("titleColor", t("LandingEditor.TitleColor"), "#f3ecd9")}
          ${color("textColor", t("LandingEditor.TextColor"), "#f3ecd9")}
        </div>
        <label class="field">${t("LandingEditor.AccentColor")} <input type="color" data-f="accent" value="${esc(d.accent || "#d8b45a")}"></label>
        <p class="hint">${t("LandingEditor.ColorHint")}</p>`;
    }
    if (this.tab === "menu") {
      const rows = (d.menu ?? []).map((m, i) => {
        const a = ACTIONS[m.action] ?? ACTIONS.enter;
        const target = a.target ? `<input type="text" class="target" data-m="${i}" data-k="target" value="${esc(m.target)}" placeholder="${a.target === "url" ? "https://…" : esc(t("LandingEditor.TargetPlaceholder"))}">` : `<span class="target none">—</span>`;
        return `<div class="mrow" data-i="${i}">
          <input type="text" class="icon" data-m="${i}" data-k="icon" value="${esc(m.icon)}" placeholder="fa-solid fa-star" data-tooltip="${esc(t("LandingEditor.IconTip"))}">
          <i class="${esc(m.icon || a.icon)} prev"></i>
          <input type="text" class="label" data-m="${i}" data-k="label" value="${esc(m.label)}" placeholder="${esc(t("LandingEditor.ButtonText"))}">
          <select data-m="${i}" data-k="action">${Object.entries(ACTIONS).map(([k, v]) => opt(k, v.label, m.action)).join("")}</select>
          ${target}
          <button type="button" data-mv="${i}" data-dir="-1" data-tooltip="${esc(t("LandingEditor.MoveUp"))}"><i class="fa-solid fa-arrow-up"></i></button>
          <button type="button" data-mv="${i}" data-dir="1" data-tooltip="${esc(t("LandingEditor.MoveDown"))}"><i class="fa-solid fa-arrow-down"></i></button>
          <button type="button" data-del="${i}" data-tooltip="${esc(t("Common.Delete"))}"><i class="fa-solid fa-trash"></i></button></div>`;
      }).join("");
      return `<p class="hint">${t("LandingEditor.MenuHint")}</p>
        <div class="mrows">${rows || `<p class="hint">${t("LandingEditor.NoButtons")}</p>`}</div>
        <div class="row"><button type="button" data-act="add-menu" ${(d.menu ?? []).length >= MAX_MENU ? "disabled" : ""}><i class="fa-solid fa-plus"></i> ${t("LandingEditor.AddButton")}</button></div>`;
    }
    if (this.tab === "cards") {
      const chars = game.actors.filter(a => a.type === "character").sort((a, b) => (b.hasPlayerOwner - a.hasPlayerOwner) || a.name.localeCompare(b.name, "ko"));
      const picked = new Set(d.cards.actors ?? []);
      const list = chars.map(a => `<label class="achk"><input type="checkbox" data-actor="${a.id}" ${picked.has(a.id) ? "checked" : ""}><img src="${esc(a.img)}" alt=""><span>${esc(a.name)}</span>${a.hasPlayerOwner ? "" : `<em>NPC</em>`}</label>`).join("");
      return `
        <label class="check"><input type="checkbox" data-c="show" ${d.cards.show ? "checked" : ""}> ${t("LandingEditor.ShowCards")}</label>
        <label class="check"><input type="checkbox" data-c="level" ${d.cards.level ? "checked" : ""}> ${t("LandingEditor.ShowLevel")}</label>
        <label class="check"><input type="checkbox" data-c="player" ${d.cards.player ? "checked" : ""}> ${t("LandingEditor.ShowPlayer")}</label>
        <div class="field">${t("LandingEditor.CardActors")} <span class="hint">${t("LandingEditor.CardActorsHint")}</span></div>
        <div class="achks">${list || `<p class="hint">${t("LandingEditor.NoActors")}</p>`}</div>`;
    }
    const L = d.lighting;
    const range = (k, label, min, max, step) => `<label class="field">${label}<div class="slider"><input type="range" data-l="${k}" min="${min}" max="${max}" step="${step}" value="${L[k]}"><output>${Math.round(L[k] * 100)}%</output></div></label>`;
    return `
      ${range("vignette", t("LandingEditor.Vignette"), 0, 1, 0.05)}
      ${range("grade", t("LandingEditor.Grade"), 0, 0.8, 0.05)}
      <label class="check"><input type="checkbox" data-l="rays" ${L.rays ? "checked" : ""}> ${t("LandingEditor.Rays")}</label>
      <label class="check"><input type="checkbox" data-l="fog" ${L.fog ? "checked" : ""}> ${t("LandingEditor.Fog")}</label>
      <label class="check"><input type="checkbox" data-l="flicker" ${L.flicker ? "checked" : ""}> ${t("LandingEditor.Flicker")}</label>
      <label class="field">${t("LandingEditor.Particles")} <select data-l="particles">${Object.entries(PARTICLES).map(([k, v]) => opt(k, v, L.particles)).join("")}</select></label>
      <p class="hint">${t("LandingEditor.LightHint")}</p>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onFirstRender() {
    const root = this.element.querySelector(".window-content");
    root.addEventListener("input", ev => this._onInput(ev));
    root.addEventListener("change", ev => this._onInput(ev));
    root.addEventListener("click", ev => this._onClick(ev));
    root.addEventListener("dragover", ev => { if (ev.target.closest(".mrow")) ev.preventDefault(); });
    root.addEventListener("drop", ev => this._onDrop(ev));
    this._resize = new ResizeObserver(() => this._fitPreview());
  }

  _onRender() {
    this._preview();
    const box = this.element.querySelector(".rcl-preview");
    if (box) this._resize?.observe(box);
  }

  _onClose(options) {
    super._onClose?.(options);
    this._resize?.disconnect();
    if (editor === this) editor = null;
  }

  _preview() {
    const inner = this.element?.querySelector(".rcl-preview-inner");
    if (!inner) return;
    inner.className = `rcl-preview-inner ${landingClasses(this.draft)}`;
    for (const k of ["--accent", "--title-font", "--body-font", "--title-color", "--ink"]) inner.style.removeProperty(k);
    for (const [k, v] of Object.entries(landingVars(this.draft))) inner.style.setProperty(k, v);
    inner.innerHTML = landingHtml(this.draft, this.scene, { preview: true });
    this._fitPreview();
  }

  _fitPreview() {
    const box = this.element?.querySelector(".rcl-preview");
    const inner = box?.querySelector(".rcl-preview-inner");
    if (!box || !inner) return;
    const k = box.clientWidth / PREVIEW_W;
    Object.assign(inner.style, { width: `${PREVIEW_W}px`, height: `${PREVIEW_H}px`, transform: `scale(${k})` });
  }

  _onInput(ev) {
    const el = ev.target;
    const d = this.draft;
    if (el.dataset.own) {
      const input = this.element.querySelector(`[data-f="${el.dataset.own}"]`);
      d[el.dataset.own] = el.checked ? input.value : "";
    } else if (el.dataset.f) {
      if ((el.dataset.f === "titleColor" || el.dataset.f === "textColor")) {
        d[el.dataset.f] = el.value;
        const own = this.element.querySelector(`[data-own="${el.dataset.f}"]`);
        if (own) own.checked = true;
      } else d[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value;
      if (el.dataset.f === "enabled") return;
      if (el.dataset.f === "bgMode" && ev.type === "change") return this.render();
    } else if (el.dataset.m !== undefined) {
      const m = d.menu[Number(el.dataset.m)];
      m[el.dataset.k] = el.value;
      if (el.dataset.k === "action") {
        if (!m.icon || Object.values(ACTIONS).some(a => a.icon === m.icon)) m.icon = ACTIONS[m.action]?.icon ?? m.icon;
        if (ev.type === "change") return this.render();
      }
      if (el.dataset.k === "icon") { const prev = el.parentElement.querySelector(".prev"); if (prev) prev.className = `${el.value} prev`; }
    } else if (el.dataset.c) {
      d.cards[el.dataset.c] = el.checked;
    } else if (el.dataset.actor) {
      const set = new Set(d.cards.actors ?? []);
      if (el.checked) set.add(el.dataset.actor); else set.delete(el.dataset.actor);
      d.cards.actors = [...set];
    } else if (el.dataset.l) {
      const k = el.dataset.l;
      d.lighting[k] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
      if (el.type === "range") el.nextElementSibling.textContent = `${Math.round(Number(el.value) * 100)}%`;
    } else return;
    this._preview();
  }

  async _onDrop(ev) {
    const row = ev.target.closest(".mrow");
    if (!row) return;
    ev.preventDefault();
    let data;
    try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch (_) { return; }
    if (!data?.uuid) return;
    const m = this.draft.menu[Number(row.dataset.i)];
    const map = { JournalEntry: "journal", JournalEntryPage: "journal", Scene: "scene", Macro: "macro" };
    if (map[data.type]) m.action = map[data.type];
    m.target = data.uuid;
    const doc = await fromUuid(data.uuid).catch(() => null);
    if (doc && (!m.label || m.label === t("LandingEditor.NewButton") || m.label === OLD_NEW_BUTTON)) m.label = doc.name;
    m.icon = ACTIONS[m.action]?.icon ?? m.icon;
    this.render();
  }

  async _onClick(ev) {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const d = this.draft;
    if (btn.dataset.tab) { this.tab = btn.dataset.tab; return this.render(); }
    if (btn.dataset.tpl) {
      // Colours and particles you never changed follow the new look.
      const before = TEMPLATES[d.template] ?? {};
      const after = TEMPLATES[btn.dataset.tpl] ?? {};
      if (!d.accent || d.accent === before.accent) d.accent = after.accent ?? d.accent;
      if (d.lighting.particles === before.particles) d.lighting.particles = after.particles ?? d.lighting.particles;
      d.template = btn.dataset.tpl;
      return this.render();
    }
    if (btn.dataset.pick) {
      const input = this.element.querySelector(`[data-f="${btn.dataset.pick}"]`);
      return filePicker(btn.dataset.type, input.value, path => { input.value = path; input.dispatchEvent(new Event("change", { bubbles: true })); });
    }
    if (btn.dataset.del !== undefined) { d.menu.splice(Number(btn.dataset.del), 1); return this.render(); }
    if (btn.dataset.mv !== undefined) {
      const i = Number(btn.dataset.mv);
      const j = i + Number(btn.dataset.dir);
      if (j < 0 || j >= d.menu.length) return;
      [d.menu[i], d.menu[j]] = [d.menu[j], d.menu[i]];
      return this.render();
    }
    const act = btn.dataset.act;
    if (act === "add-menu") { d.menu.push({ label: t("LandingEditor.NewButton"), icon: ACTIONS.journal.icon, action: "journal", target: "" }); return this.render(); }
    if (act === "reset") { this.draft = { ...clone(DEFAULT_LANDING), enabled: d.enabled, title: d.title, background: d.background }; return this.render(); }
    if (act === "close") return this.close();
    if (act === "save") {
      await this.scene.setFlag(MODULE_ID, LANDING_FLAG, clone(this.draft));
      ui.notifications.info(this.draft.enabled ? t("LandingEditor.Saved", { name: this.scene.navName || this.scene.name }) : t("LandingEditor.SavedOff"));
      game.rutzCutin?.landing?.showAgain?.();
      return this.close();
    }
  }
}
