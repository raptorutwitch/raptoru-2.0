import { randomUUID } from 'node:crypto';
import {
  LabActor,
  SwAnimationClaim,
  SwAnnounceDelayInput,
  SwInvitationsInput,
  SwLabPresenceInput,
  SwLabSimulate,
  SwAnimationReport,
  SwAwardUpdate,
  SwGrantInput,
  SwModeInput,
  SwReviewResolve,
  SwSettingsInput,
  SwTestRequest,
} from '@raptoru/schemas';
import type { AlertsService } from '../alerts/service.js';
import type { Actor } from '../lab-moderation/store.js';
import { SwError, type SubWheelService } from '../sub-wheel/service.js';
import { HttpError, parse, type Route } from './server.js';

// Roue du Sub — routes of the ONE implementation (docs/SUB_WHEEL.md), same sub-paths twice: Lab Core /v1/lab/sub-wheel/*
// (Studio secret), production Core /v1/studio/sub-wheel/* (Studio installation, the Core's channel only). The wheel is
// fed by the alerts reception (alerts-routes.ts), never by a route of its own: there is no « spin » route.

/** Studio is the broadcaster (an installation in production, the Studio secret in the Lab). */
const studioActor = (installation?: string): Actor => ({
  id: installation ? `installation:${installation}` : 'studio',
  role: 'broadcaster',
  via: 'studio',
});

/**
 * The actor of a decision, and the rest of the body. Production (Studio installation): always the broadcaster. Lab
 * routes (Studio secret, or the extension façade in-process — ext-facade.ts / Studio's Lab EBS): the verified caller
 * the façade names in `actor` (a moderator, a viewer), else Studio. Core then checks that actor's permissions.
 */
function actorAndBody(
  production: boolean,
  installation: string | undefined,
  body: unknown,
): { actor: Actor; rest: Record<string, unknown> } {
  const { actor, ...rest } = (body ?? {}) as Record<string, unknown>;
  if (production || actor === undefined)
    return { actor: studioActor(installation), rest };
  return { actor: parse(LabActor, actor) as Actor, rest };
}

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SwError) throw new HttpError(e.status, { error: e.code });
    throw e;
  }
}

