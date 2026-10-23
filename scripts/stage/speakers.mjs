import { MODULE_ID, setting } from "../config.mjs";
import { actorOfKey, canSpeakAs, castFor, entryKey, stageLook, tokenOf } from "./cast.mjs";
import { faceCrop } from "./figure.mjs";
import { t } from "../i18n.mjs";

/* ======================================================================== *
 * Speaker quickbar — its own row between the dice bar and the chat controls.
 *
 *   click        speak as this one (pinned: clicking other tokens no longer
 *                changes who you speak as); click again to go back to auto
 *   right-click  take it off the bar
 *   Alt+click a token on the map, the token HUD's speech button, the + button
 *   (selected tokens), or an actor dropped from the sidebar puts one on.
 *
 * Players see their own character, whatever the GM gave them, and every
 * token of theirs on the current scene (familiars, summons), and can add
 * more. The bar is saved on the user, so it follows you to another computer.
 *
 * "Auto" is Foundry's usual rule: the selected token, else your character.
 * The GM's 🪶 narrator posts lines as narration (in any chat mode).
 * ======================================================================== */

export const BAR_FLAG = "speakerBar";
export const NARRATOR = "__narrator";
const MAX_ENTRIES = 16;
const NOT_SPEAKERS = new Set(["loot", "party", "vehicle", "hazard", "army"]);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function barData(user = game.user) {
  const raw = user?.getFlag?.(MODULE_ID, BAR_FLAG) ?? {};
  return { list: Array.isArray(raw.list) ? raw.list.filter(e => e?.actor) : [], pin: raw.pin ?? null };
}

async function saveBar(data) {
  try { await game.user.setFlag(MODULE_ID, BAR_FLAG, { list: data.list, pin: data.pin ?? null }); }
  catch (err) { console.warn(`${MODULE_ID} | speaker bar not saved`, err); }
}

function tokenEntry(token) {
  const doc = token?.document ?? token;
  const actor = doc?.actor;
  if (!actor) return null;
  return { actor: doc.actorId ?? actor.id, scene: doc.parent?.id ?? null, token: doc.id };
}

/** Your character, what the GM gave you, your tokens on this scene, then what you added. */
export function barEntries(user = game.user) {
  const out = [];
  const seen = new Set();
  const push = (e, auto) => {
    if (!e?.actor) return;
    const key = entryKey(e);
    if (!key || seen.has(key) || !canSpeakAs(user.id, e.actor)) return;
    seen.add(key);
    out.push({ actor: e.actor, scene: e.scene ?? null, token: e.token ?? null, key, auto });
  };
  if (!user.isGM) {
    if (user.character) push({ actor: user.character.id }, "character");
    for (const id of castFor(user.id)) push({ actor: id }, "cast");
    // Familiars, summons, companions: every token of theirs on the scene in view.
    for (const t of globalThis.canvas?.tokens?.placeables ?? []) {
      const actor = t.actor;
      if (!actor || NOT_SPEAKERS.has(actor.type) || !actor.testUserPermission?.(user, "OWNER")) continue;
      push(tokenEntry(t), "owned");
    }
  }
  for (const e of barData(user).list) push(e, false);
  return out;
}

export function barMode() {
  return setting("speakerBar", "auto");
}

function barVisible(entries) {
  const mode = barMode();
  if (mode === "off") return false;
  if (mode === "always" || game.user.isGM) return true;
  return entries.length > 0;
}

/** The pinned speaker of a user (default: you), if the bar is in use and it is still on it. */
export function pinnedEntry(user = game.user) {
  if (barMode() === "off" && user === game.user) return null;
  const { pin } = barData(user);
  if (!pin) return null;
  if (pin === NARRATOR) return user.isGM ? { key: NARRATOR, narrator: true } : null;
  return barEntries(user).find(e => e.key === pin) ?? null;
}

/** Chat speaker data for a bar entry. */
export function speakerData(entry) {
  const CM = ChatMessage.implementation ?? ChatMessage;
  const tok = tokenOf(entry);
  if (tok) return CM.getSpeaker({ token: tok });
  const actor = game.actors.get(entry.actor);
  return CM.getSpeaker({ actor, alias: actor?.name });
}

