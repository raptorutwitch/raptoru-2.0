import type { TwitchOAuthRole } from '@raptoru/schemas';

type Account = {
  role: TwitchOAuthRole;
  expected: { login: string; user_id: string };
  stored: {
    login: string | null;
    user_id: string | null;
    expires_at: string | null;
    refresh_available: boolean;
  };
  validated: { login: string; user_id: string } | null;
  client_id: string | null;
  token_file: string;
  state: string;
  stored_expired: boolean;
  scopes: string[];
  required_scopes: string[];
  missing_scopes: string[];
  checked_at: string | null;
  /** « Vérifier » renewed the grant with the stored refresh token. */
  renewed_at?: string | null;
  validated_at: string | null;
  features: { label: string; scope: string; scope_present: boolean }[];
};
type Status = {
  accounts: Account[];
  configured: boolean;
  /** Production profile: PC tokens not used by the production bot, no reauthorization here. */
  production?: boolean;
  authorization_allowed: boolean;
  authorization_blocked_reason: string | null;
  busy: string | null;
  flow: {
    role: TwitchOAuthRole;
    state: string;
    authorization_url?: string;
    code?: string;
  } | null;
};

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
const esc = (value: unknown) =>
  String(value ?? '—').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString('fr-FR') : 'jamais';
const LABELS: Record<string, string> = {
  ready: 'Autorisation vérifiée',
  renewable: 'Accès expiré · renouvelable',
  refresh_failed: 'Renouvellement impossible',
  unverified: 'NON VÉRIFIÉ',
  pending_validation: 'Renouvellement en attente',
  missing: 'Aucun jeton',
  unreadable: 'Fichier illisible',
  no_token: 'Aucun jeton utilisable',
  missing_scopes: 'Droits manquants',
  wrong_client: 'Autre application Twitch',
  wrong_account: 'Mauvais compte Twitch',
  not_user_token: 'Jeton utilisateur requis',
  invalid_token_info: 'Réponse Twitch invalide',
  invalid_token: 'Jeton refusé ou expiré',
  expired: 'Jeton expiré',
  twitch_unavailable: 'Vérification impossible (réseau / Twitch)',
  busy: 'Une opération Twitch est déjà en cours.',
  production_profile:
    'Profil Production : les jetons de ce PC ne servent pas au bot de Production. Réautorisation disponible en profil Lab.',
  consumers_active:
    'Coupe l’ingestion dans Simulation et arrête le bot Test Lab avant de réautoriser.',
  configuration_missing: 'Application Twitch non configurée.',
  token_path_conflict:
    'Les comptes bot et streamer doivent utiliser deux fichiers de jetons distincts.',
  bot_not_built: 'Le bot doit être compilé avant la réautorisation.',
  authorization_failed: 'La réautorisation a échoué. Aucun succès confirmé.',
  invalid_cli_response: 'Réponse de réautorisation invalide.',
  callback_port_busy: 'Le port de retour Twitch est occupé.',
  oauth_state_invalid: 'Retour Twitch expiré ou invalide.',
  oauth_denied: 'Autorisation refusée dans Twitch.',
  oauth_timeout: 'La demande Twitch a expiré.',
  timeout: 'La demande Twitch a expiré.',
  state_mismatch: 'Retour Twitch invalide : recommence depuis Studio.',
  authorization_denied: 'Autorisation refusée dans Twitch.',
  missing_code: 'Le retour Twitch ne contient pas d’autorisation.',
  port_busy: 'Le port de retour Twitch est occupé.',
  callback_unavailable: 'Le retour Twitch local est indisponible.',
  invalid_redirect: 'Adresse de retour Twitch invalide.',
  exchange_failed: 'Échange de l’autorisation Twitch refusé.',
  missing_refresh_token:
    'L’autorisation Twitch ne permet pas le renouvellement.',
  store_conflict:
    'Le fichier du jeton a changé pendant l’autorisation. Recommence après arrêt des consommateurs.',
  invalid_store:
    'Le fichier du jeton est invalide : aucun remplacement automatique effectué.',
  store_busy: 'Un autre renouvellement du jeton est en cours.',
  refresh_rejected: 'Le renouvellement du jeton a été refusé.',
};

