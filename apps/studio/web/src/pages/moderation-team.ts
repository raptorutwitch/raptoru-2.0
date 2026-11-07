import { ago, confirmBox, esc, ic, patch, pp, seg, sw } from '../ds/ds.js';
import { act, granted, modGet, PERMS, ROLE } from '../mod/mod.js';
import type { View } from './moderation-ui.js';

// L'équipe : un tableau croisé, une ligne par membre, une colonne par permission. Les mots surveillés : deux listes. Le Core
// garde les règles (personne ne modifie ses propres droits, un mod n'accorde que ce qu'il a).

/** Les opérations du Core, dans l'ordre où on les cherche. Une règle inconnue de cette liste s'affiche sous son nom. */
const OPS: [string, [string, string][]][] = [
  [
    'Pendant le live',
    [
      ['module.pause', 'Mettre un module en pause'],
      ['module.resume', 'Reprendre un module'],
      ['module.disable', 'Fermer un module'],
      ['global.pause', 'Pause globale'],
      ['queue.stop', 'Couper ce qui joue'],
      ['queue.cancel', 'Retirer une demande'],
      ['queue.purge', 'Vider une file'],
      ['review.allow', 'Laisser passer une demande retenue'],
    ],
  ],
  [
    'Viewers',
    [
      ['viewer.read', 'Lire une fiche'],
      ['notes.write', 'Écrire une note'],
      ['viewer.block', 'Bloquer un viewer'],
      ['viewer.cooldown', 'Imposer un délai'],
      ['sanction.sensitive', 'Tout Raptoru, sans fin, ou plus d’une heure'],
      ['audit.read', 'Lire l’historique'],
    ],
  ],
  [
    'Jetons',
    [
      ['refund', 'Rembourser en retirant une demande'],
      ['refund.manual', 'Remboursement manuel'],
      ['wallet.admin', 'Créditer ou débiter'],
      ['wallet.lab', 'Portefeuille de test'],
    ],
  ],
  [
    'Tombola et Roue',
    [
      ['raffle.moderate', 'Tombola : actions courantes'],
      ['raffle.manage', 'Tombola : temps, pause, tirage, ajout manuel'],
      ['raffle.force', 'Tombola : forcer un viewer bloqué'],
      ['raffle.config', 'Tombola : réglages'],
      ['subwheel.draw', 'Roue : demander un tirage'],
      ['subwheel.grant', 'Roue : accorder un tour'],
    ],
  ],
  [
    'Administration',
    [
      ['words.manage', 'Mots surveillés'],
      ['perms.manage', 'Accorder des permissions'],
      ['staff.manage', 'Nommer un supermod'],
      ['config.tts', 'Réglages du TTS'],
    ],
  ],
];
/** Les commandes réservées dans le chat : le Core lit le badge Twitch (apps/core-api/src/spotify/chat.ts, votekick). */
const CHAT: [string, string][] = [
  ['!songskip, !songremove', 'Modérateurs et streamer'],
  ['!songcancel', 'Tout viewer, pour sa propre musique'],
  ['Commandes réservées aux mods', 'Selon le public choisi dans Commandes'],
];

const yes = '<i class="mr-y" aria-label="Oui"></i>';
const no = '<span class="mr-n" aria-label="Non">—</span>';
/** Ce que dit une règle pour chaque rôle : mod, mod avec le droit, supermod, streamer. */
function ruleCells(need: string) {
  if (need === 'moderator') return [yes, yes, yes, yes];
  if (need === 'supermod') return [no, no, yes, yes];
  if (need === 'broadcaster') return [no, no, no, yes];
  return [no, `<small>${esc(PERMS[need]?.[0] ?? need)}</small>`, yes, yes];
}
function rulesView(rules: Record<string, string> | undefined) {
  if (!rules)
    return '<p class="d-note">Ce Core ne publie pas encore ses règles : le tableau apparaîtra avec sa prochaine version.</p>';
  const known = new Set(OPS.flatMap(([, l]) => l.map(([k]) => k)));
  const other = Object.keys(rules)
    .filter((k) => !known.has(k))
    .map((k): [string, string] => [k, k]);
  const groups = other.length
    ? [...OPS, ['Autres', other] as (typeof OPS)[number]]
    : OPS;
  return `<div class="mr" role="table" aria-label="Qui peut faire quoi"><div class="mr-r mr-head" role="row"><span role="columnheader">Opération</span>${['Mod', 'Mod avec le droit', 'Supermod', 'Streamer'].map((h) => `<span role="columnheader">${h}</span>`).join('')}</div>${groups
    .map(
      ([g, list]) =>
        `<p class="d-lb mr-g">${esc(g)}</p>${list
          .filter(([k]) => rules[k])
          .map(
            ([k, l]) =>
              `<div class="mr-r" role="row"><span role="cell">${esc(l)}</span>${ruleCells(
                rules[k]!,
              )
                .map((c) => `<span role="cell">${c}</span>`)
                .join('')}</div>`,
          )
          .join('')}`,
    )
    .join('')}</div>`;
}
const roleCount = (m: Member[], r: string) =>
  m.filter((x) => x.role === r).length;

