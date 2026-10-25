import type { LabChatMessage } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import { lockViewer, readMode } from './rights.js';
import type { SubWheelService } from './service.js';

// Roue du Sub V2 in the chat (docs/SUB_WHEEL_V2_PLAN.md § 10 bis): « !roue » (R8) and the natural invitations (R9), one
// module behind the Core's single chat ingress. Mode v1 (production today): silent, nothing read, nothing written.
// LeCroupier_'s answers ride the durable chat queue (cmd_steps, origin sub_wheel: « Sortie chat », rate limit, anti
// duplicate), one per Twitch message (its id is the key). The identity is Twitch's (the message), never an argument.
// Accepting = asking the draws (`requested`, waiting for the viewer's presence): never a segment nor a credit here.
// An invitation exists only once LeCroupier_ can say it (« Sortie chat » ON), and it is answerable only once its message
// really reached the chat (its step `succeeded`): still on its way, an answer is ignored; never sent (output turned OFF
// meanwhile, no executor before its expiry, Twitch refused it) → `undelivered`, never answerable, never re-offered in
// this live. The tours stay owed either way (« !roue oui » always works).

/** How long an invitation listens to its viewer (🟦 plan: 3 min). */
export const INVITATION_TTL_MS = 3 * 60_000;

/** The chat queue's key of an invitation's message (the trigger message's id: one invitation per message). */
export const invitationStepKey = (triggerMessageId: string) =>
  `sw:msg:${triggerMessageId}:invite`;

export type Delivery = 'delivered' | 'pending' | 'undelivered';
/** Version of the closed word lists below (any change: the recognition table is re-checked). */
export const ANSWER_WORDS_VERSION = 1;

export type AnswerClass = 'accept' | 'decline' | 'ambiguous' | 'unrelated';

// Closed lists, compared after normalization (lowercase, accents removed, letters repeated twice or more kept once:
// « ouiii » = « oui », « allez » = « alez »). Anything outside them makes the message unrelated.
const ACCEPT = new Set([
  'oui',
  'ouais',
  'ouai',
  'ouep',
  'yes',
  'yep',
  'yeah',
  'go',
  'ok',
  'okay',
  'oki',
  'dac',
  'dacord',
  'carement',
  'alez',
  'vas',
  'vasy',
  'let',
  'lets',
  'grave',
  'evidement',
  'volontiers',
  'parti',
  'bien',
  'sur',
  'chaud',
  'partant',
  'acord',
  'lance',
  'lancer',
  'lancez',
]);
const DECLINE = new Set([
  'non',
  'nan',
  'no',
  'nope',
  'plus',
  'tard',
  'pas',
  'jamais',
  'later',
  'apres',
  'heure',
  'demain',
]);
const HESITATION = new Set([
  'euh',
  'heu',
  'hm',
  'bof',
  'peut',
  'etre',
  'jsp',
  'sais',
  'atend',
  'atends',
  'mais',
  'quand',
  'pourquoi',
  'quoi',
  'comment',
  'hesite',
]);
const FILLER = new Set([
  'd',
  'y',
  's',
  'a',
  'l',
  'moi',
  'la',
  'les',
  'mes',
  'tours',
  'tour',
  'roue',
  'stp',
  'svp',
  'please',
  'merci',
  'alors',
  'ben',
  'bah',
  'bon',
  'direct',
  'vite',
  'maintenant',
  'envoie',
  'je',
  'veux',
  'fond',
  'et',
  'ca',
  'c',
  'est',
  'tout',
  'si',
  'te',
  'plait',
  'mon',
  'pote',
  'frero',
]);

/** Deterministic, conservative (§ 10 bis): the whole message, at most 5 words; any doubt → ambiguous or unrelated. */
export function classifyAnswer(text: string): AnswerClass {
  if (text.includes('@')) return 'unrelated'; // addressed to someone else
  const question = text.includes('?');
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.replace(/(.)\1+/g, '$1'));
  if (!words.length || words.length > 5) return 'unrelated';
  let a = false;
  let d = false;
  let h = question;
  for (const w of words) {
    if (ACCEPT.has(w)) a = true;
    else if (DECLINE.has(w)) d = true;
    else if (HESITATION.has(w)) h = true;
    else if (!FILLER.has(w)) return 'unrelated';
  }
  if (!a && !d) return h && !question ? 'ambiguous' : 'unrelated';
  if (h || (a && d)) return 'ambiguous';
  return a ? 'accept' : 'decline';
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

