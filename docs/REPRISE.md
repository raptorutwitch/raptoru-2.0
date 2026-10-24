# Reprise — point d'entrée

Mis à jour : **24/10/2026 ~12:45** (consolidation documentaire). À lire en premier dans toute nouvelle session, puis
`git status`. Vérifier soi-même `git log` / Coolify avant de se fier à un SHA écrit ici.

**Raptoru 2.0** : plateforme de stream auto-hébergée d'un streamer (Twitch `raptoru_`, id 83603689). Objectif : tout
piloter depuis Raptoru Studio ; le Core décide, le bot parle à Twitch, Studio pilote OBS, l'extension parle aux viewers.
SAMMI est **abandonné** (débranché le 20/10). Architecture : [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Où se trouvent les documents (important)

Le checkout principal est en retard de 33 commits (travail Roue V2 non commité dessus) : **les documents de référence
à jour vivent dans le worktree `C:\Users\Antoni\Documents\raptoru-docs`** (branche `docs/consolidation` = `origin/main`

- commit documentaire, **non poussée**) tant que ce commit n'est pas intégré à `main`.

| Besoin                                                               | Document (dans `raptoru-docs\docs\` ; liens relatifs valables après intégration) |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Roadmap, état de chaque module, arbitrages                           | [ROADMAP.md](ROADMAP.md)                                                         |
| Composants, flux, dépendances externes, doc de chaque module         | [ARCHITECTURE.md](ARCHITECTURE.md)                                               |
| Tests, déploiement, retour arrière, build Studio, vérifications      | [OPERATIONS.md](OPERATIONS.md)                                                   |
| Sauvegardes, risques de perte, restauration                          | [BACKUPS.md](BACKUPS.md)                                                         |
| Journal détaillé 21→24/10 (dont chantier Roue V2), anciens documents | [archive/](archive/README.md)                                                    |
| Règles de travail des agents                                         | `CLAUDE.md` (racine)                                                             |

## 2. Production (relevé 24/10 ~12:20)

| Élément              | Version                                                                                                                      | Remarque                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Core `raptoru-core`  | **`0f753c1`** (déployé 24/10 09:57 UTC, migration `votekick_settings`)                                                       | `running:healthy`, `/health` `/ready` 200                                                  |
| Bot `raptoru-bot`    | **`b8bc025`** (23/10)                                                                                                        | `running:healthy`, VPS, bail unique ; image sans `cf21c4b` (chemins `/data` par variables) |
| `origin/main`        | **`0f753c1`**                                                                                                                | Coolify : auto-deploy désactivé                                                            |
| Studio installé (PC) | **0.1.7-sup.8** (build local, `0f753c1` + patch `sup-wt` non commité)                                                        | dernière release publiée : 0.1.6                                                           |
| Extension Twitch     | `0bf7907` publiée (version servie : non vérifiable depuis le dépôt)                                                          | publication manuelle par Antoni                                                            |
| Staging              | `raptoru-core-staging`, branche `feat/compact-video-port`                                                                    | Node non épinglé (décision en attente)                                                     |
| Flags                | Core `CAUTION_CHAT`, `VOTEKICK_CHAT` = true ; bot `CAUTION`, `VOTEKICK` = true                                               | journaux du bot sur `/data`                                                                |
| OBS au repos         | « Micro » non muté ; filtres Votekick désactivés ; `zoom` 1,000001, `zoom_max` 1,101, drive facteur 0,8, `mute_duration` 110 | ne pas modifier ces réglages sans GO                                                       |

Fonctions en Production : économie canonique (Wallet, Daily, fidélité, présence), Commands V2 (`cmd_steps`), modération
D4, Tombola, Jeu des mots, Roulette / Slot / Duel, Soundboard, TTS, Bonk, alertes V2, Points de chaîne et effets,
Random Ban, Roue du Sub V1, Caution, Votekick V2. Niveau de validation de chacune : [ROADMAP.md](ROADMAP.md).

## 3. Dernières livraisons et décisions (24/10)

- Votekick V2 : mute au repos, zoom en décimal, bandeau synchronisé, compte à rebours 60 (et non 63), **durée de vote
  réglable dans Studio (15–300 s, défaut 60, appliquée par le Core aux nouveaux votes)** et **son de lancement**
  (désactivé par défaut, joué une fois par vote ouvert). Livré et déployé ; **pas encore validé par Antoni**.
- Décisions : Audio Move conservé ; micro du streamer = « Micro » ; design legacy SAMMI de l'overlay (variante D
  interdite) ; horloge Windows resynchronisée chaque heure (régularité à confirmer : `w32tm /query /status`).

## 4. Travaux en cours — ne rien écraser

| Où                                                                                                    | Contenu                                                                                                                            | État                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0` (`main` @ `11ffe3f`, 33 commits de retard) | **Roue du Sub V2** (41 modifiés + 35 non suivis), correctif « écran gris » de l'extension, `CLAUDE.md` local, documents non suivis | non commité. **C'est aussi le dossier de données de Studio installé** (`.env`, jetons, `.runtime`) : jamais de `git clean`, `reset --hard` ou `checkout .` |
| `…\scratchpad\sup-wt` (`fix/supervision` @ `2d80c2a`)                                                 | supervision, OAuth du PC, Ctrl+R Soundboard, updater de test                                                                       | non commité, embarqué dans Studio sup.8                                                                                                                    |
| `C:\Users\Antoni\Documents\raptoru-release` (`chore/coolify-deploy` @ `80f3525`)                      | script de déploiement Coolify                                                                                                      | commit local, **non poussé**, unique copie                                                                                                                 |
| `C:\Users\Antoni\Documents\rs-vk`                                                                     | clone de build Studio (patch `sup-wt` appliqué + `stash@{0}`), dossier `GO/` (runbook, SQL)                                        | ne pas nettoyer                                                                                                                                            |
| `…\scratchpad\{chat,wg,solde,node}-wt`                                                                | restes de lots déjà intégrés                                                                                                       | à revérifier avant tout retrait                                                                                                                            |
| `C:\Users\Antoni\Documents\raptoru-docs` (`docs/consolidation`)                                       | ce commit documentaire                                                                                                             | non poussé                                                                                                                                                 |

`scratchpad` = `C:\Users\Antoni\AppData\Local\Temp\claude\C--Users-Antoni-Documents-Raptoru-2-0\c435dbde-5dd7-4b54-8561-68eabf04712a\scratchpad`
(**dossier temporaire Windows ; l'Assistant de stockage y supprime des fichiers** : instantané du 24/10 dans
`Documents\Sauvegarde Raptoru 2.0\worktrees-2026-10-24\`, voir [BACKUPS.md](BACKUPS.md) § 3).

## 5. Risques et blocages connus

1. Données de travail de Studio (jetons, `.env`, `.runtime`) **sans aucune sauvegarde** ([BACKUPS.md](BACKUPS.md) § 1).
2. Dumps de la base de Production **uniquement sur le VPS** ; restauration démontrée une seule fois (20/10).
3. Worktrees de travail non commité sous `AppData\Local\Temp` (risque de nettoyage automatique).
4. Bot : un 409 `not_lease_holder` est traité comme définitif → événements de fidélité perdus pendant une perte de
   bail (P1, préalable à la Roue V2 en Production).
5. `main` local en retard de 33 commits avec la Roue V2 non commitée par-dessus : l'intégration demande un rebase prudent.
6. Plusieurs documents de module ont encore un en-tête « non déployé » : la roadmap fait foi.

## 6. Prochaine action

1. **Antoni valide les réglages Votekick** dans Studio (Points de chaîne → Votekick : durée, son, pré-écoute), puis
   sur un vrai vote (GO requis pour tout vote réel).
2. **Trancher l'arbitrage** de [ROADMAP.md](ROADMAP.md) § 3 : Roue du Sub V2 (ordre de REPRISE) ou incident Twitch du
   22/10 + Bonk/DSK (ordre de TRUTH / STATE_AUDIT) ; et confirmer le correctif 409 comme préalable à la Roue V2.
3. Ensuite seulement : ouvrir le chantier choisi.

## 7. Actions en attente d'accord d'Antoni

- Pousser `docs/consolidation` (ce commit documentaire) et l'intégrer à `main` ; puis remplacer la copie non suivie
  `docs/REPRISE.md` du checkout principal par la version suivie (elles sont identiques aujourd'hui).
- Commiter `sup-wt` ; pousser `80f3525` (script de déploiement) ; redéployer le bot sur ≥ `cf21c4b`.
- Mettre à jour le checkout principal sur `origin/main` (rebase de la Roue V2) — à faire avec la reprise de la Roue V2.
- Sauvegardes : copie hors VPS des dumps (téléchargement régulier ou S3) ; sauvegarde des données de travail de Studio ;
  nouveau test de restauration en base jetable ; déplacer les worktrees hors de `Temp`.
- Archiver les documents non suivis du checkout principal ([archive/README.md](archive/README.md)).
- Nettoyages proposés (aucun fait) : [BACKUPS.md](BACKUPS.md) § 9.

## 8. Règles (rappel ; texte complet dans `CLAUDE.md`)

- GO explicite d'Antoni pour : tout push, déploiement, migration, flag / variable, redémarrage, installation Studio,
  modification OBS, remboursement / ajustement Wallet, sanction Twitch hors test consenti, vote réel, release Studio.
- « Validé » = testé à la main par Antoni. Ne jamais réactiver SAMMI.
- Git : ajouter les fichiers un par un (jamais un dossier) ; jamais de reset, clean, réécriture d'historique ;
  ne jamais committer `docs/HANDOFF_MIGRATION_2026-10-20.md` ni `docs/POST_LIVE_AUDIT_2026-10-20.md`.
- Ne jamais afficher un secret (jeton Coolify, mot de passe OBS, jetons Twitch, `.env`).

## 9. Procédure de reprise (nouvelle session)

1. Lire ce fichier, puis `git -C "C:\Users\Antoni\Documents\Raptoru 2.0" status` et `git fetch` ; comparer `main`,
   `origin/main` et la branche `docs/consolidation`.
2. Production en lecture seule : `cd C:\Users\Antoni\Documents\raptoru-release` puis
   `node scripts/coolify-deploy.mjs status core` et `… status bot`.
3. Lire [ROADMAP.md](ROADMAP.md) § 3 (prochain travail, arbitrages), puis le document du module concerné
   ([ARCHITECTURE.md](ARCHITECTURE.md) § 5).
4. Travailler dans un worktree dédié basé sur `origin/main` (jamais dans le checkout principal, qui porte la Roue V2
   et les données de Studio), sauf pour reprendre la Roue V2 elle-même.
5. À chaque étape franchie et avant de s'arrêter : mettre à jour ce fichier (court : état, décisions, prochaine
   action) ; le détail daté va dans un journal sous `archive/`.
