import { MODULE_ID, SETTINGS } from "../constants.js";
import { getSetting } from "../utils.js";

const BUTTON_CLASS = "daavy-addons-scene-default";
const I18N_PREFIX = "DAAVY_ADDONS.SceneDefaults";
const LEVEL_PATHS = {
  backgroundColor: "background.color",
  "fog.overlay": "fog.src"
};
const SETTING_ROWS = [
  ["navigation", "ownership.default"],
  ["backgroundColor"],
  ["grid.size", "grid.type"],
  ["grid.distance", "grid.units"],
  ["grid.style", "grid.thickness"],
  ["grid.color"],
  ["grid.alpha"],
  ["padding"],
  ["fog.mode"],
  ["fog.overlay"],
  ["fog.colors.unexplored"],
  ["fog.colors.explored"],
  ["environment.globalLight.enabled"],
  ["environment.globalLight.darkness.max"],
  ["environment.base.luminosity"],
  ["environment.base.saturation"],
  ["environment.base.shadows"],
  ["environment.base.hue"],
  ["environment.base.intensity"],
  ["environment.darknessLevel"],
  ["environment.darknessLock"],
  ["environment.cycle"],
  ["environment.dark.luminosity"],
  ["environment.dark.saturation"],
  ["environment.dark.shadows"],
  ["environment.dark.hue"],
  ["environment.dark.intensity"],
  ["journal"],
  ["journalEntryPage"],
  ["playlist"],
  ["playlistSound"],
  ["transition.type"],
  ["transition.duration"],
  ["transition.activeOnly"],
  ["flags.pf2e.hearingRange"],
  ["flags.pf2e.environmentTypes"]
];

function isEnabled() {
  return getSetting(SETTINGS.SCENE_DEFAULTS) === true;
}

function getDefaults() {
  return foundry.utils.flattenObject(getSetting(SETTINGS.SCENE_DEFAULTS_VALUES));
}

function updateSource(document, changes) {
  if (!foundry.utils.isEmpty(changes)) document.updateSource(changes, { fallback: true });
}

function readFormValues(app, paths) {
  const { object } = new foundry.applications.ux.FormDataExtended(app.form, { disabled: true });
  return Object.fromEntries(paths.filter((path) => path in object).map((path) => [path, object[path]]));
}

function isCurrentDefault(app, paths) {
  const defaults = getDefaults();
  const values = readFormValues(app, paths);
  return paths.every((path) => path in values && foundry.utils.objectsEqual(defaults[path], values[path]));
}

async function toggleDefault(app, paths) {
  const defaults = getDefaults();
  if (isCurrentDefault(app, paths)) {
    for (const path of paths) delete defaults[path];
  } else {
    Object.assign(defaults, readFormValues(app, paths));
  }
  await game.settings.set(MODULE_ID, SETTINGS.SCENE_DEFAULTS_VALUES, foundry.utils.expandObject(defaults));
}

function showState(button, active) {
  const label = game.i18n.localize(`${I18N_PREFIX}.${active ? "Remove" : "Set"}`);
  button.classList.toggle("fa-solid", active);
  button.classList.toggle("fa-regular", !active);
  button.classList.toggle("active", active);
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
}

function addDefaultButton(app, html, paths) {
  const group = html.querySelector(`[name="${paths[0]}"]`)?.closest(".form-group");
  const label = group?.querySelector(":scope > label, :scope > .label");
  if (!label || label.querySelector(`.${BUTTON_CLASS}`)) return;

  const button = html.ownerDocument.createElement("button");
  button.type = "button";
  button.className = `${BUTTON_CLASS} inline-control icon fa-star`;
  const refresh = () => showState(button, isCurrentDefault(app, paths));
  button.addEventListener("click", async () => {
    await toggleDefault(app, paths);
    refresh();
  });
  group.addEventListener("change", refresh);
  refresh();
  label.append(button);
}

export function applySceneDefaults(scene, data) {
  if (!isEnabled()) return;

  const sceneChanges = {};
  const levelChanges = {};
  for (const [path, value] of Object.entries(getDefaults())) {
    if (foundry.utils.hasProperty(data, path)) continue;
    if (!(path in LEVEL_PATHS)) sceneChanges[path] = value;
    else if (!data.levels?.length) foundry.utils.setProperty(levelChanges, LEVEL_PATHS[path], value);
  }
  updateSource(scene, sceneChanges);
  updateSource(scene.initialLevel, levelChanges);
}

export function addSceneDefaultButtons(app, html) {
  if (!isEnabled() || !game.user.can("SETTINGS_MODIFY")) return;
  for (const paths of SETTING_ROWS) addDefaultButton(app, html, paths);
}
