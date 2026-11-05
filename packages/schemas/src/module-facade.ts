// The extension's door to the module host (docs/studio-refonte/architecture/GUIDE_EXTENSION.md), written ONCE and used by
// BOTH extension servers — the Production façade (core-api/src/ext/ext-facade.ts) and the Extension Lab EBS
// (studio/server/src/extension-lab/lab-ebs.ts) — so a new module is never written twice (architecture friction E1).
// The viewer is the verified caller's identity (never a body field); a paid action needs the client's Idempotency-Key
// (one per intent); the Core decides everything (availability, price, payment, refusals).

/** `(path, body?)`: GET without body, POST with one; a refusal throws `{ status, body }` (both servers' Core client). */
export type ModuleCoreCall = <T>(path: string, body?: unknown) => Promise<T>;

export interface ModuleFacadeReply {
  status: number;
  body: Record<string, unknown>;
}

interface CatalogModule {
  id: string;
  label: string;
  description: string;
  category: string;
  capabilities: string[];
  enabled: boolean;
  viewer: { name: string; label: string; price: number; live_only: boolean }[];
  moderation: { visible: boolean; refund: 'never' | 'moderator' } | null;
}

const ID = '[a-z][a-z0-9_]{1,40}';
const ACTION = '[a-z][a-z0-9_]{0,40}';

/** Returns null when the path is not a module path (the caller goes on with its own routes). */
export async function moduleFacade(o: {
  call: ModuleCoreCall;
  channelId: string;
  method: string;
  path: string;
  body: unknown;
  viewer: { id: string; display_name: string } | null;
  idempotencyKey?: string | null;
  /**
   * The verified caller as a moderation actor when the caller is on the channel's team (null otherwise): the Core
   * checks the permission (refund: moderator) and audits — the façade never decides.
   */
  moderator?: { id: string; role: string; via: 'extension'; display_name?: string } | null;
}): Promise<ModuleFacadeReply | null> {
  if (o.path !== '/modules/v3' && !o.path.startsWith('/modules/v3/'))
    return null;
  const base = `/v1/lab/modules/${o.channelId}`;
  const sub = o.path.slice('/modules/v3'.length);
  let m: RegExpExecArray | null;
  try {
    // Moderation of the host's modules (GUIDE_MODERATION.md): the shared journal and the refund of an original debit.
    const modJournal = new RegExp(`^/moderation/(${ID})/activity$`).exec(sub);
    if (modJournal || sub === '/moderation/refund' || sub === '/moderation') {
      // The journal names every viewer: team only (the refund's permission is checked again by the Core).
      if (!o.moderator || (o.moderator.role !== 'moderator' && o.moderator.role !== 'broadcaster'))
        return { status: 403, body: { ok: false, error: 'forbidden' } };
      if (o.method === 'GET' && sub === '/moderation') {
        // The team's list (the D4 console): every module whose policy shows it — switched off ones too (their journal
        // and refunds still matter).
        const { modules } = await o.call<{ modules: CatalogModule[] }>(base);
        return {
          status: 200,
          body: {
            ok: true,
            modules: modules
              .filter((x) => x.moderation?.visible)
              .map((x) => ({
                id: x.id,
                label: x.label,
                enabled: x.enabled,
                moderation: { visible: true, refund: x.moderation!.refund },
              })),
          },
        };
      }
      if (o.method === 'GET' && modJournal) {
        // One module's journal (never a slice of every module's), and only a module whose policy shows it to the team.
        const { modules } = await o.call<{ modules: CatalogModule[] }>(base);
        const m = modules.find((x) => x.id === modJournal[1]);
        if (!m?.moderation?.visible)
          return { status: 404, body: { ok: false, error: 'not_available' } };
        return {
          status: 200,
          body: {
            ok: true,
            ...(await o.call<Record<string, unknown>>(
              `${base}/activity?module=${encodeURIComponent(m.id)}&limit=100`,
            )),
          },
        };
      }
      if (o.method === 'POST' && sub === '/moderation/refund') {
        const b = (o.body ?? {}) as { activity_id?: unknown; reason?: unknown };
        return {
          status: 200,
          body: {
            ok: true,
            ...(await o.call<Record<string, unknown>>(`${base}/refund`, {
              actor: o.moderator,
              activity_id: b.activity_id,
              reason: b.reason,
            })),
          },
        };
      }
    }
    if (o.method === 'GET' && sub === '') {
      // Only what a viewer needs: the modules that have viewer actions (capability negotiation: the server's list).
      const { modules } = await o.call<{ modules: CatalogModule[] }>(base);
      return {
        status: 200,
        body: {
          ok: true,
          // A module switched off is not offered (Studio says « invisible pour les viewers »).
          modules: modules
            .filter((x) => x.capabilities.includes('viewer') && x.enabled)
            .map((x) => ({
              id: x.id,
              label: x.label,
              description: x.description,
              category: x.category,
              enabled: x.enabled,
              actions: x.viewer,
              // The policy only (what the team's panel may show); the permission is checked by the Core.
              moderation: x.moderation
                ? { visible: x.moderation.visible, refund: x.moderation.refund }
                : null,
            })),
        },
      };
    }
    if (o.method === 'GET' && (m = new RegExp(`^/(${ID})/state$`).exec(sub))) {
      const q = o.viewer
        ? `?viewer_id=${encodeURIComponent(o.viewer.id)}&viewer_name=${encodeURIComponent(o.viewer.display_name)}`
        : '';
      return {
        status: 200,
        body: {
          ok: true,
          ...(await o.call<Record<string, unknown>>(
            `${base}/${m[1]}/viewer-state${q}`,
          )),
        },
      };
    }
    if (
      o.method === 'POST' &&
      (m = new RegExp(`^/(${ID})/(${ACTION})$`).exec(sub))
    ) {
      if (!o.viewer)
        return { status: 403, body: { ok: false, error: 'identity_required' } };
      if (!o.idempotencyKey)
        return {
          status: 400,
          body: { ok: false, error: 'idempotency_key_required' },
        };
      const b = (o.body ?? {}) as { input?: unknown; expected_price?: unknown };
      const input = b.input ?? null;
      const expected =
        typeof b.expected_price === 'number' && Number.isInteger(b.expected_price) && b.expected_price >= 0
          ? b.expected_price
          : undefined;
      return {
        status: 200,
        body: {
          ok: true,
          ...(await o.call<Record<string, unknown>>(
            `${base}/${m[1]}/viewer/${m[2]}`,
            {
              viewer: o.viewer,
              idempotency_key: o.idempotencyKey,
              input,
              ...(expected === undefined ? {} : { expected_price: expected }),
            },
          )),
        },
      };
    }
    return { status: 404, body: { ok: false, error: 'not_available' } };
  } catch (e) {
    const err = e as {
      status?: number;
      body?: Record<string, unknown>;
      message?: string;
    };
    if (typeof err.status !== 'number') throw e;
    return {
      status: err.status,
      body: {
        ...(err.body ?? {}),
        ok: false,
        error: String(err.body?.error ?? err.message ?? 'error'),
      },
    };
  }
}