interface Member {
  viewer_id: string;
  display_name: string;
  role: string;
  grants: string[];
  last_seen: string | null;
}

export function mountTeam(): View {
  const el = document.createElement('div');
  el.className = 'mv-team';
  let members: Member[] | null = null;
  let rules: Record<string, string> | undefined;
  let failed = false;
  const keys = Object.keys(PERMS);
  const read = async () => {
    try {
      const t = await modGet<{
        members: Member[];
        rules?: Record<string, string>;
      }>('team');
      members = t.members;
      rules = t.rules;
      failed = false;
    } catch {
      failed = true;
    }
    paint();
  };
  const line = (m: Member) => {
    const mod = m.role === 'moderator';
    return `<div class="mt-r" role="row"><span class="mt-who" role="cell">${pp(m.display_name, 26)}<span><b>${esc(m.display_name)}</b><small>${esc(ROLE[m.role] ?? m.role)}${m.last_seen ? ` · vu ${esc(ago(m.last_seen))}` : ''}</small></span></span>
      ${keys
        .map((p) => {
          const on = m.grants.includes(p);
          const can = mod && granted('perms') && granted(p);
          return `<span class="mt-c" role="cell">${sw(on, `data-p="${p}" data-v="${esc(m.viewer_id)}" data-name="${esc(m.display_name)}"`, `${PERMS[p]![0]} · ${m.display_name}`, { disabled: !can })}</span>`;
        })
        .join('')}
      <span class="mt-c" role="cell">${m.role === 'broadcaster' ? '' : `<button type="button" class="d-btn ghost sm" data-staff="${esc(m.viewer_id)}" data-name="${esc(m.display_name)}" data-role="${m.role === 'supermod' ? '' : 'supermod'}">${m.role === 'supermod' ? 'Retirer supermod' : 'Nommer supermod'}</button>`}</span></div>`;
  };
  function paint() {
    if (!members) {
      patch(
        el,
        `<div class="d-empty">${failed ? 'Équipe illisible pour le moment.' : 'Lecture…'}</div>`,
      );
      return;
    }
    patch(
      el,
      `<div class="mt-roles">
        <div><b>${roleCount(members, 'broadcaster')}</b><span>Streamer</span><small>Toutes les permissions.</small></div>
        <div><b>${roleCount(members, 'supermod')}</b><span>Supermod</span><small>Rôle Raptoru, nommé ici. Toutes les permissions, sauf réservées au streamer.</small></div>
        <div><b>${roleCount(members, 'moderator')}</b><span>Mod</span><small>Rôle Twitch. Modération courante, plus les droits cochés ci-dessous.</small></div>
      </div>
      <div class="mt" role="table" aria-label="Permissions de l’équipe" style="--cols:${keys.length}"><div class="mt-r mt-head" role="row"><span role="columnheader" class="d-lb">Membre</span>${keys.map((p) => `<span role="columnheader" class="mt-p" title="${esc(PERMS[p]![1])}">${esc(PERMS[p]![0])}</span>`).join('')}<span role="columnheader"></span></div>${members.map(line).join('')}</div>
      <p class="d-note">Un mod apparaît ici dès qu’il ouvre la modération dans l’extension : Twitch ne donne pas la liste. Cocher un droit agit tout de suite.</p>
      <details class="d-acc mt-more" open><summary>Qui peut faire quoi</summary>${rulesView(rules)}</details>
      <details class="d-acc mt-more"><summary>Dans le chat</summary>
        <dl class="mr-chat">${CHAT.map(([c, w]) => `<dt><code>${esc(c)}</code></dt><dd>${esc(w)}</dd>`).join('')}</dl>
        <p class="d-note">Dans le chat, le rôle vient du badge Twitch porté au moment du message : Modérateur ou Lead Moderator. Les droits cochés ici et le titre de supermod ne changent rien pour ces commandes. Un supermod sans badge de modérateur reste un viewer dans le chat.</p>
      </details>`,
    );
  }
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.dataset.p) return;
    void act(
      null,
      {
        action: 'set_permission',
        viewer_id: t.dataset.v,
        permission: t.dataset.p,
        granted: t.checked,
      },
      `${PERMS[t.dataset.p]![0]} ${t.checked ? 'accordée à' : 'retirée à'} ${t.dataset.name}`,
    ).then(read);
  });
  el.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-staff]');
    if (!b) return;
    const add = !!b.dataset.role;
    if (add) {
      const yes = await confirmBox({
        title: `Nommer ${b.dataset.name} supermod ?`,
        body: 'Un supermod a toutes les permissions : remboursements, portefeuilles, sanctions sensibles, pause globale.',
        yes: 'Nommer supermod',
        no: 'Annuler',
      });
      if (!yes) return;
    }
    await act(
      b,
      {
        action: 'set_staff',
        viewer_id: b.dataset.staff,
        role: b.dataset.role || null,
      },
      add ? `${b.dataset.name} nommé supermod` : 'Supermod retiré',
    );
    await read();
  });
  return { el, paint, read };
}

