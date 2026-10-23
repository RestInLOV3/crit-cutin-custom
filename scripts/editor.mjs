import { DEFAULT_CONFIG, FLAG, MODULE_ID, badgeFor, buildSpec, cleanConfig, effectiveTemplate, fumbleArt, portraitOf, readConfig, setting, soundFor, tokenArtOf } from "./config.mjs";
import { FUMBLE_PRESETS, SOUND_PRESETS, interfaceVolume, playCutinSound } from "./sound.mjs";
import { DEFAULT_TEMPLATE, TEMPLATES, cropFor, renderCutin } from "./templates.mjs";

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
    ui.notifications.warn("파일 선택 창을 열 권한이 없습니다. 파일 경로를 직접 붙여 넣거나 GM에게 업로드를 부탁하세요.");
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
  const worldLabel = SOUND_PRESETS[world] ?? (world === "file" ? "파일" : world === "none" ? "없음" : "효과음 1");
  const opt = (value, label) => `<option value="${value}" ${selected === value ? "selected" : ""}>${esc(label)}</option>`;
  return [opt("", `월드 기본 (${worldLabel})`), ...Object.entries(SOUND_PRESETS).map(([k, label]) => opt(k, label)), opt("file", "파일…"), opt("none", "효과음 없음")].join("");
}

function fumbleSoundOptions(selected) {
  const world = setting("fumbleSound", "fumble1");
  const worldLabel = FUMBLE_PRESETS[world] ?? SOUND_PRESETS[world] ?? (world === "file" ? "파일" : world === "none" ? "없음" : "실패음 1");
  const opt = (value, label) => `<option value="${value}" ${selected === value ? "selected" : ""}>${esc(label)}</option>`;
  return [opt("", `월드 기본 (${worldLabel.split(" — ")[0]})`), ...Object.entries(FUMBLE_PRESETS).map(([k, label]) => opt(k, label)),
    ...Object.entries(SOUND_PRESETS).map(([k, label]) => opt(k, label)), opt("file", "파일…"), opt("none", "효과음 없음")].join("");
}

