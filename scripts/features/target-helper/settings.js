import { MODULE_ID, TARGET_HELPER_AUTOMATIONS_SETTING } from "./constants.js";

// Registers the world setting for the automation.
export function registerTargetHelperAutomationsSetting() {
  game.settings.register(MODULE_ID, TARGET_HELPER_AUTOMATIONS_SETTING, {
    name: "DAAVY_ADDONS.Settings.TargetHelperAutomations.Name",
    hint: "DAAVY_ADDONS.Settings.TargetHelperAutomations.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

// Checks if the automation setting is enabled.
export function isTargetHelperAutomationsEnabled(moduleId = MODULE_ID) {
  return game.settings.get(moduleId, TARGET_HELPER_AUTOMATIONS_SETTING) === true;
}

// Checks if PF2e Toolbelt is active.
export function isToolbeltActive() {
  return game.modules.get("pf2e-toolbelt")?.active === true;
}

// Checks if this client can run the automation.
export function canUseTargetHelperAutomations() {
  return (
    game.user === game.users.activeGM &&
    isTargetHelperAutomationsEnabled(MODULE_ID) &&
    isToolbeltActive() &&
    game.toolbelt?.getToolSetting?.("targetHelper", "enabled") === true
  );
}
