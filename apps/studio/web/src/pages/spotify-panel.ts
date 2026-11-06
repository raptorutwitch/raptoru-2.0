import { esc, fld, grp, hhmm, row } from '../ds/ds.js';
import {
  agoMs,
  minutes,
  trackLabel,
  type SpState,
  type SpUi,
} from './spotify-view.js';

// Spotify, le panneau de réglages (pur, testé) : quotas, exceptions, fin du live, récompense Twitch, connexion, détails techniques
// et simulateur du Lab. Le titre de chaque groupe est son ancre (`data-open`).

/** Le titre de la récompense créée par Raptoru (Antoni, 24/10) : unique sur la chaîne, à la différence de celui de SAMMI. */
export const REWARD_TITLE = 'Choisi la prochaine musique';

/** Les réglages historiques (spotify-v2/config.js). */
export const HISTORICAL = {
  max_pending_per_viewer: 2,
  viewer_cooldown_seconds: 600,
  max_duration_seconds: 600,
  cancel_grace_seconds: 10,
};

/** Ce qui est en cours de saisie, sinon la valeur enregistrée. */
const val = (ui: SpUi, name: string, saved: unknown) =>
  ui.fields[name] ?? saved ?? '';

const fact = (k: string, v: string) => `<dt>${k}</dt><dd>${v}</dd>`;

function quotas(s: SpState, ui: SpUi) {
  const v = s.settings;
  const rule = (
    name: string,
    label: string,
    help: string,
    saved: number,
    attrs: string,
    unit: string,
  ) =>
    `<div class="d-row col" data-k="${esc(`${label} ${help}`.toLowerCase())}"><div class="spo-rule"><span data-scrub>${esc(label)}</span>${fld(`data-f="${name}" ${attrs}`, val(ui, name, saved), unit)}</div><small>${esc(help)}</small></div>`;
  return grp(
    'Quotas',
    'sliders',
    `${rule('set-pending', 'Demandes en attente par viewer', 'Combien de musiques un viewer peut avoir en file en même temps (historique : 2).', v.max_pending_per_viewer, 'min="1" max="10"', '')}
    ${rule('set-cooldown', 'Délai entre deux demandes', 'Compté depuis sa dernière demande encore en file ; il tombe dès qu’elle commence à jouer (historique : 10).', v.viewer_cooldown_seconds / 60, 'min="0" max="60" step="0.5"', 'min')}
    ${rule('set-duration', 'Durée maximale d’un titre', 'Un titre plus long est refusé et remboursé (historique : 10).', v.max_duration_seconds / 60, 'min="1" max="30"', 'min')}
    ${rule('set-grace', 'Annulation de sa musique en cours', '!songcancel sur sa propre musique déjà lancée : accepté pendant ces secondes seulement (historique : 10).', v.cancel_grace_seconds, 'min="0" max="60"', 's')}
    <div class="spo-btns" data-k="enregistrer valeurs historiques"><button type="button" class="d-btn pri sm" data-act="sp-save">Enregistrer</button><button type="button" class="d-btn ghost sm" data-act="sp-historical">Valeurs historiques</button></div>`,
    'règles limites',
  );
}

function exceptions(s: SpState, ui: SpUi) {
  const g = s.settings;
  const rows = (s.overrides ?? [])
    .map(
      (o) => `<div class="spo-ov">
        <b>@${esc(o.viewer_login)}</b>
        <small>${o.max_pending_per_viewer ?? `global (${g.max_pending_per_viewer})`} en attente · ${o.viewer_cooldown_seconds !== null ? minutes(o.viewer_cooldown_seconds) : `global (${minutes(g.viewer_cooldown_seconds)})`} · ${esc(hhmm(o.updated_at))}</small>
        <span><button type="button" class="d-btn ghost sm" data-act="sp-ov-edit" data-login="${esc(o.viewer_login)}">Modifier</button><button type="button" class="d-btn ghost sm" data-act="sp-ov-reset" data-login="${esc(o.viewer_login)}">Valeurs globales</button></span>
      </div>`,
    )
    .join('');
  const known = [
    ...new Set(s.recent.map((r) => r.viewer.login.toLowerCase())),
  ].slice(0, 30);
  return grp(
    'Exceptions',
    'users',
    `<div class="d-row col" data-k="exception viewer pseudo limites">
      ${rows || '<small>Aucune exception : tous les viewers suivent les quotas.</small>'}
      <label class="d-fld"><input type="text" data-f="ov-login" list="spo-known" placeholder="Pseudo Twitch, ex. raptoru_" aria-label="Viewer" value="${esc(val(ui, 'ov-login', ''))}" autocomplete="off"></label>
      <datalist id="spo-known">${known.map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
      <div class="spo-two">
        ${fld(`data-f="ov-pending" min="1" max="10" placeholder="${g.max_pending_per_viewer}" aria-label="Demandes en attente"`, val(ui, 'ov-pending', ''), 'en attente')}
        ${fld(`data-f="ov-cooldown" min="0" max="60" step="0.5" placeholder="${g.viewer_cooldown_seconds / 60}" aria-label="Délai entre deux demandes en minutes"`, val(ui, 'ov-cooldown', ''), 'min')}
      </div>
      <button type="button" class="d-btn sm" data-act="sp-ov-save">Enregistrer l’exception</button>
      <small>Une case vide suit le quota global ; 0 min = aucun délai. Les deux vides : retour aux valeurs globales.</small>
    </div>`,
    'viewers',
  );
}

