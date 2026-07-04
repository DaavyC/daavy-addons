import { MODULE_ID, TARGET_HELPER_AUTOMATIONS_SETTING } from "./config.js";

// Registers the world setting exposed in Foundry's module configuration.
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

// PF2e Toolbelt must be active because Target Helper owns the chat card UI.
export function isToolbeltActive() {
  return game.modules.get("pf2e-toolbelt")?.active === true;
}

// Only the active GM runs automation to avoid duplicate rolls/clicks.
export function canUseTargetHelperAutomations() {
  return (
    game.user === game.users.activeGM &&
    isTargetHelperAutomationsEnabled() &&
    isToolbeltActive() &&
    game.toolbelt?.getToolSetting?.("targetHelper", "enabled") === true
  );
}
