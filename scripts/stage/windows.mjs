import { MODULE_ID, setting } from "../config.mjs";
import { STAGE_FLAG, castMap, stageLook } from "./cast.mjs";
import { SIZE_LABELS, analyzeMedia, placeFigure, sizeOf } from "./figure.mjs";
import { setStageActive, stageActive } from "./stage.mjs";
import { openBackgroundPicker } from "./backgrounds.mjs";
import { currentSpeaker } from "./speakers.mjs";

/* ======================================================================== *
 * GM: speaking rights — which characters each player may speak as on stage,
 * besides the ones they own. Kept apart from ownership, so one player can
 * voice an NPC for a session without being given the sheet.
 *
 * Anyone with the right: per-character stage window — stage picture, flip,
 * size, height, framing and expressions (keyword → picture).
 * ======================================================================== */

const AppV2 = foundry.applications.api.ApplicationV2;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PLAYER_LIMIT = 6;

function filePicker(type, current, callback) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  try { new FP({ type, current, callback }).render(true); }
  catch (_) { ui.notifications.warn("파일 선택 창을 열 권한이 없습니다. 경로를 직접 붙여 넣으세요."); }
}

let castWindow = null;

export function openCastWindow() {
  if (!game.user.isGM) return;
  if (castWindow?.rendered) { castWindow.render(); castWindow.bringToFront?.(); return castWindow; }
  return new CastWindow().render(true);
}

export class CastWindow extends AppV2 {
  static DEFAULT_OPTIONS = {
    id: "rcs-cast-window",
    classes: ["rcs-cast-window"],
    window: { title: "RP 무대 — 발언권", icon: "fa-solid fa-users-rectangle", resizable: true },
    position: { width: 640, height: "auto" }
  };

  /** One window: opening it again (menu button, scene tool) brings the open one forward. */
  render(...args) {
    if (castWindow && castWindow !== this && castWindow.rendered) {
      castWindow.render();
      castWindow.bringToFront?.();
      return castWindow;
    }
    castWindow = this;
    return super.render(...args);
  }