const endOfLive = () =>
  grp(
    'Fin du live',
    'clock',
    `<div class="d-row col" data-k="fin du live stream annuler rembourser"><small>10 minutes après la fin du live, les demandes pas encore commencées sont annulées et remboursées quand la récompense le permet, une seule fois. Le morceau en cours n’est jamais touché. Une coupure brève n’est pas une fin. Cette règle est fixe.</small></div>`,
    'mode',
  );

const ACTION_STATUS: Record<string, string> = {
  queued: 'en attente du bot',
  running: 'en cours',
  done: 'faite',
  failed: 'échec',
  unknown: 'résultat inconnu',
};

function reward(s: SpState, ui: SpUi) {
  const title = ui.fields['rw-title'] ?? REWARD_TITLE;
  const same = (a: string) =>
    a.trim().toLowerCase() === title.trim().toLowerCase();
  // La récompense créée par Raptoru : le titre saisi, sinon la première qu'il gère.
  const song =
    s.managed_rewards.find((r) => same(r.title)) ?? s.managed_rewards[0];
  const pending = s.twitch_actions.find(
    (a) =>
      a.kind === 'reward_create' &&
      (a.status === 'queued' || a.status === 'running'),
  );
  const state = song
    ? `<p class="spo-state ok"><b>Récompense active : « ${esc(song.title)} », ${song.cost} points.</b> Les refus et annulations sont remboursés automatiquement.</p>`
    : pending
      ? `<p class="spo-state"><b>Création demandée à ${esc(hhmm(pending.created_at))}</b> : le bot la fait sur Twitch (${esc(ACTION_STATUS[pending.status] ?? pending.status)}).</p>`
      : '<p class="spo-state warn"><b>Aucune récompense créée par Raptoru.</b> Les demandes fonctionnent avec une récompense existante, mais rien ne peut être remboursé automatiquement.</p>';
  const form = song
    ? ''
    : `<label class="d-fld"><input type="text" data-f="rw-title" maxlength="45" aria-label="Titre sur Twitch" value="${esc(val(ui, 'rw-title', REWARD_TITLE))}"></label>
      ${row('Prix', fld('data-f="rw-cost" min="1" max="1000000"', val(ui, 'rw-cost', 1500), 'pts'))}
      <label class="d-fld"><input type="text" data-f="rw-prompt" maxlength="200" aria-label="Texte affiché au viewer" value="${esc(val(ui, 'rw-prompt', 'Titre + artiste, ou lien Spotify'))}"></label>
      <button type="button" class="d-btn sm" data-act="sp-reward" ${pending ? 'disabled' : ''}>Créer la récompense sur Twitch</button>
      <small>Action réelle sur ton compte Twitch : une confirmation est demandée.</small>`;
  const actions = s.twitch_actions.slice(0, 8);
  return grp(
    'Récompense Twitch',
    'gift',
    `<div class="d-row col" data-k="récompense twitch points prix créer réclamation remboursement">
      ${state}${form}
      <small>Pour l’utiliser, donne-lui la règle « Demande de musique (Spotify) » dans <a href="/?p=channel-points" data-page="channel-points">Récompenses Twitch</a>.</small>
      <details class="d-acc"><summary>Dernières actions sur Twitch (${actions.length})</summary>${
        actions.length
          ? `<dl class="d-kv">${actions
              .map((a) =>
                fact(
                  esc(hhmm(a.created_at)),
                  `${a.kind === 'reward_create' ? 'Création de la récompense' : a.payload.status === 'CANCELED' ? 'Remboursement' : esc(a.payload.status ?? a.kind)} · ${esc(ACTION_STATUS[a.status] ?? a.status)}${a.error ? ` (${esc(a.error)})` : ''}`,
                ),
              )
              .join('')}</dl>`
          : '<small>Aucune action envoyée à Twitch.</small>'
      }</details>
      <details class="d-acc"><summary>Détails techniques</summary><dl class="spo-facts">
        <dt>Propriétaire</dt><dd>L’application Twitch de Raptoru (celle du bot). Twitch ne laisse valider ou rembourser une réclamation qu’à l’application qui a créé la récompense : l’ancienne « Choisi la prochaine musique ! », créée par SAMMI, ne pourra jamais être remboursée par Raptoru. Elle n’est pas modifiée.</dd>
        <dt>Autorisation</dt><dd>Le bot la crée avec le compte de la chaîne (<code>raptoru_</code>) et le droit Twitch <code>channel:manage:redemptions</code>. S’il manque, rien n’est envoyé et l’échec s’affiche ci-dessus. L’exécution côté bot est activée par <code>CP_TWITCH_ACTIONS</code>.</dd>
        <dt>Titre, prix et texte</dt><dd>« ${esc(REWARD_TITLE)} », 1 500 points (ton choix du 24/10 ; l’ancienne SAMMI coûtait 1 000), texte du viewer obligatoire. Twitch exige un titre unique sur la chaîne. Modifiables avant la création, puis directement sur Twitch.</dd>
        <dt>Réclamations</dt><dd>Raptoru ne valide jamais une réclamation : une musique acceptée, ajoutée ou jouée reste <b>en attente</b> sur Twitch, tu la valides ou la rembourses toi-même. Raptoru rembourse automatiquement, une seule fois, un refus ou un échec certain, un <code>!songcancel</code>, un <code>!songremove</code> ou un retrait. Un résultat incertain reste en attente jusqu’à ta décision.</dd>
        ${song ? `<dt>Identifiant</dt><dd>Identifiant Twitch : <code>${esc(song.reward_id)}</code></dd>` : ''}
      </dl></details>
    </div>`,
  );
}

