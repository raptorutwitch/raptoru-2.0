import { describe, expect, it } from 'vitest';
import {
  bonkFeedbackForResult,
  createBonkSend,
} from '../extension/shared/bonk-send.js';

// Bonk sending and its last outcome, alone (extracted from ui.js): several requests at once, each with its outcome;
// a refusal never stops the others; the outcome belongs to the visit. A fake slot and controllable requests.

function slot() {
  const classes = new Set();
  return {
    textContent: '',
    classList: {
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      has: (c) => classes.has(c),
    },
  };
}
function setup() {
  const calls = { notices: [], errors: [], redraws: 0, refreshes: 0 };
  const send = createBonkSend({
    refresh: async () => void calls.refreshes++,
    notice: (text, kind = 'ok') => calls.notices.push([text, kind]),
    errorText: (code) =>
      code === 'insufficient_funds'
        ? 'Pas assez de jetons.'
        : 'Erreur inconnue.',
    notifyError: (error) => calls.errors.push(error.code),
    redraw: () => void calls.redraws++,
  });
  const node = slot();
  send.mount(node);
  return { send, node, calls };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

describe('Bonk send', () => {
  it('in flight, then Core’s answer in words; the magazine bubble too (a salve has its own)', async () => {
    const { send, node, calls } = setup();
    const req = deferred();
    const done = send.send(() => req.promise);
    expect(node.textContent).toBe('Bonk en cours…');
    req.resolve({ status: 'queued' });
    expect(await done).toBe(true);
    expect(node.textContent).toBe('Bonk accepté · en file ✓');
    expect(calls.notices).toEqual([['Bonk accepté · en file ✓', 'ok']]);
    expect(calls.refreshes).toBe(1);
    expect(calls.redraws).toBe(1);
    await send.send(async () => ({ volley_id: 'v1', interactions: [{}, {}] }));
    expect(node.textContent).toBe('Salve ×2 acceptée ✓');
    expect(calls.notices).toHaveLength(1); // no extra bubble for a salve
  });

  it('a refusal is said with its reason, as an error, and reaches the notification centre', async () => {
    const { send, node, calls } = setup();
    expect(
      await send.send(async () =>
        Promise.reject({ code: 'insufficient_funds' }),
      ),
    ).toBe(false);
    expect(node.textContent).toBe('Bonk non envoyé · Pas assez de jetons.');
    expect(node.classList.has('jdm-bonk-feedback--error')).toBe(true);
    expect(calls.notices).toEqual([
      ['Bonk non envoyé · Pas assez de jetons.', 'error'],
    ]);
    expect(calls.errors).toEqual(['insufficient_funds']);
  });

  it('two requests at once: one failing never cancels the other (the last answer is shown)', async () => {
    const { send, node } = setup();
    const a = deferred();
    const b = deferred();
    const first = send.send(() => a.promise);
    const second = send.send(() => b.promise);
    a.reject({ code: 'x' });
    expect(await first).toBe(false);
    b.resolve({ status: 'delivered' });
    expect(await second).toBe(true);
    expect(node.textContent).toBe('Bonk livré ✓');
  });

  it('a task that throws is a refusal, not a crash; refuse() sends nothing; clear() forgets the outcome', async () => {
    const { send, node, calls } = setup();
    expect(
      await send.send(() => {
        throw { code: 'boom' };
      }),
    ).toBe(false);
    send.refuse('Connecte tes emotes Twitch pour utiliser celle-ci.');
    expect(node.textContent).toBe(
      'Connecte tes emotes Twitch pour utiliser celle-ci.',
    );
    expect(calls.refreshes).toBe(0);
    send.clear();
    const next = slot();
    send.mount(next); // the next visit's screen
    expect(next.textContent).toBe('');
  });

  it('Core’s statuses', () => {
    expect(bonkFeedbackForResult({ status: 'spawned' })).toBe('Bonk apparu ✓');
    expect(bonkFeedbackForResult({})).toBe('Bonk accepté ✓');
  });
});
