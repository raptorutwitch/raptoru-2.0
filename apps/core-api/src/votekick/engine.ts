import {
  broadcasterMuteSeconds,
  CAUTION,
  cautionPrice,
  VOTEKICK,
  votekickVerdict,
  type VotekickOutcome,
  type VotekickOverlayEvent,
} from '@raptoru/schemas';

// Votekick V2 + Caution (docs/VOTEKICK_V2.md) — the SAMMI buttons VK_START / VK_VOTE / VK_FINISH / VK_MUTE_BROADCASTER
// and CAUTION_START / CONFIRM / FINISH as ONE deterministic engine per channel. Rules: @raptoru/schemas votekick.ts;
// chat texts: SAMMI's. Everything outside goes through ports (Twitch reads / timeouts, the Wallet, the broadcaster's
// mute in OBS through Studio, the chat, the overlay), so the Lab runs it on simulators and the tests on fakes.
// Time never comes from a hidden timer: `tick()` ends what is due (the vote after 60 s, the mute, the verdict on
// screen), from the injected clock. Kept from SAMMI on purpose: one vote at a time, the initiator's automatic KICK,
// the hourly cooldown recorded once the vote opens, any viewer can pay anyone's caution (never his own), one quote at
// a time answered by its payer only, the quoted price. V2 differences (all safety): a session id + sequence on every
// overlay event; a vote, an answer or a delivery seen twice counts once; nothing is debited before the sanction is
// re-checked; a release Twitch did not confirm is refunded only when it surely failed (« uncertain » is kept to verify,
// never refunded twice); the broadcaster is never sent a Twitch timeout (muted instead).

export interface VkUser {
  id: string;
  login: string;
  name: string;
  avatar?: string;
}

export type TimeoutResult = 'confirmed' | 'refused' | 'uncertain';
export type ReleaseResult = 'released' | 'refused' | 'uncertain';

/** Thrown by `wallet.debit` when the payer cannot pay (balance known). */
export class InsufficientJetonsError extends Error {
  constructor(readonly balance: number) {
    super('insufficient_jetons');
  }
}

export interface VotekickPorts {
  now(): number;
  /** 0 = the target loses the coin flip, 1 = the initiator. */
  coin(): 0 | 1;
  twitch: {
    /** null: no such user; throws: Twitch unreadable. */
    user(login: string): Promise<VkUser | null>;
    /** Throws when the moderators cannot be read (the vote is then refused, like SAMMI). */
    isModerator(userId: string): Promise<boolean>;
    timeout(
      user: VkUser,
      seconds: number,
      reason: string,
    ): Promise<TimeoutResult>;
    untimeout(user: VkUser): Promise<ReleaseResult>;
    /** The user's active sanction: a timeout's end (ms), a permanent ban, or none. Throws when unreadable. */
    sanction(userId: string): Promise<{ endsAt: number } | 'permanent' | null>;
  };
  /** The broadcaster's mute in OBS (Studio's mute controller, apps/studio/server/src/votekick). */
  mute: {
    start(muteId: string, seconds: number): Promise<void>;
    end(muteId: string, reason: 'expired' | 'caution'): Promise<void>;
  };
  wallet: {
    /** Idempotent per `ref`; throws InsufficientJetonsError, or anything else when the Wallet is unavailable. */
    debit(ref: string, payer: VkUser, amount: number): Promise<void>;
    /** Idempotent per `ref`. */
    refund(ref: string, reason: string): Promise<void>;
  };
  say(text: string, announce?: boolean): Promise<void>;
  overlay(event: VotekickOverlayEvent): void;
}

export interface VkChatMessage {
  /** The Twitch message id (a delivery seen twice counts once). */
  id: string;
  user: VkUser;
  text: string;
}

interface Vote {
  session: string;
  initiator: VkUser;
  target: VkUser;
  endsAt: number;
  /** voter id → choice; the initiator is not in it (his KICK is counted apart). */
  ballots: Map<string, 'kick' | 'save'>;
  closing: boolean;
}

interface Quote {
  id: string;
  payer: VkUser;
  target: VkUser;
  kind: 'mute' | 'timeout';
  price: number;
  expiresAt: number;
  processing: boolean;
}

