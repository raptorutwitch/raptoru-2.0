import type { CmdTeamRights } from '@raptoru/schemas';
import {
  type Category,
  categoryOf,
  type CommandItem,
  MODES,
  NO_CATEGORY,
  RIGHTS,
  same,
  VARIABLES,
} from '../commands-model.js';
import { esc, fld, grp, ic, row, stateChip, sw } from '../ds/ds.js';
import { lookIc } from './commands-look.js';

// Le panneau de réglages de la page : la sortie chat réelle, dite telle qu'elle est, les catégories, les droits de l'équipe et
// l'aide. Du HTML pur : les droits et les catégories appartiennent au Core, qui les vérifie.

export interface Runtime {
  enabled: boolean;
  executor_absent?: boolean;
  ingress_running?: boolean;
  write_scope?: boolean;
}
export type Role = 'moderator' | 'supermod';
export interface Rights {
  moderator: { rights: CmdTeamRights; version: number };
  supermod: { rights: CmdTeamRights; version: number };
}
export type RightsDraft = Record<Role, CmdTeamRights>;

export function outputGrp(r: Runtime | null) {
  const body = !r
    ? '<p class="d-note">État de la sortie chat illisible.</p>'
    : `${row('Sortie chat réelle', stateChip(r.enabled ? (r.executor_absent ? 'w' : '') : 'off', r.enabled ? 'Activée' : 'Coupée'), 'envoi twitch bot lecroupier')}
       ${row('Lecture du chat', stateChip(r.ingress_running ? '' : 'off', r.ingress_running ? 'Activée' : 'Coupée'), 'ingestion')}
       ${r.enabled ? row('Bot qui envoie', stateChip(r.executor_absent ? 'r' : '', r.executor_absent ? 'Absent' : 'Présent'), 'exécuteur') : ''}
       ${r.enabled && r.write_scope === false ? '<p class="d-note bad">Autorisation d’écriture manquante pour LeCroupier_.</p>' : ''}
       <p class="d-note">${r.enabled ? (r.executor_absent ? 'Les réponses attendent puis expirent : allume la lecture du chat dans la simulation.' : 'Les réponses partent dans le vrai chat Twitch.') : 'Les commandes sont décidées et enregistrées, rien n’est envoyé dans le chat.'}</p>`;
  return grp(
    'Sortie chat',
    'chat',
    `<div data-k="sortie chat réelle envoi lecture bot simulation">${body}<a class="d-btn ghost sm" href="?p=simulation">${ic('arrow')}Régler dans Simulation</a></div>`,
    'sortie',
  );
}

export function catsGrp(cats: Category[], all: CommandItem[]) {
  const rows = cats
    .map(
      (k, i) =>
        `<div class="cdx-cat" data-k="${esc(`catégorie ${k.name}`.toLowerCase())}"><button type="button" class="cdx-tile" style="--c:${esc(k.color)}" data-catlook="${esc(k.category_id)}" aria-label="Icône et couleur de ${esc(k.name)}">${lookIc(k.icon)}</button>
        <label class="d-fld"><input type="text" data-catname="${esc(k.category_id)}" value="${esc(k.name)}" maxlength="24" aria-label="Nom de la catégorie"><span>${all.filter((c) => c.config.category === k.category_id).length}</span></label>
        <button type="button" class="d-ib" data-catmove="${esc(k.category_id)}|-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter">${ic('down', 'cdx-up')}</button><button type="button" class="d-ib" data-catmove="${esc(k.category_id)}|1" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="Descendre">${ic('down')}</button><button type="button" class="d-ib" data-catdel="${esc(k.category_id)}" aria-label="Supprimer ${esc(k.name)}">${ic('trash')}</button></div>`,
    )
    .join('');
  const none = all.filter((c) => categoryOf(c, cats) === NO_CATEGORY).length;
  return grp(
    'Catégories',
    'layers',
    `${rows}<form class="cdx-cat new" data-catform data-k="ajouter nouvelle catégorie"><label class="d-fld"><input type="text" data-catnew placeholder="Nouvelle catégorie" maxlength="24" aria-label="Nouvelle catégorie"></label><button class="d-ib" aria-label="Ajouter la catégorie">${ic('plus')}</button></form>
     <p class="d-note" data-k="sans catégorie supprimer">${none} commande${none > 1 ? 's' : ''} sans catégorie. Supprimer une catégorie garde ses commandes.</p>`,
    'catégories',
  );
}

