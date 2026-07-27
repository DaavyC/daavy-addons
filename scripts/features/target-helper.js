import {
  MODULE_ID,
  SETTINGS,
  TARGET_HELPER_BASIC_SAVE_MULTIPLIERS,
  TARGET_HELPER_DAMAGE_ACTIONS,
  TARGET_HELPER_DAMAGE_RESULT_FLAG,
  TARGET_HELPER_DAMAGE_UPDATE_PATHS,
  TARGET_HELPER_DAMAGE_UNDO_REQUEST,
  TARGET_HELPER_FLAG,
  TARGET_HELPER_SAVE_OUTCOMES,
  TARGET_HELPER_SAVE_RESULT_FLAG,
  TARGET_HELPER_SAVE_TYPES,
  TARGET_HELPER_SOCKET,
  TARGET_HELPER_TARGETS_REQUEST
} from "../constants.js";
import { addPreCreateChatMessageHook } from "../hooks.js";
import { getSetting, resolveUuid, resolveUuidSync as resolveTarget } from "../utils.js";

const LONG_PRESS_DELAY = 500;
const SINGLE_CLICK_DELAY = 250;
let automationQueue = Promise.resolve();
let pendingDamageAutomation = null;

export function registerTargetHelperHooks() {
  addPreCreateChatMessageHook(captureTargets);
  Hooks.on("createChatMessage", (message, options) => {
    if (options?.render !== false) void refreshRelatedMessages(message);
    const link = message.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG);
    if (link && message.flags?.pf2e?.context?.options?.includes("check:reroll:hero-points")) {
      queueAutomation(() => reconcileAutomatedSaveDamage(link));
    }
    queueTargetHelperAutomation(message);
  });
  Hooks.on("updateChatMessage", (message, changes) => {
    void refreshLinkedDamageHelpers(message, changes);
    const automationPath = `flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.automation`;
    if (
      (
        Object.hasOwn(changes, automationPath)
        || foundry.utils.hasProperty(changes, automationPath)
      )
      && message.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.automation?.status === "pending"
    ) {
      queueTargetHelperAutomation(message);
    }
  });
  Hooks.on("deleteChatMessage", (message, options) => {
    if (options?.render !== false) void refreshRelatedMessages(message);
  });
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
            status: "pending",
            ...(pending.pendingTargets ? { pendingTargets: pending.pendingTargets } : {})
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

function queueTargetHelperAutomation(message) {
  if (message.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG)) {
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
  automationQueue = automationQueue.then(task).catch((error) => {
    console.error(`${MODULE_ID} | Failed Target Helper automation`, error);
  });
  return automationQueue;
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
  ) {
    return;
  }

  try {
    if (isSupportedDamageRoll(message)) {
      await applyAutomatedDamage(message, data);
    } else if (["attack", "basic-save"].includes(automation.type)) {
      await automateSource(message, data);
    }
  } catch (error) {
    await updateAutomationState(message, { status: "failed" });
    console.error(`${MODULE_ID} | Failed Target Helper automation`, error);
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.AutomationError", { localize: true });
  }
}

