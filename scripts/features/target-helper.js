import { MODULE_ID, SETTINGS, TARGET_HELPER_FLAG } from "../constants.js";
import { asHTMLElement } from "../dom.js";
import { getSetting } from "../settings.js";

const LONG_PRESS_DELAY = 500;
const SINGLE_CLICK_DELAY = 250;
const ACTIONS = [
  { key: "Damage", icon: '<i class="fa-solid fa-heart-crack fa-fw" inert></i>', multiplier: 1 },
  { key: "Half", icon: '<i class="fa-solid fa-heart-crack fa-fw" inert></i>', multiplier: 0.5 },
  { key: "Double", icon: '<img src="systems/pf2e/icons/damage/double.svg" alt="">', multiplier: 2 },
  { key: "Block", icon: '<i class="fa-solid fa-shield-blank fa-fw" inert></i>', multiplier: 0 }
];

export function registerTargetHelperHooks() {
  Hooks.on("preCreateChatMessage", captureTargets);
  Hooks.on("renderChatMessageHTML", renderTargetHelper);
}

function captureTargets(message, _data, _options, userId) {
  if (userId !== game.user.id || !canUseTargetHelper() || !isSupportedDamageRoll(message)) return;

  const targets = Array.from(game.user.targets, (token) => token.document?.uuid).filter(Boolean);
  message.updateSource({
    [`flags.${MODULE_ID}.${TARGET_HELPER_FLAG}.targets`]: targets
  });
}

function renderTargetHelper(message, html) {
  if (!canUseTargetHelper() || !isSupportedDamageRoll(message)) return;

  const root = asHTMLElement(html);
  const content = root?.querySelector(".message-content");
  const uuids = message.getFlag(MODULE_ID, TARGET_HELPER_FLAG)?.targets;
  content?.querySelectorAll(".damage-application").forEach((element) => element.remove());
  if (!content || !Array.isArray(uuids) || !uuids.length || content.querySelector(".daavy-addons-target-helper")) {
    return;
  }

  const targets = uuids
    .map(resolveTarget)
    .filter((token) => token?.documentName === "Token" && (game.user.isGM || !isHidden(token)));
  if (!targets.length) return;

  const card = document.createElement("section");
  card.className = "daavy-addons-target-helper";

  for (const target of targets) card.append(createTargetRow(message, target));
  content.append(card);
}

function createTargetRow(message, token) {
  const row = document.createElement("div");
  const name = document.createElement("button");
  const actions = document.createElement("div");
  const canApply = game.user.isGM || token.isOwner;

  row.className = "daavy-addons-target-helper-row";
  name.type = "button";
  name.className = "daavy-addons-target-helper-name";
  name.textContent = getVisibleName(token);
  name.title = name.textContent;
  actions.className = "daavy-addons-target-helper-actions";
  bindNameInteractions(name, token);

  for (const action of ACTIONS) {
    const button = document.createElement("button");
    const label = game.i18n.localize(`DAAVY_ADDONS.TargetHelper.Actions.${action.key}`);

    button.type = "button";
    button.className = `daavy-addons-target-helper-action ${action.key.toLowerCase()}`;
    button.innerHTML = action.icon;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.disabled = !canApply;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void applyDamage(message, token, action.multiplier);
    });
    actions.append(button);
  }

  row.append(name, actions);
  return row;
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
      pingToken(token, event.shiftKey);
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
    clickTimer = window.setTimeout(() => panToToken(token), SINGLE_CLICK_DELAY);
  });
  element.addEventListener("dblclick", (event) => {
    window.clearTimeout(clickTimer);
    event.preventDefault();
    token.actor?.sheet.render(true);
  });
}

function panToToken(token) {
  if (canvas.ready && token.parent === canvas.scene) canvas.animatePan(token.center);
}

function pingToken(token, pull) {
  if (canvas.ready && token.parent === canvas.scene) {
    void canvas.ping(token.center, { pull: pull && game.user.isGM });
  }
}

function getVisibleName(token) {
  const namesVisible = !game.pf2e.settings.tokens.nameVisibility || token.playersCanSeeName;
  return game.user.isGM || token.isOwner || namesVisible
    ? token.name
    : game.i18n.localize("PF2E.Actor.ApplyDamage.TheTarget");
}

function isHidden(token) {
  return token.hidden || !!token.actor?.hasCondition("unnoticed", "undetected");
}

function resolveTarget(uuid) {
  try {
    return typeof uuid === "string" ? fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

function canUseTargetHelper() {
  return game.system.id === "pf2e" && getSetting(SETTINGS.TARGET_HELPER) === true;
}

function isSupportedDamageRoll(message) {
  return message?.isDamageRoll === true && message.rolls.at(0)?.options.evaluatePersistent !== true;
}

async function applyDamage(message, token, multiplier) {
  const roll = message.rolls.at(0);
  if (!token.actor || typeof roll?.alter !== "function") return;

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

    await contextClone.applyDamage({
      damage: roll.alter(multiplier, 0),
      token,
      item,
      skipIWR: multiplier === 0,
      rollOptions,
      outcome: context?.outcome
    });
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to apply Target Helper damage`, error);
    ui.notifications.error("DAAVY_ADDONS.TargetHelper.ApplyError", { localize: true });
  }
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
