import { createHash, randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import type { LabChatModule } from '../lab-chat/router.js';
import {
  activeBlock,
  type Actor,
  assertAccess,
  access,
  assertNotGloballyPaused,
  audit,
  GlobalPauseError,
  LabForbiddenError,
  LabWalletError,
  type PaidModule,
} from '../lab-moderation/store.js';
import { insertAnnouncement } from '../commands/steps.js';
import type { ModuleSettings } from '../module-settings/service.js';
import { liveForPaid, STREAM_OFFLINE } from '../stream/live-gate.js';
import {
  checkModule,
  type ModuleContext,
  type ModuleDefinition,
  ModuleError,
  type ModuleStatusView,
  type Viewer,
} from './kit.js';

// The module host: the ONE place where the shared mechanisms meet a module (docs/studio-refonte/architecture/
// CONTRATS.md). Built once per Core from the module list (modules/index.ts) — the main Core and the Lab Core alike, so
// they can never drift. Every paid viewer action follows the same path: idempotent intent → global pause → viewer block
// → module switch → live (H1) → journal row → debit on the Wallet (the runtime's economy) → the module's logic, in ONE
// transaction: refused = nothing paid, nothing stored. A moderator refund pays back the ORIGINAL debit, once.

export interface ActivityRow {
  activity_id: string;
  channel_id: string;
  module_id: string;
  action: string;
  viewer_id: string | null;
  viewer_name: string | null;
  idempotency_key: string | null;
  request_hash: string | null;
  amount: number;
  status: 'done' | 'queued' | 'failed' | 'refunded' | 'canceled';
  input: unknown;
  result: unknown;
  created_at: Date;
  updated_at: Date;
  ended_by: string | null;
  reason: string | null;
  claimed_at?: Date | null;
  claimed_by?: string | null;
}

/** An OBS player's claim on an action: it is that player's for this long (then another player, or the expiry, may). */
export const PLAYER_LEASE_MS = 30_000;

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
export const activityView = (r: ActivityRow) => ({
  activity_id: r.activity_id,
  module_id: r.module_id,
  action: r.action,
  viewer: r.viewer_id ? { id: r.viewer_id, display_name: r.viewer_name } : null,
  amount: Number(r.amount),
  status: r.status,
  result: r.result,
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
  ended_by: r.ended_by,
  reason: r.reason,
  claimed_by: r.claimed_by ?? null,
});

const hash = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(v ?? null))
    .digest('hex');

export class ModuleHost {
  private readonly modules = new Map<string, ModuleDefinition>();
  readonly ctx: ModuleContext;

  constructor(
    defs: readonly ModuleDefinition[],
    deps: {
      db: Db;
      clock: Clock;
      economy: EconomyPort;
      settings: ModuleSettings;
    },
  ) {
    this.deps = deps;
    for (const d of defs) this.add(d);
    const unscoped = () => Promise.reject(new Error('use ctxFor(module)'));
    this.ctx = {
      ...deps,
      setting: unscoped,
      say: unscoped,
      lock: unscoped,
      live: (q) => liveForPaid(q, deps.economy),
      settle: unscoped,
      state: { get: unscoped, set: unscoped },
    };
  }

  private readonly deps: {
    db: Db;
    clock: Clock;
    economy: EconomyPort;
    settings: ModuleSettings;
  };

