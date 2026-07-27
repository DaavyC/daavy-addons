import {
  MODULE_ID,
  REACH_CONTROL_RANGE_FLAG,
  REACH_CONTROL_WRAPPER_MARK,
  REACH_RANGE,
  REACH_TYPES,
  SETTINGS
} from "../constants.js";
import { getSetting } from "../utils.js";

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
  if (typeof original !== "function" || original[REACH_CONTROL_WRAPPER_MARK]) return;

  const wrapped = createWrapper(original);
  Object.defineProperty(wrapped, REACH_CONTROL_WRAPPER_MARK, { value: true });
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
  if (!game.user?.isGM || getSetting(SETTINGS.REACH_CONTROL) !== true) return;

  const source = app?.document ?? app?.object?._object ?? app?.object;
  const document = source?.document ?? source;
  if (
    !document
    || !html
    || !(
      ["Token", "Stairway"].includes(document.documentName)
      || (document.documentName === "Wall" && document.door > 0)
    )
  ) return;
  if (html.querySelector("[data-reach-control-range]")) return;

  const input = html.ownerDocument.createElement("input");
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

  const anchor = html.querySelector("footer.form-footer")
    ?? html.querySelector('button[type="submit"]');
  anchor?.before(group);
  app.setPosition?.();
}

function isReachIntegrationEnabled(type) {
  const config = REACH_TYPES[type];
  return Boolean(
    config
    && getSetting(SETTINGS.REACH_CONTROL) === true
    && getSetting(config.enabledSetting)
  );
}

function captureTokenSelection({ excludedTokenId = null, tokenIds = null } = {}) {
  const tokens = Array.isArray(tokenIds)
    ? tokenIds.map((id) => canvas.tokens?.placeables?.find((token) => token.id === id)).filter(Boolean)
    : [...(canvas.tokens?.controlled ?? [])];

  if (tokens.length > 1) return { controlledCount: tokens.length, token: null };

  if (tokens.length === 1) {
    const token = tokens[0];
    return {
      controlledCount: 1,
      token: token.id !== excludedTokenId ? token : null
    };
  }

  return {
    controlledCount: 0,
    token: getOwnedFallbackToken(excludedTokenId)
  };
}

function evaluateReach(type, target, selection = captureTokenSelection()) {
  const config = REACH_TYPES[type];
  if (!config || !isReachIntegrationEnabled(type)) return { allowed: true, token: selection.token };

  if (
    game.user?.isGM
    && (!config.gmSetting || !getSetting(config.gmSetting) || selection.controlledCount !== 1)
  ) {
    return { allowed: true, token: selection.token };
  }

  if (selection.controlledCount > 1) {
    notify("DAAVY_ADDONS.ReachControl.Warnings.MultipleTokens");
    return { allowed: false, token: null };
  }

  if (!selection.token) {
    if (config.warnWhenMissingToken) notify("DAAVY_ADDONS.ReachControl.Warnings.NoToken", { placeable: localizePlaceable(config.label) });
    return { allowed: false, token: null };
  }

  const allowed = getDistanceToTarget(type, selection.token, target) <= getConfiguredRange(type, target);

  if (!allowed) {
    notify("DAAVY_ADDONS.ReachControl.Warnings.OutOfReach", {
      placeable: localizePlaceable(config.label),
      tokenName: selection.token?.actor?.name
        ?? selection.token?.name
        ?? selection.token?.document?.name
        ?? ""
    });
  }

  return { allowed, token: selection.token };
}

function getConfiguredRange(type, target) {
  const document = getDocument(target);
  const override = Number(document?.getFlag?.(MODULE_ID, REACH_CONTROL_RANGE_FLAG) ?? 0);
  if (Number.isFinite(override) && override > 0) return override;

  const configured = Number(getSetting(REACH_TYPES[type].rangeSetting));
  return Number.isFinite(configured) ? Math.max(0, configured) : 0;
}

function getDistanceToTarget(type, token, target) {
  const tokenDocument = getDocument(token);
  const targetDocument = getDocument(target);
  const scene = targetDocument?.parent ?? tokenDocument?.parent ?? canvas.scene;
  const gridSize = Number(scene?.grid?.size ?? scene?.dimensions?.size ?? canvas.grid?.size);
  const gridDistance = Number(scene?.grid?.distance ?? scene?.dimensions?.distance ?? canvas.dimensions?.distance);
  const tokenRectangle = getTokenRectangle(tokenDocument, gridSize);
  if (!tokenRectangle) return Infinity;

  const horizontalPixels = getHorizontalDistance(type, targetDocument, tokenRectangle, gridSize);
  const verticalDistance = getVerticalDistance(tokenDocument, targetDocument);

  if (!(gridSize > 0) || !(gridDistance > 0)) return Infinity;
  return Math.hypot(horizontalPixels / gridSize, verticalDistance / gridDistance);
}

function restoreTokenSelection(token) {
  if (!token || token.controlled) return;
  const current = canvas.tokens?.placeables?.find((placeable) => placeable.id === token.id);
  current?.control?.({ releaseOthers: true });
}

function getOwnedFallbackToken(excludedTokenId) {
  const placeables = canvas.tokens?.placeables ?? [];
  const characterToken = placeables.find((token) => token.id !== excludedTokenId && token.document?.actorId === game.user?.character?.id);
  if (characterToken) return characterToken;

  return placeables.find((token) => token.id !== excludedTokenId && token.document?.isOwner === true) ?? null;
}

