import {
  type VotekickLaunchSound,
  type VotekickSettings,
  type VotekickUi,
  votekickConfigView,
  votekickError,
} from './votekick-config-view.js';

// Votekick — the settings section of the « Points de chaîne » tab: vote length (saved in Core) and launch sound (saved
// in Studio). Loaded when the tab opens, never refreshed under the user's hands; « Enregistrer » sends both and shows
// what was read back. The preview plays here only (Studio's window), never in the stream.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

export function mountVotekickConfig(root: HTMLElement) {
  let state: VotekickSettings | null = null;
  let draft: VotekickLaunchSound | null = null;
  const ui: VotekickUi = { error: null, notice: null, busy: false };
  let preview: HTMLAudioElement | null = null;

  /** Re-drawn with the length being typed kept (a sound change or an import never resets it). */
  const render = () => {
    const typed = (
      form()?.elements.namedItem('vote_seconds') as HTMLInputElement | null
    )?.value;
    root.innerHTML = votekickConfigView(state, ui, draft);
    const input = form()?.elements.namedItem(
      'vote_seconds',
    ) as HTMLInputElement | null;
    if (input && typed !== undefined && !input.disabled) input.value = typed;
  };
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`/api/votekick${path}`, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(votekickError(body.error ?? `HTTP ${res.status}`));
    return body;
  };
  const form = () =>
    root.querySelector<HTMLFormElement>('[data-role="vk-form"]');
  /** The launch sound as the form shows it. */
  const fromForm = (): VotekickLaunchSound => {
    const f = form()!;
    const sound =
      (f.elements.namedItem('sound') as HTMLSelectElement).value || null;
    return {
      enabled: (f.elements.namedItem('enabled') as HTMLInputElement).checked,
      sound,
      sound_name: sound?.startsWith('upload:')
        ? ((draft?.sound === sound
            ? draft.sound_name
            : state?.launch_sound?.sound_name) ?? null)
        : null,
      volume: Number(
        (f.elements.namedItem('volume') as HTMLInputElement).value,
      ),
    };
  };

  const load = async () => {
    try {
      state = await call('/settings', { headers: HEADERS });
      draft = null;
      ui.error = null;
    } catch (e) {
      ui.error = `Réglages Votekick indisponibles : ${(e as Error).message}`;
    }
    render();
  };

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'volume') {
      const out = form()?.elements.namedItem(
        'volume_out',
      ) as HTMLOutputElement | null;
      if (out) out.value = t.value;
      if (preview) preview.volume = Number(t.value) / 100;
    }
  });
  root.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'sound') {
      draft = fromForm();
      render();
    }
    if (t.name !== 'file' || !t.files?.[0]) return;
    const file = t.files[0];
    const keep = fromForm();
    ui.busy = true;
    ui.notice = null;
    ui.error = null;
    render();
    try {
      const up = await call('/sounds', {
        method: 'POST',
        headers: {
          'x-raptoru-studio': '1',
          'content-type': 'application/octet-stream',
          'x-sound-name': encodeURIComponent(file.name),
        },
        body: file,
      });
      draft = { ...keep, sound: up.id, sound_name: up.name };
      ui.notice = `« ${up.name} » importé : enregistre pour l’utiliser.`;
    } catch (err) {
      draft = keep;
      ui.error = (err as Error).message;
    }
    ui.busy = false;
    render();
  });
  root.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-act="vk-preview"]')) return;
    const { sound, volume } = fromForm();
    preview?.pause();
    if (!sound) return;
    preview = new Audio(`/effects/media/${sound}`);
    preview.volume = volume / 100;
    preview.play().catch(() => {
      ui.error = 'Pré-écoute impossible (fichier absent ?).';
      render();
    });
  });
  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form()!;
    const seconds = f.elements.namedItem('vote_seconds') as HTMLInputElement;
    const body: Record<string, unknown> = { launch_sound: fromForm() };
    if (state?.available) body.vote_seconds = Number(seconds.value);
    ui.busy = true;
    ui.error = null;
    ui.notice = null;
    render();
    try {
      state = await call('/settings', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
      });
      draft = null;
      ui.notice = 'Enregistré';
    } catch (err) {
      draft = body.launch_sound as VotekickLaunchSound;
      ui.error = (err as Error).message;
    }
    ui.busy = false;
    render();
  });
  return { load };
}
