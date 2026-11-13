import { confirmBox, drawer, esc, ic, run } from '../ds/ds.js';
import { postJson } from '../http.js';
import type { CpRedemption, CpReward, CpState } from './rewards-model.js';

// Récompenses Twitch — l'administration depuis Studio (docs/RECOMPENSES_TWITCH.md). Une règle de Twitch :
// seule l'application qui a CRÉÉ une récompense peut la modifier, la mettre en pause et rembourser ses rachats. Studio
// crée donc les récompenses de Raptoru (le bot l'exécute une fois, avec le jeton du streamer), met en pause / réactive
// celles-là, rembourse un de leurs rachats ; une ancienne récompense (SAMMI…) est seulement lue, et peut être
// REMPLACÉE : la nouvelle reçoit la règle de l'ancienne, coupée, jusqu'au test contrôlé. Chaque action Twitch part
// après une confirmation qui dit ce qu'elle fait vraiment.

export interface CpTwitchActionView {
  action_id: string;
  kind: 'redemption_status' | 'reward_create' | 'reward_update';
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'failed' | 'unknown';
  http_status: number | null;
  error: string | null;
  created_at: string;
}
export interface CpAttention {
  hand_refunds: CpRedemption[];
  twitch_actions: CpTwitchActionView[];
  missing_rewards: { id: string; title: string }[];
}

/** The Core's refusals of the administration, in plain words. */
const REFUSALS: Record<string, string> = {
  reward_create_in_progress:
    'Une création est déjà en attente du bot : attends qu’elle soit faite.',
  reward_update_in_progress:
    'Une modification de cette récompense est déjà en attente du bot.',
  reward_title_taken:
    'Ce nom est déjà pris sur la chaîne (Twitch refuse deux récompenses du même nom).',
  reward_not_managed:
    'Récompense créée hors de Raptoru : Twitch ne laisse pas Raptoru la modifier.',
  unknown_reward: 'Récompense inconnue de Studio.',
  unknown_redemption: 'Rachat introuvable.',
  simulation_not_refundable: 'Un test n’a rien coûté : rien à rembourser.',
  twitch_actions_unavailable:
    'Les actions Twitch ne sont pas disponibles sur ce Core.',
};

const actionText = (a: CpTwitchActionView) =>
  a.kind === 'reward_create'
    ? `Création de « ${String(a.payload.title ?? '')} »`
    : a.kind === 'reward_update'
      ? `Modification de la récompense (${Object.keys((a.payload.patch as object) ?? {}).join(', ')})`
      : a.payload.status === 'CANCELED'
        ? 'Remboursement d’un rachat'
        : 'Validation d’un rachat';
const STATUS: Record<CpTwitchActionView['status'], [string, string]> = {
  queued: ['En attente du bot', ''],
  running: ['En cours', ''],
  done: ['Fait sur Twitch', 'ok'],
  failed: ['Refusé par Twitch', 'bad'],
  unknown: ['Sans réponse (à vérifier sur Twitch)', 'warn'],
};

