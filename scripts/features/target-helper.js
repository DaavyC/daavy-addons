import {
  MODULE_ID,
  SETTINGS,
  TARGET_HELPER_DAMAGE_RESULT_FLAG,
  TARGET_HELPER_DAMAGE_UNDO_REQUEST,
  TARGET_HELPER_FLAG,
  TARGET_HELPER_SAVE_OUTCOMES,
  TARGET_HELPER_SAVE_RESULT_FLAG,
  TARGET_HELPER_SAVE_TYPES,
  TARGET_HELPER_SOCKET
} from "../constants.js";
import { asHTMLElement } from "../dom.js";
import { getSetting } from "../settings.js";

const LONG_PRESS_DELAY = 500;
const SINGLE_CLICK_DELAY = 250;
const DAMAGE_UPDATE_PATHS = new Set([
  "system.attributes.hp.temp",
  "system.attributes.hp.sp.value",
  "system.attributes.hp.value"
]);
const DAMAGE_ACTIONS = [
  { key: "Damage", icon: '<i class="fa-solid fa-heart-crack fa-fw" inert></i>', multiplier: 1 },
  { key: "Half", icon: '<i class="fa-solid fa-heart-crack fa-fw" inert></i>', multiplier: 0.5 },
  { key: "Double", icon: '<img src="systems/pf2e/icons/damage/double.svg" alt="">', multiplier: 2 },
  { key: "Block", icon: '<i class="fa-solid fa-shield-blank fa-fw" inert></i>', multiplier: 0 }
];
const BASIC_SAVE_MULTIPLIERS = {
  criticalFailure: 2,
  failure: 1,
  success: 0.5,
  criticalSuccess: 0
};
const automationLocks = new Set();
let automationQueue = Promise.resolve();
let pendingDamageAutomation = null;

export function registerTargetHelperHooks() {
  Hooks.on("preCreateChatMessage", captureTargets);
  Hooks.on("createChatMessage", handleCreatedMessage);
  Hooks.on("updateChatMessage", refreshLinkedDamageHelpers);
  Hooks.on("deleteChatMessage", handleDeletedMessage);
  Hooks.on("renderChatMessageHTML", renderTargetHelper);
  Hooks.on("updateUser", (_user, changes) => {
    if (Object.hasOwn(changes, "active")) resumeTargetHelperAutomations();
  });
  Hooks.once("ready", () => {
    game.socket.on(TARGET_HELPER_SOCKET, handleTargetHelperSocket);
    resumeTargetHelperAutomations();
  });
}

