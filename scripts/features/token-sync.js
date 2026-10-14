import { MODULE_ID, SETTINGS } from "../constants.js";
import { getSetting } from "../utils.js";

const SYNCED_ACTOR_TYPES = new Set(["character", "npc"]);
const PROTOTYPE_TOKEN_IMAGE_PATH = "prototypeToken.texture.src";

function isTokenSyncActor(actor) {
  return getSetting(SETTINGS.TOKEN_SYNC) === true && SYNCED_ACTOR_TYPES.has(actor?.type);
}

function shouldSync(actor) {
  return isTokenSyncActor(actor) && !actor.isToken;
}

function getTokenChanges(actor, changes) {
  const tokenChanges = {};
  if (changes.name) tokenChanges.name = changes.name;
  const image = foundry.utils.getProperty(changes, PROTOTYPE_TOKEN_IMAGE_PATH);
  if (image && !actor.prototypeToken.randomImg) tokenChanges["texture.src"] = image;
  return tokenChanges;
}

async function updateSceneTokens(scene, actorId, tokenChanges) {
  const updates = scene.tokens
    .filter((token) => token.actorId === actorId)
    .map((token) => ({ _id: token.id, ...tokenChanges }));
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
}

export function syncPrototypeToken(actor, changes) {
  if (!shouldSync(actor) || !changes.name) return;
  foundry.utils.setProperty(changes, "prototypeToken.name", changes.name);
}

export async function syncSceneTokens(actor, changes, _options, userId) {
  if (userId !== game.user.id || !shouldSync(actor)) return;
  const tokenChanges = getTokenChanges(actor, changes);
  if (foundry.utils.isEmpty(tokenChanges)) return;

  const results = await Promise.allSettled(
    game.scenes.map((scene) => updateSceneTokens(scene, actor.id, tokenChanges))
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`${MODULE_ID} | Failed to sync scene tokens`, result.reason);
    }
  }
}

export function lockTokenName(app, html) {
  if (!isTokenSyncActor(app.actor)) return;
  const input = html.querySelector('[name="name"]');
  if (!input) return;

  input.disabled = true;
  input.title = game.i18n.localize("DAAVY_ADDONS.TokenSync.NameLocked");
}