/** La ligne « qui gère cette récompense » de la fiche, avec ce que Studio peut faire. */
export function adminHtml(r: CpReward, s: CpState | null) {
  const busy = (s?.twitch_actions ?? []).some(
    (a) =>
      (a.status === 'queued' || a.status === 'running') &&
      a.kind === 'reward_update' &&
      a.payload.reward_id === r.id,
  );
  if (r.managed)
    return `<div class="rwf-note">${ic('check')}<span><b>Gérée par Raptoru</b> : Studio peut la mettre en pause, la réactiver et rembourser ses rachats.${r.migrated_from ? ' Elle remplace une ancienne récompense.' : ''}</span></div>
      <p class="rwf-adm">${
        busy
          ? '<span class="d-tag">Modification en cours sur Twitch…</span>'
          : r.twitch_enabled === false && !r.paused
            ? `<button type="button" class="d-btn sm" data-ra="show" data-id="${esc(r.id)}">${ic('play')}Rendre visible sur Twitch…</button>`
            : r.paused
              ? `<button type="button" class="d-btn sm" data-ra="resume" data-id="${esc(r.id)}">${ic('play')}Réactiver sur Twitch…</button>`
              : `<button type="button" class="d-btn sm" data-ra="pause" data-id="${esc(r.id)}">${ic('stop')}Mettre en pause sur Twitch…</button>`
      }<button type="button" class="d-btn ghost sm" data-ra="cost" data-id="${esc(r.id)}" data-cost="${r.cost}">Changer le coût…</button></p>`;
  return `<div class="rwf-note">${ic('info')}<span><b>Ancienne récompense</b> (créée hors de Raptoru, SAMMI ou le tableau de bord Twitch) : Studio la lit seulement. Raptoru ne peut ni la mettre en pause, ni rembourser ses rachats — cela se fait sur Twitch.</span></div>
    ${r.listed_by_twitch && r.twitch_enabled !== null ? `<p class="rwf-adm"><button type="button" class="d-btn sm" data-ra="migrate" data-id="${esc(r.id)}">${ic('gift')}Remplacer par une récompense Raptoru…</button></p>` : ''}`;
}

/** « À traiter » : ce qui demande une main (remboursements à faire sur Twitch, actions refusées, récompenses disparues). */
export function attentionHtml(s: CpState | null) {
  const a = s?.attention;
  if (!a) return '';
  const items = [
    ...a.hand_refunds.map(
      (x) =>
        `<li>${ic('coin')}<span><b>${esc(x.user.display_name)}</b> · ${esc(x.reward.title)} — points à rembourser sur Twitch (récompense non gérée par Raptoru)</span></li>`,
    ),
    ...a.twitch_actions.map(
      (t) =>
        `<li>${ic('warn')}<span>${esc(actionText(t))} — <span class="d-tag ${STATUS[t.status][1]}">${esc(STATUS[t.status][0])}</span>${t.error ? ` <small>${esc(t.error)}</small>` : ''}</span></li>`,
    ),
    ...a.missing_rewards.map(
      (m) =>
        `<li>${ic('warn')}<span><b>${esc(m.title)}</b> : règle active, mais Twitch ne la liste plus</span></li>`,
    ),
  ];
  const pending = (s?.twitch_actions ?? []).filter(
    (t) => t.status === 'queued' || t.status === 'running',
  );
  return `<section class="rwp-att" aria-label="À traiter">
    <header class="rwp-fh"><h2>Gestion Twitch</h2><span class="d-sp"></span><button type="button" class="d-btn sm" data-ra="create">${ic('plus')}Nouvelle récompense Raptoru…</button></header>
    ${pending.length ? `<p class="d-faint">${pending.map((t) => esc(actionText(t))).join(' · ')} : en attente du bot.</p>` : ''}
    ${items.length ? `<h3 class="d-lb">À traiter</h3><ul class="rwp-attl">${items.join('')}</ul>` : '<p class="d-faint">Rien à traiter.</p>'}
  </section>`;
}

/** Dans le détail d'un rachat : « Rembourser via Twitch » quand Raptoru le peut. */
export function refundHtml(
  x: CpRedemption,
  r: CpReward | null,
  s: CpState | null,
) {
  if (x.source !== 'twitch' || !r) return '';
  if (!r.managed)
    return `<p class="rwf-note">${ic('info')}<span>Remboursement : sur Twitch uniquement (récompense non gérée par Raptoru).</span></p>`;
  const done = (s?.twitch_actions ?? []).find(
    (a) =>
      a.kind === 'redemption_status' &&
      a.payload.redemption_id === x.redemption_id,
  );
  if (done)
    return `<p class="rwf-note">${ic('coin')}<span>${esc(actionText(done))} : ${esc(STATUS[done.status][0])}</span></p>`;
  return `<p><button type="button" class="d-btn warn sm" data-ra="refund" data-src="${esc(x.source)}" data-rid="${esc(x.redemption_id)}">${ic('coin')}Rembourser via Twitch…</button></p>`;
}

