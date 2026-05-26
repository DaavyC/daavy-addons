import {
  findPreviousAttackOutcome,
  findPreviousMatchingAttackMessage,
  sameActor,
  sameItem
} from "../utils/target-helper-automation.js";
import { LIMITS, SAVE_TYPES } from "./constants.js";
import { hasTargetSaveControls } from "./dom.js";

// Checks if a message should roll saves.
export function isSpellSaveMessage(message) {
  if (!getSpellLikeItem(message)) return false;
  return hasTargetSaveControls(message.id) || isSaveType(getSpellSaveType(message));
}

// Resolves how damage should be handled.
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

// Gets the save type from a spell message.
export function getSpellSaveType(message) {
  const spell = getSpellLikeItem(message);
  const save = spell?.system?.defense?.save;
  return save?.statistic ?? spell?.system?.save?.value ?? null;
}

// Gets a spell or embedded consumable spell.
export function getSpellLikeItem(message) {
  const item = message?.item;
  if (!item) return null;
  if (item.isOfType?.("spell")) return item;
  if (item.isOfType?.("consumable") && item.embeddedSpell) return item.embeddedSpell;
  return null;
}

// Checks if a later damage message already exists.
export function hasRelatedDamageMessage(spellMessage) {
  const messages = game.messages.contents;
  const currentIndex = messages.findIndex((candidate) => candidate.id === spellMessage.id);
  if (currentIndex < 0) return false;

  const nextMessages = messages.slice(currentIndex + 1, currentIndex + 1 + LIMITS.relatedDamageWindow);
  return nextMessages.some((candidate) => isRelatedDamageMessage(spellMessage, candidate));
}

// Checks if a damage message belongs to a spell message.
export function isRelatedDamageMessage(spellMessage, damageMessage) {
  if (!spellMessage || !damageMessage?.isDamageRoll) return false;
  if ((damageMessage.timestamp ?? 0) < (spellMessage.timestamp ?? 0)) return false;

  return sameActor(spellMessage, damageMessage) && sameItem(spellMessage.item, damageMessage.item);
}

// Finds the previous attack outcome for a damage message.
export function findAttackOutcome(message, targetUuid) {
  return findPreviousAttackOutcome(game.messages.contents, message, {
    lookupWindow: LIMITS.attackLookupWindow,
    targetUuid
  });
}

// Checks if a damage message has a matching attack message.
export function hasMatchingAttackMessage(message) {
  return (
    findPreviousMatchingAttackMessage(game.messages.contents, message, {
      lookupWindow: LIMITS.attackLookupWindow
    }) !== null
  );
}

// Checks if a value is a supported save type.
function isSaveType(value) {
  return SAVE_TYPES.has(value ?? "");
}
