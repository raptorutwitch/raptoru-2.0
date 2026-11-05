import type { LabActor, LabChatMessage } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { ModuleSettings } from '../src/module-settings/service.js';
import { ModuleHost } from '../src/modules/host.js';
import type { ModuleDefinition } from '../src/modules/kit.js';
import { labEconomy } from '../src/economy/economy.js';
import { setup } from './helpers.js';

// The module host's chat door (architecture socle § 2.6): a module reads the chat behind the host's switch, its words are
// reserved against Commands V2, LeCroupier_ answers with the origin `module:<id>` (no migration per module), a resent
// message never answers twice, and a failing module never takes the chat down for the others. Fictional channel.

const CH = '900331';
const studio: LabActor = { id: 'studio', role: 'broadcaster', via: 'studio' };
let n = 0;
const msg = (text: string, id = `m-${++n}`): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter: { id: '900332', login: 'fictif', display_name: 'Fictif', role: 'viewer' },
  source: 'simulator',
});
const steps = (db: Awaited<ReturnType<typeof setup>>['db']) =>
  db.query<{ origin: string; text: string }>(
    "select origin, params->>'text' as text from cmd_steps where channel_id = $1 order by seq_global",
    [CH],
  );

describe('module host — chat door', () => {
  it('OFF by default (reads nothing); ON: answers once per message with its own origin; its word is reserved', async () => {
    const core = await setup();
    const objectif = core.modules.chatModules().find((m) => m.name === 'objectif_soiree')!;
    expect(await objectif.chat!(msg('!objectif'))).toEqual({ outcome: 'ignored' });
    expect(await steps(core.db)).toEqual([]);
    await core.moduleSettings.set(CH, 'objectif_soiree.enabled', 1, 'test');
    await core.modules.admin(CH, 'objectif_soiree', 'ajouter', { actor: studio, input: { points: 7 } });
    const m = msg('!objectif');
    expect(await objectif.chat!(m)).toMatchObject({ outcome: 'objective_said', replayed: false });
    expect(await objectif.chat!(m)).toMatchObject({ outcome: 'objective_said', replayed: true }); // resent
    expect(await steps(core.db)).toEqual([
      { origin: 'module:objectif_soiree', text: 'Objectif de soirée : 7 / 50 points.' },
    ]);
    expect(await objectif.chat!(msg('bonjour'))).toEqual({ outcome: 'ignored' });
    // Commands V2 sees the word as the module's (never two answers to « !objectif »).
    const list = await core.chat.commands.list(CH, studio);
    expect(list.reserved_words).toContainEqual({ word: 'objectif', module: 'Objectif de soirée' });
  });

  it('a module that throws is isolated (module_error); the host refuses chat without words, and words without chat', async () => {
    const core = await setup();
    const broken: ModuleDefinition = {
      id: 'casse_chat',
      label: 'Cassé',
      description: 'lit le chat et échoue',
      category: 'outils',
      capabilities: ['chat'],
      chatWords: ['casse'],
      enabledByDefault: true,
      chat: () => ({
        name: 'x',
        chat: async () => {
          throw new Error('boom');
        },
      }),
    };
    const settings = new ModuleSettings(core.db, core.clock);
    const host = new ModuleHost([broken], { db: core.db, clock: core.clock, economy: labEconomy, settings });
    expect(await host.chatModules()[0]!.chat!(msg('!casse'))).toEqual({ outcome: 'module_error' });
    expect(() =>
      new ModuleHost([{ ...broken, id: 'sans_mots', chatWords: undefined }], {
        db: core.db,
        clock: core.clock,
        economy: labEconomy,
        settings: new ModuleSettings(core.db, core.clock),
      }),
    ).toThrow(/sans mots réservés/);
    expect(() =>
      new ModuleHost([{ ...broken, id: 'mots_seuls', chat: undefined, capabilities: [] }], {
        db: core.db,
        clock: core.clock,
        economy: labEconomy,
        settings: new ModuleSettings(core.db, core.clock),
      }),
    ).toThrow(/mots réservés sans lecture/);
  });
});
