import { DELAYS, LIMITS } from "./constants.js";
import { extractOutcome, findFirstDamageApplication, findSaveControl, getTargetRows } from "./dom.js";
import { isSpellSaveMessage, resolveDamageMode } from "./messages.js";
import { state } from "./state.js";
import { repeatMessageAutomation } from "./automation-runner.js";
import { scheduleSpellDamageCheck } from "./spell-damage-automation.js";

export async function autoRollSaves(message, root) {
  if (!isSpellSaveMessage(message)) return;

  const clickedSaves = await repeatMessageAutomation(message, root, LIMITS.savePasses, (currentRoot) =>
    clickPendingSave(message, currentRoot)
  );

  if (clickedSaves > 0 || resolveDamageMode(message) === "basic-save") {
    scheduleSpellDamageCheck(message.id, clickedSaves > 0 ? DELAYS.spellDamageInitial : 0);
  }
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
  const targetUuid =
    findFirstDamageApplication(row)?.dataset.targetUuid ??
    row.dataset.targetUuid ??
    row.querySelector(".name")?.textContent?.trim() ??
    `row-${rowIndex}`;

  return `${message.id}:${rowIndex}:${targetUuid}:roll-save`;
}
