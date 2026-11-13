import { STREAM_OFFLINE } from '../stream/live-gate.js';
import { RB_PRICING_DEFAULT } from '../random-ban/pricing.js';
import { RbError, type RandomBanService } from '../random-ban/service.js';
import { ModuleError, type ModuleDefinition } from './kit.js';

// Random Ban on the module host (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md), TWO declarations:
// - `random_ban`: its settings (the charges, the channel-wide limit, the Sniper) and its supervision — no switch of its
//   own: `!rb` and the channel points work while the bot's executor reports (the Control Center says so, as before);
// - `random_ban_ext`: the extension's « Mini-jeux › Random Ban » — the viewer's charges and gauge (viewerState) and the
//   purchase (`launch`), behind the host's switch `random_ban_ext.enabled` (OFF by default). The module adds no draw,
//   no executor, no timeout: `launch` creates the SAME request as `!rb` and the channel points (random-ban/service.ts
//   `buy`), at the fixed Jetons price, using one of the charges the three ways share. The host gives the intent key
//   (replayed key = first answer), the per-viewer lock, the global pause, the moderation blocks and the switch. The
//   action is « free » for the host: the module charges the price itself, in the host's transaction, never above
//   `expected_price`.

const min = (
  label: string,
  def: number,
  lo: number,
  hi: number,
  help: string,
) => ({
  label,
  unit: 'min',
  default: def,
  min: lo,
  max: hi,
  help,
});
export function randomBanModule(
  service: Pick<RandomBanService, 'executorReady'>,
): ModuleDefinition {
  return {
    id: 'random_ban',
    label: 'Random Ban',
    description:
      'Un viewer paie pour exclure un viewer au hasard (!rb, points de chaîne, extension) : prix fixe, charges personnelles.',
    category: 'interactions',
    capabilities: ['settings', 'supervision'],
    settings: {
      charges_max: {
        label: 'Charges par viewer',
        unit: 'charges',
        default: RB_PRICING_DEFAULT.chargesMax,
        min: 0,
        max: 10,
        help: 'communes à l’extension, !rb et aux points de chaîne ; un Random Ban accepté en utilise une ; 0 = aucune limite',
      },
      recharge_min: min(
        'Une charge revient toutes les',
        RB_PRICING_DEFAULT.rechargeMs / 60_000,
        1,
        120,
        'en continu, même extension fermée ; un refus ne repousse rien',
      ),
      channel_max: {
        label: 'Limite de la chaîne',
        unit: 'Random Ban',
        default: RB_PRICING_DEFAULT.channelMax,
        min: 0,
        max: 60,
        help: 'au plus ce nombre de Random Ban acceptés, tous viewers confondus, sur la période ci-dessous ; 0 = aucune limite',
      },
      channel_window_min: min(
        'Période de la limite de la chaîne',
        RB_PRICING_DEFAULT.channelWindowMs / 60_000,
        1,
        60,
        'utilisée seulement si la limite de la chaîne est réglée',
      ),
      sniper_bonus: {
        label: 'Prime Sniper',
        unit: 'Jetons',
        default: RB_PRICING_DEFAULT.sniperBonus,
        min: 0,
        max: 100_000,
        help: 'si le tirage tombe sur la cible visée (extension), pour une tentative primée ; 0 = pas de prime',
      },
      sniper_window_min: min(
        'Une tentative Sniper primée toutes les',
        RB_PRICING_DEFAULT.sniperWindowMs / 60_000,
        0,
        240,
        'par viewer, indépendant des charges ; entre deux, les Sniper sont pour la gloire (sans prime) ; 0 = toujours primé',
      ),
      sequence: {
        label: 'Le Viseur : rouleau avant la sanction',
        unit: '0/1',
        default: 0,
        min: 0,
        max: 1,
        help: '1 = tirage figé, rouleau, puis timeout à l’arrêt ; 0 = timeout puis vidéo (comportement actuel)',
      },
      strike_offset_s: {
        label: 'Le Viseur : délai du timeout après l’arrêt du rouleau',
        unit: 's',
        default: 3,
        min: 0,
        max: 5,
        help: 'la latence du stream (le chat voit tout avant la vidéo) ; à mesurer en réel',
        advanced: true,
      },
      queue_paused: {
        label: 'File Random Ban en pause',
        unit: '0/1',
        default: 0,
        min: 0,
        max: 1,
        help: 'réglé par la modération (pause / reprise) : aucun nouvel achat, le bot ne prend rien',
        advanced: true,
      },
      max_pending: {
        label: 'Random Ban en attente par viewer',
        unit: 'demandes',
        default: RB_PRICING_DEFAULT.maxPending,
        min: 1,
        max: 5,
        advanced: true,
      },
    },
    async status(ctx, channelId) {
      const ready = service.executorReady(channelId);
      const n = Number(
        (
          await ctx.db.query<{ n: number | string }>(
            'select count(*) as n from rb_requests where channel_id = $1 and created_at > $2',
            [channelId, new Date(ctx.clock.now().getTime() - 3_600_000)],
          )
        )[0]?.n ?? 0,
      );
      return {
        intention: 'on',
        observed: ready ? 'ready' : 'waiting',
        summary: ready
          ? 'Le bot peut chercher et exclure : !rb fonctionne.'
          : 'Le bot ne s’est pas signalé : !rb serait refusé (aucun Jeton débité).',
        reasons: ready
          ? []
          : [
              'Exécuteur Random Ban du bot silencieux depuis plus de 15 s (RANDOM_BAN côté bot ?).',
            ],
        activity: n
          ? `${n} demande${n > 1 ? 's' : ''} la dernière heure`
          : null,
      };
    },
  };
}

