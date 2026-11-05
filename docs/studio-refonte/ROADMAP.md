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
| **F0** | Audit fonctionnel + correctifs sûrs (Soundboard au lancement, live simulé refusé en Production, mini-jeux, Caution, Test Lab, Boutique) | terminé | unitaires + E2E cosmétiques | non | non | 0675b9b, cde6c4f, a49178a |
| F1-F7 | Lots fonctionnels de l'audit (ci-dessous) ; décisions H1-H16 du 05/11 (CONTEXTE § 18) | en cours | oui (F1, F2, F4 en partie, H2-H5, H8, H11, H13, H15, H16) | oui (tests automatiques) | non | non |

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

### Lots fonctionnels (audit du 04/11) — [AUDIT_FONCTIONNEL.md](AUDIT_FONCTIONNEL.md) § G-I

Un module n'est refondu qu'une fois : quand un lot UX touche une page, il embarque les points fonctionnels de ce module.

| Lot | Contenu | Livré par | Joint au lot UX | Attend |
|---|---|---|---|---|
| F1 Vérité des états | P0-7 échec Production visible, P0-8 pas de vert sur une intention seule, P1-13 libellés de portée, « Tester » renommé | Studio | 7a, 8, 9 | — |
| F2 Argent et files | P0-1 expiration des travaux OBS (points de chaîne), P0-2 clés par formulaire (Modération, Boutique), P0-3 frontière de la roue, P0-4 garde Core du live simulé, P0-6 Spotify à blanc, P1-7 file d'alertes | Core + Studio | 4, 5 | H2, H3 ; GO de déploiement |
| F3 Bot et live | P0-5 live manqué / retard Helix, P0-9 identité du bot (lecture Coolify), fonctions remontées, P1-10 instantané des abonnés, P2-9 | bot (+ Core) | — | H9 ; GO de déploiement |
| F4 Centre de contrôle et préparation du live | P1-1 « Prêt pour le live », P1-2 fournisseurs par module, P1-3 configuration effective, P1-4 supervision, P1-9, P1-11 | Core (lecture) + Studio | Centre, Régie | — |
| F5 Reprise propre | P1-5 restauration OBS à la fermeture, P1-6 exécuteurs avec porte OBS, P1-8 démarrage avec Windows, P2-8 | Studio | 8 | — |
| F6 Réglages essentiels | P1-12 pages Mini-jeux et Votekick, P2-5 à P2-7 | Core + Studio | 4, 6 | H8, H10, H12-H16 |
| F7 Cycle du live | P2-1 session unique, P2-2 variables = plafond, P2-3 règle de live, P2-4 fin de live | Core + bot + Studio | — | H1, H6 |

Ordre recommandé : F1 → F2 → F4 → F3 → F5 → F6 (au fil des pages) → F7.

**État au 05/11** (codé et testé automatiquement ; rien de validé par Antoni ni publié) :