function getHorizontalDistance(type, targetDocument, tokenRectangle, gridSize) {
  if (!(gridSize > 0) || !targetDocument) return Infinity;

  if (type === "doors") {
    const coordinates = targetDocument.c;
    if (!Array.isArray(coordinates) || coordinates.length !== 4) return Infinity;
    return segmentToRectangleDistance({
      a: { x: coordinates[0], y: coordinates[1] },
      b: { x: coordinates[2], y: coordinates[3] }
    }, tokenRectangle);
  }

  if (type === "tokens") {
    const targetRectangle = getTokenRectangle(targetDocument, gridSize);
    return targetRectangle ? rectangleToRectangleDistance(tokenRectangle, targetRectangle) : Infinity;
  }

  const x = Number(targetDocument.x);
  const y = Number(targetDocument.y);
  return Number.isFinite(x) && Number.isFinite(y)
    ? pointToRectangleDistance({ x, y }, tokenRectangle)
    : Infinity;
}

function getTokenRectangle(document, gridSize) {
  const x = Number(document?.x);
  const y = Number(document?.y);
  const width = Number(document?.width);
  const height = Number(document?.height);
  if (![x, y, width, height, gridSize].every(Number.isFinite) || !(gridSize > 0)) return null;
  return { x, y, width: width * gridSize, height: height * gridSize };
}

function getVerticalDistance(sourceDocument, targetDocument) {
  const sourceRange = getElevationRange(sourceDocument);
  const targetRange = getElevationRange(targetDocument);
  if (sourceRange.top < targetRange.bottom) return targetRange.bottom - sourceRange.top;
  if (targetRange.top < sourceRange.bottom) return sourceRange.bottom - targetRange.top;
  return 0;
}

function getElevationRange(document) {
  const levelsRange = readFlagRange(document?.flags?.levels, "rangeBottom", "rangeTop");
  if (levelsRange) return levelsRange;

  const wallRange = readFlagRange(document?.flags?.["wall-height"], "bottom", "top");
  if (wallRange) return wallRange;

  const elevationValue = Number(document?.elevation);
  const elevation = Number.isFinite(elevationValue) ? elevationValue : 0;
  const depth = Number(document?.depth ?? document?.object?.document?.depth);
  return normalizeRange(elevation, elevation + (Number.isFinite(depth) ? Math.max(0, depth) : 0));
}

function readFlagRange(flags, bottomKey, topKey) {
  const hasBottom = flags?.[bottomKey] !== undefined && flags[bottomKey] !== null && flags[bottomKey] !== "";
  const hasTop = flags?.[topKey] !== undefined && flags[topKey] !== null && flags[topKey] !== "";
  if (!hasBottom && !hasTop) return null;

  const bottom = hasBottom ? Number(flags[bottomKey]) : -Infinity;
  const top = hasTop ? Number(flags[topKey]) : Infinity;
  if (Number.isNaN(bottom) || Number.isNaN(top)) return null;
  return normalizeRange(bottom, top);
}

function normalizeRange(first, second) {
  return first <= second ? { bottom: first, top: second } : { bottom: second, top: first };
}

function getDocument(source) {
  return source?.wall?.document ?? source?.document ?? source;
}

function notify(key, data = {}) {
  ui.notifications?.warn(game.i18n.format(key, data));
}

function localizePlaceable(label) {
  return game.i18n.localize(`DAAVY_ADDONS.ReachControl.Placeables.${label}`);
}

function normalizeRectangle(rectangle) {
  const left = Math.min(rectangle.x, rectangle.x + rectangle.width);
  const right = Math.max(rectangle.x, rectangle.x + rectangle.width);
  const top = Math.min(rectangle.y, rectangle.y + rectangle.height);
  const bottom = Math.max(rectangle.y, rectangle.y + rectangle.height);
  return { left, right, top, bottom };
}

function pointToRectangleDistance(point, rectangle) {
  const { left, right, top, bottom } = normalizeRectangle(rectangle);
  const dx = Math.max(left - point.x, 0, point.x - right);
  const dy = Math.max(top - point.y, 0, point.y - bottom);
  return Math.hypot(dx, dy);
}

function rectangleToRectangleDistance(first, second) {
  const a = normalizeRectangle(first);
  const b = normalizeRectangle(second);
  const dx = Math.max(a.left - b.right, b.left - a.right, 0);
  const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
  return Math.hypot(dx, dy);
}

function segmentToRectangleDistance(segment, rectangle) {
  const bounds = normalizeRectangle(rectangle);
  const corners = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom }
  ];
  const edges = corners.map((corner, index) => [corner, corners[(index + 1) % corners.length]]);

  if (
    pointIsInsideRectangle(segment.a, bounds) ||
    pointIsInsideRectangle(segment.b, bounds) ||
    edges.some(([start, end]) => foundry.utils.lineSegmentIntersects(segment.a, segment.b, start, end))
  ) return 0;

  return Math.min(
    pointToRectangleDistance(segment.a, rectangle),
    pointToRectangleDistance(segment.b, rectangle),
    ...corners.map((corner) => {
      const closest = foundry.utils.closestPointToSegment(corner, segment.a, segment.b);
      return Math.hypot(corner.x - closest.x, corner.y - closest.y);
    })
  );
}

function pointIsInsideRectangle(point, bounds) {
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}
