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

export const REACH_RANGE = {
  min: 0,
  max: 20,
  step: 1
};

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
