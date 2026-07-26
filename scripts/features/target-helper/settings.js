import { MODULE_ID, SELECTORS, SETTINGS } from "../../constants.js";

export function isTargetHelperAutomationsAvailable() {
  return game.system?.id === "pf2e" && game.modules.get("pf2e-toolbelt")?.active === true;
}

export function canUseTargetHelperAutomations() {
  return (
    game.user === game.users.activeGM &&
    game.settings.get(MODULE_ID, SETTINGS.TARGET_HELPER_AUTOMATIONS) === true &&
    isTargetHelperAutomationsAvailable() &&
    game.toolbelt?.getToolSetting?.("targetHelper", "enabled") === true
  );
}

export function shouldAutomateTarget(root) {
  return game.settings.get(MODULE_ID, SETTINGS.TARGET_HELPER_NPCS_ONLY) !== true
    || root.querySelector(SELECTORS.npcTargetIcon) !== null;
}
