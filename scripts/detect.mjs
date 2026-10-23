/* ======================================================================== *
 * Which chat messages are worth a cut-in
 *
 * Pure functions over the message data, so they can be tested without
 * Foundry. Two signals:
 *   nat20 — a d20 that counts in the roll came up 20 (kept dice only, so a
 *           fortune roll's discarded die never triggers it);
 *   crit  — the system says the check was a critical success (PF2e's degree
 *           of success; d20 rolls that flag themselves critical elsewhere).
 * and their mirror image for the fumble cut-in:
 *   nat1  — a counting d20 came up 1;
 *   fumble — PF2e's degree is a critical failure (elsewhere: the roll calls
 *           itself a fumble).
 * A roll is one or the other (a critical success can't also be a fumble).
 * ======================================================================== */

/** PF2e check types → the setting group that switches them on or off. Null: never. */
export const PF2E_GROUPS = {
  "attack-roll": "attack",
  "spell-attack-roll": "attack",
  "skill-check": "skill",
  "perception-check": "skill",
  "counteract-check": "skill",
  "saving-throw": "save",
  "flat-check": "flat",
  "initiative": "flat",
  "damage-roll": null,
  "damage-taken": null
};

/** Results of the d20s that count in this roll. */
export function naturalD20s(roll) {
  const out = [];
  const dice = Array.isArray(roll?.dice) ? roll.dice : [];
  for (const die of dice) {
    if (Number(die?.faces) !== 20) continue;
    for (const r of die.results ?? []) {
      if (r.active === false || r.discarded) continue;
      out.push(Number(r.result));
    }
  }
  return out;
}

/**
 * @param {object} message  ChatMessage (or plain data with rolls / flags)
 * @param {object} opts
 * @param {"both"|"nat20"|"crit"} opts.trigger
 * @param {{attack:boolean, skill:boolean, save:boolean, flat:boolean}} opts.groups
 * @param {"both"|"nat1"|"critfail"|"off"} opts.fumbleTrigger
 * @returns {null | {kind:"crit"|"fumble", nat20:boolean, crit:boolean, nat1:boolean, fumble:boolean, group:string, type:string|null}}
 */
export function analyzeMessage(message, { trigger = "both", fumbleTrigger = "off", groups = {} } = {}) {
  const rolls = Array.isArray(message?.rolls) ? message.rolls : [];
  if (!rolls.length) return null;

  const context = message.flags?.pf2e?.context;
  let group = "other";
  let type = null;
  let crit = false;
  let fumble = false;

  if (context && typeof context === "object") {
    type = context.type ?? null;
    if (type && type in PF2E_GROUPS) {
      group = PF2E_GROUPS[type];
      if (group === null) return null;
    } else {
      group = "skill";                       // other PF2e checks behave like skill checks
    }
    crit = context.outcome === "criticalSuccess";
    fumble = context.outcome === "criticalFailure";
  } else {
    // Other systems: d20 rolls that call themselves critical (dnd5e's D20Roll and the like).
    crit = rolls.some(r => r?.isCritical === true && naturalD20s(r).length > 0);
    fumble = rolls.some(r => r?.isFumble === true && naturalD20s(r).length > 0);
  }

  const enabled = group === "other" ? groups.skill !== false : groups[group] !== false;
  if (!enabled) return null;

  const firstD20 = rolls.find(r => naturalD20s(r).length);
  if (!firstD20) return null;               // no d20, nothing to celebrate
  const faces = naturalD20s(firstD20);
  const nat20 = faces.includes(20);
  const nat1 = faces.includes(1) && !nat20;

  const hit = trigger === "nat20" ? nat20 : trigger === "crit" ? (context ? crit : crit || nat20) : nat20 || crit;
  if (hit && !fumble) return { kind: "crit", nat20, crit, nat1: false, fumble: false, group, type };
  if (fumbleTrigger === "off" || crit) return null;
  const miss = fumbleTrigger === "nat1" ? nat1 : fumbleTrigger === "critfail" ? (context ? fumble : fumble || nat1) : nat1 || fumble;
  return miss ? { kind: "fumble", nat20: false, crit: false, nat1, fumble, group, type } : null;
}
