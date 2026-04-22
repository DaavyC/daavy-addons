const MODULE_ID = "daavy-addons";
export const TARGET_HELPER_AUTOMATIONS_SETTING = "targetHelperAutomations";

const SAVE_TYPES = new Set(["fortitude", "reflex", "will"]);
const DEGREE_OUTCOMES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const ATTACK_CONTEXT_TYPES = new Set(["attack-roll", "spell-attack", "spell-attack-roll"]);

const SELECTORS = {
  renderedMessage: "[data-message-id]",
  targetRows: ".pf2e-toolbelt-target-targetRows .target-row",
  damageRows: ".pf2e-toolbelt-target-targetRows.pf2e-toolbelt-target-damage .target-row",
  saveAction: '[data-action="roll-save"]',
  spellDamageAction: '.card-buttons [data-action="spell-damage"]',
  damageApplication: ".damage-application[data-target-uuid]",
  actionButton: "button[data-action]"
};

const LIMITS = {
  savePasses: 25,
  damagePasses: 50,
  spellDamageAttempts: 20,
  relatedDamageWindow: 8,
  attackLookupWindow: 10
};

const DELAYS = {
  queue: [0, 150],
  existingMessages: [500, 1500],
  saveHook: 100,
  spellDamageInitial: 250,
  spellDamageRetry: 250,
  spellDamageAfterClick: 500,
  clickPause: 150,
  spellDamageThrottle: 400
};

const ACTIONS_BY_MODE = {
  "basic-save": {
    criticalSuccess: { type: "block", id: "block" },
    success: { type: "multiplier", multiplier: 0.5, id: "0.5" },
    failure: { type: "multiplier", multiplier: 1, id: "1" },
    criticalFailure: { type: "multiplier", multiplier: 2, id: "2" }
  },
  "attack-roll": {
    criticalSuccess: { type: "multiplier", multiplier: 2, id: "2" },
    success: { type: "multiplier", multiplier: 1, id: "1" },
    failure: { type: "block", id: "block" },
    criticalFailure: { type: "block", id: "block" }
  }
};

const state = {
  hooksRegistered: false,
  handledDamageApplications: new Set(),
  handledSaveApplications: new Set(),
  handledSpellDamageRolls: new Set(),
  pendingSpellDamageRolls: new Map(),
  spellDamageFallbackAttempts: new Set()
};