/** Who your next chat line will be spoken by: the pinned one, else Foundry's usual pick. */
export function currentSpeaker() {
  const pin = pinnedEntry();
  if (pin) return pin.narrator ? null : pin;
  const sp = (ChatMessage.implementation ?? ChatMessage).getSpeaker?.() ?? {};
  if (!sp.actor) return null;
  const e = { actor: sp.actor, scene: sp.token ? sp.scene : null, token: sp.token ?? null };
  const key = entryKey(e);
  return key ? { ...e, key } : null;
}

/** Who a user's voice (Discord) belongs to on stage: their pinned speaker, else their character. */
export function voiceKeyFor(user) {
  if (!user) return null;
  const pin = pinnedEntry(user);
  if (pin && !pin.narrator) return pin.key;
  if (pin?.narrator) return null;
  if (user.character && canSpeakAs(user.id, user.character.id)) return entryKey({ actor: user.character.id });
  return null;
}

/** Stage key for a chat message's speaker, if its author may speak as it. */
export function keyOfSpeaker(speaker, userId) {
  if (!speaker?.actor || !canSpeakAs(userId, speaker.actor)) return null;
  return entryKey({ actor: speaker.actor, scene: speaker.token ? speaker.scene : null, token: speaker.token ?? null });
}

export async function addSpeaker(entry, { pin = false, quiet = false } = {}) {
  if (!entry?.actor) return;
  if (!canSpeakAs(game.user.id, entry.actor)) {
    if (!quiet) ui.notifications.warn(t("Bar.NoRight"));
    return;
  }
  const key = entryKey(entry);
  if (!key) return;
  const data = barData();
  const auto = barEntries().find(e => e.key === key && e.auto);
  if (!auto && !data.list.some(e => entryKey(e) === key)) {
    data.list.push({ actor: entry.actor, scene: entry.scene ?? null, token: entry.token ?? null });
    while (data.list.length > MAX_ENTRIES) {
      const drop = data.list.findIndex(e => entryKey(e) !== data.pin);
      data.list.splice(drop < 0 ? 0 : drop, 1);
    }
  }
  if (pin) data.pin = key;
  await saveBar(data);
}

export async function removeSpeaker(key) {
  const data = barData();
  data.list = data.list.filter(e => entryKey(e) !== key);
  if (data.pin === key) data.pin = null;
  await saveBar(data);
}

export async function setPin(key) {
  const data = barData();
  data.pin = key || null;
  await saveBar(data);
}

/* ======================================================================== */

export class SpeakerBar {
  constructor() {
    this.el = null;
  }

  mount() {
    if (this.el) return;
    const el = document.createElement("div");
    el.id = "rcs-speakers";
    el.className = "hidden";
    el.addEventListener("click", ev => this._onClick(ev));
    el.addEventListener("contextmenu", ev => this._onContext(ev));
    el.addEventListener("dragover", ev => { ev.preventDefault(); el.classList.add("drop"); });
    el.addEventListener("dragleave", () => el.classList.remove("drop"));
    el.addEventListener("drop", ev => this._onDrop(ev));
    this.el = el;
    document.body.appendChild(el);
    this.render();
    window.addEventListener("resize", () => this.place());
    Hooks.on("collapseSidebar", () => setTimeout(() => this.place(), 300));
    Hooks.on("changeSidebarTab", () => setTimeout(() => this.place(), 60));
    Hooks.on("renderChatInput", () => setTimeout(() => this.place(), 30));
    Hooks.on("renderChatLog", () => setTimeout(() => this.place(), 30));
    setInterval(() => this.place(), 1500);
  }

