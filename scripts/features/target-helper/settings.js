import { MODULE_ID, TARGET_HELPER_AUTOMATIONS_SETTING } from "./config.js";

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

export function isTargetHelperAutomationsEnabled() {
  return game.settings.get(MODULE_ID, TARGET_HELPER_AUTOMATIONS_SETTING) === true;
}

export function isToolbeltActive() {
  return game.modules.get("pf2e-toolbelt")?.active === true;
}

export function canUseTargetHelperAutomations() {
  return (
    game.user === game.users.activeGM &&
    isTargetHelperAutomationsEnabled() &&
    isToolbeltActive() &&
    game.toolbelt?.getToolSetting?.("targetHelper", "enabled") === true
  );
}
