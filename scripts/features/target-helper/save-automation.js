import { DELAYS, LIMITS } from "./constants.js";
import { extractOutcome, findSaveControl, getTargetRowIdentifier, getTargetRows } from "./dom.js";
import { isSpellSaveMessage, resolveDamageMode } from "./messages.js";
import { state } from "./state.js";
import { repeatMessageAutomation } from "./automation-runner.js";
import { scheduleSpellDamageCheck } from "./spell-damage-automation.js";

// Rolls pending Target Helper saves from spell save chat cards.
export async function autoRollSaves(message, root) {
  if (!isSpellSaveMessage(message)) return;

  const clickedSaves = await repeatMessageAutomation(message, root, LIMITS.savePasses, (currentRoot) =>
    clickPendingSave(message, currentRoot)
  );

  if (clickedSaves > 0 || resolveDamageMode(message) === "basic-save") {
    scheduleSpellDamageCheck(message.id, clickedSaves > 0 ? DELAYS.spellDamageInitial : 0);
  }
}

// Clicks one pending save per pass so Target Helper can update row state.
function clickPendingSave(message, root) {
  const pendingSave = findPendingSave(message, root);
  if (!pendingSave) return false;

  state.handledSaveApplications.add(pendingSave.key);
  pendingSave.control.click();
  return true;
}

// Finds the next target row without an outcome and without a handled key.
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

// Uniquely identifies a save click across message and target row.
function createSaveHandledKey(message, row, rowIndex) {
  const targetUuid = getTargetRowIdentifier(row, `row-${rowIndex}`);
  return `${message.id}:${rowIndex}:${targetUuid}:roll-save`;
}
