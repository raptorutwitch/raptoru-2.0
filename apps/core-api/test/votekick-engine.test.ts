import { VOTEKICK } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { VotekickEngine, type VkUser } from '../src/votekick/engine.js';
import { simulatedPorts } from '../src/votekick/simulators.js';

// Votekick V2 + Caution engine on simulated Twitch / Wallet / OBS mute (docs/VOTEKICK_V2.md): SAMMI's rules and
// texts, one vote at a time, duplicates and late events counted once, the broadcaster muted (never timed out), the
// caution re-checked before any debit and refunded once only when the release surely failed.

const BROADCASTER: VkUser = { id: '100', login: 'raptoru_', name: 'Raptoru_' };
const user = (n: number): VkUser => ({
  id: String(1000 + n),
  login: `viewer${n}`,
  name: `Viewer${n}`,
  avatar: `https://img/${n}.png`,
});
const [A, B, C, D, E, F, G, H] = [1, 2, 3, 4, 5, 6, 7, 8].map(user) as VkUser[];
const MOD = user(99);

function lab() {
  const s = simulatedPorts();
  s.twitch.add(BROADCASTER, A!, B!, C!, D!, E!, F!, G!, H!, MOD);
  s.twitch.moderators.add(MOD.id);
  const engine = new VotekickEngine(BROADCASTER.id, s.ports);
  let n = 0;
  const say = (u: VkUser, text: string, id = `m${++n}`) =>
    engine.chat({ id, user: u, text });
  const endVote = async () => {
    s.clock.advance(VOTEKICK.voteMs + VOTEKICK.finishGraceMs);
    await engine.tick();
  };
  return { ...s, engine, say, endVote };
}

describe('Votekick: opening', () => {
  it('opens with the initiator’s KICK, announces, shows the overlay, starts his hourly cooldown', async () => {
    const l = lab();
    expect(await l.say(A!, '!votekick @Viewer2')).toBe('opened');
    expect(l.chat).toEqual([
      '/announce ⚖️ Votekick lancé contre viewer2 par viewer1 ! Votez !kick ou !save pendant 60 secondes',
    ]);
    expect(l.overlay[0]).toMatchObject({
      action: 'live',
      target: 'viewer2',
      initiator: 'viewer1',
      avatar: 'https://img/2.png',
      yes: 1,
      no: 0,
      seq: 1,
    });
    expect(l.overlay[0]!.ends).toBe(l.clock.now() + 60_000);
    expect(await l.say(C!, '!votekick viewer3')).toBe('busy');
    await l.endVote();
    l.clock.advance(VOTEKICK.resultMs);
    await l.engine.tick();
    expect(await l.say(A!, '!votekick viewer3')).toBe('cooldown');
    expect(l.chat.at(-1)).toBe(
      '@viewer1 tu as déjà lancé un Votekick récemment',
    );
    l.clock.advance(VOTEKICK.initiatorCooldownMs);
    expect(await l.say(A!, '!votekick viewer3')).toBe('opened');
  });

  it('two `!votekick` at the same instant: one vote opens', async () => {
    const l = lab();
    const out = await Promise.all([
      l.say(A!, '!votekick viewer3'),
      l.say(B!, '!votekick viewer4'),
    ]);
    expect(out.sort()).toEqual(['busy', 'opened']);
    expect(l.overlay.filter((e) => e.action === 'live')).toHaveLength(1);
  });

  it('refusals: self, unknown, moderator, mods or Twitch unreadable — nothing opened, no cooldown', async () => {
    const l = lab();
    expect(await l.say(A!, '!votekick viewer1')).toBe('self');
    expect(await l.say(A!, '!votekick nobody')).toBe('unknown_target');
    expect(await l.say(A!, `!votekick ${MOD.login}`)).toBe('moderator');
    l.twitch.modsUnreadable = true;
    expect(await l.say(A!, '!votekick viewer2')).toBe('mods_unreadable');
    l.twitch.modsUnreadable = false;
    l.twitch.unreadable = true;
    expect(await l.say(A!, '!votekick viewer2')).toBe('twitch_unreadable');
    l.twitch.unreadable = false;
    expect(l.chat).toEqual([
      'Tu ne peux pas lancer un Votekick contre toi-même. (espèce d’aw)',
      'Utilisateur Twitch introuvable.',
      'Tu ne peux pas cibler un modérateur',
      'Impossible de vérifier les modérateurs Twitch. Votekick annulé par sécurité',
      'Impossible de vérifier cette cible Twitch. Réessaie dans quelques secondes',
    ]);
    expect(l.overlay).toEqual([]);
    expect(await l.say(A!, '!votekick viewer2')).toBe('opened');
  });

  it('help lines; other messages are not commands', async () => {
    const l = lab();
    expect(await l.say(A!, '!votekick')).toBe('help');
    expect(await l.say(A!, '!caution')).toBe('help');
    expect(await l.say(A!, 'salut !kick')).toBe('ignored');
    expect(await l.say(A!, '!KICK')).toBe('ignored'); // VK_VOTE is case sensitive
  });
});

