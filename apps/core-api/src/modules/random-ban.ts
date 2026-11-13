import { STREAM_OFFLINE } from '../stream/live-gate.js';
import { RB_PRICING_DEFAULT } from '../random-ban/pricing.js';
import { RbError, type RandomBanService } from '../random-ban/service.js';
import { ModuleError, type ModuleDefinition } from './kit.js';

// Random Ban on the module host (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md), TWO declarations:
// - `random_ban`: its settings (the progressive price, the limits) and its supervision — no switch of its own: `!rb` and
//   the channel points work while the bot's executor reports (the Control Center says so, as before);
// - `random_ban_ext`: the extension's « Mini-jeux › Random Ban » — the viewer's price and gauge (viewerState) and the
//   purchase (`launch`), behind the host's switch `random_ban_ext.enabled` (OFF by default). The module adds no draw, no executor, no
// timeout: `launch` creates the SAME request as `!rb` and the channel points (random-ban/service.ts `buy`), paid in
// Jetons at the progressive price shared with `!rb`. The host gives the intent key (replayed key = first answer), the
// per-viewer lock, the global pause, the moderation blocks and the switch (OFF: the extension's purchase is closed
// until Antoni opens it). The action is « free » for the host: the progressive price
// depends on the buyer, so the module charges it itself, in the host's transaction, never above `expected_price`.

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
const tier = (n: number) => ({
  label: `Prix de Random Ban, palier ${n}`,
  unit: 'Jetons',
  default: RB_PRICING_DEFAULT.tiers[n - 1]!,
  min: 1_000,
  max: 1_000_000,
  help: 'extension et !rb ; jamais inférieur au palier précédent',
  advanced: true,
});

export function randomBanModule(
  service: Pick<RandomBanService, 'executorReady'>,
): ModuleDefinition {
  return {
    id: 'random_ban',
    label: 'Random Ban',
    description:
      'Un viewer paie pour exclure un viewer au hasard (!rb, points de chaîne, extension) : prix progressif par viewer.',
    category: 'interactions',
    capabilities: ['settings', 'supervision'],
    settings: {
      price_2: tier(2),
      price_3: tier(3),
      price_4: tier(4),
      price_5: tier(5),
      tier_step_min: min(
        'Retour d’un palier toutes les',
        RB_PRICING_DEFAULT.stepMs / 60_000,
        0,
        60,
        'sans nouveau lancer ; 0 = prix fixe (palier 1)',
      ),
      cp_cooldown_min: min(
        'Délai entre deux Random Ban d’un viewer par points de chaîne',
        RB_PRICING_DEFAULT.cpCooldownMs / 60_000,
        0,
        120,
        'personnel ; 0 = aucun délai',
      ),
      sniper_bonus: {
        label: 'Prime Sniper',
        unit: 'Jetons',
        default: RB_PRICING_DEFAULT.sniperBonus,
        min: 0,
        max: 100_000,
        help: 'si le tirage tombe sur la cible visée (extension) ; 0 = pas de prime',
      },
      sniper_window_min: min(
        'Sniper récompensable après',
        RB_PRICING_DEFAULT.sniperWindowMs / 60_000,
        0,
        240,
        'sans autre Random Ban du viewer (extension, !rb, points de chaîne)',
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
      'Random Ban depuis l’extension : le prix progressif du viewer, sa jauge, l’achat confirmé (jamais au-dessus).',
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
                price: out.quote,
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
