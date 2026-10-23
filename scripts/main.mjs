import { MODULE_ID, buildSpec, readConfig, setting } from "./config.mjs";
import { analyzeMessage } from "./detect.mjs";
import { CutinMenu, openEditor, soundFor } from "./editor.mjs";
import { CutinPlayer } from "./player.mjs";
import { DEFAULT_TEMPLATE, TEMPLATES } from "./templates.mjs";
import { FUMBLE_PRESETS, SOUND_PRESETS, playCutinSound } from "./sound.mjs";
import { initStage, onStageSocket, registerStageSettings, setStageActive, stageActive, toggleStage } from "./stage/stage.mjs";
import { CastWindow, openCastWindow, openMyStageLook, openStageLook } from "./stage/windows.mjs";
import { BackgroundPicker, openBackgroundPicker, setBackdrop } from "./stage/backgrounds.mjs";
import { addSpeaker, currentSpeaker, setPin } from "./stage/speakers.mjs";
import { installCalmTooltips } from "./tips.mjs";
import { once, openStageMenu } from "./menu.mjs";
import { initLanding, onLandingSocket, registerLandingSettings } from "./landing/landing.mjs";
import { LandingMenu, openLandingEditor } from "./landing/editor.mjs";
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
  const templateChoices = Object.fromEntries(Object.entries(TEMPLATES).map(([key, t]) => [key, t.label]));

  game.settings.registerMenu(MODULE_ID, "editor", {
    name: "캐릭터별 컷인 편집",
    label: "컷인 편집기 열기",
    hint: "캐릭터마다 그림·위치·확대·색·대사·효과음을 정합니다. 캐릭터 시트 위쪽의 ⚡ 버튼으로도 열 수 있습니다.",
    icon: "fa-solid fa-bolt",
    type: CutinMenu,
    restricted: false
  });

  s("enabled", { name: "치명타 컷인 사용", scope: "world", type: Boolean, default: true });
  s("trigger", {
    name: "언제 띄울까",
    hint: "PF2e에서는 '치명적 성공'이 성공 등급(DC 대비 +10 포함)이고, '내추럴 20'은 주사위 눈입니다. 다른 시스템은 내추럴 20으로 판단합니다.",
    scope: "world", type: String, default: "both",
    choices: { both: "내추럴 20 또는 치명적 성공", nat20: "내추럴 20만", crit: "치명적 성공만" }
  });
  s("groupSkill", { name: "기술·지각 판정에도", hint: "공격 굴림은 항상 포함됩니다.", scope: "world", type: Boolean, default: true });
  s("groupSave", { name: "내성 굴림에도", scope: "world", type: Boolean, default: true });
  s("groupFlat", { name: "플랫 체크·우선권에도", scope: "world", type: Boolean, default: false });
  s("npc", { name: "NPC에도", hint: "플레이어가 소유하지 않은 캐릭터의 치명타에도 컷인을 띄웁니다.", scope: "world", type: Boolean, default: false });
  s("defaultTemplate", { name: "기본 템플릿", hint: "캐릭터에 템플릿을 따로 정하지 않았을 때 씁니다.", scope: "world", type: String, default: DEFAULT_TEMPLATE, choices: templateChoices });
  s("defaultTitle", { name: "기본 큰 글자", scope: "world", type: String, default: "CRITICAL!" });
  s("badgeText", { name: "내추럴 20 문구", hint: "내추럴 20일 때 큰 글자 위에 붙는 작은 문구입니다. 비우면 표시하지 않습니다. 캐릭터마다 편집기에서 바꾸거나 끌 수도 있습니다.", scope: "world", type: String, default: "NAT 20" });
  s("soundPreset", {
    name: "기본 효과음", hint: "효과음 1~5는 모듈이 그 자리에서 만들어 내는 소리입니다(음원 파일 없음). '파일'을 고르면 아래 경로의 파일을 씁니다.",
    scope: "world", type: String, default: "synth1",
    choices: { ...SOUND_PRESETS, file: "파일 (아래 경로)", none: "효과음 없음" }
  });
  s("defaultSound", { name: "기본 효과음 파일", hint: "위에서 '파일'을 골랐을 때 쓰는 효과음입니다.", scope: "world", type: String, default: "", filePicker: "audio" });

  s("fumbleEnabled", { name: "대실패 컷인 사용", hint: "치명적 실패(또는 내추럴 1)에도 컷인을 띄웁니다. 같은 템플릿·그림에 차갑게 빛바랜 색, 금 가는 화면, 떨어지는 글자로. 판정 종류·NPC 조건은 위의 치명타 설정을 그대로 따릅니다.", scope: "world", type: Boolean, default: true });
  s("fumbleTrigger", {
    name: "대실패 — 언제 띄울까",
    hint: "PF2e에서는 '치명적 실패'가 성공 등급(DC 대비 −10 포함)이고, '내추럴 1'은 주사위 눈입니다.",
    scope: "world", type: String, default: "both",
    choices: { both: "내추럴 1 또는 치명적 실패", nat1: "내추럴 1만", critfail: "치명적 실패만" }
  });
  s("fumbleTitle", { name: "대실패 큰 글자", scope: "world", type: String, default: "FUMBLE…" });
  s("fumbleBadge", { name: "내추럴 1 문구", hint: "내추럴 1일 때 붙는 작은 문구. 비우면 표시하지 않습니다.", scope: "world", type: String, default: "NAT 1" });
  s("fumbleSound", {
    name: "대실패 기본 효과음", hint: "실패음 1~3도 모듈이 만들어 내는 소리입니다.",
    scope: "world", type: String, default: "fumble1",
    choices: { ...FUMBLE_PRESETS, ...SOUND_PRESETS, file: "파일 (아래 경로)", none: "효과음 없음" }
  });
  s("fumbleSoundFile", { name: "대실패 효과음 파일", scope: "world", type: String, default: "", filePicker: "audio" });

  s("show", {
    name: "내 화면의 컷인", scope: "client", type: String, default: "full",
    choices: { full: "켜기", reduced: "움직임 줄이기 (페이드만)", off: "끄기" }
  });
  s("duration", { name: "컷인 길이 (초)", scope: "client", type: Number, default: 2.2, range: { min: 1.2, max: 4, step: 0.1 } });
  s("volume", { name: "컷인 효과음 크기", hint: "Foundry의 인터페이스 볼륨에 곱해집니다.", scope: "client", type: Number, default: 0.6, range: { min: 0, max: 1, step: 0.05 } });
  s("waitDice", { name: "Dice So Nice 주사위가 멈춘 뒤 재생", scope: "client", type: Boolean, default: true });
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
    fumbleTrigger: setting("fumbleEnabled", true) ? setting("fumbleTrigger", "both") : "off",
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
  if (onStageSocket(data)) return;
  if (onLandingSocket(data)) return;
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
    buttons.unshift({ label: "컷인", class: "rcc-open-editor", icon: "fa-solid fa-bolt fa-fw", onclick: () => openEditor(actor) });
  });
  // Application V2 actor sheets: an entry in the header's control menu
  Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
    const actor = app.actor ?? app.document;
    if (!actor?.isOwner || controls.some(c => c.action === "rccOpenEditor")) return;
    app.options.actions ??= {};
    app.options.actions.rccOpenEditor ??= function () { openEditor(this.actor ?? this.document); };
    controls.push({ icon: "fa-solid fa-bolt fa-fw", label: "치명타 컷인", action: "rccOpenEditor", visible: true, onClick: () => openEditor(actor) });
  });
}

