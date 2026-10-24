import { HISTORICAL } from './spotify-panels.js';
import {
  spotifyView,
  type SpState,
  type SpTab,
  type SpUi,
} from './spotify-view.js';

// Spotify V2 — the Studio section of the « Points de chaîne » tab (docs/SPOTIFY_V2.md § 6). Core decides; Studio is the
// only Spotify caller. Every action here is an explicit click: opening the requests, moderation, settings, viewers'
// exceptions, one Spotify reading (« Actualiser », rate-limited by Studio), the connection (opens Spotify's consent page
// in the browser), the creation of Raptoru's reward on Twitch (confirmed first). What is typed is kept across the 3 s
// refresh (ui.fields); the open space is remembered in this browser only.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
const TAB_KEY = 'raptoru.spotify.tab';
const TABS: SpTab[] = ['live', 'viewers', 'settings', 'reward', 'tech', 'sim'];

const ERRORS: Record<string, string> = {
  reward_exists: 'La récompense existe déjà.',
  reward_create_in_progress: 'Une création est déjà en cours.',
  rate_limited: 'Spotify limite les appels : réessaie plus tard.',
  spotify_not_connected: 'Spotify n’est pas connecté.',
  invalid_request: 'Valeur refusée : vérifie les champs.',
  invalid_client_id: 'Client ID invalide (32 caractères).',
  not_removable: 'Cette demande ne peut plus être retirée.',
  playing_use_skip: 'Elle joue déjà : utilise « Passer la musique ».',
  already_settled: 'Déjà réglée.',
  not_uncertain: 'Cette demande n’est plus à vérifier.',
};

