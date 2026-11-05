import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import type { LabChatModule } from '../lab-chat/router.js';
import type { Actor } from '../lab-moderation/store.js';
import type {
  ModuleSettings,
  SettingSpec,
} from '../module-settings/service.js';

// The module contract (docs/studio-refonte/architecture/CONTRATS.md). ONE declaration per module: identity, the
// capabilities it really implements, and the code of those capabilities. Every surface (Studio, extension, moderation,
// Control Center, Lab) reads the module through the ModuleHost: a new module plugs into ONE list (modules/index.ts)
// and gets catalog, settings, admin and viewer routes, paid actions on the Wallet, activity journal, moderation
// (history, refund of the original transaction) and supervision — without touching app.ts, lab-core.ts, server.ts or
// the extension façades. Historical modules keep their own wiring; nothing is rewritten for the sake of it.

/** What a module really implements. Declared ⇒ implemented: the host refuses a module that lies (checkModule). */
export type Capability =
  | 'settings' //   settings: bounded values, set from Studio, read by the module (module_settings)
  | 'admin' //      admin actions: Studio / cockpit, broadcaster's identity
  | 'viewer' //     viewer actions: the extension (through its façade) or the Lab
  | 'wallet' //     at least one viewer action has a price: paid on the Wallet, refused before debit
  | 'history' //    its actions are kept in the activity journal (always true for viewer / admin actions)
  | 'moderation' // moderators see its activity and may refund it (policy below)
  | 'chat' //       a chat module (bot → Core)
  | 'live' //       its paid actions follow the canonical live (H1)
  | 'supervision' // a status for the Control Center
  | 'tick'; //      a periodic job (expiry, sweeps)

export type ModuleCategory = 'jeux' | 'interactions' | 'communaute' | 'outils';

/** The state grid of the Control Center (audit § B.1): never green on an intention alone. */
export interface ModuleStatusView {
  /** The streamer's switch (the module's own `enabled` setting). */
  intention: 'on' | 'off';
  /** What really works now: ready, waiting for a dependency, error, or unknown (cannot tell). */
  observed: 'ready' | 'waiting' | 'error' | 'unknown';
  /** One sentence for the streamer. */
  summary: string;
  /** Why it is not ready (dependencies), in plain words. */
  reasons: string[];
  /** What runs now, if anything (« 3 parties en cours »). */
  activity?: string | null;
}

/** Everything a module receives from the host: the shared primitives, never its own copies. */
export interface ModuleContext {
  db: Db;
  clock: Clock;
  economy: EconomyPort;
  settings: ModuleSettings;
  /** Reads one of THIS module's settings (`<key>` without the module prefix). */
  setting(q: Queryable, channelId: string, key: string): Promise<number>;
  /**
   * LeCroupier_ writes in the chat for THIS module (durable chat queue, origin `module:<id>`), inside the caller's
   * transaction, alone in a savepoint: refused (a database without the module origins yet), it is skipped and logged,
   * never the action it follows. `key` makes it idempotent (a resent message never answers twice).
   */
  say(
    q: Queryable,
    channelId: string,
    m: { key: string; text: string; delayMs?: number; announce?: boolean },
  ): Promise<number>;
  /**
   * Serializes THIS module's work on `key` until the caller's transaction ends (a shared counter, a round): two
   * concurrent actions never lose an update.
   */
  lock(q: Queryable, channelId: string, key: string): Promise<void>;
  /** Is the canonical live open (Production) / always true in the Lab (H1). */
  live(q: Queryable): Promise<boolean>;
  /**
   * Finishes one of THIS module's `queued` actions inside the caller's transaction: done, or failed — a paid failure is
   * refunded once (the original debit). Decided once: a second call changes nothing.
   */
  settle(
    q: Queryable,
    activityId: string,
    outcome: { status: 'done' | 'failed'; result?: unknown },
    actor?: string,
  ): Promise<{ status: string }>;
  /** THIS module's small persistent state (JSON per key, module_state): no migration for a simple module. */
  state: {
    get<T>(q: Queryable, channelId: string, key: string): Promise<T | null>;
    set(
      q: Queryable,
      channelId: string,
      key: string,
      value: unknown,
    ): Promise<void>;
  };
}

export interface Viewer {
  id: string;
  display_name: string;
}

/** A viewer action. `price` makes it paid (debit before `run`, in the same transaction, refused before payment). */
export interface ViewerAction {
  label: string;
  /** Jetons; 0 or absent = free. Read at the call (a module setting usually). */
  price?(ctx: ModuleContext, q: Queryable, channelId: string): Promise<number>;
  /** Paid stream interactions follow the canonical live (H1); a free read or a shop purchase may say false. */
  liveOnly?: boolean;
  /**
   * The module's own logic, inside the transaction of the debit. Throw a ModuleError to refuse: nothing is paid, nothing
   * is recorded. Return `queued` when something else (an OBS player…) finishes it later (host.settle).
   */
  run(
    ctx: ModuleContext,
    q: Queryable,
    call: {
      channelId: string;
      viewer: Viewer;
      input: unknown;
      activityId: string;
      price: number;
      now: Date;
    },
  ): Promise<{ status: 'done' | 'queued'; result: unknown }>;
}

export interface AdminAction {
  label: string;
  /** Moderation permission needed (lab-moderation/store.ts PERMISSIONS); default: the broadcaster's Studio only. */
  permission?: string;
  /** Says what really happens (Production / Lab), shown before running it (refonte F1 / H11). */
  confirm?: string;
  /** One whole-number field asked before running (generic screen); a richer form is the module's own screen. */
  input?: { key: string; label: string; min: number; max: number };
  run(
    ctx: ModuleContext,
    q: Queryable,
    call: { channelId: string; actor: Actor; input: unknown; now: Date },
  ): Promise<unknown>;
}

