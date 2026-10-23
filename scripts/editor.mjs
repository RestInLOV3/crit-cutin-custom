import { DEFAULT_CONFIG, FLAG, MODULE_ID, badgeFor, buildSpec, cleanConfig, effectiveTemplate, fumbleArt, portraitOf, readConfig, setting, soundFor, tokenArtOf } from "./config.mjs";
import { FUMBLE_PRESETS, SOUND_PRESETS, interfaceVolume, playCutinSound } from "./sound.mjs";
import { DEFAULT_TEMPLATE, TEMPLATES, cropFor, renderCutin } from "./templates.mjs";
import { k, t } from "./i18n.mjs";

/* ======================================================================== *
 * Cut-in editor
 *
 * One window per character. Left: the cut-in itself, live, at its "hold"
 * frame — drag the picture to move it, wheel to zoom (per template, since a
 * close-up of the eyes and a half-body panel need different crops). Right:
 * template, picture, colours, text and sound. Nothing is saved until 저장.
 * ======================================================================== */

const AppV2 = foundry.applications.api.ApplicationV2;
const open = new Map();

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function filePicker(type, current, callback) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  try {
    new FP({ type, current, callback }).render(true);
  } catch (err) {
    ui.notifications.warn(t("Editor.NoFilePicker"));
  }
}

export { soundFor };

/** The select's value for a stored sound: "", synth1…5, none, or file. */
function soundChoice(sound) {
  const v = String(sound ?? "").trim();
  if (!v || v === "none" || /^(synth[1-5]|fumble[1-3])$/.test(v)) return v;
  return "file";
}

function soundOptions(selected) {
  const world = setting("soundPreset", "synth1");
  const worldLabel = SOUND_PRESETS[world] ?? (world === "file" ? t("Sound.File") : world === "none" ? t("Common.None") : SOUND_PRESETS.synth1);
  const opt = (value, label) => `<option value="${value}" ${selected === value ? "selected" : ""}>${esc(label)}</option>`;
  return [opt("", t("Editor.WorldDefault", { label: worldLabel })), ...Object.entries(SOUND_PRESETS).map(([k, label]) => opt(k, label)), opt("file", t("Sound.FileEllipsis")), opt("none", t("Sound.None"))].join("");
}

function fumbleSoundOptions(selected) {
  const world = setting("fumbleSound", "fumble1");
  const worldLabel = FUMBLE_PRESETS[world] ?? SOUND_PRESETS[world] ?? (world === "file" ? t("Sound.File") : world === "none" ? t("Common.None") : FUMBLE_PRESETS.fumble1);
  const opt = (value, label) => `<option value="${value}" ${selected === value ? "selected" : ""}>${esc(label)}</option>`;
  return [opt("", t("Editor.WorldDefault", { label: worldLabel.split(" — ")[0] })), ...Object.entries(FUMBLE_PRESETS).map(([k, label]) => opt(k, label)),
    ...Object.entries(SOUND_PRESETS).map(([k, label]) => opt(k, label)), opt("file", t("Sound.FileEllipsis")), opt("none", t("Sound.None"))].join("");
}

export function openEditor(actor) {
  if (!actor) return ui.notifications.warn(t("Editor.NoActor"));
  if (!actor.isOwner) return ui.notifications.warn(t("Editor.NotOwner"));
  const existing = open.get(actor.uuid);
  if (existing?.rendered) {
    existing.bringToFront?.();
    return existing;
  }
  const app = new CutinEditor(actor);
  open.set(actor.uuid, app);
  app.render(true);
  return app;
}

export class CutinEditor extends AppV2 {
  static DEFAULT_OPTIONS = {
    classes: ["rcc-editor"],
    window: { icon: "fa-solid fa-bolt", resizable: true },
    position: { width: 980, height: "auto" }
  };

  constructor(actor, options = {}) {
    super(foundry.utils.mergeObject({ id: `rcc-editor-${actor.id}`, window: { title: t("Editor.Title", { name: actor.name }) } }, options));
    this.actor = actor;
    this.draft = readConfig(actor);
    this._previewTimer = null;
    this._previewPlay = null;
    this.previewFumble = false;
  }

  get template() {
    return effectiveTemplate(this.draft);
  }

