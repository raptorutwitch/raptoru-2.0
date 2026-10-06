// TTS V2 Lab panel: module state, OBS player, queue (count + estimated duration), current TTS and
// the streamer's moderation primitives (Core API). One player page at a time: the OBS browser
// source, or the preview below (loaded only on demand, so it never steals OBS's slot).
type Interaction = {
  interaction_id: string;
  viewer_display_name: string;
  message: string;
  status: string;
  refund_status: string;
  estimated_duration_ms: number;
  simulated_cost: number;
  payment_method: string;
  cast: { character_id: string; voice_profile_id: string };
  error: { code: string } | null;
  channel_sequence: number;
};
type Status = {
  enabled: boolean;
  ready?: boolean;
  player?: { voices: number; seen_ms_ago: number } | null;
  module_state?: 'active' | 'paused' | 'disabled';
  overlayUrl?: string;
  previewUrl?: string;
  error?: string | null;
  queue?: {
    current: Interaction | null;
    waiting: Interaction[];
    wait_ms: number;
    recent: Interaction[];
    queue_full: boolean;
  } | null;
};

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
const secs = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s >= 60
    ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
    : `${s} s`;
};
const STATE: Record<string, string> = {
  active: 'Actif',
  paused: 'En pause',
  disabled: 'Désactivé',
};

/**
 * `production`: the same card for the Production profile (Studio tab), without Lab wording and without
 * the Lab moderation controls (pause / stop / purge: the « Modération » tab, on the same Core in Production).
 */
export function mountTtsLab(
  root: HTMLElement,
  options: { production?: boolean } = {},
) {
  const panel = document.createElement('section');
  panel.className = 'xlab-card';
  panel.innerHTML = `${
    options.production
      ? '<h3>TTS — source OBS (Production)</h3><p>Core de production → Studio → lecteur OBS (jeton du profil Production). Paiement encore simulé.</p>'
      : '<h3>TTS V2 Lab</h3><p>Extension → Core → Studio → lecteur OBS. Coût simulé, remboursé si le message n’est jamais lu.</p>'
  }
    <p data-tts="status">Lecture du statut…</p>
    <div data-tts="box" hidden>
      <p><b>Source OBS</b> (navigateur, 1920×1080, fond transparent) :</p>
      <p><input data-tts="overlay" readonly style="width:100%" aria-label="URL de la source OBS TTS"> <button type="button" data-act="copy">Copier</button></p>
      <p class="muted">Un seul lecteur à la fois : la source OBS, ou l’aperçu ci-dessous.</p>
      <div class="actions">
        ${
          options.production
            ? ''
            : `<button type="button" data-act="pause">Pause</button>
        <button type="button" data-act="resume">Reprendre</button>
        <button type="button" data-act="stop">Stop (rembourser)</button>
        <button type="button" data-act="purge">Vider la file (rembourser)</button>`
        }
        <button type="button" data-act="preview">Aperçu ici</button>
      </div>
      ${options.production ? '<p class="muted">Pause, stop et file : onglet « Modération » (même Core, profil Production).</p>' : ''}
      <div data-tts="preview-box" hidden style="position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:8px">
        <iframe data-tts="preview" title="Aperçu du lecteur TTS" style="position:absolute;left:0;top:0;width:1920px;height:1080px;border:0;transform-origin:0 0"></iframe>
      </div>
      <p data-tts="current"></p>
      <ol data-tts="queue"></ol>
      <details><summary>Historique</summary><ol data-tts="history"></ol></details>
    </div>`;
  root.prepend(panel);
  const el = <T extends HTMLElement>(key: string) =>
    panel.querySelector<T>(`[data-tts="${key}"]`)!;
  let last: Status | null = null;

  const moderate = async (body: Record<string, unknown>) => {
    await fetch('/api/tts-lab/moderation', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ actor: 'studio', ...body }),
    }).catch(() => {});
    void refresh();
  };
  panel.addEventListener('click', (ev) => {
    const act = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]')
      ?.dataset.act;
    if (act === 'pause' || act === 'resume') void moderate({ action: act });
    else if (act === 'stop')
      void moderate({ action: 'stop_current', refund: true });
    else if (act === 'purge') void moderate({ action: 'purge', refund: true });
    else if (act === 'copy') {
      const input = el<HTMLInputElement>('overlay');
      input.select();
      void navigator.clipboard?.writeText(input.value).catch(() => {});
    } else if (act === 'preview' && last?.previewUrl) {
      el('preview-box').hidden = false;
      const frame = el<HTMLIFrameElement>('preview');
      if (!frame.src) frame.src = last.previewUrl;
      fit();
    }
  });
  const fit = () => {
    const box = el('preview-box');
    el<HTMLIFrameElement>('preview').style.transform =
      `scale(${box.clientWidth / 1920})`;
  };
  addEventListener('resize', fit);

  const line = (i: Interaction) =>
    `#${i.channel_sequence} ${esc(i.viewer_display_name)} · ${esc(i.cast.character_id)} (${esc(i.cast.voice_profile_id)}) · ${secs(i.estimated_duration_ms)} — ${esc(i.status)}${i.refund_status === 'refunded' ? ' · remboursé' : ''}${i.error ? ' · ' + esc(i.error.code) : ''}`;

  async function refresh() {
    try {
      const r = await fetch('/api/tts-lab/status', { headers: HEADERS });
      const s = (await r.json()) as Status;
      last = s;
      el('box').hidden = !s.enabled;
      if (!s.enabled) {
        el('status').textContent =
          'Non lancé : le runtime local du Studio ne tourne pas.';
        return;
      }
      const player = s.ready
        ? `lecteur prêt (${s.player?.voices ?? 0} voix)`
        : s.player && s.player.seen_ms_ago < 5000
          ? 'lecteur sans voix Web Speech'
          : 'lecteur absent : ajoute la source OBS ou ouvre l’aperçu';
      el('status').textContent = s.error
        ? `Erreur : ${s.error}`
        : `Module ${STATE[s.module_state ?? 'active']} · ${player}`;
      const overlay = el<HTMLInputElement>('overlay');
      if (overlay.value !== s.overlayUrl) overlay.value = s.overlayUrl ?? '';
      const q = s.queue;
      el('current').innerHTML = q?.current
        ? `<b>En cours :</b> ${line(q.current)}<br><i>« ${esc(q.current.message.slice(0, 140))} »</i>`
        : '<span class="muted">Aucun TTS en cours.</span>';
      el('queue').innerHTML = (q?.waiting ?? [])
        .map((i) => `<li>${line(i)}</li>`)
        .join('');
      el('history').innerHTML = (q?.recent ?? [])
        .map((i) => `<li>${line(i)}</li>`)
        .join('');
      el('status').textContent += q
        ? ` · file : ${q.waiting.length} en attente (≈ ${secs(q.wait_ms)})${q.queue_full ? ', pleine' : ''}`
        : '';
    } catch {
      el('status').textContent = 'Studio indisponible';
    }
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    setVisible(visible: boolean) {
      clearInterval(timer);
      if (visible) {
        void refresh();
        timer = setInterval(() => void refresh(), 2000);
        requestAnimationFrame(fit);
      }
    },
  };
}
