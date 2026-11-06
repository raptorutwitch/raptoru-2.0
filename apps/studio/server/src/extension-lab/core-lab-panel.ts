import type { LabCoreCall } from '../lab-moderation/proxy.js';

// The Extension Lab page's panel on the main Lab Core (runtime/main-lab-core.ts): the same /api/ext-lab/state and
// /api/ext-lab/control API as the historical Lab EBS, with no state of its own — wallets, module states, the Tombola and
// the activity are the Core's, read and commanded through the cockpit. Studio decides nothing.

type Json = Record<string, unknown>;
type Role = 'viewer' | 'moderator' | 'broadcaster';

/** The Lab's fictional accounts (core-api/src/lab/environment.ts LAB_TWITCH_USERS), as the page and the simulator know them. */
export const LAB_ACCOUNTS: Record<
  Role,
  { role: Role; twitchUserId: string; login: string; displayName: string }
> = {
  viewer: {
    role: 'viewer',
    twitchUserId: '900101',
    login: 'lab_viewer',
    displayName: 'Viewer Lab',
  },
  moderator: {
    role: 'moderator',
    twitchUserId: '900102',
    login: 'lab_modo',
    displayName: 'Modo Lab',
  },
  broadcaster: {
    role: 'broadcaster',
    twitchUserId: '900100',
    login: 'raptoru_lab',
    displayName: 'Raptoru_ (lab)',
  },
};
const ROLES = Object.keys(LAB_ACCOUNTS) as Role[];

/** Who the chat simulator can speak as. */
export const labChatIdentities = () =>
  ROLES.map((r) => ({
    id: LAB_ACCOUNTS[r].twitchUserId,
    label: `${LAB_ACCOUNTS[r].displayName} (${r})`,
    login: LAB_ACCOUNTS[r].login,
  }));

const ACTOR = { id: 'studio', role: 'broadcaster', via: 'studio' };
const MODULE_IDS = ['tts', 'soundboard', 'bonk'] as const;

interface Activity {
  activity_key: string;
  kind: string;
  type: string;
  occurred_at: string;
  data: Json;
  seq: number;
}

export class CoreLabPanel {
  /** One line per activity (a row comes back on each of its status changes). */
  private readonly seen = new Set<string>();

  constructor(
    private readonly core: LabCoreCall,
    private readonly channelId: string,
  ) {}

  private get ch() {
    return this.channelId;
  }

  async snapshot(since = 0) {
    const [wallets, overview, raffle, activity] = await Promise.all([
      Promise.all(
        ROLES.map(async (r) => {
          const w = await this.core<{ tokens?: number }>(
            `/v1/lab/wallet/${this.ch}/${LAB_ACCOUNTS[r].twitchUserId}`,
          ).catch(() => null);
          return [r, Number(w?.tokens ?? 0)] as const;
        }),
      ),
      this.core<Json>(`/v1/lab/moderation/${this.ch}/overview`).catch(
        () => null,
      ),
      this.core<{
        current?: { status?: string; ends_at?: string } | null;
        participants?: unknown[];
      }>(`/v1/lab/raffle/${this.ch}/state`).catch(() => null),
      this.core<{ cursor: number; activities: Activity[] }>(
        `/v1/lab/dock/${this.ch}/activity?limit=50`,
      ).catch(() => null),
    ]);
    const state = (id: string) =>
      String((overview?.[id] as Json | undefined)?.module_state ?? 'active');
    const open = raffle?.current?.status === 'open';
    const tts = (overview?.tts ?? {}) as Json;
    const events = (activity?.activities ?? [])
      .filter((a) => a.kind === 'interaction' && a.seq > since)
      .filter((a) => !this.seen.has(a.activity_key))
      .reverse()
      .map((a) => {
        this.seen.add(a.activity_key);
        return this.event(a);
      });
    return {
      mode: 'lab' as const,
      safety: 'Core principal en mode Lab : Jetons et comptes fictifs',
      identities: LAB_ACCOUNTS,
      wallets: Object.fromEntries(wallets),
      modules: {
        tts: state('tts') !== 'disabled',
        soundboard: state('soundboard') !== 'disabled',
        bonk: state('bonk') !== 'disabled',
        raffle_join: state('raffle') !== 'disabled',
      },
      raffle: {
        open,
        endsInSeconds: open
          ? Math.max(
              0,
              Math.round(
                (Date.parse(String(raffle?.current?.ends_at)) - Date.now()) /
                  1000,
              ),
            )
          : 0,
        participants: open ? (raffle?.participants?.length ?? 0) : 0,
        waitingDraw: raffle?.current?.status === 'closed',
        core: true,
      },
      tts: {
        mode: String(tts.mode ?? 'instant'),
        paused: state('tts') === 'paused',
        pending: Number(tts.pending ?? 0),
      },
      lastSeq: Number(activity?.cursor ?? since),
      events,
    };
  }

