import { DEGREE_OUTCOMES, DELAYS, LIMITS, SAVE_TYPES, SELECTORS } from "./config.js";

const ATTACK_CONTEXT_TYPES = new Set(["attack-roll", "spell-attack", "spell-attack-roll"]);
const ITEM_IDENTITY_KEYS = ["uuid", "sourceId", "slug", "name"];

export function asHTMLElement(value) {
  if (value instanceof HTMLElement) return value;
  if (value?.[0] instanceof HTMLElement) return value[0];
  return null;
}

export function getHTMLElements(root, selector) {
  return Array.from(root.querySelectorAll(selector)).filter(isHTMLElement);
}

export function getMessageRoot(messageId) {
  return asHTMLElement(document.querySelector(messageRootSelector(messageId)));
}

export function getTargetRows(root) {
  return getHTMLElements(root, SELECTORS.targetRows);
}

export function getDamageRows(root) {
  return getHTMLElements(root, SELECTORS.damageRows);
}

export function hasTargetSaveControls(messageId) {
  return document.querySelector(`${messageRootSelector(messageId)} ${SELECTORS.targetRows} ${SELECTORS.saveAction}`) !== null;
}

export function findSaveControl(row) {
  return asHTMLElement(row.querySelector(SELECTORS.saveAction));
}

export function extractOutcome(row) {
  const degree = row.querySelector(".degree");
  const classes = degree?.classList ?? row.querySelector(".damage-application")?.classList ?? row.classList;
  if (!classes) return null;

  return DEGREE_OUTCOMES.find((outcome) => classes.contains(outcome)) ?? null;
}

export function findSpellDamageButton(root) {
  const button = root.querySelector(SELECTORS.spellDamageAction);
  return button instanceof HTMLButtonElement ? button : null;
}

export function findActionButton(application, action) {
  return (
    getHTMLElements(application, SELECTORS.actionButton).find((button) =>
      button instanceof HTMLButtonElement && matchesActionButton(button, action)
    ) ?? null
  );
}

export function findFirstDamageApplication(root) {
  return asHTMLElement(root.querySelector(SELECTORS.damageApplication));
}

export function getDamageApplicationTargetUuid(application) {
  return application?.dataset.targetUuid ?? null;
}

export function getTargetRowIdentifier(row, fallback) {
  return (
    getDamageApplicationTargetUuid(findFirstDamageApplication(row)) ??
    row.dataset.targetUuid ??
    row.querySelector(".name")?.textContent?.trim() ??
    fallback
  );
}

export function isSpellSaveMessage(message) {
  if (!getSpellLikeItem(message)) return false;
  return hasTargetSaveControls(message.id) || SAVE_TYPES.has(getSpellSaveType(message) ?? "");
}

export function resolveDamageMode(message) {
  const spell = getSpellLikeItem(message);
  if (!spell) return "attack-roll";

  if (spell.system?.defense?.save?.basic && SAVE_TYPES.has(getSpellSaveType(message) ?? "")) {
    return "basic-save";
  }

  if (findPreviousAttackMessage(game.messages.contents, message, { lookupWindow: LIMITS.attackLookupWindow }, (candidate) => candidate) !== null) {
    return "attack-roll";
  }

  return null;
}

export function getSpellSaveType(message) {
  const spell = getSpellLikeItem(message);
  const save = spell?.system?.defense?.save;
  return save?.statistic ?? spell?.system?.save?.value ?? null;
}

export function getSpellLikeItem(message) {
  const item = message?.item;
  if (!item) return null;
  if (item.isOfType?.("spell")) return item;
  if (item.isOfType?.("consumable") && item.embeddedSpell) return item.embeddedSpell;
  return null;
}

export function hasRelatedDamageMessage(spellMessage) {
  const messages = game.messages.contents;
  const currentIndex = messages.findIndex((candidate) => candidate.id === spellMessage.id);
  if (currentIndex < 0) return false;

  const nextMessages = messages.slice(currentIndex + 1, currentIndex + 1 + LIMITS.relatedDamageWindow);
  return nextMessages.some((candidate) => isRelatedDamageMessage(spellMessage, candidate));
}

