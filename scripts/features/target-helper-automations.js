import { DELAYS, SELECTORS, TARGET_HELPER_AUTOMATIONS_SETTING } from "./target-helper/constants.js";
import { asHTMLElement, getHTMLElements } from "./target-helper/dom.js";
import { autoApplyDamage } from "./target-helper/damage-automation.js";
import { resolveDamageMode } from "./target-helper/messages.js";
import { autoRollSaves } from "./target-helper/save-automation.js";
import {
  canUseTargetHelperAutomations,
  isTargetHelperAutomationsEnabled,
  isToolbeltActive,
  registerTargetHelperAutomationsSetting
} from "./target-helper/settings.js";
import { scheduleMany } from "./target-helper/scheduler.js";
import {
  resolvePendingSpellDamage,
  scheduleSpellDamageCheck
} from "./target-helper/spell-damage-automation.js";
import { state } from "./target-helper/state.js";

export {
  isTargetHelperAutomationsEnabled,
  registerTargetHelperAutomationsSetting,
  TARGET_HELPER_AUTOMATIONS_SETTING
};

export function initializeTargetHelperAutomations() {
  if (!isToolbeltActive() || state.hooksRegistered) return;

  state.hooksRegistered = true;

  Hooks.on("renderChatMessageHTML", handleRenderedChatMessage);
  Hooks.on("createChatMessage", handleCreatedChatMessage);
  registerSaveHooks();
  scheduleMany(processExistingChatMessages, DELAYS.existingMessages);
}

function handleRenderedChatMessage(message, html) {
  const root = asHTMLElement(html);
  if (root) queueMessageAutomation(message, root);
}

function handleCreatedChatMessage(message) {
  if (message?.isDamageRoll) resolvePendingSpellDamage(message);
}

function registerSaveHooks() {
  for (const hookName of ["pf2e-toolbelt.rollSave", "pf2e-toolbelt.rerollSave"]) {
    Hooks.on(hookName, scheduleSpellDamageAfterSave);
  }
}

function scheduleSpellDamageAfterSave({ message }) {
  if (message) scheduleSpellDamageCheck(message.id, DELAYS.saveHook);
}

function processExistingChatMessages() {
  if (!canUseTargetHelperAutomations()) return;

  for (const root of getHTMLElements(document, SELECTORS.renderedMessage)) {
    const message = getMessageFromRoot(root);
    if (message) queueMessageAutomation(message, root);
  }
}

function getMessageFromRoot(root) {
  const messageId = root.dataset.messageId;
  return messageId ? game.messages.get(messageId) : null;
}

function queueMessageAutomation(message, root) {
  if (!canUseTargetHelperAutomations()) return;

  scheduleMany(() => autoRollSaves(message, root), DELAYS.queue);
  scheduleMany(() => autoApplyDamage(message, root), DELAYS.queue);

  if (resolveDamageMode(message) === "basic-save") {
    scheduleSpellDamageCheck(message.id, DELAYS.spellDamageInitial);
  }
}
