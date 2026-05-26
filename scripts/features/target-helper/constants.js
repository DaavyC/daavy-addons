export const MODULE_ID = "daavy-addons";
export const TARGET_HELPER_AUTOMATIONS_SETTING = "targetHelperAutomations";

export const SAVE_TYPES = new Set(["fortitude", "reflex", "will"]);

export const SELECTORS = {
  renderedMessage: "[data-message-id]",
  targetRows: ".pf2e-toolbelt-target-targetRows .target-row",
  damageRows: ".pf2e-toolbelt-target-targetRows.pf2e-toolbelt-target-damage .target-row",
  saveAction: '[data-action="roll-save"]',
  spellDamageAction: '.card-buttons [data-action="spell-damage"]',
  damageApplication: ".damage-application[data-target-uuid]",
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
