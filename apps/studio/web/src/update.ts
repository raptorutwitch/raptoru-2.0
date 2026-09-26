// Auto-update widget in the top bar. `window.raptoruStudio` only exists inside the packaged/dev
// Electron shell (exposed by the preload script): opening the same page in a plain browser (see
// README) simply hides this widget instead of throwing.

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported';

interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  percent: number | null;
  message: string | null;
}

interface RaptoruStudioUpdateApi {
  getState(): Promise<UpdateState>;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  onState(callback: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window {
    raptoruStudio?: { update: RaptoruStudioUpdateApi };
  }
}

export function mountUpdateWidget(root: HTMLElement): void {
  const api = window.raptoruStudio?.update;
  if (!api) {
    root.hidden = true;
    return;
  }

  root.innerHTML = `
    <span class="update-version">Raptoru Studio <strong data-current></strong></span>
    <button type="button" class="update-btn" data-action="check">Rechercher une mise à jour</button>
    <span class="update-status" data-status hidden></span>`;

  const currentEl = root.querySelector<HTMLElement>('[data-current]')!;
  const checkBtn = root.querySelector<HTMLButtonElement>(
    '[data-action="check"]',
  )!;
  const statusEl = root.querySelector<HTMLElement>('[data-status]')!;

  function actionButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'update-btn primary';
    button.textContent = label;
    button.addEventListener('click', () => {
      button.disabled = true;
      onClick();
    });
    return button;
  }

  function render(state: UpdateState): void {
    currentEl.textContent = state.currentVersion;
    checkBtn.disabled =
      state.status === 'checking' || state.status === 'downloading';
    statusEl.replaceChildren();
    statusEl.hidden = false;
    statusEl.classList.remove('error');
    switch (state.status) {
      case 'idle':
        statusEl.hidden = true;
        break;
      case 'checking':
        statusEl.textContent = 'Recherche…';
        break;
      case 'not-available':
        statusEl.textContent = 'À jour.';
        break;
      case 'unsupported':
        statusEl.textContent = state.message ?? 'Mise à jour indisponible.';
        break;
      case 'error':
        statusEl.classList.add('error');
        statusEl.textContent = `Erreur de mise à jour : ${state.message ?? 'inconnue'}`;
        break;
      case 'available':
        statusEl.append(
          document.createTextNode(`Nouvelle version : ${state.latestVersion} `),
          actionButton('Mettre à jour', () => void api!.download()),
        );
        break;
      case 'downloading':
        statusEl.textContent = `Téléchargement… ${state.percent ?? 0} %`;
        break;
      case 'downloaded':
        statusEl.append(
          document.createTextNode(`Version ${state.latestVersion} prête. `),
          actionButton('Redémarrer et installer', () => void api!.install()),
        );
        break;
    }
  }

  checkBtn.addEventListener('click', () => void api.check());
  api.onState(render);
  void api.getState().then(render);
}
