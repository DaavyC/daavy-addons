import {
  initializeTargetHelperAutomations,
  registerTargetHelperAutomationsSetting
} from "./features/target-helper-automations.js";

Hooks.once("init", registerTargetHelperAutomationsSetting);
Hooks.once("ready", initializeTargetHelperAutomations);
