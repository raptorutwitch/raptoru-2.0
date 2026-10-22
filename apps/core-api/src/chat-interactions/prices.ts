// Prices of the interactions bought from the chat (docs/CHAT_COMMANDS.md), in Jetons — the ONE place Core reads them.
// Validated by Antoni on 22/10/2026. Studio will set them later through the same reader (a stored value per channel
// replacing these defaults): callers never read the constants directly.

export const CHAT_INTERACTION_PRICES = Object.freeze({
  random_ban: 25_000,
  fx_cam: 1_500,
});

export type ChatInteraction = keyof typeof CHAT_INTERACTION_PRICES;

/** The price of an interaction for a channel (today the validated defaults; tomorrow Studio's setting). */
export interface ChatPrices {
  price(channelId: string, interaction: ChatInteraction): Promise<number>;
}

export const defaultChatPrices: ChatPrices = {
  price: async (_channelId, interaction) =>
    CHAT_INTERACTION_PRICES[interaction],
};
