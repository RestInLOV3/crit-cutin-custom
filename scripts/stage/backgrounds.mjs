import { MODULE_ID, setting } from "../config.mjs";
import { k, t } from "../i18n.mjs";

/* ======================================================================== *
 * Stage backgrounds (GM)
 *
 * A small library of pictures (or looping videos) in folders, shown as
 * thumbnails. Turning RP mode on opens the picker: "배경 없음" (the battle
 * map, blurred) comes first, then the pictures, the most recently used
 * first. Click one and it is up for everyone.
 *
 *   world setting stageBgLibrary = { folders: [{ id, name }], items: [{ id, src, name, folder, used }] }
 *   world setting stageBackdrop  = { src, dim }
 * ======================================================================== */

const AppV2 = foundry.applications.api.ApplicationV2;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MEDIA_RE = /\.(png|jpe?g|webp|avif|gif|svg|webm|mp4|m4v)(\?|#|$)/i;
const VIDEO_RE = /\.(webm|mp4|m4v|ogv)(\?|#|$)/i;
const id = () => foundry.utils?.randomID?.(10) ?? Math.random().toString(36).slice(2, 12);
const baseName = src => decodeURIComponent(String(src).split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();

export function library() {
  const raw = setting("stageBgLibrary", {}) ?? {};
  return {
    folders: Array.isArray(raw.folders) ? raw.folders.filter(f => f?.id) : [],
    items: Array.isArray(raw.items) ? raw.items.filter(i => i?.src) : []
  };
}

function saveLibrary(lib) {
  return game.settings.set(MODULE_ID, "stageBgLibrary", { folders: lib.folders, items: lib.items });
}

/** What is up now: { src, dim }. Falls back to the scene's old per-scene picture (v0.3). */
export function currentBackdrop() {
  const raw = setting("stageBackdrop", {}) ?? {};
  const dim = Number.isFinite(Number(raw.dim)) ? Number(raw.dim) : 0.3;
  if (raw.src !== undefined) return { src: raw.src || "", dim };
  const scene = globalThis.canvas?.scene;
  return { src: scene?.getFlag?.(MODULE_ID, "stageBg") ?? "", dim: Number(scene?.getFlag?.(MODULE_ID, "stageBgDim") ?? dim) };
}

export async function setBackdrop(src, { dim } = {}) {
  if (!game.user.isGM) return;
  const now = currentBackdrop();
  await game.settings.set(MODULE_ID, "stageBackdrop", { src: src ?? "", dim: dim ?? now.dim });
  if (!src) return;
  const lib = library();
  const item = lib.items.find(i => i.src === src);
  if (item) item.used = Date.now();
  else lib.items.push({ id: id(), src, name: baseName(src), folder: null, used: Date.now() });
  await saveLibrary(lib);
}

export function isVideo(src) {
  return VIDEO_RE.test(String(src ?? ""));
}

function filePicker(options) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  try { new FP(options).render(true); return FP; }
  catch (_) { ui.notifications.warn(t("Common.NoFilePicker")); return null; }
}

/* ======================================================================== */

let picker = null;

export function openBackgroundPicker() {
  if (!game.user.isGM) return;
  if (picker?.rendered) { picker.render(); picker.bringToFront?.(); return picker; }
  return new BackgroundPicker().render(true);
}

export class BackgroundPicker extends AppV2 {
  static DEFAULT_OPTIONS = {
    id: "rcs-bg-picker",
    classes: ["rcs-bg-window"],
    window: { title: k("Backdrop.Title"), icon: "fa-solid fa-image", resizable: true },
    position: { width: 760, height: "auto" }
  };

  constructor(options) {
    super(options);
    this.tab = "all";
    this.editing = null;   // folder id being renamed, or "new"
  }

  /** One window: opening it again (settings menu, scene tool, bar) brings the open one forward. */
  render(...args) {
    if (picker && picker !== this && picker.rendered) {
      picker.render();
      picker.bringToFront?.();
      return picker;
    }
    picker = this;
    return super.render(...args);
  }

  async _renderHTML() {
    const lib = library();
    const cur = currentBackdrop();
    if (this.tab !== "all" && this.tab !== "none" && !lib.folders.some(f => f.id === this.tab)) this.tab = "all";
    const items = lib.items
      .filter(i => this.tab === "all" || (this.tab === "none" ? !i.folder || !lib.folders.some(f => f.id === i.folder) : i.folder === this.tab))
      .sort((a, b) => (Number(b.used) || 0) - (Number(a.used) || 0) || String(a.name).localeCompare(String(b.name), "ko"));
    const unfiled = lib.items.some(i => !i.folder || !lib.folders.some(f => f.id === i.folder));
    const tab = (key, label, extra = "") => `<button type="button" class="tab ${this.tab === key ? "on" : ""}" data-tab="${key}" ${extra}>${label}</button>`;
    const folderTab = f => this.editing === f.id
      ? `<input class="tab-edit" data-rename="${f.id}" value="${esc(f.name)}" maxlength="30">`
      : `${tab(f.id, esc(f.name), `data-folder="${f.id}" data-tooltip="${esc(t("Backdrop.FolderTip"))}"`)}${this.tab === f.id ? `<button type="button" class="tab-del" data-del-folder="${f.id}" data-tooltip="${esc(t("Backdrop.DeleteFolder"))}"><i class="fa-solid fa-xmark"></i></button>` : ""}`;
    const thumb = i => {
      const media = isVideo(i.src) ? `<video src="${esc(i.src)}" muted preload="metadata"></video>` : `<img src="${esc(i.src)}" alt="" loading="lazy">`;
      return `<div class="thumb ${cur.src === i.src ? "on" : ""}" data-src="${esc(i.src)}" data-item="${i.id}" draggable="true" data-tooltip="${esc(i.name)}">
        ${media}<span class="name">${esc(i.name)}</span>
        <button type="button" class="rm" data-rm="${i.id}" data-tooltip="${esc(t("Backdrop.RemoveItem"))}"><i class="fa-solid fa-xmark"></i></button></div>`;
    };
    return `<div class="rcs-bgp">
      <nav class="tabs">${tab("all", esc(t("Backdrop.All")))}${lib.folders.map(folderTab).join("")}${unfiled && lib.folders.length ? tab("none", esc(t("Backdrop.NoFolder"))) : ""}
        ${this.editing === "new" ? `<input class="tab-edit" data-rename="new" placeholder="${esc(t("Backdrop.NewFolderName"))}" maxlength="30">` : `<button type="button" class="tab add" data-act="folder" data-tooltip="${esc(t("Backdrop.NewFolder"))}"><i class="fa-solid fa-folder-plus"></i></button>`}</nav>
      <div class="grid">
        <div class="thumb none ${cur.src ? "" : "on"}" data-src=""><span class="blank"><i class="fa-solid fa-map"></i>${t("Backdrop.None")}<small>${t("Backdrop.NoneHint")}</small></span></div>
        ${items.map(thumb).join("")}
        ${items.length ? "" : `<p class="hint empty">${lib.items.length ? t("Backdrop.EmptyFolder") : t("Backdrop.EmptyLibrary")}</p>`}
      </div>
      <footer>
        <label class="dim">${t("Backdrop.Dim")} <input type="range" data-dim min="0" max="0.85" step="0.05" value="${cur.dim}"><output>${Math.round(cur.dim * 100)}%</output></label>
        <span class="grow"></span>
        <button type="button" data-act="add"><i class="fa-solid fa-plus"></i> ${t("Backdrop.AddPicture")}</button>
        <button type="button" data-act="import"><i class="fa-solid fa-folder-open"></i> ${t("Backdrop.ImportFolder")}</button>
        <button type="button" data-act="close">${t("Common.Close")}</button>
      </footer>
      <p class="hint">${t("Backdrop.Hint")}</p>
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelector(".tab-edit")?.focus();
  }

  _onFirstRender() {
    const root = this.element.querySelector(".window-content");
    root.addEventListener("click", ev => this._onClick(ev));
    root.addEventListener("dblclick", ev => {
      const f = ev.target.closest("[data-folder]");
      if (f) { this.editing = f.dataset.folder; this.render(); }
    });
    root.addEventListener("input", ev => {
      if (!ev.target.matches("[data-dim]")) return;
      const v = Number(ev.target.value);
      ev.target.nextElementSibling.textContent = `${Math.round(v * 100)}%`;
      game.rutzCutin?.stage?.previewDim?.(v);
    });
    root.addEventListener("change", ev => {
      if (ev.target.matches("[data-dim]")) game.settings.set(MODULE_ID, "stageBackdrop", { ...currentBackdrop(), dim: Number(ev.target.value) });
    });
    root.addEventListener("keydown", ev => {
      if (!ev.target.matches(".tab-edit")) return;
      if (ev.key === "Enter") { ev.preventDefault(); this._finishEdit(ev.target); }
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); this.editing = null; this.render(); }
    });
    root.addEventListener("focusout", ev => { if (ev.target.matches(".tab-edit")) this._finishEdit(ev.target); });
    // Drag a picture onto a folder tab to move it there.
    root.addEventListener("dragstart", ev => {
      const t = ev.target.closest(".thumb[data-item]");
      if (t) ev.dataTransfer.setData("text/rcs-bg", t.dataset.item);
    });
    root.addEventListener("dragover", ev => {
      const tab = ev.target.closest(".tab[data-tab]");
      if (!tab || !ev.dataTransfer.types.includes("text/rcs-bg")) return;
      ev.preventDefault();
      tab.classList.add("drop");
    });
    root.addEventListener("dragleave", ev => ev.target.closest(".tab")?.classList.remove("drop"));
    root.addEventListener("drop", async ev => {
      const tab = ev.target.closest(".tab[data-tab]");
      const itemId = ev.dataTransfer.getData("text/rcs-bg");
      if (!tab || !itemId) return;
      ev.preventDefault();
      const lib = library();
      const item = lib.items.find(i => i.id === itemId);
      if (!item) return;
      item.folder = tab.dataset.folder ?? null;
      await saveLibrary(lib);
      this.render();
    });
  }

  async _finishEdit(input) {
    // Enter, then the focus leaving the removed box: only the first one counts.
    const target = input.dataset.rename;
    if (this._finishing || this.editing !== target) return;
    this._finishing = true;
    const name = input.value.trim();
    this.editing = null;
    const lib = library();
    if (name) {
      if (target === "new") { const f = { id: id(), name }; lib.folders.push(f); this.tab = f.id; }
      else { const f = lib.folders.find(x => x.id === target); if (f) f.name = name; }
      await saveLibrary(lib);
    }
    this._finishing = false;
    this.render();
  }

  async _onClick(ev) {
    const target = ev.target;
    const rm = target.closest("[data-rm]");
    if (rm) {
      const lib = library();
      lib.items = lib.items.filter(i => i.id !== rm.dataset.rm);
      await saveLibrary(lib);
      return this.render();
    }
    const delFolder = target.closest("[data-del-folder]");
    if (delFolder) {
      const lib = library();
      lib.folders = lib.folders.filter(f => f.id !== delFolder.dataset.delFolder);
      for (const i of lib.items) if (i.folder === delFolder.dataset.delFolder) i.folder = null;
      await saveLibrary(lib);
      this.tab = "all";
      return this.render();
    }
    const tab = target.closest("[data-tab]");
    if (tab) { this.tab = tab.dataset.tab; return this.render(); }
    const thumb = target.closest(".thumb");
    if (thumb) {
      const dim = Number(this.element.querySelector("[data-dim]")?.value);
      await setBackdrop(thumb.dataset.src, { dim: Number.isFinite(dim) ? dim : undefined });
      return this.close();
    }
    const act = target.closest("[data-act]")?.dataset.act;
    if (act === "close") return this.close();
    if (act === "folder") { this.editing = "new"; return this.render(); }
    if (act === "add") {
      return filePicker({ type: "imagevideo", callback: async path => {
        const lib = library();
        if (!lib.items.some(i => i.src === path)) lib.items.push({ id: id(), src: path, name: baseName(path), folder: this._folderForNew(lib), used: 0 });
        await saveLibrary(lib);
        this.render();
      } });
    }
    if (act === "import") {
      return filePicker({ type: "folder", callback: async (path, fp) => {
        const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        let files = [];
        try { files = (await FP.browse(fp?.activeSource ?? "data", path)).files ?? []; }
        catch (err) { return ui.notifications.warn(t("Backdrop.ReadFailed")); }
        files = files.filter(f => MEDIA_RE.test(f));
        if (!files.length) return ui.notifications.info(t("Backdrop.NoPictures"));
        const lib = library();
        const name = baseName(path.replace(/[\\/]+$/, "")) || t("Backdrop.ImportedFolder");
        let folder = lib.folders.find(f => f.name === name);
        if (!folder) { folder = { id: id(), name }; lib.folders.push(folder); }
        let added = 0;
        for (const src of files) {
          if (lib.items.some(i => i.src === src)) continue;
          lib.items.push({ id: id(), src, name: baseName(src), folder: folder.id, used: 0 });
          added++;
        }
        await saveLibrary(lib);
        this.tab = folder.id;
        ui.notifications.info(t("Backdrop.Imported", { count: added, name }));
        this.render();
      } });
    }
  }

  _folderForNew(lib) {
    return lib.folders.some(f => f.id === this.tab) ? this.tab : null;
  }

  _onClose(options) {
    super._onClose?.(options);
    if (picker === this) picker = null;
    game.rutzCutin?.stage?.refreshBackground?.();
  }
}