  /**
   * Registers a module (constructor list, or an adapter built once its historical service exists — e.g. Votekick).
   * Checked like the others; its settings registered; a Lab-only module never on the canonical economy.
   */
  add(d: ModuleDefinition) {
    const deps = this.deps;
    // A Lab-only module (demonstration, experiment) never exists on the canonical economy (Production).
    if (d.labOnly && deps.economy.mode === 'canonical') return;
    const problems = checkModule(d);
    if (problems.length)
      throw new Error(`invalid module ${d.id}: ${problems.join('; ')}`);
    if (this.modules.has(d.id))
      throw new Error(`module declared twice: ${d.id}`);
    this.modules.set(d.id, d);
    deps.settings.register(
      Object.fromEntries([
        ...(this.hasSwitch(d)
          ? [
              [
                `${d.id}.enabled`,
                {
                  label: `${d.label} : actif`,
                  unit: '0 / 1',
                  default: d.enabledByDefault ? 1 : 0,
                  min: 0,
                  max: 1,
                  help: 'interrupteur du module (0 = coupé pour les viewers et le chat)',
                },
              ] as const,
            ]
          : []),
        ...Object.entries(d.settings ?? {}).map(
          ([k, s]) => [`${d.id}.${k}`, s] as const,
        ),
      ]),
    );
  }

  /** The context a module sees: its own settings and state by short key (never another module's). */
  private ctxFor(d: ModuleDefinition): ModuleContext {
    const clock = this.ctx.clock;
    return {
      ...this.ctx,
      setting: (q, channelId, key) =>
        this.ctx.settings.get(q, channelId, `${d.id}.${key}`),
      lock: async (q, channelId, key) => {
        await q.query('select pg_advisory_xact_lock(hashtext($1))', [
          `module:${channelId}:${d.id}:lock:${key}`,
        ]);
      },
      say: (q, channelId, m) =>
        insertAnnouncement(q, {
          channelId,
          now: clock.now(),
          origin: `module:${d.id}`,
          drafts: [
            {
              idempotencyKey: `module:${d.id}:${m.key}`,
              mode: m.announce ? 'announce' : 'normal',
              text: m.text.slice(0, 450),
              delayMs: m.delayMs,
            },
          ],
        }),
      settle: (q, activityId, outcome, actor) =>
        this.settleIn(q, activityId, outcome, actor, d.id),
      state: {
        async get<T>(q: Queryable, channelId: string, key: string) {
          const r = (
            await q.query<{ value: T }>(
              'select value from module_state where channel_id = $1 and module_id = $2 and key = $3',
              [channelId, d.id, key],
            )
          )[0];
          return r ? r.value : null;
        },
        async set(
          q: Queryable,
          channelId: string,
          key: string,
          value: unknown,
        ) {
          await q.query(
            `insert into module_state (channel_id, module_id, key, value, updated_at) values ($1, $2, $3, $4, $5)
             on conflict (channel_id, module_id, key) do update set value = $4, updated_at = $5`,
            [channelId, d.id, key, JSON.stringify(value), clock.now()],
          );
        },
      },
    };
  }

  private module(id: string) {
    const d = this.modules.get(id);
    if (!d) throw new ModuleError(404, 'module_not_found');
    return d;
  }

  get ids() {
    return [...this.modules.keys()];
  }

  /** Chat modules and periodic jobs, handed to the Core assembly once (never per module). */
  /**
   * The chat readers of the modules, behind the host's guard: a module switched off reads nothing; a module that throws
   * is isolated (logged, `module_error`) — the other modules still get the message.
   */
  chatModules(): LabChatModule[] {
    return [...this.modules.values()]
      .filter((d) => d.chat)
      .map((d) => {
        const inner = d.chat!(this.ctxFor(d));
        return {
          ...inner,
          name: d.id,
          chat: inner.chat
            ? async (msg) => {
                try {
                  if (!(await this.enabled(this.ctx.db, msg.channel_id, d)))
                    return { outcome: 'ignored' };
                  return await inner.chat!(msg);
                } catch (e) {
                  console.error(
                    `[modules] ${d.id} chat failed`,
                    (e as Error).message,
                  );
                  return { outcome: 'module_error' };
                }
              }
            : undefined,
        };
      });
  }

  /** The chat words of the modules (Commands V2 refuses them). */
  reservedWords() {
    return [...this.modules.values()].flatMap((d) =>
      (d.chatWords ?? []).map((word) => ({ word, module: d.label })),
    );
  }

