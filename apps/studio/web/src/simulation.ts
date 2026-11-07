import { confirmBox, patch } from './ds/ds.js';
import { labOnMainCore } from './http.js';
import { confirmFor, type SimState, simButton } from './simulation-view.js';

// Studio Lab — the simulated stream over the EXISTING commands and states: shared simulated live (Tombola status /
// actions), Twitch chat ingestion and real output (lab-chat). Each button calls the route the detailed tabs already use.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
const POLL_MS = 5000;

export async function getJson(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(path, { headers: HEADERS });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function post(path: string, body: unknown) {
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
  return out;
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
};

/** Fired after any switch changed, so the top bar panel and the Simulation tab both refresh at once. */
export const SIM_CHANGED = 'raptoru:simulation-changed';

/** The effective states of the four services, from their existing routes (read only). */
export async function loadSimState(): Promise<SimState> {
  const [raffle, ingress, output, chatFictional] = await Promise.all([
    getJson('/api/raffle/status'),
    getJson('/api/lab-chat/status'),
    getJson('/api/lab-chat/output'),
    labOnMainCore(),
  ]);
  // Production profile: the Studio server refuses a simulated live (it would open the real shared session).
  const production = raffle?.simulated_stream === false;
  const state: SimState = {
    production,
    chatFictional,
    stream:
      raffle && 'stream' in raffle && !production
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
  };
  // Production profile: the lab-chat status says « unavailable ».
  if (
    ingress &&
    (ingress.blocked as { code?: string } | null)?.code === 'unavailable'
  )
    state.ingress = null;
  return state;
}

/**
 * One switch, after its confirmation when it could make LeCroupier_ write in the real chat. Returns null
 * when done or declined, else the error to show.
 */
export async function runSimAction(
  action: string,
  state: SimState,
): Promise<string | null> {
  const target = ACTIONS[action];
  if (!target) return null;
  const question = confirmFor(action, state);
  if (
    question &&
    !(await confirmBox({
      title: 'Effet réel',
      body: question,
      yes: 'Continuer',
      no: 'Annuler',
    }))
  )
    return null;
  try {
    await post(...target);
    return null;
  } catch (e) {
    const m = (e as Error).message;
    return m === 'missing_write_scope'
      ? 'LeCroupier_ n’a pas l’autorisation d’écrire dans le chat.'
      : m;
  } finally {
    window.dispatchEvent(new Event(SIM_CHANGED));
  }
}

/** L'entrée de la barre latérale : un lien vers la Simulation et l'état du live fictif, depuis n'importe quelle page. */
export function mountSimulation(root: HTMLElement) {
  const read = async () => {
    const s = await loadSimState();
    root.hidden = !!s.production;
    patch(root, simButton(s));
  };
  void read();
  setInterval(() => void read(), POLL_MS);
  window.addEventListener(SIM_CHANGED, () => void read());
}