export function randomBanExtModule(
  service: Pick<RandomBanService, 'executorReady' | 'buy' | 'buyerState'>,
  /** The Lab: a purchase from the extension runs the real search, never a timeout (like the chat simulator). */
  o: { lab?: boolean } = {},
): ModuleDefinition {
  return {
    id: 'random_ban_ext',
    label: 'Mini-jeux · Random Ban',
    description:
      'Random Ban depuis l’extension : les charges du viewer, sa jauge, l’achat au prix affiché (jamais au-dessus).',
    category: 'jeux',
    capabilities: ['viewer', 'moderation', 'history'],
    viewer: {
      launch: {
        label: 'Lancer un Random Ban',
        async run(ctx, q, call) {
          const input = (call.input ?? {}) as {
            expected_price?: unknown;
            wish_id?: unknown;
            /** The Sniper as typed (« @Pseudo »): matched only when exact, else kept for the moderation. */
            wish_text?: unknown;
          };
          const ceiling = input.expected_price;
          if (
            typeof ceiling !== 'number' ||
            !Number.isSafeInteger(ceiling) ||
            ceiling < 1
          )
            throw new ModuleError(400, 'expected_price_required');
          // Sniper: optional, a Twitch id among the viewers present (checked by Core in the purchase).
          const wish = input.wish_id ?? null;
          if (
            wish !== null &&
            (typeof wish !== 'string' || !/^\d{1,32}$/.test(wish))
          )
            throw new ModuleError(400, 'wish_unknown');
          const wishText =
            typeof input.wish_text === 'string'
              ? input.wish_text.slice(0, 64)
              : null;
          if (!(await ctx.live(q))) throw new ModuleError(409, STREAM_OFFLINE);
          if (!service.executorReady(call.channelId))
            throw new ModuleError(409, 'rb_unavailable');
          try {
            const out = await service.buy(q, ctx.economy, {
              channel_id: call.channelId,
              source: 'extension',
              source_ref: call.activityId,
              mode: o.lab ? 'dry_run' : 'real',
              buyer: {
                id: call.viewer.id,
                // The JWT gives the display name only; the login is refreshed by the executor's search.
                login: call.viewer.display_name.toLowerCase().slice(0, 64),
                name: call.viewer.display_name.slice(0, 64),
              },
              ceiling,
              wish: wish || wishText ? { id: wish, text: wishText } : null,
            });
            return {
              status: 'done',
              result: {
                request: out.request,
                price: out.price,
                charges: out.charges,
                sniper_ready: out.sniper_ready ?? null,
              },
            };
          } catch (e) {
            if (e instanceof RbError)
              throw new ModuleError(e.status, e.code, e.details);
            throw e;
          }
        },
      },
    },
    async viewerState(ctx, channelId, viewer) {
      const ready = service.executorReady(channelId);
      // Random Ban plays during the live only (the purchase checks it again): said before the click.
      const live = await ctx.live(ctx.db);
      if (!viewer) return { ready, live, identity: false };
      return {
        ready,
        live,
        identity: true,
        ...(await service.buyerState(channelId, viewer.id)),
      };
    },
    // Moderated in Studio › Modération › Random Ban (refonte Mini-jeux 13/11), never under the game in the extension.
    moderation: {
      visible: false,
      refund: 'never',
      note: 'Random Ban rembourse lui-même une demande sans effet (une fois) ; le reste se règle dans Studio › Modération › Random Ban.',
    },
  };
}
