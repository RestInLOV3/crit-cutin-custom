import { MODULE_ID, buildSpec, readConfig, setting } from "./config.mjs";
import { analyzeMessage } from "./detect.mjs";
import { CutinMenu, openEditor, soundFor } from "./editor.mjs";
import { CutinPlayer } from "./player.mjs";
import { DEFAULT_TEMPLATE, TEMPLATES, templateKeyChoices } from "./templates.mjs";
import { FUMBLE_PRESET_KEYS, SOUND_PRESET_KEYS, playCutinSound } from "./sound.mjs";
import { k, keyChoices, t } from "./i18n.mjs";
import { PLUS } from "./edition.mjs";
import { installCalmTooltips } from "./tips.mjs";
// @plus — the RP stage and the landing page (Plus edition)
import { initStage, onStageSocket, registerStageSettings, setStageActive, stageActive, toggleStage } from "./stage/stage.mjs";
import { CastWindow, openCastWindow, openMyStageLook, openStageLook } from "./stage/windows.mjs";
import { BackgroundPicker, openBackgroundPicker, setBackdrop } from "./stage/backgrounds.mjs";
import { addSpeaker, currentSpeaker, setPin } from "./stage/speakers.mjs";
import { once, openStageMenu } from "./menu.mjs";
import { initLanding, onLandingSocket, registerLandingSettings } from "./landing/landing.mjs";
import { LandingMenu, openLandingEditor } from "./landing/editor.mjs";
// @end-plus
import { openSettings, registerSettingsWindows } from "./settings-window.mjs";
import { installChatTimeFix } from "./chat-time.mjs";

/* ======================================================================== *
 * Rutz's Cinematic Stage — critical cut-ins and the serious-RP stage
 *
 * Cut-ins: every client watches new chat messages for itself, so nothing needs a
 * socket and each player only sees what they're allowed to see: a whisper
 * or blind roll that isn't theirs never plays. With Dice So Nice the cut-in
 * waits until the dice have landed.
 *
 * API (macros, other modules):
 *   game.rutzCutin.play(actorOrToken, { nat20, fumble, template })   this screen only
 *   game.rutzCutin.edit(actor)                                open the editor
 *   Hooks.on("rutzCutinBeforePlay", data => false)            cancel one
 * ======================================================================== */

const SOCKET = `module.${MODULE_ID}`;
let player = null;

