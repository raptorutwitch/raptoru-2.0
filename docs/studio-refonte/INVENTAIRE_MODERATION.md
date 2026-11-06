# Inventaire de la modération

Preuve qu'aucune action n'est perdue entre la console de l'extension (`moderation-v2.js`, `moderation-restrictions.js`,
`module-moderation.js`), la console V1 (`moderation-v1.js`), l'ancien onglet Studio (`apps/studio/web/src/moderation.ts`) et la
Modération native de Studio (`pages/moderation*.ts`, `mod/mod.ts`).

Sources du contrat : `packages/schemas/src/lab-moderation.ts`, `packages/schemas/src/raffle-v2.ts`,
`apps/studio/server/src/lab-moderation/proxy.ts`, `apps/studio/server/src/modules/relay.ts`.

Vocabulaire de Studio : **Régie** (table de mixage, vue par défaut), **Détail** (colonne de droite de la page, tiroir depuis les autres
pages), **Fiche** (fiche viewer, même surface que le Détail). Le Core reste le seul à décider : droits, règles, audit.

## Commandes du Core

Toutes les commandes acceptées par `/api/lab/actions` ont leur geste.

| Commande | Extension | Où dans Studio | Confirmation |
|---|---|---|---|
| `module_state` | Menu d'état | Régie, sélecteur Ouvert / Pause / Fermé de chaque tranche | Pause avec file ou Fermé : choix (garder, annuler et rembourser, annuler sans rembourser) |
| `stop_current` | Stop du TTS | Régie, Passer (TTS en cours), Détail | Menu à verbes explicites ; touche `R` |
| `cancel` | Retirer une demande ou un son | Régie, menu d'une ligne ; Détail, Retirer ou Couper, et rembourser ou non ; À vérifier, Refuser | Menu à verbes explicites ; clé d'intention |
| `stop_all` | Stop tous les sons | Régie, tranche Sons, Couper tout (au moins deux sons) | Choix rembourser ou non ; clé d'intention |
| `purge` | Purger la file | Régie, Vider… (TTS, Sons) | Choix rembourser ou non, total affiché ; clé d'intention |
| `refund` | Rembourser (terminé) | Détail, Rembourser | Confirmation avec montant ; clé d'intention |
| `allow` | Laisser passer | Régie, bandeau À vérifier ; Détail ; menu d'une ligne ; touche `L` | Aucune : pas d'argent en jeu |
| `block_viewer` | Bloquer, bloc rapide | Fiche, Bloquer ; Détail, Bloquer (1 min, 5 min, autre) ; À vérifier ; Restrictions (modifier) | Formulaire : portée, durée, raison, ce que verra le viewer |
| `unblock_viewer` | Lever | Fiche ; Restrictions | Aucune : lever n'est pas une sanction |
| `set_cooldown` | Cooldown | Fiche ; Restrictions (modifier) | Formulaire : module, délai, durée, résumé |
| `clear_cooldown` | Lever, Effacer le cooldown TTS | Fiche (restrictions, attente TTS en cours) ; Restrictions ; Wallet de test | Aucune |
| `global_pause` | Menu global | En-tête, Pause globale ; bandeau, Lever | Activer : confirmation qui dit ce qu'elle fait et ne fait pas |
| `set_permission` | Équipe, interrupteurs | Équipe, tableau croisé | Interrupteur : agit tout de suite, audité |
| `set_staff` | (Studio seul) | Équipe, Nommer ou Retirer supermod | Nommer : confirmation (toutes les permissions) |
| `add_note` | Notes internes | Fiche, Note | Formulaire |
| `add_word`, `remove_word` | Surveillance | Mots surveillés | Aucune |
| `wallet_adjust` | Wallet admin | Fiche, Créditer, Débiter | Formulaire avec nouveau solde ; clé d'intention (dialogue, monnaie, montant) |
| `raffle_open` | (Studio seul) | Régie, tranche Tombola, Manche rapide… | Formulaire |
| `raffle_close`, `raffle_draw` | (Studio seul) | Remplacés par Tirer (`draw_now`) : le Core fait la même chose pour les trois | Confirmation |
| `raffle` → `extend` | + 30 s | Régie, tranche Tombola | Aucune |
| `raffle` → `pause`, `resume` | Pause, reprise | Régie, tranche Tombola | Aucune |
| `raffle` → `draw_now` | Tirer maintenant | Régie, tranche Tombola | Confirmation |
| `raffle` → `cancel` | Annuler la manche | Régie, tranche Tombola | Confirmation |
| `raffle` → `add_participant` | Ajouter | Régie, Ajouter ; Fiche, Ajouter | Viewer bloqué : confirmation pour forcer, tracée |
| `raffle` → `remove_participant` | Retirer | Régie, ligne de participant ; Fiche | Aucune |
| `/api/modules/refund` | Autres modules | Autres modules, Rembourser… | Motif obligatoire, montant affiché |
| `/api/lab/wallet` (`set`, `adjust`, `reset`) | (Studio seul) | Wallet de test, profil Lab seulement | Remise à zéro : confirmation |

## Console D4 de l'extension

