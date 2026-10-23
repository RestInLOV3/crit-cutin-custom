/* ======================================================================== *
 * Chat text → dialogue line
 *
 * Plain spoken lines only (no rolls, cards or tables). Foundry's inline
 * references never show as code: "@UUID[…]{월장석}" becomes a highlighted
 * word you can hover for the item's summary; "@Check[…]", "[[/r …]]" become
 * their readable label.
 * ======================================================================== */

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function nameOf(uuid) {
  try { return globalThis.fromUuidSync?.(uuid)?.name ?? null; } catch (_) { return null; }
}

function readable(type, body) {
  if (type === "UUID" || type === "Compendium") return nameOf(body) ?? body.split(".").pop();
  if (type === "Check") {
    const [stat, ...rest] = body.split("|");
    const dc = rest.find(r => r.startsWith("dc:"))?.slice(3);
    const key = globalThis.CONFIG?.PF2E?.saves?.[stat] ?? globalThis.CONFIG?.PF2E?.skills?.[stat]?.label ?? stat;
    const label = globalThis.game?.i18n?.localize?.(key) ?? stat;
    return dc ? `${label} DC ${dc}` : label;
  }
  if (type === "Damage" || type === "Template") return body.replace(/\[[^\]]*\]/g, "").split("|")[0];
  return body.split("|")[0].split(".").pop();
}

/** Plain text (already stripped of HTML) → escaped HTML with references as highlighted words. */
export function linesWithRefs(src) {
  let out = "";
  let i = 0;
  let plain = "";
  const flush = () => { out += esc(plain).replace(/\n/g, "<br>"); plain = ""; };
  while (i < src.length) {
    const ref = /^@(\w+)\[/.exec(src.slice(i, i + 40));
    const roll = src.startsWith("[[", i);
    if (!ref && !roll) { plain += src[i++]; continue; }
    let j = i + (ref ? ref[0].length : 2);
    let depth = ref ? 1 : 2;
    while (j < src.length && depth > 0) {
      if (src[j] === "[") depth++;
      else if (src[j] === "]") depth--;
      j++;
    }
    if (depth > 0) { plain += src[i++]; continue; }
    const body = ref ? src.slice(i + ref[0].length, j - 1) : src.slice(i + 2, j - 2);
    let label = null;
    if (src[j] === "{") {
      const close = src.indexOf("}", j);
      if (close > j) { label = src.slice(j + 1, close); j = close + 1; }
    }
    flush();
    const text = label ?? (ref ? readable(ref[1], body) : body.replace(/^\/\w+\s*/, "").split("#")[0].trim());
    const linkable = ref && (ref[1] === "UUID" || ref[1] === "Compendium");
    out += linkable ? `<span class="rcs-ref" data-uuid="${esc(body)}">${esc(text)}</span>` : `<span class="rcs-term">${esc(text)}</span>`;
    i = j;
  }
  flush();
  return out;
}

/**
 * The spoken text of a chat message, or "" when it isn't dialogue.
 * Content links that Foundry already enriched (<a class="content-link">) are
 * turned back into references first, so they get the same treatment.
 */
export function dialogueOf(message, limit = 400) {
  if (message?.rolls?.length) return "";
  const html = String(message?.content ?? "");
  if (!html.trim()) return "";
  const div = globalThis.document.createElement("div");
  div.innerHTML = html;
  if (div.querySelector(".dice-roll, .chat-card, table, .pkh-save-request, .item-card, form, button")) return "";
  for (const a of div.querySelectorAll("a.content-link[data-uuid]")) a.replaceWith(`@UUID[${a.dataset.uuid}]{${a.textContent.trim()}}`);
  for (const br of div.querySelectorAll("br")) br.replaceWith("\n");
  for (const p of div.querySelectorAll("p, div")) p.append("\n");
  let text = (div.textContent ?? "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  if (!text || /^\(\(|^\/\//.test(text)) return "";           // (( OOC )) and // notes stay off stage
  if (text.length > limit) text = `${text.slice(0, limit - 1)}…`;
  return text;
}