function registerSettings() {
  const s = (key, data) => game.settings.register(MODULE_ID, key, { config: true, ...data });
  // Fumble cut-ins are the Plus edition's: in Lite their settings stay registered (defaults) but are not shown.
  const p = (key, data) => s(key, { ...data, config: PLUS });
  // Setting texts are i18n keys: Foundry (and our settings window) localizes them when shown.
  const templateChoices = templateKeyChoices();

  game.settings.registerMenu(MODULE_ID, "editor", {
    name: k("Menus.editor.Name"),
    label: k("Menus.editor.Label"),
    hint: k("Menus.editor.Hint"),
    icon: "fa-solid fa-bolt",
    type: CutinMenu,
    restricted: false
  });

  s("enabled", { name: k("Settings.enabled.Name"), scope: "world", type: Boolean, default: true });
  s("trigger", {
    name: k("Settings.trigger.Name"),
    hint: k("Settings.trigger.Hint"),
    scope: "world", type: String, default: "both",
    choices: { both: k("Settings.trigger.Choices.both"), nat20: k("Settings.trigger.Choices.nat20"), crit: k("Settings.trigger.Choices.crit") }
  });
  s("groupSkill", { name: k("Settings.groupSkill.Name"), hint: k("Settings.groupSkill.Hint"), scope: "world", type: Boolean, default: true });
  s("groupSave", { name: k("Settings.groupSave.Name"), scope: "world", type: Boolean, default: true });
  s("groupFlat", { name: k("Settings.groupFlat.Name"), scope: "world", type: Boolean, default: false });
  s("npc", { name: k("Settings.npc.Name"), hint: k("Settings.npc.Hint"), scope: "world", type: Boolean, default: false });
  s("defaultTemplate", { name: k("Settings.defaultTemplate.Name"), hint: k("Settings.defaultTemplate.Hint"), scope: "world", type: String, default: DEFAULT_TEMPLATE, choices: templateChoices });
  s("defaultTitle", { name: k("Settings.defaultTitle.Name"), scope: "world", type: String, default: "CRITICAL!" });
  s("badgeText", { name: k("Settings.badgeText.Name"), hint: k("Settings.badgeText.Hint"), scope: "world", type: String, default: "NAT 20" });
  s("soundPreset", {
    name: k("Settings.soundPreset.Name"), hint: k("Settings.soundPreset.Hint"),
    scope: "world", type: String, default: "synth1",
    choices: { ...keyChoices(SOUND_PRESET_KEYS), file: k("Sound.FilePath"), none: k("Sound.None") }
  });
  s("defaultSound", { name: k("Settings.defaultSound.Name"), hint: k("Settings.defaultSound.Hint"), scope: "world", type: String, default: "", filePicker: "audio" });

  p("fumbleEnabled", { name: k("Settings.fumbleEnabled.Name"), hint: k("Settings.fumbleEnabled.Hint"), scope: "world", type: Boolean, default: true });
  p("fumbleTrigger", {
    name: k("Settings.fumbleTrigger.Name"),
    hint: k("Settings.fumbleTrigger.Hint"),
    scope: "world", type: String, default: "both",
    choices: { both: k("Settings.fumbleTrigger.Choices.both"), nat1: k("Settings.fumbleTrigger.Choices.nat1"), critfail: k("Settings.fumbleTrigger.Choices.critfail") }
  });
  p("fumbleTitle", { name: k("Settings.fumbleTitle.Name"), scope: "world", type: String, default: "FUMBLE…" });
  p("fumbleBadge", { name: k("Settings.fumbleBadge.Name"), hint: k("Settings.fumbleBadge.Hint"), scope: "world", type: String, default: "NAT 1" });
  p("fumbleSound", {
    name: k("Settings.fumbleSound.Name"), hint: k("Settings.fumbleSound.Hint"),
    scope: "world", type: String, default: "fumble1",
    choices: { ...keyChoices(FUMBLE_PRESET_KEYS), ...keyChoices(SOUND_PRESET_KEYS), file: k("Sound.FilePath"), none: k("Sound.None") }
  });
  p("fumbleSoundFile", { name: k("Settings.fumbleSoundFile.Name"), scope: "world", type: String, default: "", filePicker: "audio" });

  s("show", {
    name: k("Settings.show.Name"), scope: "client", type: String, default: "full",
    choices: { full: k("Settings.show.Choices.full"), reduced: k("Settings.show.Choices.reduced"), off: k("Settings.show.Choices.off") }
  });
  s("duration", { name: k("Settings.duration.Name"), scope: "client", type: Number, default: 2.2, range: { min: 1.2, max: 4, step: 0.1 } });
  s("volume", { name: k("Settings.volume.Name"), hint: k("Settings.volume.Hint"), scope: "client", type: Number, default: 0.6, range: { min: 0, max: 1, step: 0.05 } });
  s("waitDice", { name: k("Settings.waitDice.Name"), scope: "client", type: Boolean, default: true });
}

/* ---------------- chat messages ---------------- */

function speakerOf(message) {
  const sp = message.speaker ?? {};
  const tokenDoc = sp.scene && sp.token ? game.scenes.get(sp.scene)?.tokens.get(sp.token) ?? null : null;
  const actor = tokenDoc?.actor ?? (sp.actor ? game.actors.get(sp.actor) : null)
    ?? ChatMessage.implementation?.getSpeakerActor?.(sp) ?? null;
  return { actor, tokenDoc };
}

function waitForDice(message) {
  const dsn = game.modules.get("dice-so-nice");
  if (!dsn?.active || !message.rolls?.length || setting("waitDice", true) === false) return Promise.resolve();
  if (typeof game.dice3d?.isEnabled === "function" && !game.dice3d.isEnabled()) return Promise.resolve();
  return new Promise(resolve => {
    let hookId = null;
    const done = () => { Hooks.off("diceSoNiceRollComplete", hookId); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 9000);
    hookId = Hooks.on("diceSoNiceRollComplete", id => { if (id === message.id) done(); });
  });
}

