import { z } from 'zod';

// Roulette and Slot V1 (Lab) — Studio contract (docs/ROULETTE_SLOT_PARITY.md). Viewers play in the chat
// only; Core decides everything. Studio turns the games on / off (OFF by default) and reads the last plays.

export const MiniGamesSettings = z.strictObject({ enabled: z.boolean() });
export type MiniGamesSettings = z.infer<typeof MiniGamesSettings>;

export interface MiniGamePlay {
  message_id: string;
  game: 'roulette' | 'slot';
  viewer_id: string;
  viewer_display_name: string;
  bet: number;
  all_in: boolean;
  symbols: string[] | null;
  won: boolean;
  delta: number;
  balance_after: number;
  created_at: string;
}

export interface MiniGamesState {
  channel_id: string;
  /** Studio switch « Mini-jeux » (OFF by default): OFF = no chat message is played. */
  enabled: boolean;
  recent: MiniGamePlay[];
}
