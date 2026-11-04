// Régie live (refonte lot 7, étape 1) — ce qui compte pendant le stream, au même endroit, sans copie de module :
// - les incidents en cours (supervision) ;
// - les automatisations des points de chaîne : état réel du Core et action nommée (même route et même confirmation
//   que la page Récompenses Twitch) ;
// - les contrôles nommés de chaque module : un lien vers l'écran qui les porte déjà (aucun bouton recopié).
// Pas d'« arrêter tout » : chaque arrêt est nommé et limité à son module.
import type { SupervisionSnapshot } from '../supervision-banner.js';

const HEADERS = { 'content-type': 'application/json', 'x-raptoru-studio': '1' };
const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

interface CpSummary {
  enabled: boolean;
  rules: number;
}

/** Named controls of each module, where they already live. `what` says exactly what can be done there. */
export const REGIE_CONTROLS: { page: string; title: string; what: string }[] = [
  {
    page: 'moderation',
    title: 'Modération',
    what: 'Files D4, sanctions, remboursements ; en Production, pause, stop et file TTS.',
  },
  {
    page: 'tombola',
    title: 'Tombola',
    what: 'Tirage en direct : pause, reprise, annulation (avec confirmation).',
  },
  {
    page: 'alerts',
    title: 'Alertes',
    what: 'File : rejouer une alerte, arrêter celle en cours.',
  },
  {
    page: 'tts',
    title: 'TTS (Lab)',
    what: 'Pause, reprise, stop de la lecture en cours, vider la file (remboursés).',
  },
  {
    page: 'spotify',
    title: 'Spotify',
    what: 'Demandes de musique : ouvrir / fermer, retirer une demande (remboursée).',
  },
  {
    page: 'random-ban',
    title: 'Random Ban',
    what: 'Tirage à blanc, suivi des bans et du mute OBS.',
  },
  {
    page: 'sub-wheel',
    title: 'Roue du Sub',
    what: 'File, droits, tirages à vérifier.',
  },
  {
    page: 'word-game',
    title: 'Jeu des mots',
    what: 'Manches et révélation locale.',
  },
  {
    page: 'halloween',
    title: 'Halloween',
    what: 'Effets de l’événement : arrêt de l’effet en cours.',
  },
];

export async function loadChannelPoints(): Promise<CpSummary | null> {
  try {
    const res = await fetch('/api/channel-points/state', { headers: HEADERS });
    if (!res.ok) return null;
    const s = (await res.json()) as {
      settings?: { enabled?: boolean };
      rewards?: { rule?: { enabled?: boolean } | null }[];
    };
    return {
      enabled: !!s.settings?.enabled,
      rules: (s.rewards ?? []).filter((r) => r.rule?.enabled).length,
    };
  } catch {
    return null;
  }
}

export const CP_ON_CONFIRM =
  'Activer les automatisations de points de chaîne ?\n\nLes vraies récompenses de ta chaîne déclencheront les actions configurées (OBS, sons).';
export const CP_OFF_CONFIRM =
  'Couper les automatisations de points de chaîne ?\n\nLes récompenses ne déclenchent plus leurs actions (OBS, sons, interactions). Elles restent achetables sur Twitch et ne sont pas remboursées par Raptoru : désactive-les sur Twitch si besoin. Les autres modules (alertes, Tombola, TTS…) ne sont pas touchés.';

export async function setChannelPoints(enabled: boolean) {
  const res = await fetch('/api/channel-points/settings', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ enabled }),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
}

export function regieHtml(opts: {
  sup: SupervisionSnapshot | null;
  supOk: boolean;
  cp: CpSummary | null | undefined;
  message: string;
  href: (page: string) => string;
}) {
  const active = opts.sup?.incidents.filter((i) => !i.endedAt) ?? [];
  const cp = opts.cp;
  return `<div class="rs-cols">
    <section class="rs-panel"><h2>En ce moment</h2>
      <p class="rs-state ${!opts.supOk ? 'is-unknown' : active.length ? 'is-down' : 'is-ok'}">${
        !opts.supOk
          ? 'Supervision indisponible : état inconnu.'
          : active.length
            ? `${active.length} incident(s) en cours : ${active.map((i) => esc(i.label)).join(', ')}.`
            : 'Aucun incident confirmé en cours.'
      }</p>
      <p class="rs-muted"><a href="${opts.href('activite')}">Historique des coupures</a> · <a href="${opts.href('systeme')}">Connexions (Système)</a></p>
    </section>
    <section class="rs-panel" data-role="regie-cp"><h2>Points de chaîne</h2>
      <p class="rs-state ${cp === undefined ? '' : cp === null ? 'is-unknown' : cp.enabled ? 'is-ok' : ''}">${
        cp === undefined
          ? 'Lecture…'
          : cp === null
            ? 'État inconnu (Core du profil injoignable ou module absent).'
            : cp.enabled
              ? `Automatisations actives · ${cp.rules} récompense(s) avec une règle active.`
              : `Automatisations coupées · ${cp.rules} récompense(s) avec une règle active (sans effet tant que c’est coupé).`
      }</p>
      ${cp ? `<button type="button" class="rs-btn ${cp.enabled ? 'danger' : ''}" data-regie="cp">${cp.enabled ? 'Couper les automatisations…' : 'Activer les automatisations…'}</button>` : ''}
      <p class="rs-muted">${opts.message ? `${esc(opts.message)} · ` : ''}Règles et historique : <a href="${opts.href('channel-points')}">Récompenses Twitch</a>.</p>
    </section>
  </div>
  <section class="rs-panel"><h2>Contrôles par module</h2>
    <p class="rs-muted">Chaque arrêt est nommé et limité à son module ; il n’existe pas d’« arrêter tout ».</p>
    <div class="rs-rows">${REGIE_CONTROLS.map((c) => `<a class="rs-row rs-row-2" href="${opts.href(c.page)}"><b>${esc(c.title)}</b><small>${esc(c.what)}</small></a>`).join('')}</div>
  </section>`;
}
