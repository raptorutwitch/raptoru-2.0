import {
  type SpState,
  type SpUi,
  ago,
  chip,
  clock,
  esc,
  minutes,
  val,
} from './spotify-ui.js';

// Spotify V2 — the « Musique » section's secondary spaces (pure, tested): Viewers (per-viewer exceptions), Réglages
// (the historical global settings), Récompense Twitch (what Raptoru's reward is and how claims are handled), Connexion
// et diagnostic (Spotify account, API budget, Studio's watch) and, in the Lab, the simulator.

/** The historical settings (spotify-v2/config.js). */
export const HISTORICAL = {
  max_pending_per_viewer: 2,
  viewer_cooldown_seconds: 600,
  max_duration_seconds: 600,
  cancel_grace_seconds: 10,
};

// ------------------------------------------------------------------ Viewers

export function viewersPanel(s: SpState, ui: SpUi) {
  const g = s.settings;
  const rows = (s.overrides ?? [])
    .map(
      (o) => `<tr>
        <td><b>@${esc(o.viewer_login)}</b></td>
        <td>${o.max_pending_per_viewer ?? `<span class="cp-muted">global (${g.max_pending_per_viewer})</span>`}</td>
        <td>${o.viewer_cooldown_seconds !== null ? minutes(o.viewer_cooldown_seconds) : `<span class="cp-muted">global (${minutes(g.viewer_cooldown_seconds)})</span>`}</td>
        <td class="cp-muted">${esc(clock(o.updated_at))}</td>
        <td class="sp-right"><button type="button" class="cp-ghost" data-act="sp-ov-edit" data-login="${esc(o.viewer_login)}">Modifier</button>
          <button type="button" class="cp-ghost" data-act="sp-ov-reset" data-login="${esc(o.viewer_login)}">Revenir aux valeurs globales</button></td></tr>`,
    )
    .join('');
  const known = [
    ...new Set(s.recent.map((r) => r.viewer.login.toLowerCase())),
  ].slice(0, 30);
  return `<p class="cp-muted">Exceptions individuelles aux limites globales :
      <b>${g.max_pending_per_viewer}</b> demande${g.max_pending_per_viewer > 1 ? 's' : ''} en attente au plus,
      <b>${minutes(g.viewer_cooldown_seconds)}</b> entre deux demandes. Une case vide suit la valeur globale.
      Les autres règles (durée maximale, annulation) restent globales.</p>
    ${
      rows
        ? `<table class="cp-history sp-table"><thead><tr><th>Viewer</th><th>Demandes en attente</th><th>Délai entre deux demandes</th><th>Modifiée</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="sp-empty">Aucune exception : tous les viewers suivent les réglages globaux.</p>'
    }
    <div class="sp-form">
      <h4>Ajouter ou modifier une exception</h4>
      <div class="sp-fields">
        <label>Viewer (pseudo Twitch)<input data-f="ov-login" list="sp-known-viewers" placeholder="ex. raptoru_" value="${val(ui, 'ov-login', '')}" autocomplete="off"></label>
        <label>Demandes en attente<input type="number" data-f="ov-pending" min="1" max="10" placeholder="global : ${g.max_pending_per_viewer}" value="${val(ui, 'ov-pending', '')}"></label>
        <label>Délai entre deux demandes (min)<input type="number" data-f="ov-cooldown" min="0" max="60" step="0.5" placeholder="global : ${g.viewer_cooldown_seconds / 60}" value="${val(ui, 'ov-cooldown', '')}"></label>
      </div>
      <datalist id="sp-known-viewers">${known.map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
      <div class="cp-buttons"><button type="button" class="primary" data-act="sp-ov-save">Enregistrer l’exception</button></div>
      <p class="cp-muted">0 min = aucun délai pour ce viewer. Les deux cases vides = retour aux valeurs globales.</p>
    </div>`;
}

// ------------------------------------------------------------------ Réglages

export function settingsPanel(s: SpState, ui: SpUi) {
  const v = s.settings;
  const field = (
    name: string,
    label: string,
    help: string,
    saved: number,
    attrs: string,
  ) =>
    `<label class="sp-setting"><span><b>${label}</b><small class="cp-muted">${help}</small></span>
      <input type="number" data-f="${name}" ${attrs} value="${val(ui, name, saved)}"></label>`;
  return `<p class="cp-muted">Réglages globaux, valables pour tous les viewers sauf exception (espace Viewers). Les
      valeurs historiques de l’ancien Spotify V2 sont indiquées entre parenthèses.</p>
    <div class="sp-settings">
      ${field('set-pending', 'Demandes en attente par viewer', 'Combien de musiques un viewer peut avoir en file en même temps (historique : 2).', v.max_pending_per_viewer, 'min="1" max="10"')}
      ${field('set-cooldown', 'Délai entre deux demandes (min)', 'Compté depuis sa dernière demande encore en file ; il tombe dès qu’elle commence à jouer (historique : 10).', v.viewer_cooldown_seconds / 60, 'min="0" max="60" step="0.5"')}
      ${field('set-duration', 'Durée maximale d’un titre (min)', 'Un titre plus long est refusé et remboursé (historique : 10).', v.max_duration_seconds / 60, 'min="1" max="30"')}
      ${field('set-grace', 'Annulation de sa musique en cours (s)', '!songcancel sur sa propre musique déjà lancée : accepté pendant ces secondes seulement (historique : 10).', v.cancel_grace_seconds, 'min="0" max="60"')}
    </div>
    <div class="cp-buttons"><button type="button" class="primary" data-act="sp-save">Enregistrer</button>
      <button type="button" data-act="sp-historical">Revenir aux valeurs historiques</button></div>`;
}

// ------------------------------------------------------------------ Récompense Twitch

const ACTION_STATUS: Record<string, string> = {
  queued: 'en attente du bot',
  running: 'en cours',
  done: 'faite',
  failed: 'échec',
  unknown: 'résultat inconnu',
};

export function rewardPanel(s: SpState, ui: SpUi) {
  const song = s.managed_rewards.find(
    (r) => r.title === 'Choisi la prochaine musique !',
  );
  const pending = s.twitch_actions.find(
    (a) =>
      a.kind === 'reward_create' &&
      (a.status === 'queued' || a.status === 'running'),
  );
  const state = song
    ? `<div class="sp-note sp-note--ok"><b>Récompense active : « ${esc(song.title)} », ${song.cost} points.</b> Créée par
        l’application Twitch de Raptoru : les refus et annulations sont remboursés automatiquement.</div>`
    : pending
      ? `<div class="sp-note"><b>Création demandée à ${esc(clock(pending.created_at))}</b> : le bot la fait sur Twitch
          (${esc(ACTION_STATUS[pending.status] ?? pending.status)}).</div>`
      : `<div class="sp-note sp-note--warn"><b>Aucune récompense créée par Raptoru.</b> Les demandes fonctionnent avec
          une récompense existante, mais rien ne peut être remboursé automatiquement.</div>`;
  const actions = s.twitch_actions.slice(0, 8);
  return `${state}
    <dl class="sp-facts">
      <dt>Propriétaire</dt><dd>L’application Twitch de Raptoru (celle du bot). Twitch ne laisse valider ou rembourser une
        réclamation qu’à l’application qui a créé la récompense : l’ancienne « Choisi la prochaine musique ! », créée par
        SAMMI, ne pourra jamais être remboursée par Raptoru. Elle n’est pas modifiée.</dd>
      <dt>Autorisation</dt><dd>Le bot la crée avec le compte de la chaîne (<code>raptoru_</code>) et le droit Twitch
        <code>channel:manage:redemptions</code>, déjà prévu dans le profil d’autorisation. S’il manque, rien n’est envoyé
        et l’échec s’affiche ci-dessous. L’exécution côté bot est activée par <code>CP_TWITCH_ACTIONS</code> (sur GO).</dd>
      <dt>Prix et texte</dt><dd>1 000 points (prix historique), texte du viewer obligatoire (titre + artiste ou lien
        Spotify). Modifiables ci-dessous avant la création, puis directement sur Twitch.</dd>
      <dt>Réclamations</dt><dd>Raptoru ne valide jamais une réclamation : une musique acceptée, ajoutée ou jouée reste
        <b>en attente</b> sur Twitch, tu la valides ou la rembourses toi-même. Raptoru rembourse automatiquement
        (une seule fois) un refus ou un échec certain, un <code>!songcancel</code>, un <code>!songremove</code> ou un
        « Retirer ». Un résultat incertain reste en attente jusqu’à ta décision (espace Lecture).</dd>
      <dt>Ensuite</dt><dd>Dans la liste des récompenses ci-dessus : lui donner la règle « Demande de musique (Spotify) ».</dd>
    </dl>
    ${
      song
        ? ''
        : `<div class="sp-form"><h4>Créer la récompense</h4>
      <div class="sp-fields">
        <label>Prix (points de chaîne)<input type="number" data-f="rw-cost" min="1" max="1000000" value="${val(ui, 'rw-cost', 1000)}"></label>
        <label class="sp-wide">Texte affiché au viewer<input data-f="rw-prompt" maxlength="200" value="${val(ui, 'rw-prompt', 'Titre + artiste, ou lien Spotify')}"></label>
      </div>
      <div class="cp-buttons"><button type="button" class="primary" data-act="sp-reward" ${pending ? 'disabled' : ''}>Créer « Choisi la prochaine musique ! » sur Twitch</button></div>
      <p class="cp-muted">Une confirmation est demandée. Action réelle sur ton compte Twitch : à faire seulement lors de la
        mise en service.</p></div>`
    }
    <h4>Dernières actions sur Twitch</h4>
    ${
      actions.length
        ? `<table class="cp-history"><thead><tr><th>Heure</th><th>Action</th><th>État</th></tr></thead><tbody>${actions
            .map(
              (a) =>
                `<tr><td>${esc(clock(a.created_at))}</td><td>${a.kind === 'reward_create' ? 'Création de la récompense' : a.payload.status === 'CANCELED' ? 'Remboursement' : esc(a.payload.status ?? a.kind)}</td><td>${esc(ACTION_STATUS[a.status] ?? a.status)}${a.error ? ` <small class="cp-muted">(${esc(a.error)})</small>` : ''}</td></tr>`,
            )
            .join('')}</tbody></table>`
        : '<p class="sp-empty">Aucune action envoyée à Twitch.</p>'
    }`;
}

// ------------------------------------------------------------------ Connexion et diagnostic

export function techPanel(s: SpState, ui: SpUi) {
  const c = s.connection;
  const account = c.simulated
    ? `<div class="sp-note">Lab : Spotify est <b>simulé</b> (jamais ton compte ni ta vraie file). Le vrai Spotify n’est
        utilisé que dans le profil Production, après connexion ci-dessous.</div>`
    : `${
        c.auth === 'ok'
          ? `<div class="sp-note sp-note--ok">Connecté : <b>${esc(c.account?.name ?? 'compte Spotify')}</b>${c.account?.product && c.account.product !== 'premium' ? ' — <b>pas Premium</b> : Spotify refusera l’ajout à la file' : ''}.</div>`
          : `<div class="sp-note sp-note--warn">${c.auth === 'needs_reauth' ? 'Spotify demande une nouvelle connexion (autorisation expirée ou révoquée).' : 'Spotify n’est pas connecté sur ce PC.'} Les demandes sont refusées et remboursées en attendant.</div>`
      }
      <p class="cp-muted">Connexion sur ce PC uniquement (jeton chiffré par Windows). Dans le tableau de bord Spotify de
        l’application Raptoru, l’adresse de redirection doit être exactement <code>${esc(c.redirect_uri)}</code>.</p>
      <div class="sp-fields">
        <label class="sp-wide">Client ID de l’application Spotify<input data-f="client" maxlength="32" placeholder="32 caractères" value="${val(ui, 'client', c.client_id ?? '')}"></label>
      </div>
      <div class="cp-buttons"><button type="button" class="primary" data-act="sp-connect">${c.auth === 'not_configured' ? 'Connecter Spotify' : 'Reconnecter'}</button>
        ${c.auth === 'not_configured' ? '' : '<button type="button" data-act="sp-disconnect">Déconnecter</button>'}</div>`;
  const a = s.api;
  const n = a.counters ?? {};
  const p = s.studio?.playback;
  const fact = (k: string, v: string) => `<dt>${k}</dt><dd>${v}</dd>`;
  return `<h4>Compte Spotify</h4>${account}
    <h4>Diagnostic</h4>
    <dl class="sp-facts">
      ${fact('Studio vu par le Core', s.studio?.fresh ? 'oui' : '<b>non</b> : les demandes sont refusées (« Studio absent »)')}
      ${fact('Appareil Spotify', esc(s.studio?.status.device ? `${s.studio.status.device.name} (${s.studio.status.device.type})` : 'inconnu (aucune lecture récente)'))}
      ${fact('Limitation Spotify', a.limited_until ? `<b>${a.quota_exceeded ? 'quota dépassé' : 'appels suspendus'}</b> jusqu’à ${esc(clock(a.limited_until))}` : 'aucune')}
      ${fact('Erreurs réseau', a.backoff_until ? `pause jusqu’à ${esc(clock(a.backoff_until))}` : 'aucune')}
      ${fact('Appels Spotify', `${a.calls_last_minute} dans la dernière minute${a.rate_high ? ' — <b>au-dessus du seuil d’alerte (60)</b>' : ''} · plafond 90 / min · ${n.calls ?? 0} depuis le démarrage (${n.writes ?? 0} ajouts / passages, ${n.cache_hits ?? 0} lectures évitées par le cache)`)}
      ${fact('Suivi de la lecture', s.local.fast_lane ? 'rapide (passage d’une demande annulée)' : s.local.watching ? `actif${s.local.next_poll_in_ms != null ? ` · prochaine lecture dans ${Math.ceil(s.local.next_poll_in_ms / 1000)} s` : ''}` : 'en pause : rien à suivre (aucune demande en file, en cours ou à passer)')}
      ${fact('Dernière lecture', p ? esc(`${clock(p.observed_at)} (${ago(ui.now - Date.parse(p.observed_at))})`) : 'aucune')}
      ${fact('Erreur Studio', s.local.error ? `<span class="cp-error">${esc(s.local.error)}</span>` : 'aucune')}
    </dl>`;
}

// ------------------------------------------------------------------ Simulateur (Lab)

export function simPanel(s: SpState, ui: SpUi) {
  const m = s.sim;
  if (!m) return '';
  return `<div class="sp-note">Spotify simulé : joue <b>${esc(m.current ?? 'rien')}</b>${m.progress_ms !== null ? ` (${Math.floor(m.progress_ms / 60_000)}:${String(Math.floor((m.progress_ms % 60_000) / 1000)).padStart(2, '0')})` : ''}
      · file Spotify : ${esc(m.queue.join(', ') || 'vide')} · ${m.calls} appels reçus${m.limited ? ' · <b>limité (429)</b>' : ''}${m.device_active ? '' : ' · <b>aucun appareil</b>'}${m.queue_answer !== 204 ? ` · prochain ajout : réponse ${m.queue_answer}` : ''}</div>
    <h4>Simuler la demande d’un viewer</h4>
    <div class="sp-fields">
      <label>Viewer<select data-f="sim-who">${ui.who
        .map(
          (i) =>
            `<option value="${esc(i.id)}" data-login="${esc(i.login ?? '')}" ${ui.fields['sim-who'] === i.id ? 'selected' : ''}>${esc(i.label)}</option>`,
        )
        .join('')}</select></label>
      <label class="sp-wide">Demande<input data-f="sim-text" value="${val(ui, 'sim-text', 'numb linkin park')}"></label>
    </div>
    <div class="cp-buttons"><button type="button" class="primary" data-act="sp-simulate">Simuler une demande</button></div>
    <p class="cp-muted">Les commandes (<code>!songcancel</code>, <code>!song</code>…) se testent dans l’onglet Simulation
      avec les mêmes viewers.</p>
    <h4>Événements Spotify</h4>
    <div class="cp-buttons">
      <button type="button" data-act="sp-sim" data-what="near-end">Fin du titre (3 s)</button>
      <button type="button" data-act="sp-sim" data-what="external">Titre hors demandes</button>
      <button type="button" data-act="sp-sim" data-what="${m.device_active ? 'no-device' : 'device'}">${m.device_active ? 'Couper l’appareil' : 'Rallumer l’appareil'}</button>
      <button type="button" data-act="sp-sim" data-what="rate-limit">Limite 429 (30 s)</button>
      <button type="button" data-act="sp-sim" data-what="answer-200">Prochain ajout : réponse 200</button>
      <button type="button" data-act="sp-sim" data-what="answer-500">Prochain ajout : réponse 500</button>
    </div>
    <p>${chip('off', 'Rien de tout ceci ne touche ton compte Spotify ni Twitch')}</p>`;
}
