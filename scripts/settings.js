import {
  MODULE_ID,
  REACH_RANGE,
  REACH_TYPES,
  SETTINGS
} from "./constants.js";
import { getSetting } from "./utils.js";

const SETTING_DEFINITIONS = {
  [SETTINGS.TARGET_HELPER]: {
    label: "TargetHelper",
    defaultValue: false
  },
  [SETTINGS.TARGET_HELPER_AUTOMATIONS]: {
    label: "TargetHelper.Automations.Enabled",
    defaultValue: false
  },
  [SETTINGS.TARGET_HELPER_AUTOMATIONS_NPC_ONLY]: {
    label: "TargetHelper.Automations.NpcOnly",
    defaultValue: false
  },
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

export function registerSettings() {
  for (const [key, { label, defaultValue }] of Object.entries(SETTING_DEFINITIONS)) {
    const type = typeof defaultValue === "boolean" ? Boolean : Number;
    game.settings.register(MODULE_ID, key, {
      name: `DAAVY_ADDONS.Settings.${label}.Name`,
      hint: `DAAVY_ADDONS.Settings.${label}.Hint`,
      scope: "world",
      config: !key.startsWith("targetHelper") || game.system.id === "pf2e",
      type,
      default: defaultValue,
      ...(type === Number ? { range: REACH_RANGE } : {})
    });
  }
}

export async function checkIncompatibleSettings() {
  if (!game.user.isActiveGM || getSetting(SETTINGS.TARGET_HELPER) !== true) return;

  const conflicts = [
    externalSettingMatches("pf2e-toolbelt", "targetHelper.enabled", (value) => value === true) && {
      namespace: "pf2e-toolbelt",
      key: "targetHelper.enabled",
      value: false,
      label: "Toolbelt"
    },
    (
      getSetting(SETTINGS.TARGET_HELPER_AUTOMATIONS) === true
      && externalSettingMatches(
        "xdy-pf2e-workbench",
        "autoRollDamageAllow",
        (value) => value !== "none"
      )
    ) && {
      namespace: "xdy-pf2e-workbench",
      key: "autoRollDamageAllow",
      value: "none",
      label: "Workbench"
    }
  ].filter(Boolean);
  if (!conflicts.length) return;

  const i18n = "DAAVY_ADDONS.Settings.Incompatibilities";
  try {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${i18n}.Title`) },
      content: `
        <p>${game.i18n.localize(`${i18n}.Content`)}</p>
        <ul>${conflicts.map(({ label }) => `<li>${game.i18n.localize(`${i18n}.${label}`)}</li>`).join("")}</ul>
      `,
      yes: { label: game.i18n.localize(`${i18n}.Disable`) },
      no: { label: game.i18n.localize(`${i18n}.Cancel`) },
      rejectClose: false,
      modal: true
    });
    if (!confirmed) return;

    const results = await Promise.allSettled(
      conflicts.map(({ namespace, key, value }) => game.settings.set(namespace, key, value))
    );
    let failures = 0;
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failures += 1;
        const { namespace, key } = conflicts[index];
        console.error(`${MODULE_ID} | Failed to disable incompatible setting ${namespace}.${key}`, result.reason);
      }
    });
    if (failures) {
      ui.notifications.error(game.i18n.localize(`${i18n}.Error`));
    }
    if (failures < results.length) {
      await foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });
    }
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to resolve incompatible settings`, error);
    ui.notifications.error(game.i18n.localize(`${i18n}.Error`));
  }
}

export function organizeSettingsConfig(html) {
  if (!html || html.querySelector('[data-settings-group="Features"]')) return;

  const documentRef = html.ownerDocument;
  const featureRows = [SETTINGS.TARGET_HELPER, SETTINGS.REACH_CONTROL]
    .map((key) => findSettingRow(html, key))
    .filter(Boolean);
  if (!featureRows.length) return;

  const featuresGroup = createGroup(documentRef, "Features");
  featureRows[0].replaceWith(featuresGroup);
  appendRows(featuresGroup, featureRows);

  const automationRow = findSettingRow(html, SETTINGS.TARGET_HELPER_AUTOMATIONS);
  if (automationRow) {
    const targetHelperGroup = createGroup(documentRef, "TargetHelper");
    appendRows(targetHelperGroup, [automationRow]);
    const npcOnlyRow = findSettingRow(html, SETTINGS.TARGET_HELPER_AUTOMATIONS_NPC_ONLY);
    const automationSection = npcOnlyRow ? documentRef.createElement("section") : null;
    if (automationSection) {
      const title = documentRef.createElement("h4");
      automationSection.className = "daavy-addons-settings-section";
      title.className = "daavy-addons-settings-section-title";
      title.textContent = game.i18n.localize("DAAVY_ADDONS.Settings.Sections.Automations");
      automationSection.appendChild(title);
      appendRows(automationSection, [npcOnlyRow]);
      targetHelperGroup.appendChild(automationSection);
    }
    featuresGroup.after(targetHelperGroup);
    configureVisibility(html, SETTINGS.TARGET_HELPER, [targetHelperGroup]);
    configureVisibility(html, SETTINGS.TARGET_HELPER_AUTOMATIONS, [automationSection]);
  }

  const sectionRows = Object.fromEntries(
    Object.entries(REACH_TYPES).map(([type, config]) => [
      type[0].toUpperCase() + type.slice(1),
      [config.enabledSetting, config.rangeSetting, config.gmSetting]
        .filter(Boolean)
        .map((key) => findSettingRow(html, key))
        .filter(Boolean)
    ])
  );
  const firstReachRow = Object.values(sectionRows).flat()[0];
  if (!firstReachRow) return;

  const reachGroup = createGroup(documentRef, "ReachControl");
  firstReachRow.replaceWith(reachGroup);

  for (const [sectionKey, rows] of Object.entries(sectionRows)) {
    if (!rows.length) continue;
    const section = documentRef.createElement("section");
    const title = documentRef.createElement("h4");
    title.className = "daavy-addons-settings-section-title";
    title.textContent = game.i18n.localize(`DAAVY_ADDONS.Settings.Sections.${sectionKey}`);
    section.className = "daavy-addons-settings-section";
    section.appendChild(title);
    appendRows(section, rows);
    reachGroup.appendChild(section);
  }

  configureVisibility(html, SETTINGS.REACH_CONTROL, [reachGroup]);
  for (const config of Object.values(REACH_TYPES)) {
    configureVisibility(html, config.enabledSetting, [config.rangeSetting, config.gmSetting]
      .filter(Boolean)
      .map((key) => findSettingRow(html, key)));
  }
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

function appendRows(target, rows) {
  for (const row of rows) {
    row.classList.add("daavy-addons-settings-row");
    target.appendChild(row);
  }
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

function externalSettingMatches(namespace, key, predicate) {
  return game.modules.get(namespace)?.active === true
    && game.settings.settings.has(`${namespace}.${key}`)
    && predicate(game.settings.get(namespace, key));
}
