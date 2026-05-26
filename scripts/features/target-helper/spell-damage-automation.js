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

export function scheduleSpellDamageCheck(messageId, delay, attempt = 0) {
  if (state.handledSpellDamageRolls.has(messageId)) return;
  schedule(() => autoRollSpellDamage(messageId, attempt), delay);
}

export function resolvePendingSpellDamage(damageMessage) {
  for (const messageId of state.pendingSpellDamageRolls.keys()) {
    const pendingMessage = game.messages.get(messageId);
    if (!isRelatedDamageMessage(pendingMessage, damageMessage)) continue;

    markSpellDamageHandled(messageId);
    return;
  }
}

function autoRollSpellDamage(messageId, attempt = 0) {
  if (!canUseTargetHelperAutomations() || state.handledSpellDamageRolls.has(messageId)) return;

  const message = game.messages.get(messageId);
  if (!message || resolveDamageMode(message) !== "basic-save") return;

  if (hasRelatedDamageMessage(message)) {
    markSpellDamageHandled(message.id);
    return;
  }

  const root = getMessageRoot(messageId);
  if (!(root instanceof HTMLElement)) {
    return retrySpellDamageWithFallback(message, attempt);
  }

  const rows = getTargetRows(root);
  if (rows.length === 0) {
    return retrySpellDamageWithFallback(message, attempt);
  }

  const button = findReadySpellDamageButton(root, rows, messageId);
  if (!button) {
    return retrySpellDamage(messageId, attempt);
  }

  state.pendingSpellDamageRolls.set(messageId, Date.now());
  button.click();
  retrySpellDamage(messageId, attempt, DELAYS.spellDamageAfterClick);
}

function retrySpellDamageWithFallback(message, attempt) {
  maybeFallbackToDirectSpellDamage(message);
  retrySpellDamage(message.id, attempt);
}

function findReadySpellDamageButton(root, targetRows, messageId) {
  if (targetRows.some(findSaveControl)) return null;

  const button = findSpellDamageButton(root);
  if (!button || button.disabled || isSpellDamageThrottled(messageId)) return null;

  return button;
}

function isSpellDamageThrottled(messageId) {
  const lastAttempt = state.pendingSpellDamageRolls.get(messageId) ?? 0;
  return Date.now() - lastAttempt < DELAYS.spellDamageThrottle;
}

function retrySpellDamage(messageId, attempt, delay = DELAYS.spellDamageRetry) {
  if (attempt >= LIMITS.spellDamageAttempts) return;
  scheduleSpellDamageCheck(messageId, delay, attempt + 1);
}

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

function markSpellDamageHandled(messageId) {
  state.handledSpellDamageRolls.add(messageId);
  state.pendingSpellDamageRolls.delete(messageId);
  state.spellDamageFallbackAttempts.delete(messageId);
}
