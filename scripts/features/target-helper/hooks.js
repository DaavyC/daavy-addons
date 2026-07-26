import { DELAYS, MODULE_ID, SELECTORS, SETTINGS } from "../../constants.js";
import { asHTMLElement } from "../../dom.js";
import { autoApplyDamage, autoRollSaves, resolvePendingSpellDamage, scheduleSpellDamageCheck } from "./features.js";
import { canUseTargetHelperAutomations, isTargetHelperAutomationsAvailable } from "./settings.js";
import { getHTMLElements, resolveDamageMode } from "./utils.js";

export function registerTargetHelperHooks() {
  Hooks.once("ready", initializeTargetHelperAutomations);
}

function initializeTargetHelperAutomations() {
  if (!isTargetHelperAutomationsAvailable()) {
    if (
      game.user === game.users.activeGM &&
      game.settings.get(MODULE_ID, SETTINGS.TARGET_HELPER_AUTOMATIONS) === true
    ) {
      void game.settings.set(MODULE_ID, SETTINGS.TARGET_HELPER_AUTOMATIONS, false);
    }
    return;
  }

  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = asHTMLElement(html);
    if (root) queueMessageAutomation(message, root);
  });
  Hooks.on("createChatMessage", (message) => {
    if (message?.isDamageRoll) resolvePendingSpellDamage(message);
  });
  for (const hookName of ["pf2e-toolbelt.rollSave", "pf2e-toolbelt.rerollSave"]) {
    Hooks.on(hookName, ({ message }) => {
      if (message) scheduleSpellDamageCheck(message.id, DELAYS.saveHook);
    });
  }

  DELAYS.existingMessages.forEach((delay) => window.setTimeout(processExistingChatMessages, delay));
}

function processExistingChatMessages() {
  if (!canUseTargetHelperAutomations()) return;

  for (const root of getHTMLElements(document, SELECTORS.renderedMessage)) {
    const messageId = root.dataset.messageId;
    const message = messageId ? game.messages.get(messageId) : null;
    if (message) queueMessageAutomation(message, root);
  }
}

function queueMessageAutomation(message, root) {
  if (!canUseTargetHelperAutomations()) return;

  DELAYS.queue.forEach((delay) => {
    window.setTimeout(() => void autoRollSaves(message, root), delay);
    window.setTimeout(() => void autoApplyDamage(message, root), delay);
  });

  if (resolveDamageMode(message) === "basic-save") {
    scheduleSpellDamageCheck(message.id, DELAYS.spellDamageInitial);
  }
}
