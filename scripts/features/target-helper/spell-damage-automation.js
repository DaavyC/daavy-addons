import { DELAYS, LIMITS } from "./constants.js";
import { findSaveControl, findSpellDamageButton, getMessageRoot, getTargetRows } from "./dom.js";
import {
  getSpellLikeItem,
  hasRelatedDamageMessage,
  isRelatedDamageMessage,
  resolveDamageMode
} from "./messages.js";
import { canUseTargetHelperAutomations } from "./settings.js";
import { schedule } from "./scheduler.js";
import { state } from "./state.js";

// Queues delayed spell damage checks after save automation settles.
export function scheduleSpellDamageCheck(messageId, delay, attempt = 0) {
  if (state.handledSpellDamageRolls.has(messageId)) return;
  schedule(() => autoRollSpellDamage(messageId, attempt), delay);
}

// Marks pending spell damage as handled when Foundry creates the damage message.
export function resolvePendingSpellDamage(damageMessage) {
  for (const messageId of state.pendingSpellDamageRolls.keys()) {
    const pendingMessage = game.messages.get(messageId);
    if (!isRelatedDamageMessage(pendingMessage, damageMessage)) continue;

    markSpellDamageHandled(messageId);
    return;
  }
}

// Rolls spell damage after all Target Helper saves have outcomes.
function autoRollSpellDamage(messageId, attempt = 0) {
  if (!canUseTargetHelperAutomations() || state.handledSpellDamageRolls.has(messageId)) return;

  const message = getBasicSaveMessage(messageId);
  if (!message) return;
  if (hasRelatedDamageMessage(message)) {
    markSpellDamageHandled(message.id);
    return;
  }

  const target = getSpellDamageTarget(messageId);
  if (target.button) return clickSpellDamageButton(messageId, target.button, attempt);
  if (target.canFallback) return retrySpellDamageWithFallback(message, attempt);

  retrySpellDamage(messageId, attempt);
}

// Spell damage automation only applies to basic-save spell messages.
function getBasicSaveMessage(messageId) {
  const message = game.messages.get(messageId);
  return message && resolveDamageMode(message) === "basic-save" ? message : null;
}

// Distinguishes missing DOM fallback from visible-but-not-ready buttons.
function getSpellDamageTarget(messageId) {
  const root = getMessageRoot(messageId);
  if (!(root instanceof HTMLElement)) return { button: null, canFallback: true };

  const rows = getTargetRows(root);
  if (rows.length === 0) return { button: null, canFallback: true };

  return {
    button: findReadySpellDamageButton(root, rows, messageId),
    canFallback: false
  };
}

// Tracks the click before retrying so created damage can be matched later.
function clickSpellDamageButton(messageId, button, attempt) {
  state.pendingSpellDamageRolls.set(messageId, Date.now());
  button.click();
  retrySpellDamage(messageId, attempt, DELAYS.spellDamageAfterClick);
}

// Attempts direct item roll only when the original button is unavailable.
function retrySpellDamageWithFallback(message, attempt) {
  maybeFallbackToDirectSpellDamage(message);
  retrySpellDamage(message.id, attempt);
}

// Button is ready only after all save controls disappear.
function findReadySpellDamageButton(root, targetRows, messageId) {
  if (targetRows.some(findSaveControl)) return null;

  const button = findSpellDamageButton(root);
  if (!button || button.disabled || isSpellDamageThrottled(messageId)) return null;

  return button;
}

// Prevents repeated spell damage clicks while Foundry processes the last click.
function isSpellDamageThrottled(messageId) {
  const lastAttempt = state.pendingSpellDamageRolls.get(messageId) ?? 0;
  return Date.now() - lastAttempt < DELAYS.spellDamageThrottle;
}

// Retries until Target Helper finishes rendering or the attempt limit is hit.
function retrySpellDamage(messageId, attempt, delay = DELAYS.spellDamageRetry) {
  if (attempt >= LIMITS.spellDamageAttempts) return;
  scheduleSpellDamageCheck(messageId, delay, attempt + 1);
}

// Final fallback for cards that disappeared after a previous queued attempt.
function maybeFallbackToDirectSpellDamage(message) {
  if (!message) return;
  if (!state.pendingSpellDamageRolls.has(message.id)) return;
  if (state.spellDamageFallbackAttempts.has(message.id)) return;
  if (hasRelatedDamageMessage(message)) return;

  const spell = getSpellLikeItem(message) ?? message.item;
  if (typeof spell?.rollDamage !== "function") return;

  state.spellDamageFallbackAttempts.add(message.id);
  void Promise.resolve(spell.rollDamage(new MouseEvent("click"))).catch(() => {});
}

// Clears all spell-damage tracking once related damage exists.
function markSpellDamageHandled(messageId) {
  state.handledSpellDamageRolls.add(messageId);
  state.pendingSpellDamageRolls.delete(messageId);
  state.spellDamageFallbackAttempts.delete(messageId);
}