| Fonction | Où dans Studio |
|---|---|
| Colonne des modules : état, résumé, nombre à vérifier, progression | Régie : une tranche par module, compteur, heure estimée, onglet Régie avec le nombre à vérifier |
| Recherche de viewer, viewers récents, rôle, restriction, Entrée, Échap | En-tête : champ de recherche, touche `/`, flèches, Entrée, Échap |
| Pause globale : pastille, menu, confirmation, bandeau, refus comptés | En-tête et bandeau de pause |
| Vue TTS : en cours, en attente, à vérifier, mots surlignés, prix, heure | Tranche TTS ; bandeau À vérifier |
| Vue Sons : sons en cours, temps restant, attente | Tranche Sons |
| Vue Bonk : instantané, derniers bonks, emote réelle | Tranche Bonk |
| Vue Tombola : état, minuteur, participants, source, lot, origine auto, dernier tirage, gagnants, paiement | Tranche Tombola ; anneau de temps ; lien vers le mouvement du gagnant |
| Icônes d'en-tête de module : restrictions, historique, mots, purger | Pied de chaque tranche |
| État non actif : note et Réactiver | Mention dans la tranche ; sélecteur d'état |
| Fiche : solde, notes, restrictions avec levée, participation à la manche, activité, Jetons, Gérer les restrictions | Fiche |
| Fiche : En ce moment | Fiche, section En ce moment |
| Fiche : Détails (identifiant, premier passage, aujourd'hui) | Fiche, Détails techniques |
| Détail d'une demande : texte, mots, erreur, qui a fini, statut, actions, technique | Détail |
| Détail d'un mouvement : montant, source, statut, viewer, interaction liée, remboursement, débit d'origine | Détail (`openLedger`), avec retour au précédent |
| Détail d'audit : qui, module, viewer, raison, avant et après | Détail (`openAudit`) |
| Historique : Interactions, filtres module, statut, période, viewer, pagination | Historique, Interactions. Périodes ajoutées : 24 heures, 7 jours, Tout (le Core les acceptait) |
| Historique : Jetons, mouvements automatiques masqués, pagination | Historique, Jetons, pour toute la chaîne ou un viewer |
| Historique : Modération (audit), filtre module | Historique, Audit ; filtre viewer ajouté |
| Restrictions : actives, historique, filtres (toutes, global, module, viewer), modifier, lever, compte à rebours | Restrictions |
| Équipe : rôle, grants, verrous (soi-même, ce qu'on détient) | Équipe |
| Surveillance : mots, type, explications | Mots surveillés |
| Autres modules | Autres modules, et tranche Autres en Régie (état, interrupteur) |
| Messages de droits (`Permission « … » requise`) | `modErr` : mêmes messages, nomme la permission qui manque |
| Tooltips | Attribut `title` et libellés explicites |
| Commandes (lien, vue) | Page Commandes de Studio : déjà native, le lien de l'extension n'a pas d'objet ici |
| Retour au Hub | Sans objet : la navigation est celle de Studio |
| Trois formats (fenêtre, vidéo, compact) | Sans objet : application de bureau, de 1024 × 768 à 1920 × 1080 |

## Console V1 de l'extension

La V1 ne sert que lorsque le Core n'annonce pas `moderation_v2` (Lab sans Core, calibration). Studio passe toujours par le Core.

| Fonction V1 | Équivalent |
|---|---|
| Pause, reprise, stop, purge TTS | `module_state`, `stop_current`, `purge` |
| Décision sur un message en attente, refuser et bannir | `allow`, `cancel`, `block_viewer` |
| Fiche utilisateur, crédits Soundboard | Fiche, `wallet_adjust` |
| Suspension, bannissement TTS | `block_viewer` |
| Modules ouverts ou fermés | `module_state` |
| Historique, filtre par module | Historique |

## Ancien onglet Studio

| Fonction | Où maintenant |
|---|---|
| Console embarquée | Remplacée par la Régie et ses vues |
| Tombola : ouvrir (cagnotte, durée, gagnants) | Tranche Tombola, Manche rapide… |
| Tombola : fermer sans tirer | Le Core tire dans ce cas aussi : même effet que Tirer |
| Tombola : inscrits, dernier tirage | Tranche Tombola |
| Supermods | Équipe |
| Wallet de test, cooldown TTS | Wallet de test, masqué en profil Production |
| Mention Production | État de la page : « Production · tout est réel » |

## Volontairement absent

- `retry_payout` : hors du canal de modération du Core ; reste sur la page Tombola (historique).
- Lancement selon les réglages (`launch`) et configuration de la Tombola : page Tombola, lien Réglages dans la tranche.
- Réglages TTS : page TTS. Les mots surveillés y restent aussi accessibles.
- `moderation-v2.js`, `moderation-v1.js` et `moderation-restrictions.js` ne changent pas : ils restent ceux de l'extension.

## Clavier

`/` chercher · `1` à `7` vues · `↑ ↓` ou `J K` parcourir une file · `← →` changer de file · `L` laisser passer · `R` retirer ou refuser
(ouvre le menu, jamais d'action directe sur l'argent) · `B` bloquer (ouvre le formulaire) · `V` fiche · `Échap` fermer · `?` aide.