export interface VotekickHistoryEntry {
  session: string;
  initiator: string;
  target: string;
  kick: number;
  save: number;
  outcome: VotekickOutcome;
  punished: string | null;
  minutes: number;
  sanction: 'none' | 'twitch_timeout' | 'obs_mute';
  applied: TimeoutResult | 'muted' | null;
}

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/\s/g, ' ');
const firstWord = (text: string) => text.trim().split(/\s+/)[1] ?? '';
const cleanLogin = (s: string) => s.replace(/[@\s]/g, '').toLowerCase();

export class VotekickEngine {
  private vote: Vote | null = null;
  private starting = false;
  private seq = 0;
  private clearAt: number | null = null;
  private readonly cooldowns = new Map<string, number>();
  private mute: { id: string; endsAt: number } | null = null;
  private quote: Quote | null = null;
  private readonly seen = new Set<string>();
  readonly history: VotekickHistoryEntry[] = [];

  constructor(
    private readonly broadcasterId: string,
    private readonly p: VotekickPorts,
  ) {}

  /** One chat message (the bot's delivery). The outcome is for tests and logs. */
  async chat(m: VkChatMessage): Promise<string> {
    const text = m.text.trim();
    if (this.seen.has(m.id)) return 'replayed';
    const lower = text.toLowerCase();
    const command =
      /^!votekick(\s|$)/i.test(text) ||
      text === VOTEKICK.kickCommand ||
      text === VOTEKICK.saveCommand ||
      /^!caution(\s|$)/i.test(text) ||
      lower === CAUTION.confirmWord ||
      lower === CAUTION.cancelWord;
    if (!command) return 'ignored';
    this.remember(m.id);
    if (/^!votekick$/i.test(text)) {
      await this.p.say(
        'Pour lancer un vote contre quelqu’un du chat -> !votekick pseudo',
      );
      return 'help';
    }
    if (/^!caution$/i.test(text)) {
      await this.p.say(
        'Lève le ban de quelqu’un en payant pour lui - !caution "pseudo"',
      );
      return 'help';
    }
    if (/^!votekick\s/i.test(text)) return this.start(m.user, firstWord(text));
    if (text === VOTEKICK.kickCommand) return this.ballot(m.user, 'kick');
    if (text === VOTEKICK.saveCommand) return this.ballot(m.user, 'save');
    if (/^!caution\s/i.test(text))
      return this.cautionStart(m.user, firstWord(text));
    return this.cautionAnswer(m.user, lower === CAUTION.confirmWord);
  }

  /** Ends what is due: the vote (60 s), the verdict on screen, the broadcaster's mute. */
  async tick() {
    const now = this.p.now();
    if (
      this.vote &&
      !this.vote.closing &&
      now >= this.vote.endsAt + VOTEKICK.finishGraceMs
    )
      await this.finish(this.vote);
    if (this.clearAt !== null && now >= this.clearAt && !this.vote) {
      this.clearAt = null;
      this.emit({ action: 'clear' });
    }
    if (this.mute && now >= this.mute.endsAt) {
      const id = this.mute.id;
      this.mute = null;
      await this.p.mute.end(id, 'expired');
    }
  }

  state() {
    const now = this.p.now();
    return {
      vote: this.vote && {
        session: this.vote.session,
        target: this.vote.target.login,
        initiator: this.vote.initiator.login,
        ...this.tally(this.vote),
        remainingMs: Math.max(0, this.vote.endsAt - now),
      },
      mute: this.mute && {
        id: this.mute.id,
        remainingS: this.muteRemainingS(),
      },
      quote: this.quote && {
        payer: this.quote.payer.login,
        target: this.quote.target.login,
        kind: this.quote.kind,
        price: this.quote.price,
        expiresInMs: Math.max(0, this.quote.expiresAt - now),
      },
    };
  }

  // --- Votekick ---------------------------------------------------------------------------------------------------

