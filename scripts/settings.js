import {
  MODULE_ID,
  REACH_RANGE,
  REACH_TYPES,
  SETTING_DEFINITIONS,
  SETTINGS,
} from "./constants.js";
import { getGlobalTagChoices } from "./features/phobia-guard.js";
import { getSetting } from "./utils.js";

const INCOMPATIBLE_SETTINGS = [
  {
    namespace: "pf2e-toolbelt",
    key: "targetHelper.enabled",
    value: false,
    label: "Toolbelt",
    matches: (enabled) => enabled === true
  },
  {
    namespace: "xdy-pf2e-workbench",
    key: "autoRollDamageAllow",
    value: "none",
    label: "Workbench",
    requiresSetting: SETTINGS.TARGET_HELPER_AUTOMATIONS,
    matches: (permission) => permission !== "none"
  }
];

function createTagsField(globalTagChoices) {
  const { SetField, StringField } = foundry.data.fields;
  return new SetField(new StringField({
    blank: false,
    ...(globalTagChoices ? { choices: getGlobalTagChoices } : {})
  }));
}

function resolveSettingType(defaultValue, globalTagChoices) {
  if (Array.isArray(defaultValue)) return createTagsField(globalTagChoices);
  if (typeof defaultValue === "boolean") return Boolean;
  if (typeof defaultValue === "number") return Number;
  if (typeof defaultValue === "object") return new foundry.data.fields.ObjectField();
  return String;
}

export function registerSettings() {
  for (const [key, { label, defaultValue, scope = "world", globalTagChoices, ...options }] of Object.entries(SETTING_DEFINITIONS)) {
    const type = resolveSettingType(defaultValue, globalTagChoices);
    game.settings.register(MODULE_ID, key, {
      name: `DAAVY_ADDONS.Settings.${label}.Name`,
      hint: `DAAVY_ADDONS.Settings.${label}.Hint`,
      scope,
      config: ![SETTINGS.TARGET_HELPER, SETTINGS.TEMPLATE_HELPER].some((prefix) => key.startsWith(prefix))
        || game.system.id === "pf2e",
      type,
      default: defaultValue,
      ...options,
      ...(type === Number ? { range: REACH_RANGE } : {})
    });
  }
}

export function handleSettingUpdate(setting) {
  if (
    [
      `${MODULE_ID}.${SETTINGS.TARGET_HELPER}`,
      `${MODULE_ID}.${SETTINGS.TARGET_HELPER_AUTOMATIONS}`,
      ...INCOMPATIBLE_SETTINGS.map(({ namespace, key }) => `${namespace}.${key}`)
    ].includes(setting?.key)
  ) {
    void checkIncompatibleSettings();
  }
}

export function organizeSettingsConfig(html) {
  if (!html || html.querySelector("[data-settings-group]")) return;

  organizePhobiaGuardSettings(html);

  const documentRef = html.ownerDocument;
  const featureRows = [
    SETTINGS.TARGET_HELPER,
    SETTINGS.REACH_CONTROL,
    SETTINGS.SCENE_DEFAULTS,
    SETTINGS.TOKEN_SYNC,
    SETTINGS.PHOBIA_GUARD
  ]
    .map((key) => findSettingRow(html, key))
    .filter(Boolean);
  if (!featureRows.length) return;

  const featuresGroup = createGroup(documentRef, "Features");
  featureRows[0].replaceWith(featuresGroup);
  appendRows(featuresGroup, featureRows);

  organizeTargetHelperSettings(html, featuresGroup);
  organizeReachSettings(html);
}

