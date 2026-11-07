# Parité fonctionnelle — périmètre « direct » (comportement, pas libellés)

Comparaison `5d63087` → `feat/studio-ux` (bdb6d12), 07/11/2026. Lecture seule : rien n'a été exécuté, ni Studio, ni Electron, ni Lab.
Chaque écart ci-dessous a été lu des deux côtés (gestionnaires et route Core). Ce qui est une supposition est marqué comme tel.

Préfixes : **A:** = `git show 5d63087:apps/studio/web/src/…` · **N:** = `apps/studio/web/src/…` du worktree · **E:** = `apps/twitch-extension/extension/shared/moderation-v2.js` · **C:** = `apps/core-api/src/…` · **S:** = `apps/studio/server/src/…`

## Verdict

**Aucun écart grave.** Aucune perte de droit, de prix, de remboursement, de monnaie ou d'idempotence. Les commandes envoyées sont les mêmes, champ pour champ, sur TTS, Soundboard, Bonk, Spotify, Tombola, Alertes, Roue du Sub, Random Ban, Votekick, Caution, Dock OBS, Récompenses, Effets et Régie. Spotify, Random Ban, Votekick, Caution, Dock et Récompenses n'ont aucun écart de comportement.

## Écarts à corriger, par gravité

### E1 · Moyen · Bonk : changer le prix ne demande plus de confirmation, et l'application peut être partielle
- **Avant** : `A:module-settings.ts:111` affichait `Prix : ancien → nouveau` et « Appliqué aux prochains achats… Rien de ce qui est déjà payé ne change » avant tout envoi.
- **Maintenant** : `N:pages/bonk.ts:686` `applyPrices` envoie directement, un POST par clé (`for … await send`). Si le second est refusé, le premier reste appliqué et aucune annulation n'est proposée (`undo` seulement si tout a réussi).
- **Pourquoi c'est un écart** : c'est la seule page qui contourne `bindSettings` (`N:pages/setting-rows.ts`) et `mountSettingsPanel`, qui gardent la confirmation pour tous les autres prix (Random Ban, FX Cam, Caution, Votekick). Le bouton « Appliquer » et l'annulation par toast atténuent, sans dire l'effet.
- **Correction** : `confirmBox` avant l'envoi, avec les `ancien → nouveau` ; ou réutiliser `settingRows`/`bindSettings`. Le refus non entier reste assuré par le Core (`C:module-settings/service.ts:152`).