export function openEditor(actor) {
  if (!actor) return ui.notifications.warn("컷인을 편집할 캐릭터를 찾지 못했습니다.");
  if (!actor.isOwner) return ui.notifications.warn("자신이 소유한 캐릭터만 편집할 수 있습니다.");
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
    super(foundry.utils.mergeObject({ id: `rcc-editor-${actor.id}`, window: { title: `치명타 컷인 — ${actor.name}` } }, options));
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
    const options = [`<option value="">월드 기본 (${esc(world.label.split(" — ")[0])})</option>`]
      .concat(Object.entries(TEMPLATES).map(([key, t]) => `<option value="${key}" ${d.template === key ? "selected" : ""}>${esc(t.label)}</option>`))
      .join("");
    const portrait = portraitOf(this.actor);
    const tokenArt = tokenArtOf(this.actor);
    const gm = game.user.isGM;
    return `
      <div class="rcc-ed">
        <section class="rcc-ed-left">
          <div class="rcc-frame preview" data-preview aria-label="미리보기 — 끌어서 위치, 휠로 확대"></div>
          <p class="rcc-hint"><i class="fa-solid fa-hand"></i> 그림을 <b>끌어서 위치</b>, <b>휠로 확대</b>를 맞춥니다. 위치·확대는 <b>지금 고른 템플릿에만</b> 저장됩니다.</p>
          <p class="rcc-hint rcc-template-hint"></p>
          <div class="rcc-row rcc-mode">
            <button type="button" data-act="mode-crit" class="${this.previewFumble ? "" : "on"}"><i class="fa-solid fa-bolt"></i> 치명타</button>
            <button type="button" data-act="mode-fumble" class="${this.previewFumble ? "on" : ""}"><i class="fa-solid fa-heart-crack"></i> 대실패</button>
          </div>
          <div class="rcc-row">
            <button type="button" data-act="play-here"><i class="fa-solid fa-play"></i> 여기서 재생</button>
            <button type="button" data-act="play-full"><i class="fa-solid fa-expand"></i> 내 화면 전체로 재생</button>
            ${gm ? `<button type="button" data-act="broadcast" data-tooltip="저장하지 않은 지금 모습 그대로 접속한 모두에게 한 번 보여 줍니다"><i class="fa-solid fa-tower-broadcast"></i> 모두에게 재생</button>` : ""}
            <span class="grow"></span>
            <button type="button" data-act="reset-crop" data-tooltip="이 템플릿의 위치·확대를 기본값으로"><i class="fa-solid fa-crosshairs"></i> 위치 초기화</button>
          </div>
        </section>
        <section class="rcc-ed-right">
          <label class="rcc-check"><input type="checkbox" name="enabled" ${d.enabled !== false ? "checked" : ""}> 이 캐릭터의 치명타 컷인 사용</label>

          <label class="rcc-field"><span>템플릿</span><select name="template">${options}</select></label>

          <div class="rcc-field rcc-art-field ${this.previewFumble ? "fumble" : ""}"><span>그림 — ${this.previewFumble ? `<b class="rcc-tag f"><i class="fa-solid fa-heart-crack"></i> 대실패</b>` : `<b class="rcc-tag c"><i class="fa-solid fa-bolt"></i> 치명타</b>`} <em>(왼쪽 아래 치명타/대실패로 바꿔 가며 따로 지정)</em></span>
            <div class="rcc-pick">
              <input type="text" name="image" value="${esc(d[this.imgKey])}" placeholder="${this.previewFumble ? "비우면 치명타 그림을 그대로 씀" : "비우면 캐릭터 초상화"}">
              <button type="button" data-pick="image" data-tooltip="파일 고르기"><i class="fa-solid fa-file-image"></i></button>
            </div>
            <div class="rcc-row small">
              ${this.previewFumble ? `<button type="button" data-act="same-as-crit" ${this.sharedArt ? "disabled" : ""}><i class="fa-solid fa-link"></i> 치명타 그림과 같게</button>` : ""}
              <button type="button" data-act="use-portrait" ${portrait ? "" : "disabled"}><i class="fa-solid fa-user"></i> 캐릭터 초상화</button>
              <button type="button" data-act="use-token" ${tokenArt ? "" : "disabled"}><i class="fa-solid fa-circle-user"></i> 토큰 그림</button>
              <label class="rcc-check inline"><input type="checkbox" name="flip" ${this.flipped ? "checked" : ""} ${this.sharedArt ? "disabled" : ""}> 좌우 반전</label>
            </div>
          </div>

          <div class="rcc-field"><span>위치·확대 <em>(이 템플릿)</em></span>
            <div class="rcc-slider"><i class="fa-solid fa-magnifying-glass-plus"></i><input type="range" name="zoom" min="1" max="4" step="0.01"><output data-for="zoom"></output></div>
            <div class="rcc-slider"><i class="fa-solid fa-arrows-left-right"></i><input type="range" name="x" min="0" max="100" step="0.5"><output data-for="x"></output></div>
            <div class="rcc-slider"><i class="fa-solid fa-arrows-up-down"></i><input type="range" name="y" min="0" max="100" step="0.5"><output data-for="y"></output></div>
          </div>

          <div class="rcc-field"><span>색</span>
            <div class="rcc-row small">
              <label class="rcc-color">강조 <input type="color" name="accent"></label>
              <label class="rcc-color">바탕 <input type="color" name="accent2"></label>
              <button type="button" data-act="reset-colors"><i class="fa-solid fa-rotate-left"></i> 템플릿 기본 색</button>
            </div>
          </div>

          <label class="rcc-field"><span>큰 글자</span><input type="text" name="title" maxlength="24" value="${esc(d.title)}" placeholder="${esc(setting("defaultTitle", "CRITICAL!") || "CRITICAL!")}"></label>
          <label class="rcc-field"><span>대사 <em>(선택)</em></span><input type="text" name="quote" maxlength="60" value="${esc(d.quote)}" placeholder="예) 이걸로 끝이다!"></label>

          <div class="rcc-field"><span>내추럴 20 문구</span>
            <div class="rcc-row small">
              <input type="text" name="badge" maxlength="24" value="${esc(d.badge)}" placeholder="${esc(setting("badgeText", "NAT 20") || "(월드 설정에서 꺼짐)")}">
              <label class="rcc-check inline"><input type="checkbox" name="hideBadge" ${d.hideBadge ? "checked" : ""}> 표시 안 함</label>
            </div>
          </div>

          <div class="rcc-field"><span>효과음</span>
            <div class="rcc-row small">
              <select name="soundChoice">${soundOptions(soundChoice(d.sound))}</select>
              <button type="button" data-act="listen" data-tooltip="지금 고른 효과음 듣기"><i class="fa-solid fa-volume-high"></i> 듣기</button>
            </div>
            <div class="rcc-pick" data-sound-file ${soundChoice(d.sound) === "file" ? "" : "hidden"}>
              <input type="text" name="sound" value="${esc(soundChoice(d.sound) === "file" ? d.sound : "")}" placeholder="효과음 파일 경로 (ogg / mp3 / wav)">
              <button type="button" data-pick="sound" data-tooltip="파일 고르기"><i class="fa-solid fa-file-audio"></i></button>
            </div>
          </div>

          <details class="rcc-fumble-ed" ${this.previewFumble ? "open" : ""}><summary><i class="fa-solid fa-heart-crack"></i> 대실패 컷인 <em>(같은 템플릿, 그림은 위에서 따로 · 차갑게 빛바랜 색·금 가는 화면·떨어지는 글자)</em></summary>
            <label class="rcc-check"><input type="checkbox" name="fumbleEnabled" ${d.fumbleEnabled !== false ? "checked" : ""}> 이 캐릭터의 대실패 컷인 사용</label>
            <label class="rcc-field"><span>큰 글자</span><input type="text" name="fumbleTitle" maxlength="24" value="${esc(d.fumbleTitle)}" placeholder="${esc(setting("fumbleTitle", "FUMBLE…") || "FUMBLE…")}"></label>
            <label class="rcc-field"><span>대사 <em>(선택)</em></span><input type="text" name="fumbleQuote" maxlength="60" value="${esc(d.fumbleQuote)}" placeholder="예) 어… 이게 아닌데?"></label>
            <label class="rcc-field"><span>내추럴 1 문구</span><input type="text" name="fumbleBadge" maxlength="24" value="${esc(d.fumbleBadge)}" placeholder="${esc(setting("fumbleBadge", "NAT 1") || "(월드 설정에서 꺼짐)")}"></label>
            <div class="rcc-field"><span>효과음</span>
              <div class="rcc-row small">
                <select name="fumbleSoundChoice">${fumbleSoundOptions(soundChoice(d.fumbleSound))}</select>
                <button type="button" data-act="listen-fumble" data-tooltip="대실패 효과음 듣기"><i class="fa-solid fa-volume-high"></i> 듣기</button>
              </div>
              <div class="rcc-pick" data-fumble-file ${soundChoice(d.fumbleSound) === "file" ? "" : "hidden"}>
                <input type="text" name="fumbleSound" value="${esc(soundChoice(d.fumbleSound) === "file" ? d.fumbleSound : "")}" placeholder="효과음 파일 경로 (ogg / mp3 / wav)">
                <button type="button" data-pick="fumbleSound" data-tooltip="파일 고르기"><i class="fa-solid fa-file-audio"></i></button>
              </div>
            </div>
          </details>
        </section>
      </div>
      <footer class="rcc-ed-footer">
        <button type="button" data-act="defaults"><i class="fa-solid fa-eraser"></i> 모두 기본값으로</button>
        <span class="grow"></span>
        <button type="button" data-act="cancel">닫기</button>
        <button type="button" data-act="save" class="primary"><i class="fa-solid fa-floppy-disk"></i> 저장</button>
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
      ui.notifications.info(`${this.actor.name}의 치명타 컷인을 저장했습니다.`);
      this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | save failed`, err);
      ui.notifications.error("저장하지 못했습니다. 이 캐릭터의 소유 권한을 확인해 주세요.");
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
    window: { title: "치명타 컷인 — 캐릭터 고르기", icon: "fa-solid fa-bolt" },
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
    if (!list.length) return `<p class="rcc-hint">편집할 수 있는 캐릭터가 없습니다. 캐릭터를 소유하고 있는지 확인하세요.</p>`;
    return `<p class="rcc-hint">컷인을 편집할 캐릭터를 고르세요. 캐릭터 시트 위쪽의 <i class="fa-solid fa-bolt"></i> 버튼으로도 열 수 있습니다.</p>
      <ul class="rcc-pick-list">${list.map(a => `
        <li><button type="button" data-uuid="${esc(a.uuid)}">
          <img src="${esc(portraitOf(a))}" alt=""><span>${esc(a.name)}</span>
          ${readConfig(a).enabled === false ? `<em>꺼짐</em>` : ""}
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
