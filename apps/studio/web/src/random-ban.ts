import { randomBanView, type RbState } from './random-ban-view.js';

// Random Ban V2 — the Studio section of the « Points de chaîne » tab (docs/RANDOM_BAN_V2.md). Shows the Twitch
// executor and the last Random Bans; « Tester l'animation » plays it in OBS without any Twitch call, « Tirage à blanc »
// runs the real search (Twitch reads) and NEVER times anyone out. The real Random Ban only comes from the reward.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

export function mountRandomBan(root: HTMLElement) {
  let state: RbState | null = null;
  let error: string | null = null;
  let message = '';

  const render = () => {
    const outcome =
      root.querySelector<HTMLSelectElement>('[data-f="rb-outcome"]')?.value ??
      'ban';
    root.innerHTML =
      randomBanView(state, error) +
      (message ? `<p class="cp-muted">${message}</p>` : '');
    const select = root.querySelector<HTMLSelectElement>(
      '[data-f="rb-outcome"]',
    );
    if (select) select.value = outcome;
  };

  const load = async () => {
    // Kept while a test choice is open.
    if (root.contains(document.activeElement)) return;
    try {
      const res = await fetch('/api/random-ban/state', { headers: HEADERS });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      state = body;
      error = null;
    } catch (e) {
      error = `Random Ban indisponible : ${(e as Error).message}`;
    }
    render();
  };

  const test = async (body: object, done: string, path = '/test') => {
    try {
      const res = await fetch(`/api/random-ban${path}`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      message = done;
    } catch (e) {
      message = `Test refusé : ${(e as Error).message}`;
    }
    (document.activeElement as HTMLElement | null)?.blur();
    await load();
  };

  root.addEventListener('click', (ev) => {
    const act = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]')
      ?.dataset.act;
    if (act === 'rb-animation') {
      const outcome =
        root.querySelector<HTMLSelectElement>('[data-f="rb-outcome"]')?.value ??
        'ban';
      void test(
        { mode: 'animation', outcome },
        'Animation envoyée au lecteur d’effets (aucun appel Twitch).',
      );
    }
    if (
      act === 'rb-dry-run' &&
      confirm(
        'Tirage à blanc ?\n\nLa vraie recherche est faite sur Twitch (lecture seule) ; personne n’est mis en timeout. L’animation du résultat est jouée.',
      )
    )
      void test(
        { mode: 'dry_run' },
        'Tirage à blanc envoyé : voir la liste (aucun timeout).',
      );
    if (
      act === 'rb-streamer-mute' &&
      confirm(
        'Tester le mute du streamer ?\n\nTon micro est VRAIMENT coupé dans OBS pour la durée du Random Ban, comme si tu étais tiré (une ligne dans le chat Twitch si la sortie chat est active ; aucun timeout, rien de payé). Une caution peut le lever.',
      )
    )
      void test(
        {},
        'Mute du streamer envoyé : voir la liste.',
        '/test-streamer-mute',
      );
  });

  return { load };
}