function captureTargets(message, _data, _options, userId) {
  if (userId !== game.user.id || !canUseTargetHelper()) return;
  if (message.flags?.pf2e?.context?.type === "damage-taken") return;

  if (isSupportedDamageRoll(message)) {
    const pending = pendingDamageAutomation;
    const targets = pending?.targets
      ?? Array.from(game.user.targets, (token) => token.document?.uuid).filter(Boolean);
    const saveMessage = pending?.type === "basic-save"
      ? game.messages.get(pending.sourceMessageId)
      : findBasicSaveMessage(message);
    if (pending) pending.damageMessage = message;
    const sourceMessage = game.messages.get(pending?.sourceMessageId);
    const rolls = pending?.rollMultiplier === 2
      ? message.rolls.map((roll, index) => (index === 0 ? roll.alter(2, 0) : roll).toJSON())
      : null;
    message.updateSource({
      ...(rolls ? { rolls } : {}),
      ...(sourceMessage ? {
        whisper: [...sourceMessage.whisper],
        blind: sourceMessage.blind
      } : {}),
      [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}`]: {
        targets,
        damageResults: [],
        ...(saveMessage ? { saveMessageId: saveMessage.id } : {}),
        ...(pending ? {
          automation: {
            type: pending.type,
            sourceMessageId: pending.sourceMessageId,
            status: "pending"
          }
        } : {})
      }
    });
    return;
  }

  const attackTarget = getAutomatedAttackTarget(message);
  if (attackTarget && canUseTargetHelperAutomations()) {
    message.updateSource({
      [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}`]: {
        targets: [attackTarget.uuid],
        automation: { type: "attack", status: "pending" }
      }
    });
    return;
  }

  const targets = Array.from(game.user.targets, (token) => token.document?.uuid).filter(Boolean);
  const save = getStructuredSave(message);
  if (!save) return;

  message.updateSource({
    [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}`]: {
      targets,
      save,
      saveResults: [],
      ...(canUseTargetHelperAutomations() && isBasicSave(save)
        ? { automation: { type: "basic-save", status: "pending" } }
        : {})
    }
  });
}

function handleCreatedMessage(message) {
  void refreshRelatedMessages(message);
  queueTargetHelperAutomation(message);
}

function handleDeletedMessage(message) {
  void refreshRelatedMessages(message);
  const link = message.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG);
  if (link) queueAutomation(() => reconcileAutomatedSaveDamage(link));
}

function queueTargetHelperAutomation(message) {
  if (
    message.getFlag(MODULE_ID, TARGET_HELPER_DAMAGE_RESULT_FLAG)
    || message.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG)
  ) {
    return;
  }
  const automation = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.automation;
  if (!automation || !canUseTargetHelperAutomations()) return;

  if (!game.users.activeGM) {
    if (message.isAuthor && automation.status === "pending") {
      void updateAutomationState(message, { status: "manual" });
      ui.notifications.error("DAAVY_ADDONS.TargetHelper.NoActiveGM", { localize: true });
    }
    return;
  }
  if (game.user.isActiveGM) queueAutomation(() => runTargetHelperAutomation(message));
}

function queueAutomation(task) {
  automationQueue = automationQueue.then(task, task).catch((error) => {
    console.error(`${MODULE_ID} | Failed Target Helper automation`, error);
  });
}

function resumeTargetHelperAutomations() {
  if (!game?.user?.isActiveGM || !canUseTargetHelperAutomations()) return;
  for (const message of game.messages.contents) {
    const status = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.automation?.status;
    if (["pending", "rolling-saves", "rolling-damage", "applying"].includes(status)) {
      queueTargetHelperAutomation(message);
    }
  }
}

async function runTargetHelperAutomation(message) {
  const data = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
  const automation = data?.automation;
  if (
    !game.user.isActiveGM
    || !automation
    || ["complete", "failed", "manual"].includes(automation.status)
    || automationLocks.has(message.id)
  ) {
    return;
  }

  automationLocks.add(message.id);
  try {
    if (isSupportedDamageRoll(message)) {
      await applyAutomatedDamage(message, data);
    } else if (automation.type === "attack") {
      await automateAttack(message, data);
    } else if (automation.type === "basic-save") {
      await automateBasicSave(message, data);
    }
  } catch (error) {
    await updateAutomationState(message, { status: "failed" });
    console.error(`${MODULE_ID} | Failed Target Helper automation`, error);
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.AutomationError", { localize: true });
  } finally {
    automationLocks.delete(message.id);
  }
}

async function automateAttack(message, data) {
  const target = resolveTarget(data.targets?.at(0));
  if (!target?.actor || !target.object || !getAutomatedAttackTarget(message)) {
    await updateAutomationState(message, { status: "manual" });
    return;
  }

  const existing = findAutomatedDamageMessage(message.id);
  if (existing) {
    await updateAutomationState(message, {
      status: "rolling-damage",
      damageMessageId: existing.id
    });
    await applyAutomatedDamage(existing, existing.getFlag(MODULE_ID, TARGET_HELPER_FLAG));
    return;
  }
  if (data.automation.status === "rolling-damage") {
    await updateAutomationState(message, { status: "manual" });
    return;
  }

  await updateAutomationState(message, { status: "rolling-damage" });
  const damageMessage = await rollAutomatedDamage(message, [target], "attack");
  await updateAutomationState(message, damageMessage
    ? { status: "rolling-damage", damageMessageId: damageMessage.id }
    : { status: "manual" });
}

async function automateBasicSave(message, data) {
  const targets = data.targets?.map(resolveTarget).filter((token) => token?.actor) ?? [];
  if (!targets.length || !isValidSave(data.save)) {
    await updateAutomationState(message, { status: "manual" });
    return;
  }

  const existing = findAutomatedDamageMessage(message.id);
  if (existing) {
    await updateAutomationState(message, {
      status: "rolling-damage",
      damageMessageId: existing.id
    });
    await applyAutomatedDamage(existing, existing.getFlag(MODULE_ID, TARGET_HELPER_FLAG));
    return;
  }
  if (data.automation.status === "rolling-damage") {
    await updateAutomationState(message, { status: "manual" });
    return;
  }

  await updateAutomationState(message, { status: "rolling-saves" });
  for (const target of targets) {
    const current = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
    if (resolveSaveResultMessage(message, target, current)) continue;
    if (!await rollSave(message, target, current.save, null, true)) {
      await updateAutomationState(message, { status: "failed" });
      ui.notifications.error("DAAVY_ADDONS.TargetHelper.AutomationError", { localize: true });
      return;
    }
  }

  await updateAutomationState(message, { status: "rolling-damage" });
  const damageMessage = await rollAutomatedDamage(message, targets, "basic-save");
  await updateAutomationState(message, damageMessage
    ? { status: "rolling-damage", damageMessageId: damageMessage.id }
    : { status: "manual" });
}

async function rollAutomatedDamage(sourceMessage, targets, type) {
  const target = targets.at(0);
  const event = {
    target: null,
    ctrlKey: false,
    metaKey: false,
    shiftKey: game.user.settings.showDamageDialogs,
    preventDefault() {}
  };
  const context = sourceMessage.flags?.pf2e?.context;
  const roll = sourceMessage.rolls.at(0);
  const pending = {
    type,
    sourceMessageId: sourceMessage.id,
    targets: targets.map((token) => token.uuid),
    rollMultiplier: 1,
    damageMessage: null
  };

  pendingDamageAutomation = pending;
  try {
    await withTemporaryTargets(targets, async () => {
      if (type === "attack" && roll?.options?.action === "elemental-blast") {
        const [element, damageType, meleeOrRanged, actionCost] = roll.options.identifier?.split(".") ?? [];
        await new game.pf2e.ElementalBlast(sourceMessage.actor).damage({
          element,
          damageType,
          melee: meleeOrRanged === "melee",
          actionCost: Number(actionCost) || 1,
          checkContext: context,
          outcome: context.outcome,
          event
        });
        return;
      }

      const attack = sourceMessage._attack;
      if (type === "attack" && attack) {
        const method = context.outcome === "criticalSuccess" ? "critical" : "damage";
        await attack[method]?.({
          event,
          checkContext: context,
          mapIncreases: context.mapIncreases,
          target: target.object
        });
        return;
      }

      const spell = getSpellLikeItem(sourceMessage);
      if (spell) {
        pending.rollMultiplier = type === "attack" && context.outcome === "criticalSuccess" ? 2 : 1;
        await spell.rollDamage(event, context?.mapIncreases);
        return;
      }

      if (type === "basic-save" && attack?.damage) {
        await attack.damage({ event, target: target.object });
      }
    });
  } finally {
    pendingDamageAutomation = null;
  }

  const damageMessage = pending.damageMessage?.id
    ? game.messages.get(pending.damageMessage.id)
    : findAutomatedDamageMessage(sourceMessage.id);
  return damageMessage ?? null;
}

async function withTemporaryTargets(targets, callback) {
  const previous = [...game.user.targets];
  game.user.targets.clear();
  for (const token of targets) {
    if (token.object) game.user.targets.add(token.object);
  }
  try {
    return await callback();
  } finally {
    game.user.targets.clear();
    for (const token of previous) game.user.targets.add(token);
  }
}

async function applyAutomatedDamage(message, data) {
  const automation = data?.automation;
  const sourceMessage = game.messages.get(automation?.sourceMessageId);
  if (!sourceMessage) {
    await updateAutomationState(message, { status: "failed" });
    return;
  }

  await updateAutomationState(message, { status: "applying" });
  let complete = true;
  for (const uuid of data.targets ?? []) {
    const target = resolveTarget(uuid);
    if (!target?.actor) {
      complete = false;
      continue;
    }
    if (hasDamageResult(message, target)) continue;

    const multiplier = automation.type === "attack"
      ? 1
      : getRecommendedDamageMultiplier(message, target, data);
    if (multiplier === null || !await applyDamage(message, target, multiplier)) complete = false;
  }

  const status = complete ? "complete" : "failed";
  await updateAutomationState(message, { status });
  await updateAutomationState(sourceMessage, {
    status,
    damageMessageId: message.id
  });
  if (!complete) {
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.AutomationError", { localize: true });
  }
}

function hasDamageResult(message, target) {
  if (target.actor.isOfType("npc")) {
    return !!findDamageResultMessage(message.id, target.uuid);
  }
  const result = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.damageResults
    ?.find((entry) => entry?.targetUuid === target.uuid);
  return !!game.messages.get(result?.resultMessageId);
}

function findAutomatedDamageMessage(sourceMessageId) {
  return game.messages.contents.findLast((message) => (
    isSupportedDamageRoll(message)
    && message.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.automation?.sourceMessageId === sourceMessageId
  )) ?? null;
}

async function updateAutomationState(message, changes) {
  const data = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG) ?? {};
  await message.update({
    [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.automation`]: {
      ...data.automation,
      ...changes
    }
  });
}

