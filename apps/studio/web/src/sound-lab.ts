// Soundboard V2 Lab panel: status, the local player (embedded, needs one click to enable audio)
// and the Core history. The player keeps running while this page stays open.
/** `production`: the same card for the Production profile (Studio tab), without Lab wording. */
export function mountSoundLab(
  root: HTMLElement,
  options: { production?: boolean } = {},
) {
  const panel = document.createElement('section');
  panel.className = 'xlab-card';
  panel.innerHTML = `${
    options.production
      ? '<h3>Soundboard — lecteur (Production)</h3><p>Core de production → Studio → lecteur local (jeton du profil Production). Paiement réel au Wallet Raptoru du Core (Jetons ou crédits Soundboard, remboursés une seule fois si le son n’est pas joué) ; les récompenses Points de chaîne sont payées sur Twitch.</p>'
      : '<h3>Soundboard Lab</h3><p>Extension → Core → Studio → lecteur local. Coût simulé, aucun débit ni progression.</p>'
  }
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
        : (s.error ??
          (s.ready
            ? 'Prêt · les sons passent par Core et sont joués ici'
            : 'Lecteur en attente : active le son ci-dessous'));
      const frame = el<HTMLIFrameElement>('player');
      // Loaded once: reloading would drop the audio permission and the playing sound.
      if (s.enabled && !frame.src) frame.src = s.playerUrl;
      el('history').replaceChildren();
      for (const i of (s.interactions ?? []).slice(0, 10)) {
        const li = document.createElement('li');
        li.textContent = `#${i.channel_sequence} ${i.viewer_display_name} · ${i.sound_label} — ${i.status}${i.error ? ' · ' + i.error.code : ''}`;
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
