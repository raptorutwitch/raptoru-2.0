// Bonk · emotes Twitch non liées (prototype compact-video validé le 14/10/2026) : plus de bandeau
// permanent. Twitch est une source de la colonne latérale du picker (état « non lié » visible) ; un clic
// ouvre une petite fenêtre dont le bouton « Autoriser Twitch » lance le vrai flow OAuth existant
// (beginEmoteAuthorization, fourni par l'hôte). Le compte lié → l'hôte ne crée plus ni source ni fenêtre.
// `reauth` : Twitch ne reconnaît plus l'accès (révoqué / invalide) → « Reconnexion Twitch nécessaire ».

const TWITCH_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3 3.5 6.5V19h4v2.5h2.5L12.5 19H16l4.5-4.5V3H5Zm13.5 10.5L16 16h-4l-2.5 2.5V16H6V5h12.5v8.5Z"/><path d="M14.5 7.5h2v5h-2zM10 7.5h2v5h-2z"/></svg>';

const icon = (document) => {
  const node = document.createElement('span');
  node.className = 'rl-twitch-src__icon';
  node.innerHTML = TWITCH_ICON;
  return node;
};

/** Source « Twitch · non lié » de la colonne latérale. */
export function createTwitchEmoteSource({ document, open, onOpen, reauth = false }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `rl-twitch-src${reauth ? ' rl-twitch-src--reauth' : ''}`;
  button.title = reauth ? 'Reconnexion Twitch nécessaire' : 'Emotes Twitch · compte non lié';
  button.setAttribute('aria-label', reauth ? 'Emotes Twitch · reconnexion nécessaire' : 'Emotes Twitch · lier mon compte');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', String(open));
  const lock = document.createElement('span');
  lock.className = 'rl-twitch-src__state';
  lock.setAttribute('aria-hidden', 'true');
  lock.textContent = reauth ? '↻' : '!';
  button.append(icon(document), lock);
  button.addEventListener('click', onOpen);
  return button;
}

/** Fenêtre « Lie ton compte Twitch » ; `starting` = le flow OAuth est déjà en cours d'ouverture. */
export function createTwitchEmoteDialog({ document, starting, onAuthorize, onClose, reauth = false }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'rl-twitch-link';
  const card = document.createElement('div');
  card.className = 'rl-twitch-link__card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'rl-twitch-link-title');
  const title = document.createElement('p');
  title.className = 'rl-twitch-link__title';
  title.id = 'rl-twitch-link-title';
  title.append(icon(document), reauth ? 'Reconnexion Twitch nécessaire' : 'Emotes Twitch');
  const text = document.createElement('p');
  text.className = 'rl-twitch-link__text';
  text.textContent = reauth
    ? 'Twitch ne reconnaît plus l’accès à tes emotes. Reconnecte ton compte pour les retrouver.'
    : 'Lie ton compte Twitch pour récupérer tes emotes personnelles et abonnements.';
  const actions = document.createElement('div');
  actions.className = 'rl-twitch-link__actions';
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'rl-twitch-link__btn';
  later.textContent = 'Plus tard';
  later.addEventListener('click', onClose);
  const authorize = document.createElement('button');
  authorize.type = 'button';
  authorize.className = 'rl-twitch-link__btn rl-twitch-link__btn--primary';
  authorize.textContent = starting ? 'Ouverture Twitch…' : reauth ? 'Reconnecter Twitch' : 'Autoriser Twitch';
  authorize.disabled = Boolean(starting);
  // Clic direct : le geste utilisateur est conservé pour la fenêtre Twitch du flow OAuth.
  authorize.addEventListener('click', onAuthorize);
  actions.append(later, authorize);
  card.append(title, text, actions);
  backdrop.append(card);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) onClose();
  });
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  });
  return { node: backdrop, focus: () => (authorize.disabled ? later : authorize).focus({ preventScroll: true }) };
}