export function registerTargetHelperAutomationsSetting() {
  game.settings.register(MODULE_ID, TARGET_HELPER_AUTOMATIONS_SETTING, {
    name: "DAAVY_ADDONS.Settings.TargetHelperAutomations.Name",
    hint: "DAAVY_ADDONS.Settings.TargetHelperAutomations.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

export function isTargetHelperAutomationsEnabled(moduleId = MODULE_ID) {
  return game.settings.get(moduleId, TARGET_HELPER_AUTOMATIONS_SETTING) === true;
}

export function initializeTargetHelperAutomations() {
  if (!isToolbeltActive() || state.hooksRegistered) return;

  state.hooksRegistered = true;

  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = asHTMLElement(html);
    if (root) queueMessageAutomation(message, root);
  });

  Hooks.on("createChatMessage", (message) => {
    if (message?.isDamageRoll) resolvePendingSpellDamage(message);
  });

  for (const hookName of ["pf2e-toolbelt.rollSave", "pf2e-toolbelt.rerollSave"]) {
    Hooks.on(hookName, ({ message }) => {
      if (message) scheduleSpellDamageCheck(message.id, DELAYS.saveHook);
    });
  }

  for (const delay of DELAYS.existingMessages) {
    schedule(processExistingChatMessages, delay);
  }
}

function asHTMLElement(value) {
  if (value instanceof HTMLElement) return value;
  if (value?.[0] instanceof HTMLElement) return value[0];
  return null;
}

function isToolbeltActive() {
  return game.modules.get("pf2e-toolbelt")?.active === true;
}

function canUseTargetHelperAutomations() {
  return (
    game.user === game.users.activeGM &&
    isTargetHelperAutomationsEnabled(MODULE_ID) &&
    isToolbeltActive() &&
    game.toolbelt?.getToolSetting?.("targetHelper", "enabled") === true
  );
}

function schedule(callback, delay = 0) {
  window.setTimeout(() => {
    void callback();
  }, delay);
}

function scheduleMany(callback, delays) {
  for (const delay of delays) {
    schedule(callback, delay);
  }
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function processExistingChatMessages() {
  if (!canUseTargetHelperAutomations()) return;

  for (const root of getRenderedMessageRoots()) {
    const messageId = root.dataset.messageId;
    if (!messageId) continue;

    const message = game.messages.get(messageId);
    if (message) queueMessageAutomation(message, root);
  }
}

function getRenderedMessageRoots() {
  return Array.from(document.querySelectorAll(SELECTORS.renderedMessage)).filter(
    (element) => element instanceof HTMLElement
  );
}

function queueMessageAutomation(message, root) {
  if (!canUseTargetHelperAutomations()) return;

  scheduleMany(() => autoRollSaves(message, root), DELAYS.queue);
  scheduleMany(() => autoApplyDamage(message, root), DELAYS.queue);

  if (resolveDamageMode(message) === "basic-save") {
    scheduleSpellDamageCheck(message.id, DELAYS.spellDamageInitial);
  }
}

async function autoRollSaves(message, root) {
  if (!isSpellSaveMessage(message)) return;

  let currentRoot = root;
  let clickedSave = false;

  for (let pass = 0; pass < LIMITS.savePasses; pass += 1) {
    currentRoot = getMessageRoot(message.id) ?? currentRoot;
    if (!(currentRoot instanceof HTMLElement)) break;

    const pendingSave = findPendingSave(message, currentRoot);
    if (!pendingSave) break;

    state.handledSaveApplications.add(pendingSave.key);
    pendingSave.control.click();
    clickedSave = true;
    await wait(DELAYS.clickPause);
  }

  if (clickedSave || resolveDamageMode(message) === "basic-save") {
    scheduleSpellDamageCheck(message.id, clickedSave ? DELAYS.spellDamageInitial : 0);
  }
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

async function autoApplyDamage(message, root) {
  if (!message?.isDamageRoll) return;

  const mode = resolveDamageMode(message);
  if (!mode) return;

  let currentRoot = root;

  for (let pass = 0; pass < LIMITS.damagePasses; pass += 1) {
    currentRoot = getMessageRoot(message.id) ?? currentRoot;
    if (!(currentRoot instanceof HTMLElement)) break;

    const applied = await applyNextDamage(message, currentRoot, mode);
    if (!applied) break;
  }
}

async function applyNextDamage(message, root, mode) {
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
    await wait(DELAYS.clickPause);
    return true;
  }

  return false;
}

function getRowOutcome(message, row, mode) {
  const outcome = extractOutcome(row);
  if (outcome) return outcome;
  if (mode === "attack-roll") return findAttackOutcome(message, row);
  return null;
}

function findPendingDamageApplication(message, row, outcome, action) {
  const applications = Array.from(row.querySelectorAll(SELECTORS.damageApplication));

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

function scheduleSpellDamageCheck(messageId, delay, attempt = 0) {
  if (state.handledSpellDamageRolls.has(messageId)) return;
  schedule(() => autoRollSpellDamage(messageId, attempt), delay);
}

function autoRollSpellDamage(messageId, attempt = 0) {
  if (!canUseTargetHelperAutomations() || state.handledSpellDamageRolls.has(messageId)) return;

  const message = game.messages.get(messageId);
  if (!message || resolveDamageMode(message) !== "basic-save") return;

  if (hasRelatedDamageMessage(message)) {
    markSpellDamageHandled(message.id);
    return;
  }

  const root = getMessageRoot(messageId);
  if (!(root instanceof HTMLElement)) {
    maybeFallbackToDirectSpellDamage(message);
    retrySpellDamage(messageId, attempt);
    return;
  }

  const rows = getTargetRows(root);
  if (rows.length === 0) {
    maybeFallbackToDirectSpellDamage(message);
    retrySpellDamage(messageId, attempt);
    return;
  }

  if (rows.some((row) => !!findSaveControl(row))) {
    retrySpellDamage(messageId, attempt);
    return;
  }

  const button = findSpellDamageButton(root);
  if (!button || button.disabled) {
    retrySpellDamage(messageId, attempt);
    return;
  }

  if (isSpellDamageThrottled(messageId)) {
    retrySpellDamage(messageId, attempt);
    return;
  }

  state.pendingSpellDamageRolls.set(messageId, Date.now());
  button.click();
  retrySpellDamage(messageId, attempt, DELAYS.spellDamageAfterClick);
}

function findSpellDamageButton(root) {
  const button = root.querySelector(SELECTORS.spellDamageAction);
  return button instanceof HTMLButtonElement ? button : null;
}

function isSpellDamageThrottled(messageId) {
  const lastAttempt = state.pendingSpellDamageRolls.get(messageId) ?? 0;
  return Date.now() - lastAttempt < DELAYS.spellDamageThrottle;
}

function retrySpellDamage(messageId, attempt, delay = DELAYS.spellDamageRetry) {
  if (attempt >= LIMITS.spellDamageAttempts) return;
  scheduleSpellDamageCheck(messageId, delay, attempt + 1);
}

function maybeFallbackToDirectSpellDamage(message) {
  if (!message) return;
  if (!state.pendingSpellDamageRolls.has(message.id)) return;
  if (state.spellDamageFallbackAttempts.has(message.id)) return;
  if (hasRelatedDamageMessage(message)) return;

  const spell = getSpellLikeItem(message) ?? message.item;
  if (typeof spell?.rollDamage !== "function") return;

  state.spellDamageFallbackAttempts.add(message.id);
  void Promise.resolve(spell.rollDamage(new MouseEvent("click"))).catch(() => {});
}

function resolvePendingSpellDamage(damageMessage) {
  for (const messageId of state.pendingSpellDamageRolls.keys()) {
    const pendingMessage = game.messages.get(messageId);
    if (!isRelatedDamageMessage(pendingMessage, damageMessage)) continue;

    markSpellDamageHandled(messageId);
    return;
  }
}

function markSpellDamageHandled(messageId) {
  state.handledSpellDamageRolls.add(messageId);
  state.pendingSpellDamageRolls.delete(messageId);
  state.spellDamageFallbackAttempts.delete(messageId);
}

function isSpellSaveMessage(message) {
  if (!getSpellLikeItem(message)) return false;
  return hasTargetSaveControls(message.id) || hasSpellSave(message);
}

function hasSpellSave(message) {
  return isSaveType(getSpellSaveType(message));
}

function isSaveType(value) {
  return SAVE_TYPES.has(value ?? "");
}

function resolveDamageMode(message) {
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

function getSpellSaveType(message) {
  const spell = getSpellLikeItem(message);
  const save = spell?.system?.defense?.save;
  return save?.statistic ?? spell?.system?.save?.value ?? null;
}

function getSpellLikeItem(message) {
  const item = message?.item;
  if (!item) return null;
  if (item.isOfType?.("spell")) return item;
  if (item.isOfType?.("consumable") && item.embeddedSpell) return item.embeddedSpell;
  return null;
}

function getMessageRoot(messageId) {
  return asHTMLElement(document.querySelector(`[data-message-id="${messageId}"]`));
}

function getTargetRows(root) {
  return Array.from(root.querySelectorAll(SELECTORS.targetRows));
}

function getDamageRows(root) {
  return Array.from(root.querySelectorAll(SELECTORS.damageRows));
}

function hasTargetSaveControls(messageId) {
  return document.querySelector(
    `[data-message-id="${messageId}"] ${SELECTORS.targetRows} ${SELECTORS.saveAction}`
  ) !== null;
}

function findSaveControl(row) {
  return asHTMLElement(row.querySelector(SELECTORS.saveAction));
}

function extractOutcome(row) {
  const degree = row.querySelector(".degree");
  const classes = degree?.classList ?? row.querySelector(".damage-application")?.classList ?? row.classList;
  if (!classes) return null;

  return DEGREE_OUTCOMES.find((outcome) => classes.contains(outcome)) ?? null;
}

function hasRelatedDamageMessage(spellMessage) {
  const messages = game.messages.contents;
  const currentIndex = messages.findIndex((candidate) => candidate.id === spellMessage.id);
  if (currentIndex < 0) return false;

  const nextMessages = messages.slice(currentIndex + 1, currentIndex + 1 + LIMITS.relatedDamageWindow);
  return nextMessages.some((candidate) => isRelatedDamageMessage(spellMessage, candidate));
}

function isRelatedDamageMessage(spellMessage, damageMessage) {
  if (!spellMessage || !damageMessage?.isDamageRoll) return false;
  if ((damageMessage.timestamp ?? 0) < (spellMessage.timestamp ?? 0)) return false;

  return sameActor(spellMessage, damageMessage) && sameItem(spellMessage.item, damageMessage.item);
}

function findAttackOutcome(message, row) {
  const targetUuid = row.querySelector(SELECTORS.damageApplication)?.dataset.targetUuid;
  const messages = game.messages.contents;
  const currentIndex = messages.findIndex((candidate) => candidate.id === message.id);
  if (currentIndex < 1) return null;

  const lowestIndex = Math.max(0, currentIndex - LIMITS.attackLookupWindow);
  for (let index = currentIndex - 1; index >= lowestIndex; index -= 1) {
    const candidate = messages[index];
    if (!isMatchingAttackMessage(message, candidate, targetUuid)) continue;

    const outcome = candidate.flags?.pf2e?.context?.outcome;
    if (DEGREE_OUTCOMES.includes(outcome)) return outcome;
  }

  return null;
}

function hasMatchingAttackMessage(message) {
  const messages = game.messages.contents;
  const currentIndex = messages.findIndex((candidate) => candidate.id === message.id);
  if (currentIndex < 1) return false;

  const lowestIndex = Math.max(0, currentIndex - LIMITS.attackLookupWindow);
  for (let index = currentIndex - 1; index >= lowestIndex; index -= 1) {
    if (isMatchingAttackMessage(message, messages[index])) return true;
  }

  return false;
}

function isMatchingAttackMessage(damageMessage, candidate, targetUuid) {
  if (!candidate?.isCheckRoll) return false;
  if (!isAttackContextType(candidate.flags?.pf2e?.context?.type)) return false;
  if (!sameActor(damageMessage, candidate)) return false;
  if (!sameItem(damageMessage.item, candidate.item)) return false;

  if (!targetUuid) return true;
  const candidateTargetUuid = candidate.target?.token?.uuid ?? candidate.target?.uuid ?? null;
  return !candidateTargetUuid || candidateTargetUuid === targetUuid;
}

function isAttackContextType(value) {
  return ATTACK_CONTEXT_TYPES.has(value ?? "");
}

function sameActor(leftMessage, rightMessage) {
  const leftActorUuid = leftMessage.actor?.uuid ?? leftMessage.speaker?.actor ?? null;
  const rightActorUuid = rightMessage.actor?.uuid ?? rightMessage.speaker?.actor ?? null;
  return leftActorUuid && rightActorUuid && leftActorUuid === rightActorUuid;
}

function sameItem(leftItem, rightItem) {
  if (!leftItem || !rightItem) return false;

  return (
    leftItem.uuid === rightItem.uuid ||
    (leftItem.sourceId && leftItem.sourceId === rightItem.sourceId) ||
    (leftItem.slug && leftItem.slug === rightItem.slug) ||
    leftItem.name === rightItem.name
  );
}

function resolveAction(mode, outcome) {
  return ACTIONS_BY_MODE[mode]?.[outcome] ?? null;
}

function createHandledKey(message, application, outcome, action) {
  const targetUuid = application.dataset.targetUuid ?? "unknown-target";
  const rollIndex = application.dataset.targetRollIndex ?? "0";
  return `${message.id}:${targetUuid}:${rollIndex}:${outcome}:${action.id}`;
}

function createSaveHandledKey(message, row, rowIndex) {
  const targetUuid =
    row.querySelector(SELECTORS.damageApplication)?.dataset.targetUuid ??
    row.dataset.targetUuid ??
    row.querySelector(".name")?.textContent?.trim() ??
    `row-${rowIndex}`;

  return `${message.id}:${rowIndex}:${targetUuid}:roll-save`;
}

function findActionButton(application, action) {
  const buttons = Array.from(application.querySelectorAll(SELECTORS.actionButton));
  return buttons.find((button) => matchesActionButton(button, action)) ?? null;
}

function matchesActionButton(button, action) {
  if (action.type === "multiplier") {
    return (
      button.dataset.action?.endsWith("applyDamage") &&
      button.dataset.multiplier === String(action.multiplier)
    );
  }

  const label = normalizeText(button.textContent);
  return (
    (button.dataset.action?.endsWith("applyDamage") && button.dataset.multiplier === "0") ||
    label === "block"
  );
}

function normalizeText(value) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}