function organizeTargetHelperSettings(html, featuresGroup) {
  const documentRef = html.ownerDocument;
  const automationRow = findSettingRow(html, SETTINGS.TARGET_HELPER_AUTOMATIONS);
  const colorSchemeRow = findSettingRow(html, SETTINGS.TARGET_HELPER_COLOR_SCHEME);
  const templateHelperRow = findSettingRow(html, SETTINGS.TEMPLATE_HELPER);
  const templateTargetingRow = findSettingRow(html, SETTINGS.TEMPLATE_HELPER_TARGETING);
  if (automationRow || colorSchemeRow || templateHelperRow || templateTargetingRow) {
    const targetHelperGroup = createGroup(documentRef, "TargetHelper");
    appendRows(
      targetHelperGroup,
      [colorSchemeRow, templateHelperRow, automationRow].filter(Boolean)
    );
    const heroPointRow = findSettingRow(html, SETTINGS.TARGET_HELPER_AUTOMATIONS_HERO_POINT);
    const npcOnlyRow = findSettingRow(html, SETTINGS.TARGET_HELPER_AUTOMATIONS_NPC_ONLY);
    const automationRows = [heroPointRow, npcOnlyRow].filter(Boolean);
    const automationSection = automationRow && automationRows.length
      ? createSection(documentRef, "Automations", automationRows)
      : null;
    if (automationSection) {
      targetHelperGroup.appendChild(automationSection);
    }
    const templateSection = templateTargetingRow
      ? createSection(documentRef, "TemplateHelper", [templateTargetingRow])
      : null;
    if (templateSection) targetHelperGroup.appendChild(templateSection);
    featuresGroup.after(targetHelperGroup);
    configureVisibility(html, SETTINGS.TARGET_HELPER, [targetHelperGroup]);
    configureVisibility(html, SETTINGS.TARGET_HELPER_AUTOMATIONS, [automationSection]);
    configureVisibility(html, SETTINGS.TEMPLATE_HELPER, [templateSection]);
  }
}

function organizeReachSettings(html) {
  const documentRef = html.ownerDocument;
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
    reachGroup.appendChild(createSection(documentRef, sectionKey, rows));
  }

  configureVisibility(html, SETTINGS.REACH_CONTROL, [reachGroup]);
  for (const config of Object.values(REACH_TYPES)) {
    configureVisibility(html, config.enabledSetting, [config.rangeSetting, config.gmSetting]
      .filter(Boolean)
      .map((key) => findSettingRow(html, key)));
  }
}

function organizePhobiaGuardSettings(html) {
  const tagRows = [SETTINGS.PHOBIA_GUARD_TAGS, SETTINGS.PHOBIA_GUARD_HIDDEN_TAGS]
    .map((key) => findSettingRow(html, key))
    .filter(Boolean);
  if (!tagRows.length) return;

  const phobiaGuardGroup = createGroup(html.ownerDocument, "PhobiaGuard");
  tagRows[0].replaceWith(phobiaGuardGroup);
  appendRows(phobiaGuardGroup, tagRows);
  configureVisibility(html, SETTINGS.PHOBIA_GUARD, [phobiaGuardGroup]);
}

function findSettingRow(container, key) {
  const settingId = `${MODULE_ID}.${key}`;
  return container.querySelector(`[data-setting-id="${settingId}"]`)?.closest(".form-group")
    ?? container.querySelector(`[id$="${settingId}"]`)?.closest(".form-group")
    ?? null;
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

function createSection(documentRef, sectionKey, rows) {
  const section = documentRef.createElement("section");
  const title = documentRef.createElement("h4");

  title.className = "daavy-addons-settings-section-title";
  title.textContent = game.i18n.localize(`DAAVY_ADDONS.Settings.Sections.${sectionKey}`);
  section.className = "daavy-addons-settings-section";
  section.appendChild(title);
  appendRows(section, rows);
  return section;
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

let incompatibleSettingsCheck = null;

export function checkIncompatibleSettings() {
  return incompatibleSettingsCheck ??= checkIncompatibleSettingsNow().finally(() => {
    incompatibleSettingsCheck = null;
  });
}

async function checkIncompatibleSettingsNow() {
  if (!game.user.isActiveGM || getSetting(SETTINGS.TARGET_HELPER) !== true) return;

  const conflicts = INCOMPATIBLE_SETTINGS.filter(({ namespace, key, requiresSetting, matches }) => (
    (!requiresSetting || getSetting(requiresSetting) === true)
    && externalSettingMatches(namespace, key, matches)
  ));
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

function externalSettingMatches(namespace, key, predicate) {
  return game.modules.get(namespace)?.active === true
    && game.settings.settings.has(`${namespace}.${key}`)
    && predicate(game.settings.get(namespace, key));
}