  /* The picture, flip and crop being edited follow the 치명타 / 대실패 switch. */
  get imgKey() { return this.previewFumble ? "fumbleImage" : "image"; }
  get flipKey() { return this.previewFumble ? "fumbleFlip" : "flip"; }
  get cropsKey() { return this.previewFumble ? "fumbleCrops" : "crops"; }
  /** The fumble shows the critical picture until it gets its own. */
  get sharedArt() { return this.previewFumble && !String(this.draft.fumbleImage ?? "").trim(); }

  get crop() {
    if (this.previewFumble) return cropFor(fumbleArt(this.actor, this.draft, this.template).crops, this.template);
    return cropFor(this.draft.crops, this.template);
  }

  get flipped() {
    return this.previewFumble ? fumbleArt(this.actor, this.draft, this.template).flip : !!this.draft.flip;
  }

  async _renderHTML() {
    const d = this.draft;
    const world = TEMPLATES[setting("defaultTemplate", DEFAULT_TEMPLATE)] ?? TEMPLATES[DEFAULT_TEMPLATE];
    const options = [`<option value="">${esc(t("Editor.WorldDefault", { label: world.label.split(" — ")[0] }))}</option>`]
      .concat(Object.entries(TEMPLATES).map(([key, t]) => `<option value="${key}" ${d.template === key ? "selected" : ""}>${esc(t.label)}</option>`))
      .join("");
    const portrait = portraitOf(this.actor);
    const tokenArt = tokenArtOf(this.actor);
    const gm = game.user.isGM;
    return `
      <div class="rcc-ed">
        <section class="rcc-ed-left">
          <div class="rcc-frame preview" data-preview aria-label="${esc(t("Editor.PreviewAria"))}" data-off-label="${esc(t("Editor.OffLabel"))}"></div>
          <p class="rcc-hint"><i class="fa-solid fa-hand"></i> ${t("Editor.DragHint")}</p>
          <p class="rcc-hint rcc-template-hint"></p>
          <!-- @plus -->
          <div class="rcc-row rcc-mode">
            <button type="button" data-act="mode-crit" class="${this.previewFumble ? "" : "on"}"><i class="fa-solid fa-bolt"></i> ${t("Editor.Crit")}</button>
            <button type="button" data-act="mode-fumble" class="${this.previewFumble ? "on" : ""}"><i class="fa-solid fa-heart-crack"></i> ${t("Editor.Fumble")}</button>
          </div>
          <!-- @end-plus -->
          <div class="rcc-row">
            <button type="button" data-act="play-here"><i class="fa-solid fa-play"></i> ${t("Editor.PlayHere")}</button>
            <button type="button" data-act="play-full"><i class="fa-solid fa-expand"></i> ${t("Editor.PlayFull")}</button>
            ${gm ? `<button type="button" data-act="broadcast" data-tooltip="${esc(t("Editor.BroadcastTip"))}"><i class="fa-solid fa-tower-broadcast"></i> ${t("Editor.Broadcast")}</button>` : ""}
            <span class="grow"></span>
            <button type="button" data-act="reset-crop" data-tooltip="${esc(t("Editor.ResetCropTip"))}"><i class="fa-solid fa-crosshairs"></i> ${t("Editor.ResetCrop")}</button>
          </div>
        </section>
        <section class="rcc-ed-right">
          <label class="rcc-check"><input type="checkbox" name="enabled" ${d.enabled !== false ? "checked" : ""}> ${t("Editor.Enabled")}</label>

          <label class="rcc-field"><span>${t("Editor.Template")}</span><select name="template">${options}</select></label>

          <div class="rcc-field rcc-art-field ${this.previewFumble ? "fumble" : ""}"><span>${t("Editor.Picture")} — ${this.previewFumble ? `<b class="rcc-tag f"><i class="fa-solid fa-heart-crack"></i> ${t("Editor.Fumble")}</b>` : `<b class="rcc-tag c"><i class="fa-solid fa-bolt"></i> ${t("Editor.Crit")}</b>`} <em>${t("Editor.PictureNote")}</em></span>
            <div class="rcc-pick">
              <input type="text" name="image" value="${esc(d[this.imgKey])}" placeholder="${esc(this.previewFumble ? t("Editor.FumbleImagePlaceholder") : t("Common.EmptyPortrait"))}">
              <button type="button" data-pick="image" data-tooltip="${esc(t("Common.ChooseFile"))}"><i class="fa-solid fa-file-image"></i></button>
            </div>
            <div class="rcc-row small">
              ${this.previewFumble ? `<button type="button" data-act="same-as-crit" ${this.sharedArt ? "disabled" : ""}><i class="fa-solid fa-link"></i> ${t("Editor.SameAsCrit")}</button>` : ""}
              <button type="button" data-act="use-portrait" ${portrait ? "" : "disabled"}><i class="fa-solid fa-user"></i> ${t("Editor.Portrait")}</button>
              <button type="button" data-act="use-token" ${tokenArt ? "" : "disabled"}><i class="fa-solid fa-circle-user"></i> ${t("Editor.TokenArt")}</button>
              <label class="rcc-check inline"><input type="checkbox" name="flip" ${this.flipped ? "checked" : ""} ${this.sharedArt ? "disabled" : ""}> ${t("Common.Flip")}</label>
            </div>
          </div>

          <div class="rcc-field"><span>${t("Editor.Crop")} <em>${t("Editor.ThisTemplate")}</em></span>
            <div class="rcc-slider"><i class="fa-solid fa-magnifying-glass-plus"></i><input type="range" name="zoom" min="1" max="4" step="0.01"><output data-for="zoom"></output></div>
            <div class="rcc-slider"><i class="fa-solid fa-arrows-left-right"></i><input type="range" name="x" min="0" max="100" step="0.5"><output data-for="x"></output></div>
            <div class="rcc-slider"><i class="fa-solid fa-arrows-up-down"></i><input type="range" name="y" min="0" max="100" step="0.5"><output data-for="y"></output></div>
          </div>

          <div class="rcc-field"><span>${t("Editor.Colors")}</span>
            <div class="rcc-row small">
              <label class="rcc-color">${t("Editor.Accent")} <input type="color" name="accent"></label>
              <label class="rcc-color">${t("Editor.Base")} <input type="color" name="accent2"></label>
              <button type="button" data-act="reset-colors"><i class="fa-solid fa-rotate-left"></i> ${t("Editor.ResetColors")}</button>
            </div>
          </div>

          <label class="rcc-field"><span>${t("Editor.Headline")}</span><input type="text" name="title" maxlength="24" value="${esc(d.title)}" placeholder="${esc(setting("defaultTitle", "CRITICAL!") || "CRITICAL!")}"></label>
          <label class="rcc-field"><span>${t("Editor.Quote")} <em>${t("Common.Optional")}</em></span><input type="text" name="quote" maxlength="60" value="${esc(d.quote)}" placeholder="${esc(t("Editor.QuotePlaceholder"))}"></label>

          <div class="rcc-field"><span>${t("Editor.Badge")}</span>
            <div class="rcc-row small">
              <input type="text" name="badge" maxlength="24" value="${esc(d.badge)}" placeholder="${esc(setting("badgeText", "NAT 20") || t("Editor.BadgeOff"))}">
              <label class="rcc-check inline"><input type="checkbox" name="hideBadge" ${d.hideBadge ? "checked" : ""}> ${t("Editor.HideBadge")}</label>
            </div>
          </div>

          <div class="rcc-field"><span>${t("Editor.Sound")}</span>
            <div class="rcc-row small">
              <select name="soundChoice">${soundOptions(soundChoice(d.sound))}</select>
              <button type="button" data-act="listen" data-tooltip="${esc(t("Editor.ListenTip"))}"><i class="fa-solid fa-volume-high"></i> ${t("Editor.Listen")}</button>
            </div>
            <div class="rcc-pick" data-sound-file ${soundChoice(d.sound) === "file" ? "" : "hidden"}>
              <input type="text" name="sound" value="${esc(soundChoice(d.sound) === "file" ? d.sound : "")}" placeholder="${esc(t("Editor.SoundPath"))}">
              <button type="button" data-pick="sound" data-tooltip="${esc(t("Common.ChooseFile"))}"><i class="fa-solid fa-file-audio"></i></button>
            </div>
          </div>

          <!-- @plus -->
          <details class="rcc-fumble-ed" ${this.previewFumble ? "open" : ""}><summary><i class="fa-solid fa-heart-crack"></i> ${t("Editor.FumbleSection")} <em>${t("Editor.FumbleSectionNote")}</em></summary>
            <label class="rcc-check"><input type="checkbox" name="fumbleEnabled" ${d.fumbleEnabled !== false ? "checked" : ""}> ${t("Editor.FumbleEnabled")}</label>
            <label class="rcc-field"><span>${t("Editor.Headline")}</span><input type="text" name="fumbleTitle" maxlength="24" value="${esc(d.fumbleTitle)}" placeholder="${esc(setting("fumbleTitle", "FUMBLE…") || "FUMBLE…")}"></label>
            <label class="rcc-field"><span>${t("Editor.Quote")} <em>${t("Common.Optional")}</em></span><input type="text" name="fumbleQuote" maxlength="60" value="${esc(d.fumbleQuote)}" placeholder="${esc(t("Editor.FumbleQuotePlaceholder"))}"></label>
            <label class="rcc-field"><span>${t("Editor.FumbleBadge")}</span><input type="text" name="fumbleBadge" maxlength="24" value="${esc(d.fumbleBadge)}" placeholder="${esc(setting("fumbleBadge", "NAT 1") || t("Editor.BadgeOff"))}"></label>
            <div class="rcc-field"><span>${t("Editor.Sound")}</span>
              <div class="rcc-row small">
                <select name="fumbleSoundChoice">${fumbleSoundOptions(soundChoice(d.fumbleSound))}</select>
                <button type="button" data-act="listen-fumble" data-tooltip="${esc(t("Editor.ListenFumbleTip"))}"><i class="fa-solid fa-volume-high"></i> ${t("Editor.Listen")}</button>
              </div>
              <div class="rcc-pick" data-fumble-file ${soundChoice(d.fumbleSound) === "file" ? "" : "hidden"}>
                <input type="text" name="fumbleSound" value="${esc(soundChoice(d.fumbleSound) === "file" ? d.fumbleSound : "")}" placeholder="${esc(t("Editor.SoundPath"))}">
                <button type="button" data-pick="fumbleSound" data-tooltip="${esc(t("Common.ChooseFile"))}"><i class="fa-solid fa-file-audio"></i></button>
              </div>
            </div>
          </details>
          <!-- @end-plus -->
        </section>
      </div>
      <footer class="rcc-ed-footer">
        <button type="button" data-act="defaults"><i class="fa-solid fa-eraser"></i> ${t("Editor.Defaults")}</button>
        <span class="grow"></span>
        <button type="button" data-act="cancel">${t("Common.Close")}</button>
        <button type="button" data-act="save" class="primary"><i class="fa-solid fa-floppy-disk"></i> ${t("Common.Save")}</button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  /** The content element survives re-renders, so its listeners go on once. */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const root = this.element.querySelector(".window-content") ?? this.element;
    root.addEventListener("input", ev => this._onInput(ev));
    root.addEventListener("change", ev => this._onInput(ev));
    root.addEventListener("click", ev => this._onClick(ev));
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element.querySelector(".window-content") ?? this.element;
    this.root = root;
    this.preview = root.querySelector("[data-preview]");
    this._wirePreview();
    this._syncInputs();
    this._refreshPreview();
    if (this._scroll) { const body = root.querySelector(".rcc-ed"); if (body) body.scrollTop = this._scroll; this._scroll = 0; }
    if (this._refocus) {
      const el = root.querySelector(`[name="${this._refocus.name}"]`);
      if (el) { el.focus(); try { el.setSelectionRange(this._refocus.pos, this._refocus.pos); } catch (_) { /* not a text box */ } }
      this._refocus = null;
    }
  }

  _onClose(options) {
    super._onClose?.(options);
    clearTimeout(this._previewPlay);
    open.delete(this.actor.uuid);
  }

  /* ---------------- inputs ---------------- */

  _syncInputs() {
    const root = this.root;
    if (!root) return;
    const crop = this.crop;
    const set = (name, value) => { const el = root.querySelector(`[name="${name}"]`); if (el) el.value = value; };
    set("zoom", crop.zoom);
    set("x", crop.x);
    set("y", crop.y);
    const def = TEMPLATES[this.template];
    set("accent", this.draft.accent || def.accent);
    set("accent2", this.draft.accent2 || def.accent2);
    this._syncOutputs();
    const hint = root.querySelector(".rcc-template-hint");
    if (hint) hint.textContent = def.hint;
  }

  _syncOutputs() {
    const crop = this.crop;
    const out = (name, text) => { const el = this.root?.querySelector(`output[data-for="${name}"]`); if (el) el.textContent = text; };
    out("zoom", `${crop.zoom.toFixed(2)}×`);
    out("x", `${Math.round(crop.x)}%`);
    out("y", `${Math.round(crop.y)}%`);
  }

  _onInput(ev) {
    const el = ev.target;
    const name = el?.name;
    if (!name) return;
    const d = this.draft;
    switch (name) {
      case "template":
        d.template = el.value;
        this._syncInputs();
        return this._refreshPreview();
      case "enabled":
        d.enabled = el.checked;
        return this._refreshPreview();
      case "flip":
        d[this.flipKey] = el.checked;
        return this._refreshPreview();
      case "zoom":
      case "x":
      case "y":
        return this._setCrop({ [name]: Number(el.value) });
      case "accent":
      case "accent2":
        d[name] = el.value;
        this.preview?.querySelector(".rcc-stage")?.style.setProperty(name === "accent" ? "--a1" : "--a2", el.value);
        return;
      case "hideBadge":
        d.hideBadge = el.checked;
        return this._refreshPreview();
      case "soundChoice": {
        const fileRow = this.root.querySelector("[data-sound-file]");
        if (el.value === "file") {
          d.sound = this.root.querySelector('input[name="sound"]')?.value ?? "";
          fileRow?.removeAttribute("hidden");
        } else {
          d.sound = el.value;
          fileRow?.setAttribute("hidden", "");
        }
        return;
      }
      case "sound":
        d.sound = el.value;
        return;
      case "fumbleEnabled":
        d.fumbleEnabled = el.checked;
        return;
      case "fumbleSoundChoice": {
        const fileRow = this.root.querySelector("[data-fumble-file]");
        if (el.value === "file") {
          d.fumbleSound = this.root.querySelector('input[name="fumbleSound"]')?.value ?? "";
          fileRow?.removeAttribute("hidden");
        } else {
          d.fumbleSound = el.value;
          fileRow?.setAttribute("hidden", "");
        }
        return;
      }
      case "fumbleSound":
        d.fumbleSound = el.value;
        return;
      case "fumbleTitle":
      case "fumbleQuote":
      case "fumbleBadge":
        d[name] = el.value;
        // Show the fumble version once the field is left (a redraw while typing would break Korean input).
        if (!this.previewFumble) { if (ev.type === "change") return this._setMode(true); return; }
        clearTimeout(this._previewTimer);
        this._previewTimer = setTimeout(() => this._refreshPreview(), ev.type === "change" ? 0 : 180);
        return;
      case "image": {
        const was = this.sharedArt;
        d[this.imgKey] = el.value;
        // The fumble just got (or lost) its own picture: the switches that depend on it change.
        if (this.previewFumble && was !== this.sharedArt && ev.type === "change") return this.render();
        clearTimeout(this._previewTimer);
        this._previewTimer = setTimeout(() => this._refreshPreview(), ev.type === "change" ? 0 : 180);
        return;
      }
      case "title":
      case "quote":
      case "badge":
        d[name] = el.value;
        clearTimeout(this._previewTimer);
        this._previewTimer = setTimeout(() => this._refreshPreview(), ev.type === "change" ? 0 : 180);
    }
  }

  /** Crop changes only touch the picture's CSS variables: no re-render, no flicker. */
  _setCrop(patch) {
    const t = this.template;
    const crop = { ...this.crop, ...patch };
    crop.x = clamp(crop.x, 0, 100);
    crop.y = clamp(crop.y, 0, 100);
    crop.zoom = clamp(crop.zoom, 1, 4);
    const key = this.cropsKey;
    this.draft[key] = { ...this.draft[key], [t]: crop };
    const media = this.preview?.querySelector(".rcc-art img, .rcc-art video");
    if (media) {
      media.style.setProperty("--fx", `${crop.x}%`);
      media.style.setProperty("--fy", `${crop.y}%`);
      media.style.setProperty("--z", String(crop.zoom));
    }
    for (const name of ["zoom", "x", "y"]) {
      const input = this.root?.querySelector(`input[name="${name}"]`);
      if (input && document.activeElement !== input) input.value = crop[name];
    }
    this._syncOutputs();
  }

  _spec(extra = {}) {
    const fumble = this.previewFumble;
    return buildSpec(this.actor, this.draft, { nat20: false, ...extra, fumble, nat1: fumble && !!extra.nat20 });
  }

  /** Preview (and edit the picture of) the critical or the fumble version. Redrawn: the picture fields change with it. */
  _setMode(fumble) {
    if (this.previewFumble === fumble) return;
    this.previewFumble = fumble;
    const body = this.root?.querySelector(".rcc-ed");
    this._scroll = body?.scrollTop ?? 0;
    return this.render();
  }

  _refreshPreview({ play = false } = {}) {
    if (!this.preview) return;
    clearTimeout(this._previewPlay);
    const spec = this._spec({ nat20: true });
    this.preview.innerHTML = renderCutin(spec, { play });
    this.preview.classList.toggle("disabled", this.draft.enabled === false);
    if (play) this._previewPlay = setTimeout(() => this._refreshPreview(), spec.duration + 150);
  }

  /* ---------------- drag to move, wheel to zoom ---------------- */

  _wirePreview() {
    const box = this.preview;
    if (!box) return;
    box.addEventListener("pointerdown", ev => {
      if (ev.button !== 0) return;
      const art = box.querySelector(".rcc-art");
      const media = art?.querySelector("img, video");
      if (!art || !media) return;
      ev.preventDefault();
      if (box.querySelector(".rcc-stage.play")) this._refreshPreview();
      const rect = art.getBoundingClientRect();
      const start = { x: ev.clientX, y: ev.clientY, crop: this.crop };
      // How far the picture really travels as the focal point goes 0 → 100 %:
      // the cover overflow, scaled by the zoom, plus what the zoom itself adds.
      // So the picture follows the pointer one-to-one.
      const nw = media.naturalWidth || media.videoWidth || rect.width;
      const nh = media.naturalHeight || media.videoHeight || rect.height;
      const cover = Math.max(rect.width / nw, rect.height / nh);
      const z = start.crop.zoom;
      const travel = (overflow, size) => Math.max(z * overflow + (z - 1) * size, size * 0.05) / 100;
      const spareX = travel(nw * cover - rect.width, rect.width);
      const spareY = travel(nh * cover - rect.height, rect.height);
      const flip = this.flipped ? -1 : 1;
      box.setPointerCapture?.(ev.pointerId);
      box.classList.add("dragging");
      const move = e => this._setCrop({
        x: start.crop.x - (e.clientX - start.x) / spareX * flip,
        y: start.crop.y - (e.clientY - start.y) / spareY
      });
      const up = () => {
        box.removeEventListener("pointermove", move);
        box.classList.remove("dragging");
      };
      box.addEventListener("pointermove", move);
      box.addEventListener("pointerup", up, { once: true });
      box.addEventListener("pointercancel", up, { once: true });
    });
    box.addEventListener("wheel", ev => {
      ev.preventDefault();
      const zoom = this.crop.zoom * Math.exp(-ev.deltaY * 0.0015);
      this._setCrop({ zoom: Math.round(zoom * 100) / 100 });
    }, { passive: false });
  }

  /* ---------------- buttons ---------------- */

  async _onClick(ev) {
    const pick = ev.target.closest("[data-pick]")?.dataset.pick;
    if (pick) {
      const input = this.root.querySelector(`input[name="${pick}"]`);
      return filePicker((pick === "sound" || pick === "fumbleSound") ? "audio" : "imagevideo", input?.value ?? "", path => {
        if (!input) return;
        input.value = path;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    const act = ev.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const d = this.draft;
    switch (act) {
      case "listen":
      case "listen-fumble": {
        const volume = Math.min(1, (Number(setting("volume", 0.6)) || 0) * interfaceVolume() * 2);
        return playCutinSound({ ...soundFor(d, { fumble: act === "listen-fumble" }), volume: volume || 0.5 });
      }
      case "mode-crit": return this._setMode(false);
      case "mode-fumble": return this._setMode(true);
      case "play-here":
        return this._refreshPreview({ play: true });
      case "play-full":
        return game.rutzCutin?.player?.enqueue({ spec: this._spec({ nat20: true }), sound: soundFor(d, { fumble: this.previewFumble }) });
      case "broadcast":
        return game.rutzCutin?.broadcast?.(this.actor, cleanConfig(d), { nat20: true, fumble: this.previewFumble });
      case "reset-crop": {
        const crops = { ...d[this.cropsKey] };
        delete crops[this.template];
        d[this.cropsKey] = crops;
        this._syncInputs();
        return this._refreshPreview();
      }
      case "reset-colors":
        d.accent = "";
        d.accent2 = "";
        this._syncInputs();
        return this._refreshPreview();
      case "use-portrait":
        // The critical cut-in's empty field means the portrait; the fumble's means "the critical picture".
        d[this.imgKey] = this.previewFumble ? portraitOf(this.actor) : "";
        return this.previewFumble ? this.render() : (this._setField("image", ""), this._refreshPreview());
      case "use-token":
        d[this.imgKey] = tokenArtOf(this.actor);
        return this.previewFumble ? this.render() : (this._setField("image", d.image), this._refreshPreview());
      case "same-as-crit":
        d.fumbleImage = "";
        d.fumbleCrops = {};
        return this.render();
      case "defaults":
        this.draft = { ...DEFAULT_CONFIG, crops: {}, fumbleCrops: {} };
        return this.render();
      case "cancel":
        return this.close();
      case "save":
        return this._save();
    }
  }

  _setField(name, value) {
    const el = this.root?.querySelector(`[name="${name}"]`);
    if (el) el.value = value;
  }

  async _save() {
    const data = cleanConfig(this.draft);
    // Colours equal to the template's own are stored as "use the template's", so changing template keeps working.
    const def = TEMPLATES[this.template];
    if (data.accent.toLowerCase() === def.accent.toLowerCase()) data.accent = "";
    if (data.accent2.toLowerCase() === def.accent2.toLowerCase()) data.accent2 = "";
    try {
      await this.actor.update({ [`flags.${MODULE_ID}.-=${FLAG}`]: null }, { render: false });
      await this.actor.setFlag(MODULE_ID, FLAG, data);
      ui.notifications.info(t("Editor.Saved", { name: this.actor.name }));
      this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | save failed`, err);
      ui.notifications.error(t("Editor.SaveFailed"));
    }
  }
}

