import { describe, expect, it } from 'vitest';
import {
  BonkLabError409,
  BonkLabService,
} from '../src/bonk-lab/bonk-lab-service.js';
import {
  parse7tv,
  parseBttv,
  parseFfz,
  ThirdPartyEmotes,
  thirdPartyUrl,
} from '../src/bonk-lab/third-party-emotes.js';
import { MINUTE, setup, type TestCore } from './helpers.js';

const CHANNEL_TWITCH_ID = '83603689';
const SEVEN_ANIM = '01FF53DH2000037W021V2MN0SS';
const SEVEN_STATIC = '01GB9W8JN8000FRGDEM1G5GNTH';
const BTTV_ID = '55c2f86ff95ede671a79e47f';

/** Payload shapes copied from the real public APIs (trimmed). No network. */
function fakeProviders(over: { sevenTvDown?: boolean } = {}) {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const fetchImpl = async (url: string) => {
    calls.push(url);
    if (url.startsWith('https://7tv.io') && over.sevenTvDown)
      return json({}, 503);
    if (url === 'https://7tv.io/v3/emote-sets/global')
      return json({
        emotes: [
          {
            id: SEVEN_STATIC,
            name: 'EZ',
            data: { id: SEVEN_STATIC, animated: false },
          },
        ],
      });
    if (url === `https://7tv.io/v3/users/twitch/${CHANNEL_TWITCH_ID}`)
      return json({
        display_name: 'Raptoru_',
        user: { display_name: 'Raptoru_' },
        emote_set: {
          emotes: [
            {
              id: SEVEN_ANIM,
              name: '199Yoooo',
              data: { id: SEVEN_ANIM, animated: true },
            },
          ],
        },
      });
    if (url === 'https://api.betterttv.net/3/cached/emotes/global')
      return json([
        {
          id: '54fa8f1401e468494b85b537',
          code: ':tf:',
          imageType: 'png',
          animated: false,
        },
      ]);
    if (
      url ===
      `https://api.betterttv.net/3/cached/users/twitch/${CHANNEL_TWITCH_ID}`
    )
      return json({
        channelEmotes: [],
        sharedEmotes: [
          { id: BTTV_ID, code: 'prxGasm', imageType: 'png', animated: false },
        ],
      });
    if (url === 'https://api.frankerfacez.com/v1/set/global')
      return json({
        default_sets: [3],
        sets: {
          3: {
            emoticons: [
              { id: 9, name: 'ZrehplaR', urls: { 1: 'x', 2: 'x', 4: 'x' } },
            ],
          },
          99: { emoticons: [{ id: 77, name: 'NotDefault', urls: { 1: 'x' } }] },
        },
      });
    if (url === `https://api.frankerfacez.com/v1/room/id/${CHANNEL_TWITCH_ID}`)
      return json({
        room: { display_name: 'Raptoru_' },
        sets: { 1451790: { emoticons: [] } },
      });
    return json({}, 404);
  };
  return { fetchImpl, calls };
}

const request = (
  provider: '7tv' | 'bttv' | 'ffz',
  id: string,
  key: string,
) => ({
  idempotency_key: key,
  channel_id: '900100',
  viewer: { id: '900101', display_name: 'Viewer Lab' },
  lab_session_id: 'lab-1',
  emote: { provider, id },
});

async function fixture(over: { sevenTvDown?: boolean } = {}) {
  const core: TestCore = await setup();
  const fake = fakeProviders(over);
  const thirdParty = new ThirdPartyEmotes(
    CHANNEL_TWITCH_ID,
    core.clock,
    fake.fetchImpl as never,
  );
  const bonk = new BonkLabService(core.db, core.clock, null, thirdParty);
  await bonk.heartbeat({
    studio_instance_id: 'studio-A',
    obs: 'connected',
    source_ready: true,
    overlay_ready: true,
  });
  return { core, bonk, thirdParty, fake };
}
const code = async (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) =>
      e instanceof BonkLabError409 ? e.code : `unexpected: ${String(e)}`,
  );

