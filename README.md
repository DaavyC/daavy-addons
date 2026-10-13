# Daavy's Addons

This module groups features that don’t need separate modules.

---

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/C1I7209LY1)

---

## Features

- **Target Helper (PF2e):** Adds save, damage, healing, and undo controls to chat cards. Optional automation requires an active GM. Hero Point rerolls can update damage, and Template Helper adds targets from spell templates.
- **Reach Control:** Limits interactions with doors, Stairways, and tokens by distance in grid squares. Each object can override the module's range.
- **Phobia Guard:** Lets each user replace the images of tokens marked as phobia triggers with a green wave effect. Only that user sees the change.

## Settings

### PF2e only

| Setting | Effect |
| --- | --- |
| Target Helper | Shows target controls on supported chat cards. |
| Color scheme | Changes the colors of Target Helper results. |
| Automations | Rolls saves and damage, then applies the results. Requires an active GM. |
| Hero Point | Updates damage after Hero Point rerolls. |
| NPCs only | Limits selected automation steps to NPC targets. Choose application only, application and saves, or all steps. Disabled applies no NPC restriction. |
| Template Helper | Places spell templates and adds targets inside them. |
| Target behavior | Asks which template targets to add, or always adds enemies or everyone. |

### Reach Control

| Setting | Effect |
| --- | --- |
| Reach Control | Enables interaction range limits. |
| Doors, Stairways, and Tokens | Enables the range limit for each interaction type. |
| Maximum range | Sets the limit in grid squares. |
| Apply to GM-controlled tokens | Applies door or Stairways limits when a GM controls one token. |
| Reach Control range | Sets an object's range. Use 0 to follow the module setting. |

### Phobia Guard

| Setting | Effect |
| --- | --- |
| Phobia Guard | Enables the feature for the world. Requires a reload. |
| Hide phobia triggers | Replaces the image of marked tokens with a green wave effect. Applies only to you and requires a reload. |
| Phobia trigger | Marks a token as a phobia trigger. Appears in the token and prototype token configuration. |

## Installation

In Foundry VTT, open Add-on Modules, choose Install Module, and enter the manifest URL:

<https://github.com/DaavyC/daavy-addons/releases/latest/download/module.json>

## Compatibility

- Requires Foundry VTT 14.
- Reach Control and Phobia Guard work with any game system. Target Helper and Template Helper require PF2e.
- Stairways range limits require the Stairways module.

## Credits

- [Arms Reach](https://github.com/p4535992/foundryvtt-arms-reach) by p4535992.
