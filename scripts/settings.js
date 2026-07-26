import {
  MODULE_ID,
  REACH_RANGE,
  SETTINGS
} from "./constants.js";
import { asHTMLElement } from "./dom.js";
import { isTargetHelperAutomationsAvailable } from "./features/target-helper/settings.js";

const SETTING_DEFINITIONS = {
  [SETTINGS.TARGET_HELPER_AUTOMATIONS]: { label: "TargetHelperAutomations", defaultValue: false },
  [SETTINGS.TARGET_HELPER_NPCS_ONLY]: { label: "TargetHelperAutomations.NpcsOnly", defaultValue: false },
  [SETTINGS.REACH_CONTROL]: { label: "ReachControl", defaultValue: false },
  [SETTINGS.REACH_DOORS]: { label: "ReachControl.Doors.Enabled", defaultValue: true },
  [SETTINGS.REACH_DOOR_RANGE]: { label: "ReachControl.Doors.Range", defaultValue: 1 },
  [SETTINGS.REACH_DOORS_AFFECT_GM]: { label: "ReachControl.Doors.AffectGM", defaultValue: false },
  [SETTINGS.REACH_STAIRWAYS]: { label: "ReachControl.Stairways.Enabled", defaultValue: true },
  [SETTINGS.REACH_STAIRWAY_RANGE]: { label: "ReachControl.Stairways.Range", defaultValue: 1 },
  [SETTINGS.REACH_STAIRWAYS_AFFECT_GM]: { label: "ReachControl.Stairways.AffectGM", defaultValue: false },
  [SETTINGS.REACH_TOKENS]: { label: "ReachControl.Tokens.Enabled", defaultValue: true },
  [SETTINGS.REACH_TOKEN_RANGE]: { label: "ReachControl.Tokens.Range", defaultValue: 1 }
};

const REACH_SECTIONS = {
  Doors: [
    SETTINGS.REACH_DOORS,
    SETTINGS.REACH_DOOR_RANGE,
    SETTINGS.REACH_DOORS_AFFECT_GM
  ],
  Stairways: [
    SETTINGS.REACH_STAIRWAYS,
    SETTINGS.REACH_STAIRWAY_RANGE,
    SETTINGS.REACH_STAIRWAYS_AFFECT_GM
  ],
  Tokens: [
    SETTINGS.REACH_TOKENS,
    SETTINGS.REACH_TOKEN_RANGE
  ]
};

