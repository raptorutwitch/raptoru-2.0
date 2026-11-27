// Section FX de la console de modération (D4) branchée sur le Core : lit `overview.chaos` (déjà relu par la console
// toutes les 2 s) et envoie les commandes `chaos.*` par `/moderation/v2/actions` (enveloppe de la Tombola, clé
// d'idempotence par action ; permissions vérifiées et tracées par le Core). Même forme que le faux Core du Lab pour que
// moderation-fx.js ne change pas. docs/chaos/CONTRAT_LOT2.md § 2.4.
import { ENGINE, effectById } from './catalog.js';

const STATUS = { queued: 'queued', claimed: 'queued', started: 'active', ended: 'done', failed: 'failed', canceled: 'cancelled', expired: 'expired' };

const row = (r) => {
  const e = effectById(r.effect);
  return {
    id: r.id,
    effect: r.effect,
    label: e?.label ?? r.effect,
    summary: [r.preset && e?.presets?.find((p) => p.id === r.preset)?.label, r.level && e?.levels?.find((l) => l.id === r.level)?.label, `${Math.round((r.duration_ms ?? 0) / 1000)} s`].filter(Boolean).join(' · '),
    duration: Math.round((r.duration_ms ?? 0) / 1000),
    price: r.price ?? 0,
    credit: r.payment === 'credit' ? r.credit_id ?? true : null,
    by: r.payment === 'gift' ? 'mod' : 'viewer',
    buyer: { id: r.viewer_id ?? '', name: r.viewer_name ?? '' },
    mine: false,
    state: STATUS[r.status] ?? r.status,
    position: r.position ?? null,
    eta: r.eta_s ?? 0,
    remaining: r.remaining_s ?? 0,
    progress: r.progress ?? 0,
    refunded: r.refund_status === 'refunded',
    reason: r.reason ?? null,
    created: Date.parse(r.created_at ?? '') || Date.now(),
    finished: Date.parse(r.ended_at ?? '') || null,
  };
};
const credit = (c) => ({
  id: c.id,
  effect: c.effect_id ?? c.effect,
  constraints: { maxS: c.constraints?.max_duration_ms ? Math.round(c.constraints.max_duration_ms / 1000) : c.constraints?.maxS, levels: c.constraints?.levels, presets: c.constraints?.presets },
  source: { kind: c.source_kind ?? 'moderator', by: c.source_by ?? '' },
  reason: c.reason ?? '',
  state: c.state ?? 'available',
  viewer: { id: c.viewer_id ?? '', name: c.viewer_name ?? '' },
});

export function createFxCore({ client, overview }) {
  const ch = () => overview()?.chaos ?? {};
  const key = () => `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  /** Une commande chaos.* : { ok } ou { ok: false, message } (le Core dit pourquoi). */
  async function act(command) {
    try {
      await client.modV2Act({ action: 'chaos', command }, key());
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err?.message && !/^x$/u.test(err.message) ? err.message : (err?.code ?? 'Refusé par le Core.') };
    }
  }
  const mock = {
    snapshot() {
      const c = ch();
      return {
        status: c.module_state === 'paused' ? 'paused' : 'open',
        maxActive: ENGINE.safetyMaxActive,
        queueMax: 3,
        burstMax: 10,
        active: (c.active ?? []).map(row),
        queue: (c.queue ?? []).map((r, i) => ({ ...row(r), position: r.position ?? i + 1 })),
        burst: (c.burst ?? []).map(row),
        history: (c.recent ?? []).map(row),
        allCredits: (c.credits_pending ?? []).map(credit),
        viewers: [],
      };
    },
    moderation: {
      cancel: (id, { refund = true, reason = null } = {}) => act({ action: 'cancel', id, refund, reason }),
      remove: (id, { refund, reason = null } = {}) => act({ action: 'stop', id, refund, reason }),
      refund: (id, reason) => act({ action: 'refund', id, reason }),
      stopAll: () => act({ action: 'stop_all' }),
      setPaused: (paused) => act({ action: 'pause', paused }),
      trigger: (effect, choice) => act({ action: 'gift', effect, choice }),
      async grantCredit({ viewer, effect, constraints = {}, reason }) {
        let id = viewer?.id ?? null;
        if (!id && viewer?.name) {
          try {
            const found = (await client.modV2(`search?q=${encodeURIComponent(viewer.name)}`)).viewers ?? [];
            id = found.find((v) => String(v.display_name ?? '').toLowerCase() === viewer.name.toLowerCase())?.viewer_id ?? null;
          } catch {
            id = null;
          }
        }
        if (!id) return { ok: false, message: 'Viewer introuvable : vérifie le pseudo.' };
        return act({ action: 'credit_grant', viewer_id: id, effect, constraints: { max_duration_ms: constraints.maxS ? constraints.maxS * 1000 : undefined, levels: constraints.levels }, reason });
      },
      revokeCredit: (creditId, reason) => act({ action: 'credit_revoke', credit_id: creditId, reason }),
    },
  };
  return { getMock: () => mock, capS: () => ch().cap_s ?? ENGINE.safetyDurationS };
}
