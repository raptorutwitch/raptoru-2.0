import { randomInt } from 'node:crypto';
import type { LabChatMessage } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db } from '../db/db.js';
import { EventShopError, type EventShopService } from './service.js';

// Halloween shop in the chat (docs/HALLOWEEN.md § 7): the same shop as the extension's « Halloween » module, for every
// viewer while the extension version waits for Twitch's review. Silent while the event is closed (never a word in the
// chat outside the event). The Core decides everything (service.ts): price, limits, one play at a time, the overlay.
// - `!bonbons`: the balance and how to earn; `!bonbons <n>`: exchange Jetons for n Bonbons (capped per hour);
// - `!peur`: the menu; `!peur <effet>` (blink, fog…, a media id such as foxy); `!peur screamer`: a random screamer
//   available now. The Twitch message id is the idempotency key: the same message again buys nothing.

const BONBONS = /^!bonbons(?:\s+(\d{1,5}))?$/i;
const PEUR = /^!peur(?:\s+([a-z0-9-]{1,40}))?$/i;
/** One free answer (menu, balance) per viewer at most every 30 s. */
export const EVENT_CHAT_HELP_COOLDOWN_MS = 30_000;

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/\s/g, ' ');

const REFUSALS: Record<string, string> = {
  insufficient_bonbons: 'pas assez de Bonbons',
  busy: 'un effet est déjà en cours, retente dans un instant',
  viewer_cooldown: 'tu viens d’acheter, patiente un peu',
  item_cooldown: 'cet effet récupère',
  screamer_cooldown: 'laisse-le respirer entre deux screamers',
  screamer_quota: 'assez de screamers pour cette heure',
  engine_offline: 'Raptoru n’est pas prêt à avoir peur',
  media_missing: 'indisponible pour le moment',
  item_disabled: 'cet effet n’est plus disponible',
  item_not_found: 'effet inconnu (!peur pour la liste)',
  conversion_cap: 'limite d’échange atteinte pour cette heure',
  conversion_closed: 'l’échange de Jetons est fermé',
  insufficient_tokens: 'pas assez de Jetons',
  raptoru_paused: 'Raptoru est en pause, réessaie plus tard',
  viewer_blocked: 'les interactions te sont fermées pour le moment',
};

export class EventShopChat {
  private readonly helped = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly shop: EventShopService,
  ) {}

  async chat(
    msg: LabChatMessage,
  ): Promise<{ outcome: string; replayed?: boolean }> {
    const text = msg.text.trim();
    const b = BONBONS.exec(text);
    const p = b ? null : PEUR.exec(text);
    if (!b && !p) return { outcome: 'ignored' };
    if (!(await this.shop.settings(msg.channel_id)).enabled)
      return { outcome: 'ignored' };
    const name = msg.chatter.display_name;
    const viewer = { id: msg.chatter.id, display_name: name };
    const key = `evs:msg:${msg.message_id}`;
    const answer = (body: string) =>
      this.db.tx((q) =>
        insertWordGameSteps(q, {
          channelId: msg.channel_id,
          now: this.clock.now(),
          // ponytail: no 'event_shop' origin in cmd_steps (a migration): the chat modules' generic one.
          origin: 'mini_game',
          drafts: [
            { idempotencyKey: key, mode: 'normal', text: `@${name} — ${body}` },
          ],
        }),
      );
    const refused = async (e: unknown) => {
      if (!(e instanceof EventShopError)) throw e;
      await answer(
        `${REFUSALS[e.code] ?? 'indisponible pour le moment'} · rien n’a été débité.`,
      );
      return { outcome: `event_refused:${e.code}` };
    };

    // Free answers: throttled per viewer.
    const free = !(b?.[1] || p?.[1]);
    if (free) {
      const now = this.clock.now().getTime();
      if (
        now - (this.helped.get(msg.chatter.id) ?? 0) <
        EVENT_CHAT_HELP_COOLDOWN_MS
      )
        return { outcome: 'event_help_throttled' };
      if (this.helped.size > 5000) this.helped.clear();
      this.helped.set(msg.chatter.id, now);
    }
    const state = await this.shop.viewerState(msg.channel_id, viewer.id);

    if (b) {
      if (!b[1]) {
        const c = state.conversion;
        await answer(
          `🍬 ${fmt(state.balance ?? 0)} Bonbons. Gagne-en : sub ${state.earn.sub_reward}, par sub offert ${state.earn.gift_giver_per_sub} · ` +
            (c.cap_per_hour > 0
              ? `!bonbons <n> échange ${fmt(c.rate)} Jetons par Bonbon (encore ${c.remaining} cette heure). `
              : '') +
            'Dépense-les avec !peur 👻',
        );
        return { outcome: 'event_balance' };
      }
      try {
        const out = await this.shop.convert({
          idempotency_key: key,
          channel_id: msg.channel_id,
          viewer,
          bonbons: Number(b[1]),
        });
        await answer(
          `+${out.bonbons} 🍬 (${fmt(out.jetons)} Jetons) · solde ${fmt(out.balance)} Bonbons.`,
        );
        return { outcome: 'event_converted', replayed: out.replayed };
      } catch (e) {
        return refused(e);
      }
    }

    const typed = p![1]?.toLowerCase();
    if (!typed) {
      const pick = (kind: string) =>
        state.items
          .filter((i) => i.kind === kind)
          .map((i) => `${i.item_id} ${i.price}`)
          .join(', ');
      const screamers = state.items.filter((i) => i.kind === 'screamer');
      await answer(
        `👻 !peur <effet> — ${pick('effect')} · ${pick('apparition')}` +
          (screamers.length
            ? ` · !peur screamer (au hasard) ${Math.min(...screamers.map((i) => i.price))}+`
            : '') +
          ` Bonbons. Solde : ${fmt(state.balance ?? 0)} 🍬`,
      );
      return { outcome: 'event_menu' };
    }
    let itemId = typed;
    if (typed === 'screamer') {
      const now = state.items.filter(
        (i) => i.kind === 'screamer' && i.available,
      );
      if (!now.length) {
        await answer(
          `aucun screamer disponible pour le moment · rien n’a été débité.`,
        );
        return { outcome: 'event_refused:no_screamer' };
      }
      itemId = now[randomInt(now.length)]!.item_id;
    } else if (!state.items.some((i) => i.item_id === typed)) {
      // A media id typed alone (`!peur foxy`) names its screamer.
      if (state.items.some((i) => i.item_id === `s-${typed}`))
        itemId = `s-${typed}`;
    }
    try {
      const out = await this.shop.purchase({
        idempotency_key: key,
        channel_id: msg.channel_id,
        viewer,
        item_id: itemId,
      });
      await answer(
        `👀 « ${out.purchase.label} » envoyé (${out.purchase.price} 🍬) · solde ${fmt(out.balance)} Bonbons. Surveille l’écran de Raptoru…`,
      );
      return { outcome: 'event_bought', replayed: out.replayed };
    } catch (e) {
      return refused(e);
    }
  }
}
