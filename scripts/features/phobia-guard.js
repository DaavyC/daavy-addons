import { MODULE_ID, SETTINGS } from "../constants.js";
import { getSetting } from "../utils.js";

const PHOBIA_TRIGGER_FLAG = "phobiaTrigger";
const PHOBIA_TRIGGER_PATH = `flags.${MODULE_ID}.${PHOBIA_TRIGGER_FLAG}`;
const PHOBIA_TRIGGER_IMAGE = `modules/${MODULE_ID}/assets/phobia-trigger.svg`;
const PHOBIA_TRIGGER_COLOR = [0.55, 0.85, 0.65, 1];

let triggerFilter;

function isPhobiaGuardEnabled() {
  return getSetting(SETTINGS.PHOBIA_GUARD) === true;
}

function areTriggersHidden() {
  return isPhobiaGuardEnabled() && getSetting(SETTINGS.PHOBIA_GUARD_HIDE_TRIGGERS) === true;
}

function isPhobiaTrigger(token) {
  return token.getFlag(MODULE_ID, PHOBIA_TRIGGER_FLAG) === true;
}

function shouldHideTrigger(tokenDocument) {
  return isPhobiaTrigger(tokenDocument) && areTriggersHidden();
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
  if (!foundry.utils.hasProperty(changes, PHOBIA_TRIGGER_PATH) || !areTriggersHidden()) return;
  token.reset();
  token.object?.renderFlags.set({ redraw: true });
  if (!token.combatant) return;
  token.combatant.reset();
  ui.combat.render();
}

export function addPhobiaTriggerField(app, html) {
  if (!isPhobiaGuardEnabled() || html.querySelector("[data-phobia-trigger]")) return;
  const imageRow = html.querySelector('[name="texture.src"]')?.closest(".form-group");
  if (!imageRow) return;

  const { createCheckboxInput, createFormGroup } = foundry.applications.fields;
  const group = createFormGroup({
    input: createCheckboxInput({ name: PHOBIA_TRIGGER_PATH, value: isPhobiaTrigger(app.token) }),
    label: "DAAVY_ADDONS.PhobiaGuard.TokenConfig.Label",
    hint: "DAAVY_ADDONS.PhobiaGuard.TokenConfig.Hint",
    rootId: app.id,
    localize: true
  });
  group.dataset.phobiaTrigger = "";
  imageRow.after(group);
}