  async _renderHTML() {
    const on = stageActive();
    const cast = castMap();
    const owned = setting("stageOwnedCast", true) !== false;
    const users = [...game.users].filter(u => !u.isGM && (u.active || cast[u.id]?.length || u.character))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const actors = [...game.actors].sort((a, b) => (b.hasPlayerOwner - a.hasPlayerOwner) || a.name.localeCompare(b.name, "ko"));
    const chip = (id, removable, userId) => {
      const a = game.actors.get(id);
      return `<span class="rcs-cw-chip ${removable ? "" : "fixed"}"><img src="${esc(stageLook(id).thumb)}" alt=""><span>${esc(a.name)}</span>
        <button type="button" data-act="look" data-actor="${id}" data-tooltip="무대 그림·표정"><i class="fa-solid fa-sliders"></i></button>
        ${removable ? `<button type="button" data-act="remove" data-user="${userId}" data-actor="${id}" data-tooltip="빼기"><i class="fa-solid fa-xmark"></i></button>` : ""}</span>`;
    };
    const userRow = user => {
      const ids = (cast[user.id] ?? []).filter(id => game.actors.get(id));
      const mine = owned ? actors.filter(a => a.type !== "loot" && a.testUserPermission(user, "OWNER") && !ids.includes(a.id)).slice(0, 6) : [];
      const full = ids.length >= PLAYER_LIMIT;
      const others = actors.filter(a => !ids.includes(a.id) && !mine.includes(a));
      const add = full ? `<em class="hint">최대 ${PLAYER_LIMIT}명</em>` : `<select data-add="${user.id}"><option value="">+ 맡길 캐릭터…</option>
        ${others.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>`;
      return `<div class="rcs-cw-user" data-user="${user.id}">
        <div class="who"><i style="background:${esc(user.color?.css ?? user.color ?? "#888")}"></i><span>${esc(user.name)}</span></div>
        <div class="rcs-cw-chips">${mine.map(a => chip(a.id, false, user.id)).join("")}${ids.map(id => chip(id, true, user.id)).join("")}${add}</div></div>`;
    };
    return `<div class="rcs-cw">
      <div class="rcs-cw-mode ${on ? "on" : ""}">
        <div class="state"><b>${on ? "진지 RP 모드 켜짐" : "평소 모드"}</b><br><span class="hint">${on ? "입력을 시작하면 그 캐릭터가 무대에 오릅니다." : "켜면 모두의 화면에 RP 무대가 열립니다."}</span></div>
        <button type="button" data-act="bg"><i class="fa-solid fa-image"></i> 배경</button>
        <button type="button" data-act="toggle"><i class="fa-solid ${on ? "fa-stop" : "fa-play"}"></i> ${on ? "평소 모드로" : "진지 RP 모드 켜기"}</button>
      </div>
      <div class="rcs-cw-row">
        <label>한 번에 서는 인원 <select data-setting="stageSlots">${[3, 4, 5].map(n => `<option value="${n}" ${Number(setting("stageSlots", 3)) === n ? "selected" : ""}>${n}명</option>`).join("")}</select></label>
      </div>
      <h3>플레이어 — 누구로 말할 수 있나</h3>
      <p class="hint">${owned ? "흐린 칸은 그 플레이어가 소유한 캐릭터로, 자동으로 말할 수 있습니다. " : ""}그 밖에 NPC 등을 맡기려면 여기서 넣으세요(소유권은 그대로).
        사이드바의 액터를 줄 위로 끌어다 놓아도 됩니다. 플레이어는 채팅창 위 <b>말하는 캐릭터 바</b>에서 고릅니다.<br>
        GM은 따로 정할 필요가 없습니다: Alt+토큰 클릭이나 바의 + 로 아무 캐릭터나 바에 올리세요.</p>
      <div class="rcs-cw-users">${users.map(userRow).join("") || `<p class="hint">접속한 플레이어가 없습니다.</p>`}</div>
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onFirstRender() {
    const root = this.element.querySelector(".window-content");
    root.addEventListener("click", ev => this._onClick(ev));
    root.addEventListener("change", ev => this._onChange(ev));
    root.addEventListener("dragover", ev => {
      const row = ev.target.closest(".rcs-cw-user");
      if (!row) return;
      ev.preventDefault();
      root.querySelectorAll(".rcs-cw-user.drop").forEach(r => r !== row && r.classList.remove("drop"));
      row.classList.add("drop");
    });
    root.addEventListener("dragleave", ev => ev.target.closest(".rcs-cw-user")?.classList.remove("drop"));
    root.addEventListener("drop", async ev => {
      const row = ev.target.closest(".rcs-cw-user");
      if (!row) return;
      ev.preventDefault();
      row.classList.remove("drop");
      let data;
      try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch (_) { return; }
      if (data?.type !== "Actor") return;
      const actor = await fromUuid(data.uuid);
      if (actor) this._add(row.dataset.user, actor.id);
    });
  }

  async _setCast(next) {
    await game.settings.set(MODULE_ID, "stageCast", next);
    this.render();
  }

  _add(userId, actorId) {
    const cast = foundry.utils.deepClone(castMap());
    const list = (cast[userId] ?? []).filter(id => game.actors.get(id));
    if (list.includes(actorId)) return;
    if (list.length >= PLAYER_LIMIT) return ui.notifications.warn(`한 플레이어에게 ${PLAYER_LIMIT}명까지 맡길 수 있습니다.`);
    cast[userId] = [...list, actorId];
    return this._setCast(cast);
  }

  async _onClick(ev) {
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "toggle") { await setStageActive(!stageActive()); return this.render(); }
    if (act === "bg") return openBackgroundPicker();
    if (act === "look") return openStageLook(game.actors.get(btn.dataset.actor));
    if (act === "remove") {
      const cast = foundry.utils.deepClone(castMap());
      cast[btn.dataset.user] = (cast[btn.dataset.user] ?? []).filter(id => id !== btn.dataset.actor);
      return this._setCast(cast);
    }
  }

  async _onChange(ev) {
    const el = ev.target;
    if (el.dataset.add) { if (el.value) this._add(el.dataset.add, el.value); return; }
    if (el.dataset.setting) return game.settings.set(MODULE_ID, el.dataset.setting, Number(el.value));
  }
}

/* ======================================================================== */

const looks = new Map();

/** Your current speaker's stage look (or your character's). */
export function openMyStageLook() {
  const key = currentSpeaker()?.key;
  const actor = (key && game.actors.get(key.split("@")[0])) ?? game.user.character;
  if (!actor) return ui.notifications.info("말하는 캐릭터 바에서 캐릭터를 고르거나 토큰을 선택한 뒤 여세요.");
  return openStageLook(actor);
}

export function openStageLook(actor) {
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications.warn("이 캐릭터의 무대 설정을 바꿀 권한이 없습니다.");
  const open = looks.get(actor.id);
  if (open?.rendered) { open.bringToFront?.(); return open; }
  const app = new StageLookWindow(actor);
  looks.set(actor.id, app);
  return app.render(true);
}

export class StageLookWindow extends AppV2 {
  static DEFAULT_OPTIONS = {
    classes: ["rcs-actor-window"],
    window: { icon: "fa-solid fa-masks-theater", resizable: true },
    position: { width: 860, height: "auto" }
  };

  constructor(actor) {
    super({ id: `rcs-look-${actor.id}`, window: { title: `RP 무대 — ${actor.name}` } });
    this.actor = actor;
    const cfg = actor.getFlag(MODULE_ID, STAGE_FLAG) ?? {};
    const hud = actor.flags?.["pf2e-kr-hud"]?.faces ?? [];
    this.draft = {
      image: cfg.image ?? "", flip: !!cfg.flip, scale: Number(cfg.scale) || 1, offsetY: Number(cfg.offsetY) || 0,
      framing: ["full", "half"].includes(cfg.framing) ? cfg.framing : "auto",
      size: cfg.size && SIZE_LABELS[cfg.size] ? cfg.size : "auto",
      faces: (Array.isArray(cfg.faces) && cfg.faces.length ? cfg.faces : hud).map(f => ({ key: f.key ?? "", img: f.img ?? "" }))
    };
    this.previewFace = null;
    this.meta = null;
  }

  _src() {
    const face = this.previewFace !== null ? this.draft.faces[this.previewFace]?.img : null;
    return face || this.draft.image || stageLook(this.actor.id).image;
  }

  async _renderHTML() {
    const d = this.draft;
    const auto = sizeOf(this.actor, this.actor.getActiveTokens?.()[0]?.document);
    const opt = (value, label, current) => `<option value="${value}" ${current === value ? "selected" : ""}>${label}</option>`;
    const faces = d.faces.map((f, i) => `<div class="rcs-aw-face" data-i="${i}">
      <img src="${esc(f.img || "icons/svg/mystery-man.svg")}" alt="">
      <input type="text" data-face-key="${i}" value="${esc(f.key)}" placeholder="키워드">
      <input type="text" data-face-img="${i}" value="${esc(f.img)}" placeholder="그림 경로">
      <button type="button" data-face-pick="${i}" data-tooltip="그림 고르기"><i class="fa-solid fa-image"></i></button>
      <button type="button" data-face-show="${i}" data-tooltip="미리보기"><i class="fa-solid fa-eye"></i></button>
      <button type="button" data-face-del="${i}" data-tooltip="지우기"><i class="fa-solid fa-trash"></i></button></div>`).join("");
    return `
      <div class="rcs-aw-left">
        <div class="rcs-aw-preview"><div class="ref" data-tooltip="중간 크기 캐릭터의 머리 높이"></div><img class="rcs-layer on" alt=""><div class="box"></div></div>
        <p class="hint detected"></p>
      </div>
      <div class="rcs-aw-fields">
        <div class="field">무대 그림
          <div class="pick"><input type="text" name="image" value="${esc(d.image)}" placeholder="비우면 캐릭터 초상화"><button type="button" data-pick="image"><i class="fa-solid fa-image"></i></button></div></div>
        <div class="row2">
          <label class="field">덩치 <select name="size">${opt("auto", `자동 (${SIZE_LABELS[auto]})`, d.size)}${Object.entries(SIZE_LABELS).map(([k, l]) => opt(k, l, d.size)).join("")}</select></label>
          <label class="field">그림 종류 <select name="framing">${opt("auto", "자동", d.framing)}${opt("full", "전신 (발까지)", d.framing)}${opt("half", "상반신·잘린 그림", d.framing)}</select></label>
        </div>
        <div class="field">크기 보정<div class="slider"><input type="range" name="scale" min="0.4" max="2" step="0.01" value="${d.scale}"><output>${d.scale.toFixed(2)}×</output></div></div>
        <div class="field">높이 (위로 +)<div class="slider"><input type="range" name="offsetY" min="-40" max="40" step="1" value="${d.offsetY}"><output>${d.offsetY}%</output></div></div>
        <label class="field" style="flex-direction:row;align-items:center;gap:6px;font-weight:400"><input type="checkbox" name="flip" ${d.flip ? "checked" : ""}> 좌우 반전</label>
        <div class="field">표정 <span class="hint" style="font-weight:400">대사에 "@키워드" → 몇 초 뒤 기본 얼굴로, "@@키워드" → 계속 유지. "@기본"은 원래 그림.</span></div>
        <div class="rcs-aw-faces">${faces || `<p class="hint">아직 표정이 없습니다.</p>`}</div>
        <div class="row"><button type="button" data-act="add-face"><i class="fa-solid fa-plus"></i> 표정 추가</button></div>
      </div>
      <div class="rcs-aw-foot"><button type="button" data-act="reset">기본값으로</button><span class="grow"></span>
        <button type="button" data-act="close">닫기</button><button type="button" data-act="save"><i class="fa-solid fa-floppy-disk"></i> 저장</button></div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onFirstRender() {
    const root = this.element.querySelector(".window-content");
    root.addEventListener("input", ev => this._onInput(ev));
    root.addEventListener("change", ev => this._onInput(ev));
    root.addEventListener("click", ev => this._onClick(ev));
  }

  _onRender() {
    const img = this.element.querySelector(".rcs-aw-preview img");
    img.onload = () => { this.meta = analyzeMedia(img, img.getAttribute("src")); this._layout(); };
    img.onerror = () => { this.meta = null; };
    img.setAttribute("src", this._src());
    this._resize ??= new ResizeObserver(() => this._layout());
    this._resize.observe(this.element.querySelector(".rcs-aw-preview"));
  }

  _onClose(options) {
    super._onClose?.(options);
    this._resize?.disconnect();
    looks.delete(this.actor.id);
  }

  /** The same sizing as the stage: middle of three spots, with the dialogue box. */
  _layout() {
    const box = this.element?.querySelector(".rcs-aw-preview");
    const img = box?.querySelector("img");
    if (!box || !img || !this.meta) return;
    const W = box.clientWidth;
    const H = box.clientHeight;
    const d = this.draft;
    const size = d.size === "auto" ? sizeOf(this.actor, this.actor.getActiveTokens?.()[0]?.document) : d.size;
    const r = placeFigure({ W, H, n: 3, index: 1, meta: this.meta, size, framing: d.framing, scale: d.scale, offsetY: d.offsetY, flip: d.flip });
    Object.assign(img.style, { left: `${r.left}px`, bottom: `${r.bottom}px`, width: `${r.width}px`, height: `${r.height}px` });
    img.classList.toggle("flip", d.flip);
    const ref = placeFigure({ W, H, n: 3, index: 1, meta: { w: 1, h: 1, x0: 0, y0: 0, x1: 1, y1: 1, cut: false }, size: "med", framing: "full" });
    box.querySelector(".ref").style.bottom = `${ref.bottom + ref.height}px`;
    const hint = this.element.querySelector(".detected");
    if (hint) hint.textContent = `자동 판단: ${this.meta.cut ? "상반신·잘린 그림 (아래를 대사창 뒤로 숨김)" : "전신 (발이 대사창 바로 뒤)"}${this.meta.measured ? "" : " · 다른 사이트의 그림이라 여백을 잴 수 없음"}. 점선은 중간 크기 캐릭터의 머리 높이입니다.`;
  }

  _preview() {
    const img = this.element.querySelector(".rcs-aw-preview img");
    if (!img) return;
    if (img.getAttribute("src") !== this._src()) img.setAttribute("src", this._src());
    else this._layout();
  }

  _onInput(ev) {
    const el = ev.target;
    const d = this.draft;
    if (el.name === "image") d.image = el.value.trim();
    else if (el.name === "flip") d.flip = el.checked;
    else if (el.name === "size") d.size = el.value;
    else if (el.name === "framing") d.framing = el.value;
    else if (el.name === "scale") { d.scale = Number(el.value); el.nextElementSibling.textContent = `${d.scale.toFixed(2)}×`; }
    else if (el.name === "offsetY") { d.offsetY = Number(el.value); el.nextElementSibling.textContent = `${d.offsetY}%`; }
    else if (el.dataset.faceKey !== undefined) d.faces[Number(el.dataset.faceKey)].key = el.value.trim().replace(/^@+/, "");
    else if (el.dataset.faceImg !== undefined) {
      const i = Number(el.dataset.faceImg);
      d.faces[i].img = el.value.trim();
      const thumb = el.closest(".rcs-aw-face")?.querySelector("img");
      if (thumb) thumb.src = d.faces[i].img || "icons/svg/mystery-man.svg";
      this.previewFace = i;
    } else return;
    this._preview();
  }

  async _onClick(ev) {
    const t = ev.target.closest("button");
    if (!t) return;
    const d = this.draft;
    if (t.dataset.pick) {
      const input = this.element.querySelector('input[name="image"]');
      return filePicker("imagevideo", input.value, path => { input.value = path; input.dispatchEvent(new Event("change", { bubbles: true })); });
    }
    if (t.dataset.facePick !== undefined) {
      const input = this.element.querySelector(`[data-face-img="${t.dataset.facePick}"]`);
      return filePicker("image", input.value, path => { input.value = path; input.dispatchEvent(new Event("change", { bubbles: true })); });
    }
    if (t.dataset.faceShow !== undefined) { this.previewFace = Number(t.dataset.faceShow); return this._preview(); }
    if (t.dataset.faceDel !== undefined) { d.faces.splice(Number(t.dataset.faceDel), 1); this.previewFace = null; return this.render(); }
    const act = t.dataset.act;
    if (act === "add-face") { d.faces.push({ key: "", img: "" }); return this.render(); }
    if (act === "reset") { this.draft = { image: "", flip: false, scale: 1, offsetY: 0, framing: "auto", size: "auto", faces: d.faces }; return this.render(); }
    if (act === "close") return this.close();
    if (act === "save") {
      const faces = d.faces.filter(f => f.key && f.img).slice(0, 12);
      await this.actor.setFlag(MODULE_ID, STAGE_FLAG, {
        image: d.image, flip: d.flip, scale: d.scale, offsetY: d.offsetY, framing: d.framing, size: d.size === "auto" ? "" : d.size, faces
      });
      ui.notifications.info(`${this.actor.name}의 무대 설정을 저장했습니다.`);
      game.rutzCutin?.stage?.render();
      game.rutzCutin?.stage?.bar?.render();
      return this.close();
    }
  }
}