### E2 · Moyen · TTS : les limites des paliers ne se saisissent plus à l'unité
- **Avant** : `A:tts-config.ts:81` champs numériques Longueur min / max, tout entier valide.
- **Maintenant** : `N:pages/tts.ts:96` arrondit à 10 caractères, `:559` plafonne le glissement à 800 (`SCALE`) ; `:576` clavier par pas de 10. La fenêtre du palier (`:509`) n'a que prix, crédits et attente. Aucun champ pour la limite.
- **Effet** : 125 ou 860 caractères ne sont plus réglables à la souris (au clavier, 860 est atteignable mais la règle s'arrête à 800). Les limites par défaut (80, 150, 300, 500 : `C:tts-lab/rules.ts:59`) restent atteignables. Une valeur existante non multiple de 10 reste valable tant qu'on n'y touche pas.
- **Bug associé** : « Couper en deux » (`:535`) sur un palier étroit donne `mid === t.max` (ex. 291-300 → 300), donc un palier 301-300 refusé par le Core (`C:tts-lab/rules.ts:212`) au moment d'Appliquer.
- **Correction** : un champ « Jusqu'à » dans la fenêtre du palier, en passant par `clampLimits` ; désactiver « Couper en deux » si `t.max - t.min < 2`, ou garder `mid < t.max`.

### E3 · Moyen-faible · État d'un module : cliquer l'état déjà actif renvoie la commande
- **Avant** : `E:1213` `if (cur === st) return;`.
- **Maintenant** : `N:mod/mod.ts:1428` `setModuleState` ne connaît pas l'état courant, et `seg` (`N:ds/ds.ts:54`) laisse le bouton actif cliquable.
- **Effet** : TTS ou Sons déjà en pause, file non vide : un clic sur « Pause » rouvre le choix « Annuler et rembourser ». Sinon, une commande et une ligne d'audit `module_active` sans changement, avec toast. Rien n'est remboursé sans choix explicite (`C:tts-lab/tts-lab-service.ts:1043`).
- **Correction** : ajouter le contrôle dans `setModuleState` (paramètre `current`) ou sur le segment actif, pour TTS, Soundboard, Bonk et Tombola. Un seul endroit.

### E4 · Faible · TTS : l'erreur du runtime n'est plus affichée
- **Avant** : `A:tts-lab.ts:151` `statusError(s.error)` ; `:142` « Non lancé : le runtime local du Studio ne tourne pas. »
- **Maintenant** : `N:pages/tts.ts:85` déclare `error`, rien ne le lit ; `paintHead` (`:280`) dit « Lecteur OBS absent » dans les deux cas. Soundboard et Bonk, eux, affichent bien `status.error`.
- **Correction** : deux lignes dans `paintHead`, comme `N:pages/soundboard.ts:404`. Gérer aussi `player.enabled === false`.

### E5 · Faible · Alertes : le mode Twitch reste cliquable quand il est indisponible
- **Avant** : `A:alerts-twitch.ts:151` désactivait tout sauf Off si `available === false`.
- **Maintenant** : `N:pages/alerts.ts:491` et `N:pages/alerts-sources.ts:497` ne traitent que `managed_by`. Le serveur enregistre le mode sans contrôle (`S:alerts/runtime.ts:334`). Sans effet réel : rien n'arrive sans `twitch`, et la note dit « Indisponible ».
- **Correction** : désactiver Test et Actif si `available === false`, aux deux endroits.

### E6 · Faible · Roue du Sub : la recherche Droits peut perdre la saisie
- **Avant** : `A:sub-wheel.ts:77` relevé suspendu pendant la frappe, valeurs `[data-f]` conservées (`:60`).
- **Maintenant** : `N:pages/sub-wheel.ts:216` `paintSide` réécrit la colonne si l'état a changé, sans garde. Seul le panneau est protégé (`:226`). Effet limité : la colonne ne change que si le Core change.
- **Correction** : ne pas peindre `z('side')` si `[data-f="swr-q"]` a le focus.

### E7 · Dépendance de livraison · Alertes : poids du tirage Follow
`N:pages/alerts.ts` envoie `weights` ; `AlertVariantSettings` est strict (`packages/schemas/src/alerts.ts`). **Supposition sur l'état de Production** : si le Core déployé ne contient pas ce champ, le curseur est refusé (`invalid_variant_settings`), le reste de la page marche. Déployer le Core avant ce Studio. Lecture du schéma et de la route confirmée ; état réel du Core de production non vérifié ici.

## À arbitrer par Antoni (pas des régressions)

- **Soundboard, « Ajouter un son » et « Remplacer »** (`N:pages/soundboard.ts:158`, `:566`, `:830`) : boutons visibles qui n'ouvrent qu'une explication. N'existaient pas avant. Limite réelle : la banque est livrée avec le Core et l'extension. À garder si ils viennent du prototype ; sinon les retirer.
- **Purge d'une file** : la case « Supprimer les N… » de la console (`E:1674`) est remplacée par un choix obligatoire, sans présélection (`N:mod/mod.ts:1376`). Deux gestes dans les deux cas, je le classe équivalent.

## Tableaux par module

### TTS
| Fonction | Statut | Ancien | Nouveau | Correction |
|---|---|---|---|---|
| Paliers : prix, crédits, attente ; ajouter, retirer | REMPLACÉE | A:tts-config.ts:81-86 | N:pages/tts.ts:509, règle graduée | — |
| Paliers : longueur min / max exacte | **MANQUANTE en partie** | A:tts-config.ts:81 | N:pages/tts.ts:96,559,576 | E2 |
| Longueur max, file max, durée max, délai, par viewer | DÉPLACÉE (panneau) | A:tts-config.ts:90-94 | N:pages/tts.ts:~430 | — |
| Enregistrer / Annuler / Restaurer (confirmé) | PRÉSERVÉE, annulation en plus | A:tts-config.ts:145,155 | N:pages/tts.ts:483 | — |
| Pause, reprise | REMPLACÉE : `module_state` au lieu de `/api/tts-lab/moderation`, marche aussi en Production | A:tts-lab.ts:109 | N:pages/tts.ts:595-597 | E3 |
| Stop et rembourser | PRÉSERVÉE, choix avec ou sans remboursement, clé d'intention | A:tts-lab.ts:111 ; E:1655 | N:mod/mod.ts:439 | — |
| Vider la file | PRÉSERVÉE, choix explicite, clé | A:tts-lab.ts:113 ; E:1677 | N:mod/mod.ts:1376 (bouton dès 2 demandes ; à 1 : menu de la ligne) | — |
| Laisser passer, refus, mots surveillés | PRÉSERVÉE / DÉPLACÉE | E:1661,1738,1742 | N:mod/mod.ts:454 ; N:pages/tts.ts:446 | — |
| Rembourser après coup (`refund`) | PRÉSERVÉE, clé stable, meilleure qu'avant | E:1663 | N:mod/mod.ts:1051 | — |
| Fermer le module | DÉPLACÉE depuis Modération | E:1213 | N:pages/tts.ts:595 | — |
| Source OBS, copier, aperçu | REMPLACÉE : scène réelle + lecteur Studio | A:tts-lab.ts:83-87 | N:pages/tts.ts:440-443 | — |
| Historique | REMPLACÉE : « Déjà lus » du stream | A:tts-lab.ts:88 | N:pages/tts.ts:~182 | — |
| Erreur du runtime, « non lancé » | **MANQUANTE** | A:tts-lab.ts:142,151 | N:pages/tts.ts:85,280 | E4 |

### Soundboard
| Fonction | Statut | Ancien | Nouveau | Correction |
|---|---|---|---|---|
| Nom, prix J et cr, délai, mode, volume, actif : mêmes champs, envoi immédiat | PRÉSERVÉE, annulation en plus | A:sound-config.ts:281 | N:pages/soundboard.ts:725-784 | — |
| Protection volume | DÉPLACÉE (panneau) | A:sound-config.ts:94 | N:pages/soundboard.ts:682,887 | — |
| Recherche, filtres, écoute locale, nom d'origine | PRÉSERVÉE | A:sound-config.ts:104,189 | N:pages/soundboard.ts:246,924 | — |
| Lecteur Production chargé au lancement | PRÉSERVÉE (vue montée au démarrage) | A:sound-lab.ts `prime` | N:pages/soundboard.ts:354,367 ; N:main.ts | — |
| File, stop, tout couper, vider, pause | DÉPLACÉE depuis Modération, mêmes commandes | E:1655,1677,1689 | N:mod/mod.ts:1376,1406 ; N:pages/soundboard.ts:859-880 | E3 |
| Catégories | Ajout local, invisible des viewers | — | N:pages/soundboard.ts:790 | — |
| Ajouter, remplacer un fichier | BLOQUÉE (fichiers livrés avec l'extension) | — | N:pages/soundboard.ts:830 | à arbitrer |

### Bonk
| Fonction | Statut | Ancien | Nouveau | Correction |
|---|---|---|---|---|
| Connexion OBS, mémorisation, déconnexion | PRÉSERVÉE, confirmation en plus | A:bonk-lab.ts:82,104 | N:pages/bonk.ts:739,769 | — |
| Zone, Auto / Manuel / Plein écran, source préférée, Copier vers Manuel, Enregistrer | PRÉSERVÉE, même `POST settings` | A:bonk-target.ts:309 | N:pages/bonk.ts:668,859 | — |
| Essai 1, 5, 10 sur OBS | PRÉSERVÉE, plus un essai local | A:bonk-lab.ts:35 | N:pages/bonk.ts:714 | — |
| Prix et délai du Bonk | **Confirmation perdue** | A:module-settings.ts:111 | N:pages/bonk.ts:686 | E1 |
| Remboursement d'un Bonk fini ; pas de retrait d'un Bonk parti | PRÉSERVÉE, conforme au Core | E:1322 ; C:bonk-lab/bonk-lab-service.ts:894 | N:mod/mod.ts:986 ; N:pages/bonk.ts:897 | — |
| Catalogue d'emotes | Ajout, BLOQUÉ hors Lab (déjà tranché) | — | N:pages/bonk.ts:346 | — |

### Spotify
| Fonction | Statut | Ancien | Nouveau | Correction |
|---|---|---|---|---|
| Ouvrir, fermer, skip, retirer et rembourser, rembourser ou garder, quotas, valeurs historiques, exceptions, connexion, récompense, simulateur | PRÉSERVÉE : mêmes routes, mêmes corps, mêmes confirmations | A:spotify.ts:149-305 | N:pages/spotify.ts:224-435 | — |
| Conditions des boutons d'une ligne (file, à vérifier, recherche) | PRÉSERVÉE | A:spotify-view.ts `requests` | N:pages/spotify-view.ts:372-397 | — |
| Refus, états, statut Twitch | PRÉSERVÉE, tables identiques (diff vide) | A:spotify-ui.ts:191-233 | N:pages/spotify-view.ts:179-221 | — |
| Fin du live | Ajout d'information, exacte | — | N:pages/spotify-panel.ts ; C:spotify/service.ts:203 | — |

### Tombola
| Fonction | Statut | Ancien | Nouveau | Correction |
|---|---|---|---|---|
| Lancer, Super, +30 s, pause, reprise, tirer, annuler (confirmé) | PRÉSERVÉE, mêmes commandes | A:tombola.ts:1279-1312 | N:pages/tombola.ts:608-628,698-705 | — |
| Tirer depuis Modération : confirmé | PRÉSERVÉE | E:1547 | N:pages/moderation-desk.ts:534 | — |
| Tirer depuis la page : sans confirmation | PRÉSERVÉE, comme l'ancienne page | A:tombola.ts:1306 | N:pages/tombola.ts:704 | — |
| Ajout manuel, forçage d'un bloqué (tracé), retrait | PRÉSERVÉE, passe par `/api/lab/actions` au lieu de `/api/raffle/actions`, même `raffle.act` | A:tombola.ts:1330-1357 | N:mod/mod.ts:855 ; N:pages/tombola.ts:649 | — |
| Relancer un paiement | PRÉSERVÉE, dit aussi l'échec | A:tombola.ts:1364 | N:pages/tombola-history.ts:141 | — |
| Tous les champs de `RaffleConfig` | PRÉSERVÉE, vérifié champ par champ | A:tombola.ts:1420-1640 | N:pages/tombola.ts:746-930 ; tombola-ticket.ts ; tombola-panel.ts | — |
| Automatique, pause, sons, commandes, instruction, noms, durées, stream simulé | PRÉSERVÉE / DÉPLACÉE (panneau) | A:tombola.ts:1385-1410 | N:pages/tombola-panel.ts:72-302 | — |
| Stream simulé bloqué en Production | PRÉSERVÉE | S:raffle-lab/runtime.ts:284 | idem | — |
| « Nouvelle » après une manche | REMPLACÉE : « Terminer » puis le ticket | A:tombola.ts:1023 | N:pages/tombola.ts:706 | — |
| Comparer avec l'extension, historique, fiche | PRÉSERVÉE | A:tombola.ts:304,1238 | N:pages/tombola.ts:585 | — |
| État du module (Ouvert, Pause, Fermé) | DÉPLACÉE depuis Modération | E:1213 | N:pages/tombola.ts:739 | E3 |
| Fermer sans tirer ; Future monnaie | OBSOLÈTE (PARITE.md, `raffle_close` = tirage) | — | — | — |

### Alertes
| Fonction | Statut | Ancien | Nouveau | Correction |
|---|---|---|---|---|
| Aperçu, arrêter, superposer, volume, fausses données | PRÉSERVÉE | A:alerts-tab.ts:372-420 | N:pages/alerts.ts:310,331 | — |
| Timeline ±1 image, ±0,01 s | REMPLACÉE : flèches, Maj + flèches | A:alerts-tab.ts:108-112 | N:pages/alerts.ts:1203 | — |
| Réglage de placement, enregistrer | REMPLACÉE, même `PUT /placement/:id` | A:alerts-calibrate.ts | N:pages/alerts.ts:655 | — |
| Envoyer en file (confirmé en Production) | PRÉSERVÉE, résultats nommés | A:alerts-tab.ts ~`queue` | N:pages/alerts.ts:727 | — |
| Vider la file (confirmé) | PRÉSERVÉE, aussi depuis la Régie | A:alerts-tab.ts:379 ; A:regie.ts:344 | N:pages/alerts.ts:758 ; N:shell/regie.ts:468 | — |
| Rejouer depuis l'historique | Ajout, route du Dock (animation seule) | — | N:pages/alerts.ts:781 ; S:alerts/runtime.ts `/replay` | — |
| Mode Twitch Off, Test, Actif (Actif confirmé, verrouillé en Production) | PRÉSERVÉE | A:alerts-twitch.ts | N:pages/alerts-sources.ts:617 | — |
| Mode Twitch verrouillé si indisponible | **MANQUANTE** | A:alerts-twitch.ts:151 | N:pages/alerts.ts:491 ; alerts-sources.ts:497 | E5 |
| StreamElements : mode, jeton chiffré, oublier, état, journal | PRÉSERVÉE | A:alerts-se.ts | N:pages/alerts-sources.ts:639,741,747,533 | — |
| Variantes par famille, Follow | PRÉSERVÉE, poids en plus | A:alerts-variants.ts | N:pages/alerts.ts:911,1012 | E7 |
| Rejouer l'aperçu ; Calibrer ; Masquer les cadres | OBSOLÈTE (PARITE.md) | — | — | — |

### Roue du Sub
| Fonction | Statut | Ancien | Nouveau | Correction |
|---|---|---|---|---|
| Activer, mode, invitations, délai d'annonce, tests | PRÉSERVÉE, mêmes confirmations | A:sub-wheel.ts:213,300,315,367 ; `change` mode | N:pages/sub-wheel.ts:312,444,468,482,496 | — |
| Tirer, confirmer vue, rejouer | PRÉSERVÉE | A:sub-wheel.ts:230-256 | N:pages/sub-wheel.ts:360-394 | — |
| Décider une vérification, double confirmation de fusion | PRÉSERVÉE, motif obligatoire | A:sub-wheel.ts:273 | N:pages/sub-wheel.ts:415 | — |
| Gain crédité à la main, annulé (note obligatoire) | PRÉSERVÉE | A:sub-wheel.ts:379 | N:pages/sub-wheel.ts:553 | — |
| Conditions de boutons (`mergeable`, `canReplay`, `pending`, `blocked`) | PRÉSERVÉE, relues | A:sub-wheel-view.ts | N:pages/sub-wheel-view.ts:~395-560 | — |
| Accorder, lancer, rattraper, rejouer, relancer, clés uniques | PRÉSERVÉE | A:sub-wheel-rights.ts:146,181-208 | N:pages/sub-wheel-rights.ts:120,175-229 | — |
| Simulateurs du Lab | PRÉSERVÉE | A:sub-wheel.ts:329-353 | N:pages/sub-wheel.ts:512-537 | — |
| Roue et gains affichés | Ajout, même table que le Core | — | N:pages/sub-wheel-stage.ts:1 | — |
| Saisie protégée pendant les relevés | **MANQUANTE** | A:sub-wheel.ts:60,77 | N:pages/sub-wheel.ts:216 | E6 |

### Random Ban
| Fonction | Statut | Ancien | Nouveau | Correction |
|---|---|---|---|---|
| Animation, tirage à blanc, mute réel, sanction Caution réelle : mêmes routes et corps | PRÉSERVÉE, confirmation ajoutée sur l'animation | A:random-ban.ts:62-93 | N:pages/sanctions-random-ban.ts:157,187 | — |
| État exécuteur, lecteur, médias, micro, suivi, historique, remboursement dû | PRÉSERVÉE | A:random-ban-view.ts | N:pages/sanctions-model.ts:201-334 | — |
| Prix `random_ban.price` confirmé | DÉPLACÉE (panneau) | A:channel-points.ts:130 | N:pages/sanctions-random-ban.ts:91 ; setting-rows.ts | — |

### Votekick et Caution
| Fonction | Statut | Ancien | Nouveau | Correction |
|---|---|---|---|---|
| Durée du vote, son, import, pré-écoute, enregistrer | PRÉSERVÉE, mêmes routes | A:votekick-config.ts:95,114,125 | N:pages/sanctions-votekick.ts:253,295,313 | — |
| Délais et durées d'exclusion, confirmés | DÉPLACÉE (panneau) | A:channel-points.ts:155 | N:pages/sanctions-votekick.ts:180 | — |
| Overlay dans la page | Ajout : lecture seule, sans son, aucun effet Core vérifié | — | N:pages/sanctions-votekick.ts:39 ; S:votekick/runtime.ts:242 | — |
| Caution : lecture seule, tarifs confirmés, à vérifier, historique | PRÉSERVÉE | A:caution-view.ts ; A:channel-points.ts:141 | N:pages/sanctions-caution.ts ; sanctions-model.ts:434-484 | — |
| Devis simulé | Ajout, formules partagées du Core, rien n'est débité | — | N:pages/sanctions-caution.ts:83 | — |

### Dock OBS, Récompenses, Effets, Régie
| Fonction | Statut | Ancien | Nouveau | Correction |
|---|---|---|---|---|
| Dock : adresse masquée, copier, nouvelle clé confirmée, état | DÉPLACÉE (panneau Alertes) | A:dock-panel.ts:59,76 | N:pages/alerts-sources.ts:354,677 | — |
| Interrupteur des automatisations, confirmé | PRÉSERVÉE | A:channel-points.ts:410 | N:pages/rewards.ts:705 ; N:pages/regie.ts:162 | — |
| Règles : mêmes types, `expected_version`, conflit | PRÉSERVÉE, ordre des actions en plus | A:channel-points.ts:442 | N:pages/rewards.ts:503,552 | — |
| Tester pour de vrai, confirmé, avec texte FX Cam / Couleur Cam | PRÉSERVÉE, bloqué si non enregistré | A:channel-points.ts:466 | N:pages/rewards.ts:526 ; N:pages/effects.ts:218 | — |
| Sources OBS suggérées, écoute locale, historique | PRÉSERVÉE | A:channel-points.ts:192,422 | N:pages/rewards.ts:141,620 | — |
| Lecteur d'effets, médias manquants | PRÉSERVÉE, détaillé | A:channel-points-view.ts:311 | N:pages/effects.ts:122-185 | — |
| `fx_cam.price` confirmé | DÉPLACÉE | A:channel-points.ts:131 | N:pages/effects.ts:206 | — |
| Régie : Tombola, TTS, vider les alertes | REMPLACÉE, `module_state` et `stop_current` au lieu de `/api/tts-lab/moderation` | A:regie.ts:335-366 | N:shell/regie.ts:457-505 | — |
| Régie : Sons en pause, décisions dans la file | Ajout | — | N:shell/regie.ts:507 ; N:pages/regie.ts:199 | — |

## Ce que le Core sait faire et qu'aucune page n'expose

Rien de manquant pour le streamer. Routes non appelées par le web, ancien comme nouveau :
- `raffle_open`, `raffle_close`, `raffle_draw` : console minimale d'origine, remplacée par les commandes V2 (`C:raffle-lab`).
- `/v1/lab/bonk/viewers*`, `/v1/lab/tts/.../audit` : aucun appel web des deux côtés ; l'audit passe par Modération.
- Roue `/viewers/:id`, `/accept`, `/team/rights` : surfaces viewer et équipe de l'extension.
- Claims, ACK, `/alerts/items/:id` : exécuteurs, pas de l'interface.

## Vérifié et hors écart

- **Idempotence** : `remove:<id>:<refund>`, `refund:<id>`, clé par dialogue pour purge, stop tout et wallet (`N:mod/mod.ts`), relayée par `S:lab-moderation/proxy.ts`. Égale ou meilleure qu'avant : l'ancien `refund` et l'ancienne purge n'envoyaient pas de clé propre (`E:1663,1677`).
- **Production** : les nouveaux appels des pages passent par les routes autorisées du cockpit (`moderation`, `raffle`, `tts/rules`, `sound/*`) ou restent locaux à Studio (`/api/tts-lab/live`, `/api/sound-lab/library`). Vérifié par lecture de `C:http/studio-cockpit-routes.ts`, pas exécuté.
- **Module Bonk** : aucune file gardée ni annulée, conforme à `C:bonk-lab/bonk-lab-service.ts:923`.

## Non vérifié ici

Rendu réel, profil Production, Electron, OBS, Twitch. Tout ce document vient de la lecture du code. Les fonctions de Modération pure (Équipe, permissions, Journal, Restrictions) sont hors de ce périmètre, sauf les commandes partagées par `mod/mod.ts`.

**Worktree mouvant** : pendant cet audit, un autre travail a modifié sans commit `pages/tts.ts`, `pages/alerts-sources.ts`, `S:tts-lab/runtime.ts` et d'autres fichiers (import de médias du Lab, viewers fictifs). Base de lecture : commit bdb6d12. Les numéros de ligne de ces deux pages peuvent différer de quelques lignes dans la copie de travail. Aucun fichier du dépôt n'a été modifié par cet audit.
