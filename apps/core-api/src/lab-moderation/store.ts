import type { Queryable } from '../db/db.js';

// Moderation V2 + Lab test wallet: primitives shared by the TTS / Soundboard / Bonk Lab services,
// always called inside their own transaction (so an admission, its debit, a cancellation and its
// refund are atomic). Lab database only.

export type LabModule = 'tts' | 'soundboard' | 'bonk' | 'raffle';
export type ModuleState = 'active' | 'paused' | 'disabled';
export type LabRole = 'broadcaster' | 'supermod' | 'moderator' | 'viewer';
export type WalletCurrency = 'tokens' | 'credits_tts' | 'credits_soundboard';

/** Who acts. `via: 'studio'` = the local Studio (the broadcaster's own cockpit). */
export interface Actor {
  id: string;
  login?: string;
  /** Role claimed by the caller (Lab JWT role); Core computes the effective role. */
  role: LabRole;
  via: 'studio' | 'extension' | 'system';
}

export const SYSTEM: Actor = {
  id: 'system',
  role: 'broadcaster',
  via: 'system',
};
export const actorName = (a: Actor) =>
  a.via === 'system'
    ? 'system'
    : a.via === 'studio'
      ? `studio:${a.id}`
      : `${a.login ?? a.id}`;

// --- permissions --------------------------------------------------------------------------------------

/**
 * Permission per action. A Twitch moderator is not trusted with money: refunds and disabling a
 * module need a supermod (granted by the broadcaster); configuration and the Lab wallet are the
 * broadcaster's.
 */
export const PERMISSIONS: Record<string, LabRole> = {
  'module.pause': 'moderator',
  'module.resume': 'moderator',
  'module.disable': 'supermod',
  'queue.stop': 'moderator',
  'queue.cancel': 'moderator',
  'queue.purge': 'moderator',
  refund: 'supermod',
  'viewer.block': 'moderator',
  'viewer.cooldown': 'moderator',
  'viewer.read': 'moderator',
  'audit.read': 'moderator',
  'config.tts': 'broadcaster',
  'staff.manage': 'broadcaster',
  'wallet.lab': 'broadcaster',
};
const RANK: Record<LabRole, number> = {
  viewer: 0,
  moderator: 1,
  supermod: 2,
  broadcaster: 3,
};

export class LabForbiddenError extends Error {
  constructor(
    readonly permission: string,
    readonly role: LabRole,
  ) {
    super(
      `forbidden: ${permission} needs ${PERMISSIONS[permission]} (role ${role})`,
    );
  }
}

/** Effective role: Studio = broadcaster; a moderator listed as staff is a supermod. */
export async function effectiveRole(
  q: Queryable,
  channelId: string,
  a: Actor,
): Promise<LabRole> {
  if (a.via === 'studio' || a.via === 'system') return 'broadcaster';
  if (a.role === 'moderator') {
    const staff = await q.query<{ role: string }>(
      'select role from lab_staff where channel_id = $1 and viewer_id = $2',
      [channelId, a.id],
    );
    if (staff[0]?.role === 'supermod') return 'supermod';
  }
  return a.role;
}

export async function assertAllowed(
  q: Queryable,
  channelId: string,
  a: Actor,
  permission: string,
): Promise<LabRole> {
  const role = await effectiveRole(q, channelId, a);
  const needed = PERMISSIONS[permission] ?? 'broadcaster';
  if (RANK[role] < RANK[needed]) throw new LabForbiddenError(permission, role);
  return role;
}

export function permissionsFor(role: LabRole): string[] {
  return Object.entries(PERMISSIONS)
    .filter(([, needed]) => RANK[role] >= RANK[needed])
    .map(([p]) => p);
}

// --- audit -----------------------------------------------------------------------------------------------

