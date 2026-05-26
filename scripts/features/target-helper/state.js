export const state = {
  hooksRegistered: false,
  handledDamageApplications: new Set(),
  handledSaveApplications: new Set(),
  handledSpellDamageRolls: new Set(),
  pendingSpellDamageRolls: new Map(),
  spellDamageFallbackAttempts: new Set()
};