  private async start(initiator: VkUser, input: string): Promise<string> {
    if (this.vote || this.starting) {
      await this.p.say('Un Votekick est déjà en cours.');
      return 'busy';
    }
    const now = this.p.now();
    if (now < (this.cooldowns.get(initiator.id) ?? 0)) {
      await this.p.say(
        `@${initiator.login} tu as déjà lancé un Votekick récemment`,
      );
      return 'cooldown';
    }
    // Reserved before the first await: two `!votekick` at once open one vote.
    this.starting = true;
    try {
      let target: VkUser | null;
      try {
        target = await this.p.twitch.user(cleanLogin(input));
      } catch {
        await this.p.say(
          'Impossible de vérifier cette cible Twitch. Réessaie dans quelques secondes',
        );
        return 'twitch_unreadable';
      }
      if (!target) {
        await this.p.say('Utilisateur Twitch introuvable.');
        return 'unknown_target';
      }
      if (target.id === initiator.id) {
        await this.p.say(
          'Tu ne peux pas lancer un Votekick contre toi-même. (espèce d’aw)',
        );
        return 'self';
      }
      if (target.id === this.broadcasterId && this.mute) {
        await this.p.say(
          `${target.login} est déjà réduit au silence pour encore environ ${this.muteRemainingS()} seconde(s).`,
        );
        return 'already_muted';
      }
      let moderator: boolean;
      try {
        moderator = await this.p.twitch.isModerator(target.id);
      } catch {
        await this.p.say(
          'Impossible de vérifier les modérateurs Twitch. Votekick annulé par sécurité',
        );
        return 'mods_unreadable';
      }
      if (moderator) {
        await this.p.say('Tu ne peux pas cibler un modérateur');
        return 'moderator';
      }
      const opened = this.p.now();
      this.vote = {
        session: `${opened}-${initiator.id}-${target.id}`,
        initiator,
        target,
        endsAt: opened + VOTEKICK.voteMs,
        ballots: new Map(),
        closing: false,
      };
      this.clearAt = null;
      this.cooldowns.set(initiator.id, opened + VOTEKICK.initiatorCooldownMs);
      await this.p.say(
        `⚖️ Votekick lancé contre ${target.login} par ${initiator.login} ! Votez !kick ou !save pendant 60 secondes`,
        true,
      );
      this.emitLive(this.vote);
      return 'opened';
    } finally {
      this.starting = false;
    }
  }

  private async ballot(voter: VkUser, choice: 'kick' | 'save') {
    const v = this.vote;
    if (!v || v.closing || this.p.now() >= v.endsAt) return 'no_vote';
    if (voter.id === v.initiator.id) {
      await this.p.say(
        `@${voter.login} l'initiateur ne peut pas voter dans son propre procès`,
      );
      return 'initiator';
    }
    if (v.ballots.get(voter.id) === choice) return 'same';
    const changed = v.ballots.has(voter.id);
    v.ballots.set(voter.id, choice);
    this.emitLive(v);
    return changed ? 'changed' : 'counted';
  }

  private tally(v: Vote) {
    let kick = VOTEKICK.initiatorKicks ? 1 : 0;
    let save = 0;
    for (const c of v.ballots.values()) {
      if (c === 'kick') kick++;
      else save++;
    }
    return {
      kick,
      save,
      targetSaved: v.ballots.get(v.target.id) === 'save',
    };
  }

  private async finish(v: Vote) {
    v.closing = true; // no ballot counts from here (a late `!kick` changes nothing)
    const t = this.tally(v);
    const verdict = votekickVerdict(t, this.p.coin);
    const punished =
      verdict.punished === 'target'
        ? v.target
        : verdict.punished === 'initiator'
          ? v.initiator
          : null;
    let overlayOutcome: VotekickOverlayEvent['outcome'] = verdict.outcome;
    let muteSeconds = 0;
    let sanction: VotekickHistoryEntry['sanction'] = 'none';
    let applied: VotekickHistoryEntry['applied'] = null;
    if (punished?.id === this.broadcasterId) {
      // The broadcaster cannot be timed out: muted instead (VK_MUTE_BROADCASTER).
      overlayOutcome = 'broadcaster_muted';
      muteSeconds = broadcasterMuteSeconds(verdict.durationS);
      sanction = 'obs_mute';
      const id = `mute:${v.session}`;
      this.mute = { id, endsAt: this.p.now() + muteSeconds * 1000 };
      await this.p.mute.start(id, muteSeconds);
      applied = 'muted';
    } else if (punished) {
      sanction = 'twitch_timeout';
      applied = await this.p.twitch
        .timeout(
          punished,
          verdict.durationS,
          `Votekick populaire — ${verdict.outcome}`,
        )
        .catch((): TimeoutResult => 'uncertain');
      if (applied === 'refused')
        await this.p.say(
          `Twitch a refusé le timeout de ${punished.login} (Votekick).`,
        );
    }
    this.history.unshift({
      session: v.session,
      initiator: v.initiator.login,
      target: v.target.login,
      kick: t.kick,
      save: t.save,
      outcome: verdict.outcome,
      punished: punished?.login ?? null,
      minutes: verdict.minutes,
      sanction,
      applied,
    });
    this.history.length = Math.min(this.history.length, 50);
    this.emit({
      action: 'result',
      session: v.session,
      target: v.target.login,
      initiator: v.initiator.login,
      avatar: v.target.avatar ?? '',
      yes: t.kick,
      no: t.save,
      outcome: overlayOutcome,
      minutes: verdict.minutes,
      mute_seconds: muteSeconds,
    });
    this.vote = null;
    this.clearAt = this.p.now() + VOTEKICK.resultMs;
  }

