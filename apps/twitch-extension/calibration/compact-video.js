// Profil « compact-video » — PROTOTYPE, build de calibration seulement (non validé). Complète
// calibration/compact-video.css là où le CSS seul ne suffit pas, sans toucher au code de l'extension :
// - bandeau (.cv-marquee) sur les textes d'une ligne qui débordent réellement (mesure du débordement ;
//   le CSS ne le fait défiler qu'au survol / focus) ;
// - Bonk : Twitch comme source de la colonne latérale + petite fenêtre d'autorisation.
// Actif seulement dans la fenêtre du profil ; tout est retiré en dehors.
const doc = document;
const win = window;
const COMPACT = win.matchMedia(
  '(min-width: 521px) and (min-height: 321px) and (max-height: 400px)',
);

// Textes d'une ligne qu'il faut pouvoir lire en entier.
const MARQUEE = ['.sbx-card__name', '.tmbx .row .name'];
const SPEED = 45; // px/s pendant le défilement (40 % de la boucle, aller seul).

function clearMarquee(node) {
  node.classList.remove('cv-marquee');
  node.style.removeProperty('--mq-d');
  node.style.removeProperty('--mq-t');
  delete node.dataset.mqText;
}

function marquee(node) {
  const text = node.textContent;
  if (node.dataset.mqText === text) return;
  clearMarquee(node);
  node.dataset.mqText = text;
  const overflow = node.scrollWidth - node.clientWidth;
  if (overflow <= 1) return;
  const distance = overflow + 6;
  node.style.setProperty('--mq-d', `${distance}px`);
  node.style.setProperty(
    '--mq-t',
    `${Math.max(2.8, distance / SPEED / 0.4).toFixed(2)}s`,
  );
  node.classList.add('cv-marquee');
}

// --- Bonk : Twitch comme source de la colonne latérale (au lieu du bandeau permanent) -----------------
// Le vrai bouton « Autoriser mes emotes Twitch » reste dans le DOM (masqué par le CSS) : la fenêtre
// ne fait que le déclencher, avec son vrai gestionnaire. Compte lié → le bouton disparaît, la source
// et la fenêtre aussi.
const BONK = '.jdm-module[data-module="bonk"]';
const TWITCH_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3 3.5 6.5V19h4v2.5h2.5L12.5 19H16l4.5-4.5V3H5Zm13.5 10.5L16 16h-4l-2.5 2.5V16H6V5h12.5v8.5Z"/><path d="M14.5 7.5h2v5h-2zM10 7.5h2v5h-2z"/></svg>';
let modal = null;
let modalOpener = null;

function closeModal() {
  if (!modal) return;
  modal.remove();
  modal = null;
  modalOpener?.focus?.({ preventScroll: true });
  modalOpener = null;
}

function openTwitchModal(opener) {
  closeModal();
  modalOpener = opener;
  modal = doc.createElement('div');
  modal.className = 'cv-modal';
  modal.innerHTML = `<div class="cv-modal__card" role="dialog" aria-modal="true" aria-labelledby="cv-twitch-title">
    <p class="cv-modal__title" id="cv-twitch-title"><span class="cv-twitch-src__icon">${TWITCH_ICON}</span>Emotes Twitch</p>
    <p class="cv-modal__text">Lie ton compte Twitch pour récupérer tes emotes personnelles et abonnements.</p>
    <div class="cv-modal__actions"><button type="button" class="cv-modal__btn" data-cv="later">Plus tard</button>
    <button type="button" class="cv-modal__btn cv-modal__btn--primary" data-cv="authorize">Autoriser Twitch</button></div></div>`;
  modal.addEventListener('click', (event) => {
    const action = event.target.closest('[data-cv]')?.dataset.cv;
    if (action === 'authorize') {
      // Geste utilisateur conservé : le vrai gestionnaire ouvre la fenêtre Twitch.
      doc.querySelector(`${BONK} .jdm-emote-connect`)?.click();
      closeModal();
    } else if (action === 'later' || event.target === modal) closeModal();
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
  doc.body.append(modal);
  modal.querySelector('[data-cv="authorize"]').focus({ preventScroll: true });
}

function twitchSource() {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'cv-twitch-src';
  button.title = 'Emotes Twitch · compte non lié';
  button.setAttribute('aria-label', 'Emotes Twitch · lier mon compte');
  button.setAttribute('aria-haspopup', 'dialog');
  button.innerHTML = `<span class="cv-twitch-src__icon">${TWITCH_ICON}</span><span class="cv-twitch-src__lock" aria-hidden="true">!</span>`;
  button.addEventListener('click', () => openTwitchModal(button));
  return button;
}

function syncBonk() {
  const connect = doc.querySelector(`${BONK} .jdm-emote-connect`);
  const nav = doc.querySelector(`${BONK} .rl-picker__nav`);
  const source = doc.querySelector('.cv-twitch-src');
  if (COMPACT.matches && connect && nav) {
    if (source?.parentElement !== nav) {
      source?.remove();
      nav.prepend(twitchSource());
    }
    return;
  }
  source?.remove();
  if (!connect) closeModal();
}

let frame = 0;
function scan() {
  frame = 0;
  syncBonk();
  const nodes = doc.querySelectorAll(MARQUEE.join(','));
  for (const node of nodes) {
    if (COMPACT.matches) marquee(node);
    else if (node.dataset.mqText !== undefined) clearMarquee(node);
  }
}
const schedule = () => {
  if (!frame) frame = win.requestAnimationFrame(scan);
};
// Taille changée : tout est remesuré.
const remeasure = () => {
  for (const node of doc.querySelectorAll('[data-mq-text]')) clearMarquee(node);
  schedule();
};

new win.MutationObserver(schedule).observe(doc.body, {
  childList: true,
  subtree: true,
  characterData: true,
});
win.addEventListener('resize', remeasure);
COMPACT.addEventListener?.('change', remeasure);
schedule();