  render() {
    if (!this.el) return;
    const entries = barEntries();
    const show = barVisible(entries);
    this.el.classList.toggle("hidden", !show);
    if (!show) { this.place(true); return; }
    const pin = pinnedEntry();
    const isGM = game.user.isGM;
    const stageOn = !!setting("stageActive", false);
    const voiceOn = !!setting("stageVoice", false);
    const notes = { character: t("Bar.Note.character"), cast: t("Bar.Note.cast"), owned: t("Bar.Note.owned") };
    const faces = entries.map(e => {
      const look = stageLook(e.key);
      const note = notes[e.auto] ?? t("Bar.RightClickRemove");
      return `<button type="button" class="who ${pin?.key === e.key ? "on" : ""} ${e.auto ? "auto" : ""}" data-key="${esc(e.key)}"
        data-tooltip="<b>${esc(look.name)}</b><br><small>${esc(t("Bar.ClickPin"))} · ${esc(note)}<br>${esc(t("Bar.AltRightClick"))}</small>" aria-label="${esc(look.name)}">
        <img src="${esc(look.thumb)}" alt=""></button>`;
    }).join("");
    const nowName = pin?.narrator ? t("Bar.Narration") : pin ? stageLook(pin.key).name : t("Common.Auto");
    // A small two-row block of buttons on the left: who-speaks modes first, then the GM's RP buttons.
    const tools = [
      isGM ? `<button type="button" class="tool narr ${pin?.narrator ? "on" : ""}" data-act="narrate" data-tooltip="${esc(t("Bar.Narration"))}<br><small>${esc(t("Bar.NarrationHint"))}</small>"><i class="fa-solid fa-feather-pointed"></i></button>` : "",
      isGM ? `<button type="button" class="tool rp ${stageOn ? "on" : ""}" data-act="rp" data-tooltip="${esc(stageOn ? t("Stage.TurnOff") : t("Stage.TurnOn"))}"><i class="fa-solid fa-masks-theater"></i></button>` : "",
      isGM && stageOn ? `<button type="button" class="tool" data-act="bg" data-tooltip="${esc(t("Stage.PickBackground"))}"><i class="fa-solid fa-image"></i></button>` : "",
      isGM && stageOn ? `<button type="button" class="tool ${voiceOn ? "on" : ""}" data-act="voice" data-tooltip="${esc(t("Bar.Voice", { state: voiceOn ? t("Common.On") : t("Common.Off") }))}<br><small>${esc(t("Bar.VoiceHint"))}</small>"><i class="fa-solid fa-microphone${voiceOn ? "" : "-slash"}"></i></button>` : ""
    ].filter(Boolean);
    this.el.innerHTML = `
      ${tools.length ? `<div class="tools">${tools.join("")}</div>` : ""}
      <div class="faces">${faces || `<span class="empty">${isGM ? t("Bar.EmptyGM") : t("Bar.EmptyPlayer")}</span>`}</div>
      <button type="button" class="tool add" data-act="add" data-tooltip="${esc(t("Bar.Add"))}<br><small>${esc(t("Bar.AddHint"))}</small>"><i class="fa-solid fa-plus"></i></button>`;
    this.el.querySelector(".faces").dataset.now = nowName;
    // Zoom each picture onto the face: the square is small.
    for (const img of this.el.querySelectorAll(".who img")) {
      const fit = () => faceCrop(img, img.parentElement);
      if (img.complete && img.naturalWidth) fit();
      else img.addEventListener("load", fit, { once: true });
    }
    this.place(true);
  }

  /**
   * A row of its own in the chat panel, right above the chat controls (roll
   * mode / export buttons) and below the HUD's dice bar. Without the chat
   * controls in view it floats above the chat input instead.
   */
  place(force = false) {
    if (!this.el) return;
    const hidden = this.el.classList.contains("hidden");
    const root = ui.chat?.element?.[0] ?? ui.chat?.element;
    const controls = document.getElementById("chat-controls") ?? root?.querySelector?.("#roll-privacy, .roll-privacy, .chat-controls");
    const inFlow = !!controls && controls.offsetParent !== null && !!controls.parentElement;
    let moved = false;
    if (inFlow) {
      if (this.el.nextElementSibling !== controls) { controls.before(this.el); moved = true; }
      this.el.classList.add("inflow");
      for (const k of ["left", "top", "width"]) this.el.style[k] = "";
      this._reserve(null);
    } else {
      if (this.el.parentElement !== document.body) { document.body.appendChild(this.el); moved = true; }
      this.el.classList.remove("inflow");
      const input = root?.querySelector?.("#chat-message, .chat-form, form, prose-mirror");
      const box = input?.getBoundingClientRect?.();
      const visible = !hidden && !!box && box.width > 0 && root.offsetParent !== null;
      this.el.classList.toggle("off", !visible);
      if (visible) {
        this.el.style.left = `${Math.round(box.left)}px`;
        this.el.style.width = `${Math.round(box.width)}px`;
        this.el.style.top = `${Math.round(box.top - this.el.offsetHeight - 4)}px`;
        this._reserve(root, this.el.offsetHeight + 6);
      } else this._reserve(null);
    }
    const h = hidden ? 0 : this.el.offsetHeight;
    if (moved || force || h !== this._h) {
      this._h = h;
      window.dispatchEvent(new Event("resize"));   // the HUD's dice bar moves above us
    }
  }

