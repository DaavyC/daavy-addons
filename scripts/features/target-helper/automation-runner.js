import { DELAYS } from "./constants.js";
import { getMessageRoot } from "./dom.js";
import { wait } from "./scheduler.js";

export async function repeatMessageAutomation(message, root, passLimit, runPass) {
  let currentRoot = root;
  let completedPasses = 0;

  for (let pass = 0; pass < passLimit; pass += 1) {
    currentRoot = getMessageRoot(message.id) ?? currentRoot;
    if (!(currentRoot instanceof HTMLElement)) break;
    if (!runPass(currentRoot)) break;

    completedPasses += 1;
    await wait(DELAYS.clickPause);
  }

  return completedPasses;
}