/** What to do for a state that is not « ready »: a reauthorization only when the grant itself is refused. */
export function advice(state: string, production: boolean) {
  const reauth = production
    ? 'Réautorisation nécessaire avant d’utiliser le Lab (profil Lab). Sans effet sur le bot de Production.'
    : 'Réautorisation nécessaire : « Réautoriser Twitch ».';
  switch (state) {
    case 'renewable':
      return 'Le jeton d’accès (≈ 4 h) a expiré : c’est normal. Il est renouvelé automatiquement au démarrage du bot ou du Lab, ou par « Vérifier ». Aucune réautorisation.';
    case 'unverified':
      return 'Pas encore vérifié depuis le démarrage de Studio. « Vérifier » renouvelle aussi un accès expiré.';
    case 'twitch_unavailable':
    case 'store_busy':
    case 'pending_validation':
      return 'Temporaire : réessaie « Vérifier » dans un moment. Aucune réautorisation.';
    case 'refresh_rejected':
    case 'refresh_failed':
    case 'invalid_token':
    case 'no_token':
    case 'missing':
    case 'missing_scopes':
    case 'wrong_account':
    case 'wrong_client':
    case 'not_user_token':
      return `Autorisation refusée ou incomplète. ${reauth}`;
    default:
      return production
        ? 'Non utilisé par le bot de Production.'
        : 'Capacités non confirmées : « Vérifier » avant utilisation.';
  }
}