| Lot | Fait | Reste |
|---|---|---|
| F1 | Régie sans vert sur une intention (points de chaîne, TTS, Spotify sur l'admission réelle du Core, source d'alertes) ; échec Production visible ; « Exécuter maintenant (réel) » + Spotify à blanc ; libellés réels (Alertes, Random Ban, Modération) ; Extension Lab « joue sur OBS » | — |
| F2 | P0-2, P0-3, P0-4, H2, H3, H4 | — |
| F3 | P0-5 (bot : événement de live rejoué tant que le Core ne l'a pas enregistré) ; H9 (complément de fidélité) | pont des jeux et fenêtre de confiance Helix ; P2-9 ; P1-10 alerte sur l'âge du relevé des abonnés |
| F4 | « Prêt pour le live » (18 contrôles, lecture seule) | relance au passage en live + notification ; P1-3 configuration effective détaillée ; P1-4 supervision du lecteur d'effets et des overlays |
| F5 | P1-5 : micro et filtres rétablis à la fermeture | avertir avant de quitter pendant un effet (Electron) ; P1-6 ; P1-8 |
| F6 | H8, H10 (`!rb`, `!fxcam`, Bonk, **mini-jeux et Duel** via le socle, `e08d1a5`), H12, H13, H14, H15, H16 ; page Mini-jeux = carte du module | H10 : Caution, Votekick (même mécanisme) ; page Votekick |
| F7 | H1, H5, H6 | P2-1 session de live unique (`lab_stream_sessions` miroir), P2-2 variables = plafond |

**Ordre de déploiement à respecter le jour du GO** :
- migrations avant le Core : `20261121130000` (roue), `20261121140000` (Jeu des mots), `20261121160000` (réglages) ;
- Core, bot et Studio ensemble (une ancienne version de Studio n'envoie pas la clé exigée par « Créditer / Débiter ») ;
- **H1 change la Production** : hors live, plus aucun achat lié au stream ; à annoncer aux viewers ;
- l'extension (H15, P0-2 de la console partagée, texte `stream_offline`) par Antoni.

### Opération fondation totale (05/11) — consolidation et migrations, [architecture/MIGRATIONS.md](architecture/MIGRATIONS.md)

Codé et testé automatiquement, vu en navigateur sur la pile isolée ; rien de validé par Antoni ni publié.

| Fait | Commit |
|---|---|
| Porte chat des modules | `0148b26` |
| 13 constats d'une revue indépendante corrigés (dont un P0 latent : achat forgé par le cockpit) | `77e614d` |
| D4 › « Autres modules » (extension et Studio) | `104acb7`, `d080506` |
| `createStudioServer` en options nommées | `f354ead` |
| Adaptateur Votekick | `c026907` |
| Adaptateur Caution | `957bcc3` |
| Adaptateurs d'état Random Ban, Jeu des mots, Boutique d'événement | `ec2f170` |
| Page du socle en tuiles, panneau de réglages compact | `4c97661` |

Reste :
- adaptateurs Roue du Sub, Spotify, Points de chaîne ;
- exécuteur OBS générique ;
- extraction de `ui.js` ;
- Bonk, Soundboard, TTS et Tombola hors de l'hôte (D20).

**Déploiement** (le jour du GO), migrations dans cet ordre :
1. `20261121160000` (réglages) ;
2. `20261121180000` (journal des modules, avec les colonnes de réservation) ;
3. `20261121190000` (origine chat `module:<id>`, liste du Core principal).

### Socle modulaire (mission fondatrice du 05/11) — [architecture/](architecture/)

Codé et testé automatiquement ; rien de validé par Antoni ni publié.

- Fait : contrat de module et hôte (`e780437`), Studio (`037a7db`), extension (`8a2d862`), modération des modules
  depuis l'extension et correction de la liste blanche Lab (`8ef2912`), démonstration C mini-jeux (`e08d1a5`),
  générateur et contrôle de navigation (`5a418f1`).
- Reste (secondaire, voir `architecture/PREUVES.md` § Limites) :
  - migrer les modules historiques un par un quand ils sont retouchés ;
  - onglet « Modules » de la console D4 : **à arbitrer** (DECISIONS D11) ;
  - paramètres positionnels de `createStudioServer` (S1) ;
  - réponses chat des modules du socle (origine `cmd_steps` en CHECK SQL) ;
  - migration `module_activity` de Production le jour du premier module non `labOnly` avec journal.

## Régressions et instabilités connues

- Aucune régression connue introduite par la refonte.
- E2E instables sous charge (non liés) : `effects-player`, `tombola-bonbons` (bloqué une fois), `alerts` « families »,
  `progression-studio` ; passent relancés seuls.
- Le widget « Simulation de stream » mélange encore actions simulées et réelles (lot 9). En Production, le live simulé en
  est retiré et l'interrupteur mini-jeux est annoncé réel (`0675b9b`).
- Régression de la refonte corrigée (`0675b9b`) : le lecteur Soundboard de Production n'était chargé qu'à l'ouverture de
  Système (page par défaut devenue le Centre de contrôle).
- E2E `tombola-bonbons` : échoue (délai dépassé en attendant les Bonbons des gagnants) seul et aussi sur `f1f1b03`, sans
  les changements de l'audit. Défaut antérieur, cause non analysée.
