import {
  initializeTargetHelperAutomations,
  registerTargetHelperAutomationsSetting
} from "./scripts/features/target-helper-automations.js";

Hooks.once("init", registerTargetHelperAutomationsSetting);
Hooks.once("ready", initializeTargetHelperAutomations);
