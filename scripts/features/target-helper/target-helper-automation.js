export const DEGREE_OUTCOMES = Object.freeze([
  "criticalFailure",
  "failure",
  "success",
  "criticalSuccess"
]);

const ATTACK_CONTEXT_TYPES = new Set(["attack-roll", "spell-attack", "spell-attack-roll"]);
const ITEM_IDENTITY_KEYS = ["uuid", "sourceId", "slug", "name"];
const DEFAULT_ATTACK_LOOKUP_WINDOW = 10;

// Checks if a PF2e context type is an attack roll.
export function isAttackContextType(value) {
  return ATTACK_CONTEXT_TYPES.has(value ?? "");
}

// Checks whether two chat messages belong to the same actor.
export function sameActor(leftMessage, rightMessage) {
  const leftActorUuid = getMessageActorUuid(leftMessage);
  const rightActorUuid = getMessageActorUuid(rightMessage);
  return Boolean(leftActorUuid && rightActorUuid && leftActorUuid === rightActorUuid);
}

// Checks whether two items share any stable identity field.
export function sameItem(leftItem, rightItem) {
  if (!leftItem || !rightItem) return false;

  return ITEM_IDENTITY_KEYS.some((key) => hasSameIdentityValue(leftItem, rightItem, key));
}

// Finds the previous attack message matching a damage message.
export function findPreviousMatchingAttackMessage(messages, damageMessage, options = {}) {
  return findPreviousAttackMessage(messages, damageMessage, options, (candidate) => candidate);
}

// Finds the degree of success from the previous matching attack message.
export function findPreviousAttackOutcome(messages, damageMessage, options = {}) {
  return findPreviousAttackMessage(messages, damageMessage, options, (candidate) => {
    const outcome = candidate.flags?.pf2e?.context?.outcome;
    return isDegreeOutcome(outcome) ? outcome : null;
  });
}

// Walks backward through the bounded chat-message window.
function findPreviousAttackMessage(messages, damageMessage, options, getResult) {
  const search = createPreviousMessageSearch(messages, damageMessage, options.lookupWindow);
  if (!search) return null;

  const targetUuid = options.targetUuid ?? null;

  for (let index = search.currentIndex - 1; index >= search.lowestIndex; index -= 1) {
    const candidate = search.messages[index];
    if (!isMatchingAttackMessage(damageMessage, candidate, targetUuid)) continue;

    const result = getResult(candidate);
    if (result !== null) return result;
  }

  return null;
}

// Creates a bounded search ending immediately before the current message.
function createPreviousMessageSearch(messages, currentMessage, lookupWindow = DEFAULT_ATTACK_LOOKUP_WINDOW) {
  if (!Array.isArray(messages) || !currentMessage?.id) return null;

  const currentIndex = messages.findIndex((candidate) => candidate?.id === currentMessage.id);
  if (currentIndex < 1) return null;

  const windowSize = Number.isFinite(lookupWindow) ? Math.max(0, lookupWindow) : 0;
  return {
    messages,
    currentIndex,
    lowestIndex: Math.max(0, currentIndex - windowSize)
  };
}

// Applies actor, item, attack type, and optional target checks.
function isMatchingAttackMessage(damageMessage, candidate, targetUuid) {
  if (!candidate?.isCheckRoll) return false;
  if (!isAttackContextType(candidate.flags?.pf2e?.context?.type)) return false;
  if (!sameActor(damageMessage, candidate)) return false;
  if (!sameItem(damageMessage.item, candidate.item)) return false;

  if (!targetUuid) return true;
  const candidateTargetUuid = candidate.target?.token?.uuid ?? candidate.target?.uuid ?? null;
  return !candidateTargetUuid || candidateTargetUuid === targetUuid;
}

// Prevents unrelated PF2e strings from being treated as outcomes.
function isDegreeOutcome(value) {
  return DEGREE_OUTCOMES.includes(value);
}

// Falls back to speaker actor when the message actor is unavailable.
function getMessageActorUuid(message) {
  return message?.actor?.uuid ?? message?.speaker?.actor ?? null;
}

// Compares a single item identity field.
function hasSameIdentityValue(leftItem, rightItem, key) {
  const leftValue = leftItem?.[key];
  return isIdentityValue(leftValue) && leftValue === rightItem?.[key];
}

// Empty identity values are not stable enough to match items.
function isIdentityValue(value) {
  return value !== null && value !== undefined && value !== "";
}
