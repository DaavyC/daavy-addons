import { injectFeedbackButtons } from "./feedback.js";
import {
  addPerObjectRangeField,
  handleStairwayTeleport,
  installInteractionWrappers
} from "./features/reach-control.js";
import {
  captureTargets,
  handleCreateChatMessageHook,
  handleCreateRegion,
  handleDeleteChatMessage,
  handleTargetHelperReady,
  handleUpdateChatMessageHook,
  handleUpdateUser,
  prepareSpellVariant,
  renderTargetHelper
} from "./features/target-helper.js";
import {
  checkIncompatibleSettings,
  handleSettingUpdate,
  organizeSettingsConfig,
  registerSettings
} from "./settings.js";

export function registerHooks() {
  Hooks.once("init", registerSettings);
  Hooks.once("setup", installInteractionWrappers);
  Hooks.once("ready", () => {
    void checkIncompatibleSettings();
    handleTargetHelperReady();
  });

  Hooks.on("renderSettingsConfig", (_app, html) => {
    organizeSettingsConfig(html);
    injectFeedbackButtons(html);
  });
  Hooks.on("updateSetting", handleSettingUpdate);

  Hooks.on("PreStairwayTeleport", handleStairwayTeleport);
  Hooks.on("renderPlaceableConfig", addPerObjectRangeField);
  Hooks.on("renderStairwayConfig", addPerObjectRangeField);

  Hooks.on("preCreateChatMessage", captureTargets);
  Hooks.on("preUpdateChatMessage", prepareSpellVariant);
  Hooks.on("createChatMessage", handleCreateChatMessageHook);
  Hooks.on("updateChatMessage", handleUpdateChatMessageHook);
  Hooks.on("deleteChatMessage", handleDeleteChatMessage);
  Hooks.on("renderChatMessageHTML", renderTargetHelper);
  Hooks.on("createRegion", handleCreateRegion);
  Hooks.on("updateUser", handleUpdateUser);
}
