// Caution — Studio section (pure part, tested): whether the Twitch executor can read and lift, the last cautions with
// what really happened to the Jetons (debited, refunded, to verify). Read only: the money moves only through the chat
// (`!caution` + `oui`). Every Twitch name is escaped.

export interface CautionView {
  request_id: string;
  status:
    | 'checking'
    | 'quoting'
    | 'quoted'
    | 'confirmed'
    | 'rechecking'
    | 'releasing'
    | 'released'
    | 'refused'
    | 'cancelled'
    | 'expired'
    | 'failed'
    | 'uncertain';
  mode: 'real' | 'dry_run';
  payer: { name: string };
  target_input: string;
  target: { name: string | null } | null;
  kind: 'timeout' | 'mute' | null;
  price: number | null;
  reason: string | null;
  error: string | null;
  money: 'none' | 'debited' | 'refunded' | 'to_verify';
  created_at: string;
}

export interface CautionState {
  executor: {
    login: string;
    can_read: boolean;
    can_release: boolean;
    missing: string[];
  } | null;
  ready: boolean;
  to_verify: number;
  recent: CautionView[];
}

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const chip = (cls: string, text: string) =>
  `<span class="cp-chip cp-chip--${cls}">${esc(text)}</span>`;
const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/\s/g, ' ');

const STATUS: Record<CautionView['status'], string> = {
  checking: 'Lecture Twitch en attente',
  quoting: 'Lecture Twitch',
  quoted: 'Devis envoyé (30 s)',
  confirmed: '« oui » reçu',
  rechecking: 'Revérification avant paiement',
  releasing: 'Payé · levée en cours',
  released: 'Libéré',
  refused: 'Refusé',
  cancelled: 'Annulé par le payeur',
  expired: 'Devis expiré',
  failed: 'Échec',
  uncertain: 'Levée incertaine',
};

const REASON: Record<string, string> = {
  unknown_target: 'pseudo introuvable',
  self: 'sa propre caution',
  no_timeout: 'aucun timeout actif',
  permanent: 'ban permanent (non rachetable)',
  ended: 'timeout déjà terminé',
  not_muted: 'streamer non muté',
  mute_over: 'mute terminé avant le paiement',
  insufficient: 'Jetons insuffisants',
  wallet_unavailable: 'portefeuille indisponible',
  no_longer: 'plus en timeout au moment de payer',
  now_permanent: 'devenu un ban permanent',
  extended: 'timeout prolongé : nouveau devis demandé',
  twitch_unreadable: 'Twitch illisible',
  executor_absent: 'exécuteur Twitch absent',
  executor_lost: 'exécuteur Twitch perdu (avant tout paiement)',
  missing_scope_read: 'droit Twitch manquant (lecture des bannis)',
  missing_scope_release: 'droit Twitch manquant (levée)',
  not_applied: 'levée refusée par Twitch',
  not_banned: 'timeout terminé avant la levée',
  dry_run: 'simulation (aucun appel Twitch)',
  quote_expired: 'pas de réponse en 30 s',
  cancelled: 'annulé',
};

const MONEY: Record<CautionView['money'], string> = {
  none: 'aucun jeton débité',
  debited: 'débité',
  refunded: 'débité puis remboursé',
  to_verify: 'débité · À VÉRIFIER sur Twitch (aucun remboursement automatique)',
};

/** The tab section. */
export function cautionView(s: CautionState | null, error: string | null) {
  if (error) return `<p class="cp-error">${esc(error)}</p>`;
  if (!s) return '<p class="cp-muted">Chargement…</p>';
  const e = s.executor;
  const executor = !e
    ? chip('warn', 'Exécuteur Twitch : absent')
    : `${chip(e.can_read ? 'ok' : 'warn', `Lecture des bannis : ${e.can_read ? 'prête' : 'impossible'}`)} ${chip(
        e.can_release ? 'ok' : 'warn',
        `Levées par ${e.login} : ${e.can_release ? 'autorisées' : 'droit manquant'}`,
      )}${e.missing.length ? `<br><small class="cp-muted">Droits Twitch manquants : ${esc(e.missing.join(', '))}</small>` : ''}`;
  const rows = s.recent
    .map((r) => {
      const who = r.target?.name ?? r.target_input;
      const price = r.price !== null ? `${fmt(r.price)} jetons` : '';
      const cls =
        r.money === 'to_verify'
          ? 'failed'
          : r.status === 'released'
            ? 'done'
            : r.status === 'failed' || r.status === 'refused'
              ? 'failed'
              : 'pending';
      return `<tr class="cp-row--${cls}">
        <td>${esc(new Date(r.created_at).toLocaleTimeString('fr-FR'))}</td>
        <td>${r.mode === 'dry_run' ? '<i>Test</i> ' : ''}${esc(r.payer.name)}</td>
        <td><b>${STATUS[r.status]}</b><br><small>${esc(who)}${r.kind === 'mute' ? ' (mute)' : ''}${price ? ` · ${esc(price)}` : ''}</small></td>
        <td><small>${r.reason ? esc(REASON[r.reason] ?? r.reason) : ''}${r.error ? `<br>${esc(r.error)}` : ''}<br>${r.money === 'to_verify' ? `<b>${esc(MONEY[r.money])}</b>` : esc(MONEY[r.money])}</small></td></tr>`;
    })
    .join('');
  return `<div class="cp-status">${executor}${s.to_verify ? ` ${chip('warn', `${s.to_verify} caution(s) à vérifier`)}` : ''}</div>
    <p class="cp-muted">Règles : <code>!caution pseudo</code> lève un timeout Twitch actif (jamais un ban permanent) pour
      1 000 Jetons par minute restante entamée ; le payeur répond <code>oui</code> / <code>non</code> en 30 s. Les Jetons ne
      sont débités qu’après une relecture Twitch ; remboursés une seule fois si la levée échoue à coup sûr ; jamais
      automatiquement si le résultat est incertain.</p>
    ${rows ? `<table class="cp-history"><thead><tr><th>Heure</th><th>Payeur</th><th>Résultat</th><th>Jetons</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="cp-muted">Aucune caution.</p>'}`;
}
