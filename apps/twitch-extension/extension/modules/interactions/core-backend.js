// Interactions › Chaos branché sur le Core (module `chaos`, docs/chaos/CONTRAT_LOT2.md § 2.4). Même forme que le faux
// Core de la maquette, pour que la vue ne change pas : `snapshot()` (lu sur GET /v1/ext/chaos/state, relu toutes les
// 2 s et après chaque achat), `quote()` (DEVIS DU CORE : tant qu'il n'est pas arrivé, l'achat est bloqué « Calcul du
// prix… » ; l'estimation locale n'est jamais payée), `buy()` (POST /v1/ext/chaos/buy avec `expected_price` = le devis
// du Core et une clé d'idempotence par intention ; le Core revérifie tout). Rien n'est décidé dans le navigateur.
import { EFFECTS, ENGINE, effectById, minPrice, normalizeChoice, priceOf } from './catalog.js';

const STATUS = { queued: 'queued', claimed: 'queued', started: 'active', ended: 'done', failed: 'failed', canceled: 'cancelled', expired: 'expired' };
const MESSAGES = {
  price_changed: 'Le prix a changé : vérifie avant de confirmer.',
  insufficient_funds: 'Solde insuffisant.',
  studio_offline: 'Le streamer n’est pas prêt pour les effets en ce moment.',
  effect_disabled: 'Cet effet est désactivé pendant ce live.',
  safe_mode: 'Mode doux : effet lumineux désactivé.',
  duration_out_of_range: 'Durée au-delà du plafond de ce live.',
  queue_full: 'La file est pleine : réessaie dans un instant.',
  one_waiting: 'Tu as déjà un effet dans la file.',
  cooldown: 'Patiente avant de relancer cet effet.',
  global_cooldown: 'Un effet identique vient de passer : patiente un peu.',
  no_charge: 'Plus de charge : attends la prochaine.',
  burst_full: 'Trop de clignements en attente.',
  burst_rate: 'Trop de clignements en ce moment pour tout le chat.',
  paused: 'Les achats d’effets sont suspendus.',
  viewer_blocked: 'Tu ne peux pas acheter d’effet pour le moment.',
  personal_cooldown: 'Un délai t’a été imposé par la modération.',
  idempotency_conflict: 'Achat déjà envoyé avec d’autres réglages : recommence.',
};
const message = (e) => MESSAGES[e?.code] ?? e?.message ?? 'Achat refusé.';
const QUOTE_TTL_MS = 5000;

