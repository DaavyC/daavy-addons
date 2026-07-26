export const MODULE_ID = "daavy-addons";

export const SETTINGS = {
  TARGET_HELPER_AUTOMATIONS: "targetHelperAutomations",
  TARGET_HELPER_NPCS_ONLY: "targetHelperNpcsOnly",
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

export const REACH_CONTROL_RANGE_FLAG = "reachControlRange";

export const REACH_RANGE = {
  min: 0,
  max: 20,
  step: 1
};

export const SAVE_TYPES = new Set(["fortitude", "reflex", "will"]);

export const DEGREE_OUTCOMES = [
  "criticalFailure",
  "failure",
  "success",
  "criticalSuccess"
];

export const SELECTORS = {
  renderedMessage: "[data-message-id]",
  targetRows: ".pf2e-toolbelt-target-targetRows .target-row",
  damageRows: ".pf2e-toolbelt-target-targetRows.pf2e-toolbelt-target-damage .target-row",
  saveAction: '[data-action="roll-save"]',
  spellDamageAction: '.card-buttons [data-action="spell-damage"]',
  damageApplication: ".damage-application[data-target-uuid]",
  npcTargetIcon: ".target-header .name > i.fa-ghost",
  actionButton: "button[data-action]"
};

export const LIMITS = {
  savePasses: 25,
  damagePasses: 50,
  spellDamageAttempts: 20,
  relatedDamageWindow: 8,
  attackLookupWindow: 10
};

export const DELAYS = {
  queue: [0, 150],
  existingMessages: [500, 1500],
  saveHook: 100,
  spellDamageInitial: 250,
  spellDamageRetry: 250,
  spellDamageAfterClick: 500,
  clickPause: 150,
  spellDamageThrottle: 400
};

export const ACTIONS_BY_MODE = {
  "basic-save": {
    criticalSuccess: { type: "block" },
    success: { type: "multiplier", multiplier: 0.5 },
    failure: { type: "multiplier", multiplier: 1 },
    criticalFailure: { type: "multiplier", multiplier: 2 }
  },
  "attack-roll": {
    criticalSuccess: { type: "multiplier", multiplier: 2 },
    success: { type: "multiplier", multiplier: 1 },
    failure: { type: "block" },
    criticalFailure: { type: "block" }
  }
};
