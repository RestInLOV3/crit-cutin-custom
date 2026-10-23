import { MODULE_ID, setting } from "./config.mjs";
import { renderCutin } from "./templates.mjs";
import { interfaceVolume, playCutinSound } from "./sound.mjs";

/* ======================================================================== *
 * Overlay player
 *
 * One cut-in on screen at a time; a few more may wait in line (a burst of
 * crits plays as a short sequence, anything beyond that is dropped so the
 * table never sits through a backlog). The overlay never takes the mouse;
 * Esc skips the one playing.
 * ======================================================================== */

const MAX_QUEUE = 3;
const GAP_MS = 220;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Load the picture first, so the cut-in never slides in empty. Gives up after `ms`. */
function preload(src, ms = 1500) {
  if (!src || /\.(webm|mp4|m4v|ogv)(\?|$)/i.test(src)) return Promise.resolve();
  return new Promise(resolve => {
    const img = new Image();
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, ms);
    img.onload = done;
    img.onerror = done;
    img.src = src;
  });
}

export function reducedMotion() {
  if (setting("show", "full") === "reduced") return true;
  try {
    return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch (_) {
    return false;
  }
}

export class CutinPlayer {
  constructor() {
    this.queue = [];
    this.busy = false;
    this.current = null;
    document.addEventListener("keydown", ev => {
      if (ev.key !== "Escape" || !this.current) return;
      ev.stopPropagation();
      ev.preventDefault();
      this.current.skip();
    }, { capture: true });
  }

  /** @param {{spec: object, sound?: object}} job */
  enqueue(job) {
    if (document.hidden) return false;            // nobody is looking; don't build a backlog
    if (this.queue.length >= MAX_QUEUE) return false;
    this.queue.push(job);
    this._pump();
    return true;
  }

  async _pump() {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    try {
      await this._play(job);
    } catch (err) {
      console.error(`${MODULE_ID} | cut-in failed`, err);
    } finally {
      this.busy = false;
      if (this.queue.length) setTimeout(() => this._pump(), GAP_MS);
    }
  }

  async _play({ spec, sound = {} }) {
    await preload(spec.image);
    const frame = document.createElement("div");
    frame.className = "rcc-frame";
    frame.setAttribute("aria-hidden", "true");
    frame.innerHTML = renderCutin(spec, { play: true, reduced: reducedMotion() });
    document.body.appendChild(frame);

    const volume = (Number(setting("volume", 0.6)) || 0) * interfaceVolume() * 2;
    playCutinSound({ preset: sound.preset ?? "synth1", file: sound.file ?? "", volume: Math.min(1, volume) });

    const duration = Math.max(800, Number(spec.duration) || 2200);
    await new Promise(resolve => {
      const timer = setTimeout(resolve, duration + 40);
      this.current = { skip: () => { clearTimeout(timer); resolve(); } };
    });
    this.current = null;
    frame.remove();
    await wait(0);
  }
}