/**
 * Moderation decided at design time (mission § 7): what moderators may do with this module's activity. A module with
 * viewer actions MUST state it, even « nothing ».
 */
export interface ModerationPolicy {
  /** Moderators see the activity (history, search by viewer). */
  visible: boolean;
  /** A paid action may be refunded by a moderator (the original debit, once — never an arbitrary credit). */
  refund: 'never' | 'moderator';
  /** Why, in one sentence (shown in Studio, kept in the docs). */
  note: string;
}

export interface ModuleDefinition {
  /** Stable id: `^[a-z][a-z0-9_]{1,40}$`, never reused. */
  id: string;
  label: string;
  description: string;
  category: ModuleCategory;
  /** A Lab-only module (a demonstration, an experiment): never mounted on the canonical economy. */
  labOnly?: boolean;
  capabilities: readonly Capability[];
  /** Bounded settings, stored as `<id>.<key>`; `enabled` is added for every module with viewer actions (default 0). */
  settings?: Record<string, SettingSpec>;
  /** Default of the automatic `enabled` switch (0: a new interaction is never active by itself). */
  enabledByDefault?: boolean;
  /**
   * A historical module that keeps its OWN switch (e.g. Studio « Mini-jeux »): the host reads it for the catalog and the
   * supervision instead of the automatic one. Not for modules with viewer actions (they use the host's switch).
   */
  enabled?(ctx: ModuleContext, q: Queryable, channelId: string): Promise<boolean>;
  admin?: Record<string, AdminAction>;
  viewer?: Record<string, ViewerAction>;
  /** What the extension shows of this module for one viewer (null: anonymous). */
  viewerState?(
    ctx: ModuleContext,
    channelId: string,
    viewer: Viewer | null,
  ): Promise<unknown>;
  status?(ctx: ModuleContext, channelId: string): Promise<ModuleStatusView>;
  moderation?: ModerationPolicy;
  /**
   * A `queued` action not finished after this delay fails and is refunded once, by the host's periodic job (the rule of
   * H2 for every module that hands work to a player). Absent: never expired automatically.
   */
  expireQueuedMs?: number;
  chat?(ctx: ModuleContext): LabChatModule;
  /**
   * The chat words (without « ! ») this module answers: reserved, so Commands V2 refuses them (never two answers to one
   * command). Required with `chat`.
   */
  chatWords?: readonly string[];
  tick?(ctx: ModuleContext): Promise<void>;
}

/** The ONE error shape of the modules: the HTTP layer maps it (no per-module `mapped()` wrapper). */
export class ModuleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

const ID = /^[a-z][a-z0-9_]{1,40}$/;

/**
 * Automatic checks (mission § 11): every problem a module declaration can have that a test can see. The host refuses to
 * start with a problem; `test/modules-contract.test.ts` runs it on every module of the list.
 */
export function checkModule(d: ModuleDefinition): string[] {
  const p: string[] = [];
  const has = (c: Capability) => d.capabilities.includes(c);
  const viewerActions = Object.values(d.viewer ?? {});
  if (!ID.test(d.id)) p.push(`${d.id}: identifiant invalide`);
  if (!d.label.trim() || !d.description.trim())
    p.push(`${d.id}: libellé ou description vide`);
  const declared: [Capability, boolean][] = [
    ['settings', !!d.settings && Object.keys(d.settings).length > 0],
    ['admin', !!d.admin && Object.keys(d.admin).length > 0],
    ['viewer', viewerActions.length > 0],
    ['wallet', viewerActions.some((a) => !!a.price)],
    ['moderation', !!d.moderation],
    ['history', !!d.admin || !!d.viewer],
    ['chat', !!d.chat],
    ['supervision', !!d.status],
    ['tick', !!d.tick],
    ['live', viewerActions.some((a) => a.liveOnly !== false && !!a.price)],
  ];
  for (const [c, impl] of declared) {
    if (has(c) && !impl)
      p.push(`${d.id}: capacité « ${c} » déclarée sans implémentation`);
    if (!has(c) && impl)
      p.push(`${d.id}: « ${c} » implémenté mais non déclaré`);
  }
  if (viewerActions.length && d.enabled)
    p.push(`${d.id}: un module à actions viewer utilise l’interrupteur du socle, pas le sien`);
  if (d.chat && !d.chatWords?.length)
    p.push(`${d.id}: lecture du chat sans mots réservés (chatWords)`);
  if (d.chatWords && !d.chat) p.push(`${d.id}: mots réservés sans lecture du chat`);
  for (const w of d.chatWords ?? [])
    if (!/^[a-z0-9_]{1,25}$/.test(w)) p.push(`${d.id}: mot du chat « ${w} » invalide`);
  if (d.settings && 'enabled' in d.settings)
    p.push(`${d.id}: « enabled » est réservé à l’interrupteur du socle`);
  if (viewerActions.length && !d.moderation)
    p.push(`${d.id}: actions viewer sans politique de modération explicite`);
  if (has('wallet') && d.moderation && !d.moderation.visible)
    p.push(`${d.id}: module payant invisible pour la modération`);
  for (const name of [
    ...Object.keys(d.viewer ?? {}),
    ...Object.keys(d.admin ?? {}),
  ])
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(name))
      p.push(`${d.id}: action « ${name} » au nom invalide`);
  for (const k of Object.keys(d.settings ?? {}))
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(k))
      p.push(`${d.id}: réglage « ${k} » au nom invalide`);
  return p;
}