async function reconcileAutomatedSaveDamage(link) {
  if (!game.user.isActiveGM || !canUseTargetHelperAutomations()) return;

  const sourceMessage = game.messages.get(link.parentMessageId);
  const sourceData = sourceMessage?.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
  const damageMessage = game.messages.get(sourceData?.automation?.damageMessageId)
    ?? findAutomatedDamageMessage(sourceMessage?.id);
  const target = resolveTarget(link.targetUuid);
  if (
    sourceData?.automation?.type !== "basic-save"
    || !damageMessage
    || !target?.actor
  ) {
    return;
  }

  const resultMessage = resolveSaveResultMessage(sourceMessage, target, sourceData);
  const outcome = resultMessage?.visible
    ? resultMessage.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG)?.outcome
    : null;
  const multiplier = BASIC_SAVE_MULTIPLIERS[outcome];
  if (multiplier === undefined) return;

  const currentResult = target.actor.isOfType("npc")
    ? findDamageResultMessage(damageMessage.id, target.uuid)
    : game.messages.get(
      damageMessage.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.damageResults
        ?.find((entry) => entry?.targetUuid === target.uuid)?.resultMessageId
    );
  const currentMultiplier = currentResult
    ?.getFlag(MODULE_ID, TARGET_HELPER_DAMAGE_RESULT_FLAG)?.multiplier;
  if (currentMultiplier === multiplier) return;

  if (currentResult) await finalizeDamageUndo(damageMessage, target, currentResult);
  const applied = await applyDamage(damageMessage, target, multiplier);
  const status = applied ? "complete" : "failed";
  await updateAutomationState(damageMessage, { status });
  await updateAutomationState(sourceMessage, { status });
  if (!applied) {
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.AutomationError", { localize: true });
  }
}

function renderTargetHelper(message, html) {
  const root = asHTMLElement(html);
  if (!root) return;

  if (
    message.getFlag(MODULE_ID, TARGET_HELPER_DAMAGE_RESULT_FLAG)
    || message.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG)
  ) {
    root.classList.add("daavy-addons-target-helper-storage");
    return;
  }
  if (!canUseTargetHelper()) return;

  const data = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
  if (isSupportedDamageRoll(message)) {
    renderDamageHelper(message, root, data);
  } else if (isValidSave(data?.save)) {
    renderSaveHelper(message, root, data);
  }
}

function renderDamageHelper(message, root, data) {
  const content = root.querySelector(".message-content");
  const uuids = data?.targets;
  content?.querySelectorAll(".damage-application").forEach((element) => element.remove());
  if (!content || !Array.isArray(uuids) || !uuids.length || content.querySelector(".daavy-addons-target-helper")) {
    return;
  }

  const targets = resolveVisibleTargets(uuids)
    .filter((token) => game.user.isGM || !token.actor?.isOfType("npc"));
  if (!targets.length) return;

  const card = document.createElement("section");
  card.className = "daavy-addons-target-helper";
  card.append(document.createElement("hr"));
  for (const target of targets) card.append(createDamageRow(message, target, data));
  content.append(card);
}

function renderSaveHelper(message, root, data) {
  const content = root.querySelector(".message-content");
  if (!content) return;

  removeNativeSaveControl(content, data.save);
  if (!Array.isArray(data.targets) || !data.targets.length || content.querySelector(".daavy-addons-target-helper")) {
    return;
  }

  const targets = resolveVisibleTargets(data.targets);
  if (!targets.length) return;

  const card = document.createElement("section");
  card.className = "daavy-addons-target-helper";
  card.append(document.createElement("hr"));
  for (const target of targets) card.append(createSaveRow(message, target, data));
  content.append(card);
}

function resolveVisibleTargets(uuids) {
  return uuids
    .map(resolveTarget)
    .filter((token) => (
      token?.documentName === "Token"
      && (game.user.isGM || !(token.hidden || token.actor?.hasCondition("unnoticed", "undetected")))
    ));
}

function createDamageRow(message, token, data) {
  const row = createTargetRow(token);
  const recommendedMultiplier = getRecommendedDamageMultiplier(message, token, data);
  const privateResult = game.user.isGM && token.actor?.isOfType("npc")
    ? findDamageResultMessage(message.id, token.uuid)
    : null;
  const result = privateResult
    ? { targetUuid: token.uuid, resultMessageId: privateResult.id }
    : token.actor?.isOfType("npc")
      ? null
      : data?.damageResults?.find((entry) => entry?.targetUuid === token.uuid);
  if (result) {
    row.append(createDamageResult(message, token, result));
    return row;
  }

  const actions = document.createElement("div");
  const canApply = game.user.isGM || token.isOwner;

  actions.className = "daavy-addons-target-helper-actions";
  for (const action of DAMAGE_ACTIONS) {
    const button = document.createElement("button");
    const label = game.i18n.localize(`DAAVY_ADDONS.TargetHelper.Actions.${action.key}`);

    button.type = "button";
    button.className = `daavy-addons-target-helper-action ${action.key.toLowerCase()}`;
    button.classList.toggle("recommended", action.multiplier === recommendedMultiplier);
    button.innerHTML = action.icon;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.disabled = !canApply;
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      for (const actionButton of actions.querySelectorAll("button")) actionButton.disabled = true;
      actions.classList.add("pending");
      const submitted = await applyDamage(message, token, action.multiplier);
      if (!submitted && actions.isConnected) {
        for (const actionButton of actions.querySelectorAll("button")) actionButton.disabled = !canApply;
        actions.classList.remove("pending");
      }
    });
    actions.append(button);
  }

  row.append(actions);
  return row;
}

function findDamageResultMessage(parentMessageId, targetUuid, excludedMessageId = null) {
  return game.messages.contents.find((message) => {
    if (message.id === excludedMessageId) return false;
    const link = message.getFlag(MODULE_ID, TARGET_HELPER_DAMAGE_RESULT_FLAG);
    return (
      link?.parentMessageId === parentMessageId
      && link?.targetUuid === targetUuid
      && message.flags?.pf2e?.appliedDamage?.isReverted !== true
    );
  }) ?? null;
}

async function refreshResultParent(message) {
  const link = message.getFlag(MODULE_ID, TARGET_HELPER_DAMAGE_RESULT_FLAG)
    ?? message.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG);
  const parent = game.messages.get(link?.parentMessageId);
  if (parent && document.querySelector(`li.chat-message[data-message-id="${parent.id}"]`)) {
    await ui.chat.updateMessage(parent);
  }
}

async function refreshLinkedDamageHelpers(message) {
  const saveLink = message.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG);
  const sourceMessageId = saveLink?.parentMessageId
    ?? (isValidSave(message.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.save) ? message.id : null);
  if (!sourceMessageId) return;

  const messages = game.messages.contents.filter((candidate) => (
    candidate.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.saveMessageId === sourceMessageId
    && document.querySelector(`li.chat-message[data-message-id="${candidate.id}"]`)
  ));
  await Promise.all(messages.map((candidate) => ui.chat.updateMessage(candidate)));
}

async function refreshRelatedMessages(message) {
  await Promise.all([
    refreshResultParent(message),
    refreshLinkedDamageHelpers(message)
  ]);
}

function findBasicSaveMessage(damageMessage) {
  if (damageMessage.flags?.pf2e?.context?.sourceType !== "save") return null;

  const itemUuid = damageMessage.item?.uuid;
  const originUuid = damageMessage.actor?.uuid;
  if (!itemUuid || !originUuid) return null;

  return game.messages.contents.findLast((message) => {
    const save = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.save;
    return (
      isValidSave(save)
      && isBasicSave(save)
      && save.itemUuid === itemUuid
      && save.originUuid === originUuid
    );
  }) ?? null;
}