/* ---------------- RP stage: buttons in the "러츠 툴킷" tab ---------------- */

/**
 * Registered at "setup", after every module's "init", so these run after the
 * PF2e HUD has built its "러츠 툴킷" tab and land inside it. Without the HUD
 * they go into the token tools.
 */
function addStageControls() {
  const open = once(() => openStageMenu());
  Hooks.on("getSceneControlButtons", controls => {
    const tool = {
      name: "rcsMenu", title: "연출 — RP 무대 · 랜딩 페이지", icon: "fa-solid fa-masks-theater", order: 60,
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

Hooks.once("init", () => {
  registerSettings();
  registerStageSettings();
  registerLandingSettings();
  game.settings.registerMenu(MODULE_ID, "landingEditor", {
    name: "랜딩 페이지", label: "랜딩 페이지 꾸미기",
    hint: "지금 보고 있는 장면을 캠페인 타이틀 화면으로 꾸밉니다.",
    icon: "fa-solid fa-wand-magic-sparkles", type: LandingMenu, restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "stageCast", {
    name: "진지 RP 무대 — 발언권", label: "발언권 창 열기",
    hint: "진지 RP 모드를 켜고 끄며, 플레이어가 소유하지 않은 캐릭터(NPC 등)로 말할 수 있게 맡깁니다. 왼쪽 '러츠 툴킷' 탭에도 있습니다.",
    icon: "fa-solid fa-users-rectangle", type: CastWindow, restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "stageBackdrop", {
    name: "진지 RP 무대 — 배경", label: "배경 고르기",
    hint: "배경 그림을 폴더별로 모아 두고 고릅니다. RP 모드를 켤 때도 열립니다.",
    icon: "fa-solid fa-image", type: BackgroundPicker, restricted: true
  });
  game.keybindings.register(MODULE_ID, "stage-toggle", {
    name: "진지 RP 모드 켜기/끄기 (GM)", editable: [],
    restricted: true, onDown: () => { toggleStage(); return true; }
  });
  addSheetButtons();
  installChatTimeFix();
});

Hooks.once("setup", () => { addStageControls(); registerSettingsWindows(); });

Hooks.once("ready", () => {
  installCalmTooltips();
  player = new CutinPlayer();
  const stage = initStage();
  const landing = initLanding();
  game.rutzCutin = {
    play, broadcast, edit: openEditor, player, templates: Object.keys(TEMPLATES), sound: preset => playCutinSound({ preset, volume: 0.6 }),
    stage, stageOn: () => setStageActive(true), stageOff: () => setStageActive(false), stageToggle: toggleStage, isStageOn: stageActive,
    cast: openCastWindow, stageLook: openStageLook, myStageLook: openMyStageLook, menu: openStageMenu, pickBackground: openBackgroundPicker, setBackground: setBackdrop,
    landing, landingEditor: openLandingEditor, settings: openSettings,
    speakAs: (entry, pin = true) => addSpeaker(typeof entry === "string" ? { actor: entry } : entry, { pin }), unpin: () => setPin(null), speaker: currentSpeaker
  };
  stage.sync();
  Hooks.on("createChatMessage", message => { onChatMessage(message).catch(err => console.error(`${MODULE_ID} |`, err)); });
  game.socket.on(SOCKET, onSocket);
  console.log(`${MODULE_ID} | ready`);
});
