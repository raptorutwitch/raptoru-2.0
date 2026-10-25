import { mountBonkTarget } from './bonk-target.js';

const obsText = (code: string) =>
  code === 'obs_auth_failed'
    ? 'Mot de passe OBS refusé : reconnecte OBS avec le bon mot de passe'
    : code === 'invalid_obs_port'
      ? 'Port OBS invalide'
      : code;

/** `production`: the same card for the Production profile (Studio tab), without Lab wording. */
export function mountBonkLab(
  root: HTMLElement,
  options: { production?: boolean } = {},
) {
  const panel = document.createElement('section');
  panel.className = 'xlab-card';
  panel.innerHTML = `${
    options.production
      ? '<h3>Bonk — overlay OBS (Production)</h3><p>Overlay servi par Studio avec le jeton du profil Production (différent de celui du Lab). Paiement réel en Jetons au Wallet Raptoru du Core, remboursé une seule fois si le Bonk n’est pas joué.</p>'
      : '<h3>Bonk OBS Lab</h3><p>Coût simulé, aucun débit ni progression. Impacts autour de la cible réglée ci-dessous, dans une source 1920 × 1080.</p>'
  }
    <p data-bonk="status">Lecture du statut…</p>
    <div data-bonk="controls" hidden><label>Port OBS <input data-bonk="port" type="number" value="4455"></label>
    <label>Mot de passe OBS <input data-bonk="password" type="password" autocomplete="off"></label>
    <button data-bonk="connect" type="button">Connecter OBS local</button><button data-bonk="disconnect" type="button">Déconnecter</button>
    <p>Dans une scène de test OBS, ajoute (ou mets à jour) une source navigateur nommée exactement <strong>Raptoru Bonk Lab</strong>${options.production ? ' (nom historique, à garder tel quel)' : ''}, 1920 × 1080, avec cette URL :</p>
    <p><input data-bonk="url" readonly aria-label="URL de la source OBS Bonk" style="width:100%"> <button type="button" data-bonk="copy">Copier</button></p>
    <p>La source doit rester active. Ne l’ajoute pas à la scène diffusée.${options.production ? ' L’URL change avec le profil : remets celle-ci après un changement de profil.' : ' Sélectionne 😀 dans Bonk à gauche.'}</p>
    <p>Tester le rendu (aperçu local : ni Core, ni paiement, ni historique) :
    <button type="button" data-bonk-test="1">1 Bonk</button> <button type="button" data-bonk-test="5">Rafale de 5</button> <button type="button" data-bonk-test="10">Salve de 10</button>
    ${options.production ? '<br><small>Visible en direct si la source Bonk est dans la scène diffusée.</small>' : ''}</p></div><ol data-bonk="history"></ol>`;
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
  // Zone / Fullscreen editor (lot 2): local draft, applied to the overlay only on « Enregistrer ».
  mountBonkTarget(el('controls'), call);
  // Inside Raptoru Studio (Electron), main remembers the connection, password encrypted by the OS,
  // and restores it at each start. Without it (bonk:lab in a browser): memory only, as before.
  const bridge = (
    window as unknown as {
      raptoruStudio?: {
        obs?: {
          connect(
            port: number,
            password: string,
          ): Promise<{ ok?: boolean; error?: string; remembered?: boolean }>;
          forget(): Promise<unknown>;
          remembered(): Promise<{ port: number | null }>;
        };
      };
    }
  ).raptoruStudio?.obs;
  let note = '';
  void bridge
    ?.remembered()
    .then(({ port }) => {
      if (port) el<HTMLInputElement>('port').value = String(port);
    })
    .catch(() => {});
  el('connect').addEventListener('click', () => {
    const password = el<HTMLInputElement>('password').value;
    el<HTMLInputElement>('password').value = '';
    const port = Number(el<HTMLInputElement>('port').value);
    if (!bridge) {
      void call('connect', { port, password }).catch((e) => {
        el('status').textContent = String(e.message);
      });
      return;
    }
    void bridge.connect(port, password).then(
      (r) => {
        note = r.remembered
          ? 'Connexion OBS mémorisée (mot de passe chiffré par le système).'
          : 'Connexion OBS non mémorisée.';
        if (r.error) el('status').textContent = obsText(r.error);
      },
      (e: Error) => {
        el('status').textContent = String(e.message);
      },
    );
  });
  el('disconnect').addEventListener('click', () => {
    note = '';
    void (bridge ? bridge.forget() : call('disconnect', {}));
  });
  for (const button of panel.querySelectorAll<HTMLButtonElement>(
    '[data-bonk-test]',
  ))
    button.addEventListener('click', () => {
      void call('preview', { count: Number(button.dataset.bonkTest) }).then(
        () => {
          note = '';
        },
        (e: Error) => {
          note =
            e.message === 'overlay_not_ready'
              ? 'Aperçu impossible : overlay OBS pas prêt.'
              : `Aperçu impossible : ${e.message}`;
        },
      );
    });
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
                : s.obs_reconnecting
                  ? 'Reconnexion à OBS…'
                  : s.obs_error
                    ? obsText(s.obs_error)
                    : 'OBS déconnecté')) + (note ? ` · ${note}` : '');
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
