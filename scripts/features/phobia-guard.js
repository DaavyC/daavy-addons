import { MODULE_ID, SETTINGS } from "../constants.js";
import { getSetting } from "../utils.js";

const PHOBIA_TAGS_FLAG = "phobiaTags";
const PHOBIA_TAGS_PATH = `flags.${MODULE_ID}.${PHOBIA_TAGS_FLAG}`;
const PHOBIA_TRIGGER_IMAGE = `modules/${MODULE_ID}/assets/phobia-trigger.svg`;
const PHOBIA_TRIGGER_COLOR = [0.55, 0.85, 0.65, 1];

let triggerFilter;

function isPhobiaGuardEnabled() {
  return getSetting(SETTINGS.PHOBIA_GUARD) === true;
}

function getGlobalTags() {
  return [...getSetting(SETTINGS.PHOBIA_GUARD_TAGS)];
}

export function getGlobalTagChoices() {
  return Object.fromEntries(getGlobalTags().map((tag) => [tag, tag]));
}

function getTokenTags(token) {
  return token.getFlag(MODULE_ID, PHOBIA_TAGS_FLAG) ?? [];
}

function getHiddenTags() {
  const globalTags = new Set(getGlobalTags());
  return new Set([...getSetting(SETTINGS.PHOBIA_GUARD_HIDDEN_TAGS)].filter((tag) => globalTags.has(tag)));
}

function shouldHideTrigger(tokenDocument) {
  if (!isPhobiaGuardEnabled()) return false;
  const tokenTags = getTokenTags(tokenDocument);
  if (!tokenTags.length) return false;
  const hiddenTags = getHiddenTags();
  return tokenTags.some((tag) => hiddenTags.has(tag));
}

function getTriggerFilter() {
  if (!triggerFilter) {
    triggerFilter = foundry.canvas.rendering.filters.OutlineOverlayFilter.create({
      wave: true,
      outlineColor: PHOBIA_TRIGGER_COLOR
    });
    triggerFilter.thickness = 1;
  }
  return triggerFilter;
}

function hideTriggerImage(token) {
  if (!shouldHideTrigger(token)) return;
  token.texture.src = PHOBIA_TRIGGER_IMAGE;
  if (token.ring.subject.texture) token.ring.subject.texture = PHOBIA_TRIGGER_IMAGE;
}

export function registerPhobiaGuardTokenClasses() {
  const BaseTokenDocument = CONFIG.Token.documentClass;
  CONFIG.Token.documentClass = class PhobiaGuardTokenDocument extends BaseTokenDocument {
    prepareDerivedData() {
      super.prepareDerivedData();
      hideTriggerImage(this);
    }
  };

  const BaseToken = CONFIG.Token.objectClass;
  CONFIG.Token.objectClass = class PhobiaGuardToken extends BaseToken {
    get isVisible() {
      const visible = super.isVisible;
      if (visible && shouldHideTrigger(this.document)) this.detectionFilter = getTriggerFilter();
      return visible;
    }
  };
}

export function refreshTriggerImage(token, changes) {
  if (!foundry.utils.hasProperty(changes, PHOBIA_TAGS_PATH) || !isPhobiaGuardEnabled()) return;
  token.reset();
  token.object?.renderFlags.set({ redraw: true });
  if (!token.combatant) return;
  token.combatant.reset();
  ui.combat.render();
}

export function addPhobiaTagsField(app, html) {
  if (!isPhobiaGuardEnabled() || html.querySelector("[data-phobia-tags]")) return;
  const imageRow = html.querySelector('[name="texture.src"]')?.closest(".form-group");
  if (!imageRow) return;

  const globalTags = getGlobalTags();
  const { createMultiSelectInput, createFormGroup } = foundry.applications.fields;
  const group = createFormGroup({
    input: createMultiSelectInput({
      name: PHOBIA_TAGS_PATH,
      options: globalTags.map((tag) => ({ value: tag, label: tag })),
      value: getTokenTags(app.token).filter((tag) => globalTags.includes(tag))
    }),
    label: "DAAVY_ADDONS.PhobiaGuard.TokenConfig.Label",
    hint: globalTags.length
      ? "DAAVY_ADDONS.PhobiaGuard.TokenConfig.Hint"
      : "DAAVY_ADDONS.PhobiaGuard.TokenConfig.NoTags",
    rootId: app.id,
    stacked: true,
    localize: true
  });
  group.dataset.phobiaTags = "";
  imageRow.after(group);
}