/** Un nom proposé pour le remplacement (Twitch refuse le même nom que l'ancienne) : « Random Ban » pour l'ancien Ban aléatoire. */
const suggested = (from: CpReward | null) =>
  from?.rule?.actions.some(
    (a) => (a as { interaction?: string }).interaction === 'random_ban',
  ) && from.title.toLowerCase() !== 'random ban'
    ? 'Random Ban'
    : '';

/** Le formulaire de création (ou de remplacement d'une ancienne récompense). */
function openCreate(
  s: CpState | null,
  refresh: () => void,
  from: CpReward | null,
) {
  const dr = drawer({
    kicker: from
      ? 'Remplacer une ancienne récompense'
      : 'Nouvelle récompense Raptoru',
    title: from ? `Remplacer « ${from.title} »` : 'Créer sur Twitch',
    body: `<form class="rwa-form" data-ra-form>
      <label class="d-fld rwa-f"><span>Nom sur Twitch (45 caractères)</span><input name="title" maxlength="45" required value="${esc(suggested(from))}"></label>
      <label class="d-fld rwa-f"><span>Coût en points de chaîne</span><input name="cost" type="number" min="1" required value="${from?.cost ?? 1000}"></label>
      <label class="d-fld rwa-f"><span>Description (200 caractères)</span><input name="prompt" maxlength="200" value="${esc(from?.prompt ?? '')}"></label>
      <label class="rwa-c"><input type="checkbox" name="user_input"${from?.user_input_required ? ' checked' : ''}><span>Le viewer écrit un texte</span></label>
      <label class="rwa-c"><input type="checkbox" name="hidden"${from ? ' checked' : ''}><span>Créer masquée (invisible des viewers jusqu’à « Rendre visible »)</span></label>
      <p class="rwf-note">${ic('info')}<span>${
        from
          ? 'Twitch refuse deux récompenses du même nom : choisis un autre nom que l’ancienne. La nouvelle reçoit la règle de l’ancienne, <b>coupée</b>, et naît <b>masquée</b> : rien ne se déclenche et personne ne la voit avant ton test. Un rachat pendant que la règle est coupée est remboursé. L’ancienne n’est ni modifiée ni supprimée.'
          : 'La récompense est créée active sur Twitch, sans règle : rachetée, elle ne fait rien tant que tu ne lui as pas donné d’action.'
      }</span></p>
      <p class="rwa-err d-faint" data-ra-err></p>
    </form>`,
    foot: `<button type="button" class="d-btn ghost" data-close>Annuler</button><button type="button" class="d-btn pri" data-ra-send>${ic('gift')}Créer sur Twitch…</button>`,
  });
  dr.el.querySelector<HTMLElement>('[data-ra-send]')!.onclick = async (e) => {
    const f = dr.el.querySelector<HTMLFormElement>('[data-ra-form]')!;
    const d = new FormData(f);
    const title = String(d.get('title') ?? '').trim();
    const cost = Number(d.get('cost'));
    if (!title || !Number.isInteger(cost) || cost < 1) {
      dr.el.querySelector<HTMLElement>('[data-ra-err]')!.textContent =
        'Un nom et un coût entier sont nécessaires.';
      return;
    }
    const yes = await confirmBox({
      title: `Créer « ${title} » sur Twitch ?`,
      body: `${s?.environment === 'production' ? 'PRODUCTION : la récompense est VRAIMENT créée sur ta chaîne' : 'Lab'} — ${cost.toLocaleString('fr-FR')} points, créée par l’application Raptoru (seule elle pourra la gérer).${d.get('hidden') === 'on' ? ' Elle naît MASQUÉE : aucun viewer ne la voit avant « Rendre visible ».' : ' Elle est VISIBLE des viewers dès sa création.'}${from ? `\n\nElle remplacera « ${from.title} » : la règle est recopiée coupée ; l’ancienne reste telle quelle.` : ''}`,
      yes: 'Créer sur Twitch',
      no: 'Annuler',
      danger: s?.environment === 'production',
    });
    if (!yes) return;
    const ok = await run(
      e.currentTarget as HTMLElement,
      () =>
        postJson('/api/channel-points/rewards', {
          title,
          cost,
          prompt: String(d.get('prompt') ?? ''),
          user_input: d.get('user_input') === 'on',
          hidden: d.get('hidden') === 'on',
          ...(from ? { migrated_from: from.id } : {}),
        }),
      'Création demandée : le bot la fait sur Twitch',
      REFUSALS,
    );
    if (ok) {
      dr.close();
      refresh();
    }
  };
}

