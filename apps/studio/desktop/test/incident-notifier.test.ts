import { describe, expect, it } from 'vitest';
import {
  createIncidentNotifier,
  type Notice,
  type NotifiedIncident,
} from '../src/incident-notifier.js';

const incident = (over: Partial<NotifiedIncident> = {}): NotifiedIncident => ({
  id: 'i1',
  label: 'Soundboard',
  value: 'Lecteur absent',
  hint: 'Vérifier la source OBS.',
  action: 'manual',
  startedAt: '2026-10-22T20:40:00Z',
  endedAt: null,
  ...over,
});

function harness() {
  let current: { incidents: NotifiedIncident[] } | null = { incidents: [] };
  const sent: Notice[] = [];
  const n = createIncidentNotifier({
    read: async () => current,
    notify: (x) => sent.push(x),
  });
  return {
    n,
    sent,
    set: (i: NotifiedIncident[] | null) =>
      (current = i ? { incidents: i } : null),
  };
}

describe('Windows notifications of the live incidents', () => {
  it('one notification per confirmed incident, never repeated while it lasts', async () => {
    const h = harness();
    await h.n.poll();
    h.set([incident()]);
    await h.n.poll();
    await h.n.poll();
    await h.n.poll();
    expect(h.sent).toEqual([
      {
        title: 'Raptoru — Soundboard indisponible',
        body: 'Lecteur absent. Action requise : Vérifier la source OBS.',
      },
    ]);
  });

  it('automatic recovery wording, then one notification for the end', async () => {
    const h = harness();
    h.set([incident({ action: 'auto' })]);
    await h.n.poll();
    h.set([incident({ action: 'auto', endedAt: '2026-10-22T20:52:30Z' })]);
    await h.n.poll();
    await h.n.poll();
    expect(h.sent.map((s) => s.body)).toEqual([
      'Lecteur absent. Récupération automatique en cours.',
      'Indisponible pendant 12 min 30 s.',
    ]);
  });

  it('an incident confirmed and ended between two polls still announces its end', async () => {
    const h = harness();
    await h.n.poll();
    h.set([incident({ endedAt: '2026-10-22T20:41:00Z' })]);
    await h.n.poll();
    expect(h.sent.map((s) => s.title)).toEqual([
      'Raptoru — Soundboard rétabli',
    ]);
  });

  it('Studio reopened: an incident already over is not announced again', async () => {
    const h = harness();
    h.set([incident({ endedAt: '2026-10-22T20:52:30Z' })]);
    await h.n.poll();
    expect(h.sent).toEqual([]);
  });

  it('server unreachable or failing read: nothing sent, nothing lost', async () => {
    const h = harness();
    h.set(null);
    await h.n.poll();
    const failing = createIncidentNotifier({
      read: async () => {
        throw new Error('ECONNREFUSED');
      },
      notify: () => {
        throw new Error('must not notify');
      },
    });
    await failing.poll();
    expect(h.sent).toEqual([]);
  });
});