  /** The host's own switch `<id>.enabled`: modules that act for viewers (extension or chat), unless they keep theirs. */
  private hasSwitch(d: ModuleDefinition) {
    return !d.enabled && (!!d.viewer || !!d.chat);
  }

  /** The jobs still running (`<module>:<job>`): a slow or hung job is skipped on the next pass, never stacked. */
  private readonly running = new Set<string>();

  /**
   * The periodic job (both Cores, every 5 s): every module's jobs in parallel and isolated — one that throws or hangs
   * never holds the others back, and is never started twice at once.
   */
  async tick() {
    const run = async (
      what: string,
      d: ModuleDefinition,
      job: () => Promise<unknown>,
    ) => {
      const k = `${d.id}:${what}`;
      if (this.running.has(k)) return;
      this.running.add(k);
      try {
        await job();
      } catch (e) {
        console.error(`[modules] ${d.id} ${what} failed`, (e as Error).message);
      } finally {
        this.running.delete(k);
      }
    };
    await Promise.all(
      [...this.modules.values()].flatMap((d) => [
        ...(d.expireQueuedMs
          ? [run('expiry', d, () => this.expireQueued(d))]
          : []),
        ...(d.tick
          ? [run('tick', d, async () => d.tick!(this.ctxFor(d)))]
          : []),
      ]),
    );
  }

  /**
   * Queued actions past the module's delay: failed, a paid one refunded once (each row decided under its lock). An
   * action a player claimed is left to that player until its lease ends (never shown AND refunded).
   */
  async expireQueued(d: ModuleDefinition) {
    const now = this.ctx.clock.now().getTime();
    const cut = new Date(now - d.expireQueuedMs!);
    const old = await this.ctx.db.query<{ activity_id: string }>(
      `select activity_id from module_activity where module_id = $1 and status = 'queued' and created_at < $2
          and (claimed_at is null or claimed_at < $3)`,
      [d.id, cut, new Date(now - PLAYER_LEASE_MS)],
    );
    for (const r of old)
      await this.settle(
        r.activity_id,
        { status: 'failed', result: { expired: true } },
        'expiration',
      );
    return old.length;
  }

  private async enabled(q: Queryable, channelId: string, d: ModuleDefinition) {
    if (d.enabled) return d.enabled(this.ctxFor(d), q, channelId);
    return this.hasSwitch(d)
      ? (await this.ctx.settings.get(q, channelId, `${d.id}.enabled`)) === 1
      : true;
  }

  /** What Studio, the Control Center and the extension read: identity, capabilities, actions, state. */
  async catalog(channelId: string) {
    const out = [];
    for (const d of this.modules.values()) {
      try {
        out.push(await this.entry(channelId, d));
      } catch (e) {
        // One failing module never hides the others: listed, said unknown, nothing offered to viewers.
        out.push({
          id: d.id,
          label: d.label,
          description: d.description,
          category: d.category,
          lab_only: !!d.labOnly,
          capabilities: d.capabilities,
          enabled: false,
          has_switch: this.hasSwitch(d),
          chat_words: d.chatWords ?? [],
          settings: Object.keys(d.settings ?? {}).map((k) => `${d.id}.${k}`),
          admin: [],
          viewer: [],
          moderation: d.moderation ?? null,
          status: {
            intention: 'off' as const,
            observed: 'unknown' as const,
            summary: `Module illisible : ${(e as Error).message}`,
            reasons: [],
          },
        });
      }
    }
    return { modules: out };
  }

