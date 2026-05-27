import { DEGREE_OUTCOMES } from "./target-helper-automation.js";
import { SELECTORS } from "./constants.js";

// Converts Foundry/jQuery-like HTML wrappers to a plain HTMLElement.
export function asHTMLElement(value) {
  if (value instanceof HTMLElement) return value;
  if (value?.[0] instanceof HTMLElement) return value[0];
  return null;
}

// Returns only real HTMLElements from selector results.
export function getHTMLElements(root, selector) {
  return Array.from(root.querySelectorAll(selector)).filter(isHTMLElement);
}

// Gets a rendered chat message root by Foundry message id.
export function getMessageRoot(messageId) {
  return asHTMLElement(document.querySelector(getMessageRootSelector(messageId)));
}

// Builds a CSS selector safe for Foundry message ids.
export function getMessageRootSelector(messageId) {
  return `[data-message-id="${escapeCssAttributeValue(messageId)}"]`;
}

// Escapes CSS attribute values even when CSS.escape is unavailable.
export function escapeCssAttributeValue(value) {
  const stringValue = String(value);
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(stringValue);
  return stringValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Finds Target Helper rows that can still need saves.
export function getTargetRows(root) {
  return getHTMLElements(root, SELECTORS.targetRows);
}

// Finds Target Helper damage rows.
export function getDamageRows(root) {
  return getHTMLElements(root, SELECTORS.damageRows);
}

// Checks whether a rendered chat card still exposes save buttons.
export function hasTargetSaveControls(messageId) {
  const messageRootSelector = getMessageRootSelector(messageId);
  return document.querySelector(`${messageRootSelector} ${SELECTORS.targetRows} ${SELECTORS.saveAction}`) !== null;
}

// Finds a row-level Target Helper save control.
export function findSaveControl(row) {
  return asHTMLElement(row.querySelector(SELECTORS.saveAction));
}

// Reads PF2e degree-of-success classes from current or nested row state.
export function extractOutcome(row) {
  const degree = row.querySelector(".degree");
  const classes = degree?.classList ?? row.querySelector(".damage-application")?.classList ?? row.classList;
  if (!classes) return null;

  return DEGREE_OUTCOMES.find((outcome) => classes.contains(outcome)) ?? null;
}

// Finds the spell damage button after save automation finishes.
export function findSpellDamageButton(root) {
  const button = root.querySelector(SELECTORS.spellDamageAction);
  return button instanceof HTMLButtonElement ? button : null;
}

// Finds the damage application action button matching a resolved rule.
export function findActionButton(application, action) {
  return (
    getHTMLElements(application, SELECTORS.actionButton).find((button) =>
      button instanceof HTMLButtonElement && matchesActionButton(button, action)
    ) ?? null
  );
}

// Finds the first target damage application inside a row/card.
export function findFirstDamageApplication(root) {
  return asHTMLElement(root.querySelector(SELECTORS.damageApplication));
}

// Centralizes Target Helper's target uuid extraction from application nodes.
export function getDamageApplicationTargetUuid(application) {
  return application?.dataset.targetUuid ?? null;
}

// Builds a stable row identity for duplicate-click protection.
export function getTargetRowIdentifier(row, fallback) {
  return (
    getDamageApplicationTargetUuid(findFirstDamageApplication(row)) ??
    row.dataset.targetUuid ??
    row.querySelector(".name")?.textContent?.trim() ??
    fallback
  );
}

function matchesActionButton(button, action) {
  if (action.type === "multiplier") {
    return button.dataset.action?.endsWith("applyDamage") && button.dataset.multiplier === String(action.multiplier);
  }

  const label = normalizeText(button.textContent);
  return (button.dataset.action?.endsWith("applyDamage") && button.dataset.multiplier === "0") || label === "block";
}

function normalizeText(value) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

function isHTMLElement(value) {
  return value instanceof HTMLElement;
}
