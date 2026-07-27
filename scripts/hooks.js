const PRE_CREATE_CHAT_MESSAGE = "preCreateChatMessage";

export function addPreCreateChatMessageHook(handler) {
  Hooks.on(PRE_CREATE_CHAT_MESSAGE, handler);
  return () => Hooks.off(PRE_CREATE_CHAT_MESSAGE, handler);
}
