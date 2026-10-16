import { z } from 'zod';

// Jeu des mots V1 (Lab) — Studio contract (docs/WORD_GAME_PARITY.md § 14). Viewers play in the chat only;
// Core decides everything. Studio stops / resumes the cycle of the current live session and forces a
// new word (one per request id: a double click makes one word).

export const WordGameAction = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('stop') }),
  z.strictObject({ action: z.literal('start') }),
  z.strictObject({ action: z.literal('new_word'), request_id: z.uuid() }),
]);
export type WordGameAction = z.infer<typeof WordGameAction>;

export interface WordGameActiveWord {
  occurrence_id: string;
  word: string;
  shuffled: string;
  golden: boolean;
  source: 'cycle' | 'manual';
  created_at: string;
  age_seconds: number;
}

/**
 * A committed winning message (words, streak, Wallet credit and win all written), pushed by the Lab Core
 * to Studio's OBS sound source (GET /v1/lab/word-game/:channel/events, server-sent events). Never sent
 * for a replayed message, a refused credit, a command or a new word.
 */
export interface WordGameWinEvent {
  channel_id: string;
  message_id: string;
  created_at: string;
}

export interface WordGameRecentWin {
  message_id: string;
  viewer_id: string;
  viewer_display_name: string;
  words: { word: string; points: number; fast: boolean; golden: boolean }[];
  combo: number;
  breaker: number;
  total: number;
  created_at: string;
}

export interface WordGameState {
  channel_id: string;
  /** A live session is open: the game runs only then. */
  live: boolean;
  session_id: string | null;
  /** live and not stopped: new words are drawn. */
  running: boolean;
  stopped: boolean;
  next_word_at: string | null;
  active: WordGameActiveWord[];
  streak: {
    holder_id: string | null;
    holder_name: string | null;
    count: number;
  };
  recent: WordGameRecentWin[];
}
