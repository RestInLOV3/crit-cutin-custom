import { MODULE_ID, setting } from "../config.mjs";
import { sizeOf } from "./figure.mjs";

/* ======================================================================== *
 * Who may speak as whom, and how a speaker looks on stage.
 *
 * A speaker is an actor, or one particular unlinked token (two goblins from
 * the same actor are two speakers). Its key is the actor id, or
 * "actorId@sceneId.tokenId" for an unlinked token.
 *
 * Speaking rights:
 *   - the GM: anyone;
 *   - a player: characters they own (world setting, on by default) and the
 *     characters the GM gave them in the cast window. Kept apart from
 *     ownership so a player can voice an NPC for one session.
 * ======================================================================== */

export const STAGE_FLAG = "stage";
const PLACEHOLDER = /mystery-man|(^|\/)icons\/svg\/|default-icons\//;

/** { userId: [actorId, …] } — what the GM gave each player. */
export function castMap() {
  const raw = setting("stageCast", {}) ?? {};
  return raw && typeof raw === "object" ? raw : {};
}

export function castFor(userId) {
  return (castMap()[userId] ?? []).filter(id => game.actors.get(id));
}

export function canSpeakAs(userId, actorId) {
  const user = game.users?.get?.(userId);
  const actor = game.actors.get(actorId);
  if (!user || !actor) return false;
  if (user.isGM) return true;
  if (castFor(userId).includes(actorId)) return true;
  return setting("stageOwnedCast", true) !== false && !!actor.testUserPermission?.(user, "OWNER");
}

/* ---------------- keys ---------------- */

export function tokenOf(entry) {
  if (!entry?.scene || !entry?.token) return null;
  return game.scenes?.get?.(entry.scene)?.tokens?.get?.(entry.token) ?? null;
}

/** Actor id, or "actor@scene.token" for an unlinked token. */
export function entryKey(entry) {
  if (!entry?.actor || !game.actors.get(entry.actor)) return null;
  const tok = tokenOf(entry);
  if (tok && !tok.actorLink) return `${entry.actor}@${entry.scene}.${entry.token}`;
  return entry.actor;
}

export function parseKey(key) {
  const m = /^([^@]+)(?:@([^.]+)\.(.+))?$/.exec(String(key ?? ""));
  return m ? { actor: m[1], scene: m[2] ?? null, token: m[3] ?? null } : null;
}

export function actorOfKey(key) {
  const e = parseKey(key);
  return tokenOf(e)?.actor ?? game.actors.get(e?.actor) ?? null;
}

/* ---------------- look ---------------- */

const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : d));

/** Stage picture, flip, size, height, framing and expressions of one speaker. */
export function stageLook(key) {
  const e = parseKey(key) ?? {};
  const tok = tokenOf(e);
  const base = game.actors.get(e.actor);
  const actor = tok?.actor ?? base;
  const cfg = actor?.getFlag?.(MODULE_ID, STAGE_FLAG) ?? base?.getFlag?.(MODULE_ID, STAGE_FLAG) ?? {};
  const hudFaces = actor?.getFlag?.("pf2e-kr-hud", "faces") ?? [];
  const faces = (Array.isArray(cfg.faces) && cfg.faces.length ? cfg.faces : hudFaces).filter(f => f?.key && f?.img);
  const portrait = actor?.img && !PLACEHOLDER.test(actor.img) ? actor.img : null;
  const tokenImg = tok ? ((tok.ring?.enabled && tok.ring?.subject?.texture) || tok.texture?.src) : actor?.prototypeToken?.texture?.src;
  let name = tok?.name || actor?.name || "???";
  // A name the system hides from players stays hidden on stage too.
  if (tok && tok.playersCanSeeName === false && !game.user?.isGM && !actor?.hasPlayerOwner) name = "???";
  const autoSize = sizeOf(actor, tok);
  return {
    key,
    actorId: base?.id ?? null,
    name,
    image: cfg.image || portrait || tokenImg || "icons/svg/mystery-man.svg",
    thumb: tokenImg && !PLACEHOLDER.test(tokenImg) ? tokenImg : (portrait || tokenImg || "icons/svg/mystery-man.svg"),
    flip: !!cfg.flip,
    scale: clamp(cfg.scale, 0.4, 2, 1),
    offsetY: clamp(cfg.offsetY, -40, 40, 0),
    framing: ["full", "half"].includes(cfg.framing) ? cfg.framing : "auto",
    size: cfg.size && cfg.size !== "auto" ? cfg.size : autoSize,
    autoSize,
    faces
  };
}