function getRecommendedDamageMultiplier(message, token, data) {
  if (message.flags?.pf2e?.context?.sourceType === "attack") return 1;

  const saveMessage = game.messages.get(data?.saveMessageId);
  const saveData = saveMessage?.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
  if (
    !isValidSave(saveData?.save)
    || !isBasicSave(saveData.save)
    || !saveData.targets?.includes(token.uuid)
  ) {
    return null;
  }

  const resultMessage = resolveSaveResultMessage(saveMessage, token, saveData);
  const outcome = resultMessage?.visible
    ? resultMessage.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG)?.outcome
    : null;
  return BASIC_SAVE_MULTIPLIERS[outcome] ?? null;
}

function createDamageResult(message, token, result) {
  const container = document.createElement("div");
  const amount = document.createElement("span");
  const button = document.createElement("button");
  const resultMessage = game.messages.get(result.resultMessageId);
  const resultData = resultMessage?.visible
    ? resultMessage.getFlag(MODULE_ID, TARGET_HELPER_DAMAGE_RESULT_FLAG)
    : null;
  const canUndo = (
    !!resultData
    && resultMessage?.flags?.pf2e?.appliedDamage?.isReverted !== true
    && (game.user.isGM || token.isOwner)
  );

  container.className = "daavy-addons-target-helper-damage-result";
  amount.className = "daavy-addons-target-helper-damage-amount";
  amount.textContent = Number.isFinite(resultData?.amount)
    ? resultData.amount
    : game.i18n.localize("DAAVY_ADDONS.TargetHelper.HiddenResult");

  button.type = "button";
  button.className = "daavy-addons-target-helper-undo";
  button.innerHTML = '<i class="fa-solid fa-rotate-left fa-fw" inert></i>';
  button.title = game.i18n.localize("DAAVY_ADDONS.TargetHelper.UndoDamage");
  button.setAttribute("aria-label", button.title);
  button.disabled = !canUndo;
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    button.disabled = true;
    button.classList.add("pending");
    const submitted = await undoDamage(message, token, result);
    if (!submitted && button.isConnected) {
      button.disabled = !canUndo;
      button.classList.remove("pending");
    }
  });

  const iwrInfo = createIwrInfo(resultMessage);
  container.append(...[iwrInfo, amount, button].filter(Boolean));
  return container;
}

function createIwrInfo(resultMessage) {
  if (!resultMessage?.visible) return null;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = resultMessage.content ?? "";
  const source = wrapper.querySelector(".damage-taken .iwr");
  if (!source || (source.dataset.visibility === "gm" && !game.user.isGM)) return null;

  let applications;
  try {
    applications = JSON.parse(source.dataset.applications ?? "null");
  } catch {
    return null;
  }
  if (!Array.isArray(applications) || !applications.every((application) => (
    application
    && typeof application.category === "string"
    && typeof application.type === "string"
    && Number.isFinite(application.adjustment)
  ))) {
    return null;
  }

  const info = source.cloneNode(true);
  void foundry.applications.handlebars
    .renderTemplate("systems/pf2e/templates/chat/damage/iwr-breakdown.hbs", { applications })
    .then((html) => {
      info.dataset.tooltipClass = "pf2e";
      info.dataset.tooltipHtml = html;
    })
    .catch((error) => {
      console.error(`${MODULE_ID} | Failed to render Target Helper IWR tooltip`, error);
    });
  return info;
}

function createSaveRow(message, token, data) {
  const row = createTargetRow(token);
  const result = data.saveResults?.find((entry) => entry?.targetUuid === token.uuid);
  const resultMessage = resolveSaveResultMessage(message, token, data);
  if (result || resultMessage) {
    row.append(createSaveResult(message, token, resultMessage));
    return row;
  }

  const button = document.createElement("button");
  const canRoll = (game.user.isGM || token.isOwner) && !!token.actor?.getStatistic(data.save.statistic);

  button.type = "button";
  button.className = "daavy-addons-target-helper-save";
  button.innerHTML = '<i class="fa-solid fa-dice-d20 fa-fw" inert></i>';
  button.title = game.i18n.localize("DAAVY_ADDONS.TargetHelper.RollSave");
  button.setAttribute("aria-label", button.title);
  button.disabled = !canRoll;
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    button.disabled = true;
    button.classList.add("pending");
    const submitted = await rollSave(message, token, data.save, event);
    if (!submitted && button.isConnected) {
      button.disabled = false;
      button.classList.remove("pending");
    }
  });
  row.append(button);
  return row;
}

function createTargetRow(token) {
  const row = document.createElement("div");
  const name = document.createElement("span");

  row.className = "daavy-addons-target-helper-row";
  name.className = "daavy-addons-target-helper-name";
  name.textContent = getVisibleName(token);
  name.title = name.textContent;
  bindNameInteractions(name, token);
  row.append(name);
  return row;
}

function resolveSaveResultMessage(parentMessage, token, data) {
  const result = data.saveResults?.find((entry) => entry?.targetUuid === token.uuid);
  const stored = game.messages.get(result?.resultMessageId);
  if (stored) return stored;

  return game.messages.contents.findLast((message) => {
    const link = message.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG);
    const context = message.flags?.pf2e?.context;
    const author = message.author;
    return (
      link?.parentMessageId === parentMessage.id
      && link?.targetUuid === token.uuid
      && context?.options?.includes("check:reroll:hero-points")
      && author
      && (author.isGM || token.actor.testUserPermission(author, "OWNER"))
      && isLinkedSaveResult(message, token, data.save, link, true)
    );
  }) ?? null;
}

function createSaveResult(parentMessage, token, resultMessage) {
  const element = document.createElement("span");
  const resultData = resultMessage?.visible
    ? resultMessage.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG)
    : null;
  const outcome = resultData?.outcome;
  const total = resultMessage?.rolls.at(0)?.total;

  element.className = "daavy-addons-target-helper-save-result";
  if (TARGET_HELPER_SAVE_OUTCOMES.includes(outcome) && Number.isFinite(total)) {
    const label = document.createElement("span");
    const value = document.createElement("span");

    element.classList.add(outcome);
    label.className = "daavy-addons-target-helper-save-label";
    label.textContent = game.i18n.localize(`PF2E.Check.Result.Degree.Check.${outcome}`);
    value.textContent = total;
    element.append(label, " ", value);
  } else {
    element.classList.add("hidden-result");
    element.textContent = game.i18n.localize("DAAVY_ADDONS.TargetHelper.HiddenResult");
  }
  const rerollButton = createHeroPointRerollButton(parentMessage, token, resultMessage);
  if (rerollButton) element.prepend(rerollButton);
  return element;
}

function createHeroPointRerollButton(parentMessage, token, resultMessage) {
  const actor = token.actor;
  const canReroll = (
    actor?.isOfType("character")
    && actor.heroPoints.value > 0
    && resultMessage?.rolls.at(0)?.isRerollable === true
    && (game.user.isGM || (token.isOwner && resultMessage.isAuthor))
  );
  if (!canReroll) return null;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "daavy-addons-target-helper-hero-reroll";
  button.innerHTML = '<i class="fa-solid fa-circle-h fa-fw" inert></i>';
  button.title = game.i18n.localize("PF2E.RerollMenu.HeroPoint");
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    button.disabled = true;
    button.classList.add("pending");
    const submitted = await rerollSave(parentMessage, token, resultMessage);
    if (!submitted && button.isConnected) {
      button.disabled = false;
      button.classList.remove("pending");
    }
  });
  return button;
}

