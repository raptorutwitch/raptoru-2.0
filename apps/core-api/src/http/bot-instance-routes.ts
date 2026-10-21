import { BotLeaseRequest, BotReleaseRequest } from '@raptoru/schemas';
import type { BotInstanceService } from '../bot-instance/service.js';
import { parse, type Route } from './server.js';

// Single active production bot (plan post-live lot 1): the bot's lease (bot secret) and the paired Studio's read-only
// view of it (installation credential, « Services du live »).
export function botInstanceRoutes(
  bots: BotInstanceService,
  studio: boolean,
): Route[] {
  return [
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/instance\/lease$/,
      auth: 'bot',
      handle: ({ body }) => bots.lease(parse(BotLeaseRequest, body)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/instance\/release$/,
      auth: 'bot',
      handle: ({ body }) =>
        bots.release(parse(BotReleaseRequest, body).instanceId),
    },
    ...(studio
      ? [
          {
            method: 'GET' as const,
            pattern: /^\/v1\/studio\/status\/bot$/,
            auth: 'studio_installation' as const,
            handle: () => bots.status(),
          },
        ]
      : []),
  ];
}