export interface AuditEntry {
  channelId: string;
  actor: Actor;
  role?: LabRole;
  module?: LabModule | 'all' | null;
  action: string;
  viewerId?: string | null;
  interactionId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function audit(q: Queryable, now: Date, e: AuditEntry) {
  await q.query(
    `insert into lab_moderation_audit (channel_id, created_at, actor, role, module_id, action, viewer_id, interaction_id, reason, before, after)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      e.channelId,
      now,
      actorName(e.actor),
      e.role ?? (e.actor.via === 'extension' ? e.actor.role : 'broadcaster'),
      e.module ?? null,
      e.action,
      e.viewerId ?? null,
      e.interactionId ?? null,
      e.reason ?? null,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
    ],
  );
}

// --- module states (Soundboard, Bonk, Tombola; TTS keeps its own) --------------------------------------------

export async function moduleState(
  q: Queryable,
  module: Exclude<LabModule, 'tts'>,
): Promise<ModuleState> {
  const row = (
    await q.query<{ state: ModuleState }>(
      'select state from lab_modules where module_id = $1',
      [module],
    )
  )[0];
  return row?.state ?? 'active';
}

export async function setModuleState(
  q: Queryable,
  module: Exclude<LabModule, 'tts'>,
  state: ModuleState,
  now: Date,
  by: string,
) {
  await q.query(
    `insert into lab_modules (module_id, state, updated_at, updated_by) values ($1, $2, $3, $4)
     on conflict (module_id) do update set state = excluded.state, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [module, state, now, by],
  );
}

// --- viewer restrictions ----------------------------------------------------------------------------------------

export interface Restriction {
  kind: 'block' | 'cooldown';
  module: string;
  until: string | null;
  reason: string | null;
  actor: string;
  created_at: string;
}

/** Active block of this viewer on this module (or on everything), if any. */
export async function activeBlock(
  q: Queryable,
  channelId: string,
  viewerId: string,
  module: LabModule,
  now: Date,
) {
  return (
    (
      await q.query<{ module_id: string; until: Date | null }>(
        `select module_id, until from lab_viewer_blocks where channel_id = $1 and viewer_id = $2
         and module_id in ('all', $3) and (until is null or until > $4) order by until nulls first limit 1`,
        [channelId, viewerId, module, now],
      )
    )[0] ?? null
  );
}

/** Moderation cooldown of this viewer on Soundboard / Bonk (ms remaining, 0 if none). */
export async function moderationCooldownMs(
  q: Queryable,
  channelId: string,
  viewerId: string,
  module: LabModule,
  now: Date,
) {
  if (module === 'tts') return 0; // TTS: per-viewer cooldown in tts_lab_viewers
  const row = (
    await q.query<{ until: Date }>(
      'select until from lab_viewer_cooldowns where channel_id = $1 and viewer_id = $2 and module_id = $3',
      [channelId, viewerId, module],
    )
  )[0];
  return row ? Math.max(0, row.until.getTime() - now.getTime()) : 0;
}

export async function restrictions(
  q: Queryable,
  channelId: string,
  viewerId: string,
  now: Date,
): Promise<Restriction[]> {
  const blocks = await q.query<{
    module_id: string;
    until: Date | null;
    reason: string | null;
    actor: string;
    created_at: Date;
  }>(
    `select module_id, until, reason, actor, created_at from lab_viewer_blocks
     where channel_id = $1 and viewer_id = $2 and (until is null or until > $3) order by created_at`,
    [channelId, viewerId, now],
  );
  const cds = await q.query<{
    module_id: string;
    until: Date;
    reason: string | null;
    actor: string;
    created_at: Date;
  }>(
    `select module_id, until, reason, actor, created_at from lab_viewer_cooldowns
     where channel_id = $1 and viewer_id = $2 and until > $3 order by created_at`,
    [channelId, viewerId, now],
  );
  const tts = (
    await q.query<{ cooldown_until: Date | null }>(
      'select cooldown_until from tts_lab_viewers where channel_id = $1 and viewer_id = $2',
      [channelId, viewerId],
    )
  )[0];
  const out: Restriction[] = blocks.map((b) => ({
    kind: 'block',
    module: b.module_id,
    until: b.until?.toISOString() ?? null,
    reason: b.reason,
    actor: b.actor,
    created_at: b.created_at.toISOString(),
  }));
  for (const c of cds)
    out.push({
      kind: 'cooldown',
      module: c.module_id,
      until: c.until.toISOString(),
      reason: c.reason,
      actor: c.actor,
      created_at: c.created_at.toISOString(),
    });
  if (tts?.cooldown_until && tts.cooldown_until > now)
    out.push({
      kind: 'cooldown',
      module: 'tts',
      until: tts.cooldown_until.toISOString(),
      reason: null,
      actor: '',
      created_at: '',
    });
  return out;
}

/** Blocks a viewer on one module or everything. Returns the previous block (if any). */
export async function setBlock(
  q: Queryable,
  now: Date,
  p: {
    channelId: string;
    viewerId: string;
    module: string;
    until: Date | null;
    reason: string | null;
    actor: string;
  },
) {
  const before = (
    await q.query<{ until: Date | null }>(
      'select until from lab_viewer_blocks where channel_id = $1 and viewer_id = $2 and module_id = $3',
      [p.channelId, p.viewerId, p.module],
    )
  )[0];
  await q.query(
    `insert into lab_viewer_blocks (channel_id, viewer_id, module_id, until, reason, actor, created_at) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (channel_id, viewer_id, module_id) do update set until = excluded.until, reason = excluded.reason, actor = excluded.actor, created_at = excluded.created_at`,
    [p.channelId, p.viewerId, p.module, p.until, p.reason, p.actor, now],
  );
  return before ?? null;
}

/** Lifts a block (and the legacy TTS-only block field). Returns whether a block was removed. */
export async function clearBlock(
  q: Queryable,
  channelId: string,
  viewerId: string,
  module: string,
) {
  const removed = await q.query(
    'delete from lab_viewer_blocks where channel_id = $1 and viewer_id = $2 and module_id = $3 returning 1',
    [channelId, viewerId, module],
  );
  if (module === 'tts' || module === 'all')
    await q.query(
      'update tts_lab_viewers set blocked = false, blocked_until = null where channel_id = $1 and viewer_id = $2',
      [channelId, viewerId],
    );
  return removed.length > 0;
}

// --- Lab test wallet ------------------------------------------------------------------------------------------------

/** Default test wallet of a viewer (first use, « Reset test »). */
export const DEFAULT_LAB_WALLET = {
  tokens: 12_000,
  credits_tts: 1,
  credits_soundboard: 3,
} as const;

export interface LabWallet {
  tokens: number;
  credits_tts: number;
  credits_soundboard: number;
}

export class LabWalletError extends Error {
  constructor(
    readonly code: 'insufficient_tokens' | 'insufficient_credits',
    readonly details: Record<string, unknown>,
  ) {
    super(code);
  }
}

/** Locks (and creates with the defaults) the viewer's test wallet. */
export async function lockWallet(
  q: Queryable,
  channelId: string,
  viewerId: string,
  now: Date,
): Promise<LabWallet> {
  await q.query(
    `insert into lab_wallets (channel_id, viewer_id, tokens, credits_tts, credits_soundboard, updated_at)
     values ($1, $2, $3, $4, $5, $6) on conflict (channel_id, viewer_id) do nothing`,
    [
      channelId,
      viewerId,
      DEFAULT_LAB_WALLET.tokens,
      DEFAULT_LAB_WALLET.credits_tts,
      DEFAULT_LAB_WALLET.credits_soundboard,
      now,
    ],
  );
  const r = (
    await q.query<{
      tokens: string;
      credits_tts: number;
      credits_soundboard: number;
    }>(
      'select tokens, credits_tts, credits_soundboard from lab_wallets where channel_id = $1 and viewer_id = $2 for update',
      [channelId, viewerId],
    )
  )[0]!;
  return {
    tokens: Number(r.tokens),
    credits_tts: r.credits_tts,
    credits_soundboard: r.credits_soundboard,
  };
}

export async function readWallet(
  q: Queryable,
  channelId: string,
  viewerId: string,
): Promise<LabWallet> {
  const r = (
    await q.query<{
      tokens: string;
      credits_tts: number;
      credits_soundboard: number;
    }>(
      'select tokens, credits_tts, credits_soundboard from lab_wallets where channel_id = $1 and viewer_id = $2',
      [channelId, viewerId],
    )
  )[0];
  return r
    ? {
        tokens: Number(r.tokens),
        credits_tts: r.credits_tts,
        credits_soundboard: r.credits_soundboard,
      }
    : { ...DEFAULT_LAB_WALLET };
}

async function writeWallet(
  q: Queryable,
  channelId: string,
  viewerId: string,
  w: LabWallet,
  now: Date,
) {
  await q.query(
    'update lab_wallets set tokens = $3, credits_tts = $4, credits_soundboard = $5, updated_at = $6 where channel_id = $1 and viewer_id = $2',
    [channelId, viewerId, w.tokens, w.credits_tts, w.credits_soundboard, now],
  );
}

/**
 * Debit of an interaction (inside its admission transaction). Refused (nothing written) when the
 * test balance is too low; never twice for the same interaction.
 */
export async function debit(
  q: Queryable,
  now: Date,
  p: {
    channelId: string;
    viewerId: string;
    currency: WalletCurrency;
    amount: number;
    module: LabModule;
    interactionId: string;
  },
) {
  const w = await lockWallet(q, p.channelId, p.viewerId, now);
  if (w[p.currency] < p.amount)
    throw new LabWalletError(
      p.currency === 'tokens' ? 'insufficient_tokens' : 'insufficient_credits',
      {
        balance: w[p.currency],
        needed: p.amount,
      },
    );
  w[p.currency] -= p.amount;
  await writeWallet(q, p.channelId, p.viewerId, w, now);
  await q.query(
    `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, module_id, interaction_id, actor, reason, created_at)
     values ($1, $2, 'debit', $3, $4, $5, $6, 'system', null, $7)`,
    [
      p.channelId,
      p.viewerId,
      p.currency,
      -p.amount,
      p.module,
      p.interactionId,
      now,
    ],
  );
}

/**
 * Gives back exactly what was debited for this interaction, at most once. Returns the amount
 * refunded (0 when nothing had been debited or it was already refunded).
 */
export async function refundDebit(
  q: Queryable,
  now: Date,
  interactionId: string,
  actor: string,
  reason: string,
) {
  const d = (
    await q.query<{
      channel_id: string;
      viewer_id: string;
      currency: WalletCurrency;
      amount: string;
      module_id: string;
    }>(
      `select channel_id, viewer_id, currency, amount, module_id from lab_wallet_ledger where interaction_id = $1 and kind = 'debit'`,
      [interactionId],
    )
  )[0];
  if (!d) return { amount: 0, currency: null as WalletCurrency | null };
  const inserted = await q.query(
    `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, module_id, interaction_id, actor, reason, created_at)
     values ($1, $2, 'refund', $3, $4, $5, $6, $7, $8, $9) on conflict do nothing returning id`,
    [
      d.channel_id,
      d.viewer_id,
      d.currency,
      -Number(d.amount),
      d.module_id,
      interactionId,
      actor,
      reason,
      now,
    ],
  );
  if (!inserted.length) return { amount: 0, currency: d.currency };
  const w = await lockWallet(q, d.channel_id, d.viewer_id, now);
  w[d.currency] += -Number(d.amount);
  await writeWallet(q, d.channel_id, d.viewer_id, w, now);
  return { amount: -Number(d.amount), currency: d.currency };
}

/** Lab-only wallet edits (Studio « Wallet de test »): set values, add / remove, reset to defaults. */
export async function editWallet(
  q: Queryable,
  now: Date,
  channelId: string,
  viewerId: string,
  kind: 'set' | 'adjust' | 'reset',
  values: Partial<LabWallet>,
  actor: string,
): Promise<{ before: LabWallet; after: LabWallet }> {
  const before = await lockWallet(q, channelId, viewerId, now);
  const after: LabWallet = { ...before };
  for (const c of ['tokens', 'credits_tts', 'credits_soundboard'] as const) {
    if (kind === 'reset') after[c] = DEFAULT_LAB_WALLET[c];
    else if (values[c] !== undefined)
      after[c] =
        kind === 'set' ? values[c]! : Math.max(0, before[c] + values[c]!);
  }
  await writeWallet(q, channelId, viewerId, after, now);
  for (const c of ['tokens', 'credits_tts', 'credits_soundboard'] as const)
    if (after[c] !== before[c])
      await q.query(
        `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, module_id, interaction_id, actor, reason, created_at)
         values ($1, $2, $3, $4, $5, null, null, $6, null, $7)`,
        [channelId, viewerId, kind, c, after[c] - before[c], actor, now],
      );
  return { before, after };
}