export function isRelatedDamageMessage(spellMessage, damageMessage) {
  if (!spellMessage || !damageMessage?.isDamageRoll) return false;
  if ((damageMessage.timestamp ?? 0) < (spellMessage.timestamp ?? 0)) return false;

  return sameActor(spellMessage, damageMessage) && sameItem(spellMessage.item, damageMessage.item);
}

export function findAttackOutcome(message, targetUuid) {
  return findPreviousAttackMessage(
    game.messages.contents,
    message,
    {
      lookupWindow: LIMITS.attackLookupWindow,
      targetUuid
    },
    (candidate) => {
      const outcome = candidate.flags?.pf2e?.context?.outcome;
      return DEGREE_OUTCOMES.includes(outcome) ? outcome : null;
    }
  );
}

export async function repeatMessageAutomation(message, root, passLimit, runPass) {
  let currentRoot = root;
  let completedPasses = 0;

  for (let pass = 0; pass < passLimit; pass += 1) {
    currentRoot = getMessageRoot(message.id) ?? currentRoot;
    if (!(currentRoot instanceof HTMLElement)) break;
    if (!runPass(currentRoot)) break;

    completedPasses += 1;
    await new Promise((resolve) => window.setTimeout(resolve, DELAYS.clickPause));
  }

  return completedPasses;
}

function messageRootSelector(value) {
  const stringValue = String(value);
  const escaped = globalThis.CSS?.escape
    ? globalThis.CSS.escape(stringValue)
    : stringValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `[data-message-id="${escaped}"]`;
}

function matchesActionButton(button, action) {
  if (action.type === "multiplier") {
    return button.dataset.action?.endsWith("applyDamage") && button.dataset.multiplier === String(action.multiplier);
  }

  const label = button.textContent?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
  return (button.dataset.action?.endsWith("applyDamage") && button.dataset.multiplier === "0") || label === "block";
}

function sameActor(leftMessage, rightMessage) {
  const leftActorUuid = getMessageActorUuid(leftMessage);
  const rightActorUuid = getMessageActorUuid(rightMessage);
  return Boolean(leftActorUuid && rightActorUuid && leftActorUuid === rightActorUuid);
}

function sameItem(leftItem, rightItem) {
  if (!leftItem || !rightItem) return false;

  return ITEM_IDENTITY_KEYS.some((key) => hasSameIdentityValue(leftItem, rightItem, key));
}

function findPreviousAttackMessage(messages, damageMessage, options, getResult) {
  if (!Array.isArray(messages) || !damageMessage?.id) return null;

  const currentIndex = messages.findIndex((candidate) => candidate?.id === damageMessage.id);
  if (currentIndex < 1) return null;

  const lowestIndex = Math.max(0, currentIndex - Math.max(0, options.lookupWindow));
  const targetUuid = options.targetUuid ?? null;

  for (let index = currentIndex - 1; index >= lowestIndex; index -= 1) {
    const candidate = messages[index];
    if (!isMatchingAttackMessage(damageMessage, candidate, targetUuid)) continue;

    const result = getResult(candidate);
    if (result !== null) return result;
  }

  return null;
}

function isMatchingAttackMessage(damageMessage, candidate, targetUuid) {
  if (!candidate?.isCheckRoll) return false;
  if (!ATTACK_CONTEXT_TYPES.has(candidate.flags?.pf2e?.context?.type ?? "")) return false;
  if (!sameActor(damageMessage, candidate)) return false;
  if (!sameItem(damageMessage.item, candidate.item)) return false;

  if (!targetUuid) return true;
  const candidateTargetUuid = candidate.target?.token?.uuid ?? candidate.target?.uuid ?? null;
  return !candidateTargetUuid || candidateTargetUuid === targetUuid;
}

function getMessageActorUuid(message) {
  return message?.actor?.uuid ?? message?.speaker?.actor ?? null;
}

function hasSameIdentityValue(leftItem, rightItem, key) {
  const leftValue = leftItem?.[key];
  return leftValue !== null && leftValue !== undefined && leftValue !== "" && leftValue === rightItem?.[key];
}

function isHTMLElement(value) {
  return value instanceof HTMLElement;
}