function connection(s: SpState, ui: SpUi) {
  const c = s.connection;
  const body = c.simulated
    ? '<p class="spo-state">Lab : Spotify est <b>simulé</b>, jamais ton compte ni ta vraie file.</p>'
    : `${
        c.auth === 'ok'
          ? `<p class="spo-state ok">Connecté : <b>${esc(c.account?.name ?? 'compte Spotify')}</b>${c.account?.product && c.account.product !== 'premium' ? '. <b>Pas Premium</b> : Spotify refusera l’ajout à la file' : ''}.</p>`
          : `<p class="spo-state warn">${c.auth === 'needs_reauth' ? 'Spotify demande une nouvelle connexion (autorisation expirée ou révoquée).' : 'Spotify n’est pas connecté sur ce PC.'} Les demandes sont refusées et remboursées en attendant.</p>`
      }
      <label class="d-fld"><input type="text" data-f="client" maxlength="32" placeholder="Client ID (32 caractères)" aria-label="Client ID de l’application Spotify" value="${esc(val(ui, 'client', c.client_id ?? ''))}"></label>
      <div class="spo-btns"><button type="button" class="d-btn sm" data-act="sp-connect">${c.auth === 'not_configured' ? 'Connecter Spotify' : 'Reconnecter'}</button>${c.auth === 'not_configured' ? '' : '<button type="button" class="d-btn bad sm" data-act="sp-disconnect">Déconnecter</button>'}</div>
      <small>Connexion sur ce PC uniquement. Dans le tableau de bord Spotify, l’adresse de redirection doit être exactement :</small>
      <code class="spo-uri">${esc(c.redirect_uri)}</code>`;
  return grp(
    'Connexion Spotify',
    'link',
    `<div class="d-row col" data-k="connexion compte spotify client id redirection déconnecter">${body}</div>`,
    'connexion',
  );
}