  private async entry(channelId: string, d: ModuleDefinition) {
    {
      const c = this.ctxFor(d);
      return {
        id: d.id,
        label: d.label,
        description: d.description,
        category: d.category,
        lab_only: !!d.labOnly,
        capabilities: d.capabilities,
        enabled: await this.enabled(this.ctx.db, channelId, d),
        /** The host's switch `<id>.enabled` exists (Studio shows it with the settings). */
        has_switch: this.hasSwitch(d),
        chat_words: d.chatWords ?? [],
        settings: Object.keys(d.settings ?? {}).map((k) => `${d.id}.${k}`),
        admin: Object.entries(d.admin ?? {}).map(([name, a]) => ({
          name,
          label: a.label,
          confirm: a.confirm ?? null,
          input: a.input ?? null,
        })),
        viewer: await Promise.all(
          Object.entries(d.viewer ?? {}).map(async ([name, a]) => ({
            name,
            label: a.label,
            price: a.price ? await a.price(c, this.ctx.db, channelId) : 0,
            live_only: a.liveOnly !== false && !!a.price,
          })),
        ),
        moderation: d.moderation ?? null,
        status: await this.status(channelId, d.id),
      };
    }
  }

  /** The module's own view of itself, never green on the switch alone; a failing status reads « unknown ». */
  async status(channelId: string, id: string): Promise<ModuleStatusView> {
    const d = this.module(id);
    let on: boolean;
    try {
      on = await this.enabled(this.ctx.db, channelId, d);
    } catch (e) {
      return {
        intention: 'off',
        observed: 'unknown',
        summary: `Interrupteur illisible : ${(e as Error).message}`,
        reasons: [],
      };
    }
    if (!d.status)
      return {
        intention: on ? 'on' : 'off',
        observed: 'unknown',
        summary: 'Ce module ne fournit pas son état.',
        reasons: [],
      };
    try {
      const s = await d.status(this.ctxFor(d), channelId);
      return { ...s, intention: on ? 'on' : 'off' };
    } catch (e) {
      return {
        intention: on ? 'on' : 'off',
        observed: 'unknown',
        summary: `État illisible : ${(e as Error).message}`,
        reasons: [],
      };
    }
  }

  /** Studio / cockpit actions (the broadcaster's identity, or a moderator with the permission the action needs). */
  async admin(
    channelId: string,
    id: string,
    name: string,
    req: { actor: Actor; input?: unknown },
  ) {
    const d = this.module(id);
    const a = d.admin?.[name];
    if (!a) throw new ModuleError(404, 'action_not_found');
    return this.ctx.db.tx(async (q) => {
      const acc = await access(q, channelId, req.actor);
      if (a.permission) assertAccess(acc, a.permission);
      else if (acc.role !== 'broadcaster')
        throw new LabForbiddenError(`${id}.${name}`, acc.role);
      const now = this.ctx.clock.now();
      const result = await a.run(this.ctxFor(d), q, {
        channelId,
        actor: req.actor,
        input: req.input ?? null,
        now,
      });
      const who = (req.actor.display_name ?? req.actor.id).slice(0, 64);
      // History (capability « history »): an admin action is a journal row too, its operator named.
      await q.query(
        `insert into module_activity (activity_id, channel_id, module_id, action, viewer_name, amount, status, input,
           result, created_at, updated_at, ended_by) values ($1, $2, $3, $4, null, 0, 'done', $5, $6, $7, $7, $8)`,
        [
          randomUUID(),
          channelId,
          id,
          name,
          JSON.stringify(req.input ?? null),
          JSON.stringify(result ?? null),
          now,
          who,
        ],
      );
      await audit(q, now, {
        channelId,
        actor: req.actor,
        role: acc.role,
        action: `${id}.${name}`,
        after: { module: id, input: req.input ?? null },
      });
      return { ok: true, result };
    });
  }

