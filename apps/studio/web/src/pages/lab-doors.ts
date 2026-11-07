import { esc, ic } from '../ds/ds.js';
import { icon } from '../shell/icons.js';
import { hrefOf, pageById, type Page } from '../shell/registry.js';

// Les simulateurs spécialisés : chacun vit dans la page de son module. Le Laboratoire et la Simulation y mènent, sans recopier
// aucun réglage métier.

const DOORS: [string, string][] = [
  ['tts', 'Achat simulé, file, lecteur, remboursement'],
  ['spotify', 'Demandes, commandes, incidents, Spotify fictif'],
  ['channel-points', 'Catalogue fictif, actions, historique'],
  ['alerts', 'Médias, aperçu, file, timeline'],
  ['tombola', 'Manche complète, tirage, historique'],
  ['mini-games', 'Roulette, Slot, Duel : ouverture et mises'],
  ['sub-wheel', 'Droits, tirage, tours'],
  ['socle-modules', 'Modules construits sur le socle'],
];

export const labDoors = () =>
  DOORS.map(([id, what]) => {
    const x: Page | undefined = pageById(id);
    return x
      ? `<a class="lb-door" href="${hrefOf(x)}" data-page="${x.id}">${icon(x.icon, '')}<span><b>${esc(x.label)}</b><small>${esc(what)}</small></span>${ic('chevron')}</a>`
      : '';
  }).join('');