function technical(s: SpState, ui: SpUi) {
  const a = s.api;
  const n = a.counters ?? {};
  const p = s.studio?.playback;
  const refresh = `<button type="button" class="d-btn ghost sm" data-act="sp-refresh" ${a.limited_until || (s.local.refresh_in_ms ?? 0) > 0 ? 'disabled' : ''} title="Une lecture de Spotify maintenant (au plus toutes les 5 s)">Actualiser</button>`;
  return grp(
    'Détails techniques',
    'terminal',
    `<div class="d-row col" data-k="diagnostic détails techniques appels appareil lecture erreur limite"><dl class="spo-facts">
      ${fact('Studio vu par le Core', s.studio?.fresh ? 'oui' : '<b>non</b> : les demandes sont refusées (« Studio absent »)')}
      ${fact('Appareil Spotify', esc(s.studio?.status.device ? `${s.studio.status.device.name} (${s.studio.status.device.type})` : 'inconnu (aucune lecture récente)'))}
      ${fact('Limitation Spotify', a.limited_until ? `<b>${a.quota_exceeded ? 'quota dépassé' : 'appels suspendus'}</b> jusqu’à ${esc(hhmm(a.limited_until))}` : 'aucune')}
      ${fact('Erreurs réseau', a.backoff_until ? `pause jusqu’à ${esc(hhmm(a.backoff_until))}` : 'aucune')}
      ${fact('Appels Spotify', `${a.calls_last_minute} dans la dernière minute${a.rate_high ? ', <b>au-dessus du seuil d’alerte (60)</b>' : ''} · plafond 90 / min · ${n.calls ?? 0} depuis le démarrage (${n.writes ?? 0} ajouts ou passages, ${n.cache_hits ?? 0} lectures évitées par le cache)`)}
      ${fact('Suivi de la lecture', s.local.fast_lane ? 'rapide (passage d’une demande annulée)' : s.local.watching ? `actif${s.local.next_poll_in_ms != null ? ` · prochaine lecture dans ${Math.ceil(s.local.next_poll_in_ms / 1000)} s` : ''}` : 'en pause : rien à suivre (aucune demande en file, en cours ou à passer)')}
      ${fact('Dernière lecture', p ? esc(`${hhmm(p.observed_at)} (${agoMs(ui.now - Date.parse(p.observed_at))}) · ${p.track ? `${trackLabel(p.track)}${p.is_playing ? '' : ' (en pause)'}` : 'rien ne joue'}`) : 'aucune')}
      ${fact('Erreur Studio', s.local.error ? esc(s.local.error) : 'aucune')}
    </dl>${refresh}
    <small>Commandes du chat : <code>!song</code>, <code>!songqueue</code>, <code>!mysong</code>, <code>!songcancel</code> ; modérateurs : <code>!songremove</code>, <code>!songskip</code>.</small></div>`,
    'diagnostic commandes',
  );
}

export function simPanel(s: SpState, ui: SpUi) {
  const m = s.sim;
  if (!m) return '';
  const time =
    m.progress_ms !== null
      ? ` (${Math.floor(m.progress_ms / 60_000)}:${String(Math.floor((m.progress_ms % 60_000) / 1000)).padStart(2, '0')})`
      : '';
  const btn = (what: string, label: string) =>
    `<button type="button" class="d-btn ghost sm" data-act="sp-sim" data-what="${what}">${label}</button>`;
  return grp(
    'Simulateur',
    'flask',
    `<div class="d-row col" data-k="simulateur lab test demande viewer spotify événement">
      <p class="spo-state">Joue <b>${esc(m.current ?? 'rien')}</b>${time} · file Spotify : ${esc(m.queue.join(', ') || 'vide')} · ${m.calls} appels reçus${m.limited ? ' · <b>limité (429)</b>' : ''}${m.device_active ? '' : ' · <b>aucun appareil</b>'}${m.queue_answer !== 204 ? ` · prochain ajout : réponse ${m.queue_answer}` : ''}</p>
      <label class="d-fld"><select data-f="sim-who" aria-label="Viewer">${ui.who
        .map(
          (i) =>
            `<option value="${esc(i.id)}" data-login="${esc(i.login ?? '')}" ${ui.fields['sim-who'] === i.id ? 'selected' : ''}>${esc(i.label)}</option>`,
        )
        .join('')}</select></label>
      <label class="d-fld"><input type="text" data-f="sim-text" aria-label="Demande" value="${esc(val(ui, 'sim-text', 'numb linkin park'))}"></label>
      <button type="button" class="d-btn sm" data-act="sp-simulate">Simuler une demande</button>
      <div class="spo-btns">
        ${btn('near-end', 'Fin du titre (3 s)')}${btn('external', 'Titre hors demandes')}
        ${btn(m.device_active ? 'no-device' : 'device', m.device_active ? 'Couper l’appareil' : 'Rallumer l’appareil')}
        ${btn('rate-limit', 'Limite 429 (30 s)')}${btn('answer-200', 'Prochain ajout : 200')}${btn('answer-500', 'Prochain ajout : 500')}
      </div>
      <small>Rien de tout ceci ne touche ton compte Spotify ni Twitch. Les commandes se testent dans Simulation, avec les mêmes viewers.</small>
    </div>`,
    'lab test',
  );
}

export const spotifyPanel = (s: SpState, ui: SpUi) =>
  `${quotas(s, ui)}${exceptions(s, ui)}${endOfLive()}${reward(s, ui)}${connection(s, ui)}${simPanel(s, ui)}${technical(s, ui)}`;