async function automateSource(message, data) {
  const type = data.automation.type;
  const targets = type === "attack"
    ? [resolveTarget(data.targets?.at(0))].filter((token) => token?.actor && token.object)
    : data.targets?.map(resolveTarget).filter((token) => token?.actor) ?? [];
  const pendingTargetUuids = Array.isArray(data.automation.pendingTargets)
    ? new Set(data.automation.pendingTargets)
    : null;
  const automationTargets = pendingTargetUuids
    ? targets.filter((target) => pendingTargetUuids.has(target.uuid))
    : targets;
  if (
    !targets.length
    || (type === "attack" ? !getAutomatedAttackTarget(message) : !isValidSave(data.save))
  ) {
    await updateAutomationState(message, { status: "manual" });
    return;
  }

  const existing = findAutomatedDamageMessage(message.id);
  const resumingDamage = data.automation.status === "rolling-damage";
  if (!existing && resumingDamage) {
    await updateAutomationState(message, { status: "manual" });
    return;
  }

  if (type === "basic-save") {
    await updateAutomationState(message, { status: "rolling-saves" }, false);
    const current = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
    const existingResults = indexSaveResultMessages(message, automationTargets, current);
    const pendingTargets = automationTargets.filter((target) => !existingResults.has(target.uuid));
    const [resolvedItem, resolvedOrigin] = pendingTargets.length
      ? await Promise.all([
        resolveUuid(current.save.itemUuid),
        resolveUuid(current.save.originUuid)
      ])
      : [null, null];
    const item = pendingTargets.length
      ? resolvedItem ?? getSpellLikeItem(message) ?? message.item
      : null;
    const origin = pendingTargets.length ? resolvedOrigin ?? message.actor : null;
    const sharedConsumable = (
      item?.isOfType("weapon")
      && item.traits.has("consumable")
      && item.actor?.items.has(item.id)
      && item.quantity > 0
    );
    const targetGroups = Map.groupBy(
      pendingTargets,
      (target) => sharedConsumable ? "shared-consumable" : target.actor.uuid
    );
    const rolledResults = (await Promise.all([...targetGroups.values()].map(async (group) => {
      const results = [];
      for (const target of group) {
        results.push({
          targetUuid: target.uuid,
          resultMessage: await rollSave(message, target, current.save, null, {
            automated: true,
            deferStorage: true,
            item,
            origin
          })
        });
      }
      return results;
    }))).flat();
    const successfulResults = rolledResults.filter((result) => result.resultMessage);
    const rollsComplete = successfulResults.length === pendingTargets.length;
    await storeAutomatedSaveResults(
      message,
      successfulResults,
      rollsComplete ? "rolling-damage" : "failed"
    );
    if (!rollsComplete) {
      ui.notifications.error("DAAVY_ADDONS.TargetHelper.AutomationError", { localize: true });
      return;
    }
  }

  if (existing) {
    const existingData = existing.getFlag(MODULE_ID, TARGET_HELPER_FLAG) ?? {};
    await existing.update({
      [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.targets`]: [
        ...new Set([...(existingData.targets ?? []), ...targets.map((target) => target.uuid)])
      ],
      [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.automation`]: {
        ...existingData.automation,
        status: "pending",
        pendingTargets: pendingTargetUuids ? [...pendingTargetUuids] : null
      }
    }, { render: false });
    await updateAutomationState(message, {
      status: "rolling-damage",
      damageMessageId: existing.id
    }, false);
    await applyAutomatedDamage(existing, existing.getFlag(MODULE_ID, TARGET_HELPER_FLAG));
    return;
  }

  if (type !== "basic-save") {
    await updateAutomationState(message, { status: "rolling-damage" }, false);
  }
  const damageMessage = await rollAutomatedDamage(
    message,
    targets,
    type,
    pendingTargetUuids ? [...pendingTargetUuids] : null
  );
  await updateAutomationState(message, damageMessage
    ? { status: "rolling-damage", damageMessageId: damageMessage.id }
    : { status: "manual" }, false);
}

async function rollAutomatedDamage(sourceMessage, targets, type, pendingTargets = null) {
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
    pendingTargets,
    rollMultiplier: 1,
    damageMessage: null
  };

  const previousTargets = [...game.user.targets];
  game.user.targets.clear();
  for (const token of targets) {
    if (token.object) game.user.targets.add(token.object);
  }
  pendingDamageAutomation = pending;
  try {
    const attack = sourceMessage._attack;
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
    } else if (type === "attack" && attack) {
      const method = context.outcome === "criticalSuccess" ? "critical" : "damage";
      await attack[method]?.({
        event,
        checkContext: context,
        mapIncreases: context.mapIncreases,
        target: target.object
      });
    } else {
      const spell = getSpellLikeItem(sourceMessage);
      if (spell) {
        pending.rollMultiplier = type === "attack" && context.outcome === "criticalSuccess" ? 2 : 1;
        await spell.rollDamage(event, context?.mapIncreases);
      } else if (type === "basic-save" && attack?.damage) {
        await attack.damage({ event, target: target.object });
      }
    }
  } finally {
    pendingDamageAutomation = null;
    game.user.targets.clear();
    for (const token of previousTargets) game.user.targets.add(token);
  }

  const damageMessage = pending.damageMessage?.id
    ? game.messages.get(pending.damageMessage.id)
    : findAutomatedDamageMessage(sourceMessage.id);
  return damageMessage ?? null;
}

async function applyAutomatedDamage(message, data) {
  const automation = data?.automation;
  const sourceMessage = game.messages.get(automation?.sourceMessageId);
  if (!sourceMessage) {
    await updateAutomationState(message, { status: "failed" });
    return;
  }

  await updateAutomationState(message, { status: "applying" }, false);
  let complete = true;
  const targets = Array.isArray(automation.pendingTargets)
    ? automation.pendingTargets
    : data.targets ?? [];
  for (const uuid of targets) {
    const target = resolveTarget(uuid);
    if (!target?.actor) {
      complete = false;
      continue;
    }
    const existingResult = findDamageResult(message, target.uuid);
    if (existingResult) continue;

    const multiplier = automation.type === "attack"
      ? 1
      : getRecommendedDamageMultiplier(message, target, data);
    if (multiplier === null || !await applyDamage(message, target, multiplier, false)) complete = false;
  }

  const status = complete ? "complete" : "failed";
  await updateAutomationState(message, { status, pendingTargets: null });
  await updateAutomationState(sourceMessage, {
    status,
    damageMessageId: message.id,
    pendingTargets: null
  }, false);
  if (!complete) {
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.AutomationError", { localize: true });
  }
}

function findAutomatedDamageMessage(sourceMessageId) {
  return game.messages.contents.findLast((message) => (
    isSupportedDamageRoll(message)
    && message.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.automation?.sourceMessageId === sourceMessageId
  )) ?? null;
}

