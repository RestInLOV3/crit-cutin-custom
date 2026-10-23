/* ======================================================================== *
 * Localization (lang/en.json, lang/ko.json — everything under "RCC")
 *
 * game.i18n is only ready after the "init" hook, so text needed earlier is
 * either a key Foundry localizes itself (setting names, hints and choices,
 * window titles in DEFAULT_OPTIONS: k(…)) or looked up when it is read
 * (getters, lazyLabels).
 * ======================================================================== */

export const I18N = "RCC";

/** Localized text: t("Editor.Save"), t("Editor.Saved", { name }). */
export function t(key, data) {
  return data ? game.i18n.format(`${I18N}.${key}`, data) : game.i18n.localize(`${I18N}.${key}`);
}

/** The full key, for places Foundry localizes on its own. */
export const k = key => `${I18N}.${key}`;

/** { id: "Some.Key" } → { id: <localized text> }, each looked up when read. */
export function lazyLabels(keys) {
  const out = {};
  for (const [id, key] of Object.entries(keys)) Object.defineProperty(out, id, { get: () => t(key), enumerable: true });
  return out;
}

/** { id: "Some.Key" } → { id: "RCC.Some.Key" }: setting choices, registered before translations load. */
export function keyChoices(keys) {
  return Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, k(key)]));
}