  /**
   * A viewer action (extension façade, Lab): one intent = one key. Replayed key + same request → the first answer;
   * same key, another request → refused. Everything below is refused BEFORE any payment, in one transaction.
   */
  async viewer(
    channelId: string,
    id: string,
    name: string,
    req: {
      viewer: Viewer;
      idempotency_key: string;
      input?: unknown;
      /** The price the viewer confirmed: a different current price refuses BEFORE the debit (`price_changed`). */
      expected_price?: number;
    },
  ) {
    const d = this.module(id);
    const a = d.viewer?.[name];
    if (!a) throw new ModuleError(404, 'action_not_found');
    if (!/^[A-Za-z0-9_:-]{8,128}$/.test(req.idempotency_key ?? ''))
      throw new ModuleError(400, 'idempotency_key_required');
    const requestHash = hash([name, req.viewer.id, req.input ?? null]);
    try {
      return await this.ctx.db.tx(async (q) => {
        // One viewer's actions on one module, one at a time (a resent intent waits for the first and replays it; a
        // module's per-viewer limit is read after the previous purchase committed).
        await q.query('select pg_advisory_xact_lock(hashtext($1))', [
          `module:${channelId}:${id}:${req.viewer.id}`,
        ]);
        const prior = (
          await q.query<ActivityRow>(
            `select * from module_activity where channel_id = $1 and module_id = $2 and idempotency_key = $3`,
            [channelId, id, req.idempotency_key],
          )
        )[0];
        if (prior) {
          if (prior.request_hash !== requestHash)
            throw new ModuleError(409, 'idempotency_conflict');
          return { activity: activityView(prior), replayed: true };
        }
        const now = this.ctx.clock.now();
        const c = this.ctxFor(d);
        await assertNotGloballyPaused(q, channelId);
        if (await activeBlock(q, channelId, req.viewer.id, 'all', now))
          throw new ModuleError(409, 'viewer_blocked');
        if (!(await this.enabled(q, channelId, d)))
          throw new ModuleError(409, 'module_disabled');
        const price = a.price ? await a.price(c, q, channelId) : 0;
        if (req.expected_price !== undefined && req.expected_price !== price)
          throw new ModuleError(409, 'price_changed', { price });
        if (price > 0 && a.liveOnly !== false && !(await c.live(q)))
          throw new ModuleError(409, STREAM_OFFLINE);
        const activityId = randomUUID();
        await q.query(
          `insert into module_activity (activity_id, channel_id, module_id, action, viewer_id, viewer_name,
             idempotency_key, request_hash, amount, status, input, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', $10, $11, $11)`,
          [
            activityId,
            channelId,
            id,
            name,
            req.viewer.id,
            req.viewer.display_name,
            req.idempotency_key,
            requestHash,
            price,
            JSON.stringify(req.input ?? null),
            now,
          ],
        );
        if (price > 0)
          await this.ctx.economy.debit(q, now, {
            channelId,
            viewer: req.viewer,
            currency: 'tokens',
            amount: price,
            // A module of the host pays under its own id (ledger « module »; free text in both ledgers).
            module: id as PaidModule,
            interactionId: activityId,
          });
        const out = await a.run(c, q, {
          channelId,
          viewer: req.viewer,
          input: req.input ?? null,
          activityId,
          price,
          now,
        });
        const row = (
          await q.query<ActivityRow>(
            `update module_activity set status = $2, result = $3, updated_at = $4 where activity_id = $1 returning *`,
            [activityId, out.status, JSON.stringify(out.result ?? null), now],
          )
        )[0]!;
        return { activity: activityView(row), replayed: false };
      });
    } catch (e) {
      if (e instanceof LabWalletError)
        throw new ModuleError(409, e.code, {
          ...((e as unknown as { details?: Record<string, unknown> }).details ??
            {}),
        });
      if (e instanceof GlobalPauseError)
        throw new ModuleError(409, 'global_pause');
      // The same key from ANOTHER viewer (the lock is per viewer): the intent belongs to the first — never a 500.
      if ((e as { code?: string }).code === '23505')
        throw new ModuleError(409, 'idempotency_conflict');
      throw e;
    }
  }