describe('Votekick: votes', () => {
  it('the initiator cannot vote; a voter may change his mind; the same delivery counts once', async () => {
    const l = lab();
    await l.say(A!, '!votekick viewer2');
    expect(await l.say(A!, '!kick')).toBe('initiator');
    expect(await l.say(C!, '!save', 'dup')).toBe('counted');
    expect(await l.say(C!, '!save', 'dup')).toBe('replayed');
    expect(await l.say(C!, '!save')).toBe('same');
    expect(await l.say(C!, '!kick')).toBe('changed');
    expect(l.engine.state().vote).toMatchObject({ kick: 2, save: 0 });
    // Updates only when something changed, in order.
    const seqs = l.overlay.map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it('30 viewers voting at once: every ballot counted exactly once', async () => {
    const l = lab();
    const crowd = Array.from({ length: 30 }, (_, i) => user(200 + i));
    l.twitch.add(...crowd);
    await l.say(A!, '!votekick viewer2');
    await Promise.all(
      crowd.map((u, i) => l.say(u, i % 3 === 0 ? '!save' : '!kick')),
    );
    expect(l.engine.state().vote).toMatchObject({ kick: 1 + 20, save: 10 });
  });

  it('a ballot after the 60 s counts for nothing', async () => {
    const l = lab();
    await l.say(A!, '!votekick viewer2');
    l.clock.advance(60_000);
    expect(await l.say(C!, '!save')).toBe('no_vote');
  });
});

describe('Votekick: verdicts and sanctions', () => {
  it('KICK majority: the target timed out once, minutes of the KICK count, verdict then clear after 7 s', async () => {
    const l = lab();
    await l.say(A!, '!votekick viewer2');
    for (const u of [C, D, E]) await l.say(u!, '!kick');
    await l.say(F!, '!save');
    await l.endVote();
    expect(l.twitch.timeouts).toEqual([
      {
        login: 'viewer2',
        seconds: 8 * 60,
        reason: 'Votekick populaire — target_timeout',
      },
    ]);
    expect(l.overlay.at(-1)).toMatchObject({
      action: 'result',
      outcome: 'target_timeout',
      minutes: 8,
      yes: 4,
      no: 1,
    });
    await l.engine.tick();
    expect(l.overlay.at(-1)!.action).toBe('result');
    l.clock.advance(VOTEKICK.resultMs);
    await l.engine.tick();
    expect(l.overlay.at(-1)).toMatchObject({ action: 'clear' });
    expect(l.engine.history[0]).toMatchObject({
      outcome: 'target_timeout',
      punished: 'viewer2',
      sanction: 'twitch_timeout',
      applied: 'confirmed',
    });
  });

  it('Perfect (the target’s own SAVE does not spoil it), Backfire and the coin flip', async () => {
    let l = lab();
    await l.say(A!, '!votekick viewer2');
    await l.say(C!, '!kick');
    await l.say(D!, '!kick');
    await l.say(B!, '!save'); // the target himself
    await l.endVote();
    expect(l.overlay.at(-1)).toMatchObject({
      outcome: 'target_timeout_perfect',
      minutes: 12, // 3 KICK → 6 min, ×2
    });

    l = lab();
    await l.say(A!, '!votekick viewer2');
    await l.say(C!, '!save');
    await l.say(D!, '!save');
    await l.endVote();
    expect(l.twitch.timeouts).toEqual([
      {
        login: 'viewer1',
        seconds: 600,
        reason: 'Votekick populaire — backfire',
      },
    ]);

    l = lab();
    l.setCoin(1);
    await l.say(A!, '!votekick viewer2');
    await l.say(C!, '!kick');
    await l.say(D!, '!save');
    await l.say(E!, '!save');
    await l.endVote();
    expect(l.overlay.at(-1)).toMatchObject({
      outcome: 'coinflip_initiator',
      minutes: 5,
    });
    expect(l.twitch.timeouts[0]!.login).toBe('viewer1');
  });

  it('no quorum and saved: nobody sanctioned', async () => {
    const l = lab();
    await l.say(A!, '!votekick viewer2');
    await l.say(C!, '!save');
    await l.endVote();
    expect(l.overlay.at(-1)).toMatchObject({ outcome: 'no_quorum' });
    expect(l.twitch.timeouts).toEqual([]);
  });

  it('Twitch refuses the timeout: said in chat, history shows it', async () => {
    const l = lab();
    l.twitch.timeoutAnswer = 'refused';
    await l.say(A!, '!votekick viewer2');
    await l.say(C!, '!kick');
    await l.say(D!, '!kick');
    await l.endVote();
    expect(l.chat.at(-1)).toBe(
      'Twitch a refusé le timeout de viewer2 (Votekick).',
    );
    expect(l.engine.history[0]!.applied).toBe('refused');
  });

  it('a new vote opened during the verdict is never cleared by the old verdict', async () => {
    const l = lab();
    await l.say(A!, '!votekick viewer2');
    await l.endVote();
    l.clock.advance(2_000);
    await l.say(C!, '!votekick viewer4');
    l.clock.advance(VOTEKICK.resultMs);
    await l.engine.tick();
    expect(l.overlay.at(-1)!.action).toBe('live');
  });

  it('the broadcaster loses: muted (never a Twitch timeout), then unmuted once at the end', async () => {
    const l = lab();
    await l.say(A!, '!votekick raptoru_');
    for (const u of [C, D, E]) await l.say(u!, '!kick'); // 4 KICK → 8 min → Perfect 16 min → 80 s
    await l.endVote();
    expect(l.twitch.timeouts).toEqual([]);
    expect(l.overlay.at(-1)).toMatchObject({
      outcome: 'broadcaster_muted',
      mute_seconds: 80,
      minutes: 16,
    });
    const id = l.mute.log[0]!.split(' ')[1]!;
    expect(l.mute.log).toEqual([`start ${id} 80s`]);
    expect(await l.say(F!, '!votekick raptoru_')).toBe('already_muted');
    l.clock.advance(80_000);
    await l.engine.tick();
    await l.engine.tick();
    expect(l.mute.log).toEqual([`start ${id} 80s`, `end ${id} expired`]);
  });

  it('the broadcaster starts a vote and gets a Backfire: muted himself, named on the overlay', async () => {
    const l = lab();
    await l.say(BROADCASTER, '!votekick viewer2');
    await l.say(C!, '!save');
    await l.say(D!, '!save'); // 1 KICK vs 2 SAVE → Backfire 10 min → 50 s of mute
    await l.endVote();
    expect(l.twitch.timeouts).toEqual([]);
    expect(l.overlay.at(-1)).toMatchObject({
      outcome: 'broadcaster_muted',
      target: 'viewer2',
      punished: 'raptoru_',
      mute_seconds: 50,
    });
  });

  it('OBS unreachable when the broadcaster loses: said in chat, no mute recorded, the next vote works', async () => {
    const l = lab();
    l.ports.mute.start = async () => {
      throw new Error('obs_offline');
    };
    await l.say(A!, '!votekick raptoru_');
    for (const u of [C, D, E]) await l.say(u!, '!kick');
    await l.endVote();
    expect(l.chat.at(-1)).toBe(
      'Mute du streamer impossible pour le moment (OBS).',
    );
    expect(l.engine.state().mute).toBeNull();
    expect(l.engine.history[0]!.applied).toBeNull();
    l.clock.advance(VOTEKICK.resultMs);
    await l.engine.tick();
    expect(await l.say(F!, '!votekick viewer2')).toBe('opened');
  });
});

describe('Caution', () => {
  async function timedOut(l: ReturnType<typeof lab>, minutes = 8) {
    l.twitch.sanctions.set(B!.id, l.clock.now() + minutes * 60_000);
  }

  it('quote (1 000 Jetons / started minute), only the payer answers, `oui` pays and frees', async () => {
    const l = lab();
    await timedOut(l);
    l.clock.advance(30_500); // 7 min 29.5 s left → 8 minutes
    l.wallet.balances.set(C!.id, 10_000);
    expect(await l.say(C!, '!caution @Viewer2')).toBe('quoted');
    expect(l.chat.at(-1)).toBe(
      'viewer2 est encore timeout pour environ 8 minute(s) ! Coût de la caution : 8 000 jetons. viewer3, réponds oui pour payer ou non pour annuler.',
    );
    expect(await l.say(D!, 'oui')).toBe('ignored');
    expect(await l.say(D!, '!caution viewer2')).toBe('quote_pending');
    expect(await l.say(C!, 'OUI')).toBe('released');
    expect(l.chat.at(-1)).toBe(
      'viewer3 paie 8 000 jetons : viewer2 est libéré !',
    );
    expect(l.wallet.balances.get(C!.id)).toBe(2_000);
    expect(l.twitch.releases).toEqual(['viewer2']);
  });

  it('`oui` twice at once: one debit, one release', async () => {
    const l = lab();
    await timedOut(l);
    l.wallet.balances.set(C!.id, 10_000);
    await l.say(C!, '!caution viewer2');
    const out = await Promise.all([l.say(C!, 'oui'), l.say(C!, 'oui')]);
    expect(out.sort()).toEqual(['ignored', 'released']);
    expect(l.wallet.debits.size).toBe(1);
    expect(l.twitch.releases).toHaveLength(1);
  });

  it('`non`, an expired quote, not enough Jetons, Wallet down: nothing debited, nothing lifted', async () => {
    const l = lab();
    await timedOut(l, 20);
    l.wallet.balances.set(C!.id, 3_000);
    await l.say(C!, '!caution viewer2');
    expect(await l.say(C!, 'non')).toBe('cancelled');
    await l.say(C!, '!caution viewer2');
    l.clock.advance(30_000);
    expect(await l.say(C!, 'oui')).toBe('expired');
    await l.say(C!, '!caution viewer2');
    expect(await l.say(C!, 'oui')).toBe('insufficient');
    expect(l.chat.at(-1)).toBe(
      'viewer3, tu es trop pauvre pour payer cette caution ptdr bouge de là. Il faut 20 000 jetons et tu en as 3 000.',
    );
    l.wallet.unavailable = true;
    await l.say(C!, '!caution viewer2');
    expect(await l.say(C!, 'oui')).toBe('wallet_unavailable');
    expect(l.wallet.debits.size).toBe(0);
    expect(l.twitch.releases).toEqual([]);
  });

  it('the timeout ended before the answer: nothing debited', async () => {
    const l = lab();
    await timedOut(l, 1);
    l.wallet.balances.set(C!.id, 10_000);
    await l.say(C!, '!caution viewer2');
    l.twitch.sanctions.delete(B!.id);
    expect(await l.say(C!, 'oui')).toBe('not_timed_out');
    expect(l.wallet.debits.size).toBe(0);
  });

  it('release refused or ineffective: refunded once; unknown result: never refunded automatically', async () => {
    let l = lab();
    await timedOut(l);
    l.wallet.balances.set(C!.id, 10_000);
    l.twitch.releaseAnswer = 'refused';
    await l.say(C!, '!caution viewer2');
    expect(await l.say(C!, 'oui')).toBe('refunded');
    expect(l.wallet.balances.get(C!.id)).toBe(10_000);

    l = lab();
    await timedOut(l);
    l.wallet.balances.set(C!.id, 10_000);
    l.twitch.releaseIneffective = true;
    await l.say(C!, '!caution viewer2');
    expect(await l.say(C!, 'oui')).toBe('refunded');
    expect(l.wallet.refunds.size).toBe(1);

    // Twitch's answer unknown but the check shows the timeout lifted: freed, nothing refunded.
    l = lab();
    await timedOut(l);
    l.wallet.balances.set(C!.id, 10_000);
    l.twitch.releaseAnswer = 'uncertain';
    await l.say(C!, '!caution viewer2');
    expect(await l.say(C!, 'oui')).toBe('released');
    expect(l.wallet.refunds.size).toBe(0);

    // Twitch's answer AND the check unknown: maybe freed — kept « to verify », never refunded automatically.
    l = lab();
    await timedOut(l);
    l.wallet.balances.set(C!.id, 10_000);
    l.twitch.releaseAnswer = 'uncertain';
    await l.say(C!, '!caution viewer2');
    const sanction = l.ports.twitch.sanction;
    let calls = 0;
    l.ports.twitch.sanction = async (id) => {
      if (++calls > 1) throw new Error('unreadable'); // re-check ok, verification unreadable
      return sanction(id);
    };
    expect(await l.say(C!, 'oui')).toBe('to_verify');
    expect(l.wallet.refunds.size).toBe(0);
    expect(l.wallet.balances.get(C!.id)).toBe(2_000);
  });

  it('refusals: own caution, no timeout, permanent ban', async () => {
    const l = lab();
    expect(await l.say(B!, '!caution viewer2')).toBe('self');
    expect(await l.say(C!, '!caution viewer2')).toBe('no_timeout');
    l.twitch.sanctions.set(B!.id, 'permanent');
    expect(await l.say(C!, '!caution viewer2')).toBe('permanent');
  });

  it('the broadcaster’s mute: priced on the seconds left, paying ends it once (never again at its old end)', async () => {
    const l = lab();
    expect(await l.say(C!, '!caution raptoru_')).toBe('not_muted');
    await l.say(A!, '!votekick raptoru_');
    for (const u of [C, D, E]) await l.say(u!, '!kick');
    await l.endVote(); // muted 80 s
    l.clock.advance(15_000);
    l.wallet.balances.set(F!.id, 5_000);
    expect(await l.say(F!, '!caution raptoru_')).toBe('quoted');
    expect(l.chat.at(-1)).toBe(
      'raptoru_ est réduit au silence pour encore environ 65 seconde(s) ! Coût de la caution : 2 000 jetons. viewer6, réponds oui pour payer ou non pour annuler.',
    );
    expect(await l.say(F!, 'oui')).toBe('released');
    const id = l.mute.log[0]!.split(' ')[1]!;
    expect(l.mute.log).toEqual([`start ${id} 80s`, `end ${id} caution`]);
    l.clock.advance(80_000);
    await l.engine.tick();
    expect(l.mute.log).toHaveLength(2);
    expect(l.wallet.balances.get(F!.id)).toBe(3_000);
  });
});
