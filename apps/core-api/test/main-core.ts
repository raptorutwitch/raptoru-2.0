import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createCore, type Core } from '../src/app.js';
import type { CoreConfig } from '../src/config.js';
import { WalletCreditProvider } from '../src/daily/credits.js';
import type { Db } from '../src/db/db.js';
import {
  CORE_ECONOMY_MODULES,
  selectEconomy,
} from '../src/economy/activation.js';
import { createPublicFrontier } from '../src/ext/public-frontier.js';
import { signExtensionJwt } from '../src/ext/twitch-jwt.js';
import { createApp } from '../src/http/server.js';
import type { LoginLookup } from '../src/mini-games/twitch-login.js';
import { sha256, STUDIO_PROTOCOL_HEADER } from '../src/studio/installations.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import type { FakeClock } from './helpers.js';

// One main Core process as src/index.ts assembles it (canonical economy accepted by selectEconomy, createCore, viewer
// frontier, createApp), on its own pool and HTTP server, reached through its real doors: the bot (bot secret), the
// Extension (Twitch JWT) and a paired Studio (installation credential). Shared by the integration rehearsals.

export const MAIN_CORE_CHANNEL = '83603689';
export const MAIN_CORE_BOT_SECRET = 'bot-rehearsal-secret-0123456789';

export async function bootMainCore(
  db: Db,
  clock: FakeClock,
  o: {
    extensionSecret: Buffer;
    servers: Server[];
    /** Duel targets by login without Twitch. */
    loginLookup?: LoginLookup;
  },
) {
  const CH = MAIN_CORE_CHANNEL;
  const economy = await selectEconomy({
    mode: 'canonical',
    q: db,
    wallet: new WalletService(db),
    modules: CORE_ECONOMY_MODULES,
  });
  const core = createCore(
    db,
    clock,
    new WalletCreditProvider(db),
    { preview: false, passiveCredits: true, eventCredits: true },
    null,
    economy,
    { broadcasterId: CH, loginLookup: o.loginLookup ?? null },
  );
  const frontier = createPublicFrontier(core, db, clock, {
    TWITCH_CHANNEL_ID: CH,
    TWITCH_CHANNEL_LOGIN: 'raptoru_',
    TWITCH_EXTENSION_SECRET: o.extensionSecret.toString('base64'),
    CORE_ENVIRONMENT: 'staging',
  } as CoreConfig)!;
  const server = createApp({
    labRoutes: false,
    ...frontier.deps,
    daily: core.daily,
    streams: core.streams,
    presence: core.presence,
    wallet: core.wallet,
    loyalty: core.loyalty,
    bonkLab: core.bonkLab,
    soundLab: core.soundLab,
    ttsLab: core.ttsLab,
    studioInstallations: core.studioInstallations,
    alerts: core.alerts,
    channelPoints: core.channelPoints,
    randomBan: core.randomBan,
    subWheel: core.subWheel,
    botSecret: MAIN_CORE_BOT_SECRET,
    studioSecret: 'studio-rehearsal-secret-0123456789',
    db,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  o.servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = async (
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
      body: (text ? JSON.parse(text) : null) as any,
    };
  };
  const bot = (path: string, body: unknown) =>
    send(path, body, { authorization: `Bearer ${MAIN_CORE_BOT_SECRET}` });
  const jwt = (userId: string, role = 'viewer') =>
    signExtensionJwt(
      {
        exp: Math.floor(Date.now() / 1000) + 600,
        opaque_user_id: `U${userId}`,
        channel_id: CH,
        role,
        user_id: userId,
      },
      o.extensionSecret,
    );
  const ext = (
    userId: string,
    path: string,
    body?: unknown,
    key: string = randomUUID(),
    role = 'viewer',
  ) =>
    send(`/v1/ext${path}`, body, {
      authorization: `Bearer ${jwt(userId, role)}`,
      origin: 'https://abcdef123.ext-twitch.tv',
      ...(body === undefined ? {} : { 'idempotency-key': key }),
    });
  // A paired Studio (installation credential).
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  await core.studioInstallations.register(
    `${id}.${sha256(secret)}`,
    'PC répétition',
  );
  const studio = (path: string, body?: unknown) =>
    send(path, body, {
      authorization: `Bearer rsi_${id}.${secret}`,
      [STUDIO_PROTOCOL_HEADER]: '1',
    });
  return { core, bot, ext, studio, frontier };
}

/** Studio's players ready (Bonk overlay, Soundboard, TTS). */
export async function playersReady(core: Core) {
  await core.bonkLab.heartbeat({
    studio_instance_id: 'studio-1',
    obs: 'connected',
    source_ready: true,
    overlay_ready: true,
  });
  await core.soundLab.heartbeat({
    studio_instance_id: 'studio-1',
    player_ready: true,
  });
  await core.ttsLab.heartbeat({
    studio_instance_id: 'studio-1',
    player_ready: true,
  });
}
