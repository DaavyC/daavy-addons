export const DEGREE_OUTCOMES = Object.freeze([
  "criticalFailure",
  "failure",
  "success",
  "criticalSuccess"
]);

const ATTACK_CONTEXT_TYPES = new Set(["attack-roll", "spell-attack", "spell-attack-roll"]);
const ITEM_IDENTITY_KEYS = ["uuid", "sourceId", "slug", "name"];
const DEFAULT_ATTACK_LOOKUP_WINDOW = 10;

// Checks if a PF2e context type is an attack.
export function isAttackContextType(value) {
  return ATTACK_CONTEXT_TYPES.has(value ?? "");
}

// Checks if two messages have the same actor.
export function sameActor(leftMessage, rightMessage) {
  const leftActorUuid = getMessageActorUuid(leftMessage);
  const rightActorUuid = getMessageActorUuid(rightMessage);
  return Boolean(leftActorUuid && rightActorUuid && leftActorUuid === rightActorUuid);
}

// Checks if two items share an identity value.
export function sameItem(leftItem, rightItem) {
  if (!leftItem || !rightItem) return false;

  return ITEM_IDENTITY_KEYS.some((key) => hasSameIdentityValue(leftItem, rightItem, key));
}

// Finds a previous matching attack message.
export function findPreviousMatchingAttackMessage(messages, damageMessage, options = {}) {
  return findPreviousAttackMessage(messages, damageMessage, options, (candidate) => candidate);
}

// Finds a previous attack outcome.
export function findPreviousAttackOutcome(messages, damageMessage, options = {}) {
  return findPreviousAttackMessage(messages, damageMessage, options, (candidate) => {
    const outcome = candidate.flags?.pf2e?.context?.outcome;
    return isDegreeOutcome(outcome) ? outcome : null;
  });
}

// Searches backward for an attack message.
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

// Creates a bounded previous-message search.
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

// Checks if an attack message matches a damage message.
function isMatchingAttackMessage(damageMessage, candidate, targetUuid) {
  if (!candidate?.isCheckRoll) return false;
  if (!isAttackContextType(candidate.flags?.pf2e?.context?.type)) return false;
  if (!sameActor(damageMessage, candidate)) return false;
  if (!sameItem(damageMessage.item, candidate.item)) return false;

  if (!targetUuid) return true;
  const candidateTargetUuid = candidate.target?.token?.uuid ?? candidate.target?.uuid ?? null;
  return !candidateTargetUuid || candidateTargetUuid === targetUuid;
}

// Checks if a value is a degree outcome.
function isDegreeOutcome(value) {
  return DEGREE_OUTCOMES.includes(value);
}

// Gets the actor UUID from a message.
function getMessageActorUuid(message) {
  return message?.actor?.uuid ?? message?.speaker?.actor ?? null;
}

// Checks if two item identity values match.
function hasSameIdentityValue(leftItem, rightItem, key) {
  const leftValue = leftItem?.[key];
  return isIdentityValue(leftValue) && leftValue === rightItem?.[key];
}

// Checks if a value can identify an item.
function isIdentityValue(value) {
  return value !== null && value !== undefined && value !== "";
}