async function updateAutomationState(message, changes, render = true) {
  const data = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG) ?? {};
  await message.update({
    [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.automation`]: {
      ...data.automation,
      ...changes
    }
  }, { render });
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
    || !sourceData.targets?.includes(link.targetUuid)
    || !damageMessage
    || !target?.actor
  ) {
    return;
  }

  const resultMessage = resolveSaveResultMessage(sourceMessage, target, sourceData);
  const outcome = resultMessage?.visible
    ? resultMessage.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG)?.outcome
    : null;
  const multiplier = TARGET_HELPER_BASIC_SAVE_MULTIPLIERS[outcome];
  if (multiplier === undefined) return;

  const currentResult = findDamageResult(damageMessage, target.uuid);
  const currentMultiplier = currentResult?.multiplier;
  if (currentMultiplier === multiplier) return;

  if (currentResult) await finalizeDamageUndo(damageMessage, target, currentResult, false);
  const applied = await applyDamage(damageMessage, target, multiplier);
  const status = applied ? "complete" : "failed";
  await updateAutomationState(damageMessage, { status });
  await updateAutomationState(sourceMessage, { status });
  if (!applied) {
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.AutomationError", { localize: true });
  }
}

function renderTargetHelper(message, html) {
  if (!html) return;

  if (message.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG)) {
    html.classList.add("daavy-addons-target-helper-storage");
    return;
  }
  if (!canUseTargetHelper()) return;

  const data = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
  if (isSupportedDamageRoll(message)) {
    renderTargetCard(message, html, data, true);
  } else if (isValidSave(data?.save)) {
    renderTargetCard(message, html, data, false);
  }
}

function renderTargetCard(message, root, data, damage) {
  const content = root.querySelector(".message-content");
  if (!content) return;

  if (damage) {
    content.querySelectorAll(".damage-application").forEach((element) => element.remove());
  } else {
    removeNativeSaveControl(content, data.save);
  }
  if (
    !Array.isArray(data?.targets)
    || content.querySelector(".daavy-addons-target-helper")
    || content.querySelector(".daavy-addons-target-helper-controls")
  ) {
    return;
  }

  const controls = damage ? null : createTargetControls(message, data);
  const footer = controls ? content.querySelector(".pf2e.chat-card > footer") : null;
  if (footer) footer.append(controls);

  const targets = data.targets
    .map(resolveTarget)
    .filter((token) => (
      token?.documentName === "Token"
      && (game.user.isGM || !(token.hidden || token.actor?.hasCondition("unnoticed", "undetected")))
      && (!damage || game.user.isGM || !token.actor?.isOfType("npc"))
    ));

  const saveResultMessages = damage ? null : indexSaveResultMessages(message, targets, data);
  const card = document.createElement("section");
  card.className = "daavy-addons-target-helper";
  if (controls && !footer) card.append(controls);
  if (!targets.length) {
    if (controls && !footer) content.append(card);
    return;
  }
  card.append(document.createElement("hr"));
  for (const target of targets) {
    card.append(damage
      ? createDamageRow(message, target, data)
      : createSaveRow(message, target, data, saveResultMessages.get(target.uuid) ?? null));
  }
  content.append(card);
}

function createTargetControls(message, data) {
  const controls = document.createElement("div");
  const add = createIconButton(
    "daavy-addons-target-helper-control daavy-addons-target-helper-add-targets",
    '<i class="fa-solid fa-user-plus fa-fw" inert></i>',
    game.i18n.localize("DAAVY_ADDONS.TargetHelper.AddTargets")
  );
  const clear = createIconButton(
    "daavy-addons-target-helper-control daavy-addons-target-helper-clear-targets",
    '<i class="fa-solid fa-eraser fa-fw" inert></i>',
    game.i18n.localize("DAAVY_ADDONS.TargetHelper.ClearTargets")
  );
  const canManage = message.canUserModify(game.user, "update");

  controls.className = "daavy-addons-target-helper-controls";
  add.disabled = !canManage;
  clear.disabled = !canManage || (!data.targets.length && !data.saveResults?.length && !data.damageResults?.length);
  bindPendingButton(add, () => requestTargetHelperTargetChange(message, "add"), !canManage);
  bindPendingButton(clear, () => requestTargetHelperTargetChange(message, "clear"), clear.disabled);
  controls.append(add, clear);
  return controls;
}

function requestTargetHelperTargetChange(message, action) {
  if (!message.canUserModify(game.user, "update")) return false;
  if (!game.users.activeGM) {
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.NoActiveGM", { localize: true });
    return false;
  }

  const targets = action === "add"
    ? Array.from(game.user.targets, (token) => token.document?.uuid).filter(Boolean)
    : [];
  if (
    action === "add"
    && !targets.some((uuid) => !message.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.targets?.includes(uuid))
  ) {
    return false;
  }

  if (game.user.isActiveGM) {
    return queueAutomation(() => updateTargetHelperTargets(message.id, action, targets, game.user));
  }
  game.socket.emit(TARGET_HELPER_SOCKET, {
    type: TARGET_HELPER_TARGETS_REQUEST,
    parentMessageId: message.id,
    action,
    targets
  });
  return true;
}

function createDamageRow(message, token, data) {
  const row = createTargetRow(token);
  const recommendedMultiplier = getRecommendedDamageMultiplier(message, token, data);
  const result = data?.damageResults?.find((entry) => entry?.targetUuid === token.uuid);
  if (result) {
    row.append(createDamageResult(message, token, result));
    return row;
  }

  const actions = document.createElement("div");
  const canApply = game.user.isGM || token.isOwner;

  actions.className = "daavy-addons-target-helper-actions";
  for (const action of TARGET_HELPER_DAMAGE_ACTIONS) {
    const label = game.i18n.localize(`DAAVY_ADDONS.TargetHelper.Actions.${action.key}`);
    const button = createIconButton(`daavy-addons-target-helper-action ${action.key.toLowerCase()}`, action.icon, label);

    button.classList.toggle("recommended", action.multiplier === recommendedMultiplier);
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

function findDamageResult(message, targetUuid) {
  return message.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.damageResults
    ?.find((result) => result?.targetUuid === targetUuid) ?? null;
}

async function refreshLinkedDamageHelpers(message, changes) {
  const relevantPaths = [
    `flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.saveResults`,
    `flags.${MODULE_ID}.${TARGET_HELPER_SAVE_RESULT_FLAG}.outcome`
  ];
  if (
    changes
    && !relevantPaths.some((path) => (
      Object.hasOwn(changes, path) || foundry.utils.hasProperty(changes, path)
    ))
  ) {
    return;
  }
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
  const link = message.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG);
  const parent = game.messages.get(link?.parentMessageId);
  await Promise.all([
    parent && document.querySelector(`li.chat-message[data-message-id="${parent.id}"]`)
      ? ui.chat.updateMessage(parent)
      : undefined,
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
  return TARGET_HELPER_BASIC_SAVE_MULTIPLIERS[outcome] ?? null;
}

function createDamageResult(message, token, result) {
  const container = document.createElement("div");
  const amount = document.createElement("span");
  const button = createIconButton("daavy-addons-target-helper-undo", '<i class="fa-solid fa-rotate-left fa-fw" inert></i>', game.i18n.localize("DAAVY_ADDONS.TargetHelper.UndoDamage"));
  const visible = canViewDamageResult(result);
  const canUndo = visible && (game.user.isGM || token.isOwner);

  container.className = "daavy-addons-target-helper-damage-result";
  amount.className = "daavy-addons-target-helper-damage-amount";
  amount.textContent = visible && Number.isFinite(result.amount)
    ? result.amount
    : game.i18n.localize("DAAVY_ADDONS.TargetHelper.HiddenResult");

  button.disabled = !canUndo;
  bindPendingButton(button, () => undoDamage(message, token), !canUndo);

  const iwrInfo = visible ? createIwrInfo(result) : null;
  container.append(...[iwrInfo, amount, button].filter(Boolean));
  return container;
}

function createIwrInfo(result) {
  if (
    !Array.isArray(result.iwrApplications)
    || !isValidIwrApplications(result.iwrApplications)
    || (result.iwrGmOnly && !game.user.isGM)
  ) {
    return null;
  }
  const info = document.createElement("span");
  info.className = "iwr";
  info.innerHTML = '<i class="fa-solid fa-circle-info" inert></i>';
  void foundry.applications.handlebars
    .renderTemplate("systems/pf2e/templates/chat/damage/iwr-breakdown.hbs", {
      applications: result.iwrApplications
    })
    .then((html) => {
      info.dataset.tooltipClass = "pf2e";
      info.dataset.tooltipHtml = html;
    })
    .catch((error) => {
      console.error(`${MODULE_ID} | Failed to render Target Helper IWR tooltip`, error);
    });
  return info;
}

function canViewDamageResult(result) {
  return (
    game.user.isGM
    || (
      result?.blind !== true
      && (!result?.whisper?.length || result.whisper.includes(game.user.id))
    )
  );
}

function isValidIwrApplications(applications) {
  return applications === null || (
    Array.isArray(applications)
    && applications.every((application) => (
      application
      && typeof application.category === "string"
      && typeof application.type === "string"
      && Number.isFinite(application.adjustment)
    ))
  );
}

function createSaveRow(message, token, data, resultMessage) {
  const row = createTargetRow(token);
  const result = data.saveResults?.find((entry) => entry?.targetUuid === token.uuid);
  if (result || resultMessage) {
    row.append(createSaveResult(message, token, resultMessage));
    return row;
  }

  const button = createIconButton("daavy-addons-target-helper-save", '<i class="fa-solid fa-dice-d20 fa-fw" inert></i>', game.i18n.localize("DAAVY_ADDONS.TargetHelper.RollSave"));
  const canRoll = (game.user.isGM || token.isOwner) && !!token.actor?.getStatistic(data.save.statistic);

  button.disabled = !canRoll;
  bindPendingButton(button, (event) => rollSave(message, token, data.save, event));
  row.append(button);
  return row;
}

function createTargetRow(token) {
  const row = document.createElement("div");
  const name = document.createElement("span");

  row.className = "daavy-addons-target-helper-row";
  name.className = "daavy-addons-target-helper-name";
  const namesVisible = !game.pf2e.settings.tokens.nameVisibility || token.playersCanSeeName;
  name.textContent = game.user.isGM || token.isOwner || namesVisible
    ? token.name
    : game.i18n.localize("PF2E.Actor.ApplyDamage.TheTarget");
  name.title = name.textContent;
  bindNameInteractions(name, token);
  row.append(name);
  return row;
}

function resolveSaveResultMessage(parentMessage, token, data) {
  return indexSaveResultMessages(parentMessage, [token], data).get(token.uuid) ?? null;
}

function indexSaveResultMessages(parentMessage, targets, data) {
  const storedByTarget = new Map();
  for (const result of data.saveResults ?? []) {
    if (!storedByTarget.has(result?.targetUuid)) {
      storedByTarget.set(result?.targetUuid, game.messages.get(result?.resultMessageId) ?? null);
    }
  }

  const indexed = new Map([...storedByTarget].filter(([, message]) => message));
  const unresolved = new Map(
    targets
      .filter((target) => !indexed.has(target.uuid))
      .map((target) => [target.uuid, target])
  );
  for (let index = game.messages.contents.length - 1; index >= 0 && unresolved.size; index -= 1) {
    const message = game.messages.contents[index];
    const target = unresolved.get(
      message.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG)?.targetUuid
    );
    if (target && isHeroPointSaveReroll(message, parentMessage, target, data)) {
      indexed.set(target.uuid, message);
      unresolved.delete(target.uuid);
    }
  }
  return indexed;
}

function isHeroPointSaveReroll(message, parentMessage, token, data) {
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

  const button = createIconButton("daavy-addons-target-helper-hero-reroll", '<i class="fa-solid fa-circle-h fa-fw" inert></i>', game.i18n.localize("PF2E.RerollMenu.HeroPoint"));
  bindPendingButton(button, () => rerollSave(parentMessage, token, resultMessage));
  return button;
}

function createIconButton(className, icon, title) {
  const button = document.createElement("button");
  Object.assign(button, { type: "button", className, innerHTML: icon, title });
  button.setAttribute("aria-label", title);
  return button;
}

function bindPendingButton(button, action, disabled = false) {
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    button.disabled = true;
    button.classList.add("pending");
    if (!await action(event) && button.isConnected) {
      button.disabled = disabled;
      button.classList.remove("pending");
    }
  });
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

async function rollSave(message, token, save, event, options = {}) {
  const {
    automated = false,
    deferStorage = false,
    item: resolvedItem,
    origin: resolvedOrigin
  } = options;
  if (!message.canUserModify(game.user, "update") && !game.users.activeGM) {
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.NoActiveGM", { localize: true });
    return false;
  }

  const statistic = token.actor?.getStatistic(save.statistic);
  if (!statistic || !(game.user.isGM || token.isOwner)) return false;

  try {
    const item = Object.hasOwn(options, "item")
      ? resolvedItem
      : await resolveUuid(save.itemUuid) ?? getSpellLikeItem(message) ?? message.item;
    const origin = Object.hasOwn(options, "origin")
      ? resolvedOrigin
      : await resolveUuid(save.originUuid) ?? message.actor;
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
    if (deferStorage) return resultMessage;

    if (message.canUserModify(game.user, "update")) {
      const stored = await appendSaveResult(message, token.uuid, resultMessage.id);
      if (!stored) await resultMessage.delete();
    } else {
      emitTargetHelperRequest(TARGET_HELPER_SAVE_RESULT_FLAG, message, token, {
        resultMessageId: resultMessage.id
      });
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

  const removePrepareReroll = addPreCreateChatMessageHook(prepareReroll);
  try {
    await game.pf2e.Check.rerollFromMessage(resultMessage, { resource: "hero-points" });
    return !game.messages.has(resultMessage.id);
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to reroll Target Helper save`, error);
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.SaveError", { localize: true });
    return false;
  } finally {
    removePrepareReroll();
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
  return getDocumentClass("ChatMessage").create(source, { render: !preserveVisibility });
}

async function appendSaveResult(message, targetUuid, resultMessageId) {
  const data = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
  const results = Array.isArray(data?.saveResults) ? data.saveResults : [];
  if (results.some((result) => result?.targetUuid === targetUuid)) return false;

  await message.update({
    [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.saveResults`]: [
      ...results,
      { targetUuid, resultMessageId }
    ]
  });
  return true;
}

async function storeAutomatedSaveResults(message, results, status) {
  const data = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG) ?? {};
  const stored = Array.isArray(data.saveResults) ? data.saveResults : [];
  const targetUuids = new Set(stored.map((result) => result?.targetUuid).filter(Boolean));
  const additions = [];
  const duplicates = [];

  for (const result of results) {
    if (targetUuids.has(result.targetUuid)) {
      duplicates.push(result.resultMessage);
      continue;
    }
    targetUuids.add(result.targetUuid);
    additions.push({
      targetUuid: result.targetUuid,
      resultMessageId: result.resultMessage.id
    });
  }

  try {
    await message.update({
      ...(additions.length ? {
        [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.saveResults`]: [...stored, ...additions]
      } : {}),
      [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.automation`]: {
        ...data.automation,
        status
      }
    }, { render: additions.length > 0 });
  } catch (error) {
    await Promise.allSettled(results.map((result) => result.resultMessage.delete({ render: false })));
    throw error;
  }

  await Promise.all(duplicates.map((resultMessage) => resultMessage.delete({ render: false })));
}

function emitTargetHelperRequest(type, message, token, result = {}) {
  game.socket.emit(TARGET_HELPER_SOCKET, {
    type,
    parentMessageId: message.id,
    targetUuid: token.uuid,
    ...result
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
  } else if (payload?.type === TARGET_HELPER_TARGETS_REQUEST) {
    queueAutomation(() => updateTargetHelperTargets(
      payload.parentMessageId,
      payload.action,
      payload.targets,
      sender
    ));
  }
}

async function updateTargetHelperTargets(messageId, action, requestedTargets, sender) {
  const message = game.messages.get(messageId);
  const data = message?.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
  if (
    !message
    || !["add", "clear"].includes(action)
    || !message.canUserModify(sender, "update")
    || !(isValidSave(data?.save) || isSupportedDamageRoll(message))
  ) {
    return false;
  }

  const sourceMessage = isValidSave(data.save)
    ? message
    : game.messages.get(data.saveMessageId ?? data.automation?.sourceMessageId);
  const sourceData = sourceMessage?.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
  const validSource = isValidSave(sourceData?.save) ? sourceMessage : null;
  const damageMessage = isSupportedDamageRoll(message)
    ? message
    : validSource
      ? game.messages.get(sourceData.automation?.damageMessageId)
        ?? findAutomatedDamageMessage(validSource.id)
        ?? game.messages.contents.findLast((candidate) => (
          isSupportedDamageRoll(candidate)
          && candidate.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.saveMessageId === validSource.id
        ))
      : null;
  const messages = [...new Set([validSource, damageMessage ?? message].filter(Boolean))];

  if (action === "add") {
    const targets = [...new Set(Array.isArray(requestedTargets) ? requestedTargets : [])]
      .map(resolveTarget)
      .filter((target) => (
        target?.documentName === "Token"
        && target.actor
        && (
          sender.isGM
          || !(target.hidden || target.actor.hasCondition("unnoticed", "undetected"))
        )
      ));
    const existing = new Set(messages.flatMap((targetMessage) => (
      targetMessage.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.targets ?? []
    )));
    const additions = targets.filter((target) => !existing.has(target.uuid));
    const nextTargets = [...existing, ...additions.map((target) => target.uuid)];
    const synchronized = messages.every((targetMessage) => {
      const current = targetMessage.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.targets ?? [];
      return current.length === nextTargets.length && current.every((uuid) => existing.has(uuid));
    });
    if (!additions.length && synchronized) return false;

    const basicAutomationMessage = messages.find((targetMessage) => (
      targetMessage.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.automation?.type === "basic-save"
    ));
    const automationTargets = basicAutomationMessage
      ? targets.filter((target) => (
        !basicAutomationMessage
          .getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.targets?.includes(target.uuid)
      ))
      : additions;
    const automationMessage = automationTargets.length && canUseTargetHelperAutomations()
      ? basicAutomationMessage ?? damageMessage
      : null;
    const previous = [];
    try {
      for (const targetMessage of messages) {
        const current = targetMessage.getFlag(MODULE_ID, TARGET_HELPER_FLAG) ?? {};
        const automate = targetMessage === automationMessage && current.automation;
        previous.push({ message: targetMessage, targets: current.targets, automation: current.automation });
        await targetMessage.update({
          [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.targets`]: nextTargets,
          ...(automate ? {
            [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.automation`]: {
              ...current.automation,
              status: "pending",
              pendingTargets: automationTargets.map((target) => target.uuid)
            }
          } : {})
        });
      }
      return true;
    } catch (error) {
      for (const state of previous.reverse()) {
        await state.message.update({
          [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.targets`]: state.targets,
          ...(state.automation ? {
            [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.automation`]: state.automation
          } : {})
        }).catch(() => {});
      }
      throw error;
    }
  }

  let undoFailed = false;
  const damageResults = damageMessage
    ?.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.damageResults ?? [];
  for (const result of [...damageResults].reverse()) {
    const target = resolveTarget(result?.targetUuid);
    try {
      if (
        !target?.actor
        || !isValidDamageResult(result, target)
        || !await finalizeDamageUndo(damageMessage, target, result, false)
      ) {
        undoFailed = true;
      }
    } catch (error) {
      undoFailed = true;
      console.error(`${MODULE_ID} | Failed to clear Target Helper damage`, error);
    }
  }
  if (undoFailed) {
    const current = damageMessage?.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
    if (damageMessage) {
      await damageMessage.update({
        [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.damageResults`]: current?.damageResults ?? []
      });
    }
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.UndoError", { localize: true });
    return false;
  }

  for (const targetMessage of messages) {
    const current = targetMessage.getFlag(MODULE_ID, TARGET_HELPER_FLAG) ?? {};
    await targetMessage.update({
      [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.targets`]: [],
      ...(Array.isArray(current.saveResults) ? {
        [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.saveResults`]: []
      } : {}),
      ...(Array.isArray(current.damageResults) ? {
        [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.damageResults`]: []
      } : {}),
      ...(current.automation ? {
        [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.automation`]: {
          ...current.automation,
          status: "manual",
          pendingTargets: null
        }
      } : {})
    });
  }
  const saveMessages = validSource
    ? game.messages.contents.filter((candidate) => (
      candidate.getFlag(MODULE_ID, TARGET_HELPER_SAVE_RESULT_FLAG)?.parentMessageId === validSource.id
    ))
    : [];
  const deletions = await Promise.allSettled(saveMessages.map((resultMessage) => (
    resultMessage.delete({ render: false })
  )));
  for (const deletion of deletions) {
    if (deletion.status === "rejected") {
      console.error(`${MODULE_ID} | Failed to delete cleared Target Helper save`, deletion.reason);
    }
  }
  return true;
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

    const stored = await appendSaveResult(parent, payload.targetUuid, result.id);
    if (!stored) await result.delete();
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to store Target Helper save`, error);
  }
}

async function handleDamageResultSocket(payload, sender) {
  let target = null;
  try {
    const parent = game.messages.get(payload.parentMessageId);
    target = resolveTarget(payload.targetUuid);
    const data = parent?.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
    const authenticated = (
      target?.actor
      && (sender.isGM || target.actor.testUserPermission(sender, "OWNER"))
      && isValidDamageResult(payload.result, target)
    );
    const valid = (
      authenticated
      && parent
      && data?.targets?.includes(payload.targetUuid)
    );

    if (!valid) {
      if (authenticated) await rollbackDamageResult(target.actor, payload.result);
      return;
    }

    const stored = await appendDamageResult(parent, payload.result);
    if (!stored) await rollbackDamageResult(target.actor, payload.result);
  } catch (error) {
    if (
      target?.actor
      && (sender.isGM || target.actor.testUserPermission(sender, "OWNER"))
      && isValidDamageResult(payload.result, target)
    ) {
      try {
        await rollbackDamageResult(target.actor, payload.result);
      } catch (rollbackError) {
        console.error(`${MODULE_ID} | Failed to roll back Target Helper damage`, rollbackError);
      }
    }
    console.error(`${MODULE_ID} | Failed to store Target Helper damage`, error);
  }
}

async function handleDamageUndoSocket(payload, sender) {
  try {
    const parent = game.messages.get(payload.parentMessageId);
    const target = resolveTarget(payload.targetUuid);
    const result = parent && findDamageResult(parent, payload.targetUuid);
    const valid = (
      parent
      && result
      && target?.actor
      && (sender.isGM || target.actor.testUserPermission(sender, "OWNER"))
      && isValidDamageResult(result, target)
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

function isValidDamageResult(result, target) {
  const appliedDamage = result?.appliedDamage ?? null;
  return (
    result?.targetUuid === target.uuid
    && Number.isFinite(result.amount)
    && TARGET_HELPER_DAMAGE_ACTIONS.some((action) => action.multiplier === result.multiplier)
    && result.amount === getAppliedDamageAmount(appliedDamage)
    && Array.isArray(result.whisper)
    && result.whisper.every((id) => typeof id === "string")
    && typeof result.blind === "boolean"
    && isValidIwrApplications(result.iwrApplications)
    && typeof result.iwrGmOnly === "boolean"
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
      TARGET_HELPER_DAMAGE_UPDATE_PATHS.has(update?.path) && Number.isFinite(update?.value)
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
    (total, update) => total + (TARGET_HELPER_DAMAGE_UPDATE_PATHS.has(update?.path) && Number.isFinite(update?.value)
      ? update.value
      : 0),
    0
  ));
}

async function applyDamage(message, token, multiplier, renderResult = true) {
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

  let damageResult = null;
  let submitted = false;
  let rollbackAttempted = false;
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

      const wrapper = document.createElement("div");
      wrapper.innerHTML = created.content ?? "";
      const iwr = wrapper.querySelector(".damage-taken .iwr");
      let iwrApplications = null;
      try {
        iwrApplications = JSON.parse(iwr?.dataset.applications ?? "null");
      } catch {
        iwrApplications = null;
      }
      if (!isValidIwrApplications(iwrApplications)) iwrApplications = null;
      damageResult = {
        targetUuid: token.uuid,
        amount: getAppliedDamageAmount(appliedDamage),
        multiplier,
        appliedDamage: foundry.utils.deepClone(appliedDamage ?? null),
        whisper: [...(created.whisper ?? [])],
        blind: created.blind === true,
        iwrApplications,
        iwrGmOnly: iwr?.dataset.visibility === "gm"
      };
      return false;
    };

    const removeCaptureDamageMessage = addPreCreateChatMessageHook(captureDamageMessage);
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
      removeCaptureDamageMessage();
    }

    if (!damageResult) throw new Error("PF2e damage result was not captured");
    if (message.canUserModify(game.user, "update")) {
      submitted = await appendDamageResult(message, damageResult, renderResult);
    } else {
      emitTargetHelperRequest(TARGET_HELPER_DAMAGE_RESULT_FLAG, message, token, {
        result: damageResult
      });
      submitted = true;
    }
    if (!submitted) {
      rollbackAttempted = true;
      await rollbackDamageResult(token.actor, damageResult);
      return false;
    }
    return true;
  } catch (error) {
    if (!submitted && !rollbackAttempted && damageResult) {
      await rollbackDamageResult(token.actor, damageResult);
    }
    console.error(`${MODULE_ID} | Failed to apply Target Helper damage`, error);
    ui.notifications.error(
      damageResult
        ? "DAAVY_ADDONS.TargetHelper.DamageResultError"
        : "DAAVY_ADDONS.TargetHelper.ApplyError",
      { localize: true }
    );
    return false;
  }
}

async function appendDamageResult(message, result, render = true) {
  const data = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
  const results = Array.isArray(data?.damageResults) ? data.damageResults : [];
  if (results.some((entry) => entry?.targetUuid === result.targetUuid)) return false;
  await message.update({
    [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.damageResults`]: [...results, result]
  }, { render });
  return true;
}