export class SubWheelChat {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly wheel: SubWheelService,
  ) {}

  async chat(msg: LabChatMessage): Promise<{ outcome: string }> {
    const text = msg.text.trim();
    const cmd = /^!roue(?:\s+(oui|non))?\s*$/i.exec(text);
    if (text.startsWith('!') && !cmd) return { outcome: 'ignored' };
    // Production today (v1): the module does not exist for the chat.
    if ((await this.wheel.settings(msg.channel_id)).mode === 'v1')
      return { outcome: 'ignored' };
    return this.db.tx(async (q) => {
      // Lock order of the wheel everywhere: the settings (share) first, then the viewer.
      await readMode(q, msg.channel_id);
      const viewer = {
        id: msg.chatter.id,
        login: msg.chatter.login,
        name: msg.chatter.display_name,
      };
      const say = (key: string, line: string) =>
        insertWordGameSteps(q, {
          channelId: msg.channel_id,
          now: this.clock.now(),
          origin: 'sub_wheel',
          drafts: [
            {
              idempotencyKey: `sw:msg:${msg.message_id}:${key}`,
              mode: 'normal',
              text: `@${viewer.name} ${line}`.slice(0, 480),
            },
          ],
        });
      if (cmd) return this.command(q, msg, viewer, cmd[1]?.toLowerCase(), say);
      return this.invitation(q, msg, viewer, say);
    });
  }

  /** « !roue » (counts), « !roue oui » (accept: in live, v2, wheel on), « !roue non » (nothing lost). */
  private async command(
    q: Queryable,
    msg: LabChatMessage,
    viewer: { id: string; login: string; name: string },
    arg: string | undefined,
    say: (key: string, line: string) => Promise<number>,
  ) {
    const ch = msg.channel_id;
    await lockViewer(q, ch, viewer.id);
    const live = await this.wheel.liveKey(q, ch);
    const open = live
      ? await this.openInvitation(q, ch, live, viewer.id)
      : null;
    // « !roue oui / non » acts by itself; it closes the invitation only if the viewer could have read it.
    const inv =
      open && (await this.answerable(q, ch, open)) === 'delivered'
        ? open
        : null;
    const c = await this.counts(q, ch, viewer.id);
    if (!arg) {
      const waiting = c.auto + c.manual;
      if (!waiting && !c.requested && !c.blocked) {
        await say('status', 'tu n’as aucun tour de Roue du Sub en attente.');
        return { outcome: 'status' };
      }
      const parts = [
        c.auto ? plural(c.auto, 'automatique', 'automatiques') : '',
        c.manual ? plural(c.manual, 'à lancer', 'à lancer') : '',
        c.requested ? plural(c.requested, 'demandé', 'demandés') : '',
        c.blocked ? plural(c.blocked, 'à vérifier', 'à vérifier') : '',
      ].filter(Boolean);
      const { mode, enabled } = await readMode(q, ch);
      await say(
        'status',
        `Roue du Sub : ${plural(waiting + c.requested + c.blocked, 'tour', 'tours')} (${parts.join(', ')}).${c.manual && mode === 'v2' && enabled ? ' Tape !roue oui pour les lancer.' : ''}`,
      );
      return { outcome: 'status' };
    }
    if (arg === 'non') {
      if (inv)
        await this.answer(q, inv.id, msg.message_id, 'decline', 0, 'declined');
      await say(
        'decline',
        c.manual
          ? `d’accord, ${c.manual > 1 ? `tes ${c.manual} tours t’attendent` : 'ton tour t’attend'} (!roue oui quand tu veux).`
          : 'd’accord.',
      );
      return { outcome: 'declined' };
    }
    if (!live) {
      await say(
        'accept',
        'les tours se lancent pendant le live : reviens à ce moment-là !',
      );
      return { outcome: 'not_live' };
    }
    const r = await this.wheel.acceptInTx(q, ch, viewer, 'command');
    if (inv)
      await this.answer(
        q,
        inv.id,
        msg.message_id,
        'accept',
        r.requested,
        'accepted',
      );
    await say('accept', this.acceptLine(r, c.requested));
    return { outcome: r.requested ? 'accepted' : 'nothing_to_accept' };
  }

  private acceptLine(
    r: { requested: number; reason: string | null },
    already: number,
  ) {
    if (r.reason) return 'la Roue du Sub n’est pas disponible pour le moment.';
    if (r.requested)
      return `c’est parti : ${plural(r.requested, 'tour sera lancé', 'tours seront lancés')} pendant le live, quand tu seras là.`;
    return already
      ? 'c’est déjà demandé : tes tours arrivent.'
      : 'tu n’as aucun tour à lancer.';
  }

  /** R9: a plain message — the viewer's answer to its invitation, or the trigger of the first one of this live. */
  private async invitation(
    q: Queryable,
    msg: LabChatMessage,
    viewer: { id: string; login: string; name: string },
    say: (key: string, line: string) => Promise<number>,
  ) {
    const ch = msg.channel_id;
    // Read in this transaction (the settings row is share-locked by it).
    const s = (
      await q.query<{
        invitations_enabled: boolean;
        mode: string;
        enabled: boolean;
      }>(
        'select invitations_enabled, mode, enabled from sw_settings where channel_id = $1',
        [ch],
      )
    )[0];
    if (!s?.invitations_enabled || s.mode !== 'v2' || !s.enabled)
      return { outcome: 'ignored' };
    const live = await this.wheel.liveKey(q, ch);
    if (!live) return { outcome: 'ignored' };
    await lockViewer(q, ch, viewer.id);
    const now = this.clock.now();
    const inv = (
      await q.query<{
        id: number;
        status: string;
        expires_at: Date;
        trigger_message_id: string;
        answer_message_id: string | null;
      }>(
        `select id, status, expires_at, trigger_message_id, answer_message_id from sw_invitations
         where channel_id = $1 and session_key = $2 and viewer_id = $3 for update`,
        [ch, live, viewer.id],
      )
    )[0];
    if (inv) {
      // The same Twitch message again (redelivery): already handled.
      if (
        inv.trigger_message_id === msg.message_id ||
        inv.answer_message_id === msg.message_id
      )
        return { outcome: 'replayed' };
      if (inv.status !== 'offered' && inv.status !== 'clarified')
        return { outcome: 'ignored' };
      const cls = classifyAnswer(msg.text);
      if (cls === 'unrelated') return { outcome: 'ignored' };
      // An answer only to what the viewer could read: the invitation's message must have reached the chat.
      const delivery = await this.answerable(q, ch, inv);
      if (delivery === 'pending') return { outcome: 'invitation_pending' };
      if (delivery === 'undelivered')
        return { outcome: 'invitation_undelivered' };
      if (now > new Date(inv.expires_at)) {
        await q.query(
          `update sw_invitations set status = 'expired' where id = $1`,
          [inv.id],
        );
        return { outcome: 'expired' };
      }
      if (cls === 'ambiguous') {
        if (inv.status === 'clarified') return { outcome: 'ignored' };
        await this.answer(
          q,
          inv.id,
          msg.message_id,
          'ambiguous',
          0,
          'clarified',
        );
        await say('clarify', 'réponds !roue oui ou !roue non.');
        return { outcome: 'clarified' };
      }
      const c = await this.counts(q, ch, viewer.id);
      if (cls === 'decline') {
        await this.answer(q, inv.id, msg.message_id, 'decline', 0, 'declined');
        await say(
          'decline',
          `d’accord, ${c.manual > 1 ? `tes ${c.manual} tours t’attendent` : 'ton tour t’attend'} (!roue oui quand tu veux).`,
        );
        return { outcome: 'declined' };
      }
      const r = await this.wheel.acceptInTx(q, ch, viewer, 'chat_accept');
      await this.answer(
        q,
        inv.id,
        msg.message_id,
        'accept',
        r.requested,
        'accepted',
      );
      await say('accept', this.acceptLine(r, c.requested));
      return { outcome: 'accepted' };
    }
    const c = await this.counts(q, ch, viewer.id);
    if (!c.manual) return { outcome: 'ignored' };
    // « Sortie chat » OFF: LeCroupier_ cannot say it — nothing is offered, nothing recorded (the next message, once
    // it is ON, may invite).
    if (!(await this.chatOutput(q, ch))) return { outcome: 'ignored' };
    const created = await q.query(
      `insert into sw_invitations (channel_id, session_key, viewer_id, status, trigger_message_id, offered_at,
         expires_at, rights_offered)
       values ($1, $2, $3, 'offered', $4, $5, $6, $7)
       on conflict do nothing returning id`,
      [
        ch,
        live,
        viewer.id,
        msg.message_id,
        now,
        new Date(now.getTime() + INVITATION_TTL_MS),
        c.manual,
      ],
    );
    if (!created.length) return { outcome: 'ignored' };
    await say(
      'invite',
      `tu as ${plural(c.manual, 'tour', 'tours')} de Roue du Sub en attente ! On ${c.manual > 1 ? 'les' : 'le'} lance ? Réponds oui ou non.`,
    );
    return { outcome: 'invited' };
  }

  private async openInvitation(
    q: Queryable,
    ch: string,
    live: string,
    viewerId: string,
  ) {
    return (
      (
        await q.query<{ id: number; trigger_message_id: string }>(
          `select id, trigger_message_id from sw_invitations where channel_id = $1 and session_key = $2
             and viewer_id = $3 and status in ('offered', 'clarified') for update`,
          [ch, live, viewerId],
        )
      )[0] ?? null
    );
  }

  /** « Sortie chat réelle » of the channel (OFF when never set). */
  private async chatOutput(q: Queryable, ch: string) {
    return (
      (
        await q.query<{ chat_output: boolean }>(
          'select chat_output from cmd_channels where channel_id = $1',
          [ch],
        )
      )[0]?.chat_output ?? false
    );
  }

  /**
   * Did the invitation's message reach the chat? `succeeded` → delivered; queued / claimed (before its expiry) or
   * running → pending; anything else (expired — swept or not —, failed, unknown, cancelled, skipped, absent) →
   * undelivered, and the invitation becomes `undelivered` (under the caller's lock on it).
   */
  private async answerable(
    q: Queryable,
    ch: string,
    inv: { id: number; trigger_message_id: string },
  ): Promise<Delivery> {
    const step = (
      await q.query<{ status: string; expires_at: Date }>(
        'select status, expires_at from cmd_steps where channel_id = $1 and idempotency_key = $2',
        [ch, invitationStepKey(inv.trigger_message_id)],
      )
    )[0];
    const now = this.clock.now();
    let d: Delivery = 'undelivered';
    if (step?.status === 'succeeded') d = 'delivered';
    else if (step?.status === 'running') d = 'pending';
    else if (
      (step?.status === 'queued' || step?.status === 'claimed') &&
      new Date(step.expires_at) > now
    )
      d = 'pending';
    if (d === 'undelivered')
      await q.query(
        `update sw_invitations set status = 'undelivered' where id = $1 and status in ('offered', 'clarified')`,
        [inv.id],
      );
    return d;
  }

  private async answer(
    q: Queryable,
    id: number,
    messageId: string,
    cls: AnswerClass,
    requested: number,
    status: 'accepted' | 'declined' | 'clarified',
  ) {
    await q.query(
      `update sw_invitations set status = $2, answered_at = $3, answer_message_id = $4, answer_class = $5,
         rights_requested = rights_requested + $6
       where id = $1`,
      [id, status, this.clock.now(), messageId, cls, requested],
    );
  }

  /** The viewer's tours, as « !roue » says them (owed not under review, per queue; requested; blocked). */
  private async counts(q: Queryable, ch: string, viewerId: string) {
    const r = (
      await q.query<{
        auto: number;
        manual: number;
        requested: number;
        blocked: number;
      }>(
        `select
           count(*) filter (where s.status = 'owed' and s.queue = 'auto' and not b.blocked)::int as auto,
           count(*) filter (where s.status = 'owed' and s.queue is distinct from 'auto' and not b.blocked)::int as manual,
           count(*) filter (where s.status = 'requested' and not b.blocked)::int as requested,
           count(*) filter (where s.status in ('owed', 'requested') and b.blocked)::int as blocked
         from sw_spins s, lateral (select exists (select 1 from sw_spin_reviews v where v.spin_id = s.spin_id
           and v.status in ('open', 'unresolved')) as blocked) b
         where s.channel_id = $1 and s.viewer_id = $2`,
        [ch, viewerId],
      )
    )[0]!;
    return r;
  }
}
