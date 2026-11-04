# Refonte de Raptoru Studio — roadmap

Lots d'Astra (étude § E.4) adaptés à ce qui a réellement été fait. Quatre niveaux, jamais confondus :
**Code** (développé) · **Tests** (automatiques : unitaires, E2E sur pile isolée, captures) · **Validé** (essayé à la main
par Antoni) · **Publié** (release Studio). À ce jour : rien n'est validé ni publié ; tout est sur `feat/studio-ux`
(locale). « Habillé » = seules la palette et/ou la petite largeur ont été traitées, la composition est l'ancienne.

## Vue d'ensemble

| Lot | Périmètre | Code | Tests | Validé | Publié | Commit |
|---|---|---|---|---|---|---|
| 0 | Vérité des états (bandeau profil, textes périmés) | terminé | unitaires + captures | non | non | a08a249 |
| 1 | Shell : navigation, registre, favoris, Ctrl+K, supervision compacte, hubs | terminé | unitaires + captures 3 largeurs | non | non | a08a249 |
| DS | Design system `rs-` | en place, à étendre | via les vues | non | non | a08a249 → 4282312 |
| 2 | Défis | terminé | E2E + unitaires | non | non | a08a249 |
| 3 | Boutique | terminé | E2E (3) | non | non | a08a249 |
| 4 | Récompenses Twitch + modules réglés dedans | partiel | E2E indirects, captures | non | non | a08a249, b1aab1f |
| 7a | Régie live | partiel | unitaires + essai pile isolée | non | non | 1d8992a, b1aab1f |
| C1 | Progression | terminé | E2E | non | non | f5c5b0d |
| H | Harmonisation des vues historiques | habillé seulement | captures 480/1024 | non | non | 4282312 |
| 5 | Chaîne audio / visuelle (Alertes, Soundboard, TTS, Bonk, Effets) | non commencé | — | — | — | — |
| 6 | Autres outils (Tombola, Commandes, Jeu des mots, Mini-jeux, Halloween, Modération) | non commencé | — | — | — | — |
| 7b | Activité | hub minimal | — | — | — | a08a249 |
| 8 | Système | habillé seulement | — | — | — | 4282312 |
| 9 | Laboratoire et simulations (Extension Lab, Simulation, Test Lab) | non commencé | — | — | — | — |
| 10 | Clôture de la coexistence (styles historiques, alias) | non commencé | — | — | — | — |
| SB | Storyboard | bloqué (introuvable) | — | — | — | — |
| V | Validation dans le vrai Studio (Electron) par Antoni | à faire | — | — | — | — |

## Détail

### Lot 0 — vérité des états — terminé (code)
- Fait : bandeau dérivé du profil effectif (« Production … actions réelles », « Profil Lab · Core local · paiements
  simulés », « Profil non confirmé ») ; plus de « paiement simulé » en Production ; SAMMI retiré des textes ; ligne
  « Économie » dans Système ; message de sortie réelle de la simulation corrigé.
- Reste : appliquer la grille PRODUCTION / LAB / SIMULATION / APERÇU (CONTEXTE § 7) à chaque écran → lot 9.

### Lot 1 — shell — terminé (code)
- Fait : `shell/` (registre de 30 pages, 6 destinations + Laboratoire), favoris, récents, Ctrl+K, fil d'Ariane, `?p=` +
  alias `?tab=`, historique, tiroir < 900 px, supervision une ligne par incident avec « Vu », Centre de contrôle,
  catalogue Modules, hubs Communauté / Activité / Laboratoire. Chaque vue montée une seule fois (`main.ts`).
- Tests : `studio-shell.test.ts` (alias, unicité, atteignabilité, recherche, favoris) ; captures 1440 / 1024 / 480.
- Critère de réussite restant : validation dans Electron (lot V).

### Lot 2 — Défis — terminé (code)
- Fait : catalogue (état vide expliqué), atelier en 3 sections visibles + résumé + vérification Core sans écriture,
  brouillon / activation / recomptage séparés, confirmations avec portée réelle, suivi en page propre.
- Tests : E2E `challenges` (création, vérification, activation rétroactive payée une fois, recomptage sans double
  versement, suspension) ; unitaires `challenges-form`.
- Ouvert : 3 questions métier (CONTEXTE § 13), règles inchangées.

### Lot 3 — Boutique — terminé (code)
- Fait : catalogue filtrable, atelier Type · Présentation · Apparence · Disponibilité · Offres avec l'aperçu raptoru.fr
  réel, onglet Achats et dons, remboursement expliqué.
- Tests : E2E `cosmetic-shop`, `cosmetic-edit`, `cosmetic-frames`, `halloween-titles`.

