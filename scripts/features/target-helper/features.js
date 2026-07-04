import { ACTIONS_BY_MODE, DELAYS, LIMITS, SELECTORS } from "./config.js";
import { canUseTargetHelperAutomations } from "./settings.js";
import { state } from "./state.js";
import {
  extractOutcome,
  findActionButton,
  findAttackOutcome,
  findFirstDamageApplication,
  findSaveControl,
  findSpellDamageButton,
  getDamageApplicationTargetUuid,
  getDamageRows,
  getHTMLElements,
  getMessageRoot,
  getSpellLikeItem,
  getTargetRowIdentifier,
  getTargetRows,
  hasRelatedDamageMessage,
  isRelatedDamageMessage,
  isSpellSaveMessage,
  repeatMessageAutomation,
  resolveDamageMode
} from "./utils.js";

export async function autoApplyDamage(message, root) {
  if (!message?.isDamageRoll) return;

  const mode = resolveDamageMode(message);
  if (!mode) return;

  await repeatMessageAutomation(message, root, LIMITS.damagePasses, (currentRoot) =>
    applyNextDamage(message, currentRoot, mode)
  );
}

export async function autoRollSaves(message, root) {
  if (!isSpellSaveMessage(message)) return;

  const clickedSaves = await repeatMessageAutomation(message, root, LIMITS.savePasses, (currentRoot) =>
    clickPendingSave(message, currentRoot)
  );

  if (clickedSaves > 0 || resolveDamageMode(message) === "basic-save") {
    scheduleSpellDamageCheck(message.id, clickedSaves > 0 ? DELAYS.spellDamageInitial : 0);
  }
}

export function scheduleSpellDamageCheck(messageId, delay, attempt = 0) {
  if (state.handledSpellDamageRolls.has(messageId)) return;
  window.setTimeout(() => void autoRollSpellDamage(messageId, attempt), delay);
}

export function resolvePendingSpellDamage(damageMessage) {
  for (const messageId of state.pendingSpellDamageRolls.keys()) {
    const pendingMessage = game.messages.get(messageId);
    if (!isRelatedDamageMessage(pendingMessage, damageMessage)) continue;

    markSpellDamageHandled(messageId);
    return;
  }
}

function applyNextDamage(message, root, mode) {
  for (const row of getDamageRows(root)) {
    const application = findNextDamageApplication(message, row, mode);
    if (!application) continue;

    state.handledDamageApplications.add(application.key);
    application.button.click();
    return true;
  }

  return false;
}

function findNextDamageApplication(message, row, mode) {
  const outcome = getRowOutcome(message, row, mode);
  if (!outcome) return null;

  const action = ACTIONS_BY_MODE[mode]?.[outcome] ?? null;
  if (!action) return null;

  return findPendingDamageApplication(message, row, outcome, action);
}

function getRowOutcome(message, row, mode) {
  const outcome = extractOutcome(row);
  if (outcome) return outcome;
  if (mode === "attack-roll") return findAttackOutcome(message, getDamageApplicationTargetUuid(findFirstDamageApplication(row)));
  return null;
}

function findPendingDamageApplication(message, row, outcome, action) {
  for (const application of getHTMLElements(row, SELECTORS.damageApplication)) {
    if (application.classList.contains("applied")) continue;

    const button = findActionButton(application, action);
    if (!button) continue;

    const key = createDamageHandledKey(message, application, outcome, action);
    if (state.handledDamageApplications.has(key)) continue;

    return { button, key };
  }

  return null;
}

function createDamageHandledKey(message, application, outcome, action) {
  const targetUuid = getDamageApplicationTargetUuid(application) ?? "unknown-target";
  const rollIndex = application.dataset.targetRollIndex ?? "0";
  const actionId = action.type === "block" ? "block" : String(action.multiplier);
  return `${message.id}:${targetUuid}:${rollIndex}:${outcome}:${actionId}`;
}

function clickPendingSave(message, root) {
  const pendingSave = findPendingSave(message, root);
  if (!pendingSave) return false;

  state.handledSaveApplications.add(pendingSave.key);
  pendingSave.control.click();
  return true;
}

function findPendingSave(message, root) {
  const rows = getTargetRows(root);

  for (const [rowIndex, row] of rows.entries()) {
    if (extractOutcome(row)) continue;

    const control = findSaveControl(row);
    if (!control) continue;

    const key = createSaveHandledKey(message, row, rowIndex);
    if (state.handledSaveApplications.has(key)) continue;

    return { key, control };
  }

  return null;
}

function createSaveHandledKey(message, row, rowIndex) {
  const targetUuid = getTargetRowIdentifier(row, `row-${rowIndex}`);
  return `${message.id}:${rowIndex}:${targetUuid}:roll-save`;
}

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
  if (target.canFallback) {
    maybeFallbackToDirectSpellDamage(message);
    return retrySpellDamage(message.id, attempt);
  }

  retrySpellDamage(messageId, attempt);
}

function getBasicSaveMessage(messageId) {
  const message = game.messages.get(messageId);
  return message && resolveDamageMode(message) === "basic-save" ? message : null;
}

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

function clickSpellDamageButton(messageId, button, attempt) {
  state.pendingSpellDamageRolls.set(messageId, Date.now());
  button.click();
  retrySpellDamage(messageId, attempt, DELAYS.spellDamageAfterClick);
}

function findReadySpellDamageButton(root, targetRows, messageId) {
  if (targetRows.some(findSaveControl)) return null;

  const button = findSpellDamageButton(root);
  const lastAttempt = state.pendingSpellDamageRolls.get(messageId) ?? 0;
  if (!button || button.disabled || Date.now() - lastAttempt < DELAYS.spellDamageThrottle) return null;

  return button;
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
