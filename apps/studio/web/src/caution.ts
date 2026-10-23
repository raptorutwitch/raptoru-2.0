import { cautionView, type CautionState } from './caution-view.js';

// Caution — the Studio section of the « Points de chaîne » tab (docs/CAUTION.md): read only (the executor, the last
// cautions, what is to verify). Nothing here moves Jetons or calls Twitch.

const HEADERS = { 'x-raptoru-studio': '1' };

export function mountCaution(root: HTMLElement) {
  let state: CautionState | null = null;
  let error: string | null = null;
  const load = async () => {
    try {
      const res = await fetch('/api/caution/state', { headers: HEADERS });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      state = body;
      error = null;
    } catch (e) {
      error = `Caution indisponible : ${(e as Error).message}`;
    }
    root.innerHTML = cautionView(state, error);
  };
  return { load };
}