/** Two operator accounts, separate from the viewer-only emotes authorization in the Extension. */
export function mountTwitchConnections(root: HTMLElement) {
  let status: Status | null = null;
  let error: string | null = null;
  let requesting = false;
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastHtml = '';

  function render() {
    if (!status) {
      root.innerHTML = `<h3>Comptes Twitch</h3><p class="home-detail">${esc(error ?? 'Chargement…')}</p>`;
      return;
    }
    const current = status;
    const disabled = requesting || Boolean(current.busy);
    const accounts = status.accounts
      .map((a) => {
        // Temporary or normal states are never red: an access token lives ≈ 4 h and is renewed on use.
        const passing = [
          'unverified',
          'renewable',
          'twitch_unavailable',
          'store_busy',
        ].includes(a.state);
        const tone =
          a.state === 'ready'
            ? 'ok'
            : current.production
              ? passing
                ? 'idle'
                : 'warn'
              : passing
                ? 'warn'
                : 'ko';
        const unavailable = a.features
          .filter((f) => !f.scope_present)
          .map((f) => f.label);
        return `<div class="twitch-connection">
        <div class="row home-row"><b>${a.role === 'bot' ? 'Bot · LeCroupier_' : 'Streamer · raptoru_'}</b><span class="badge ${tone}">${esc(LABELS[a.state] ?? 'Non vérifié')}</span></div>
        <p class="home-detail">Attendu : ${esc(a.expected.login)} (${esc(a.expected.user_id)}). Enregistré : ${esc(a.stored.login)} (${esc(a.stored.user_id)}).${a.validated ? ` Vérifié : ${esc(a.validated.login)} (${esc(a.validated.user_id)}).` : ''}</p>
        <p class="home-detail">Dernière validation Twitch : ${esc(date(a.validated_at))}.${a.checked_at && a.checked_at !== a.validated_at ? ` Dernier essai : ${esc(date(a.checked_at))}.` : ''} Expiration enregistrée : ${a.stored.expires_at ? esc(date(a.stored.expires_at)) : 'inconnue'}${a.stored_expired ? ' (dépassée)' : ''}.</p>
        ${unavailable.length ? `<p class="home-detail">Droits manquants pour : ${esc(unavailable.join(', '))}.</p>` : ''}
        ${a.state === 'ready' ? (a.renewed_at ? `<p class="home-detail">Renouvelé automatiquement le ${esc(date(a.renewed_at))} (aucune réautorisation).</p>` : '') : `<p class="home-detail">${esc(advice(a.state, Boolean(current.production)))}</p>`}
        ${a.state === 'pending_validation' ? '<p class="home-detail">Un renouvellement a été interrompu : « Vérifier » le termine.</p>' : ''}
        <details data-twitch-details="${a.role}"><summary>Droits et source du jeton</summary>
          <p class="home-detail">${a.validated ? 'Droits renvoyés par la dernière validation' : 'Droits enregistrés, non vérifiés'} : ${esc(a.scopes.join(' ') || 'aucun')}.</p>
          <p class="home-detail">Profil approuvé : ${esc(a.required_scopes.join(' '))}. Manquants du profil : ${esc(a.missing_scopes.join(' ') || 'aucun')}.</p>
          <p class="home-detail">Application : ${esc(a.client_id)}. Fichier : ${esc(a.token_file)}. Rafraîchissement enregistré : ${a.stored.refresh_available ? 'disponible' : 'absent'}.</p>
        </details>
        <div class="actions"><button type="button" data-twitch-action="verify" data-role="${a.role}" ${disabled || !current.configured ? 'disabled' : ''}>Vérifier</button>${current.production ? '' : `<button type="button" data-twitch-action="authorize" data-role="${a.role}" ${disabled || !current.configured || !current.authorization_allowed ? 'disabled' : ''}>Réautoriser Twitch</button>`}</div>
      </div>`;
      })
      .join('');
    const flow = status.flow;
    let flowHtml = '';
    if (flow) {
      const label = flow.role === 'bot' ? 'LeCroupier_' : 'raptoru_';
      const messages: Record<string, string> = {
        starting: `Préparation de l’autorisation ${label}…`,
        waiting: `Choisis ${label} dans Twitch, puis reviens ici après le retour OAuth.`,
        complete:
          status.busy === 'verify'
            ? `Autorisation ${label} enregistrée ; vérification de la connexion…`
            : status.accounts.find((account) => account.role === flow.role)
                  ?.state === 'ready'
              ? `Autorisation ${label} enregistrée et vérifiée.`
              : `Autorisation ${label} enregistrée ; consulte le diagnostic ci-dessus.`,
        cancelled: 'Réautorisation annulée.',
        expired: 'La réautorisation a expiré. Recommence quand tu es prêt.',
        error:
          LABELS[flow.code ?? ''] ?? 'Réautorisation refusée ou interrompue.',
      };
      let link = '';
      if (flow.authorization_url && flow.state === 'waiting') {
        try {
          const url = new URL(flow.authorization_url);
          if (
            url.origin === 'https://id.twitch.tv' &&
            url.pathname === '/oauth2/authorize' &&
            !url.username &&
            !url.password
          )
            link = `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">Ouvrir Twitch pour ${esc(label)}</a>`;
        } catch {
          /* Invalid URLs never reach an external browser. */
        }
      }
      flowHtml = `<p class="home-detail" role="status">${esc(messages[flow.state] ?? 'Autorisation en cours.')} ${link}</p>${['starting', 'waiting'].includes(flow.state) ? '<button type="button" data-twitch-action="cancel">Annuler</button>' : ''}`;
    }
    const html = `<h3>Comptes Twitch${status.production ? ' — jetons de ce PC' : ''}</h3>${status.production ? '<p class="home-detail" role="note"><b>Non utilisés par le bot de Production (VPS)</b> : il garde ses propres jetons. Un problème du bot se lit dans le Centre de contrôle, pas ici.</p>' : ''}${accounts}${status.authorization_blocked_reason ? `<p class="home-detail">${esc(status.authorization_blocked_reason)}</p>` : ''}${flowHtml}${error ? `<p class="bad" role="alert">${esc(error)}</p>` : ''}<p class="home-detail">Vérifier interroge Twitch ; si l’accès a expiré, il le renouvelle avec l’autorisation enregistrée (sans nouveau consentement, même mécanisme que le bot). Les rôles Twitch et les abonnements EventSub ne sont pas vérifiés ici. L’autorisation permet des actions réelles même en Lab ; les automatismes restent réglés séparément. Les emotes viewer se connectent dans l’Extension.</p>`;
    if (html === lastHtml) return;
    const open = new Set(
      [...root.querySelectorAll<HTMLDetailsElement>('details[open]')].map(
        (node) => node.dataset.twitchDetails,
      ),
    );
    root.innerHTML = html;
    for (const node of root.querySelectorAll<HTMLDetailsElement>('details'))
      node.open = open.has(node.dataset.twitchDetails);
    lastHtml = html;
  }

  async function request(action?: string, role?: string) {
    const response = await fetch(
      `/api/twitch-connections${action ? `/${action}` : ''}`,
      {
        method: action ? 'POST' : 'GET',
        headers: HEADERS,
        ...(action ? { body: JSON.stringify(role ? { role } : {}) } : {}),
      },
    );
    const body = (await response.json()) as Status & { error?: string };
    if (!response.ok)
      throw new Error(
        LABELS[body.error ?? ''] ?? 'La connexion au serveur Studio a échoué.',
      );
    status = body;
    render();
  }

  root.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      'button[data-twitch-action]',
    );
    if (!button || requesting || button.disabled) return;
    requesting = true;
    error = null;
    render();
    try {
      await request(button.dataset.twitchAction, button.dataset.role);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      requesting = false;
      render();
    }
  });

  async function poll() {
    if (!visible) return;
    if (!requesting) {
      try {
        await request();
      } catch {
        error = 'Serveur Studio injoignable.';
        render();
      }
    }
    if (visible) timer = setTimeout(() => void poll(), 2000);
  }
  return {
    setVisible(value: boolean) {
      visible = value;
      clearTimeout(timer);
      if (value) void poll();
    },
  };
}