export function mountSpotify(root: HTMLElement) {
  let state: SpState | null = null;
  let error: string | null = null;
  let message = '';
  let tab: SpTab = 'live';
  try {
    const t = localStorage.getItem(TAB_KEY) as SpTab | null;
    if (t && TABS.includes(t)) tab = t;
  } catch {
    /* storage unavailable: the main space */
  }
  const ui: SpUi = { tab, fields: {}, who: [], now: Date.now() };

  const render = () => {
    ui.now = Date.now();
    root.innerHTML =
      spotifyView(state, error, ui) +
      (message ? `<p class="sp-message">${message}</p>` : '');
  };

  const load = async (force = false) => {
    // Never re-drawn under the cursor of a field being typed in (its value is kept anyway).
    if (
      !force &&
      root.contains(document.activeElement) &&
      ['INPUT', 'SELECT'].includes(document.activeElement?.tagName ?? '')
    )
      return;
    try {
      const res = await fetch('/api/spotify/state', { headers: HEADERS });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      state = body;
      error = null;
      if (state?.sim && !ui.who.length)
        ui.who = ((
          await (
            await fetch('/api/lab-chat/identities', { headers: HEADERS })
          ).json()
        ).identities ?? []) as SpUi['who'];
    } catch (e) {
      error = `Musique indisponible : ${(e as Error).message}`;
    }
    render();
  };

  const post = async (
    path: string,
    body: object,
    done: string,
    clear: string[] = [],
  ) => {
    try {
      const res = await fetch(`/api/spotify${path}`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      message = done;
      for (const f of clear) delete ui.fields[f];
      return out as Record<string, unknown>;
    } catch (e) {
      const code = (e as Error).message;
      message = `Refusé : ${ERRORS[code] ?? code}`;
      return null;
    } finally {
      (document.activeElement as HTMLElement | null)?.blur();
      await load(true);
    }
  };

  const field = (f: string) =>
    (
      ui.fields[f] ??
      root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)?.value ??
      ''
    ).trim();
  /** An optional number: empty → null. */
  const opt = (f: string) => (field(f) === '' ? null : Number(field(f)));

  // What is typed survives the refresh.
  const keep = (ev: Event) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.f) ui.fields[t.dataset.f] = t.value;
  };
  root.addEventListener('input', keep);
  root.addEventListener('change', keep);

  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>(
      '[data-act], [data-tab]',
    );
    if (!el || !state) return;
    if (el.dataset.tab) {
      ui.tab = el.dataset.tab as SpTab;
      message = '';
      try {
        localStorage.setItem(TAB_KEY, ui.tab);
      } catch {
        /* not remembered */
      }
      render();
      return;
    }
    const act = el.dataset.act;
    const id = el.dataset.id;
    if (act === 'sp-switch') {
      const on = !state.settings.enabled;
      if (
        on &&
        !confirm(
          'Ouvrir les demandes de musique ?\n\nLes rédemptions de la récompense liée seront cherchées et ajoutées à la file Spotify.',
        )
      )
        return;
      void post(
        '/settings',
        { enabled: on },
        on ? 'Demandes ouvertes.' : 'Demandes fermées.',
      );
    }
    if (act === 'sp-refresh') void post('/refresh', {}, 'Lecture actualisée.');
    if (
      act === 'sp-skip' &&
      confirm('Passer la musique en cours sur Spotify ?')
    )
      void post('/actions', { action: 'skip' }, 'Passage demandé.');
    if (
      act === 'sp-remove' &&
      id &&
      confirm(
        'Retirer cette demande ?\n\nLe viewer est remboursé (récompense de Raptoru) ; si elle est déjà dans la file Spotify, elle sera passée automatiquement.',
      )
    )
      void post(
        '/actions',
        { action: 'remove', request_id: id },
        'Demande retirée.',
      );
    if (act === 'sp-settle' && id) {
      const refund = el.dataset.decision === 'refund';
      if (
        confirm(
          refund
            ? 'Rembourser cette demande sur Twitch ?'
            : 'Garder cette demande ? Rien n’est envoyé à Twitch : la réclamation reste en attente.',
        )
      )
        void post(
          `/requests/${id}/settle`,
          { decision: refund ? 'refund' : 'keep' },
          'Demande réglée.',
        );
    }
    if (act === 'sp-save') {
      const minutes = (f: string) => Math.round(Number(field(f)) * 60);
      void post(
        '/settings',
        {
          max_pending_per_viewer: Number(field('set-pending')),
          viewer_cooldown_seconds: minutes('set-cooldown'),
          max_duration_seconds: minutes('set-duration'),
          cancel_grace_seconds: Number(field('set-grace')),
        },
        'Réglages enregistrés.',
        ['set-pending', 'set-cooldown', 'set-duration', 'set-grace'],
      );
    }
    if (
      act === 'sp-historical' &&
      confirm(
        'Revenir aux valeurs historiques ?\n\n2 demandes en attente, 10 min entre deux demandes, 10 min de durée maximale, 10 s pour annuler sa musique en cours.',
      )
    )
      void post('/settings', HISTORICAL, 'Valeurs historiques rétablies.', [
        'set-pending',
        'set-cooldown',
        'set-duration',
        'set-grace',
      ]);
    if (act === 'sp-ov-save') {
      const cooldown = opt('ov-cooldown');
      void post(
        '/overrides',
        {
          viewer_login: field('ov-login'),
          max_pending_per_viewer: opt('ov-pending'),
          viewer_cooldown_seconds:
            cooldown === null ? null : Math.round(cooldown * 60),
        },
        'Exception enregistrée.',
        ['ov-login', 'ov-pending', 'ov-cooldown'],
      );
    }
    if (act === 'sp-ov-edit' && el.dataset.login) {
      const o = state.overrides?.find(
        (x) => x.viewer_login === el.dataset.login,
      );
      ui.fields['ov-login'] = el.dataset.login;
      ui.fields['ov-pending'] = String(o?.max_pending_per_viewer ?? '');
      ui.fields['ov-cooldown'] =
        o?.viewer_cooldown_seconds == null
          ? ''
          : String(o.viewer_cooldown_seconds / 60);
      render();
    }
    if (
      act === 'sp-ov-reset' &&
      el.dataset.login &&
      confirm(`@${el.dataset.login} revient aux valeurs globales ?`)
    )
      void post(
        '/overrides',
        {
          viewer_login: el.dataset.login,
          max_pending_per_viewer: null,
          viewer_cooldown_seconds: null,
        },
        'Valeurs globales rétablies pour ce viewer.',
      );
    if (act === 'sp-connect')
      void post(
        '/connect',
        { client_id: field('client') },
        'Page Spotify ouverte dans le navigateur : accepte, puis reviens ici.',
      ).then((out) => out?.url && window.open(String(out.url), '_blank'));
    if (
      act === 'sp-disconnect' &&
      confirm('Déconnecter Spotify de ce PC ? Les demandes seront refusées.')
    )
      void post('/disconnect', {}, 'Spotify déconnecté.');
    if (act === 'sp-reward') {
      const cost = Number(field('rw-cost'));
      const prompt = field('rw-prompt');
      if (
        confirm(
          `Créer sur Twitch la récompense « Choisi la prochaine musique ! » ?\n\n• Prix : ${cost} points, texte du viewer obligatoire (« ${prompt} »)\n• Créée par l’application Twitch de Raptoru, avec le compte de la chaîne\n• Seules ses réclamations pourront être remboursées par Raptoru ; l’ancienne récompense (SAMMI) n’est pas touchée\n\nAction réelle sur Twitch.`,
        )
      )
        void post(
          '/reward',
          { cost, prompt },
          'Création demandée : le bot la fait sur Twitch.',
        );
    }
    if (act === 'sp-simulate') {
      const opt2 =
        root.querySelector<HTMLSelectElement>('[data-f="sim-who"]')
          ?.selectedOptions[0];
      if (!opt2) return;
      void post(
        '/simulate',
        {
          viewer_id: opt2.value,
          viewer_login: (opt2.dataset.login || 'lab_viewer').toLowerCase(),
          user_input: field('sim-text'),
        },
        'Demande simulée envoyée.',
      );
    }
    if (act === 'sp-sim' && el.dataset.what)
      void post(`/sim/${el.dataset.what}`, {}, 'Simulateur modifié.');
  });

  return { load: () => load() };
}