/* ======================================================================== *
 * "Which character?" — opened from the module settings
 * ======================================================================== */

export function editorCandidates() {
  const list = [];
  const add = actor => { if (actor?.isOwner && !list.includes(actor)) list.push(actor); };
  for (const token of canvas?.tokens?.controlled ?? []) add(token.actor);
  add(game.user.character);
  for (const actor of game.actors ?? []) if (actor.hasPlayerOwner) add(actor);
  if (!game.user.isGM) for (const actor of game.actors ?? []) add(actor);
  return list.slice(0, 50);
}

export class CutinMenu extends AppV2 {
  static DEFAULT_OPTIONS = {
    classes: ["rcc-menu"],
    window: { title: k("Editor.PickTitle"), icon: "fa-solid fa-bolt" },
    position: { width: 380, height: "auto" }
  };

  render(...args) {
    const list = editorCandidates();
    if (list.length === 1 && !game.user.isGM) {
      openEditor(list[0]);
      return this;
    }
    return super.render(...args);
  }

  async _renderHTML() {
    const list = editorCandidates();
    if (!list.length) return `<p class="rcc-hint">${t("Editor.PickNone")}</p>`;
    return `<p class="rcc-hint">${t("Editor.PickHint")}</p>
      <ul class="rcc-pick-list">${list.map(a => `
        <li><button type="button" data-uuid="${esc(a.uuid)}">
          <img src="${esc(portraitOf(a))}" alt=""><span>${esc(a.name)}</span>
          ${readConfig(a).enabled === false ? `<em>${t("Common.Off")}</em>` : ""}
        </button></li>`).join("")}</ul>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const root = this.element.querySelector(".window-content") ?? this.element;
    root.addEventListener("click", ev => {
      const uuid = ev.target.closest("[data-uuid]")?.dataset.uuid;
      if (!uuid) return;
      openEditor(fromUuidSync(uuid));
      this.close();
    });
  }
}
