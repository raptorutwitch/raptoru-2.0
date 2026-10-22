import {
  keepRevealed,
  type WordGamePanel,
  wordGameView,
} from './word-game-view.js';

// Jeu des mots V1 — Studio tab (docs/WORD_GAME_PARITY.md § 14). Polls Core's state through Studio every
// second while visible (same pattern as the Tombola tab) and relays the three actions. No game logic.
// « Voir la réponse » is local to this tab, in memory only: leaving or reloading it hides every answer.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

export function mountWordGame(root: HTMLElement) {
  let state: WordGamePanel | null = null;
  let busy = false;
  let error: string | null = null;
  /** Occurrence ids whose answer is shown (never sent anywhere). */
  let revealed = new Set<string>();
  const timers: number[] = [];
  /** The volume slider is being moved: the 1 s refresh must not rebuild it under the pointer. */
  let adjusting = false;

  const render = () => {
    if (adjusting) return;
    revealed = keepRevealed(revealed, state);
    root.innerHTML = wordGameView(state, Date.now(), busy, error, revealed);
  };

  async function refresh() {
    try {
      const res = await fetch('/api/word-game/state', { headers: HEADERS });
      const body = (await res.json()) as WordGamePanel & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      state = 'live' in body ? { ...body, fetched_at: Date.now() } : body;
      error = null;
    } catch (e) {
      error = `État indisponible : ${(e as Error).message}`;
    }
    render();
  }

  async function act(action: string) {
    busy = true;
    render();
    try {
      const res = await fetch('/api/word-game/actions', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(
          action === 'new_word'
            ? { action, request_id: crypto.randomUUID() }
            : { action },
        ),
      });
      const body = (await res.json()) as WordGamePanel & { error?: string };
      if (!res.ok)
        throw new Error(
          body.error === 'offline'
            ? 'Hors live : action impossible.'
            : (body.error ?? `HTTP ${res.status}`),
        );
      state = { ...body, fetched_at: Date.now() };
      error = null;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
      render();
    }
  }

  // Volume of the winning sound: the label follows the slider, the value is saved when it is released.
  root.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement).matches('[data-volume]')) adjusting = true;
  });
  window.addEventListener('pointerup', () => {
    adjusting = false;
  });
  root.addEventListener('input', (ev) => {
    const input = ev.target as HTMLInputElement;
    if (!input.matches('[data-volume]')) return;
    const out = input.parentElement?.querySelector('output');
    if (out) out.textContent = `${input.value} %`;
  });
  root.addEventListener('change', (ev) => {
    const input = ev.target as HTMLInputElement;
    if (!input.matches('[data-volume]')) return;
    adjusting = false;
    void saveVolume(Number(input.value));
  });

  async function saveVolume(volume: number) {
    try {
      const res = await fetch('/api/word-game/volume', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ volume }),
      });
      const body = (await res.json()) as {
        sound_volume?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (state && 'live' in state)
        state = { ...state, sound_volume: body.sound_volume };
      error = null;
    } catch (e) {
      error = `Volume non enregistré : ${(e as Error).message}`;
    }
    render();
  }

  root.addEventListener('click', (ev) => {
    const reveal = (ev.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-reveal]',
    );
    if (reveal) {
      const id = reveal.dataset.reveal!;
      if (!revealed.delete(id)) revealed.add(id);
      render();
      return;
    }
    const button = (ev.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-action]',
    );
    if (!button || button.disabled) return;
    const action = button.dataset.action!;
    if (action === 'copy') {
      if (state && 'player_url' in state && state.player_url)
        void navigator.clipboard?.writeText(state.player_url);
      return;
    }
    void act(action);
  });

  render();
  return {
    setVisible(v: boolean) {
      for (const t of timers.splice(0)) window.clearInterval(t);
      if (!v) {
        revealed.clear(); // leaving the tab hides every answer
        return;
      }
      void refresh();
      timers.push(window.setInterval(() => void refresh(), 1000));
    },
  };
}
