import {
  CmdStepAckRequest,
  CmdStepClaimRequest,
  LabChatMessage,
  LabStreamEvent,
} from '@raptoru/schemas';
import { z } from 'zod';
import type { ChatGames } from '../lab-chat/games.js';
import type { LabChatRouter } from '../lab-chat/router.js';
import { mapped } from './commands-routes.js';
import { mappedModeration } from './lab-moderation-routes.js';
import { HttpError, parse, type Route } from './server.js';

// Main Core — the chat games' doors for the production bot (bot secret), the same contracts as the Lab Core's routes
// (`/v1/lab/…` there, `/v1/bot/…` here) so the bot reuses the Lab adapter's modules unchanged (lab-chat-ingest.ts,
// lab-chat-output.ts): one chat message to every module (Tombola, Commands V2, Jeu des mots, Roulette / Slot / Duel),
// the stream state, and the claim / ACK of the chat answers. The Core's channel only; Twitch messages only (the
// Studio simulator never reaches this Core: its chat would move real money once the Wallet is canonical).

const Uuid = z.string().regex(/^[0-9a-f-]{36}$/);

export function botChatRoutes(
  router: LabChatRouter,
  games: Pick<ChatGames, 'steps'>,
  channelId: string,
): Route[] {
  const channel = (id: string) => {
    if (id !== channelId)
      throw new HttpError(409, {
        error: 'wrong_channel',
        expected_channel_id: channelId,
      });
    return id;
  };
  return [
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/chat$/,
      auth: 'bot',
      handle: ({ body }) => {
        const m = parse(LabChatMessage, body);
        channel(m.channel_id);
        if (m.source !== 'twitch')
          throw new HttpError(400, { error: 'twitch_source_required' });
        return mappedModeration(() => router.message(m));
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/stream$/,
      auth: 'bot',
      handle: ({ body }) => {
        const e = parse(LabStreamEvent, body);
        channel(e.channel_id);
        return mappedModeration(() => router.stream(e));
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/commands\/(\d{1,32})\/steps\/claim$/,
      auth: 'bot',
      handle: ({ params, body }) =>
        games.steps.claim(
          channel(params[0]!),
          parse(CmdStepClaimRequest, body).executor_id,
        ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/commands\/(\d{1,32})\/steps\/([0-9a-f-]{36})\/ack$/,
      auth: 'bot',
      handle: ({ params, body }) =>
        mapped(() =>
          games.steps.ack(
            channel(params[0]!),
            parse(Uuid, params[1]),
            parse(CmdStepAckRequest, body),
          ),
        ),
    },
  ];
}
