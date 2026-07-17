import { injectFeedbackButtons } from "./feedback.js";
import { registerReachControlHooks } from "./features/reach-control/hooks.js";
import { registerTargetHelperHooks } from "./features/target-helper/hooks.js";
import { organizeSettingsConfig, registerSettings } from "./settings.js";

Hooks.on("renderSettingsConfig", (_app, html) => {
  organizeSettingsConfig(html);
  injectFeedbackButtons(html);
});

Hooks.once("init", () => {
  registerSettings();
});

registerReachControlHooks();
registerTargetHelperHooks();