  // --- Caution ----------------------------------------------------------------------------------------------------

  private muteRemainingS() {
    return this.mute
      ? Math.max(0, Math.ceil((this.mute.endsAt - this.p.now()) / 1000))
      : 0;
  }

  private quoteOpen() {
    return !!this.quote && this.p.now() < this.quote.expiresAt;
  }

  private async cautionStart(payer: VkUser, input: string): Promise<string> {
    if (this.quoteOpen() || this.quote?.processing) {
      const q = this.quote!;
      await this.p.say(
        `Une caution pour ${q.target.login} attend déjà la réponse de ${q.payer.login}.`,
      );
      return 'quote_pending';
    }
    const login = cleanLogin(input);
    let target: VkUser | null;
    try {
      target = await this.p.twitch.user(login);
    } catch {
      target = null;
    }
    if (!target) {
      await this.p.say(
        `${payer.login}, utilisateur Twitch introuvable : ${login} Vérifie le pseudo`,
      );
      return 'unknown_target';
    }
    if (target.id === payer.id) {
      await this.p.say(
        `${payer.login}, tu ne peux pas payer ta propre caution`,
      );
      return 'self';
    }
    const now = this.p.now();
    const open = (kind: Quote['kind'], remainingS: number) => {
      const price = cautionPrice(remainingS);
      this.quote = {
        id: `caution:${payer.id}:${target.id}:${now}`,
        payer,
        target,
        kind,
        price,
        expiresAt: now + CAUTION.quoteMs,
        processing: false,
      };
      return price;
    };
    if (target.id === this.broadcasterId) {
      if (!this.mute) {
        await this.p.say(
          `${target.login} n'est pas actuellement réduit au silence.`,
        );
        return 'not_muted';
      }
      const remainingS = this.muteRemainingS();
      const price = open('mute', remainingS);
      await this.p.say(
        `${target.login} est réduit au silence pour encore environ ${remainingS} seconde(s) ! Coût de la caution : ${fmt(price)} jetons. ${payer.login}, réponds oui pour payer ou non pour annuler.`,
      );
      return 'quoted';
    }
    let s: Awaited<ReturnType<VotekickPorts['twitch']['sanction']>>;
    try {
      s = await this.p.twitch.sanction(target.id);
    } catch {
      await this.p.say(
        `Impossible de vérifier le timeout de ${target.login} pour le moment.`,
      );
      return 'twitch_unreadable';
    }
    if (!s) {
      await this.p.say(`${target.login} n'a aucun timeout actif`);
      return 'no_timeout';
    }
    if (s === 'permanent') {
      await this.p.say(
        `Le ban permanent de ${target.login} ne peut pas être racheté`,
      );
      return 'permanent';
    }
    const remainingS = Math.ceil((s.endsAt - now) / 1000);
    if (remainingS <= 0) {
      await this.p.say(`Le timeout de ${target.login} est déjà terminé.`);
      return 'ended';
    }
    const price = open('timeout', remainingS);
    await this.p.say(
      `${target.login} est encore timeout pour environ ${Math.ceil(remainingS / 60)} minute(s) ! Coût de la caution : ${fmt(price)} jetons. ${payer.login}, réponds oui pour payer ou non pour annuler.`,
    );
    return 'quoted';
  }

