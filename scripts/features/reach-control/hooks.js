import { MODULE_ID, REACH_CONTROL_RANGE_FLAG, REACH_RANGE } from "../../constants.js";
import { asHTMLElement } from "../../dom.js";
import { isReachControlEnabled } from "../../settings.js";
import {
  captureTokenSelection,
  evaluateReach,
  isReachIntegrationEnabled,
  restoreTokenSelection
} from "./reach.js";

const WRAPPER_MARK = Symbol("daavy-addons-reach-control-wrapper");

let pendingTokenInteraction = null;

export function registerReachControlHooks() {
  Hooks.once("setup", installInteractionWrappers);
  Hooks.on("PreStairwayTeleport", handleStairwayTeleport);
  Hooks.on("renderPlaceableConfig", addPerObjectRangeField);
  Hooks.on("renderStairwayConfig", addPerObjectRangeField);
}

function installInteractionWrappers() {
  const DoorControl = foundry.canvas?.containers?.DoorControl ?? globalThis.DoorControl;
  wrapMethod(DoorControl?.prototype, "_onMouseDown", createDoorWrapper);
  wrapMethod(CONFIG.Token?.objectClass?.prototype, "_onClickLeft", createTokenClickWrapper);
  wrapMethod(CONFIG.Token?.objectClass?.prototype, "_onClickLeft2", createTokenDoubleClickWrapper);
}

function createDoorWrapper(original) {
  return function reachControlDoorMouseDown(event, ...args) {
    if (event?.button !== 0 || !isReachIntegrationEnabled("doors")) {
      return original.call(this, event, ...args);
    }

    const result = evaluateReach("doors", this);
    if (!result.allowed) return undefined;
    restoreTokenSelection(result.token);
    return original.call(this, event, ...args);
  };
}

function createTokenClickWrapper(original) {
  return function reachControlTokenClick(event, ...args) {
    if (!isReachIntegrationEnabled("tokens")) {
      pendingTokenInteraction = null;
    } else if (pendingTokenInteraction?.target !== this || Date.now() - pendingTokenInteraction.capturedAt > 500) {
      pendingTokenInteraction = {
        target: this,
        selection: captureTokenSelection({ excludedTokenId: this.id }),
        capturedAt: Date.now()
      };
    }
    return original.call(this, event, ...args);
  };
}

function createTokenDoubleClickWrapper(original) {
  return function reachControlTokenDoubleClick(event, ...args) {
    if (!isReachIntegrationEnabled("tokens")) {
      pendingTokenInteraction = null;
      return original.call(this, event, ...args);
    }

    const selection = pendingTokenInteraction?.target === this
      ? pendingTokenInteraction.selection
      : captureTokenSelection({ excludedTokenId: this.id });
    pendingTokenInteraction = null;

    const result = evaluateReach("tokens", this, selection);
    if (!result.allowed) return undefined;
    restoreTokenSelection(result.token);
    return original.call(this, event, ...args);
  };
}

function wrapMethod(prototype, methodName, createWrapper) {
  const original = prototype?.[methodName];
  if (typeof original !== "function" || original[WRAPPER_MARK]) return;

  const wrapped = createWrapper(original);
  Object.defineProperty(wrapped, WRAPPER_MARK, { value: true });
  prototype[methodName] = wrapped;
}

function handleStairwayTeleport(data) {
  if (!isReachIntegrationEnabled("stairways")) return true;

  const selection = captureTokenSelection({ tokenIds: data?.selectedTokenIds ?? [] });
  const target = data?.sourceData?.object ?? data?.sourceData;
  const result = evaluateReach("stairways", target, selection);
  restoreTokenSelection(result.token);
  return result.allowed;
}

function addPerObjectRangeField(app, html) {
  if (!game.user?.isGM || !isReachControlEnabled()) return;

  const source = app?.document ?? app?.object?._object ?? app?.object;
  const document = source?.document ?? source;
  const element = asHTMLElement(html);
  if (!document || !element || !isSupportedDocument(document)) return;
  if (element.querySelector("[data-reach-control-range]")) return;

  const input = element.ownerDocument.createElement("input");
  input.type = "number";
  input.name = `flags.${MODULE_ID}.${REACH_CONTROL_RANGE_FLAG}`;
  input.value = String(Number(document.getFlag?.(MODULE_ID, REACH_CONTROL_RANGE_FLAG)) || 0);
  input.min = String(REACH_RANGE.min);
  input.max = String(REACH_RANGE.max);
  input.step = String(REACH_RANGE.step);
  input.dataset.dtype = "Number";

  const group = foundry.applications.fields.createFormGroup({
    input,
    label: "DAAVY_ADDONS.ReachControl.PerObjectRange.Label",
    hint: "DAAVY_ADDONS.ReachControl.PerObjectRange.Hint",
    localize: true
  });
  group.dataset.reachControlRange = "";

  const anchor = element.querySelector("footer.form-footer")
    ?? element.querySelector('button[type="submit"]');
  anchor?.before(group);
  app.setPosition?.();
}

function isSupportedDocument(document) {
  return ["Token", "Stairway"].includes(document.documentName)
    || (document.documentName === "Wall" && document.door > 0);
}
