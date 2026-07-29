import { MODULE_ID } from "./constants.js";

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export async function resolveUuid(uuid) {
  try {
    return typeof uuid === "string" ? await fromUuid(uuid) : null;
  } catch {
    return null;
  }
}
