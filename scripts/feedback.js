import { MODULE_ID } from "./constants.js";

const FEEDBACK_ACTIONS_CLASS = "daavy-addons-settings-actions";
const FEEDBACK_I18N_PREFIX = "DAAVY_ADDONS.Feedback";
const FEEDBACK_ENDPOINT = "https://feedback.daavyc.workers.dev";
const FEEDBACK_TEMPLATE = `modules/${MODULE_ID}/templates/feedback.hbs`;
const DONATE_URL = "https://ko-fi.com/daavy";
const DISCORD_URL = "https://discord.gg/ZmFZxdGrta";
const MAX_MESSAGE_LENGTH = 3000;
const CATEGORIES = ["Bug", "Suggestion"];

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class FeedbackForm extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "daavy-addons-feedback",
    tag: "form",
    window: {
      title: `${FEEDBACK_I18N_PREFIX}.MenuLabel`,
      icon: "fa-solid fa-comment-dots",
      contentClasses: ["standard-form"]
    },
    position: {
      width: 500
    },
    form: {
      closeOnSubmit: false,
      handler: FeedbackForm.#onSubmit
    }
  };

  static PARTS = {
    form: {
      template: FEEDBACK_TEMPLATE,
      root: true
    }
  };

  #submitting = false;

  static async #onSubmit(_event, form, formData) {
    if (this.#submitting) return;

    const category = String(formData.object.category ?? "").trim();
    const message = String(formData.object.message ?? "").trim();
    if (!CATEGORIES.includes(category) || !message || message.length > MAX_MESSAGE_LENGTH) {
      ui.notifications.warn(game.i18n.localize(`${FEEDBACK_I18N_PREFIX}.Invalid`));
      return;
    }
    if (!game.user?.isGM) return;

    const submitButton = form.querySelector('button[type="submit"]');
    this.#submitting = true;
    if (submitButton) submitButton.disabled = true;

    try {
      const module = game.modules.get(MODULE_ID);
      const response = await fetch(FEEDBACK_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message,
          category,
          moduleName: module?.title ?? MODULE_ID,
          moduleVersion: module?.version ?? "",
          foundryVersion: game.version ?? "",
          systemId: game.system?.id ?? "",
          systemVersion: game.system?.version ?? ""
        })
      });

      if (!response.ok) throw new Error(`Feedback request failed with status ${response.status}.`);

      ui.notifications.info(game.i18n.localize(`${FEEDBACK_I18N_PREFIX}.Success`));
      await this.close();
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to send feedback.`, error);
      ui.notifications.error(game.i18n.localize(`${FEEDBACK_I18N_PREFIX}.Error`));
    } finally {
      this.#submitting = false;
      if (submitButton) submitButton.disabled = false;
    }
  }
}

export function injectFeedbackButtons(html) {
  if (!html || !game.user?.isGM || html.querySelector(`.${FEEDBACK_ACTIONS_CLASS}`)) return;

  const firstGroup = html.querySelector(".daavy-addons-settings-group");
  if (!firstGroup) return;

  const documentRef = html.ownerDocument;
  const actions = documentRef.createElement("div");
  actions.className = FEEDBACK_ACTIONS_CLASS;

  const buttons = [
    ["daavy-addons-donate-action", "fa-solid fa-heart", "DAAVY_ADDONS.Donate.Label", () => documentRef.defaultView?.open(DONATE_URL, "_blank", "noopener,noreferrer")],
    ["daavy-addons-discord-action", "fa-brands fa-discord", "DAAVY_ADDONS.Discord.Label", () => documentRef.defaultView?.open(DISCORD_URL, "_blank", "noopener,noreferrer")],
    ["daavy-addons-feedback-action", "fa-solid fa-comment-dots", `${FEEDBACK_I18N_PREFIX}.MenuLabel`, () => new FeedbackForm().render({ force: true }), `${FEEDBACK_I18N_PREFIX}.MenuHint`]
  ].map(([className, icon, label, onClick, title]) => {
    const button = createButton(documentRef, { className, icon, label: game.i18n.localize(label) });
    if (title) button.title = game.i18n.localize(title);
    button.addEventListener("click", onClick);
    return button;
  });

  actions.append(...buttons);
  firstGroup.before(actions);
}

function createButton(documentRef, { className, icon, label }) {
  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = className;
  button.innerHTML = `<i class="${icon}"></i> ${label}`;
  return button;
}
