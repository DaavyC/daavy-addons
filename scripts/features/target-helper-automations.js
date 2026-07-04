import { TARGET_HELPER_AUTOMATIONS_SETTING } from "./target-helper/config.js";
import { registerTargetHelperHooks } from "./target-helper/hooks.js";
import {
  isTargetHelperAutomationsEnabled,
  registerTargetHelperAutomationsSetting
} from "./target-helper/settings.js";

export {
  isTargetHelperAutomationsEnabled,
  registerTargetHelperAutomationsSetting,
  TARGET_HELPER_AUTOMATIONS_SETTING
};

export function registerTargetHelperAutomations() {
  registerTargetHelperHooks();
}
