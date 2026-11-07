// The Lab's Soundboard player, in the Extension Lab: status, the local player (embedded, needs one click to enable audio) and the
// history. It keeps running while Studio stays open; a second player would double the sounds.
import { statusError } from './http.js';

const statusErrorOf = (e: string | null | undefined) =>
  e ? statusError(e) : undefined;

export function mountSoundLab(root: HTMLElement) {
  const panel = document.createElement('section');
  panel.className = 'xl-card';
  panel.innerHTML = `<h3>Soundboard</h3><p>Le lecteur du Lab : coût simulé, aucun débit ni progression.</p>
    <p data-sound="status">Lecture du statut…</p>
    <div data-sound="player-box" hidden>
      <iframe data-sound="player" title="Lecteur Soundboard" style="width:100%;height:52px;border:0;border-radius:8px"></iframe>
      <p>Clique sur « Activer le son » dans le lecteur : les sons du Soundboard sont joués ici, sur la sortie audio par défaut du PC.</p>
    </div>
    <ol data-sound="history"></ol>`;
  root.prepend(panel);
  const el = <T extends HTMLElement>(key: string) =>
    panel.querySelector<T>(`[data-sound="${key}"]`)!;
  const refresh = async () => {
    try {
      const r = await fetch('/api/sound-lab/status', {
        headers: { 'x-raptoru-studio': '1' },
      });
      const s = await r.json();
      el('player-box').hidden = !s.enabled;
      el('status').textContent = !s.enabled
        ? 'Non lancé. Utilise npm run bonk:lab depuis le dépôt.'
        : (statusErrorOf(s.error) ??
          (s.ready
            ? 'Prêt · les sons passent par le serveur et sont joués ici'
            : 'Lecteur en attente : active le son ci-dessous'));
      const frame = el<HTMLIFrameElement>('player');
      // Loaded once: reloading would drop the audio permission and the playing sound.
      if (s.enabled && !frame.src) frame.src = s.playerUrl;
      el('history').replaceChildren();
      for (const i of (s.interactions ?? []).slice(0, 10)) {
        const li = document.createElement('li');
        li.textContent = `#${i.channel_sequence} ${i.viewer_display_name} · ${i.sound_label} · ${i.status}${i.error ? ' · ' + i.error.code : ''}`;
        el('history').append(li);
      }
    } catch {
      el('status').textContent = 'Studio indisponible';
    }
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    setVisible(visible: boolean) {
      clearInterval(timer);
      if (visible) {
        void refresh();
        timer = setInterval(() => void refresh(), 2000);
      }
    },
  };
}
