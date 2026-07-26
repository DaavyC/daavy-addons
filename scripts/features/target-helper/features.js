import { ACTIONS_BY_MODE, DELAYS, LIMITS, SELECTORS } from "../../constants.js";
import { canUseTargetHelperAutomations } from "./settings.js";
import {
  extractOutcome,
  findActionButton,
  findAttackOutcome,
  findFirstDamageApplication,
  findSaveControl,
  getDamageApplicationTargetUuid,
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

const state = {
  handledDamageApplications: new Set(),
  handledSaveApplications: new Set(),
  handledSpellDamageRolls: new Set(),
  pendingSpellDamageRolls: new Map(),
  spellDamageFallbackAttempts: new Set()
};

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
  for (const row of getHTMLElements(root, SELECTORS.damageRows)) {
    const application = findNextDamageApplication(message, row, mode);
    if (!application) continue;

    state.handledDamageApplications.add(application.key);
    application.button.click();
    return true;
  }

  return false;
}

function findNextDamageApplication(message, row, mode) {
  const outcome = extractOutcome(row)
    ?? (mode === "attack-roll" ? findAttackOutcome(message, getDamageApplicationTargetUuid(findFirstDamageApplication(row))) : null);
  if (!outcome) return null;

  const action = ACTIONS_BY_MODE[mode]?.[outcome] ?? null;
  if (!action) return null;

  return findPendingDamageApplication(message, row, outcome, action);
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
  for (const [rowIndex, row] of getTargetRows(root).entries()) {
    if (extractOutcome(row)) continue;

    const control = findSaveControl(row);
    if (!control) continue;

    const key = `${message.id}:${rowIndex}:${getTargetRowIdentifier(row, `row-${rowIndex}`)}:roll-save`;
    if (state.handledSaveApplications.has(key)) continue;

    return { key, control };
  }

  return null;
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
  const rows = root instanceof HTMLElement ? getTargetRows(root) : [];
  if (rows.length === 0) {
    maybeFallbackToDirectSpellDamage(message);
    return retrySpellDamage(message.id, attempt);
  }

  const button = findReadySpellDamageButton(root, rows, messageId);
  if (button) return clickSpellDamageButton(messageId, button, attempt);
  retrySpellDamage(messageId, attempt);
}

function clickSpellDamageButton(messageId, button, attempt) {
  state.pendingSpellDamageRolls.set(messageId, Date.now());
  button.click();
  retrySpellDamage(messageId, attempt, DELAYS.spellDamageAfterClick);
}

function findReadySpellDamageButton(root, targetRows, messageId) {
  if (targetRows.some(findSaveControl)) return null;

  const candidate = root.querySelector(SELECTORS.spellDamageAction);
  const button = candidate instanceof HTMLButtonElement ? candidate : null;
  const lastAttempt = state.pendingSpellDamageRolls.get(messageId) ?? 0;
  if (!button || button.disabled || Date.now() - lastAttempt < DELAYS.spellDamageThrottle) return null;

  return button;
}

function retrySpellDamage(messageId, attempt, delay = DELAYS.spellDamageRetry) {
  if (attempt >= LIMITS.spellDamageAttempts) return;
  scheduleSpellDamageCheck(messageId, delay, attempt + 1);
}

function maybeFallbackToDirectSpellDamage(message) {
  if (
    !message ||
    !state.pendingSpellDamageRolls.has(message.id) ||
    state.spellDamageFallbackAttempts.has(message.id) ||
    hasRelatedDamageMessage(message)
  ) return;

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