export function subWheelRoutes(
  wheel: SubWheelService,
  alerts: AlertsService,
  production?: { channelId: string },
): Route[] {
  const base = production ? '/v1/studio/sub-wheel' : '/v1/lab/sub-wheel';
  const auth = production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const at = (path: string) =>
    new RegExp('^' + (base + path).replaceAll('/', '\\/') + '$');
  const channel = (id: string) => {
    if (production && id !== production.channelId)
      throw new HttpError(409, {
        error: 'wrong_channel',
        expected_channel_id: production.channelId,
      });
    return id;
  };
  const uuid = '([0-9a-f-]{36})';
  return [
    {
      method: 'GET',
      pattern: at('/(\\d{1,32})/state'),
      auth,
      handle: ({ params }) => wheel.state(channel(params[0]!)),
    },
    {
      // The switch (persistent, OFF by default). Studio only.
      method: 'POST',
      pattern: at('/(\\d{1,32})/settings'),
      auth,
      handle: ({ params, body }) =>
        wheel.setEnabled(
          channel(params[0]!),
          parse(SwSettingsInput, body).enabled,
        ),
    },
    {
      // V2 mode (v1 / v2_acquire; v2 with lot R3): the broadcaster's Studio only, audited.
      method: 'POST',
      pattern: at('/(\\d{1,32})/mode'),
      auth,
      handle: ({ params, body, installation }) =>
        mapped(() =>
          wheel.setMode(
            channel(params[0]!),
            parse(SwModeInput, body).mode,
            // Production: the Studio installation that asked; Lab: the Studio secret.
            installation ? `installation:${installation}` : 'studio',
          ),
        ),
    },
    {
      // R3: the rights not drawn yet (queues, presence, reviews).
      method: 'GET',
      pattern: at('/(\\d{1,32})/rights'),
      auth,
      handle: ({ params }) => wheel.rights(channel(params[0]!)),
    },
    {
      // R9 natural invitations: ON / OFF (the broadcaster, journaled; OFF by default).
      method: 'POST',
      pattern: at('/(\\d{1,32})/invitations'),
      auth,
      handle: ({ params, body, installation }) =>
        wheel.setInvitations(
          channel(params[0]!),
          parse(SwInvitationsInput, body).enabled,
          studioActor(installation).id,
        ),
    },
    {
      // RV2-1: the winner announcement's delay after the end of the animation (the broadcaster, journaled).
      method: 'POST',
      pattern: at('/(\\d{1,32})/announce-delay'),
      auth,
      handle: ({ params, body, installation }) =>
        mapped(() =>
          wheel.setAnnounceDelay(
            channel(params[0]!),
            parse(SwAnnounceDelayInput, body).seconds,
            studioActor(installation).id,
          ),
        ),
    },
    {
      // R8: ONE viewer's own tours (the extension façades pass the verified Twitch id, « !roue » reads them in Core).
      method: 'GET',
      pattern: at('/(\\d{1,32})/viewers/(\\d{1,32})'),
      auth,
      handle: ({ params }) =>
        wheel.viewerRights(channel(params[0]!), params[1]!),
    },
    {
      // R8: the viewer accepts its tours (extension button): `requested`, drawn when it is there — never a credit here.
      method: 'POST',
      pattern: at('/(\\d{1,32})/viewers/(\\d{1,32})/accept'),
      auth,
      handle: ({ params, body }) => {
        const b = (body ?? {}) as { login?: unknown };
        return wheel.viewerAccept(
          channel(params[0]!),
          {
            id: params[1]!,
            login:
              typeof b.login === 'string' ? b.login.slice(0, 64) : params[1]!,
          },
          'extension',
        );
      },
    },
    {
      // R8: the team's view of the tours (extension moderation): « Tirer » or « Accorder » holders only.
      method: 'POST',
      pattern: at('/(\\d{1,32})/team/rights'),
      auth,
      handle: ({ params, body, installation }) =>
        mapped(() =>
          wheel.rightsFor(
            channel(params[0]!),
            actorAndBody(!!production, installation, body).actor,
          ),
        ),
    },
    ...(production
      ? []
      : ([
          {
            // Lab simulator: simulated chatters readings (ON/OFF) and each viewer present / absent.
            method: 'GET',
            pattern: at('/(\\d{1,32})/lab/presence'),
            auth,
            handle: ({ params }) =>
              mapped(() => wheel.labPresence(channel(params[0]!))),
          },
          {
            method: 'POST',
            pattern: at('/(\\d{1,32})/lab/presence'),
            auth,
            handle: ({ params, body }) =>
              mapped(() =>
                wheel.setLabPresence(
                  channel(params[0]!),
                  parse(SwLabPresenceInput, body),
                ),
              ),
          },
          {
            // Lab simulator: a Twitch subscription as Twitch announces it — the chat notice (through the alerts
            // queue: its alert, then its wheel), channel.subscribe, channel.subscription.message (cumulative months).
            method: 'POST',
            pattern: at('/(\\d{1,32})/lab/simulate'),
            auth,
            handle: async ({ params, body }) => {
              const ch = channel(params[0]!);
              const e = parse(SwLabSimulate, body);
              await mapped(() => wheel.assertLab());
              const at = new Date();
              const viewer = {
                id: e.viewer.id,
                login: e.viewer.login ?? e.viewer.name.toLowerCase(),
                display_name: e.viewer.name,
              };
              const out: Record<string, unknown> = { kind: e.kind };
              if (
                e.kind === 'sub' ||
                e.kind === 'resub' ||
                e.kind === 'prime'
              ) {
                const event = {
                  channel_id: ch,
                  source: 'twitch' as const,
                  source_event_id: `lab-sim-${randomUUID()}`,
                  type:
                    e.kind === 'resub' ? ('resub' as const) : ('sub' as const),
                  occurred_at: at.toISOString(),
                  actor: viewer,
                  tier:
                    e.kind === 'prime'
                      ? ('prime' as const)
                      : e.tier === 2
                        ? ('2000' as const)
                        : e.tier === 3
                          ? ('3000' as const)
                          : ('1000' as const),
                  ...(e.kind === 'resub' ? { months: e.months ?? 2 } : {}),
                };
                const { alert } = await alerts.receive(event);
                out.notice = await wheel.fromAlert(
                  event,
                  alert?.alert_id ?? null,
                );
              }
              const evidence = (
                source: 'subscribe' | 'message',
                ms: number,
              ) => ({
                channelId: ch,
                source,
                sourceEventId: `lab-sim-${randomUUID()}`,
                occurredAt: new Date(at.getTime() + ms).toISOString(),
                viewer: {
                  id: viewer.id,
                  login: viewer.login,
                  name: viewer.display_name,
                },
                type:
                  source === 'subscribe'
                    ? ('sub' as const)
                    : ('resub' as const),
                tier: e.kind === 'prime' ? (1 as const) : e.tier,
                months: source === 'message' ? (e.months ?? 2) : null,
                isGift: false,
              });
              // What Twitch sends besides the notice: channel.subscribe for a new sub / Prime, the resub message.
              if (
                e.kind === 'sub' ||
                e.kind === 'prime' ||
                e.kind === 'subscribe'
              )
                out.subscribe = await wheel.acquire(evidence('subscribe', 500));
              if (e.kind === 'resub' || e.kind === 'message')
                out.message = await wheel.acquire(evidence('message', 1_000));
              return out;
            },
          },
        ] satisfies Route[])),
    {
      // R7: subscriptions active without any event heard — informative only, never a tour.
      method: 'GET',
      pattern: at('/(\\d{1,32})/subscription-detections'),
      auth,
      handle: ({ params }) => wheel.subscriptionDetections(channel(params[0]!)),
    },
    {
      // R4 « Possible doublon »: informative pairs, never blocking.
      method: 'GET',
      pattern: at('/(\\d{1,32})/possible-duplicates'),
      auth,
      handle: ({ params }) => wheel.possibleDuplicates(channel(params[0]!)),
    },
    {
      // R4 « À vérifier »: distinct months / merge the duplicate / leave it blocked.
      method: 'POST',
      pattern: at('/reviews/(\\d{1,18})/resolve'),
      auth,
      handle: ({ params, body, installation }) => {
        const { actor, rest } = actorAndBody(!!production, installation, body);
        const r = parse(SwReviewResolve, rest);
        return mapped(() =>
          wheel.resolveReview(Number(params[0]), actor, r.decision, r.note),
        );
      },
    },
    {
      // R3 « Accorder un tour »: a manual right (the broadcaster's Studio; moderators: lot R8).
      method: 'POST',
      pattern: at('/(\\d{1,32})/grant'),
      auth,
      handle: ({ params, body, installation }) => {
        const { actor, rest } = actorAndBody(!!production, installation, body);
        return mapped(() =>
          wheel.grant(channel(params[0]!), actor, parse(SwGrantInput, rest)),
        );
      },
    },
    {
      // Studio « Tester »: a « test » gain, never attributable. `full`: a simulated sub through the alerts queue first.
      method: 'POST',
      pattern: at('/(\\d{1,32})/test'),
      auth,
      handle: async ({ params, body }) => {
        const ch = channel(params[0]!);
        const t = parse(SwTestRequest, body);
        if (!t.full) return wheel.test(ch, t);
        const id = `sub-wheel-test-${randomUUID()}`;
        const months = t.months ?? 1;
        const { alert } = await alerts.receive({
          channel_id: ch,
          source: 'simulation',
          source_event_id: id,
          type: months > 1 ? 'resub' : 'sub',
          actor: { display_name: t.name ?? 'Test Studio' },
          tier: t.tier === 2 ? '2000' : t.tier === 3 ? '3000' : '1000',
          ...(months > 1 ? { months } : {}),
        });
        return wheel.test(ch, t, {
          event_key: `alert:simulation:${id}`,
          alert_id: alert?.alert_id ?? null,
        });
      },
    },
    {
      method: 'POST',
      pattern: at('/(\\d{1,32})/animations/claim'),
      auth,
      handle: ({ params, body }) =>
        wheel.claimAnimation(
          channel(params[0]!),
          parse(SwAnimationClaim, body).consumer_id,
        ),
    },
    {
      method: 'POST',
      pattern: at(`/spins/${uuid}/animation`),
      auth,
      handle: ({ params, body }) =>
        mapped(() =>
          wheel.reportAnimation(params[0]!, parse(SwAnimationReport, body)),
        ),
    },
    {
      // R3 « Tirer »: the right is drawn by the next wheel (before the automatic queue).
      method: 'POST',
      pattern: at(`/spins/${uuid}/request`),
      auth,
      handle: ({ params, body, installation }) =>
        mapped(() =>
          wheel.requestDraw(
            params[0]!,
            actorAndBody(!!production, installation, body).actor,
          ),
        ),
    },
    {
      // Reconciliation: a pending gain credited by hand elsewhere, or cancelled. Never a credit by Raptoru.
      method: 'POST',
      pattern: at(`/spins/${uuid}/award`),
      auth,
      handle: ({ params, body }) =>
        mapped(() =>
          wheel.settleByHand(params[0]!, parse(SwAwardUpdate, body)),
        ),
    },
  ];
}