/** Les clics de l'administration (page et fiches). `reward(id)` : la récompense connue de Studio. */
export function bindRewardAdmin(
  root: HTMLElement | Document,
  o: { state: () => CpState | null; refresh: () => void },
) {
  root.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-ra]');
    if (!b) return;
    const s = o.state();
    const reward = s?.rewards.find((r) => r.id === b.dataset.id) ?? null;
    const act = b.dataset.ra;
    if (act === 'create') return openCreate(s, o.refresh, null);
    if (act === 'migrate' && reward) return openCreate(s, o.refresh, reward);
    if (act === 'show' && reward)
      return void confirmBox({
        title: `Rendre « ${reward.title} » visible sur Twitch ?`,
        body: reward.rule?.enabled
          ? 'Les viewers la voient et peuvent la racheter : sa règle est active.'
          : 'Sa règle est COUPÉE : un rachat ne déclencherait rien (les points seraient rendus). Active d’abord la règle si tu veux qu’elle agisse.',
        yes: 'Rendre visible',
        no: 'Annuler',
        danger: false,
      }).then(async (yes) => {
        if (!yes) return;
        if (
          await run(
            b,
            () =>
              postJson(`/api/channel-points/rewards/${reward.id}/twitch`, {
                patch: { is_enabled: true },
              }),
            'Demandé : le bot l’applique sur Twitch',
            REFUSALS,
          )
        )
          o.refresh();
      });
    if ((act === 'pause' || act === 'resume') && reward)
      return void confirmBox({
        title: `${act === 'pause' ? 'Mettre en pause' : 'Réactiver'} « ${reward.title} » sur Twitch ?`,
        body:
          act === 'pause'
            ? 'Les viewers ne peuvent plus la racheter tant qu’elle est en pause (elle reste visible, grisée).'
            : 'Les viewers peuvent de nouveau la racheter.',
        yes: act === 'pause' ? 'Mettre en pause' : 'Réactiver',
        no: 'Annuler',
        danger: false,
      }).then(async (yes) => {
        if (!yes) return;
        if (
          await run(
            b,
            () =>
              postJson(`/api/channel-points/rewards/${reward.id}/twitch`, {
                patch: { is_paused: act === 'pause' },
              }),
            'Demandé : le bot l’applique sur Twitch',
            REFUSALS,
          )
        )
          o.refresh();
      });
    if (act === 'cost' && reward) {
      const v = window.prompt(
        `Nouveau coût de « ${reward.title} » (points de chaîne) :`,
        String(reward.cost),
      );
      const cost = Number(v);
      if (!v || !Number.isInteger(cost) || cost < 1) return;
      return void run(
        b,
        () =>
          postJson(`/api/channel-points/rewards/${reward.id}/twitch`, {
            patch: { cost },
          }),
        'Demandé : le bot l’applique sur Twitch',
        REFUSALS,
      ).then((ok) => ok && o.refresh());
    }
    if (act === 'refund')
      return void confirmBox({
        title: 'Rembourser ce rachat via Twitch ?',
        body: 'Twitch rend ses points au viewer (une seule fois, jamais après une validation). Rien d’autre n’est annulé.',
        yes: 'Rembourser',
        no: 'Annuler',
        danger: true,
      }).then(async (yes) => {
        if (!yes) return;
        if (
          await run(
            b,
            () =>
              postJson(
                `/api/channel-points/redemptions/${b.dataset.src}/${b.dataset.rid}/refund`,
                {},
              ),
            'Remboursement demandé : le bot l’envoie à Twitch',
            REFUSALS,
          )
        )
          o.refresh();
      });
  });
}