  /** The extension's read of a module for one viewer: availability (never a purchase the server cannot honour). */
  async viewerState(channelId: string, id: string, viewer: Viewer | null) {
    const d = this.module(id);
    const c = this.ctxFor(d);
    const db = this.ctx.db;
    const enabled = await this.enabled(db, channelId, d);
    const live = await c.live(db);
    const actions = await Promise.all(
      Object.entries(d.viewer ?? {}).map(async ([name, a]) => {
        const price = a.price ? await a.price(c, db, channelId) : 0;
        const liveOnly = a.liveOnly !== false && price > 0;
        return {
          name,
          label: a.label,
          price,
          available: enabled && (!liveOnly || live),
          unavailable_reason: !enabled
            ? 'module_disabled'
            : liveOnly && !live
              ? STREAM_OFFLINE
              : null,
        };
      }),
    );
    return {
      id: d.id,
      label: d.label,
      enabled,
      actions,
      state: d.viewerState ? await d.viewerState(c, channelId, viewer) : null,
      recent: viewer
        ? (
            await db.query<ActivityRow>(
              `select * from module_activity where channel_id = $1 and module_id = $2 and viewer_id = $3
               order by created_at desc limit 10`,
              [channelId, id, viewer.id],
            )
          ).map(activityView)
        : [],
    };
  }

  /**
   * The player's door (OBS executor in Studio, architecture § 9 — no universal player): the module's waiting actions,
   * oldest first, then its report through the same single settlement (a failure refunds the original debit once).
   */
  /**
   * A player takes the next waiting actions for itself (lease PLAYER_LEASE_MS): two players never show the same one,
   * and the expiry leaves a claimed action to its player until the lease ends. A player that died frees them by itself.
   */
  async claim(channelId: string, id: string, player: string, limit = 1) {
    this.module(id);
    const now = this.ctx.clock.now();
    return this.ctx.db.tx(async (q) => {
      const rows = await q.query<ActivityRow>(
        `update module_activity set claimed_at = $4, claimed_by = $5, updated_at = $4
          where activity_id in (
            select activity_id from module_activity
             where channel_id = $1 and module_id = $2 and status = 'queued'
               and (claimed_at is null or claimed_at < $6 or claimed_by = $5)
             order by created_at limit $3 for update skip locked)
          returning *`,
        [
          channelId,
          id,
          Math.min(Math.max(limit, 1), 10),
          now,
          player,
          new Date(now.getTime() - PLAYER_LEASE_MS),
        ],
      );
      return { items: rows.map(activityView), lease_ms: PLAYER_LEASE_MS };
    });
  }

  /** Read only (diagnostics): the waiting actions, claimed or not. */
  async queue(channelId: string, id: string, limit = 10) {
    this.module(id);
    const rows = await this.ctx.db.query<ActivityRow>(
      `select * from module_activity where channel_id = $1 and module_id = $2 and status = 'queued'
        order by created_at limit $3`,
      [channelId, id, Math.min(limit, 50)],
    );
    return { items: rows.map(activityView) };
  }

  async report(
    channelId: string,
    id: string,
    r: { activity_id: string; status: 'done' | 'failed'; result?: unknown },
  ) {
    this.module(id);
    return this.ctx.db.tx(async (q) => {
      const own = await q.query(
        'select 1 from module_activity where activity_id = $1 and channel_id = $2',
        [r.activity_id, channelId],
      );
      if (!own.length) throw new ModuleError(404, 'activity_not_found');
      return {
        activity: await this.settleIn(
          q,
          r.activity_id,
          { status: r.status, result: r.result },
          'lecteur',
          id,
        ),
      };
    });
  }

  /** Finishes a `queued` action (its player played it, or failed): a failure is refunded once (original debit). */
  settle(
    activityId: string,
    outcome: { status: 'done' | 'failed'; result?: unknown },
    actor = 'système',
  ) {
    return this.ctx.db.tx((q) => this.settleIn(q, activityId, outcome, actor));
  }

