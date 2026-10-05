/** `production`: the same card for the Production profile (Studio tab), without Lab wording. */
export function mountBonkLab(
  root: HTMLElement,
  options: { production?: boolean } = {},
) {
  const panel = document.createElement('section');
  panel.className = 'xlab-card';
  panel.innerHTML = `${
    options.production
      ? '<h3>Bonk — overlay OBS (Production)</h3><p>Overlay servi par Studio avec le jeton du profil Production (différent de celui du Lab). Paiement encore simulé.</p>'
      : '<h3>Bonk OBS Lab</h3><p>Une Twemoji · coût simulé, aucun débit ni progression. Impact au point 960 × 400 dans une source 1920 × 1080.</p>'
  }
    <p data-bonk="status">Lecture du statut…</p>
    <div data-bonk="controls" hidden><label>Port OBS <input data-bonk="port" type="number" value="4455"></label>
    <label>Mot de passe OBS <input data-bonk="password" type="password" autocomplete="off"></label>
    <button data-bonk="connect" type="button">Connecter OBS local</button><button data-bonk="disconnect" type="button">Déconnecter</button>
    <p>Dans une scène de test OBS, ajoute (ou mets à jour) une source navigateur nommée exactement <strong>Raptoru Bonk Lab</strong>${options.production ? ' (nom historique, à garder tel quel)' : ''}, 1920 × 1080, avec cette URL :</p>
    <p><input data-bonk="url" readonly aria-label="URL de la source OBS Bonk" style="width:100%"> <button type="button" data-bonk="copy">Copier</button></p>
    <p>La source doit rester active. Ne l’ajoute pas à la scène diffusée.${options.production ? ' L’URL change avec le profil : remets celle-ci après un changement de profil.' : ' Sélectionne 😀 dans Bonk à gauche.'}</p></div><ol data-bonk="history"></ol>`;
  root.prepend(panel);
  const el = <T extends HTMLElement>(key: string) =>
    panel.querySelector<T>(`[data-bonk="${key}"]`)!;
  const call = async (path: string, body?: unknown) => {
    const r = await fetch('/api/bonk-lab/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error ?? 'indisponible');
    return result;
  };
  el('connect').addEventListener('click', () => {
    const password = el<HTMLInputElement>('password').value;
    el<HTMLInputElement>('password').value = '';
    void call('connect', {
      port: Number(el<HTMLInputElement>('port').value),
      password,
    }).catch((e) => {
      el('status').textContent = String(e.message);
    });
  });
  el('disconnect').addEventListener('click', () => void call('disconnect', {}));
  el('copy').addEventListener('click', () => {
    void navigator.clipboard
      ?.writeText(el<HTMLInputElement>('url').value)
      .catch(() => {});
  });
  const refresh = async () => {
    try {
      const s = await call('status');
      el('controls').hidden = !s.enabled;
      el('status').textContent = !s.enabled
        ? 'Non lancé. Utilise npm run bonk:lab depuis le dépôt.'
        : (s.error ??
          (s.ready
            ? 'Prêt · les clics Bonk passent par Core et OBS'
            : s.obs
              ? 'OBS connecté · en attente de la source et du renderer'
              : 'OBS déconnecté'));
      if (s.enabled) el<HTMLInputElement>('url').value = s.overlayUrl;
      el('history').replaceChildren();
      for (const i of (s.interactions ?? []).slice(0, 12)) {
        const li = document.createElement('li');
        li.textContent = `#${i.channel_sequence} ${i.viewer_display_name} — ${i.status}${i.error ? ' · ' + i.error.code : ''}`;
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