function removeNativeSaveControl(content, save) {
  const action = content.querySelector(
    '[data-action="spell-save"], [data-action="roll-area-save"]'
  );
  if (action) {
    action.remove();
    return;
  }

  const control = [...content.querySelectorAll("[data-pf2-check]")]
    .find((element) => (
      element.dataset.pf2Check === save.statistic
      && Number(element.dataset.pf2Dc) + (Number(element.dataset.pf2Adjustment) || 0) === save.dc
    ));
  control?.remove();
}

function bindNameInteractions(element, token) {
  let clickTimer;
  let pressTimer;
  let longPressed = false;

  const cancelPress = () => {
    window.clearTimeout(pressTimer);
    pressTimer = undefined;
  };

  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;

    longPressed = false;
    cancelPress();
    pressTimer = window.setTimeout(() => {
      longPressed = true;
      if (canvas.ready && token.parent === canvas.scene) {
        void canvas.ping(token.center, { pull: event.shiftKey && game.user.isGM });
      }
    }, LONG_PRESS_DELAY);
  });
  element.addEventListener("pointerup", cancelPress);
  element.addEventListener("pointercancel", cancelPress);
  element.addEventListener("pointerleave", cancelPress);
  element.addEventListener("contextmenu", (event) => event.preventDefault());
  element.addEventListener("click", (event) => {
    if (longPressed) {
      longPressed = false;
      event.preventDefault();
      return;
    }
    if (event.detail > 1) return;

    window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => {
      if (canvas.ready && token.parent === canvas.scene) canvas.animatePan(token.center);
    }, SINGLE_CLICK_DELAY);
  });
  element.addEventListener("dblclick", (event) => {
    window.clearTimeout(clickTimer);
    event.preventDefault();
    token.actor?.sheet.render(true);
  });
}

function getVisibleName(token) {
  const namesVisible = !game.pf2e.settings.tokens.nameVisibility || token.playersCanSeeName;
  return game.user.isGM || token.isOwner || namesVisible
    ? token.name
    : game.i18n.localize("PF2E.Actor.ApplyDamage.TheTarget");
}

function resolveTarget(uuid) {
  try {
    return typeof uuid === "string" ? fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

async function resolveUuid(uuid) {
  try {
    return typeof uuid === "string" ? await fromUuid(uuid) : null;
  } catch {
    return null;
  }
}

function canUseTargetHelper() {
  return game.system.id === "pf2e" && getSetting(SETTINGS.TARGET_HELPER) === true;
}

function canUseTargetHelperAutomations() {
  return canUseTargetHelper() && getSetting(SETTINGS.TARGET_HELPER_AUTOMATIONS) === true;
}

function getAutomatedAttackTarget(message) {
  const context = message?.flags?.pf2e?.context;
  return (
    message?.isCheckRoll === true
    && context?.type === "attack-roll"
    && context?.damaging === true
    && context?.isReroll !== true
    && ["success", "criticalSuccess"].includes(context.outcome)
  )
    ? message.target?.token ?? null
    : null;
}

function isSupportedDamageRoll(message) {
  return message?.isDamageRoll === true && message.rolls.at(0)?.options.evaluatePersistent !== true;
}

function getStructuredSave(message) {
  if (message?.isDamageRoll || message?.isCheckRoll || message?.rolls?.length) return null;

  const spell = getSpellLikeItem(message);
  const spellSave = spell?.system?.defense?.save;
  const spellDC = spell?.spellcasting?.statistic?.dc?.value;
  if (isSaveType(spellSave?.statistic) && Number.isFinite(spellDC)) {
    return createSaveData({
      statistic: spellSave.statistic,
      dc: spellDC,
      item: message.item,
      origin: message.actor,
      options: spellSave.basic ? ["damaging-effect"] : []
    });
  }

  const context = message.flags?.pf2e?.context;
  const areaDC = Number(context?.dc?.value ?? context?.dc);
  if (["area-fire", "auto-fire"].includes(context?.type) && Number.isFinite(areaDC)) {
    return createSaveData({
      statistic: "reflex",
      dc: areaDC,
      item: message.item,
      origin: message.actor,
      options: context.options
    });
  }

  return getInlineSave(message);
}

function getSpellLikeItem(message) {
  const item = message?.item;
  if (!item) return null;
  if (item.isOfType?.("spell")) return item;
  return item.isOfType?.("consumable") ? item.embeddedSpell : null;
}

function getInlineSave(message) {
  const container = document.createElement("div");
  container.innerHTML = message.content ?? "";

  for (const link of container.querySelectorAll("[data-pf2-check]")) {
    const statistic = link.dataset.pf2Check;
    const dc = Number(link.dataset.pf2Dc) + (Number(link.dataset.pf2Adjustment) || 0);
    if (!isSaveType(statistic) || !Number.isFinite(dc)) continue;

    return createSaveData({
      statistic,
      dc,
      itemUuid: link.dataset.itemUuid,
      origin: message.actor,
      options: getInlineOptions(link.dataset.pf2RollOptions, link.dataset.pf2Traits)
    });
  }

  for (const match of (message.content ?? "").matchAll(/@Check\[([^\]]+)\]/g)) {
    const parts = match[1].split("|").map((part) => part.trim());
    const statistic = parts[0];
    const params = Object.fromEntries(parts.slice(1).map((part) => {
      const separator = part.indexOf(":");
      return separator < 0 ? [part, true] : [part.slice(0, separator), part.slice(separator + 1)];
    }));
    const dc = Number(params.dc) + (Number(params.adjustment) || 0);
    if (!isSaveType(statistic) || !Number.isFinite(dc)) continue;

    return createSaveData({
      statistic,
      dc,
      item: message.item,
      origin: message.actor,
      options: getInlineOptions(
        [params.basic === true ? "damaging-effect" : null, params.options].filter(Boolean).join(","),
        params.traits
      )
    });
  }

  return null;
}

function createSaveData({ statistic, dc, item, itemUuid, origin, options }) {
  const values = Array.isArray(options) || options instanceof Set ? [...options] : [];
  return {
    statistic,
    dc: Number(dc),
    itemUuid: itemUuid ?? item?.uuid ?? null,
    originUuid: origin?.uuid ?? item?.actor?.uuid ?? null,
    options: [...new Set(values.filter((option) => typeof option === "string" && option))]
  };
}

function getInlineOptions(rollOptions, traitsValue) {
  const traits = splitOptions(traitsValue);
  return [
    ...splitOptions(rollOptions),
    ...traits,
    ...traits.filter((trait) => trait in CONFIG.PF2E.actionTraits).map((trait) => `item:trait:${trait}`)
  ];
}

function splitOptions(value) {
  return typeof value === "string"
    ? value.split(",").map((option) => option.trim()).filter(Boolean)
    : [];
}

function isSaveType(value) {
  return typeof value === "string" && TARGET_HELPER_SAVE_TYPES.has(value);
}

function isValidSave(save) {
  return (
    save
    && isSaveType(save.statistic)
    && Number.isFinite(save.dc)
    && Array.isArray(save.options)
  );
}

function isBasicSave(save) {
  return isValidSave(save)
    && save.options.some((option) => ["damaging-effect", "area-damage"].includes(option));
}

async function rollSave(message, token, save, event, automated = false) {
  if (!message.canUserModify(game.user, "update") && !game.users.activeGM) {
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.NoActiveGM", { localize: true });
    return false;
  }

  const statistic = token.actor?.getStatistic(save.statistic);
  if (!statistic || !(game.user.isGM || token.isOwner)) return false;

  try {
    const item = await resolveUuid(save.itemUuid) ?? getSpellLikeItem(message) ?? message.item;
    const origin = await resolveUuid(save.originUuid) ?? message.actor;
    let rollData = null;

    await statistic.check.roll({
      dc: { value: save.dc },
      item,
      origin,
      token,
      extraRollOptions: save.options,
      skipDialog: automated
        ? true
        : event.shiftKey
          ? game.user.settings.showCheckDialogs
          : !game.user.settings.showCheckDialogs,
      messageMode: !automated && (event.ctrlKey || event.metaKey)
        ? game.user.isGM ? "gm" : "blind"
        : undefined,
      createMessage: false,
      callback: (_roll, outcome, rollMessage) => {
        rollData = { outcome, rollMessage };
      }
    });
    if (!rollData || !TARGET_HELPER_SAVE_OUTCOMES.includes(rollData.outcome)) return false;

    const resultMessage = await createSaveResultMessage(message, token, rollData, automated);
    if (!resultMessage) return false;

    if (message.canUserModify(game.user, "update")) {
      const stored = await appendResult(message, "saveResults", token.uuid, resultMessage.id);
      if (!stored) await resultMessage.delete();
    } else {
      emitTargetHelperRequest(TARGET_HELPER_SAVE_RESULT_FLAG, message, token, resultMessage);
    }
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to roll Target Helper save`, error);
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.SaveError", { localize: true });
    return false;
  }
}

async function rerollSave(parentMessage, token, resultMessage) {
  const actor = token.actor;
  const link = resultMessage?.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG);
  const context = resultMessage?.flags?.pf2e?.context;
  const save = parentMessage.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.save;
  if (
    !actor?.isOfType("character")
    || actor.heroPoints.value < 1
    || resultMessage?.rolls.at(0)?.isRerollable !== true
    || !(game.user.isGM || (token.isOwner && resultMessage.isAuthor))
    || link?.parentMessageId !== parentMessage.id
    || link?.targetUuid !== token.uuid
    || !isValidSave(save)
    || !isLinkedSaveResult(resultMessage, token, save, link)
  ) {
    return false;
  }

  const prepareReroll = (message, _data, _options, userId) => {
    const rerollContext = message.flags?.pf2e?.context;
    if (
      userId !== game.user.id
      || rerollContext?.isReroll !== true
      || !rerollContext.options?.includes("check:reroll:hero-points")
      || rerollContext.target?.actor !== context.target?.actor
      || rerollContext.origin?.actor !== context.origin?.actor
      || rerollContext.dc?.value !== context.dc?.value
      || message.flags?.pf2e?.modifierName !== resultMessage.flags?.pf2e?.modifierName
      || !TARGET_HELPER_SAVE_OUTCOMES.includes(rerollContext.outcome)
    ) {
      return;
    }

    message.updateSource({
      [`flags.${MODULE_ID}.${TARGET_HELPER_SAVE_RESULT_FLAG}`]: {
        ...link,
        outcome: rerollContext.outcome
      }
    });
  };

  Hooks.on("preCreateChatMessage", prepareReroll);
  try {
    await game.pf2e.Check.rerollFromMessage(resultMessage, { resource: "hero-points" });
    return !game.messages.has(resultMessage.id);
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to reroll Target Helper save`, error);
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.SaveError", { localize: true });
    return false;
  } finally {
    Hooks.off("preCreateChatMessage", prepareReroll);
  }
}

