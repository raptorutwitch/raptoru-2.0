import {
  confirmFor,
  type SimState,
  simButton,
  simPanel,
} from './simulation-view.js';

// Studio Lab — « Simulation de stream » (top bar). One compact panel over the EXISTING commands and states:
// shared simulated live (Tombola status / actions), Twitch chat ingestion and real output (lab-chat), and
// the mini-games switch. No new system: each button calls the route the detailed tabs already use.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
const POLL_OPEN_MS = 2000;
const POLL_CLOSED_MS = 10_000;

async function getJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(path, { headers: HEADERS });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok)
    throw new Error(out.message ?? out.error ?? `HTTP ${res.status}`);
}

/** The route each panel button already uses elsewhere in Studio. */
const ACTIONS: Record<string, [string, unknown]> = {
  stream_start: [
    '/api/raffle/actions',
    { command: { action: 'stream_start' } },
  ],
  stream_end: ['/api/raffle/actions', { command: { action: 'stream_end' } }],
  ingress_on: ['/api/lab-chat/ingress', { enabled: true }],
  ingress_off: ['/api/lab-chat/ingress', { enabled: false }],
  output_on: ['/api/lab-chat/output', { enabled: true }],
  output_off: ['/api/lab-chat/output', { enabled: false }],
  games_on: ['/api/mini-games/settings', { enabled: true }],
  games_off: ['/api/mini-games/settings', { enabled: false }],
};

export function mountSimulation(root: HTMLElement) {
  let state: SimState | null = null;
  let open = false;
  let busy = false;
  let error: string | null = null;
  let timer = 0;

  const render = () => {
    root.innerHTML =
      simButton(state, open) + (open ? simPanel(state, busy, error) : '');
  };

  async function refresh() {
    const [raffle, ingress, output, games] = await Promise.all([
      getJson('/api/raffle/status'),
      getJson('/api/lab-chat/status'),
      getJson('/api/lab-chat/output'),
      getJson('/api/mini-games/state'),
    ]);
    state = {
      stream:
        raffle && 'stream' in raffle
          ? (raffle.stream as SimState['stream'])
          : undefined,
      ingress:
        ingress && typeof ingress.enabled === 'boolean'
          ? (ingress as unknown as SimState['ingress'])
          : null,
      output:
        output && typeof output.enabled === 'boolean'
          ? (output as unknown as SimState['output'])
          : null,
      games:
        games && typeof games.enabled === 'boolean'
          ? { enabled: games.enabled }
          : null,
    };
    // Production profile: the lab-chat status says « unavailable ».
    if (
      ingress &&
      (ingress.blocked as { code?: string } | null)?.code === 'unavailable'
    )
      state.ingress = null;
    render();
  }

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(
      () => {
        void refresh().finally(schedule);
      },
      open ? POLL_OPEN_MS : POLL_CLOSED_MS,
    );
  };

  root.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-sim]',
    );
    if (!b || b.disabled) return;
    const action = b.dataset.sim!;
    if (action === 'panel') {
      open = !open;
      error = null;
      render();
      void refresh();
      schedule();
      return;
    }
    const target = ACTIONS[action];
    if (!target || !state) return;
    const question = confirmFor(action, state);
    if (question && !window.confirm(question)) return;
    busy = true;
    error = null;
    render();
    void post(...target)
      .catch((e: Error) => {
        error =
          e.message === 'missing_write_scope'
            ? 'LeCroupier_ n’a pas l’autorisation d’écrire dans le chat.'
            : e.message;
      })
      .finally(() => {
        busy = false;
        void refresh();
      });
  });

  // Escape closes the panel.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && open) {
      open = false;
      render();
      schedule();
    }
  });

  render();
  void refresh();
  schedule();
}
