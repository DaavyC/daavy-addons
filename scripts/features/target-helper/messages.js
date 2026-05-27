import {
  findPreviousAttackOutcome,
  findPreviousMatchingAttackMessage,
  sameActor,
  sameItem
} from "./target-helper-automation.js";
import { LIMITS, SAVE_TYPES } from "./constants.js";
import { hasTargetSaveControls } from "./dom.js";

// A spell message should roll saves when a save type or save UI exists.
export function isSpellSaveMessage(message) {
  if (!getSpellLikeItem(message)) return false;
  return hasTargetSaveControls(message.id) || isSaveType(getSpellSaveType(message));
}

// Resolves whether damage follows basic-save rules or previous attack outcome.
export function resolveDamageMode(message) {
  const spell = getSpellLikeItem(message);
  if (!spell) return "attack-roll";

  if (spell.system?.defense?.save?.basic && isSaveType(getSpellSaveType(message))) {
    return "basic-save";
  }

  if (hasMatchingAttackMessage(message)) {
    return "attack-roll";
  }

  return null;
}

// Supports both spell schema and older/embedded save schema shapes.
export function getSpellSaveType(message) {
  const spell = getSpellLikeItem(message);
  const save = spell?.system?.defense?.save;
  return save?.statistic ?? spell?.system?.save?.value ?? null;
}

// Accepts normal spell items and consumables with embedded spells.
export function getSpellLikeItem(message) {
  const item = message?.item;
  if (!item) return null;
  if (item.isOfType?.("spell")) return item;
  if (item.isOfType?.("consumable") && item.embeddedSpell) return item.embeddedSpell;
  return null;
}

// Detects damage already rolled shortly after a spell message.
export function hasRelatedDamageMessage(spellMessage) {
  const messages = getChatMessages();
  const currentIndex = messages.findIndex((candidate) => candidate.id === spellMessage.id);
  if (currentIndex < 0) return false;

  const nextMessages = messages.slice(currentIndex + 1, currentIndex + 1 + LIMITS.relatedDamageWindow);
  return nextMessages.some((candidate) => isRelatedDamageMessage(spellMessage, candidate));
}

// Damage belongs to a spell when actor, item identity, and timestamp align.
export function isRelatedDamageMessage(spellMessage, damageMessage) {
  if (!spellMessage || !damageMessage?.isDamageRoll) return false;
  if ((damageMessage.timestamp ?? 0) < (spellMessage.timestamp ?? 0)) return false;

  return sameActor(spellMessage, damageMessage) && sameItem(spellMessage.item, damageMessage.item);
}

// Finds prior attack outcome for attack-roll damage application.
export function findAttackOutcome(message, targetUuid) {
  return findPreviousAttackOutcome(getChatMessages(), message, {
    lookupWindow: LIMITS.attackLookupWindow,
    targetUuid
  });
}

// Checks if this damage message can be tied to a previous attack roll.
export function hasMatchingAttackMessage(message) {
  return (
    findPreviousMatchingAttackMessage(getChatMessages(), message, {
      lookupWindow: LIMITS.attackLookupWindow
    }) !== null
  );
}

// Centralizes access to Foundry's ordered chat message collection.
function getChatMessages() {
  return game.messages.contents;
}

function isSaveType(value) {
  return SAVE_TYPES.has(value ?? "");
}
