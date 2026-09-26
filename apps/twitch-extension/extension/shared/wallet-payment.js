// Wallet display is not a reward-acquisition capability. In the current EBS,
// publicCatalog omits redemption without a configured Twitch reward, whereas
// consumeRedemption still accepts stored credits (ownership/expiry/claim checked
// server-side). Keep that distinction local to these two payment modules.
export function walletPaymentMethods(mod, state = {}) {
  if (!['soundboard', 'tts'].includes(mod.id)) {
    return { displayMethods: [], spendMethods: [] };
  }
  const kinds = Array.isArray(mod.kinds) && mod.kinds.length ? mod.kinds : null;
  const spendMethods = [];
  if ((!kinds || kinds.includes('tokens'))
      && (mod.id !== 'tts' || Number(mod.token_cost) > 0)) spendMethods.push('tokens');
  // This is capability, not balance: each CTA must also require a usable
  // pending redemption for its module and cost. Preserve the TTS lab restriction.
  if (mod.id !== 'tts' || !state.lab_mode) spendMethods.push('credits');
  return { displayMethods: ['tokens', 'credits'], spendMethods };
}

export function walletCanPayTokens(wallet, cost) {
  return wallet?.unavailable !== true
    && typeof wallet?.available === 'number'
    && Number.isFinite(wallet.available)
    && Number.isFinite(cost) && cost > 0
    && wallet.available >= cost;
}
