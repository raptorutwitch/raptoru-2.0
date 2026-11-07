import type { Queryable } from '../db/db.js';
import { activeSession } from './stream-sessions.js';

/**
 * Refonte H1 (decided 05/11/2026): the paid interactions tied to the stream (Soundboard, TTS, Bonk, Chaos and effects,
 * `!rb`, Caution, Votekick, Spotify, channel points effects) run only during the live, refused BEFORE any payment.
 * - Production (canonical economy): the canonical live — `stream_sessions`, opened and closed by Twitch through the
 *   bot. Never a simulation button nor a simulated session (they live in `lab_stream_sessions`, Lab only).
 * - Lab (test wallet): a test bench, never gated (decision: « les tests restent possibles dans un Lab isolé »).
 * Not for the permanent shop, the Wallet, the Daily, loyalty or any read.
 */
export async function liveForPaid(
  q: Queryable,
  economy: { readonly mode: 'lab' | 'canonical' },
): Promise<boolean> {
  return economy.mode !== 'canonical' || !!(await activeSession(q));
}

/** The refusal code every module returns (the extension and Studio show « pendant le live uniquement »). */
export const STREAM_OFFLINE = 'stream_offline';
