import { ACTIONS_BY_MODE, LIMITS, SELECTORS } from "./constants.js";
import {
  extractOutcome,
  findActionButton,
  findFirstDamageApplication,
  getDamageApplicationTargetUuid,
  getDamageRows,
  getHTMLElements
} from "./dom.js";
import { findAttackOutcome, resolveDamageMode } from "./messages.js";
import { state } from "./state.js";
import { repeatMessageAutomation } from "./automation-runner.js";

// Applies pending Target Helper damage entries from a damage chat message.
export async function autoApplyDamage(message, root) {
  if (!message?.isDamageRoll) return;

  const mode = resolveDamageMode(message);
  if (!mode) return;

  await repeatMessageAutomation(message, root, LIMITS.damagePasses, (currentRoot) =>
    applyNextDamage(message, currentRoot, mode)
  );
}

// Clicks one pending damage application per pass so DOM updates stay in sync.
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

// Resolves row outcome, damage rule, and pending application together.
function findNextDamageApplication(message, row, mode) {
  const outcome = getRowOutcome(message, row, mode);
  if (!outcome) return null;

  const action = resolveAction(mode, outcome);
  if (!action) return null;

  return findPendingDamageApplication(message, row, outcome, action);
}

// Attack-roll damage may need outcome from the previous attack message.
function getRowOutcome(message, row, mode) {
  const outcome = extractOutcome(row);
  if (outcome) return outcome;
  if (mode === "attack-roll") return findAttackOutcome(message, getRowTargetUuid(row));
  return null;
}

// Uses target uuid when resolving attack-roll outcomes per target row.
function getRowTargetUuid(row) {
  return getDamageApplicationTargetUuid(findFirstDamageApplication(row));
}

// Skips already-applied or already-clicked damage application buttons.
function findPendingDamageApplication(message, row, outcome, action) {
  const applications = getHTMLElements(row, SELECTORS.damageApplication);

  for (const application of applications) {
    if (application.classList.contains("applied")) continue;

    const button = findActionButton(application, action);
    if (!button) continue;

    const key = createHandledKey(message, application, outcome, action);
    if (state.handledDamageApplications.has(key)) continue;

    return { button, key };
  }

  return null;
}

// Maps basic-save/attack-roll outcomes to Target Helper damage buttons.
function resolveAction(mode, outcome) {
  return ACTIONS_BY_MODE[mode]?.[outcome] ?? null;
}

// Uniquely identifies a damage click across message, target, roll, outcome, and action.
function createHandledKey(message, application, outcome, action) {
  const targetUuid = getDamageApplicationTargetUuid(application) ?? "unknown-target";
  const rollIndex = application.dataset.targetRollIndex ?? "0";
  return `${message.id}:${targetUuid}:${rollIndex}:${outcome}:${getActionId(action)}`;
}

// Normalizes action identity for duplicate-click protection.
function getActionId(action) {
  return action.type === "block" ? "block" : String(action.multiplier);
}