  /** The page's stage and log: what the Core recorded, in the page's words. */
  private event(a: Activity) {
    const actor = (a.data.actor ?? {}) as { name?: string };
    const kind =
      a.type === 'raffle'
        ? 'raffle_join'
        : ['tts', 'soundboard', 'bonk'].includes(a.type)
          ? a.type
          : 'moderation';
    const sound = (a.data.sound ?? {}) as { label?: string };
    const emote = (a.data.emote ?? {}) as { glyph?: string };
    const message = typeof a.data.message === 'string' ? a.data.message : '';
    return {
      seq: a.seq,
      at: a.occurred_at,
      kind,
      viewer: actor.name ?? 'Viewer',
      role: 'viewer',
      currency: 'jetons',
      cost: 0,
      detail: message || sound.label || emote.glyph || a.type,
      effect: {
        text: message,
        label: sound.label ?? emote.glyph ?? a.type,
        mark: emote.glyph ?? '',
      },
    };
  }

  async control(action: string, args: Json = {}): Promise<Json> {
    if (action === 'wallet' || action === 'reset') {
      const roles = action === 'wallet' ? [args.role as Role] : ROLES;
      const amount = Number(args.amount);
      for (const r of roles) {
        if (
          !LAB_ACCOUNTS[r] ||
          (action === 'wallet' && (!Number.isInteger(amount) || amount < 0))
        )
          throw new Error('invalid wallet control');
        await this.core(`/v1/lab/wallet/${this.ch}`, {
          actor: ACTOR,
          viewer_id: LAB_ACCOUNTS[r].twitchUserId,
          ...(action === 'wallet'
            ? { op: 'set', tokens: amount }
            : { op: 'reset' }),
        });
      }
      return { ok: true };
    }
    if (action === 'module') {
      const id = String(args.id);
      if (!(MODULE_IDS as readonly string[]).includes(id))
        throw new Error('invalid module');
      await this.command({
        action: 'module_state',
        module: id,
        state: args.enabled ? 'active' : 'disabled',
        waiting: 'keep',
      });
      return { ok: true };
    }
    if (action === 'raffle-open')
      return this.command({
        action: 'raffle_open',
        duration_s: Math.min(3600, Math.max(10, Number(args.seconds) || 60)),
        jackpot: Math.min(
          10_000_000,
          Math.max(0, Math.round(Number(args.jackpot ?? 5000) || 0)),
        ),
        winners: Math.min(
          10,
          Math.max(1, Math.round(Number(args.winners ?? 1) || 1)),
        ),
      });
    if (action === 'raffle-close')
      return this.command({ action: 'raffle_close' });
    if (action === 'raffle-draw')
      return this.command({ action: 'raffle_draw' });
    throw new Error(`unknown lab control ${action}`);
  }

  private async command(command: Json): Promise<Json> {
    const out = await this.core<Json>(`/v1/lab/moderation/${this.ch}/actions`, {
      actor: ACTOR,
      command,
    });
    return { ok: true, ...out };
  }
}
