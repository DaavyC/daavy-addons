# Daavy's Addons

This module groups features that don’t need separate modules.

---

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/C1I7209LY1)

---

## Features

- **Target Helper (PF2e):** Adds save, damage, healing, and undo controls to chat cards. Optional automation requires an active GM. Hero Point rerolls can update damage, and Template Helper adds targets from spell templates.
- **Reach Control:** Limits interactions with doors, Stairways, and tokens by distance in grid squares. Each object can override the module's range.
- **Scene Defaults:** Adds a star to supported settings in Scene configuration. Click it to use the setting's current value as the default for new scenes.
- **Token Sync:** Copies a character's or NPC's name to its prototype token and its existing tokens on every scene. Prototype token image changes also update those tokens. Locks the token name field.
- **Phobia Guard:** The GM defines phobia tags and assigns them to tokens. Each user chooses which tags to hide, and tokens with those tags show a green wave effect instead of their image. Only that user sees the change.

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

### Token Sync

| Setting | Effect |
| --- | --- |
| Token Sync | Enables the feature for the world. Actor name changes update the prototype token and existing tokens on every scene. Prototype token image changes update existing tokens, except wildcard images. Locks the name field in token and prototype token configuration. Affects characters and NPCs. |

### Scene Defaults

| Setting | Effect |
| --- | --- |
| Scene Defaults | Enables the feature for the world. Only users who can modify settings see the stars. |
| Star | Stores the setting's current value as the default for new scenes. Click it again to remove the default. Defaults do not change duplicated scenes or values set when the scene is created. |

Supported settings:

- **Basics:** Permissions and Background Color.
- **Grid:** Pixels, Type, Distance, Units, Style, Thickness, Color, and Opacity.
- **Scene Properties:** Padding Percentage.
- **Visibility:** Fog of War (Exploration Mode, Unexplored Image, Unexplored Color, and Explored Color) and Global Illumination (Enabled and Threshold).
- **Environment:** All settings.
- **Miscellaneous:** All settings.
- **Pathfinder (PF2e only):** Hearing Range and Environment.

### Phobia Guard

| Setting | Effect |
| --- | --- |
| Phobia Guard | Enables the feature for the world. Requires a reload. |
| Phobia tags | Defines the tags available in the world. Only the GM can edit them. Requires a reload. |
| Hidden phobia tags | Chooses which of the GM's tags to hide. Tokens with any of them show a green wave effect. Applies only to you and requires a reload. |
| Phobia tags (token) | Assigns tags to a token. Appears in the token and prototype token configuration. |

## Installation

In Foundry VTT, open Add-on Modules, choose Install Module, and enter the manifest URL:

<https://github.com/DaavyC/daavy-addons/releases/latest/download/module.json>

## Compatibility

- Requires Foundry VTT 14.
- Reach Control, Scene Defaults, Token Sync, and Phobia Guard work with any game system. Target Helper and Template Helper require PF2e. The Pathfinder settings of Scene Defaults appear only in PF2e.
- Stairways range limits require the Stairways module.

## Credits

- [Arms Reach](https://github.com/p4535992/foundryvtt-arms-reach) by p4535992.
