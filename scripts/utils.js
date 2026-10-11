import { MODULE_ID } from "./constants.js";

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}
