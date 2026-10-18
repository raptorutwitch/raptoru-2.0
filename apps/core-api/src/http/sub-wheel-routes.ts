import { randomUUID } from 'node:crypto';
import {
  SwAnimationClaim,
  SwAnimationReport,
  SwAwardUpdate,
  SwSettingsInput,
  SwTestRequest,
} from '@raptoru/schemas';
import type { AlertsService } from '../alerts/service.js';
import { SwError, type SubWheelService } from '../sub-wheel/service.js';
import { HttpError, parse, type Route } from './server.js';

// Roue du Sub — routes of the ONE implementation (docs/SUB_WHEEL.md), same sub-paths twice: Lab Core /v1/lab/sub-wheel/*
// (Studio secret), production Core /v1/studio/sub-wheel/* (Studio installation, the Core's channel only). The wheel is
// fed by the alerts reception (alerts-routes.ts), never by a route of its own: there is no « spin » route.

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
