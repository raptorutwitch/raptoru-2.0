import type { LabChatMessage } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/db.js';
import { labEconomy } from '../src/economy/economy.js';
import { resolveDuelBet } from '../src/mini-games/duel-rules.js';
import { MiniGamesService } from '../src/mini-games/service.js';
import { ModuleHost } from '../src/modules/host.js';
import { miniGameLimits, miniGames } from '../src/modules/mini-games.js';
import { ModuleSettings } from '../src/module-settings/service.js';
import { createTestDb, FakeClock } from './helpers.js';

// Démonstration C (architecture socle): the historical mini-games join the module host — H10 settings (defaults = the
// values applied until now) and the shared supervision — without rewriting their service. Fictional data.

const CH = '900500';
const T0 = new Date('2026-10-16T21:00:00Z');
const SESSION = '00000000-0000-4000-8000-0000000000c1';

let db: Db;
let clock: FakeClock;
let settings: ModuleSettings;
let host: ModuleHost;
let games: MiniGamesService;

beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(T0);
  settings = new ModuleSettings(db, clock);
  host = new ModuleHost([miniGames], {
    db,
    clock,
    economy: labEconomy,
    settings,
  });
  // Every draw loses (0.9): only the stakes matter here, never the odds.
  games = new MiniGamesService(
    db,
    clock,
    () => 0.9,
    null,
    labEconomy,
    miniGameLimits(settings),
  );
});

const live = () =>
  db.query(
    `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
     values ($1, $2, $3, 'simulated', 'test') on conflict (session_id) do update set ended_at = null`,
    [SESSION, CH, clock.now()],
  );
let n = 0;
const msg = (
  text: string,
  who = { id: '2001', name: 'Alice' },
  source: 'twitch' | 'simulator' = 'twitch',
): LabChatMessage => ({
  channel_id: CH,
  message_id: `c-${++n}`,
  text,
  chatter: {
    id: who.id,
    login: who.name.toLowerCase(),
    display_name: who.name,
    role: 'viewer',
  },
  source,
});
const set = (key: string, value: number) =>
  settings.set(CH, `mini_games.${key}`, value, 'test');
const lastBet = async () =>
  Number(
    (
      await db.query<{ bet: string }>(
        'select bet from mini_game_plays order by created_at desc, message_id desc limit 1',
      )
    )[0]?.bet,
  );

describe('Mini-jeux on the module host (démonstration C)', () => {
  it('defaults = the historical rules: minimum 20, Roulette delay 10 s, « !slots » bets 20', async () => {
    await games.setEnabled(CH, true);
    await live();
    expect((await games.chat(msg('!roulette 19'))).skipped).toBe('below_min');
    expect((await games.chat(msg('!roulette 20'))).outcome).toBe(
      'mini_game_played',
    );
    expect((await games.chat(msg('!roulette 20'))).skipped).toBe('cooldown');
    clock.advance(10_000);
    expect((await games.chat(msg('!roulette 20'))).outcome).toBe(
      'mini_game_played',
    );
    await games.chat(msg('!slots'));
    expect(await lastBet()).toBe(20);
  });

  it('Studio sets the stakes and delays; the games apply them at once; out-of-bounds values are refused', async () => {
    await games.setEnabled(CH, true);
    await live();
    await set('roulette_min_bet', 50);
    await set('roulette_cooldown_s', 0);
    await set('slot_min_bet', 40);
    expect((await games.chat(msg('!roulette 20'))).skipped).toBe('below_min');
    expect((await games.chat(msg('!roulette 50'))).outcome).toBe(
      'mini_game_played',
    );
    expect((await games.chat(msg('!roulette 50'))).outcome).toBe(
      'mini_game_played',
    ); // no delay now
    await games.chat(msg('!slots'));
    expect(await lastBet()).toBe(40);
    await expect(set('roulette_min_bet', 0)).rejects.toMatchObject({
      code: 'out_of_bounds',
    });
    await expect(set('duel_max_bet', 2_000_000)).rejects.toMatchObject({
      code: 'out_of_bounds',
    });
  });

  it('the Duel cap: a higher stake is brought down to the channel’s cap (default 100 000)', async () => {
    expect(resolveDuelBet('200k', 1_000_000)).toEqual({
      amount: 100_000,
      capped: true,
    });
    expect(resolveDuelBet('1000', 5_000, 500)).toEqual({
      amount: 500,
      capped: true,
    });
    await games.setEnabled(CH, true);
    await live();
    await set('duel_max_bet', 500);
    const bob = { id: '2002', name: 'Bob' };
    await games.chat(msg('salut', bob, 'simulator')); // the simulator teaches Bob's identity (Duel target)
    expect(
      (await games.chat(msg('!duel @bob 1000', undefined, 'simulator')))
        .outcome,
    ).toBe('duel_challenged');
    const duel = (
      await db.query<{ bet: string }>(
        'select bet from mini_game_duels where channel_id = $1',
        [CH],
      )
    )[0];
    expect(Number(duel?.bet)).toBe(500);
  });

  it('supervision reads ITS switch and the live, never green on the switch alone', async () => {
    expect(await host.status(CH, 'mini_games')).toMatchObject({
      intention: 'off',
    });
    await games.setEnabled(CH, true);
    expect(await host.status(CH, 'mini_games')).toMatchObject({
      intention: 'on',
      observed: 'waiting',
      reasons: ['Aucun live ouvert sur la chaîne.'],
    });
    await live();
    await games.chat(msg('!roulette 20'));
    expect(await host.status(CH, 'mini_games')).toMatchObject({
      intention: 'on',
      observed: 'ready',
      activity: '1 partie la dernière heure',
    });
    const entry = (await host.catalog(CH)).modules[0]!;
    expect(entry).toMatchObject({
      id: 'mini_games',
      enabled: true,
      capabilities: ['settings', 'supervision'],
    });
    expect(entry.settings).toContain('mini_games.duel_max_bet');
    expect(entry.settings).not.toContain('mini_games.enabled'); // its own switch, never a second one
  });
});
