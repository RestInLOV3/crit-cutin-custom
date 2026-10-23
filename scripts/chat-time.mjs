/* ======================================================================== *
 * "11개월 364일 전" on fresh chat messages
 *
 * A chat message's time is stamped by the sender's computer clock, and each
 * viewer shows "how long ago" against their own clock. When the sender's
 * clock runs even a few seconds ahead of a viewer's, the message is "from
 * the future": the difference is negative and Foundry turns −1 second into
 * "11 months 364 days" (whole months and days rounded down, then wrapped)
 * until the viewer's clock catches up.
 *   - new messages are stamped with the server's time instead of the
 *     sender's clock (game.time.serverTime), and
 *   - a message still ahead of this screen's clock shows "방금" (just now)
 *     until it isn't.
 *
 * 0.9.3: on some servers game.time.serverTime is not milliseconds since 1970,
 * so 0.9.1–0.9.2 stamped messages near 1970 ("56년 9개월 전"). The server time
 * is used only when it is close to this computer's clock; messages already
 * stamped wrong show (and, for the GM, are saved with) the right time.
 * ======================================================================== */

const AHEAD = 1000;
const DAY = 86400000;
const Y2000 = 946684800000;

/** The server's clock in ms — only when it is believable (within a day of this computer's). */
function serverNow() {
  const now = Date.now();
  for (const t of [Number(game.time?.serverTime), Number(game.time?.serverTime) * 1000]) {
    if (Number.isFinite(t) && Math.abs(t - now) < DAY) return t;
  }
  return now;
}

/** A stamp written wrong by 0.9.1–0.9.2 (seconds read as ms): the time it meant, or null. */
export function repairedStamp(ts) {
  ts = Number(ts);
  if (!Number.isFinite(ts) || ts <= 0 || ts >= Y2000) return null;
  const fixed = (ts + AHEAD) * 1000 - AHEAD;
  return fixed > Y2000 && fixed < Date.now() + DAY ? fixed : null;
}
const stampOf = message => repairedStamp(message?.timestamp) ?? Number(message?.timestamp);

function fixTimestamp(message, html) {
  const el = html instanceof HTMLElement ? html : html?.[0];
  const ts = stampOf(message);
  if (!el || !ts) return;
  if (repairedStamp(message.timestamp)) {
    const stamp = el.querySelector(".message-timestamp");
    if (stamp) stamp.textContent = foundry.utils.timeSince(ts);
  }
  const wait = ts - Date.now();
  if (wait <= 0) return;
  const stamp = el.querySelector(".message-timestamp");
  if (!stamp) return;
  stamp.textContent = game.i18n.localize("TIME.Now");
  // Foundry refreshes the stamps on its own; one more refresh once this screen's clock has caught up.
  setTimeout(() => {
    const live = document.querySelectorAll(`[data-message-id="${message.id}"] .message-timestamp`);
    for (const s of live) s.textContent = foundry.utils.timeSince(ts);
  }, Math.min(wait + 500, 10 * 60 * 1000));
}

/** GM, once: save the right time on messages stamped wrong (so the order and every screen are right). */
export async function repairOldStamps() {
  if (game.users.activeGM?.id !== game.user.id) return;
  const updates = game.messages.contents.map(m => ({ _id: m.id, timestamp: repairedStamp(m.timestamp) })).filter(u => u.timestamp);
  if (!updates.length) return;
  try {
    for (let i = 0; i < updates.length; i += 100) await ChatMessage.implementation.updateDocuments(updates.slice(i, i + 100), { render: false });
    console.log(`rutz-crit-cutin | fixed the time on ${updates.length} chat message(s)`);
    ui.chat?.render?.();
  } catch (err) { console.warn("rutz-crit-cutin | could not fix old chat times", err); }
}

export function installChatTimeFix() {
  Hooks.once("ready", () => setTimeout(repairOldStamps, 2000));
  Hooks.on("preCreateChatMessage", doc => {
    try { doc.updateSource({ timestamp: serverNow() - AHEAD }); } catch (_) { /* keep Foundry's own */ }
  });
  Hooks.on("renderChatMessageHTML", fixTimestamp);
  // Foundry's periodic refresh of the stamps would write the odd text back: skip messages still ahead.
  const ChatLog = foundry.applications?.sidebar?.tabs?.ChatLog;
  const proto = ChatLog?.prototype;
  if (proto?.updateTimestamps && !proto.updateTimestamps.__rcsWrapped) {
    const original = proto.updateTimestamps;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      try {
        const now = Date.now();
        for (const el of document.querySelectorAll(".chat-message[data-message-id] .message-timestamp")) {
          const id = el.closest("[data-message-id]")?.dataset.messageId;
          const msg = game.messages.get(id);
          const ts = stampOf(msg);
          if (ts && ts > now) el.textContent = game.i18n.localize("TIME.Now");
          else if (msg && repairedStamp(msg.timestamp)) el.textContent = foundry.utils.timeSince(ts);
        }
      } catch (_) { /* cosmetic only */ }
      return result;
    };
    wrapped.__rcsWrapped = true;
    proto.updateTimestamps = wrapped;
  }
}