  private async cautionAnswer(payer: VkUser, yes: boolean): Promise<string> {
    const q = this.quote;
    // Only the payer of the quote, once (a second `oui` while it is processed changes nothing).
    if (!q || q.payer.id !== payer.id || q.processing) return 'ignored';
    const reset = () => {
      if (this.quote === q) this.quote = null;
    };
    if (!yes) {
      reset();
      await this.p.say(
        `Caution annulée par ${payer.login}. Aucun jeton débité.`,
      );
      return 'cancelled';
    }
    if (this.p.now() >= q.expiresAt) {
      reset();
      await this.p.say(
        'Cette proposition de caution a expiré. Relance !caution @pseudo.',
      );
      return 'expired';
    }
    q.processing = true;
    try {
      // Re-checked BEFORE any debit.
      if (q.kind === 'mute') {
        if (!this.mute) {
          await this.p.say(
            `${q.target.login} n'est plus réduit au silence. Aucun jeton débité.`,
          );
          return 'not_muted';
        }
        if (this.muteRemainingS() <= 0) {
          await this.p.say(
            `Le mute de ${q.target.login} vient de se terminer. Aucun jeton débité.`,
          );
          return 'ended';
        }
      } else {
        let s: Awaited<ReturnType<VotekickPorts['twitch']['sanction']>>;
        try {
          s = await this.p.twitch.sanction(q.target.id);
        } catch {
          await this.p.say(
            `Impossible de vérifier le timeout de ${q.target.login}. Aucun jeton débité.`,
          );
          return 'twitch_unreadable';
        }
        if (!s || s === 'permanent' || s.endsAt <= this.p.now()) {
          await this.p.say(
            `${q.target.login} n'est plus en timeout. Aucun jeton débité.`,
          );
          return 'not_timed_out';
        }
      }
      try {
        await this.p.wallet.debit(q.id, payer, q.price);
      } catch (e) {
        if (e instanceof InsufficientJetonsError) {
          await this.p.say(
            `${payer.login}, tu es trop pauvre pour payer cette caution ptdr bouge de là. Il faut ${fmt(q.price)} jetons et tu en as ${fmt(e.balance)}.`,
          );
          return 'insufficient';
        }
        await this.p.say(
          `${payer.login}, impossible de vérifier ton solde pour le moment. Aucun jeton débité, aucune sanction levée.`,
        );
        return 'wallet_unavailable';
      }
      return await this.release(q);
    } finally {
      reset();
    }
  }

  /** CAUTION_FINISH: the sanction lifted, checked; refunded once when it surely failed. */
  private async release(q: Quote): Promise<string> {
    const freed = `${q.payer.login} paie ${fmt(q.price)} jetons : ${q.target.login} est libéré !`;
    if (q.kind === 'mute') {
      const m = this.mute;
      this.mute = null;
      if (m) await this.p.mute.end(m.id, 'caution');
      await this.p.say(freed);
      return 'released';
    }
    const result = await this.p.twitch
      .untimeout(q.target)
      .catch((): ReleaseResult => 'uncertain');
    let still: boolean | null; // null: unreadable
    try {
      const s = await this.p.twitch.sanction(q.target.id);
      still = !!s && (s === 'permanent' || s.endsAt > this.p.now());
    } catch {
      still = null;
    }
    if (still === false && result !== 'refused') {
      await this.p.say(freed);
      return 'released';
    }
    if (result === 'refused' || still === true) {
      try {
        await this.p.wallet.refund(
          q.id,
          `Caution : libération de ${q.target.login} échouée`,
        );
        await this.p.say(
          `La libération de ${q.target.login} a échoué : ${q.payer.login} a été remboursé de ${fmt(q.price)} jetons.`,
        );
        return 'refunded';
      } catch {
        await this.p.say(
          `ERREUR : la libération et le remboursement de ${q.payer.login} ont échoué. Remboursement manuel requis : ${fmt(q.price)} jetons.`,
        );
        return 'refund_failed';
      }
    }
    // Twitch's answer and the check are both unknown: maybe freed — never refunded automatically.
    await this.p.say(
      `Libération de ${q.target.login} envoyée, résultat à vérifier (${fmt(q.price)} jetons payés par ${q.payer.login}).`,
    );
    return 'to_verify';
  }

  // --- Overlay ----------------------------------------------------------------------------------------------------

  private emitLive(v: Vote) {
    const t = this.tally(v);
    this.emit({
      action: 'live',
      session: v.session,
      target: v.target.login,
      initiator: v.initiator.login,
      avatar: v.target.avatar ?? '',
      yes: t.kick,
      no: t.save,
      ends: v.endsAt,
    });
  }

  private emit(e: VotekickOverlayEvent) {
    this.p.overlay({ ...e, seq: ++this.seq });
  }

  private remember(id: string) {
    this.seen.add(id);
    if (this.seen.size > 2000) {
      const first = this.seen.values().next().value;
      if (first !== undefined) this.seen.delete(first);
    }
  }
}
