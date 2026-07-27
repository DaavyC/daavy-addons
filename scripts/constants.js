export const MODULE_ID = "daavy-addons";

export const SETTINGS = {
  TARGET_HELPER: "targetHelper",
  TARGET_HELPER_AUTOMATIONS: "targetHelperAutomations",
  REACH_CONTROL: "reachControl",
  REACH_DOORS: "reachControlDoors",
  REACH_DOOR_RANGE: "reachControlDoorRange",
  REACH_DOORS_AFFECT_GM: "reachControlDoorsAffectGM",
  REACH_STAIRWAYS: "reachControlStairways",
  REACH_STAIRWAY_RANGE: "reachControlStairwayRange",
  REACH_STAIRWAYS_AFFECT_GM: "reachControlStairwaysAffectGM",
  REACH_TOKENS: "reachControlTokens",
  REACH_TOKEN_RANGE: "reachControlTokenRange"
};

export const TARGET_HELPER_FLAG = "targetHelper";
export const TARGET_HELPER_DAMAGE_RESULT_FLAG = "targetHelperDamageResult";
export const TARGET_HELPER_DAMAGE_UNDO_REQUEST = "targetHelperDamageUndo";
export const TARGET_HELPER_SAVE_RESULT_FLAG = "targetHelperSaveResult";
export const TARGET_HELPER_SOCKET = `module.${MODULE_ID}`;

export const TARGET_HELPER_SAVE_TYPES = new Set(["fortitude", "reflex", "will"]);
export const TARGET_HELPER_SAVE_OUTCOMES = [
  "criticalFailure",
  "failure",
  "success",
  "criticalSuccess"
];

export const TARGET_HELPER_DAMAGE_UPDATE_PATHS = new Set([
  "system.attributes.hp.temp",
  "system.attributes.hp.sp.value",
  "system.attributes.hp.value"
]);

export const TARGET_HELPER_DAMAGE_ACTIONS = [
  { key: "Damage", icon: '<i class="fa-solid fa-heart-crack fa-fw" inert></i>', multiplier: 1 },
  { key: "Half", icon: '<i class="fa-solid fa-heart-crack fa-fw" inert></i>', multiplier: 0.5 },
  { key: "Double", icon: '<img src="systems/pf2e/icons/damage/double.svg" alt="">', multiplier: 2 },
  { key: "Block", icon: '<i class="fa-solid fa-shield-blank fa-fw" inert></i>', multiplier: 0 }
];

export const TARGET_HELPER_BASIC_SAVE_MULTIPLIERS = {
  criticalFailure: 2,
  failure: 1,
  success: 0.5,
  criticalSuccess: 0
};

export const REACH_CONTROL_RANGE_FLAG = "reachControlRange";

export const REACH_RANGE = {
  min: 0,
  max: 20,
  step: 1
};

export const REACH_CONTROL_WRAPPER_MARK = Symbol("daavy-addons-reach-control-wrapper");

export const REACH_TYPES = {
  doors: {
    enabledSetting: SETTINGS.REACH_DOORS,
    rangeSetting: SETTINGS.REACH_DOOR_RANGE,
    gmSetting: SETTINGS.REACH_DOORS_AFFECT_GM,
    label: "Door",
    warnWhenMissingToken: false
  },
  stairways: {
    enabledSetting: SETTINGS.REACH_STAIRWAYS,
    rangeSetting: SETTINGS.REACH_STAIRWAY_RANGE,
    gmSetting: SETTINGS.REACH_STAIRWAYS_AFFECT_GM,
    label: "Stairway",
    warnWhenMissingToken: true
  },
  tokens: {
    enabledSetting: SETTINGS.REACH_TOKENS,
    rangeSetting: SETTINGS.REACH_TOKEN_RANGE,
    label: "Token",
    warnWhenMissingToken: true
  }
};

export const FEEDBACK_I18N_PREFIX = "DAAVY_ADDONS.Feedback";
export const FEEDBACK_ACTIONS_CLASS = "daavy-addons-settings-actions";
