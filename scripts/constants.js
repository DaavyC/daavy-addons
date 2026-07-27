export const MODULE_ID = "daavy-addons";

export const SETTINGS = {
  TARGET_HELPER: "targetHelper",
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

export const REACH_CONTROL_RANGE_FLAG = "reachControlRange";

export const REACH_RANGE = {
  min: 0,
  max: 20,
  step: 1
};
