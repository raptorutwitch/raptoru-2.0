# Modération V2 — matrice de parité D4

Référence : `prototypes/moderation-v2-d4/` (spécification fonctionnelle et UX). Parcours exhaustif de
`shared/core.js` (état, actions, dialogues, menus) et `shared/shell.js` (écrans, drawers, filtres),
scénarios Calme / Chargé / TTS surveillé, rôles Mod / Supermod / Broadcaster, 4 surfaces.

## 1. Matrice initiale (avant la passe — HEAD `a5b5d5e`)

Colonnes : UI = présent dans la console extension · Back = backend Core · Donnée = persistance ·
Action = commande réelle · Test = test automatique · Travail = ce qu'il faut faire.
« ~ » = partiel, « mq » = affiché « backend manquant / à venir ».

### Structure, navigation, surfaces

| #   | Élément D4                                                                               | UI  | Back | Donnée | Action | Test | Travail nécessaire                                            |
| --- | ---------------------------------------------------------------------------------------- | --- | ---- | ------ | ------ | ---- | ------------------------------------------------------------- |
| 1   | 3 modes (Window ≥ 900 : colonne viewer ; Video 560–899 ; Compact < 560 : pile + accueil) | oui | —    | —      | —      | ~    | vérifier tous les nouveaux drawers/dialogues dans les 3 modes |
| 2   | Recherche « Viewer… » : « Actifs récemment » / « Résultats », Entrée, Échap, vide        | oui | oui  | ~      | oui    | ~    | Core : annuaire viewers (tous modules + équipe)               |
| 3   | Ligne de recherche : badge restriction (bloc / cooldown) + rôle                          | non | non  | non    | —      | non  | Core : restriction + rôle dans la recherche                   |
| 4   | Colonne modules : icône, nom, point d'état, résumé, barre de progression TTS             | oui | oui  | oui    | —      | ~    | —                                                             |
| 5   | Pastille « N à vérifier » sur TTS                                                        | non | non  | non    | —      | non  | Core : mots surveillés + statut de revue                      |
| 6   | Résumé Tombola « Ouverte · N » / « Fermée »                                              | mq  | non  | non    | —      | non  | Tombola minimale dans Core                                    |
| 7   | Lien « Historique »                                                                      | oui | ~    | ~      | —      | ~    | Core : historique paginé filtré                               |
| 8   | Pied : pastille « En direct » / « Pause globale » (menu)                                 | mq  | non  | non    | non    | non  | Core : pause globale                                          |
| 9   | Pied : bouclier « Équipe et permissions »                                                | ~   | non  | non    | non    | non  | Core : équipe + permissions fines                             |
| 10  | Bandeau « Pause globale · nouvelles interactions refusées (N) » + « Lever »              | non | non  | non    | non    | non  | Core : pause globale + compteur de refus                      |
| 11  | En-tête de volet : retour, kicker, titre, actions, fermeture (colonne viewer)            | oui | —    | —      | —      | ~    | —                                                             |
| 12  | Infobulles, toasts, menus, drawers dans le volet qui les ouvre, dialogues, Échap ordonné | oui | —    | —      | —      | ~    | —                                                             |

### Module TTS

| #   | Élément D4                                                                                | UI  | Back | Donnée | Action | Test | Travail nécessaire                       |
| --- | ----------------------------------------------------------------------------------------- | --- | ---- | ------ | ------ | ---- | ---------------------------------------- |
| 13  | Bouton d'état (Actif / En pause / Désactivé) + verrou « Désactivé » sans permission       | ~   | ~    | oui    | oui    | ~    | permission fine « Désactiver un module » |
| 14  | Note d'état (en pause · file conservée / désactivé) + « Réactiver » (verrou si désactivé) | oui | ~    | oui    | oui    | ~    | idem                                     |
| 15  | En cours : viewer, texte dépliable, heure, temps restant, Stop (menu), progression        | oui | oui  | oui    | oui    | oui  | —                                        |
| 16  | En attente · N · « M à vérifier »                                                         | ~   | ~    | ~      | —      | ~    | mots surveillés                          |
| 17  | Ligne en attente : texte surligné (`<mark>`), tag « À vérifier » (infobulle « Contient ») | ~   | non  | non    | —      | non  | Core : occurrences surveillées           |
| 18  | Menu module TTS : « Surveillance (mots) »                                                 | mq  | non  | non    | non    | non  | Core : liste de mots + permission        |
| 19  | Menu module : « Historique TTS »                                                          | oui | ~    | ~      | —      | ~    | historique Core                          |
| 20  | Menu module : « Purger toute la file… »                                                   | oui | oui  | oui    | oui    | oui  | remboursement ouvert à tout mod (D4)     |

### Module Soundboard