describe('7TV / BTTV / FFZ parsing (real payload shapes)', () => {
  it('builds only fixed CDN URLs from validated ids', () => {
    expect(
      parse7tv(
        {
          emotes: [
            { id: SEVEN_ANIM, name: 'a', data: { animated: true } },
            { id: 'x"><', name: 'b' },
          ],
        },
        'channel',
      ),
    ).toEqual([
      {
        provider: '7tv',
        id: SEVEN_ANIM,
        name: 'a',
        scope: 'channel',
        animated: true,
        url: `https://cdn.7tv.app/emote/${SEVEN_ANIM}/4x.webp`,
      },
    ]);
    expect(
      parseBttv(
        { sharedEmotes: [{ id: BTTV_ID, code: 'prxGasm', imageType: 'gif' }] },
        'channel',
      )[0],
    ).toMatchObject({
      animated: true,
      url: `https://cdn.betterttv.net/emote/${BTTV_ID}/3x`,
    });
    expect(
      parseFfz(
        {
          default_sets: [3],
          sets: {
            3: {
              emoticons: [
                { id: 9, name: 'Zreh', urls: { 1: 'u', 2: 'u' } },
                {
                  id: 10,
                  name: 'Anim',
                  urls: { 1: 'u' },
                  animated: { 1: 'u', 4: 'u' },
                },
              ],
            },
            5: { emoticons: [{ id: 11, name: 'Other', urls: { 1: 'u' } }] },
          },
        },
        'global',
      ),
    ).toEqual([
      {
        provider: 'ffz',
        id: '9',
        name: 'Zreh',
        scope: 'global',
        animated: false,
        url: 'https://cdn.frankerfacez.com/emote/9/2',
      },
      {
        provider: 'ffz',
        id: '10',
        name: 'Anim',
        scope: 'global',
        animated: true,
        url: 'https://cdn.frankerfacez.com/emote/10/animated/4',
      },
    ]);
    expect(thirdPartyUrl('bttv', '../../evil')).toBeNull();
    expect(thirdPartyUrl('ffz', '12a')).toBeNull();
  });
});

describe('Bonk Lab admission with 7TV / BTTV / FFZ (Core resolves, caller sends provider + id)', () => {
  it('admits an emote of the channel catalog with the URL built by Core; refuses unknown ids', async () => {
    const { bonk, core, fake } = await fixture();
    const seven = await bonk.admit(request('7tv', `7tv:${SEVEN_ANIM}`, 'a'));
    expect(seven.interaction).toMatchObject({
      provider: '7tv',
      emote_id: `7tv:${SEVEN_ANIM}`,
      emote_url: `https://cdn.7tv.app/emote/${SEVEN_ANIM}/4x.webp`,
      emote_animated: true,
      test_mode: true,
      payment_mode: 'simulated',
      real_debited: 0,
    });
    expect(
      (await bonk.admit(request('bttv', `bttv:${BTTV_ID}`, 'b'))).interaction
        .emote_url,
    ).toBe(`https://cdn.betterttv.net/emote/${BTTV_ID}/3x`);
    expect(
      (await bonk.admit(request('ffz', 'ffz:9', 'c'))).interaction.emote_url,
    ).toBe('https://cdn.frankerfacez.com/emote/9/4');
    // Not in the channel catalog (FFZ non-default set), wrong prefix, or a glyph: refused.
    expect(await code(bonk.admit(request('ffz', 'ffz:77', 'd')))).toBe(
      'emote_not_in_catalog',
    );
    expect(await code(bonk.admit(request('7tv', `bttv:${BTTV_ID}`, 'e')))).toBe(
      'emote_not_in_catalog',
    );
    expect(
      await code(
        bonk.admit({
          ...request('7tv', `7tv:${SEVEN_ANIM}`, 'f'),
          emote: { provider: '7tv', id: `7tv:${SEVEN_ANIM}`, glyph: 'x' },
        }),
      ),
    ).toBe('emote_not_available');
    // One catalog fetch (6 endpoints) for all admissions: cached 10 min.
    expect(fake.calls).toHaveLength(6);
    core.clock.advance(11 * MINUTE);
    await bonk.thirdPartyCatalog();
    expect(fake.calls).toHaveLength(12);
  });

  it('a provider outage keeps the previous emotes; without any catalog the Bonk is refused', async () => {
    const down = await fixture({ sevenTvDown: true });
    expect(
      await code(down.bonk.admit(request('7tv', `7tv:${SEVEN_ANIM}`, 'x'))),
    ).toBe('emote_not_in_catalog');
    const catalog = await down.bonk.thirdPartyCatalog();
    expect(catalog.errors).toEqual({ '7tv': 'provider_unavailable' });
    expect(catalog.emotes.map((e) => e.provider)).not.toContain('7tv');
    // Disabled (no channel id configured): refused, never resolved from the caller.
    const core = await setup();
    const disabled = new BonkLabService(core.db, core.clock);
    expect(
      await code(disabled.admit(request('bttv', `bttv:${BTTV_ID}`, 'y'))),
    ).toBe('emote_not_in_catalog');
  });
});