async function createSaveResultMessage(parentMessage, token, { outcome, rollMessage }, preserveVisibility = false) {
  const source = rollMessage.toObject();
  delete source._id;
  source.sound = null;
  if (preserveVisibility) {
    source.author = game.users.find((user) => (
      user.active
      && !user.isGM
      && token.actor?.testUserPermission(user, "OWNER")
    ))?.id ?? game.user.id;
    source.whisper = [...parentMessage.whisper];
    source.blind = parentMessage.blind;
  }
  foundry.utils.setProperty(source, `flags.${MODULE_ID}.${TARGET_HELPER_SAVE_RESULT_FLAG}`, {
    parentMessageId: parentMessage.id,
    targetUuid: token.uuid,
    outcome
  });
  return getDocumentClass("ChatMessage").create(source);
}

async function appendResult(message, resultKey, targetUuid, resultMessageId) {
  const data = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
  const results = Array.isArray(data?.[resultKey]) ? data[resultKey] : [];
  if (results.some((result) => result?.targetUuid === targetUuid)) return false;

  await message.update({
    [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.${resultKey}`]: [
      ...results,
      { targetUuid, resultMessageId }
    ]
  });
  return true;
}

function emitTargetHelperRequest(type, message, token, resultMessage) {
  game.socket.emit(TARGET_HELPER_SOCKET, {
    type,
    parentMessageId: message.id,
    targetUuid: token.uuid,
    resultMessageId: resultMessage.id
  });
}

async function handleTargetHelperSocket(payload, userId) {
  if (!game.user.isActiveGM) return;

  const sender = game.users.get(userId);
  if (!sender) return;

  if (payload?.type === TARGET_HELPER_SAVE_RESULT_FLAG) {
    await handleSaveResultSocket(payload, sender);
  } else if (payload?.type === TARGET_HELPER_DAMAGE_RESULT_FLAG) {
    await handleDamageResultSocket(payload, sender);
  } else if (payload?.type === TARGET_HELPER_DAMAGE_UNDO_REQUEST) {
    await handleDamageUndoSocket(payload, sender);
  }
}

async function handleSaveResultSocket(payload, sender) {
  try {
    const parent = game.messages.get(payload.parentMessageId);
    const result = game.messages.get(payload.resultMessageId);
    const target = resolveTarget(payload.targetUuid);
    const link = result?.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG);
    const data = parent?.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
    const author = result?.author;
    const valid = (
      parent
      && result
      && target?.actor
      && author
      && author === sender
      && isValidSave(data?.save)
      && data.targets?.includes(payload.targetUuid)
      && link?.parentMessageId === parent.id
      && link?.targetUuid === payload.targetUuid
      && TARGET_HELPER_SAVE_OUTCOMES.includes(link?.outcome)
      && Number.isFinite(result.rolls.at(0)?.total)
      && isLinkedSaveResult(result, target, data.save, link)
      && (author.isGM || target.actor.testUserPermission(author, "OWNER"))
    );
    if (!valid) {
      if (
        result
        && link?.parentMessageId === payload.parentMessageId
        && link?.targetUuid === payload.targetUuid
      ) {
        await result.delete();
      }
      return;
    }

    const stored = await appendResult(parent, "saveResults", payload.targetUuid, result.id);
    if (!stored) await result.delete();
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to store Target Helper save`, error);
  }
}

async function handleDamageResultSocket(payload, sender) {
  let result = null;
  let target = null;
  try {
    const parent = game.messages.get(payload.parentMessageId);
    result = game.messages.get(payload.resultMessageId);
    target = resolveTarget(payload.targetUuid);
    const link = result?.getFlag(MODULE_ID, TARGET_HELPER_DAMAGE_RESULT_FLAG);
    const data = parent?.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
    const authenticated = (
      result
      && target?.actor
      && result.author === sender
      && (sender.isGM || target.actor.testUserPermission(sender, "OWNER"))
      && link?.parentMessageId === payload.parentMessageId
      && link?.targetUuid === payload.targetUuid
      && isLinkedDamageResult(result, target, link)
    );
    const valid = (
      authenticated
      && parent
      && data?.targets?.includes(payload.targetUuid)
    );

    if (!valid) {
      if (authenticated) await rollbackDamageResult(target.actor, result);
      else if (
        result?.author === sender
        && link?.parentMessageId === payload.parentMessageId
        && link?.targetUuid === payload.targetUuid
      ) {
        await result.delete();
      }
      return;
    }

    if (target.actor.isOfType("npc")) {
      if (!acceptPrivateDamageResult(parent.id, target.uuid, result.id)) {
        await rollbackDamageResult(target.actor, result);
      }
      return;
    }

    const stored = await appendResult(parent, "damageResults", payload.targetUuid, result.id);
    if (!stored) await rollbackDamageResult(target.actor, result);
  } catch (error) {
    if (
      result
      && target?.actor
      && result.author === sender
      && (sender.isGM || target.actor.testUserPermission(sender, "OWNER"))
    ) {
      try {
        await rollbackDamageResult(target.actor, result);
      } catch (rollbackError) {
        console.error(`${MODULE_ID} | Failed to roll back Target Helper damage`, rollbackError);
      }
    }
    console.error(`${MODULE_ID} | Failed to store Target Helper damage`, error);
  }
}

function acceptPrivateDamageResult(parentMessageId, targetUuid, resultMessageId) {
  return !findDamageResultMessage(parentMessageId, targetUuid, resultMessageId);
}

async function handleDamageUndoSocket(payload, sender) {
  try {
    const parent = game.messages.get(payload.parentMessageId);
    const result = game.messages.get(payload.resultMessageId);
    const target = resolveTarget(payload.targetUuid);
    const link = result?.getFlag(MODULE_ID, TARGET_HELPER_DAMAGE_RESULT_FLAG);
    const data = parent?.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
    const stored = data?.damageResults?.some((entry) => (
      entry?.targetUuid === payload.targetUuid
      && entry?.resultMessageId === payload.resultMessageId
    ));
    const valid = (
      parent
      && result
      && target?.actor
      && stored
      && (sender.isGM || target.actor.testUserPermission(sender, "OWNER"))
      && link?.parentMessageId === parent.id
      && link?.targetUuid === payload.targetUuid
      && isLinkedDamageResult(result, target, link)
    );
    if (!valid) return;

    await finalizeDamageUndo(parent, target, result);
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to undo Target Helper damage`, error);
  }
}

function isLinkedSaveResult(message, target, save, link, reroll = false) {
  const context = message.flags?.pf2e?.context;
  return (
    context?.type === "saving-throw"
    && context.target?.actor === target.actor.uuid
    && context.dc?.value === save.dc
    && context.outcome === link.outcome
    && (context.isReroll === true) === reroll
    && message.flags?.pf2e?.modifierName === save.statistic
  );
}

function isLinkedDamageResult(message, target, link) {
  const appliedDamage = message.flags?.pf2e?.appliedDamage ?? null;
  return (
    message.flags?.pf2e?.context?.type === "damage-taken"
    && message.flags?.pf2e?.appliedDamage?.isReverted !== true
    && Number.isFinite(link?.amount)
    && (
      link.multiplier === undefined
      || DAMAGE_ACTIONS.some((action) => action.multiplier === link.multiplier)
    )
    && link.amount === getAppliedDamageAmount(appliedDamage)
    && isValidAppliedDamage(appliedDamage, target)
  );
}

function isValidAppliedDamage(appliedDamage, target) {
  if (appliedDamage === null) return true;
  return (
    appliedDamage?.uuid === target.actor.uuid
    && appliedDamage.isHealing === false
    && Array.isArray(appliedDamage.updates)
    && appliedDamage.updates.every((update) => (
      DAMAGE_UPDATE_PATHS.has(update?.path) && Number.isFinite(update?.value)
    ))
    && Array.isArray(appliedDamage.persistent)
    && appliedDamage.persistent.every((id) => typeof id === "string")
    && (
      appliedDamage.shield === null
      || (
        typeof appliedDamage.shield?.id === "string"
        && Number.isFinite(appliedDamage.shield?.damage)
      )
    )
  );
}

function getAppliedDamageAmount(appliedDamage) {
  if (!Array.isArray(appliedDamage?.updates)) return 0;
  return Math.max(0, appliedDamage.updates.reduce(
    (total, update) => total + (DAMAGE_UPDATE_PATHS.has(update?.path) && Number.isFinite(update?.value)
      ? update.value
      : 0),
    0
  ));
}

async function applyDamage(message, token, multiplier) {
  const roll = message.rolls.at(0);
  if (!token.actor || typeof roll?.alter !== "function") return false;
  const privateNpcResult = token.actor.isOfType("npc");
  if (
    (
      privateNpcResult
      && !game.user.isActiveGM
      && !game.users.activeGM
    )
    || (
      !privateNpcResult
      && !message.canUserModify(game.user, "update")
      && !game.users.activeGM
    )
  ) {
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.NoActiveGM", { localize: true });
    return false;
  }

  let capturedSource = null;
  let resultMessage = null;
  let submitted = false;
  try {
    const context = message.flags.pf2e.context;
    const messageRollOptions = [...(context?.options ?? [])];
    const originRollOptions = messageRollOptions
      .filter((option) => option.startsWith("self:"))
      .map((option) => option.replace(/^self\b/, "origin"));
    const item = message.item;
    const effectRollOptions = item?.isOfType("affliction", "condition", "effect")
      ? item.getRollOptions("item")
      : [];

    if (token.actor.alliance && message.actor) {
      const relationship = token.actor.alliance === message.actor.alliance ? "ally" : "enemy";
      messageRollOptions.push(`origin:${relationship}`);
    }
    if (!messageRollOptions.some((option) => option.startsWith("target"))) {
      messageRollOptions.push(...token.actor.getSelfRollOptions("target"));
    }

    const ephemeralEffects = multiplier > 0
      ? await extractEphemeralEffects({
        origin: message.actor,
        target: token.actor,
        item,
        domains: ["damage-received"],
        options: messageRollOptions
      })
      : [];
    const contextClone = token.actor.getContextualClone(originRollOptions, ephemeralEffects);
    const rollOptions = new Set([
      ...messageRollOptions.filter((option) => !/^(?:self|target)(?::|$)/.test(option)),
      ...effectRollOptions,
      ...originRollOptions,
      ...contextClone.getSelfRollOptions()
    ]);

    const captureDamageMessage = (created) => {
      const appliedDamage = created.flags?.pf2e?.appliedDamage;
      const speaker = created.speaker;
      const targetMatches = (
        appliedDamage?.uuid === token.actor.uuid
        || (
          !appliedDamage
          && speaker?.actor === token.actor.id
          && speaker?.token === token.id
          && speaker?.scene === token.parent.id
        )
      );
      if (created.flags?.pf2e?.context?.type !== "damage-taken" || !targetMatches) return;

      capturedSource = created.toObject();
      return false;
    };

    Hooks.on("preCreateChatMessage", captureDamageMessage);
    try {
      await contextClone.applyDamage({
        damage: roll.alter(multiplier, 0),
        token,
        item,
        skipIWR: multiplier === 0,
        rollOptions,
        outcome: context?.outcome
      });
    } finally {
      Hooks.off("preCreateChatMessage", captureDamageMessage);
    }

    if (!capturedSource) throw new Error("PF2e damage result message was not captured");
    resultMessage = await createDamageResultMessage(message, token, capturedSource, multiplier);
    if (!resultMessage) throw new Error("PF2e damage result message was not stored");

    if (privateNpcResult && game.user.isActiveGM) {
      submitted = acceptPrivateDamageResult(message.id, token.uuid, resultMessage.id);
      if (!submitted) {
        await rollbackDamageResult(token.actor, resultMessage);
        return false;
      }
    } else if (!privateNpcResult && message.canUserModify(game.user, "update")) {
      submitted = await appendResult(message, "damageResults", token.uuid, resultMessage.id);
      if (!submitted) {
        await rollbackDamageResult(token.actor, resultMessage);
        return false;
      }
    } else {
      emitTargetHelperRequest(TARGET_HELPER_DAMAGE_RESULT_FLAG, message, token, resultMessage);
      submitted = true;
    }
    return true;
  } catch (error) {
    if (!submitted) {
      if (resultMessage) await rollbackDamageResult(token.actor, resultMessage);
      else if (capturedSource?.flags?.pf2e?.appliedDamage) {
        await token.actor.undoDamage(capturedSource.flags.pf2e.appliedDamage);
      }
    }
    console.error(`${MODULE_ID} | Failed to apply Target Helper damage`, error);
    ui.notifications.error(
      capturedSource
        ? "DAAVY_ADDONS.TargetHelper.DamageResultError"
        : "DAAVY_ADDONS.TargetHelper.ApplyError",
      { localize: true }
    );
    return false;
  }
}

async function createDamageResultMessage(parentMessage, token, source, multiplier) {
  delete source._id;
  source.sound = null;
  if (source.flags?.[MODULE_ID]) delete source.flags[MODULE_ID][TARGET_HELPER_FLAG];
  if (token.actor.isOfType("npc")) {
    source.whisper = getDocumentClass("ChatMessage")
      .getWhisperRecipients("GM")
      .map((user) => user.id);
  }
  const appliedDamage = source.flags?.pf2e?.appliedDamage ?? null;
  foundry.utils.setProperty(source, `flags.${MODULE_ID}.${TARGET_HELPER_DAMAGE_RESULT_FLAG}`, {
    parentMessageId: parentMessage.id,
    targetUuid: token.uuid,
    amount: getAppliedDamageAmount(appliedDamage),
    multiplier
  });
  return getDocumentClass("ChatMessage").create(source);
}

async function rollbackDamageResult(actor, resultMessage) {
  const appliedDamage = resultMessage.flags?.pf2e?.appliedDamage ?? null;
  if (appliedDamage && appliedDamage.isReverted !== true) {
    await actor.undoDamage(appliedDamage);
    await resultMessage.update({
      "flags.pf2e.appliedDamage.isReverted": true
    });
  }
  await resultMessage.delete();
}

async function undoDamage(message, token, result) {
  if (!message.canUserModify(game.user, "update") && !game.users.activeGM) {
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.NoActiveGM", { localize: true });
    return false;
  }

  const resultMessage = game.messages.get(result.resultMessageId);
  const link = resultMessage?.getFlag(MODULE_ID, TARGET_HELPER_DAMAGE_RESULT_FLAG);
  if (
    !resultMessage
    || !(game.user.isGM || token.isOwner)
    || link?.parentMessageId !== message.id
    || link?.targetUuid !== token.uuid
    || !isLinkedDamageResult(resultMessage, token, link)
  ) {
    return false;
  }

  try {
    if (message.canUserModify(game.user, "update")) {
      return await finalizeDamageUndo(message, token, resultMessage);
    }

    emitTargetHelperRequest(TARGET_HELPER_DAMAGE_UNDO_REQUEST, message, token, resultMessage);
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to undo Target Helper damage`, error);
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.UndoError", { localize: true });
    return false;
  }
}

