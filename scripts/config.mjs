import { DEFAULT_TEMPLATE, cropFor, templateOf } from "./templates.mjs";

export const MODULE_ID = "rutz-crit-cutin";
export const FLAG = "config";

/** What each actor stores in flags.rutz-crit-cutin.config. Empty strings mean "use the default". */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  template: "",      // "" → the world default
  image: "",         // "" → the actor's portrait (token art if it has none)
  flip: false,
  accent: "",        // "" → the template's colours
  accent2: "",
  title: "",         // "" → the world default ("CRITICAL!")
  quote: "",
  sound: "",         // "" → world default · "synth1"…"synth5" · "none" · or a file path
  badge: "",         // "" → the world default ("NAT 20")
  hideBadge: false,
  // the fumble cut-in (critical failure / natural 1): same template, its own picture (or the critical one), words and sound
  fumbleEnabled: true,
  fumbleImage: "",   // "" → the critical cut-in's picture
  fumbleFlip: false, // used with fumbleImage

  fumbleTitle: "",   // "" → the world default ("FUMBLE…")
  fumbleQuote: "",
  fumbleBadge: "",   // "" → the world default ("NAT 1")
  fumbleSound: "",   // "" → world default · "fumble1"…"fumble3" · synth1…5 · "none" · or a file path
  crops: {},         // per template: { x, y, zoom }
  fumbleCrops: {}    // the fumble picture's, per template
});
const CROP_KEYS = ["crops", "fumbleCrops"];

export function setting(key, fallback = null) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch (_) {
    return fallback;
  }
}

export function readConfig(actor) {
  const raw = actor?.getFlag?.(MODULE_ID, FLAG) ?? actor?.flags?.[MODULE_ID]?.[FLAG] ?? {};
  const out = { ...DEFAULT_CONFIG, ...raw };
  for (const ck of CROP_KEYS) {
    out[ck] = {};
    for (const [key, crop] of Object.entries(raw[ck] ?? {})) if (crop && typeof crop === "object") out[ck][key] = { ...crop };
  }
  return out;
}

/** Only the keys we know, with sane types — what goes into the flag. */
export function cleanConfig(config) {
  const out = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (CROP_KEYS.includes(key)) continue;
    const value = config?.[key];
    out[key] = typeof DEFAULT_CONFIG[key] === "boolean" ? !!value : String(value ?? "").trim();
  }
  for (const ck of CROP_KEYS) {
    out[ck] = {};
    for (const [key, crop] of Object.entries(config?.[ck] ?? {})) {
      const c = cropFor({ [key]: crop }, key);
      out[ck][key] = { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, zoom: Math.round(c.zoom * 100) / 100 };
    }
  }
  return out;
}

export function effectiveTemplate(config) {
  return templateOf(config?.template || setting("defaultTemplate", DEFAULT_TEMPLATE));
}

const PLACEHOLDER = /mystery-man|(^|\/)icons\/svg\/|default-icons\//;

/** The actor's portrait, or its token art when the portrait is Foundry's placeholder. */
export function portraitOf(actor, tokenDoc = null) {
  const img = actor?.img;
  if (img && !PLACEHOLDER.test(img)) return img;
  const tex = tokenDoc?.texture?.src ?? actor?.prototypeToken?.texture?.src;
  return tex || img || "icons/svg/mystery-man.svg";
}

export function tokenArtOf(actor, tokenDoc = null) {
  return tokenDoc?.texture?.src ?? actor?.prototypeToken?.texture?.src ?? "";
}

/** The name to print. Hidden when the system keeps an NPC's name from players. */
export function nameFor(actor, tokenDoc = null) {
  const name = tokenDoc?.name ?? actor?.name ?? "";
  if (game.user?.isGM || actor?.isOwner) return name;
  if (tokenDoc?.playersCanSeeName === false) return "";
  return name;
}

/** The fumble's picture: its own, or the critical one (with that one's crop and flip unless the fumble has its own crop). */
export function fumbleArt(actor, config, template, tokenDoc = null) {
  const own = !!String(config.fumbleImage ?? "").trim();
  return {
    image: own ? config.fumbleImage : (config.image || portraitOf(actor, tokenDoc)),
    crops: own ? (config.fumbleCrops ?? {}) : { ...(config.crops ?? {}), ...(config.fumbleCrops ?? {}) },
    flip: own ? !!config.fumbleFlip : !!config.flip
  };
}

export function buildSpec(actor, config, { tokenDoc = null, nat20 = false, nat1 = false, fumble = false, duration = null } = {}) {
  const template = effectiveTemplate(config);
  const art = fumble ? fumbleArt(actor, config, template, tokenDoc) : null;
  if (fumble) return {
    template,
    image: art.image,
    crop: cropFor(art.crops, template),
    flip: art.flip,
    accent: "", accent2: "",                     // the fumble look has its own colours
    title: config.fumbleTitle || setting("fumbleTitle", "FUMBLE…") || "FUMBLE…",
    badge: config.hideBadge ? "" : String(config.fumbleBadge || setting("fumbleBadge", "NAT 1") || "").slice(0, 24),
    name: nameFor(actor, tokenDoc),
    quote: config.fumbleQuote,
    nat20: !!nat1,                               // "show the badge"
    fumble: true,
    duration: duration ?? Math.round((Number(setting("duration", 2.2)) || 2.2) * 1000)
  };
  return {
    template,
    image: config.image || portraitOf(actor, tokenDoc),
    crop: cropFor(config.crops, template),
    flip: !!config.flip,
    accent: config.accent,
    accent2: config.accent2,
    title: config.title || setting("defaultTitle", "CRITICAL!") || "CRITICAL!",
    badge: badgeFor(config),
    name: nameFor(actor, tokenDoc),
    quote: config.quote,
    nat20: !!nat20,
    duration: duration ?? Math.round((Number(setting("duration", 2.2)) || 2.2) * 1000)
  };
}

/** The small line shown on a natural 20 ("NAT 20"); empty means none. */
export function badgeFor(config) {
  if (config?.hideBadge) return "";
  return String(config?.badge || setting("badgeText", "NAT 20") || "").slice(0, 24);
}

/** What to play: a character's own choice, else the world's. */
export function soundFor(config, { fumble = false } = {}) {
  const own = String((fumble ? config?.fumbleSound : config?.sound) ?? "").trim();
  if (own === "none") return { preset: "none" };
  if (/^(synth[1-5]|fumble[1-3])$/.test(own)) return { preset: own };
  if (own) return { preset: "file", file: own };
  const preset = (fumble ? setting("fumbleSound", "fumble1") : setting("soundPreset", "synth1")) || (fumble ? "fumble1" : "synth1");
  if (preset === "file") return { preset: "file", file: setting(fumble ? "fumbleSoundFile" : "defaultSound", "") || "" };
  return { preset };
}
