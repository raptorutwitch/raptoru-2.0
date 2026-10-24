import { spotifyView, type SpIdentity, type SpState } from './spotify-view.js';

// Spotify V2 — the Studio section of the « Points de chaîne » tab (docs/SPOTIFY_V2.md § 6). Core decides; Studio is the
// only Spotify caller. Every action here is an explicit click: switch, moderation, settings, the connection (opens
// Spotify's consent page in the browser), the creation of Raptoru's reward on Twitch (confirmed first).

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

export function mountSpotify(root: HTMLElement) {
  let state: SpState | null = null;
  let error: string | null = null;
  let message = '';
  /** Lab: the chat simulator's identities (same viewer ids as « Simulation »). */
  let who: SpIdentity[] = [];

  const render = () => {
    const picked = root.querySelector<HTMLSelectElement>(
      '[data-f="sp-sim-who"]',
    )?.value;
    root.innerHTML =
      spotifyView(state, error, who) +
      (message ? `<p class="cp-muted">${message}</p>` : '');
    const select = root.querySelector<HTMLSelectElement>(
      '[data-f="sp-sim-who"]',
    );
    if (select && picked) select.value = picked;
  };

  const load = async (force = false) => {
    // Kept while a field is being typed in.
    if (
      !force &&
      root.contains(document.activeElement) &&
      document.activeElement?.tagName === 'INPUT'
    )
      return;
    try {
      const res = await fetch('/api/spotify/state', { headers: HEADERS });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      state = body;
      error = null;
      if (state?.sim && !who.length)
        who = ((
          await (
            await fetch('/api/lab-chat/identities', { headers: HEADERS })
          ).json()
        ).identities ?? []) as SpIdentity[];
    } catch (e) {
      error = `Musique indisponible : ${(e as Error).message}`;
    }
    render();
  };

  const post = async (path: string, body: object, done: string) => {
    try {
      const res = await fetch(`/api/spotify${path}`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      message = done;
      return out as Record<string, unknown>;
    } catch (e) {
      message = `Refusé : ${(e as Error).message}`;
      return null;
    } finally {
      (document.activeElement as HTMLElement | null)?.blur();
      await load(true);
    }
  };

  const field = (f: string) =>
    root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)?.value.trim() ?? '';
  const num = (f: string) => Number(field(f));

  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const act = el?.dataset.act;
    if (!act || !state) return;
    if (act === 'sp-switch') {
      const on = !state.settings.enabled;
      if (
        on &&
        !confirm(
          'Activer les demandes de musique ?\n\nLes rédemptions de la récompense liée seront ajoutées à la file Spotify.',
        )
      )
        return;
      void post(
        '/settings',
        { enabled: on },
        on ? 'Demandes activées.' : 'Demandes coupées.',
      );
    }
    if (act === 'sp-save')
      void post(
        '/settings',
        {
          max_pending_per_viewer: num('sp-pending'),
          viewer_cooldown_seconds: Math.round(num('sp-cooldown') * 60),
          max_duration_seconds: Math.round(num('sp-duration') * 60),
          cancel_grace_seconds: num('sp-grace'),
        },
        'Réglages enregistrés.',
      );
    if (
      act === 'sp-skip' &&
      confirm('Passer la musique en cours sur Spotify ?')
    )
      void post('/actions', { action: 'skip' }, 'Passage demandé.');
    if (
      act === 'sp-remove' &&
      el?.dataset.id &&
      confirm('Retirer cette demande ? Elle est remboursée si possible.')
    )
      void post(
        '/actions',
        { action: 'remove', request_id: el.dataset.id },
        'Demande retirée.',
      );
    if (act === 'sp-settle' && el?.dataset.id) {
      const refund = el.dataset.decision === 'refund';
      if (
        confirm(
          refund
            ? 'Rembourser cette demande ?'
            : 'Garder cette demande ? Rien n’est envoyé à Twitch : la réclamation reste en attente.',
        )
      )
        void post(
          `/requests/${el.dataset.id}/settle`,
          { decision: refund ? 'refund' : 'keep' },
          'Demande réglée.',
        );
    }
    if (act === 'sp-connect')
      void post(
        '/connect',
        { client_id: field('sp-client') },
        'Page Spotify ouverte dans le navigateur : accepte, puis reviens ici.',
      ).then((out) => out?.url && window.open(String(out.url), '_blank'));
    if (
      act === 'sp-disconnect' &&
      confirm('Déconnecter Spotify de ce PC ? Les demandes seront refusées.')
    )
      void post('/disconnect', {}, 'Spotify déconnecté.');
    if (
      act === 'sp-reward' &&
      confirm(
        'Créer la récompense « Choisi la prochaine musique ! » sur Twitch (1 000 points, texte obligatoire) ?\n\nElle est créée par le bot avec le compte de la chaîne. L’ancienne récompense (SAMMI) n’est pas touchée.',
      )
    )
      void post(
        '/reward',
        { prompt: field('sp-prompt') },
        'Création demandée : le bot la fait sur Twitch.',
      );
    if (act === 'sp-simulate') {
      const opt = root.querySelector<HTMLSelectElement>('[data-f="sp-sim-who"]')
        ?.selectedOptions[0];
      if (!opt) return;
      void post(
        '/simulate',
        {
          viewer_id: opt.value,
          viewer_login: (opt.dataset.login || 'lab_viewer').toLowerCase(),
          user_input: field('sp-sim-text'),
        },
        'Demande simulée envoyée.',
      );
    }
    if (act === 'sp-sim' && el?.dataset.what)
      void post(`/sim/${el.dataset.what}`, {}, 'Simulateur modifié.');
  });

  return { load: () => load() };
}
