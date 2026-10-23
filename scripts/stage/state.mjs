/* ======================================================================== *
 * Who stands on the stage — pure logic, tested without Foundry.
 *
 * Every character on the cast has `last` (when it last typed or spoke),
 * `typing`, and `lines` (when it spoke, for a short history). Each one is:
 *   speaking  — typing now, or spoke within `hold` (a few seconds: mid-exchange)
 *   listening — quiet for less than `dim`
 *   idle      — quiet for longer: drawn grey and set back
 * Leaving:
 *   - quiet for `leave` → steps off by itself (0 = never), even if nobody new comes;
 *   - stage full and someone new speaks → whoever has said least lately gives
 *     up its spot (ties: the one quiet longest). Only someone typing right now
 *     or in the middle of an exchange (`hold`) is never pushed off.
 * Positions are stable: a character keeps its spot while on stage, and a new
 * speaker takes the spot of the one it replaces. Nobody slides around.
 * ======================================================================== */

export const RECENT_MS = 180000;   // "said lately" window for who leaves first

export function stateOf(entry, now, { hold, dim }) {
  if (!entry) return "idle";
  const quiet = now - (Number(entry.last) || 0);
  if (entry.typing || quiet < hold) return "speaking";
  if (quiet < dim) return "listening";
  return "idle";
}

export function recentLines(entry, now) {
  return (entry?.lines ?? []).filter(t => now - t < RECENT_MS).length;
}

/** Empty spots, middle first (one speaker stands centre stage). */
function emptyOrder(slots) {
  const mid = (slots.length - 1) / 2;
  return slots.map((id, i) => i).filter(i => !slots[i]).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
}

/**
 * @param {(string|null)[]} prev   last layout
 * @param {Map<string,{last:number,typing?:boolean,lines?:number[]}>} entries
 * @param {number} now
 * @param {{slots:number, hold:number, dim:number, leave:number}} opts
 * @returns {{slots:(string|null)[], states:Object<string,string>, waiting:string[], focus:string|null}}
 */
export function computeStage(prev, entries, now, { slots = 3, hold = 4000, dim = 30000, leave = 120000 } = {}) {
  const opts = { hold, dim };
  const state = id => stateOf(entries.get(id), now, opts);
  const isProtected = id => state(id) === "speaking";
  const last = id => Number(entries.get(id)?.last) || 0;
  /** Who gives up a spot first: least said lately, then quiet longest. */
  const weaker = (a, b) => (recentLines(entries.get(a), now) - recentLines(entries.get(b), now)) || (last(a) - last(b));

  let layout = Array.from({ length: slots }, (_, i) => prev?.[i] ?? null).map(id => {
    if (!id || !entries.has(id)) return null;
    const e = entries.get(id);
    if (leave > 0 && !e.typing && now - last(id) > leave) return null;
    return id;
  });
  const seen = new Set();
  layout = layout.map(id => (id && !seen.has(id) && seen.add(id) ? id : null));

  // Newcomers: someone speaking walks on, most recent first.
  const waiting = [];
  const newcomers = [...entries.keys()]
    .filter(id => !layout.includes(id) && state(id) === "speaking")
    .sort((a, b) => last(b) - last(a));
  for (const id of newcomers) {
    const free = emptyOrder(layout)[0];
    if (free !== undefined) { layout[free] = id; continue; }
    const candidates = layout.map((x, i) => [x, i]).filter(([x]) => x && !isProtected(x)).sort(([a], [b]) => weaker(a, b));
    if (candidates.length) layout[candidates[0][1]] = id;
    else waiting.push(id);
  }

  const states = {};
  for (const id of layout) if (id) states[id] = state(id);
  // In front of everyone: whoever is typing now, else whoever spoke last.
  const onStage = layout.filter(Boolean);
  const typing = onStage.filter(id => entries.get(id)?.typing).sort((a, b) => last(b) - last(a));
  const focus = typing[0] ?? onStage.sort((a, b) => last(b) - last(a))[0] ?? null;
  return { slots: layout, states, waiting, focus };
}