async function rollbackDamageResult(actor, result) {
  const appliedDamage = result.appliedDamage;
  if (!appliedDamage) return;

  const expectsActorUpdate = (
    appliedDamage.updates.some((update) => (
      typeof foundry.utils.getProperty(actor, update.path) === "number"
    ))
    || !!(appliedDamage.shield && actor.inventory.get(appliedDamage.shield.id))
  );
  if (!expectsActorUpdate) {
    await actor.undoDamage(appliedDamage);
    return;
  }

  let timeout;
  let onUpdate;
  const updated = new Promise((resolve, reject) => {
    onUpdate = (updatedActor, _changes, options) => {
      if (updatedActor !== actor || options?.damageUndo !== true) return;
      Hooks.off("updateActor", onUpdate);
      globalThis.clearTimeout(timeout);
      resolve();
    };
    Hooks.on("updateActor", onUpdate);
    timeout = globalThis.setTimeout(() => {
      Hooks.off("updateActor", onUpdate);
      reject(new Error("PF2e damage undo update timed out"));
    }, 10000);
  });

  try {
    await actor.undoDamage(appliedDamage);
    await updated;
  } finally {
    Hooks.off("updateActor", onUpdate);
    globalThis.clearTimeout(timeout);
  }
}

async function undoDamage(message, token) {
  if (!message.canUserModify(game.user, "update") && !game.users.activeGM) {
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.NoActiveGM", { localize: true });
    return false;
  }

  const stored = findDamageResult(message, token.uuid);
  if (
    !(game.user.isGM || token.isOwner)
    || !stored
    || !isValidDamageResult(stored, token)
  ) {
    return false;
  }

  try {
    if (message.canUserModify(game.user, "update")) {
      return await finalizeDamageUndo(message, token, stored);
    }

    emitTargetHelperRequest(TARGET_HELPER_DAMAGE_UNDO_REQUEST, message, token);
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to undo Target Helper damage`, error);
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.UndoError", { localize: true });
    return false;
  }
}

async function finalizeDamageUndo(parentMessage, token, result, render = true) {
  await rollbackDamageResult(token.actor, result);
  const data = parentMessage.getFlag(MODULE_ID, TARGET_HELPER_FLAG);
  const results = Array.isArray(data?.damageResults) ? data.damageResults : [];
  const remaining = results.filter((entry) => entry?.targetUuid !== result.targetUuid);
  if (remaining.length === results.length) return false;
  await parentMessage.update({
    [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.damageResults`]: remaining
  }, { render });
  return true;
}

async function extractEphemeralEffects({ origin, target, item, options }) {
  if (!(origin && target)) return [];

  const test = [
    ...options,
    origin.getRollOptions(["damage-received"]),
    target.getSelfRollOptions("target")
  ].flat();
  const resolvables = item
    ? item.isOfType("spell") ? { spell: item } : { weapon: item }
    : {};
  const effects = await Promise.all(
    (origin.synthetics.ephemeralEffects["damage-received"]?.target ?? [])
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
