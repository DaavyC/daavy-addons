import { MODULE_ID } from "./constants.js";

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function resolveUuidSync(uuid) {
  try {
    return typeof uuid === "string" ? fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

export async function resolveUuid(uuid) {
  try {
    return typeof uuid === "string" ? await fromUuid(uuid) : null;
  } catch {
    return null;
  }
}
