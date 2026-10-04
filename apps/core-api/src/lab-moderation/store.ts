import type { Queryable } from '../db/db.js';

// Moderation V2 + Lab test wallet: primitives shared by the TTS / Soundboard / Bonk / Tombola Lab
// services, always called inside their own transaction (so an admission, its debit, a cancellation
// and its refund are atomic). Lab database only.

export type LabModule = 'tts' | 'soundboard' | 'bonk' | 'raffle';
export type ModuleState = 'active' | 'paused' | 'disabled';
export type LabRole = 'broadcaster' | 'supermod' | 'moderator' | 'viewer';
export type WalletCurrency = 'tokens' | 'credits_tts' | 'credits_soundboard';

/** Who acts. `via: 'studio'` = the local Studio (the broadcaster's own cockpit). */
export interface Actor {
  id: string;
  login?: string;
  display_name?: string;
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

// --- permissions (D4) ------------------------------------------------------------------------------------

/**
 * Permissions granted per moderator: the 6 of D4 + « Gérer la Tombola » (Tombola V2, decision D7).
 * Supermods and the broadcaster have all of them.
 */
export const GRANTS = [
  'wallet',
  'modules',
  'globalPause',
  'perms',
  'sensitive',
  'words',
  'raffle',
] as const;
export type Grant = (typeof GRANTS)[number];

/**
 * Who may do what. `moderator` = every moderator (standard D4 moderation, refunds included);
 * a Grant = moderators it was granted to (+ supermods and the broadcaster); `broadcaster` = the
 * broadcaster only (Studio: TTS configuration, supermods, Lab wallet tools, Tombola controls).
 */
export const PERMISSIONS: Record<
  string,
  'moderator' | 'supermod' | 'broadcaster' | Grant
> = {
  'module.pause': 'moderator',
  'module.resume': 'moderator',
  'module.disable': 'modules',
  'queue.stop': 'moderator',
  'queue.cancel': 'moderator',
  'queue.purge': 'moderator',
  refund: 'moderator',
  'refund.manual': 'wallet',
  'review.allow': 'moderator',
  'viewer.block': 'moderator',
  'viewer.cooldown': 'moderator',
  'viewer.read': 'moderator',
  'audit.read': 'moderator',
  'notes.write': 'moderator',
  'sanction.sensitive': 'sensitive',
  'global.pause': 'globalPause',
  'perms.manage': 'perms',
  'words.manage': 'words',
  'wallet.admin': 'wallet',
  'config.tts': 'broadcaster',
  'staff.manage': 'broadcaster',
  'wallet.lab': 'broadcaster',
  // Tombola V2 (D7): safe actions for every moderator; more time, pause, immediate draw, manual
  // entry, payout retry and opening need « Gérer la Tombola »; configuration and stream sessions:
  // supermods and the broadcaster (« Supermod = accès complet Tombola »).
  'raffle.moderate': 'moderator',
  'raffle.manage': 'raffle',
  'raffle.config': 'supermod',
  // Manual entry over an explicit Tombola block: « Sanctions sensibles » (audited).
  'raffle.force': 'sensitive',
};
const RANK: Record<LabRole, number> = {
  viewer: 0,
  moderator: 1,
  supermod: 2,
  broadcaster: 3,
};

export interface Access {
  role: LabRole;
  /** Effective D4 grants (all of them for supermods and the broadcaster). */
  grants: Grant[];
}

export class LabForbiddenError extends Error {
  constructor(
    readonly permission: string,
    readonly role: LabRole,
  ) {
    super(`forbidden: ${permission} (role ${role})`);
  }
  /** The D4 permission that would allow it, if any (« Permission « X » requise »). */
  get grant(): Grant | null {
    const need = PERMISSIONS[this.permission];
    return need && (GRANTS as readonly string[]).includes(need)
      ? (need as Grant)
      : null;
  }
  get needs(): string {
    return PERMISSIONS[this.permission] ?? 'broadcaster';
  }
}

/** Effective role and grants. Studio = broadcaster; a moderator named by the broadcaster = supermod. */
export async function access(
  q: Queryable,
  channelId: string,
  a: Actor,
): Promise<Access> {
  if (a.via === 'studio' || a.via === 'system' || a.role === 'broadcaster')
    return { role: 'broadcaster', grants: [...GRANTS] };
  if (a.role === 'moderator') {
    const staff = (
      await q.query<{ role: string; grants: string[] }>(
        'select role, grants from lab_staff where channel_id = $1 and viewer_id = $2',
        [channelId, a.id],
      )
    )[0];
    if (staff?.role === 'supermod')
      return { role: 'supermod', grants: [...GRANTS] };
    return {
      role: 'moderator',
      grants: (staff?.grants ?? []).filter((g): g is Grant =>
        (GRANTS as readonly string[]).includes(g),
      ),
    };
  }
  return { role: 'viewer', grants: [] };
}

export function allowed(acc: Access, permission: string): boolean {
  const need = PERMISSIONS[permission] ?? 'broadcaster';
  if (need === 'broadcaster') return acc.role === 'broadcaster';
  if (need === 'moderator') return RANK[acc.role] >= RANK.moderator;
  if (need === 'supermod') return RANK[acc.role] >= RANK.supermod;
  return (
    RANK[acc.role] >= RANK.supermod ||
    (acc.role === 'moderator' && acc.grants.includes(need))
  );
}

export function assertAccess(acc: Access, permission: string) {
  if (!allowed(acc, permission))
    throw new LabForbiddenError(permission, acc.role);
}

/** Checks one permission; returns the effective role (audit). */
export async function assertAllowed(
  q: Queryable,
  channelId: string,
  a: Actor,
  permission: string,
): Promise<LabRole> {
  const acc = await access(q, channelId, a);
  assertAccess(acc, permission);
  return acc.role;
}

export function permissionsFor(acc: Access): string[] {
  return Object.keys(PERMISSIONS).filter((p) => allowed(acc, p));
}

/** Staff seen through the extension (Twitch JWT role) joins the team; its name is kept up to date. */
export async function touchStaff(
  q: Queryable,
  channelId: string,
  a: Actor,
  now: Date,
) {
  if (a.via !== 'extension') return;
  if (a.role !== 'moderator' && a.role !== 'broadcaster') return;
  const name = a.display_name ?? a.login ?? a.id;
  await q.query(
    `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at, login, display_name, last_seen)
     values ($1, $2, $3, 'twitch', $4, $5, $6, $4)
     on conflict (channel_id, viewer_id) do update set login = coalesce(excluded.login, lab_staff.login),
       display_name = excluded.display_name, last_seen = excluded.last_seen`,
    [
      channelId,
      a.id,
      a.role === 'broadcaster' ? 'broadcaster' : 'moderator',
      now,
      a.login ?? null,
      name,
    ],
  );
  await seeViewer(q, channelId, a.id, name, now);
}

/** A team member (or the channel owner) cannot be sanctioned from moderation (D4). */
export async function isStaff(
  q: Queryable,
  channelId: string,
  viewerId: string,
) {
  if (viewerId === channelId) return true;
  return (
    (
      await q.query(
        'select 1 from lab_staff where channel_id = $1 and viewer_id = $2',
        [channelId, viewerId],
      )
    ).length > 0
  );
}

// --- viewer directory -----------------------------------------------------------------------------------------

/** Every viewer seen by a Lab module: search, « Premier passage », names in histories. */
export async function seeViewer(
  q: Queryable,
  channelId: string,
  viewerId: string,
  displayName: string,
  now: Date,
) {
  await q.query(
    `insert into lab_viewers (channel_id, viewer_id, display_name, first_seen, last_seen) values ($1, $2, $3, $4, $4)
     on conflict (channel_id, viewer_id) do update set display_name = excluded.display_name,
       last_seen = greatest(lab_viewers.last_seen, excluded.last_seen)`,
    [channelId, viewerId, displayName, now],
  );
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

/** State of any module, TTS included (tts_lab_settings). */
export async function anyModuleState(
  q: Queryable,
  module: LabModule,
): Promise<ModuleState> {
  if (module !== 'tts') return moduleState(q, module);
  return (
    (
      await q.query<{ module_state: ModuleState }>(
        'select module_state from tts_lab_settings where id',
      )
    )[0]?.module_state ?? 'active'
  );
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

// --- global pause (D4) ------------------------------------------------------------------------------------------

/** Thrown inside an admission transaction; the service counts the refusal outside of it. */
export class GlobalPauseError extends Error {
  readonly code = 'global_pause';
  constructor() {
    super('Raptoru is paused: new interactions are refused');
  }
}

export async function globalState(q: Queryable, channelId: string) {
  const row = (
    await q.query<{
      paused: boolean;
      paused_at: Date | null;
      paused_by: string | null;
      refused_count: number;
    }>(
      'select paused, paused_at, paused_by, refused_count from lab_global_state where channel_id = $1',
      [channelId],
    )
  )[0];
  return {
    paused: row?.paused ?? false,
    paused_at: row?.paused_at ? new Date(row.paused_at).toISOString() : null,
    paused_by: row?.paused_by ?? null,
    refused: row?.refused_count ?? 0,
  };
}

export async function assertNotGloballyPaused(q: Queryable, channelId: string) {
  if ((await globalState(q, channelId)).paused) throw new GlobalPauseError();
}

/** One more interaction refused by the global pause (shown in the D4 banner). */
export async function countGlobalRefusal(
  q: Queryable,
  channelId: string,
  now: Date,
) {
  await q.query(
    'update lab_global_state set refused_count = refused_count + 1, updated_at = $2 where channel_id = $1 and paused',
    [channelId, now],
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
  /** Cooldown only: imposed delay between two uses, and « Ce stream ». */
  delay_s?: number;
  stream?: boolean;
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

const USE_TABLE = {
  tts: 'tts_lab_interactions',
  soundboard: 'sound_lab_interactions',
  bonk: 'bonk_lab_interactions',
} as const;

/**
 * D4 personal cooldown: during its span, this viewer must wait `delay_s` between two uses of the
 * module. Returns the ms left before the next use (0 = allowed). A use = an admitted interaction
 * that was not a failure (a removal by moderation still counts).
 */
export async function personalCooldownMs(
  q: Queryable,
  channelId: string,
  viewerId: string,
  module: LabModule,
  now: Date,
) {
  if (module === 'raffle') return 0;
  const cd = (
    await q.query<{ delay_s: number; until: Date }>(
      'select delay_s, until from lab_viewer_cooldowns where channel_id = $1 and viewer_id = $2 and module_id = $3 and until > $4',
      [channelId, viewerId, module, now],
    )
  )[0];
  if (!cd) return 0;
  const last = (
    await q.query<{ at: Date | null }>(
      `select max(created_at) as at from ${USE_TABLE[module]} where channel_id = $1 and viewer_id = $2 and status <> 'failed'`,
      [channelId, viewerId],
    )
  )[0]?.at;
  if (!last) return 0;
  const next = Math.min(
    new Date(last).getTime() + cd.delay_s * 1000,
    new Date(cd.until).getTime(),
  );
  return Math.max(0, next - now.getTime());
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
    delay_s: number;
    until: Date;
    stream: boolean;
    reason: string | null;
    actor: string;
    created_at: Date;
  }>(
    `select module_id, delay_s, until, stream, reason, actor, created_at from lab_viewer_cooldowns
     where channel_id = $1 and viewer_id = $2 and until > $3 order by created_at`,
    [channelId, viewerId, now],
  );
  const out: Restriction[] = blocks.map((b) => ({
    kind: 'block',
    module: b.module_id,
    until: b.until ? new Date(b.until).toISOString() : null,
    reason: b.reason,
    actor: b.actor,
    created_at: new Date(b.created_at).toISOString(),
  }));
  for (const c of cds)
    out.push({
      kind: 'cooldown',
      module: c.module_id,
      until: new Date(c.until).toISOString(),
      delay_s: c.delay_s,
      stream: c.stream,
      reason: c.reason,
      actor: c.actor,
      created_at: new Date(c.created_at).toISOString(),
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
/** Column bounds of lab_wallets. */
export const LAB_WALLET_MAX: Record<WalletCurrency, number> = {
  tokens: 1_000_000_000,
  credits_tts: 100_000,
  credits_soundboard: 100_000,
};

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
  // ASTRA-P2-006 (option A, decided): the ledger records what the balance really gets back once the
  // wallet cap applies — never more — so balance and ledger always reconcile. Still once per
  // interaction (lab_wallet_ledger_once): a replay inserts nothing and changes nothing.
  const w = await lockWallet(q, d.channel_id, d.viewer_id, now);
  const before = w[d.currency];
  const after = Math.min(LAB_WALLET_MAX[d.currency], before - Number(d.amount));
  const applied = after - before;
  const inserted = await q.query(
    `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, module_id, interaction_id, actor, reason, created_at)
     values ($1, $2, 'refund', $3, $4, $5, $6, $7, $8, $9) on conflict do nothing returning id`,
    [
      d.channel_id,
      d.viewer_id,
      d.currency,
      applied,
      d.module_id,
      interactionId,
      actor,
      reason,
      now,
    ],
  );
  if (!inserted.length) return { amount: 0, currency: d.currency };
  w[d.currency] = after;
  await writeWallet(q, d.channel_id, d.viewer_id, w, now);
  return { amount: applied, currency: d.currency };
}

/** Lab-only wallet tools (Studio « Wallet de test »): set values, add / remove, reset to defaults. */
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
        kind === 'set'
          ? values[c]!
          : Math.min(LAB_WALLET_MAX[c], Math.max(0, before[c] + values[c]!));
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

/**
 * D4 « Wallet admin » (Créditer / Débiter): a debit never goes below 0 (as in D4), the applied
 * amount is recorded as an `admin` movement with its actor and reason.
 */
export async function adminAdjust(
  q: Queryable,
  now: Date,
  p: {
    channelId: string;
    viewerId: string;
    currency: WalletCurrency;
    delta: number;
    actor: string;
    reason: string | null;
  },
) {
  const before = await lockWallet(q, p.channelId, p.viewerId, now);
  const after = { ...before };
  after[p.currency] = Math.min(
    LAB_WALLET_MAX[p.currency],
    Math.max(0, before[p.currency] + p.delta),
  );
  const applied = after[p.currency] - before[p.currency];
  if (applied === 0) return { before, after, applied, ledgerId: null };
  await writeWallet(q, p.channelId, p.viewerId, after, now);
  const id = (
    await q.query<{ id: string }>(
      `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, module_id, interaction_id, actor, reason, created_at)
       values ($1, $2, 'admin', $3, $4, null, null, $5, $6, $7) returning id`,
      [p.channelId, p.viewerId, p.currency, applied, p.actor, p.reason, now],
    )
  )[0]!.id;
  return { before, after, applied, ledgerId: Number(id) };
}
