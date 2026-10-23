import { MODULE_ID } from "../config.mjs";
import { ACTIONS, DEFAULT_LANDING, FONTS, LANDING_FLAG, PARTICLES, TEMPLATES, landingClasses, landingConfig, landingHtml, landingVars } from "./landing.mjs";

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

function filePicker(type, current, callback) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  try { new FP({ type, current, callback }).render(true); }
  catch (_) { ui.notifications.warn("파일 선택 창을 열 권한이 없습니다. 경로를 직접 붙여 넣으세요."); }
}

let editor = null;

export function openLandingEditor(scene = globalThis.canvas?.scene) {
  if (!game.user.isGM) return;
  if (!scene) return ui.notifications.warn("열린 장면이 없습니다.");
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
    super({ id: `rcl-editor-${scene.id}`, window: { title: `랜딩 페이지 — ${scene.navName || scene.name}` } });
    this.scene = scene;
    this.draft = clone(landingConfig(scene));
    this.tab = "basic";
  }

  async _renderHTML() {
    const d = this.draft;
    const tabs = [["basic", "기본", "fa-solid fa-heading"], ["type", "글자", "fa-solid fa-font"], ["menu", "메뉴", "fa-solid fa-list"], ["cards", "카드", "fa-solid fa-id-badge"], ["light", "조명", "fa-solid fa-lightbulb"]];
    const nav = tabs.map(([id, label, icon]) => `<button type="button" class="${this.tab === id ? "active" : ""}" data-tab="${id}"><i class="${icon}"></i> ${label}</button>`).join("");
    return `
      <div class="rcl-ed">
        <div class="rcl-ed-left">
          <div class="rcl-preview"><div class="rcl-preview-inner"></div></div>
          <p class="hint">미리보기는 실제 화면을 줄인 모습입니다. 저장하면 이 장면을 보고 있는 모두에게 바로 바뀝니다.</p>
        </div>
        <div class="rcl-ed-right">
          <nav class="rcl-ed-tabs">${nav}</nav>
          <div class="rcl-ed-body">${this._tabHtml()}</div>
        </div>
      </div>
      <footer class="rcl-ed-foot">
        <label class="on"><input type="checkbox" data-f="enabled" ${d.enabled ? "checked" : ""}> 이 장면을 랜딩 페이지로 쓰기</label>
        <span class="grow"></span>
        <button type="button" data-act="reset"><i class="fa-solid fa-rotate-left"></i> 처음 모양으로</button>
        <button type="button" data-act="close">닫기</button>
        <button type="button" data-act="save" class="primary"><i class="fa-solid fa-floppy-disk"></i> 저장</button>
      </footer>`;
  }

  _tabHtml() {
    const d = this.draft;
    const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? "selected" : ""}>${esc(label)}</option>`;
    const pick = (field, value, type, ph) => `<div class="pick"><input type="text" data-f="${field}" value="${esc(value)}" placeholder="${esc(ph)}"><button type="button" data-pick="${field}" data-type="${type}"><i class="fa-solid fa-file-image"></i></button></div>`;
    if (this.tab === "basic") {
      const tpl = Object.entries(TEMPLATES).map(([id, t]) => `<button type="button" class="tpl ${d.template === id ? "on" : ""}" data-tpl="${id}"><b>${esc(t.label)}</b><small>${esc(t.hint)}</small></button>`).join("");
      return `
        <div class="field">모양<div class="tpls">${tpl}</div></div>
        <label class="field">제목 <input type="text" data-f="title" value="${esc(d.title)}" placeholder="비우면 장면 이름"></label>
        <div class="row2">
          <label class="field">제목 위 작은 글 <input type="text" data-f="subtitle" value="${esc(d.subtitle)}" placeholder="예: Pathfinder 캠페인"></label>
          <label class="field">제목 아래 한 줄 <input type="text" data-f="tagline" value="${esc(d.tagline)}" placeholder="예: 제 7화 — 붉은 달의 밤"></label>
        </div>
        <label class="field">맨 아래 메모 <input type="text" data-f="note" value="${esc(d.note)}" placeholder="예: 다음 세션 10월 20일 (일) 20:00"></label>
        <div class="row2">
          <label class="field">배경 <select data-f="bgMode">${opt("image", "그림·영상", d.bgMode)}${opt("dark", "어둠 (그림 없이 빛만)", d.bgMode)}</select></label>
          <span></span>
        </div>
        ${d.bgMode === "dark" ? "" : `<div class="field">배경 그림·영상 ${pick("background", d.background, "imagevideo", "비우면 이 장면의 배경 그림")}</div>`}
        <div class="field">제목 대신 로고 그림 ${pick("logo", d.logo, "image", "비우면 제목 글자")}</div>
        <label class="field">가리는 범위 <select data-f="cover">${opt("board", "맵만 (채팅창은 보임)", d.cover)}${opt("all", "화면 전체", d.cover)}</select></label>`;
    }
    if (this.tab === "type") {
      const fonts = cur => Object.entries(FONTS).map(([k, f]) => opt(k, f.label, cur ?? "")).join("");
      const color = (field, label, fallback) => `<label class="field">${label}
        <div class="colorrow"><input type="color" data-f="${field}" value="${esc(d[field] || fallback)}"><label class="check"><input type="checkbox" data-own="${field}" ${d[field] ? "checked" : ""}> 직접 정하기</label></div></label>`;
      return `
        <div class="row2">
          <label class="field">제목 글꼴 <select data-f="titleFont">${fonts(d.titleFont)}</select></label>
          <label class="field">본문·버튼 글꼴 <select data-f="bodyFont">${fonts(d.bodyFont)}</select></label>
        </div>
        <p class="hint">글꼴은 Google Fonts에서 처음 쓸 때 받아 옵니다(인터넷이 없으면 기본 글꼴로 보입니다).</p>
        <div class="row2">
          ${color("titleColor", "제목 색", "#f3ecd9")}
          ${color("textColor", "글자 색", "#f3ecd9")}
        </div>
        <label class="field">강조 색 (선·버튼 테두리·아이콘) <input type="color" data-f="accent" value="${esc(d.accent || "#d8b45a")}"></label>
        <p class="hint">'직접 정하기'를 끄면 그 모양의 기본 색(예: 다크 판타지의 금빛 제목)을 씁니다.</p>`;
    }
    if (this.tab === "menu") {
      const rows = (d.menu ?? []).map((m, i) => {
        const a = ACTIONS[m.action] ?? ACTIONS.enter;
        const target = a.target ? `<input type="text" class="target" data-m="${i}" data-k="target" value="${esc(m.target)}" placeholder="${a.target === "url" ? "https://…" : "사이드바에서 끌어다 놓거나 UUID"}">` : `<span class="target none">—</span>`;
        return `<div class="mrow" data-i="${i}">
          <input type="text" class="icon" data-m="${i}" data-k="icon" value="${esc(m.icon)}" placeholder="fa-solid fa-star" data-tooltip="Font Awesome 아이콘 이름">
          <i class="${esc(m.icon || a.icon)} prev"></i>
          <input type="text" class="label" data-m="${i}" data-k="label" value="${esc(m.label)}" placeholder="버튼 글자">
          <select data-m="${i}" data-k="action">${Object.entries(ACTIONS).map(([k, v]) => opt(k, v.label, m.action)).join("")}</select>
          ${target}
          <button type="button" data-mv="${i}" data-dir="-1" data-tooltip="위로"><i class="fa-solid fa-arrow-up"></i></button>
          <button type="button" data-mv="${i}" data-dir="1" data-tooltip="아래로"><i class="fa-solid fa-arrow-down"></i></button>
          <button type="button" data-del="${i}" data-tooltip="지우기"><i class="fa-solid fa-trash"></i></button></div>`;
      }).join("");
      return `<p class="hint">저널·장면·매크로는 사이드바에서 그 줄로 끌어다 놓으면 연결됩니다. 웹 링크는 디스코드·위키 주소 등.</p>
        <div class="mrows">${rows || `<p class="hint">버튼이 없습니다.</p>`}</div>
        <div class="row"><button type="button" data-act="add-menu" ${(d.menu ?? []).length >= MAX_MENU ? "disabled" : ""}><i class="fa-solid fa-plus"></i> 버튼 추가</button></div>`;
    }
    if (this.tab === "cards") {
      const chars = game.actors.filter(a => a.type === "character").sort((a, b) => (b.hasPlayerOwner - a.hasPlayerOwner) || a.name.localeCompare(b.name, "ko"));
      const picked = new Set(d.cards.actors ?? []);
      const list = chars.map(a => `<label class="achk"><input type="checkbox" data-actor="${a.id}" ${picked.has(a.id) ? "checked" : ""}><img src="${esc(a.img)}" alt=""><span>${esc(a.name)}</span>${a.hasPlayerOwner ? "" : `<em>NPC</em>`}</label>`).join("");
      return `
        <label class="check"><input type="checkbox" data-c="show" ${d.cards.show ? "checked" : ""}> 파티 프로필 카드 보이기</label>
        <label class="check"><input type="checkbox" data-c="level" ${d.cards.level ? "checked" : ""}> 종족·직업·레벨 보이기</label>
        <label class="check"><input type="checkbox" data-c="player" ${d.cards.player ? "checked" : ""}> 플레이어 이름과 접속 표시 보이기</label>
        <div class="field">카드에 넣을 캐릭터 <span class="hint">하나도 고르지 않으면 플레이어 캐릭터 전부. 카드를 누르면 (볼 권한이 있을 때) 시트가 열립니다.</span></div>
        <div class="achks">${list || `<p class="hint">캐릭터가 없습니다.</p>`}</div>`;
    }
    const L = d.lighting;
    const range = (k, label, min, max, step) => `<label class="field">${label}<div class="slider"><input type="range" data-l="${k}" min="${min}" max="${max}" step="${step}" value="${L[k]}"><output>${Math.round(L[k] * 100)}%</output></div></label>`;
    return `
      ${range("vignette", "가장자리 어둡게 (비네트)", 0, 1, 0.05)}
      ${range("grade", "강조 색으로 물들이기", 0, 0.8, 0.05)}
      <label class="check"><input type="checkbox" data-l="rays" ${L.rays ? "checked" : ""}> 빛줄기 (위에서 비스듬히 내려오는 빛)</label>
      <label class="check"><input type="checkbox" data-l="fog" ${L.fog ? "checked" : ""}> 낮게 흐르는 안개</label>
      <label class="check"><input type="checkbox" data-l="flicker" ${L.flicker ? "checked" : ""}> 촛불처럼 은은하게 깜박임</label>
      <label class="field">떠다니는 입자 <select data-l="particles">${Object.entries(PARTICLES).map(([k, v]) => opt(k, v, L.particles)).join("")}</select></label>
      <p class="hint">모두 CSS로만 그려서 가볍습니다. 플레이어는 설정에서 움직임을 '줄이기'로 바꿀 수 있습니다.</p>`;
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
    if (doc && (!m.label || m.label === "새 버튼")) m.label = doc.name;
    m.icon = ACTIONS[m.action]?.icon ?? m.icon;
    this.render();
  }

  async _onClick(ev) {
    const t = ev.target.closest("button");
    if (!t) return;
    const d = this.draft;
    if (t.dataset.tab) { this.tab = t.dataset.tab; return this.render(); }
    if (t.dataset.tpl) {
      // Colours and particles you never changed follow the new look.
      const before = TEMPLATES[d.template] ?? {};
      const after = TEMPLATES[t.dataset.tpl] ?? {};
      if (!d.accent || d.accent === before.accent) d.accent = after.accent ?? d.accent;
      if (d.lighting.particles === before.particles) d.lighting.particles = after.particles ?? d.lighting.particles;
      d.template = t.dataset.tpl;
      return this.render();
    }
    if (t.dataset.pick) {
      const input = this.element.querySelector(`[data-f="${t.dataset.pick}"]`);
      return filePicker(t.dataset.type, input.value, path => { input.value = path; input.dispatchEvent(new Event("change", { bubbles: true })); });
    }
    if (t.dataset.del !== undefined) { d.menu.splice(Number(t.dataset.del), 1); return this.render(); }
    if (t.dataset.mv !== undefined) {
      const i = Number(t.dataset.mv);
      const j = i + Number(t.dataset.dir);
      if (j < 0 || j >= d.menu.length) return;
      [d.menu[i], d.menu[j]] = [d.menu[j], d.menu[i]];
      return this.render();
    }
    const act = t.dataset.act;
    if (act === "add-menu") { d.menu.push({ label: "새 버튼", icon: ACTIONS.journal.icon, action: "journal", target: "" }); return this.render(); }
    if (act === "reset") { this.draft = { ...clone(DEFAULT_LANDING), enabled: d.enabled, title: d.title, background: d.background }; return this.render(); }
    if (act === "close") return this.close();
    if (act === "save") {
      await this.scene.setFlag(MODULE_ID, LANDING_FLAG, clone(this.draft));
      ui.notifications.info(this.draft.enabled ? `'${this.scene.navName || this.scene.name}'의 랜딩 페이지를 저장했습니다.` : "저장했습니다 (이 장면의 랜딩 페이지는 꺼져 있습니다).");
      game.rutzCutin?.landing?.showAgain?.();
      return this.close();
    }
  }
}