### Lot 4 — Récompenses Twitch — partiel
- Fait : récompenses affichant leurs actions ; une page par module réglé dans cette vue (Effets, Spotify, Random Ban,
  Caution, Votekick, Roue du Sub) via `setFocus`, avec ses déclencheurs réels ; coupure / activation confirmées
  (achats jamais rejoués, points non remboursés par Raptoru).
- Pas fait : l'éditeur de règles et l'historique sont les anciens (habillés) ; les pages Spotify, Random Ban, Caution,
  Votekick, Roue du Sub affichent leurs anciens panneaux ; libellé « Tester » (exécution réelle) à clarifier.
- Prochaine étape : refondre l'éditeur de règles (déclencheur → actions) sur les primitives.

### Lot 7a — Régie live — partiel
- Fait : incidents ; points de chaîne (état + coupure nommée) ; files Tombola, Alertes, TTS, Spotify lues sur les routes
  des modules ; actions Tombola pause / reprise / annulation, TTS pause / reprise / arrêt (Lab ; Production → Modération) ;
  liens vers les contrôles de chaque module ; aucun « arrêter tout ».
- Tests : unitaires (états, actions présentes seulement où elles s'appliquent, textes de confirmation) ; essai sur pile
  isolée : Tombola fictive mise en pause puis annulée.
- Pas fait : Roue du Sub, Random Ban, Jeu des mots, Halloween dans la Régie ; actions de file des Alertes (aucune route
  de file côté Studio aujourd'hui) ; vérification en Production (interdite sans GO).

### C1 — Progression — terminé (code)
- Fait : onglets Viewers · Titres et badges · Règles d'XP · Reprise WizeBot ; fiche viewer en indicateurs ; désactivation
  confirmée. Tests : E2E `progression-studio`.

### H — harmonisation — habillé seulement
- Fait : palette de la charte appliquée aux vues historiques (variables), boutons arrondis ; plus de défilement
  horizontal de page à 480 / 1024 px sur les 29 pages (Tombola et Soundboard défilent dans leur vue).
- Ce n'est **pas** une refonte : Alertes, Soundboard, TTS, Bonk, Tombola, Commandes, Modération, Jeu des mots,
  Halloween, Simulation, Test Lab, Extension Lab, Système gardent leur ancienne composition.

### Lot 5 — chaîne audio / visuelle — non commencé
- Alertes (éditeur, aperçu, calibrage, file, source OBS, événements réels, variantes, StreamElements), Soundboard,
  TTS, Bonk, Effets et lecteur d'effets. Dépend du DS. Critères : aucune capacité perdue, aperçu local identifié comme
  tel, E2E `alerts`, `players`, `effects-player`, `dock` verts.
- **Prochaine tâche de la refonte : Alertes.**

### Lot 6 — autres outils — non commencé
- Tombola (live, préparation, historique), Commandes (V2 : éditeur, droits, étapes), Jeu des mots, Mini-jeux, Halloween,
  Modération (D4, sanctions, remboursements, équipe, audit). Désormais refondables (décision du 04/11) ; capacités
  conservées. E2E concernés : `tombola-bonbons`, `commands-public`, `halloween*`.

### Lot 7b — Activité — hub minimal
- Fait : historique des coupures + liens. Reste : historiques des modules consultables ici (lecture seule, sans copie).

### Lot 8 — Système — habillé seulement
- Fait : titre « Système », « État des services ». Reste : recomposer profil, connexions (Twitch, OBS, lecteurs),
  runtime, mises à jour.

### Lot 9 — Laboratoire et simulations — non commencé
- Classer chaque outil (CONTEXTE § 7) : utile / redondant / historique / trompeur / diagnostic réel ; séparer dans le
  widget « Simulation de stream » les actions réelles (ingestion du chat Twitch, sortie par LeCroupier_) ; réorganiser
  l'Extension Lab (surfaces, rôles, identité, cartes TTS / Bonk) sans le dégrader ; sort du Test Lab « temporaire ».
- Avant toute suppression : usages, dépendances, tests ; ne jamais retirer un outil nécessaire à l'extension, aux
  lecteurs OBS ou aux événements Twitch.

### Lot 10 — clôture — non commencé
- Retirer les styles historiques devenus inutiles (quand plus rien ne les utilise) ; décider du sort des alias `?tab=`.

### Lot V — validation
- Session de validation par Antoni quand plusieurs ensembles sont refondus ; puis, sur GO, commit / push / release.

## Régressions et instabilités connues

- Aucune régression connue introduite par la refonte.
- E2E instables sous charge (non liés) : `effects-player`, `tombola-bonbons` (bloqué une fois), `alerts` « families »,
  `progression-studio` ; passent relancés seuls.
- Le widget « Simulation de stream » mélange encore actions simulées et réelles (lot 9).
