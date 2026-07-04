import { DELAYS, SELECTORS } from "./config.js";
import { autoApplyDamage, autoRollSaves, resolvePendingSpellDamage, scheduleSpellDamageCheck } from "./features.js";
import { canUseTargetHelperAutomations, isToolbeltActive, registerTargetHelperAutomationsSetting } from "./settings.js";
import { state } from "./state.js";
import { asHTMLElement, getHTMLElements, resolveDamageMode } from "./utils.js";

export function registerTargetHelperHooks() {
  Hooks.once("init", registerTargetHelperAutomationsSetting);
  Hooks.once("ready", initializeTargetHelperAutomations);
}

function initializeTargetHelperAutomations() {
  if (!isToolbeltActive() || state.hooksRegistered) return;

  state.hooksRegistered = true;

  Hooks.on("renderChatMessageHTML", handleRenderedChatMessage);
  Hooks.on("createChatMessage", handleCreatedChatMessage);
  for (const hookName of ["pf2e-toolbelt.rollSave", "pf2e-toolbelt.rerollSave"]) {
    Hooks.on(hookName, ({ message }) => {
      if (message) scheduleSpellDamageCheck(message.id, DELAYS.saveHook);
    });
  }

  DELAYS.existingMessages.forEach((delay) => window.setTimeout(processExistingChatMessages, delay));
}

function handleRenderedChatMessage(message, html) {
  const root = asHTMLElement(html);
  if (root) queueMessageAutomation(message, root);
}

function handleCreatedChatMessage(message) {
  if (message?.isDamageRoll) resolvePendingSpellDamage(message);
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
