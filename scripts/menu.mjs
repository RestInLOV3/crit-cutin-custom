import { setting } from "./config.mjs";

/* ======================================================================== *
 * One button, one small menu: everything this module offers (RP mode,
 * backdrop, speaking rights, stage pictures, landing page, settings) in a
 * little panel, instead of six buttons in the scene controls.
 * ======================================================================== */

const AppV2 = foundry.applications.api.ApplicationV2;
let menu = null;

/** Scene-control buttons may fire twice (onChange and onClick): run once. */
export function once(fn, ms = 400) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last < ms) return;
    last = now;
    return fn(...args);
  };
}

export function openStageMenu() {
  if (menu?.rendered) { menu.render(); menu.bringToFront?.(); return menu; }
  if (menu) return menu;                 // still opening
  menu = new StageMenu();
  return menu.render(true);
}

class StageMenu extends AppV2 {
  static DEFAULT_OPTIONS = {
    id: "rcs-menu",
    classes: ["rcs-menu-window"],
    window: { title: "연출 — Cinematic Stage", icon: "fa-solid fa-masks-theater" },
    position: { width: 300, height: "auto", left: 110, top: 90 }
  };

  _items() {
    const gm = game.user.isGM;
    const on = !!setting("stageActive", false);
    const api = () => game.rutzCutin ?? {};
    const landingHere = !!globalThis.canvas?.scene?.getFlag?.("rutz-crit-cutin", "landing")?.enabled;
    return [
      gm && { id: "rp", icon: "fa-solid fa-masks-theater", label: on ? "진지 RP 모드 끄기" : "진지 RP 모드 켜기", on, run: () => api().stageToggle?.() },
      gm && on && { id: "bg", icon: "fa-solid fa-image", label: "RP 배경 고르기", run: () => api().pickBackground?.() },
      gm && { id: "cast", icon: "fa-solid fa-users-rectangle", label: "발언권 — 플레이어가 맡을 캐릭터", run: () => api().cast?.() },
      { id: "look", icon: "fa-solid fa-person-rays", label: "무대 그림·표정 (지금 말하는 캐릭터)", run: () => api().myStageLook?.() },
      "sep",
      gm && { id: "landing", icon: "fa-solid fa-door-open", label: landingHere ? "이 장면의 랜딩 페이지 꾸미기" : "이 장면을 랜딩 페이지로 꾸미기", run: () => api().landingEditor?.() },
      landingHere && { id: "landing-show", icon: "fa-solid fa-panorama", label: "랜딩 페이지 다시 보기", run: () => api().landing?.showAgain?.() },
      "sep",
      { id: "settings", icon: "fa-solid fa-sliders", label: "설정", run: () => api().settings?.(gm ? "stage" : "cutin") }
    ].filter(Boolean);
  }

  async _renderHTML() {
    const items = this._items();
    return `<div class="rcs-menu">${items.map((it, i) => it === "sep"
      ? `<hr>`
      : `<button type="button" data-i="${i}" class="${it.on ? "on" : ""}"><i class="${it.icon}"></i><span>${it.label}</span></button>`).join("")
      .replace(/^(<hr>)+|(<hr>)+$/g, "").replace(/(<hr>){2,}/g, "<hr>")}</div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onFirstRender() {
    this.element.querySelector(".window-content").addEventListener("click", ev => {
      const btn = ev.target.closest("button[data-i]");
      if (!btn) return;
      const item = this._items()[Number(btn.dataset.i)];
      if (!item?.run) return;
      item.run();
      // RP on/off stays open to show the new state; everything else opens its own window.
      if (item.id === "rp") setTimeout(() => this.render(), 150);
      else this.close();
    });
  }

  _onClose(options) {
    super._onClose?.(options);
    if (menu === this) menu = null;
  }
}
