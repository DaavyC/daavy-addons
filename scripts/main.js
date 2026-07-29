import { MODULE_ID } from "./constants.js";
import { injectFeedbackButtons } from "./feedback.js";
import { registerReachControlHooks } from "./features/reach-control.js";
import {
  automateTargetHelperMessage,
  createTargetHelperMessage,
  registerTargetHelperHooks
} from "./features/target-helper.js";
import {
  checkIncompatibleSettings,
  organizeSettingsConfig,
  registerSettings
} from "./settings.js";

Hooks.on("renderSettingsConfig", (_app, html) => {
  organizeSettingsConfig(html);
  injectFeedbackButtons(html);
});

Hooks.once("init", () => {
  registerSettings();
  game.modules.get(MODULE_ID).api = {
    targetHelper: {
      createMessage: createTargetHelperMessage,
      automate: automateTargetHelperMessage
    }
  };
});

Hooks.once("ready", checkIncompatibleSettings);

registerReachControlHooks();
registerTargetHelperHooks();
