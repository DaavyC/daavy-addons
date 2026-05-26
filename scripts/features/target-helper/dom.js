import { DEGREE_OUTCOMES } from "../utils/target-helper-automation.js";
import { SELECTORS } from "./constants.js";

// Converts Foundry HTML wrappers to one element.
export function asHTMLElement(value) {
  if (value instanceof HTMLElement) return value;
  if (value?.[0] instanceof HTMLElement) return value[0];
  return null;
}

// Finds HTML elements that match a selector.
export function getHTMLElements(root, selector) {
  return Array.from(root.querySelectorAll(selector)).filter(isHTMLElement);
}

// Finds the rendered chat message root.
export function getMessageRoot(messageId) {
  return asHTMLElement(document.querySelector(getMessageRootSelector(messageId)));
}

// Builds a selector for a chat message.
export function getMessageRootSelector(messageId) {
  return `[data-message-id="${escapeCssAttributeValue(messageId)}"]`;
}

// Escapes a value for a CSS attribute selector.
export function escapeCssAttributeValue(value) {
  const stringValue = String(value);
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(stringValue);
  return stringValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Finds target rows in a chat card.
export function getTargetRows(root) {
  return getHTMLElements(root, SELECTORS.targetRows);
}

// Finds damage rows in a chat card.
export function getDamageRows(root) {
  return getHTMLElements(root, SELECTORS.damageRows);
}

// Checks if a chat message has save controls.
export function hasTargetSaveControls(messageId) {
  const messageRootSelector = getMessageRootSelector(messageId);
  return document.querySelector(`${messageRootSelector} ${SELECTORS.targetRows} ${SELECTORS.saveAction}`) !== null;
}

// Finds the save button in a row.
export function findSaveControl(row) {
  return asHTMLElement(row.querySelector(SELECTORS.saveAction));
}

// Reads the degree outcome from a row.
export function extractOutcome(row) {
  const degree = row.querySelector(".degree");
  const classes = degree?.classList ?? row.querySelector(".damage-application")?.classList ?? row.classList;
  if (!classes) return null;

  return DEGREE_OUTCOMES.find((outcome) => classes.contains(outcome)) ?? null;
}

// Finds a spell damage button in a chat card.
export function findSpellDamageButton(root) {
  const button = root.querySelector(SELECTORS.spellDamageAction);
  return button instanceof HTMLButtonElement ? button : null;
}

// Finds a matching damage action button.
export function findActionButton(application, action) {
  return (
    getHTMLElements(application, SELECTORS.actionButton).find((button) =>
      button instanceof HTMLButtonElement && matchesActionButton(button, action)
    ) ?? null
  );
}

// Finds the first damage application in an element.
export function findFirstDamageApplication(root) {
  return asHTMLElement(root.querySelector(SELECTORS.damageApplication));
}

// Checks if a button matches a damage action.
function matchesActionButton(button, action) {
  if (action.type === "multiplier") {
    return button.dataset.action?.endsWith("applyDamage") && button.dataset.multiplier === String(action.multiplier);
  }

  const label = normalizeText(button.textContent);
  return (button.dataset.action?.endsWith("applyDamage") && button.dataset.multiplier === "0") || label === "block";
}

// Normalizes text for simple comparisons.
function normalizeText(value) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

// Checks if a value is an HTML element.
function isHTMLElement(value) {
  return value instanceof HTMLElement;
}