async function onChatMessage(message) {
  if (!setting("enabled", true) || setting("show", "full") === "off") return;
  if (message.visible === false || message.isContentVisible === false) return;

  const result = analyzeMessage(message, {
    trigger: setting("trigger", "both"),
    fumbleTrigger: PLUS && setting("fumbleEnabled", true) ? setting("fumbleTrigger", "both") : "off",
    groups: { attack: true, skill: setting("groupSkill", true), save: setting("groupSave", true), flat: setting("groupFlat", false) }
  });
  if (!result) return;

  const { actor, tokenDoc } = speakerOf(message);
  if (!actor) return;
  if (!actor.hasPlayerOwner && !setting("npc", false)) return;
  const config = readConfig(actor);
  const fumble = result.kind === "fumble";
  if (fumble ? config.fumbleEnabled === false : config.enabled === false) return;
  if (Hooks.call("rutzCutinBeforePlay", { message, actor, token: tokenDoc, result, config }) === false) return;

  await waitForDice(message);
  player.enqueue({ spec: buildSpec(actor, config, { tokenDoc, nat20: result.nat20, nat1: result.nat1, fumble }), sound: soundFor(config, { fumble }) });
}

/* ---------------- API ---------------- */

async function resolveActor(target) {
  if (!target) return { actor: null, tokenDoc: null };
  if (typeof target === "string") target = await fromUuid(target);
  if (target?.documentName === "Token") return { actor: target.actor, tokenDoc: target };
  if (target?.document?.documentName === "Token") return { actor: target.actor, tokenDoc: target.document };
  if (target?.documentName === "Actor") return { actor: target, tokenDoc: target.token ?? null };
  return { actor: null, tokenDoc: null };
}

/** Play on this screen. `overrides` can replace any saved setting (template, image, quote …). */
async function play(target, { nat20 = true, fumble = false, config: override = null, ...rest } = {}) {
  if (!PLUS) fumble = false;
  const { actor, tokenDoc } = await resolveActor(target ?? canvas?.tokens?.controlled?.[0] ?? game.user.character);
  if (!actor) return false;
  const config = { ...readConfig(actor), ...(override ?? {}), ...rest };
  return player.enqueue({ spec: buildSpec(actor, config, { tokenDoc, nat20, nat1: fumble && nat20, fumble }), sound: soundFor(config, { fumble }) });
}

/**
 * GM: show a cut-in (saved or not) to everyone connected, once. The finished
 * spec is sent, so players don't need permission to see the actor itself;
 * a name the system hides from players is left out.
 */
async function broadcast(target, config = null, { nat20 = true, fumble = false } = {}) {
  if (!game.user.isGM) return false;
  if (!PLUS) fumble = false;
  const { actor, tokenDoc } = await resolveActor(target);
  if (!actor) return false;
  const merged = { ...readConfig(actor), ...(config ?? {}) };
  const token = tokenDoc ?? actor.getActiveTokens?.()[0]?.document ?? null;
  const spec = buildSpec(actor, merged, { tokenDoc: token, nat20, nat1: fumble && nat20, fumble });
  const publicSpec = { ...spec, name: token?.playersCanSeeName === false && !actor.hasPlayerOwner ? "" : spec.name };
  game.socket.emit(SOCKET, { action: "play", spec: publicSpec, sound: soundFor(merged, { fumble }) });
  return player.enqueue({ spec, sound: soundFor(merged, { fumble }) });
}

function onSocket(data) {
  // @plus
  if (onStageSocket(data)) return;
  if (onLandingSocket(data)) return;
  // @end-plus
  if (data?.action !== "play" || !data.spec || setting("show", "full") === "off") return;
  const duration = Math.round((Number(setting("duration", 2.2)) || 2.2) * 1000);
  player.enqueue({ spec: { ...data.spec, duration }, sound: data.sound ?? {} });
}

/* ---------------- sheet buttons ---------------- */