export function rightsGrp(
  rights: Rights | null,
  r: RightsDraft | null,
  msg: string,
) {
  if (!r || !rights)
    return grp(
      'Droits de l’équipe',
      'users',
      '<p class="d-note" data-k="droits équipe">Lecture…</p>',
      'droits',
    );
  const allowed = (role: Role, k: keyof CmdTeamRights) => {
    const v = r[role][k];
    return typeof v === 'boolean' ? v : (v as { allowed: boolean }).allowed;
  };
  const roleName = { moderator: 'Modos', supermod: 'Supermodos' };
  const sub = (k: keyof CmdTeamRights) =>
    (['moderator', 'supermod'] as const)
      .filter((role) => allowed(role, k))
      .map((role) =>
        k === 'cooldown'
          ? `<div class="d-row cdx-sub" data-k="cooldown minimum"><span>${roleName[role]} : au moins</span>${fld(`data-rightv="${role}:cooldown.min_seconds" aria-label="Cooldown minimum, ${roleName[role]}" min="0"`, r[role].cooldown.min_seconds, 's')}</div>`
          : k === 'volume'
            ? `<div class="d-row cdx-sub" data-k="volume sons bornes"><span>${roleName[role]} : de</span>${fld(`data-rightv="${role}:volume.min" aria-label="Volume minimum, ${roleName[role]}" min="0"`, r[role].volume.min, '%')}${fld(`data-rightv="${role}:volume.max" aria-label="Volume maximum, ${roleName[role]}" min="0"`, r[role].volume.max, '%')}</div>`
            : '',
      )
      .join('');
  const line = ([k, l, s]: (typeof RIGHTS)[number]) =>
    `<div class="d-row cdx-right" data-k="${esc(`${l} ${s ?? ''}`.toLowerCase())}"><span>${esc(l)}${s ? `<small>${esc(s)}</small>` : ''}</span><span class="cdx-rsw">${sw(allowed('moderator', k), `data-right="moderator:${k}"`, `${l}, modérateurs`)}${sw(allowed('supermod', k), `data-right="supermod:${k}"`, `${l}, supermodos`)}</span></div>${sub(k)}`;
  const dirty = (role: Role) => !same(r[role], rights[role].rights);
  return grp(
    'Droits de l’équipe',
    'users',
    `<div class="d-row cdx-right" data-k="droits équipe modérateurs supermodos"><span class="d-faint">Depuis l’extension</span><span class="cdx-rsw d-lb"><span>Modos</span><span>Super</span></span></div>
     ${RIGHTS.map(line).join('')}
     <div class="cdx-savers" data-k="enregistrer droits">${(['moderator', 'supermod'] as const).map((role) => `<button type="button" class="d-btn ${dirty(role) ? 'pri' : ''} sm" data-rightsave="${role}" ${dirty(role) ? '' : 'disabled'}>Enregistrer ${role === 'moderator' ? 'modos' : 'supermodos'}</button>`).join('')}</div>
     ${msg ? `<p class="d-note ${msg.startsWith('!') ? 'bad' : ''}" data-k="droits">${esc(msg.replace(/^!/, ''))}</p>` : ''}
     <p class="d-note" data-k="droits équipe jamais extension autres messages catégories">Toujours permis : chercher, consulter, tester, lire le journal. Jamais depuis l’extension : les autres messages, les règles avancées, les catégories. Une commande verrouillée reste en lecture seule pour l’équipe.</p>`,
    'droits',
  );
}

const help = (title: string, body: string) =>
  `<details class="d-acc" data-k="${esc(title.toLowerCase())} aide"><summary>${esc(title)}</summary>${body}</details>`;
export const helpGrp = () =>
  grp(
    'Aide',
    'info',
    `${help('Comment le bot répond', MODES.map(([, l, , desc]) => `<p class="d-note"><b>${esc(l)}</b> : ${esc(desc)}</p>`).join(''))}
     ${help('S’adresser à quelqu’un', '<p class="d-note">Ajoute « @pseudo » au début du message : celui qui tape la commande, la personne qu’il a mentionnée (il faut alors un @pseudo dans « Après la commande »), ou toujours le même pseudo. En Réponse Twitch, pas besoin : Twitch montre déjà à qui le bot répond.</p>')}
     ${help('Variables', VARIABLES.map(([v, name, desc, ex]) => `<p class="d-note"><b>${esc(name)}</b> <code>${esc(v)}</code> : ${esc(desc)}, par exemple ${esc(ex)}.</p>`).join(''))}
     ${help('Qui peut l’utiliser', '<p class="d-note">Les groupes s’additionnent. Tout le monde remplace tous les autres. Les personnes ajoutées à la main passent en plus, ou seules si aucun groupe n’est actif. Une personne exclue ne passe jamais. Personne n’a de passe-droit : le streamer et l’équipe suivent les mêmes règles.</p>')}
     ${help('Délai et utilisations', '<p class="d-note">Le délai est un temps minimum entre deux utilisations. Les utilisations sont un plafond sur une période. Les alias partagent les compteurs de leur commande, et les deux peuvent se combiner.</p>')}
     ${help('Tester', '<p class="d-note">Le faux chat montre un exemple pendant que tu écris. Tester pose la question au serveur avec la version enregistrée : même décision qu’un vrai message, rien n’est écrit ni envoyé.</p>')}`,
    'aide',
  );