| #   | Élément D4                                                            | UI  | Back | Donnée | Action | Test | Travail nécessaire                                     |
| --- | --------------------------------------------------------------------- | --- | ---- | ------ | ------ | ---- | ------------------------------------------------------ |
| 21  | En cours · N : son, viewer, temps restant, progression                | oui | oui  | oui    | —      | ~    | —                                                      |
| 22  | Stop d'un son en cours (menu : Stop + / sans remboursement)           | mq  | non  | non    | non    | non  | Core → worker → lecteur → ACK `stopped` → Core         |
| 23  | En attente · N (retirer + / sans remboursement)                       | ~   | ~    | oui    | ~      | ~    | débit wallet Lab + remboursement                       |
| 24  | Menu : « Stop tous les sons… » (désactivé si < 2 en cours) + dialogue | mq  | non  | non    | non    | non  | Core `stop_all` + worker/lecteur                       |
| 25  | Menu : « Historique Soundboard », « Purger toute la file… »           | ~   | ~    | oui    | ~      | ~    | purge + remboursement                                  |
| 26  | Échec avant lecture « remboursé automatiquement »                     | non | non  | non    | non    | non  | débit + remboursement automatique (échec / expiration) |

### Module Bonk

| #   | Élément D4                                                  | UI  | Back | Donnée | Action | Test | Travail nécessaire                  |
| --- | ----------------------------------------------------------- | --- | ---- | ------ | ------ | ---- | ----------------------------------- |
| 27  | « Instantané » + derniers bonks (viewer, emote, il y a…)    | oui | oui  | oui    | —      | oui  | —                                   |
| 28  | Coût du bonk (historique, Activité Jetons)                  | non | non  | non    | —      | non  | débit wallet Lab (+ remb. si échec) |
| 29  | Menu : « Historique Bonk » ; état Actif / Pause / Désactivé | oui | oui  | oui    | oui    | oui  | —                                   |

### Module Tombola

| #   | Élément D4                                                               | UI  | Back | Donnée | Action | Test | Travail nécessaire                                |
| --- | ------------------------------------------------------------------------ | --- | ---- | ------ | ------ | ---- | ------------------------------------------------- |
| 30  | Carte : Ouverte / Fermée, « ferme dans », participants, tickets, jackpot | mq  | non  | non    | —      | non  | Tombola minimale Core (modèle réel : inscription) |
| 31  | Dernier tirage : + montant, gagnant, « payé », heure → mouvement         | mq  | non  | non    | —      | non  | tirage Core + paiement wallet Lab (ledger)        |
| 32  | Derniers tickets (heure, viewer, ×N, coût) → demande                     | mq  | non  | non    | —      | non  | inscriptions Core                                 |
| 33  | « Ouverture, tirage et fermeture : Studio. »                             | oui | non  | non    | non    | non  | commandes Studio → Core                           |
| 34  | État Actif / En pause / Désactivé + Historique Tombola                   | mq  | ~    | ~      | non    | non  | état module raffle + historique                   |

### Menus et dialogues d'action

| #   | Élément D4                                                                                | UI  | Back | Donnée | Action | Test | Travail nécessaire                           |
| --- | ----------------------------------------------------------------------------------------- | --- | ---- | ------ | ------ | ---- | -------------------------------------------- |
| 35  | Menu demande : en-tête, Laisser passer, Stop/Retirer ± rembourser, Ouvrir le viewer, Voir | ~   | ~    | ~      | ~      | ~    | Laisser passer ; remboursement tout mod ; SB |
| 36  | Dialogue pause / désactivation : Garder la file / Annuler + rembourser (somme)            | oui | ~    | oui    | ~      | ~    | remboursement SB ; permission fine           |
| 37  | Dialogue purge : ± rembourser, case de confirmation, « Purger »                           | oui | ~    | oui    | ~      | ~    | SB remboursable                              |
| 38  | Dialogue « Stop tous les sons »                                                           | mq  | non  | non    | non    | non  | Core `stop_all`                              |
| 39  | Menu global + dialogue « Pause globale » (action sensible, confirmation)                  | mq  | non  | non    | non    | non  | Core pause globale + permission              |
| 40  | Toast « Permission « X » requise » (verrous)                                              | ~   | ~    | —      | —      | ~    | libellés des 6 permissions D4                |

### Fiche viewer