async function finalizeDamageUndo(parentMessage, token, resultMessage) {
  const appliedDamage = resultMessage.flags?.pf2e?.appliedDamage ?? null;
  if (appliedDamage) {
    await token.actor.undoDamage(appliedDamage);
    await resultMessage.update({
      "flags.pf2e.appliedDamage.isReverted": true
    });
  }

  if (!token.actor.isOfType("npc")) {
    const data = parentMessage.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
    const results = Array.isArray(data?.damageResults) ? data.damageResults : [];
    const remaining = results.filter((result) => (
      result?.targetUuid !== token.uuid || result?.resultMessageId !== resultMessage.id
    ));
    if (remaining.length === results.length) return false;
    await parentMessage.update({
      [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.damageResults`]: remaining
    });
  }
  await resultMessage.delete();
  return true;
}

async function extractEphemeralEffects({ origin, target, item, domains, options }) {
  if (!(origin && target)) return [];

  const test = [
    ...options,
    origin.getRollOptions(domains),
    target.getSelfRollOptions("target")
  ].flat();
  const resolvables = item
    ? item.isOfType("spell") ? { spell: item } : { weapon: item }
    : {};
  const effects = await Promise.all(
    domains
      .flatMap((domain) => origin.synthetics.ephemeralEffects[domain]?.target ?? [])
      .map((effect) => effect({ test, resolvables }))
  );

  return effects.filter(Boolean).map((effect) => {
    if (effect.type !== "effect") return effect;

    effect.system.context = {
      origin: {
        actor: origin.uuid,
        token: null,
        item: null,
        spellcasting: null,
        rollOptions: []
      },
      target: { actor: target.uuid, token: null },
      roll: null
    };
    effect.system.duration = {
      value: -1,
      unit: "unlimited",
      expiry: null,
      sustained: false
    };
    return effect;
  });
}