  private async settleIn(
    q: Queryable,
    activityId: string,
    outcome: { status: 'done' | 'failed'; result?: unknown },
    actor = 'système',
    moduleId?: string,
  ) {
    {
      const row = (
        await q.query<ActivityRow>(
          'select * from module_activity where activity_id = $1 for update',
          [activityId],
        )
      )[0];
      if (!row || (moduleId && row.module_id !== moduleId))
        throw new ModuleError(404, 'activity_not_found');
      if (row.status !== 'queued') return activityView(row); // decided once
      const now = this.ctx.clock.now();
      if (outcome.status === 'failed' && Number(row.amount) > 0)
        await this.ctx.economy.refund(q, now, activityId, actor, 'échec');
      const updated = (
        await q.query<ActivityRow>(
          `update module_activity set status = $2, result = coalesce($3, result), updated_at = $4, ended_by = $5,
             reason = $6 where activity_id = $1 returning *`,
          [
            activityId,
            outcome.status === 'failed' && Number(row.amount) > 0
              ? 'refunded'
              : outcome.status,
            outcome.result === undefined
              ? null
              : JSON.stringify(outcome.result),
            now,
            actor,
            outcome.status === 'failed' ? 'échec, remboursé' : null,
          ],
        )
      )[0]!;
      return activityView(updated);
    }
  }

  /** Activity of every module (or one), newest first: Studio history, moderation search, by viewer. */
  async activity(
    channelId: string,
    f: { module?: string; viewer?: string; limit?: number },
  ) {
    const rows = await this.ctx.db.query<ActivityRow>(
      `select * from module_activity where channel_id = $1 and ($2::text is null or module_id = $2)
         and ($3::text is null or viewer_id = $3) order by created_at desc limit $4`,
      [
        channelId,
        f.module ?? null,
        f.viewer ?? null,
        Math.min(f.limit ?? 50, 200),
      ],
    );
    return { items: rows.map(activityView) };
  }

  /**
   * Moderation: refund a paid action — the ORIGINAL debit, once, with the operator and the reason, audited. Only if the
   * module's policy allows it and the action was paid; never an arbitrary credit.
   */
  async refund(
    channelId: string,
    req: { actor: Actor; activity_id: string; reason: string },
  ) {
    if (!req.reason?.trim()) throw new ModuleError(400, 'reason_required');
    return this.ctx.db.tx(async (q) => {
      const acc = await access(q, channelId, req.actor);
      assertAccess(acc, 'refund');
      const row = (
        await q.query<ActivityRow>(
          'select * from module_activity where activity_id = $1 and channel_id = $2 for update',
          [req.activity_id, channelId],
        )
      )[0];
      if (!row) throw new ModuleError(404, 'activity_not_found');
      // Nobody refunds their own purchase from the extension (same rule as the permissions' self_edit).
      if (req.actor.via === 'extension' && row.viewer_id === req.actor.id)
        throw new ModuleError(403, 'self_refund');
      const d = this.module(row.module_id);
      if (d.moderation?.refund !== 'moderator')
        throw new ModuleError(409, 'refund_not_allowed');
      if (row.status === 'refunded')
        throw new ModuleError(409, 'already_refunded');
      if (!(Number(row.amount) > 0))
        throw new ModuleError(409, 'nothing_to_refund');
      const now = this.ctx.clock.now();
      const back = await this.ctx.economy.refund(
        q,
        now,
        row.activity_id,
        req.actor.display_name ?? req.actor.id,
        req.reason.trim().slice(0, 200),
      );
      const updated = (
        await q.query<ActivityRow>(
          `update module_activity set status = 'refunded', updated_at = $2, ended_by = $3, reason = $4
           where activity_id = $1 returning *`,
          [
            row.activity_id,
            now,
            (req.actor.display_name ?? req.actor.id).slice(0, 64),
            req.reason.trim().slice(0, 200),
          ],
        )
      )[0]!;
      await audit(q, now, {
        channelId,
        actor: req.actor,
        role: acc.role,
        action: `${row.module_id}.refund`,
        viewerId: row.viewer_id,
        interactionId: row.activity_id,
        reason: req.reason.trim().slice(0, 200),
        before: { status: row.status },
        after: { status: 'refunded', amount: back.amount },
      });
      return { activity: activityView(updated), refunded: back.amount };
    });
  }
}