| #   | Élément D4                                                                        | UI  | Back | Donnée | Action | Test | Travail nécessaire                  |
| --- | --------------------------------------------------------------------------------- | --- | ---- | ------ | ------ | ---- | ----------------------------------- |
| 41  | Titre, kicker rôle · N restrictions, solde J + crédits                            | ~   | ~    | ~      | —      | ~    | rôle (équipe) dans Core             |
| 42  | Ligne « Notes · N » + première note                                               | non | non  | non    | —      | non  | Core : notes                        |
| 43  | Restrictions : Bloqué · portée / Cooldown MOD · délai, minuteur, retirer          | ~   | ~    | ~      | ~      | ~    | modèle cooldown D4 (délai affiché)  |
| 44  | Bloquer / Cooldown (désactivés pour un membre de l'équipe), Plus                  | ~   | non  | —      | ~      | non  | Core refuse de sanctionner l'équipe |
| 45  | En ce moment (demandes vivantes)                                                  | oui | oui  | oui    | —      | ~    | —                                   |
| 46  | Activité récente (4) + Voir tout ; Activité Jetons (4) + Voir tout                | oui | ~    | ~      | —      | ~    | ledger types + historique Core      |
| 47  | Menu Plus : Historique complet, Activité Jetons, Notes · N, Wallet admin, Détails | ~   | ~    | ~      | —      | ~    | Notes, Wallet admin réel            |

### Dialogues viewer

| #   | Élément D4                                                                                           | UI  | Back | Donnée | Action | Test | Travail nécessaire                                 |
| --- | ---------------------------------------------------------------------------------------------------- | --- | ---- | ------ | ------ | ---- | -------------------------------------------------- |
| 48  | Bloquer : Sur (Tout Raptoru 🔒, TTS, Sons, Bonk, Tombola), Durée 30 s/1 min/5 min/Autre, Raison      | ~   | ~    | oui    | ~      | ~    | Tombola ; verrou sensible ; « 1 h » ajouté hors D4 |
| 49  | Bloquer : « Le viewer verra », verrou « Sanctions sensibles » (Tout Raptoru ou > 1 h), bouton bloqué | ~   | non  | —      | non    | non  | Core : sanctions sensibles (> 3600 s ou « all »)   |
| 50  | Blocage rapide (5 min / 1 min / Autre…) depuis une demande                                           | oui | oui  | oui    | oui    | ~    | —                                                  |
| 51  | Cooldown : Module, Délai imposé (30 s…5 min/Autre), Pendant (15 min/1 h/2 h/Ce stream/Autre), résumé | ~   | non  | non    | ~      | non  | modèle Core « délai entre deux utilisations »      |
| 52  | Wallet : Créditer / Débiter, Monnaie, Montant, Raison, Nouveau solde                                 | mq  | ~    | ~      | non    | non  | Core : ajustement admin (permission Admin Wallet)  |

### Drawers

| #   | Élément D4                                                                                                           | UI  | Back | Donnée | Action | Test | Travail nécessaire                           |
| --- | -------------------------------------------------------------------------------------------------------------------- | --- | ---- | ------ | ------ | ---- | -------------------------------------------- |
| 53  | Demande : viewer + badge rôle, « À vérifier · contient », « Laissée passer par X », texte surligné                   | ~   | non  | non    | non    | non  | revue Core                                   |
| 54  | Demande : erreur + « remboursé automatiquement », statut · coût · heure · note « Retiré par X, remboursé »           | ~   | ~    | ~      | —      | ~    | note Core (audit)                            |
| 55  | Demande : actions Laisser passer / Stop-Retirer / Bloquer ; Détails techniques (9 champs)                            | ~   | ~    | ~      | ~      | ~    | Laisser passer ; reference_id                |
| 56  | Mouvement : montant, Source (+ note), Statut, Heure, Viewer, Par ; Interaction liée ; Remboursé ; Détails techniques | ~   | ~    | ~      | —      | ~    | types de mouvements + `visible_in_…`         |
| 57  | Notes : liste « date · auteur — texte », ajout (140 car., Entrée), « Visible par l'équipe uniquement »               | mq  | non  | non    | non    | non  | Core : notes (création, auteur, date, audit) |
| 58  | Wallet admin : Jetons / Crédits, Créditer / Débiter ou verrou, Ajustements                                           | ~   | ~    | ~      | non    | non  | Core : ajustement admin                      |
| 59  | Détails : viewer_id, Premier passage, Aujourd'hui N interactions                                                     | ~   | non  | non    | —      | non  | Core : annuaire (premier passage) + compteur |
| 60  | Surveillance : Surveillé / Bloqué (explication), liste, suppression, ajout (40 car.) + type, verrou                  | mq  | non  | non    | non    | non  | Core : mots + admission TTS + permission     |
| 61  | Équipe & permissions : « Tu es X », Streamer / Supermod, mods en accordéon « N accordées », 6 interrupteurs, verrou  | mq  | non  | non    | non    | non  | Core : équipe + permissions fines + audit    |

### Historique

| #   | Élément D4                                                                                | UI  | Back | Donnée | Action | Test | Travail nécessaire                                         |
| --- | ----------------------------------------------------------------------------------------- | --- | ---- | ------ | ------ | ---- | ---------------------------------------------------------- |
| 62  | Onglets Interactions / Jetons                                                             | oui | ~    | ~      | —      | ~    | —                                                          |
| 63  | Puces module (Tout, TTS, Sons, Bonk, Tombola) + bouton filtres                            | ~   | ~    | ~      | —      | ~    | Tombola                                                    |
| 64  | Filtres Statut (6), Période (Ce stream / 1 h / 15 min), Filtrer par viewer, puces actives | ~   | non  | ~      | —      | non  | filtres dans Core (pas seulement sur les données chargées) |
| 65  | Lignes : heure, module, viewer · module, statut, coût (vue viewer), 60 max                | ~   | ~    | ~      | —      | ~    | historique Core paginé                                     |
| 66  | Jetons de toute la chaîne (avec nom du viewer)                                            | mq  | non  | ~      | —      | non  | Core : ledger de la chaîne                                 |
| 67  | « Afficher / Masquer les mouvements automatiques (N) » + phrase                           | non | non  | non    | —      | non  | Core : `visible_in_moderation_activity` par type           |
| 68  | Vue « Activité Jetons » d'un viewer                                                       | oui | ~    | ~      | —      | ~    | ledger complet (pas 15 derniers)                           |

### Rôles, permissions, horloge

| #   | Élément D4                                                                                                          | UI  | Back | Donnée | Action | Test | Travail nécessaire                              |
| --- | ------------------------------------------------------------------------------------------------------------------- | --- | ---- | ------ | ------ | ---- | ----------------------------------------------- |
| 69  | Rôles Mod / Supermod / Streamer ; `can(p)` = Supermod et Streamer tout, Mod = permissions accordées                 | ~   | ~    | ~      | —      | ~    | Core : grants par mod                           |
| 70  | 6 permissions : Admin Wallet, Désactiver un module, Pause globale, Gérer les permissions, Sanctions sensibles, Mots | mq  | non  | non    | non    | non  | Core : 6 permissions appliquées côté Core       |
| 71  | Remboursements ouverts à tout mod (D4)                                                                              | non | non  | —      | —      | non  | Core : refund = Mod                             |
| 72  | Minuteurs vivants (restrictions, tombola, progression, temps restant, « il y a »)                                   | oui | oui  | oui    | —      | ~    | tombola                                         |
| 73  | Restrictions qui expirent seules                                                                                    | oui | oui  | oui    | —      | oui  | cooldown D4                                     |
| 74  | Pause globale : refuse TTS, sons, bonks, tombola ; ne coupe rien ; compte les refus                                 | non | non  | non    | non    | non  | Core : contrôle d'admission de tous les modules |
| 75  | Scénario « TTS surveillé » (demande marquée, rien d'autre)                                                          | non | non  | non    | —      | non  | mots surveillés                                 |

## 2. Décisions (30/09/2026, Antoni)

- **Tombola** : modèle réel (inscription gratuite, une par viewer, cagnotte offerte). Tombola minimale
  dans Core (ouverture / fermeture / tirage depuis Studio, inscriptions de l'extension, gagnant payé sur
  le wallet Lab). Dans la section D4, « tickets » = inscriptions (×1, gratuites).
- **Mots surveillés** : un TTS « À vérifier » est **retenu** (jamais remis au lecteur) jusqu'à
  « Laisser passer » ; la file continue sans lui ; à l'expiration il est remboursé automatiquement.
  Mot bloqué : refus avant la file, rien n'est payé.
- **Permissions** : un mod avec « Gérer les permissions » modifie les droits d'un autre mod (niveau égal
  ou inférieur), uniquement parmi les permissions qu'il possède ; jamais les siens, jamais un Supermod
  ou le Broadcaster.
- **Remboursement après coup** (bouton « Rembourser » d'une interaction terminée, ajout hors D4) :
  permission **Admin Wallet**. Les remboursements D4 (retirer / stop / purger / pause + rembourser) :
  tout mod.
- **Refund D4** : tout mod (le « Supermod uniquement » du Core est abandonné).
- **Cooldown** : modèle D4 « délai imposé entre deux utilisations, pendant une durée » remplace le
  blocage temporaire.
- **Ajouts hors D4 conservés comme extensions explicites** : blocage « Jusqu'au déblocage »
  (sanction sensible), « Rembourser » après coup (Admin Wallet), onglet « Modération » (audit) de
  l'historique, « Annuler sans rembourser » (pause / désactivation). La puce « 1 h » ajoutée au
  dialogue Bloquer (absente de D4) est retirée (« Autre… » couvre 1 h).

## 3. Matrice finale (après la passe — 01/10/2026)

Statut : **IMPLÉMENTÉ + TESTÉ AUTOMATIQUEMENT + E2E 95/95** · **NON VALIDÉ MANUELLEMENT PAR ANTONI** ·
**NON RELEASE**. Même console (`apps/twitch-extension/extension/shared/moderation-v2.js`) dans
l'extension et dans Studio (onglet Modération, Studio = broadcaster) ; tout vient du Core Lab.

Légende tests : **C** = test Core (`apps/core-api/test/moderation-d4.test.ts`, `lab-moderation.test.ts`,
`tts-lab.test.ts`), **S** = test Studio serveur (`apps/studio/server/test/moderation-d4.test.ts`,
`tts-lab.test.ts`), **E** = étape du scénario E2E réel (Studio 4111 + Core Lab 4311 isolés, joueurs
réels, clics dans la console). « — » = sans objet (pur affichage, pas d'écriture).

| #     | Élément D4                                                                 | UI  | Core réel                                         | Permission (Core)                                                       | Persistance                      | Audit                    | Tests         |
| ----- | -------------------------------------------------------------------------- | --- | ------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------- | ------------------------ | ------------- |
| 1     | 3 modes Window / Video / Compact                                           | ✅  | —                                                 | —                                                                       | —                                | —                        | E15           |
| 2     | Recherche « Viewer… » (Actifs récemment / Résultats)                       | ✅  | ✅ `search` (annuaire `lab_viewers`)              | lecture équipe (viewer refusé)                                          | ✅ `lab_viewers`                 | —                        | C, S, E9      |
| 3     | Badge restriction + rôle dans la recherche                                 | ✅  | ✅                                                | lecture équipe                                                          | ✅                               | —                        | C, E9         |
| 4     | Colonne modules (point d'état, résumé, progression)                        | ✅  | ✅ `overview`                                     | lecture équipe                                                          | ✅                               | —                        | E4, E16       |
| 5     | Pastille « N à vérifier »                                                  | ✅  | ✅ `review_status`                                | —                                                                       | ✅                               | —                        | C, E4         |
| 6     | Résumé Tombola « Ouverte · N » / « Fermée »                                | ✅  | ✅ Tombola V2                                     | —                                                                       | ✅ `lab_raffles`                 | —                        | C, S, E13     |
| 7     | Lien « Historique »                                                        | ✅  | ✅ `interactions`                                 | lecture équipe                                                          | ✅                               | —                        | C, E12        |
| 8     | Pied « En direct » / « Pause globale » (menu)                              | ✅  | ✅ `global_pause`                                 | « Pause globale »                                                       | ✅ `lab_global_state`            | ✅ `global_pause/resume` | C, S, E6      |
| 9     | Bouclier « Équipe et permissions »                                         | ✅  | ✅ `team`                                         | lecture équipe                                                          | ✅ `lab_staff`                   | —                        | C, S, E10     |
| 10    | Bandeau « Pause globale · refusées (N) » + « Lever »                       | ✅  | ✅ compteur de refus                              | « Pause globale »                                                       | ✅ `refused_count`               | ✅                       | C, E6         |
| 11–12 | En-têtes de volet, infobulles, toasts, menus, drawers, dialogues           | ✅  | —                                                 | —                                                                       | —                                | —                        | E4–E16        |
| 13    | Bouton d'état + verrou « Désactivé »                                       | ✅  | ✅ `module_state` (4 modules)                     | pause = Mod ; « Désactivé » (vers ou depuis) = « Désactiver un module » | ✅                               | ✅ `module_*`            | C, E16        |
| 14    | Note d'état + « Réactiver » (verrou)                                       | ✅  | ✅                                                | idem                                                                    | ✅                               | ✅                       | C             |
| 15    | TTS en cours (texte, temps restant, Stop, progression)                     | ✅  | ✅ `stop_current`                                 | Mod (rembourser : Mod)                                                  | ✅                               | ✅ `stop`, `refund`      | C, S, E4      |
| 16–17 | File « · M à vérifier », surlignage, tag « À vérifier »                    | ✅  | ✅ positions calculées par Core                   | —                                                                       | ✅ `review_hits`                 | —                        | C, E4         |
| 18    | Menu TTS « Surveillance (mots) »                                           | ✅  | ✅ `add_word` / `remove_word`                     | « Mots surveillés / bloqués »                                           | ✅ `lab_tts_words`               | ✅ `word_add/remove`     | C, S, E14     |
| 19    | « Historique TTS »                                                         | ✅  | ✅ filtre module Core                             | lecture équipe                                                          | ✅                               | —                        | C             |
| 20    | « Purger toute la file… » (± rembourser, confirmation)                     | ✅  | ✅ `purge`                                        | Mod (rembourser : Mod)                                                  | ✅                               | ✅ `purge`               | C             |
| 21    | Soundboard en cours (temps restant, progression)                           | ✅  | ✅                                                | lecture équipe                                                          | ✅                               | —                        | E7            |
| 22    | Stop d'un son en cours (± rembourser)                                      | ✅  | ✅ Core → worker → lecteur → ACK `stopped`        | Mod                                                                     | ✅ `stopped_at`, `refund_status` | ✅ `stop`, `refund`      | C, S, E7      |
| 23    | File Soundboard (retirer ± rembourser)                                     | ✅  | ✅ débit wallet Lab + remboursement               | Mod                                                                     | ✅                               | ✅ `cancel`              | C             |
| 24    | « Stop tous les sons… » (≥ 2 en cours) + dialogue                          | ✅  | ✅ `stop_all`                                     | Mod                                                                     | ✅                               | ✅ `stop_all`            | C, E8         |
| 25    | « Historique Soundboard », « Purger toute la file… »                       | ✅  | ✅                                                | Mod                                                                     | ✅                               | ✅                       | C             |
| 26    | Échec avant lecture « remboursé automatiquement »                          | ✅  | ✅ échec avant départ / expiration                | système                                                                 | ✅                               | ✅ `refund` (system)     | C             |
| 27    | Derniers bonks (viewer, emote, il y a…)                                    | ✅  | ✅                                                | lecture équipe                                                          | ✅                               | —                        | C             |
| 28    | Coût du bonk (historique, Activité Jetons)                                 | ✅  | ✅ débit wallet Lab (remboursé si jamais affiché) | —                                                                       | ✅                               | ✅                       | C             |
| 29    | Historique / état Bonk                                                     | ✅  | ✅                                                | idem #13                                                                | ✅                               | ✅                       | C             |
| 30    | Carte Tombola (ouverte / fermée, ferme dans, participants, jackpot)        | ✅  | ✅ `raffle_v2` (Tombola V2, phase G)              | lecture équipe                                                          | ✅                               | —                        | C, S, E13     |
| 31    | Dernier tirage (+ montant, gagnant, payé) → mouvement                      | ✅  | ✅ `raffle_draw` + ledger `raffle_win`            | Studio (broadcaster)                                                    | ✅ `lab_raffle_winners`          | ✅ `raffle_draw`         | C, S, E13     |
| 32    | Derniers tickets → demande                                                 | ✅  | ✅ inscriptions (×1, gratuites)                   | —                                                                       | ✅ `lab_raffle_entries`          | —                        | C, S, E13     |
| 33    | « Ouverture, tirage et fermeture : Studio. »                               | ✅  | ✅ `raffle_open/close/draw`                       | broadcaster (refus Mod testé)                                           | ✅                               | ✅                       | C, S, E13     |
| 34    | État + Historique Tombola                                                  | ✅  | ✅ état `raffle`, filtre `raffle`                 | idem #13                                                                | ✅                               | ✅                       | C             |
| 35    | Menu demande (Laisser passer, Stop/Retirer ± rembourser, viewer, demande)  | ✅  | ✅ `allow`, `cancel`, `stop_current`              | Mod                                                                     | ✅                               | ✅ `allow`               | C, E5         |
| 36    | Dialogue pause / désactivation (Garder / Annuler + rembourser)             | ✅  | ✅ `waiting: keep / cancel_refund`                | idem #13 (rembourser : Mod)                                             | ✅                               | ✅                       | C             |
| 37    | Dialogue purge                                                             | ✅  | ✅                                                | Mod                                                                     | ✅                               | ✅                       | C             |
| 38    | Dialogue « Stop tous les sons »                                            | ✅  | ✅                                                | Mod                                                                     | ✅                               | ✅                       | C, E8         |
| 39    | Menu global + dialogue « Pause globale » (confirmation)                    | ✅  | ✅                                                | « Pause globale »                                                       | ✅                               | ✅                       | C, S, E6      |
| 40    | Toast « Permission « X » requise »                                         | ✅  | ✅ 403 avec `grant` nommé par Core                | —                                                                       | —                                | —                        | S, E6         |
| 41    | Fiche : kicker rôle · restrictions, soldes                                 | ✅  | ✅ `viewer`                                       | lecture équipe                                                          | ✅                               | —                        | C, E9         |
| 42    | Ligne « Notes · N »                                                        | ✅  | ✅                                                | lecture équipe                                                          | ✅ `lab_viewer_notes`            | —                        | C, E15        |
| 43    | Restrictions (bloc / cooldown délai), minuteur, retirer                    | ✅  | ✅ `unblock_viewer`, `clear_cooldown`             | Mod                                                                     | ✅                               | ✅                       | C, E9         |
| 44    | Bloquer / Cooldown désactivés pour l'équipe, Plus                          | ✅  | ✅ `target_is_staff` refusé par Core              | —                                                                       | —                                | —                        | C             |
| 45    | En ce moment                                                               | ✅  | ✅                                                | lecture équipe                                                          | ✅                               | —                        | E9            |
| 46    | Activité récente / Activité Jetons + Voir tout                             | ✅  | ✅                                                | lecture équipe                                                          | ✅                               | —                        | C, E9         |
| 47    | Menu Plus (Historique, Jetons, Notes, Wallet admin, Détails)               | ✅  | ✅                                                | Wallet admin : « Admin Wallet »                                         | ✅                               | —                        | E9, E11       |
| 48    | Bloquer : Sur (Tout Raptoru, TTS, Sons, Bonk, Tombola), Durée D4, Raison   | ✅  | ✅ `block_viewer`                                 | Mod                                                                     | ✅ `lab_viewer_blocks`           | ✅ `block_viewer`        | C, E9         |
| 49    | « Le viewer verra », verrou « Sanctions sensibles »                        | ✅  | ✅ `module = all` ou > 3600 s (ou illimité)       | « Sanctions sensibles »                                                 | —                                | ✅ `sensitive: true`     | C, E9         |
| 50    | Blocage rapide 5 min / 1 min / Autre…                                      | ✅  | ✅                                                | Mod                                                                     | ✅                               | ✅                       | C             |
| 51    | Cooldown D4 (Module, Délai imposé, Pendant, résumé)                        | ✅  | ✅ `set_cooldown` (délai entre 2 utilisations)    | Mod                                                                     | ✅ `lab_viewer_cooldowns`        | ✅ `cooldown_set/clear`  | C, S, E9      |
| 52    | Wallet : Créditer / Débiter (Monnaie, Montant, Raison, Nouveau solde)      | ✅  | ✅ `wallet_adjust` (plancher 0)                   | « Admin Wallet »                                                        | ✅ ledger `admin`                | ✅ `wallet_adjust`       | C, E11        |
| 53    | Drawer demande : « À vérifier », « Laissée passer par X », texte surligné  | ✅  | ✅ détail `interaction`                           | lecture équipe                                                          | ✅                               | —                        | C, E5         |
| 54    | Erreur + « remboursé automatiquement », note « Retiré par X, remboursé »   | ✅  | ✅ actions (audit) liées                          | lecture équipe                                                          | ✅                               | ✅                       | C             |
| 55    | Actions du drawer + Détails techniques                                     | ✅  | ✅                                                | Laisser passer : Mod ; Rembourser après coup : « Admin Wallet »         | ✅                               | ✅                       | C             |
| 56    | Drawer mouvement (Source, Statut, Heure, Viewer, Par, liens, techniques)   | ✅  | ✅ `ledger` (liens remboursement / débit)         | lecture équipe                                                          | ✅                               | —                        | C, E12        |
| 57    | Notes : liste, ajout (140, Entrée), « équipe uniquement »                  | ✅  | ✅ `add_note`                                     | Mod ; viewer refusé                                                     | ✅                               | ✅ `note_add`            | C, S, E9      |
| 58    | Wallet admin : soldes, Créditer / Débiter ou verrou, Ajustements           | ✅  | ✅                                                | « Admin Wallet »                                                        | ✅                               | ✅                       | C, E9, E11    |
| 59    | Détails : viewer_id, Premier passage, Aujourd'hui N                        | ✅  | ✅ `first_seen`, `today_count`                    | lecture équipe                                                          | ✅ `lab_viewers`                 | —                        | C             |
| 60    | Surveillance : explication, liste, suppression, ajout + type, verrou       | ✅  | ✅ admission TTS réelle                           | « Mots surveillés / bloqués »                                           | ✅                               | ✅                       | C, S, E14     |
| 61    | Équipe & permissions : Tu es X, rôles, accordéons, 6 interrupteurs, verrou | ✅  | ✅ `set_permission`                               | « Gérer les permissions » (règles anti-escalade)                        | ✅ `grants`                      | ✅ `set_permission`      | C, S, E10     |
| 62    | Onglets Interactions / Jetons (+ Modération, ajout)                        | ✅  | ✅                                                | lecture équipe                                                          | ✅                               | —                        | E12           |
| 63    | Puces module (dont Tombola) + filtres                                      | ✅  | ✅                                                | lecture équipe                                                          | ✅                               | —                        | C, E12        |
| 64    | Filtres Statut / Période / Viewer (appliqués par Core)                     | ✅  | ✅ `interactions?status&period&q`                 | lecture équipe                                                          | ✅                               | —                        | C, E12        |
| 65    | Lignes d'historique, pagination                                            | ✅  | ✅ `before` / `more`                              | lecture équipe                                                          | ✅                               | —                        | C             |
| 66    | Jetons de toute la chaîne (nom du viewer)                                  | ✅  | ✅ `ledger` sans viewer                           | lecture équipe                                                          | ✅                               | —                        | C, E12        |
| 67    | Afficher / Masquer les mouvements automatiques (N)                         | ✅  | ✅ `visible_in_moderation_activity`, `hidden`     | lecture équipe                                                          | ✅                               | —                        | C             |
| 68    | Vue « Activité Jetons » d'un viewer                                        | ✅  | ✅                                                | lecture équipe                                                          | ✅                               | —                        | C             |
| 69    | Rôles Mod / Supermod / Streamer                                            | ✅  | ✅ `access()`                                     | —                                                                       | ✅                               | ✅ `set_staff`           | C, S          |
| 70    | 6 permissions accordées par mod, appliquées par Core                       | ✅  | ✅                                                | Core                                                                    | ✅                               | ✅                       | C, S, E6, E10 |
| 71    | Remboursements D4 ouverts à tout mod                                       | ✅  | ✅                                                | Mod                                                                     | ✅                               | ✅                       | C, S, E7      |
| 72    | Minuteurs vivants                                                          | ✅  | ✅ (`until`, `ends_at`, `started_at`)             | —                                                                       | ✅                               | —                        | E9, E13       |
| 73    | Restrictions qui expirent seules                                           | ✅  | ✅                                                | —                                                                       | ✅                               | —                        | C             |
| 74    | Pause globale : refuse TTS / sons / bonks / tombola, ne coupe rien         | ✅  | ✅ contrôle d'admission des 4 modules             | —                                                                       | ✅                               | ✅                       | C, E6         |
| 75    | Scénario « TTS surveillé »                                                 | ✅  | ✅ retenu jusqu'à « Laisser passer »              | Mod                                                                     | ✅                               | ✅                       | C, E3–E5      |

Aucune ligne « backend manquant », placeholder, fake, non branché ni supprimé silencieusement.

### Adaptations explicites (données réelles, pas des manques)

- **Tombola** : modèle réel (décision) — « tickets » = inscriptions gratuites ×1, « jackpot » = cagnotte.
- **Deux crédits** (TTS / Sons) au lieu d'un : réalité du wallet Lab (soldes, dialogue Wallet).
- **Emote des bonks** : image de l'emote (Core ne stocke pas de nom d'emote).
- **« Ce stream »** : historique = depuis 16:00 Paris (fenêtre stream-day du Core) ; cooldown = 3 h, comme
  la règle de la D4 (le Lab n'a pas de signal de fin de stream).
- **Mots** : casse **et accents** ignorés, espaces souples (règle D4 étendue aux accents).

### Dépendances extérieures (hors du périmètre Modération lui-même)

- **Badges VIP / Sub** (fixtures D4) : le JWT d'extension Twitch ne porte que broadcaster / moderator /
  viewer ; VIP et abonnés exigent l'API Twitch avec le token broadcaster `raptoru_`
  (`channel:read:vips`, `channel:read:subscriptions`), non autorisé à ce jour, et le Lab n'a que des
  identités fictives. Les rôles affichés sont ceux que Core connaît (Streamer / Supermod / Mod / Viewer).
- **Mouvements automatiques** (présence, watchtime, sub, follow, Bits) : le mécanisme D4 existe (types,
  drapeau, bascule), mais ces mouvements appartiennent au Wallet réel, non branché au Lab tant que le
  cutover de l'économie n'est pas décidé. La bascule apparaît dès qu'un tel mouvement existe (comme D4).
- **Pop-out Twitch réel** : la console gère la Moderator Window (mode ≥ 900 px, surface « Moderator
  Window » de l'Extension Lab) ; l'activer sur Twitch demande une publication de l'extension (interdite
  pour l'instant).

## 4. Passe UX post-Tombola (validée manuellement par Antoni le 03/10/2026)

La section Tombola de la console est, depuis `ecc0275`, le module Tombola V2 complet (état, timer, participants avec
source, actions de manche, fiche viewer, « Dernier tirage ») : voir `docs/tombola-v2-parity.md` (checkpoint figé).

Placement uniquement : aucune logique Core, permission ni action modifiée.

- **Plus de menu « … »** dans les en-têtes de modules : toutes ses actions sont des icônes (tooltip sur
  chacune) à gauche du bouton d'état.
  - TTS : Surveillance des mots · Historique TTS · Purger toute la file.
  - Soundboard : Stop tous les sons (inactif sous 2 sons) · Historique Soundboard · Purger toute la file.
  - Bonk : Historique Bonk.
  - Tombola : Historique ; en manche, aussi Pause / Reprendre · Ajouter 30 secondes · Tirer maintenant ·
    Annuler la manche (la rangée de boutons du corps est retirée).
- Purger et Annuler en rouge, confirmations inchangées ; une action sans permission reste visible avec un
  cadenas et le tooltip nomme la permission manquante.
- Compact (Panel / Mobile) : icônes de 26 px, bouton d'état réduit à sa pastille (tooltip « État : … »),
  une seule ligne, aucun débordement (mesuré en E2E sur Panel 318×496, Moderator Window et Studio).
- Lignes 20, 24, 25 et 38 ci-dessus : mêmes actions et dialogues, désormais depuis les icônes d'en-tête.