export function createCoreBackend(ctx, getState = () => ctx.state) {
  const client = ctx.client;
  let state = null;
  let timer = null;
  const subs = new Set();
  const quotes = new Map(); // clé → { at, q } ou { pending: Promise }
  const notify = () => {
    const t = Date.now();
    for (const fn of subs) fn(t);
  };
  async function refresh() {
    try {
      state = await client.chaosState();
    } catch {
      /* garde le dernier état ; le prochain essai suivra */
    }
    notify();
  }

  const view = (r) => {
    const e = effectById(r.effect);
    const status = STATUS[r.status] ?? r.status;
    return {
      id: r.id,
      effect: r.effect,
      label: e?.label ?? r.effect,
      summary: [r.preset && e?.presets?.find((p) => p.id === r.preset)?.label, r.level && e?.levels?.find((l) => l.id === r.level)?.label, `${Math.round((r.duration_ms ?? 0) / 1000)} s`].filter(Boolean).join(' · '),
      duration: Math.round((r.duration_ms ?? 0) / 1000),
      price: r.price ?? 0,
      credit: r.payment === 'credit' ? r.credit_id ?? true : null,
      by: r.payment === 'gift' ? 'mod' : 'viewer',
      buyer: { id: r.viewer_id ?? (r.mine ? 'me' : 'other'), name: r.viewer_name ?? '' },
      mine: Boolean(r.mine),
      state: status,
      position: r.position ?? null,
      eta: r.eta_s ?? null,
      remaining: r.remaining_s ?? null,
      progress: r.progress ?? null,
      refunded: r.refund_status === 'refunded',
      reason: r.reason ?? null,
      code: r.code ?? null,
      created: Date.parse(r.created_at ?? '') || null,
      started: Date.parse(r.started_at ?? '') || null,
      finished: Date.parse(r.ended_at ?? '') || null,
      charged: Boolean(r.charged),
    };
  };
  const credit = (c) => ({
    id: c.id,
    effect: c.effect_id ?? c.effect,
    constraints: { maxS: c.constraints?.max_duration_ms ? Math.round(c.constraints.max_duration_ms / 1000) : c.constraints?.maxS, levels: c.constraints?.levels, presets: c.constraints?.presets },
    source: { kind: c.source_kind ?? c.source?.kind ?? 'moderator', by: c.source_by ?? c.source?.by ?? '' },
    reason: c.reason ?? '',
    state: c.state ?? 'available',
    viewer: { id: c.viewer_id ?? 'me', name: c.viewer_name ?? '' },
  });

  const mock = {
    snapshot() {
      const s = state ?? {};
      const credits = (s.credits ?? []).map(credit).filter((c) => c.state === 'available');
      const mine = (s.mine ?? []).map(view);
      const wallet = getState()?.wallet;
      return {
        status: s.enabled === false ? 'disabled' : s.status ?? 'offline',
        safe: Boolean(s.safe_mode),
        captureDown: false,
        game: '',
        balance: typeof wallet?.points === 'number' ? wallet.points : 0,
        queueMax: 3,
        burstMax: 10,
        capS: s.cap_s ?? ENGINE.safetyDurationS,
        maxActive: ENGINE.safetyMaxActive,
        active: (s.active ?? []).map(view),
        queue: (s.queue ?? []).map(view),
        burst: (s.burst ?? []).map(view),
        history: mine.filter((r) => !['queued', 'active'].includes(r.state)),
        mine,
        credits,
        creditLog: [],
        allCredits: credits,
        allCreditLog: [],
        viewers: [],
        ledger: [],
        effects: EFFECTS.map((e) => {
          const a = s.effects?.[e.id];
          const playing = (s.active ?? []).find((r) => r.effect === e.id);
          const charged = (e.presets ?? []).filter((p) => p.charges).map((p) => ({ preset: p.id, ...(s.charges?.[`${e.id}:${p.id}`] ?? { n: p.charges.max, max: p.charges.max, next_s: null }), nextS: s.charges?.[`${e.id}:${p.id}`]?.next_s ?? null }));
          return {
            id: e.id,
            block: !state ? { code: 'loading', label: '…', detail: 'Chargement…' } : a && a.available === false ? { code: a.reason ?? 'unavailable', label: 'Indisponible', detail: MESSAGES[a.reason] ?? 'Indisponible pour le moment.' } : null,
            playing: playing ? { by: playing.viewer_name ?? '', mine: Boolean(playing.mine), remaining: playing.remaining_s ?? 0 } : null,
            startsNow: true,
            minPrice: minPrice(e),
            credits: credits.filter((c) => c.effect === e.id).length,
            charges: charged,
          };
        }),
      };
    },
    /** Devis : celui du Core (mis en cache 5 s par réglage) ; en attendant, l'achat est bloqué. */
    quote(effectId, choice, t, viewer, pay = {}) {
      const e = effectById(effectId);
      const c = normalizeChoice(e, choice, state?.cap_s ?? ENGINE.safetyDurationS);
      const local = priceOf(e, c);
      const key = JSON.stringify([effectId, c, pay.credit ?? null]);
      const hit = quotes.get(key);
      if (hit?.q && Date.now() - hit.at < QUOTE_TTL_MS) return hit.q;
      if (!hit?.pending) {
        const pending = client
          .chaosQuote({ effect: effectId, choice: c, credit_id: pay.credit ?? undefined })
          .then((r) => {
            const q = {
              price: r.price,
              fullPrice: r.price,
              lines: local.lines,
              choice: r.choice ?? c,
              outcome: r.outcome ? { kind: r.outcome.kind, position: r.outcome.position, eta: r.outcome.eta_s ?? 0 } : { kind: 'now' },
              block: r.block ? { code: r.block.code, label: r.block.label ?? '', detail: r.block.detail ?? MESSAGES[r.block.code] ?? 'Indisponible.' } : null,
              credit: pay.credit ? credit({ id: pay.credit, effect: effectId, constraints: {} }) : null,
              charges: r.charges ? { n: r.charges.n, max: r.charges.max, nextS: r.charges.next_s ?? null } : null,
            };
            quotes.set(key, { at: Date.now(), q });
          })
          .catch((err) => quotes.set(key, { at: Date.now(), q: { price: local.total, fullPrice: local.total, lines: local.lines, choice: c, outcome: { kind: 'now' }, block: { code: err?.code ?? 'quote_failed', label: '', detail: message(err) }, credit: null, charges: null } }))
          .finally(notify);
        quotes.set(key, { pending });
      }
      return { price: local.total, fullPrice: local.total, lines: local.lines, choice: c, outcome: { kind: 'now' }, block: { code: 'quoting', label: '…', detail: 'Calcul du prix par le serveur…' }, credit: null, charges: null };
    },
    /** Achat : le Core revérifie tout (prix, règles, solde) ; la même clé = la même réponse, jamais deux débits. */
    async buy(effectId, choice, expectedPrice, t, viewer, pay = {}) {
      try {
        const r = await client.chaosBuy({ effect: effectId, choice, expected_price: expectedPrice, credit_id: pay.credit ?? undefined }, pay.key);
        quotes.clear();
        void refresh();
        const req = view({ ...r.request, mine: true });
        return { ok: true, duplicate: Boolean(r.duplicate), request: { ...req, state: req.state === 'failed' ? 'failed' : req.state }, outcome: r.outcome ? { kind: r.outcome.kind, position: r.outcome.position } : { kind: req.state === 'active' ? 'now' : 'queue', position: req.position ?? 1 } };
      } catch (err) {
        quotes.clear();
        return { ok: false, code: err?.code ?? 'buy_failed', message: message(err) };
      }
    },
  };

  return {
    mock,
    capS: () => state?.cap_s ?? ENGINE.safetyDurationS,
    subscribe(fn) {
      subs.add(fn);
      if (!timer) {
        void refresh();
        timer = setInterval(refresh, 2000);
      }
      return () => {
        subs.delete(fn);
        if (!subs.size) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    changed: () => void refresh(),
  };
}

