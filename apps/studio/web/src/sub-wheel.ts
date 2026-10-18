import { subWheelView, type SwState } from './sub-wheel-view.js';

// Roue du Sub — the Studio section of the « Points de chaîne » tab (docs/SUB_WHEEL.md). The switch is OFF by default
// (turning it on asks for a confirmation: gains are only recorded); the tests never give a real gain; a pending gain
// can be marked « credited by hand » or cancelled, with a note (reconciliation) — Raptoru never credits it itself.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

export function mountSubWheel(root: HTMLElement) {
  let state: SwState | null = null;
  let error: string | null = null;
  let message = '';

  const render = () => {
    const keep = ['sw-name', 'sw-tier', 'sw-months'].map((f) => [
      f,
      root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)?.value,
    ]);
    root.innerHTML =
      subWheelView(state, error) +
      (message ? `<p class="cp-muted">${message}</p>` : '');
    for (const [f, v] of keep) {
      const el = root.querySelector<HTMLInputElement>(`[data-f="${f}"]`);
      if (el && v !== undefined) el.value = v;
    }
  };

  const load = async () => {
    if (root.contains(document.activeElement)) return;
    try {
      const res = await fetch('/api/sub-wheel/state', { headers: HEADERS });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      state = body;
      error = null;
    } catch (e) {
      error = `Roue du Sub indisponible : ${(e as Error).message}`;
    }
    render();
  };

  const post = async (path: string, body: object, done: string) => {
    try {
      const res = await fetch(`/api/sub-wheel${path}`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      message = done;
    } catch (e) {
      message = `Refusé : ${(e as Error).message}`;
    }
    (document.activeElement as HTMLElement | null)?.blur();
    await load();
  };

  const testBody = () => ({
    name:
      root
        .querySelector<HTMLInputElement>('[data-f="sw-name"]')
        ?.value.trim() || undefined,
    tier: Number(
      root.querySelector<HTMLSelectElement>('[data-f="sw-tier"]')?.value ?? 1,
    ),
    months: Math.max(
      1,
      Math.min(
        200,
        Math.round(
          Number(
            root.querySelector<HTMLInputElement>('[data-f="sw-months"]')
              ?.value ?? 1,
          ) || 1,
        ),
      ),
    ),
  });

  root.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>(
      '[data-act]',
    );
    const act = target?.dataset.act;
    if (act === 'sw-switch' && state) {
      const on = !state.settings.enabled;
      if (
        on &&
        !confirm(
          'Activer la Roue du Sub ?\n\nLes vrais subs, resubs et Prime lanceront la roue. Les gains ne sont PAS crédités : ils restent « en attente d’attribution » tant que l’économie n’est pas raccordée.',
        )
      )
        return;
      void post(
        '/settings',
        { enabled: on },
        on ? 'Roue activée.' : 'Roue désactivée.',
      );
    }
    if (act === 'sw-test')
      void post(
        '/test',
        testBody(),
        'Roue envoyée au lecteur d’effets (aucun gain).',
      );
    if (act === 'sw-full')
      void post(
        '/test',
        { ...testBody(), full: true },
        'Alerte de sub simulée puis roue (aucun gain).',
      );
    if ((act === 'sw-manual' || act === 'sw-cancel') && target?.dataset.spin) {
      const note = prompt(
        act === 'sw-manual'
          ? 'Gain crédité à la main : où et comment ? (note obligatoire)'
          : 'Annuler ce gain : pourquoi ? (note obligatoire)',
      )?.trim();
      if (!note) return;
      void post(
        `/spins/${target.dataset.spin}/award`,
        { status: act === 'sw-manual' ? 'manual' : 'cancelled', note },
        'Gain mis à jour.',
      );
    }
  });

  return { load };
}
