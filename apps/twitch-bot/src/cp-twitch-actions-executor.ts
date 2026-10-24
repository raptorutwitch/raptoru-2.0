import type { CpTwitchAction, CpTwitchActionReport } from '@raptoru/schemas';
import { HelixError } from './twitch/helix.js';

// Twitch-side channel points actions (docs/SPOTIFY_V2.md § 7): the main Core decides, this executor runs each one ONCE
// with the broadcaster's token (`channel:manage:redemptions`) and reports it:
// - redemption_status: FULFILLED, or CANCELED (Twitch gives the viewer's points back);
// - reward_create: the reward owned by Raptoru's app (only its creator may change its redemptions).
// Outcomes: done (Twitch applied it) · failed (Twitch refused it, or the right is missing: nothing sent) · unknown (no
// answer, 429, 5xx: it may have applied). Never retried: a refund is never sent twice.

export const CP_MANAGE_SCOPE = 'channel:manage:redemptions';

export interface CpTwitchCalls {
  updateRedemptionStatus(
    rewardId: string,
    redemptionId: string,
    status: 'FULFILLED' | 'CANCELED',
  ): Promise<void>;
  createCustomReward(reward: {
    title: string;
    cost: number;
    prompt: string;
    is_user_input_required: boolean;
  }): Promise<string>;
}

export interface CpTwitchExecutorDeps {
  /** POST to Core; throws only when Core could not be reached. */
  core(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
  base:
    | '/v1/bot/channel-points/twitch-actions'
    | '/v1/lab/channel-points/twitch-actions';
  channelId: string;
  /** null: no broadcaster token here (every action fails, nothing sent). */
  scopes: string[] | null;
  twitch: CpTwitchCalls | null;
  pause?: (ms: number) => Promise<void>;
  log?: (...args: unknown[]) => void;
}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/** Twitch's answer → the report (4xx but 429: refused for sure; the rest: maybe applied). */
function outcomeOf(e: unknown): Omit<CpTwitchActionReport, 'attempt_id'> {
  if (e instanceof HelixError) {
    const sure = e.status >= 400 && e.status < 500 && e.status !== 429;
    return {
      outcome: sure ? 'failed' : 'unknown',
      http_status: e.status,
      error: e.body.slice(0, 200),
    };
  }
  return {
    outcome: 'unknown',
    error: ((e as Error)?.message ?? 'erreur').slice(0, 200),
  };
}

export function createCpTwitchActionsExecutor(d: CpTwitchExecutorDeps) {
  const log = d.log ?? console.log;
  const pause = d.pause ?? sleep;
  const canManage = !!d.twitch && !!d.scopes?.includes(CP_MANAGE_SCOPE);

  async function report(
    a: CpTwitchAction,
    r: Omit<CpTwitchActionReport, 'attempt_id'>,
  ) {
    // A lost report leaves the action « unknown » in Core after its lease (never resent to Twitch).
    for (let n = 0; n < 3; n++) {
      try {
        const res = await d.core(
          `${d.base}/${d.channelId}/${a.action_id}/report`,
          { attempt_id: a.attempt_id, ...r },
        );
        if (res.status < 500) return;
      } catch {
        /* Core unreachable: try again */
      }
      await pause(500 * (n + 1));
    }
  }

  async function run1(
    a: CpTwitchAction,
  ): Promise<Omit<CpTwitchActionReport, 'attempt_id'>> {
    if (!canManage)
      return { outcome: 'failed', error: `missing_scope:${CP_MANAGE_SCOPE}` };
    try {
      if (a.kind === 'redemption_status') {
        await d.twitch!.updateRedemptionStatus(
          a.reward_id,
          a.redemption_id,
          a.status,
        );
        return { outcome: 'done', http_status: 200 };
      }
      const id = await d.twitch!.createCustomReward(a.reward);
      return { outcome: 'done', http_status: 200, reward_id: id };
    } catch (e) {
      return outcomeOf(e);
    }
  }

  async function tick(): Promise<'idle' | 'worked'> {
    let claimed: { status: number; body: unknown };
    try {
      claimed = await d.core(`${d.base}/${d.channelId}/claim`, {});
    } catch {
      return 'idle';
    }
    const action = (claimed.body as { action?: CpTwitchAction | null }).action;
    if (claimed.status !== 200 || !action) return 'idle';
    const r = await run1(action);
    log(
      `[cp-twitch] ${action.kind === 'redemption_status' ? `rédemption ${action.status}` : 'création de récompense'} → ${r.outcome}${r.error ? ` (${r.error})` : ''}`,
    );
    await report(action, r);
    return 'worked';
  }

  let stopped = false;
  async function run() {
    while (!stopped) {
      let delay = 1000;
      try {
        if ((await tick()) === 'worked') delay = 0;
      } catch (e) {
        log('[cp-twitch] tick failed', (e as Error).message);
      }
      if (delay) await pause(delay);
    }
  }
  return { tick, run, stop: () => (stopped = true), ready: { canManage } };
}
