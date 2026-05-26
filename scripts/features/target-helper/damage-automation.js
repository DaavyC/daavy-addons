import { ACTIONS_BY_MODE, LIMITS, SELECTORS } from "./constants.js";
import {
  extractOutcome,
  findActionButton,
  findFirstDamageApplication,
  getDamageRows,
  getHTMLElements
} from "./dom.js";
import { findAttackOutcome, resolveDamageMode } from "./messages.js";
import { state } from "./state.js";
import { repeatMessageAutomation } from "./automation-runner.js";

export async function autoApplyDamage(message, root) {
  if (!message?.isDamageRoll) return;

  const mode = resolveDamageMode(message);
  if (!mode) return;

  await repeatMessageAutomation(message, root, LIMITS.damagePasses, (currentRoot) =>
    applyNextDamage(message, currentRoot, mode)
  );
}

function applyNextDamage(message, root, mode) {
  const rows = getDamageRows(root);
  if (rows.length === 0) return false;

  for (const row of rows) {
    const outcome = getRowOutcome(message, row, mode);
    if (!outcome) continue;

    const action = resolveAction(mode, outcome);
    if (!action) continue;

    const application = findPendingDamageApplication(message, row, outcome, action);
    if (!application) continue;

    state.handledDamageApplications.add(application.key);
    application.button.click();
    return true;
  }

  return false;
}

function getRowOutcome(message, row, mode) {
  const outcome = extractOutcome(row);
  if (outcome) return outcome;
  if (mode === "attack-roll") return findAttackOutcome(message, getRowTargetUuid(row));
  return null;
}

function getRowTargetUuid(row) {
  return findFirstDamageApplication(row)?.dataset.targetUuid ?? null;
}

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

function resolveAction(mode, outcome) {
  return ACTIONS_BY_MODE[mode]?.[outcome] ?? null;
}

function createHandledKey(message, application, outcome, action) {
  const targetUuid = application.dataset.targetUuid ?? "unknown-target";
  const rollIndex = application.dataset.targetRollIndex ?? "0";
  return `${message.id}:${targetUuid}:${rollIndex}:${outcome}:${getActionId(action)}`;
}

function getActionId(action) {
  return action.type === "block" ? "block" : String(action.multiplier);
}