interface Word {
  id: number;
  word: string;
  kind: 'watch' | 'block';
  created_by?: string;
}
export function mountWords(): View {
  const el = document.createElement('div');
  el.className = 'mv-words';
  el.innerHTML = `<form class="mw-add" data-form><label class="d-fld"><input type="text" data-word maxlength="40" placeholder="Mot ou expression" aria-label="Nouveau mot"></label><span data-kind></span><button class="d-btn pri">${ic('plus')}Ajouter</button></form><div class="mw-cols" data-cols></div>`;
  const cols = el.querySelector<HTMLElement>('[data-cols]')!;
  const form = el.querySelector<HTMLFormElement>('[data-form]')!;
  let words: Word[] | null = null;
  let failed = false;
  let kind = 'watch';
  const read = async () => {
    try {
      words = (await modGet<{ words: Word[] }>('words')).words;
      failed = false;
    } catch {
      failed = true;
    }
    paint();
  };
  const col = (k: Word['kind'], title: string, hint: string) => {
    const l = (words ?? []).filter((w) => w.kind === k);
    return `<section class="mw-col"><h2 class="d-lb">${title} · ${l.length}</h2><p class="d-note">${hint}</p><div class="d-tags">${l.map((w) => `<button type="button" class="d-tag ${k === 'block' ? 'bad' : 'warn'}" data-w="${w.id}" data-t="${esc(w.word)}" title="Retirer « ${esc(w.word)} »">${esc(w.word)} ${ic('x')}</button>`).join('') || '<span class="d-faint">Aucun mot.</span>'}</div></section>`;
  };
  function paint() {
    patch(
      el.querySelector<HTMLElement>('[data-kind]'),
      seg(
        'data-k',
        [
          ['watch', 'À vérifier'],
          ['block', 'Bloqué'],
        ],
        kind,
      ),
    );
    patch(
      cols,
      words
        ? col(
            'watch',
            'À vérifier',
            'La demande est retenue jusqu’à ta décision.',
          ) +
            col(
              'block',
              'Bloqués',
              'La demande est refusée avant la file : rien n’est débité.',
            )
        : `<div class="d-empty">${failed ? 'Liste illisible pour le moment.' : 'Lecture…'}</div>`,
    );
  }
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (b?.dataset.k) {
      kind = b.dataset.k;
      return paint();
    }
    if (b?.dataset.w)
      void act(
        b,
        { action: 'remove_word', word_id: Number(b.dataset.w) },
        `« ${b.dataset.t} » retiré`,
      ).then(read);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const i = form.querySelector<HTMLInputElement>('[data-word]')!;
    const word = i.value.trim();
    if (!word) return i.focus();
    i.value = '';
    void act(
      null,
      { action: 'add_word', word, kind },
      `« ${word} » ajouté`,
    ).then(read);
  });
  return { el, paint, read };
}
