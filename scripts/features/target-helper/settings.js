import { MODULE_ID, SETTINGS } from "../../constants.js";

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