  /** Floating only: keep the newest chat cards above the bar. */
  _reserve(root, px) {
    for (const el of document.querySelectorAll(".rcs-speakers-reserve")) el.classList.remove("rcs-speakers-reserve");
    if (!root) return;
    const log = root.querySelector?.("#chat-log, ol.chat-log, .chat-log");
    let scroller = log;
    for (let el = log; el && el !== root; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") { scroller = el; break; }
    }
    if (!scroller) return;
    scroller.classList.add("rcs-speakers-reserve");
    root.style.setProperty("--rcs-speakers-h", `${px}px`);
  }

  async _onClick(ev) {
    const who = ev.target.closest(".who");
    if (who) {
      const pin = pinnedEntry();
      return setPin(pin?.key === who.dataset.key ? null : who.dataset.key);
    }
    const act = ev.target.closest("[data-act]")?.dataset.act;
    if (act === "narrate") return setPin(pinnedEntry()?.narrator ? null : NARRATOR);
    if (act === "rp") return game.rutzCutin?.stageToggle?.();
    if (act === "bg") return game.rutzCutin?.pickBackground?.();
    if (act === "voice") return game.settings.set(MODULE_ID, "stageVoice", !setting("stageVoice", false));
    if (act === "add") {
      const tokens = globalThis.canvas?.tokens?.controlled ?? [];
      if (!tokens.length) return ui.notifications.info(t("Bar.SelectFirst"));
      for (const [i, t] of tokens.entries()) await addSpeaker(tokenEntry(t), { pin: i === 0 && tokens.length === 1 });
    }
  }

  async _onContext(ev) {
    const who = ev.target.closest(".who");
    if (!who) return;
    ev.preventDefault();
    if (ev.altKey) {
      // Alt + right-click: that character's stage picture, size and expressions.
      const actor = actorOfKey(who.dataset.key);
      const base = game.actors.get(actor?.id) ?? actor;
      return game.rutzCutin?.stageLook?.(base);
    }
    if (who.classList.contains("auto")) {
      return ui.notifications.info(game.user.isGM ? t("Bar.CantRemoveGM") : t("Bar.CantRemove"));
    }
    return removeSpeaker(who.dataset.key);
  }

  async _onDrop(ev) {
    ev.preventDefault();
    this.el.classList.remove("drop");
    let data;
    try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch (_) { return; }
    if (data?.type !== "Actor" && data?.type !== "Token") return;
    const doc = await fromUuid(data.uuid);
    if (doc?.documentName === "Token") return addSpeaker(tokenEntry(doc), { pin: true });
    if (doc?.documentName === "Actor") return addSpeaker({ actor: doc.id }, { pin: true });
  }
}

/* ======================================================================== *
 * Wiring: the pinned speaker speaks; Alt+click and the token HUD add tokens.
 * ======================================================================== */

let fromInput = 0;

function asHTML(text) {
  const s = String(text ?? "").trim();
  if (/<[a-z][\s\S]*>/i.test(s)) return s;
  return s.split(/\n/).map(line => `<p>${esc(line)}</p>`).join("");
}

/** The narrator's line: posted directly, so Foundry's "in character needs a speaker" rule never applies. */
async function postNarration(text) {
  const CM = ChatMessage.implementation ?? ChatMessage;
  const OOC = CONST.CHAT_MESSAGE_STYLES?.OOC;
  const data = {
    author: game.user.id,
    content: asHTML(text),
    speaker: { scene: globalThis.canvas?.scene?.id ?? null, actor: null, token: null, alias: t("Bar.Narration") },
    flags: { [MODULE_ID]: { narration: true } }
  };
  if (OOC !== undefined) data.style = OOC;
  try { await CM.create(data); }
  catch (err) { console.error(`${MODULE_ID} | narration`, err); ui.notifications.error(t("Bar.NarrationFailed")); }
}