function addSheetButtons() {
  // Application V1 actor sheets
  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    const actor = sheet.actor ?? sheet.document;
    if (!actor?.isOwner) return;
    buttons.unshift({ label: t("Sheet.Button"), class: "rcc-open-editor", icon: "fa-solid fa-bolt fa-fw", onclick: () => openEditor(actor) });
  });
  // Application V2 actor sheets: an entry in the header's control menu
  Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
    const actor = app.actor ?? app.document;
    if (!actor?.isOwner || controls.some(c => c.action === "rccOpenEditor")) return;
    app.options.actions ??= {};
    app.options.actions.rccOpenEditor ??= function () { openEditor(this.actor ?? this.document); };
    controls.push({ icon: "fa-solid fa-bolt fa-fw", label: t("Sheet.Control"), action: "rccOpenEditor", visible: true, onClick: () => openEditor(actor) });
  });
}

/* ---------------- RP stage: buttons in the "러츠 툴킷" tab ---------------- */

/**
 * Registered at "setup", after every module's "init", so these run after the
 * PF2e HUD has built its "러츠 툴킷" tab and land inside it. Without the HUD
 * they go into the token tools.
 */
// @plus
function addStageControls() {
  const open = once(() => openStageMenu());
  Hooks.on("getSceneControlButtons", controls => {
    const tool = {
      name: "rcsMenu", title: t("Controls.Menu"), icon: "fa-solid fa-masks-theater", order: 60,
      button: true, visible: true, onChange: () => open(), onClick: () => open()
    };
    // v13+: an object of controls, each with an object of tools. v12: arrays.
    if (Array.isArray(controls)) {
      const group = controls.find(c => c.name === "rutzToolkit") ?? controls.find(c => c.name === "token");
      group?.tools.push(tool);
      return;
    }
    const group = controls?.rutzToolkit ?? controls?.tokens;
    if (group?.tools) group.tools.rcsMenu = tool;
  });
}
// @end-plus

Hooks.once("init", () => {
  registerSettings();
  // @plus
  registerStageSettings();
  registerLandingSettings();
  game.settings.registerMenu(MODULE_ID, "landingEditor", {
    name: k("Menus.landingEditor.Name"), label: k("Menus.landingEditor.Label"),
    hint: k("Menus.landingEditor.Hint"),
    icon: "fa-solid fa-wand-magic-sparkles", type: LandingMenu, restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "stageCast", {
    name: k("Menus.stageCast.Name"), label: k("Menus.stageCast.Label"),
    hint: k("Menus.stageCast.Hint"),
    icon: "fa-solid fa-users-rectangle", type: CastWindow, restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "stageBackdrop", {
    name: k("Menus.stageBackdrop.Name"), label: k("Menus.stageBackdrop.Label"),
    hint: k("Menus.stageBackdrop.Hint"),
    icon: "fa-solid fa-image", type: BackgroundPicker, restricted: true
  });
  game.keybindings.register(MODULE_ID, "stage-toggle", {
    name: k("Keybindings.stageToggle"), editable: [],
    restricted: true, onDown: () => { toggleStage(); return true; }
  });
  // @end-plus
  addSheetButtons();
  installChatTimeFix();
});

Hooks.once("setup", () => {
  // @plus
  addStageControls();
  // @end-plus
  registerSettingsWindows();
});

Hooks.once("ready", () => {
  installCalmTooltips();
  player = new CutinPlayer();
  game.rutzCutin = {
    play, broadcast, edit: openEditor, player, templates: Object.keys(TEMPLATES), sound: preset => playCutinSound({ preset, volume: 0.6 }),
    settings: openSettings, edition: PLUS ? "plus" : "lite"
  };
  // @plus
  const stage = initStage();
  const landing = initLanding();
  Object.assign(game.rutzCutin, {
    stage, stageOn: () => setStageActive(true), stageOff: () => setStageActive(false), stageToggle: toggleStage, isStageOn: stageActive,
    cast: openCastWindow, stageLook: openStageLook, myStageLook: openMyStageLook, menu: openStageMenu, pickBackground: openBackgroundPicker, setBackground: setBackdrop,
    landing, landingEditor: openLandingEditor,
    speakAs: (entry, pin = true) => addSpeaker(typeof entry === "string" ? { actor: entry } : entry, { pin }), unpin: () => setPin(null), speaker: currentSpeaker
  });
  stage.sync();
  // @end-plus
  Hooks.on("createChatMessage", message => { onChatMessage(message).catch(err => console.error(`${MODULE_ID} |`, err)); });
  game.socket.on(SOCKET, onSocket);
  console.log(`${MODULE_ID} | ready`);
});
