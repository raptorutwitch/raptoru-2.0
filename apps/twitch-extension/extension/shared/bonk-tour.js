// Tutoriel Bonk : bulles successives (une info par bulle) sur la vraie interface. Même carte que le
// tutoriel global (classes jdm-tour__*), toujours centrée et de hauteur stable (Suivant ne bouge jamais) ;
// seule la mise en avant de la zone concernée se déplace (le reste est assombri). L'overlay vit dans <body> : le rendu de l'extension (polling) peut reconstruire le module,
// la cible est relue à chaque frame par son sélecteur.


/**
 * @param {{
 *   document: Document,
 *   steps: () => {icon: string, title: string, body: string, target?: () => Element|null,
 *     action?: {label: string, run: () => void}}[],
 *   isDisabled: () => boolean,
 *   setDisabled: (disabled: boolean) => void,
 *   onOpenChange?: (open: boolean) => void,
 * }} deps `steps` est relu à chaque bulle (l'état Twitch peut changer pendant le tutoriel).
 */
export function createBonkTour({ document, steps, isDisabled, setDisabled, onOpenChange = () => {} }) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const view = document.defaultView;
  let overlay = null;
  let hole = null;
  let card = null;
  let index = 0;
  let frame = 0;
  let current = null;

  function close() {
    if (!overlay) return;
    view.cancelAnimationFrame(frame);
    overlay.remove();
    overlay = hole = card = current = null;
    document.removeEventListener('keydown', onKey, true);
    onOpenChange(false);
  }
  function onKey(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  }

  function renderStep() {
    const list = steps();
    index = Math.min(Math.max(0, index), list.length - 1);
    current = list[index];
    const last = index === list.length - 1;
    card.replaceChildren();

    const top = make('div', 'jdm-tour__top');
    const skip = make('button', 'jdm-tour__skip', 'Passer');
    skip.type = 'button';
    skip.addEventListener('click', close);
    top.append(make('span', 'jdm-tour__count', `${index + 1}/${list.length}`), skip);

    const heading = make('div', 'jdm-tour__heading');
    const icon = make('span', 'jdm-tour__icon', current.icon);
    icon.setAttribute('aria-hidden', 'true');
    const title = make('h2', 'jdm-tour__title', current.title);
    title.id = 'bkt-title';
    const headingCopy = make('div', 'jdm-tour__heading-copy');
    headingCopy.append(title);
    heading.append(icon, headingCopy);
    card.append(top, heading);
    // **mot** = mis en valeur (gras, couleur) ; nœuds texte uniquement, jamais de HTML.
    for (const line of [current.body].flat()) {
      const copy = make('p', 'jdm-tour__copy');
      line.split(/\*\*(.+?)\*\*/).forEach((part, i) => {
        if (part) copy.append(i % 2 ? make('strong', 'bkt__em', part) : part);
      });
      card.append(copy);
    }

    if (current.action) {
      const action = make('button', 'jdm-btn jdm-btn--primary bkt__action', current.action.label);
      action.type = 'button';
      action.addEventListener('click', () => {
        const run = current.action.run;
        close();
        run();
      });
      card.append(action);
    }

    const dots = make('div', 'jdm-tour__dots');
    dots.setAttribute('aria-hidden', 'true');
    for (let dot = 0; dot < list.length; dot += 1) {
      const marker = make('span', 'jdm-tour__dot');
      if (dot === index) marker.classList.add('is-active');
      dots.append(marker);
    }
    card.append(dots);

    if (last) {
      const remember = make('label', 'jdm-tour__remember');
      const input = make('input');
      input.type = 'checkbox';
      input.checked = isDisabled();
      input.addEventListener('change', () => setDisabled(input.checked));
      remember.append(input, make('span', null, 'Ne plus afficher ce tutoriel automatiquement'));
      card.append(remember);
    }

    const controls = make('div', 'jdm-tour__controls');
    const previous = make('button', 'jdm-btn', 'Précédent');
    previous.type = 'button';
    previous.disabled = index === 0;
    previous.addEventListener('click', () => {
      index -= 1;
      renderStep();
    });
    const next = make('button', 'jdm-btn jdm-btn--primary', last ? 'Terminer' : 'Suivant');
    next.type = 'button';
    next.addEventListener('click', () => {
      if (last) return close();
      index += 1;
      renderStep();
    });
    controls.append(previous, next);
    card.append(controls);
    place();
    next.focus({ preventScroll: true });
  }

  /** Spotlight on the target (if visible). The card itself never moves (centred by CSS). */
  function place() {
    if (!overlay) return;
    const vw = view.innerWidth;
    const vh = view.innerHeight;
    const target = current?.target?.() ?? null;
    const r = target?.getBoundingClientRect();
    const shown = r && r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < vh;
    overlay.classList.toggle('has-target', Boolean(shown));
    if (shown) {
      // Soft focus: a generous zone around the target (its rim fades into the dim, cf. CSS), not a tight frame.
      const pad = 14;
      const x = Math.max(0, r.left - pad);
      const y = Math.max(0, r.top - pad);
      const right = Math.min(vw, r.right + pad);
      const bottom = Math.min(vh, r.bottom + pad);
      Object.assign(hole.style, {
        left: `${x}px`, top: `${y}px`, width: `${right - x}px`, height: `${bottom - y}px`,
      });
    }
  }
  function follow() {
    place();
    frame = view.requestAnimationFrame(follow);
  }

  return {
    get open() {
      return Boolean(overlay);
    },
    isDisabled,
    start() {
      if (overlay) return;
      index = 0;
      overlay = make('div', 'bkt');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'bkt-title');
      hole = make('div', 'bkt__hole');
      card = make('section', 'jdm-tour__card bkt__card');
      overlay.append(hole, card);
      // Rien ne sort du tutoriel : les contrôles de la bulle reçoivent leurs événements (ils sont sur la
      // cible), puis l'overlay les arrête ; un appui sur le fond n'a aucun effet par défaut (focus, sélection).
      for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click', 'contextmenu']) {
        overlay.addEventListener(type, (event) => {
          event.stopPropagation();
          if (event.target === overlay && type !== 'click' && event.cancelable) event.preventDefault();
        });
      }
      // Comme le tutoriel global : un clic sur le fond (pas sur la bulle) le ferme. Le fond seul : un bouton
      // de la bulle peut avoir été remplacé entre-temps par l'étape suivante.
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
      });
      document.body.append(overlay);
      document.addEventListener('keydown', onKey, true);
      onOpenChange(true);
      // Hauteur stable : la carte prend celle de l'étape la plus haute (boutons calés en bas, cf. CSS).
      let tallest = 0;
      for (index = 0; index < steps().length; index += 1) {
        renderStep();
        tallest = Math.max(tallest, card.offsetHeight);
      }
      card.style.minHeight = `${tallest}px`;
      index = 0;
      renderStep();
      frame = view.requestAnimationFrame(follow);
    },
    close,
  };
}