export function initSpeakers() {
  const bar = new SpeakerBar();
  bar.mount();

  // Chat input: before Foundry builds the message, swap in the pinned speaker.
  // Typed rolls (/r) follow it too; rolls from sheets are left alone.
  Hooks.on("chatMessage", (log, text, chatData) => {
    fromInput = Date.now();
    const pin = pinnedEntry();
    const raw = String(text ?? "").trim();
    if (!pin || !raw) return;
    if (pin.narrator) {
      if (raw.startsWith("/")) return;     // commands (/w, /r …) work as usual
      postNarration(raw);
      return false;
    }
    if (/^\/(ooc|macro|m)\b/i.test(raw) || !chatData) return;
    chatData.speaker = speakerData(pin);
  });
  // Also just before the message is made: the pinned character wins over the
  // chat mode (a "player" mode would otherwise speak as the user).
  Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
    if (userId !== game.user.id || Date.now() - fromInput > 1500) return;
    fromInput = 0;
    const pin = pinnedEntry();
    if (!pin || pin.narrator || message.rolls?.length || message.getFlag?.(MODULE_ID, "narration")) return;
    const sp = speakerData(pin);
    const update = {};
    if ((message.speaker?.actor ?? null) !== sp.actor || (message.speaker?.token ?? null) !== (sp.token ?? null)) update.speaker = sp;
    const { OOC, IC } = CONST.CHAT_MESSAGE_STYLES ?? {};
    if (OOC !== undefined && IC !== undefined && message.style === OOC) update.style = IC;
    if (Object.keys(update).length) message.updateSource(update);
  });

  // Alt + click a token: on the bar, and speaking as it.
  Hooks.on("controlToken", (token, controlled) => {
    if (!controlled || !game.keyboard?.isModifierActive?.("Alt")) return;
    addSpeaker(tokenEntry(token), { pin: true });
  });

  // Token HUD (right-click a token): a speech button.
  Hooks.on("renderTokenHUD", (hud, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const token = hud.object ?? hud.token;
    const entry = tokenEntry(token);
    if (!root || !entry || !canSpeakAs(game.user.id, entry.actor) || barMode() === "off") return;
    const key = entryKey(entry);
    const onBar = barEntries().some(e => e.key === key);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `control-icon rcs-hud-speak ${onBar ? "active" : ""}`;
    btn.dataset.tooltip = onBar ? t("Bar.HudRemove") : t("Bar.HudAdd");
    btn.innerHTML = `<i class="fa-solid fa-comment-dots"></i>`;
    btn.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      if (onBar && !barEntries().find(e => e.key === key)?.auto) removeSpeaker(key);
      else addSpeaker(entry, { pin: true });
      hud.close?.();
    });
    (root.querySelector(".col.left") ?? root.querySelector(".left") ?? root).appendChild(btn);
  });

  const redraw = () => bar.render();
  Hooks.on("updateUser", (user, changes) => {
    if (user.id === game.user.id && (changes.flags?.[MODULE_ID] || "character" in changes || changes[`flags.${MODULE_ID}`] !== undefined)) redraw();
  });
  Hooks.on("updateActor", (actor, changes) => { if ("img" in changes || "name" in changes || changes.ownership) redraw(); });
  Hooks.on("updateToken", (doc, changes) => { if ("name" in changes || changes.texture || changes.ring) redraw(); });
  Hooks.on("createToken", redraw);
  Hooks.on("deleteToken", redraw);
  Hooks.on("deleteActor", redraw);
  Hooks.on("canvasReady", redraw);

  // The GM's own row from the old cast window now lives on the GM's bar.
  if (game.user.isGM) {
    const mine = castFor(game.user.id);
    if (mine.length) {
      const data = barData();
      for (const id of mine) if (!data.list.some(e => e.actor === id && !e.token)) data.list.push({ actor: id, scene: null, token: null });
      const cast = foundry.utils.deepClone(game.settings.get(MODULE_ID, "stageCast") ?? {});
      delete cast[game.user.id];
      saveBar(data).then(() => game.settings.set(MODULE_ID, "stageCast", cast));
    }
  }
  return bar;
}

export { actorOfKey };
