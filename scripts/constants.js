export const MODULE_ID = "daavy-addons";

export const SETTINGS = {
  TARGET_HELPER: "targetHelper",
  TARGET_HELPER_AUTOMATIONS: "targetHelperAutomations",
  TARGET_HELPER_AUTOMATIONS_HERO_POINT: "targetHelperAutomationsHeroPoint",
  TARGET_HELPER_AUTOMATIONS_NPC_ONLY: "targetHelperAutomationsNpcOnly",
  TARGET_HELPER_COLOR_SCHEME: "targetHelperColorScheme",
  TEMPLATE_HELPER: "templateHelper",
  TEMPLATE_HELPER_TARGETING: "templateHelperTargeting",
  REACH_CONTROL: "reachControl",
  REACH_DOORS: "reachControlDoors",
  REACH_DOOR_RANGE: "reachControlDoorRange",
  REACH_DOORS_AFFECT_GM: "reachControlDoorsAffectGM",
  REACH_STAIRWAYS: "reachControlStairways",
  REACH_STAIRWAY_RANGE: "reachControlStairwayRange",
  REACH_STAIRWAYS_AFFECT_GM: "reachControlStairwaysAffectGM",
  REACH_TOKENS: "reachControlTokens",
  REACH_TOKEN_RANGE: "reachControlTokenRange",
  PHOBIA_GUARD: "phobiaGuard",
  PHOBIA_GUARD_HIDE_TRIGGERS: "phobiaGuardHideTriggers"
};

export const TARGET_HELPER_COLOR_SCHEMES = {
  DEFAULT: "default",
  HIGH_CONTRAST: "highContrast"
};

export const TARGET_HELPER_NPC_ONLY_MODES = {
  DISABLED: "disabled",
  APPLICATION: "application",
  APPLICATION_AND_SAVE: "applicationAndSave",
  ALL: "all"
};

export const TEMPLATE_HELPER_TARGETING_MODES = {
  CONFIRMATION: "confirmation",
  ALLIES: "allies",
  ENEMIES: "enemies",
  ALL: "all"
};

export const SETTING_DEFINITIONS = {
  [SETTINGS.TARGET_HELPER]: {
    label: "TargetHelper",
    defaultValue: false
  },
  [SETTINGS.TARGET_HELPER_AUTOMATIONS]: {
    label: "TargetHelper.Automations.Enabled",
    defaultValue: false
  },
  [SETTINGS.TARGET_HELPER_AUTOMATIONS_HERO_POINT]: {
    label: "TargetHelper.Automations.HeroPoint",
    defaultValue: true
  },
  [SETTINGS.TARGET_HELPER_AUTOMATIONS_NPC_ONLY]: {
    label: "TargetHelper.Automations.NpcOnly",
    defaultValue: TARGET_HELPER_NPC_ONLY_MODES.DISABLED,
    choices: {
      [TARGET_HELPER_NPC_ONLY_MODES.DISABLED]: "DAAVY_ADDONS.Settings.TargetHelper.Automations.NpcOnly.Choices.Disabled",
      [TARGET_HELPER_NPC_ONLY_MODES.APPLICATION]: "DAAVY_ADDONS.Settings.TargetHelper.Automations.NpcOnly.Choices.Application",
      [TARGET_HELPER_NPC_ONLY_MODES.APPLICATION_AND_SAVE]: "DAAVY_ADDONS.Settings.TargetHelper.Automations.NpcOnly.Choices.ApplicationAndSave",
      [TARGET_HELPER_NPC_ONLY_MODES.ALL]: "DAAVY_ADDONS.Settings.TargetHelper.Automations.NpcOnly.Choices.All"
    }
  },
  [SETTINGS.TARGET_HELPER_COLOR_SCHEME]: {
    label: "TargetHelper.ColorScheme",
    defaultValue: TARGET_HELPER_COLOR_SCHEMES.DEFAULT,
    scope: "user",
    requiresReload: true,
    choices: {
      [TARGET_HELPER_COLOR_SCHEMES.DEFAULT]: "DAAVY_ADDONS.Settings.TargetHelper.ColorScheme.Choices.Default",
      [TARGET_HELPER_COLOR_SCHEMES.HIGH_CONTRAST]: "DAAVY_ADDONS.Settings.TargetHelper.ColorScheme.Choices.HighContrast"
    }
  },
  [SETTINGS.TEMPLATE_HELPER]: {
    label: "TemplateHelper",
    defaultValue: true
  },
  [SETTINGS.TEMPLATE_HELPER_TARGETING]: {
    label: "TemplateHelper.Targeting",
    defaultValue: TEMPLATE_HELPER_TARGETING_MODES.CONFIRMATION,
    scope: "user",
    choices: {
      [TEMPLATE_HELPER_TARGETING_MODES.CONFIRMATION]: "DAAVY_ADDONS.Settings.TemplateHelper.Targeting.Choices.Confirmation",
      [TEMPLATE_HELPER_TARGETING_MODES.ENEMIES]: "DAAVY_ADDONS.Settings.TemplateHelper.Targeting.Choices.Enemies",
      [TEMPLATE_HELPER_TARGETING_MODES.ALL]: "DAAVY_ADDONS.Settings.TemplateHelper.Targeting.Choices.All"
    }
  },
  [SETTINGS.REACH_CONTROL]: { label: "ReachControl", defaultValue: false },
  [SETTINGS.REACH_DOORS]: { label: "ReachControl.Doors.Enabled", defaultValue: true },
  [SETTINGS.REACH_DOOR_RANGE]: { label: "ReachControl.Doors.Range", defaultValue: 1 },
  [SETTINGS.REACH_DOORS_AFFECT_GM]: { label: "ReachControl.Doors.AffectGM", defaultValue: false },
  [SETTINGS.REACH_STAIRWAYS]: { label: "ReachControl.Stairways.Enabled", defaultValue: true },
  [SETTINGS.REACH_STAIRWAY_RANGE]: { label: "ReachControl.Stairways.Range", defaultValue: 1 },
  [SETTINGS.REACH_STAIRWAYS_AFFECT_GM]: { label: "ReachControl.Stairways.AffectGM", defaultValue: false },
  [SETTINGS.REACH_TOKENS]: { label: "ReachControl.Tokens.Enabled", defaultValue: true },
  [SETTINGS.REACH_TOKEN_RANGE]: { label: "ReachControl.Tokens.Range", defaultValue: 1 },
  [SETTINGS.PHOBIA_GUARD]: { label: "PhobiaGuard", defaultValue: false, requiresReload: true },
  [SETTINGS.PHOBIA_GUARD_HIDE_TRIGGERS]: {
    label: "PhobiaGuard.HideTriggers",
    defaultValue: false,
    scope: "user",
    requiresReload: true
  }
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
    label: "Door"
  },
  stairways: {
    enabledSetting: SETTINGS.REACH_STAIRWAYS,
    rangeSetting: SETTINGS.REACH_STAIRWAY_RANGE,
    gmSetting: SETTINGS.REACH_STAIRWAYS_AFFECT_GM,
    label: "Stairway"
  },
  tokens: {
    enabledSetting: SETTINGS.REACH_TOKENS,
    rangeSetting: SETTINGS.REACH_TOKEN_RANGE,
    label: "Token"
  }
};