export function registerSettings() {
  for (const [key, { label, defaultValue }] of Object.entries(SETTING_DEFINITIONS)) {
    const type = typeof defaultValue === "boolean" ? Boolean : Number;
    game.settings.register(MODULE_ID, key, {
      name: `DAAVY_ADDONS.Settings.${label}.Name`,
      hint: `DAAVY_ADDONS.Settings.${label}.Hint`,
      scope: "world",
      config: true,
      type,
      default: defaultValue,
      ...(type === Number ? { range: REACH_RANGE } : {})
    });
  }
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function isReachControlEnabled() {
  return getSetting(SETTINGS.REACH_CONTROL) === true;
}

export function organizeSettingsConfig(html) {
  const container = asHTMLElement(html);
  if (!container || container.querySelector('[data-settings-group="Features"]')) return;

  const documentRef = container.ownerDocument ?? document;
  const featureRows = [SETTINGS.TARGET_HELPER_AUTOMATIONS, SETTINGS.REACH_CONTROL]
    .map((key) => findSettingRow(container, key))
    .filter(Boolean);
  if (!featureRows.length) return;

  const featuresGroup = createGroup(documentRef, "Features");
  featureRows[0].replaceWith(featuresGroup);
  appendRows(featuresGroup, featureRows);
  configureTargetHelperAvailability(container);

  const targetHelperRow = findSettingRow(container, SETTINGS.TARGET_HELPER_NPCS_ONLY);
  if (targetHelperRow) {
    const targetHelperGroup = createGroup(documentRef, "TargetHelperAutomations");
    targetHelperRow.replaceWith(targetHelperGroup);
    appendRows(targetHelperGroup, [targetHelperRow]);
    configureVisibility(container, SETTINGS.TARGET_HELPER_AUTOMATIONS, [targetHelperGroup]);
  }

  const sectionRows = Object.fromEntries(
    Object.entries(REACH_SECTIONS).map(([section, keys]) => [
      section,
      keys.map((key) => findSettingRow(container, key)).filter(Boolean)
    ])
  );
  const firstReachRow = Object.values(sectionRows).flat()[0];
  if (!firstReachRow) return;

  const reachGroup = createGroup(documentRef, "ReachControl");
  firstReachRow.replaceWith(reachGroup);

  for (const [sectionKey, rows] of Object.entries(sectionRows)) {
    if (!rows.length) continue;
    const section = createSection(documentRef, sectionKey);
    appendRows(section, rows);
    reachGroup.appendChild(section);
  }

  configureVisibility(container, SETTINGS.REACH_CONTROL, [reachGroup]);
  configureVisibility(container, SETTINGS.REACH_DOORS, [
    findSettingRow(container, SETTINGS.REACH_DOOR_RANGE),
    findSettingRow(container, SETTINGS.REACH_DOORS_AFFECT_GM)
  ]);
  configureVisibility(container, SETTINGS.REACH_STAIRWAYS, [
    findSettingRow(container, SETTINGS.REACH_STAIRWAY_RANGE),
    findSettingRow(container, SETTINGS.REACH_STAIRWAYS_AFFECT_GM)
  ]);
  configureVisibility(container, SETTINGS.REACH_TOKENS, [
    findSettingRow(container, SETTINGS.REACH_TOKEN_RANGE)
  ]);
}

function createGroup(documentRef, groupKey) {
  const group = documentRef.createElement("div");
  const title = documentRef.createElement("h3");
  const titleId = `${MODULE_ID}-settings-group-${groupKey}`;

  group.className = "daavy-addons-settings-group";
  group.dataset.settingsGroup = groupKey;
  group.setAttribute("role", "group");
  group.setAttribute("aria-labelledby", titleId);

  title.id = titleId;
  title.className = "daavy-addons-settings-group-title";
  title.textContent = game.i18n.localize(`DAAVY_ADDONS.Settings.Groups.${groupKey}`);
  group.appendChild(title);
  return group;
}

function createSection(documentRef, sectionKey) {
  const section = documentRef.createElement("section");
  const title = documentRef.createElement("h4");
  title.className = "daavy-addons-settings-section-title";
  title.textContent = game.i18n.localize(`DAAVY_ADDONS.Settings.Sections.${sectionKey}`);
  section.className = "daavy-addons-settings-section";
  section.appendChild(title);
  return section;
}

function appendRows(target, rows) {
  for (const row of rows) {
    row.classList.add("daavy-addons-settings-row");
    target.appendChild(row);
  }
}

function configureTargetHelperAvailability(container) {
  const row = findSettingRow(container, SETTINGS.TARGET_HELPER_AUTOMATIONS);
  const toggle = row?.querySelector('input[type="checkbox"]');
  if (!toggle) return;

  const available = isTargetHelperAutomationsAvailable();
  toggle.disabled = !available;
  if (!available) toggle.checked = false;
  if (available) return;

  const hint = row.querySelector(".hint");
  if (!hint) return;

  const warning = (container.ownerDocument ?? document).createElement("span");
  warning.className = "daavy-addons-target-helper-warning";
  warning.textContent = game.i18n.localize("DAAVY_ADDONS.Settings.TargetHelperAutomations.UnavailableHint");
  hint.appendChild(warning);
}

function configureVisibility(container, controllerKey, targets) {
  const toggle = findSettingRow(container, controllerKey)?.querySelector('input[type="checkbox"]');
  const validTargets = targets.filter(Boolean);
  if (!validTargets.length) return;

  const updateVisibility = () => {
    const visible = toggle?.checked ?? getSetting(controllerKey) === true;
    for (const target of validTargets) target.hidden = !visible;
  };

  updateVisibility();
  toggle?.addEventListener("change", updateVisibility);
}

function findSettingRow(container, key) {
  const settingId = `${MODULE_ID}.${key}`;
  return container.querySelector(`[data-setting-id="${settingId}"]`)?.closest(".form-group")
    ?? container.querySelector(`[id$="${settingId}"]`)?.closest(".form-group")
    ?? null;
}
