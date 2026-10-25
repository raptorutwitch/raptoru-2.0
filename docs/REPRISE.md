# Reprise — point d'entrée

Mis à jour : **25/10/2026 ~11:45** (CI/CD **en service et validée sur la vraie infrastructure** : déploiement du Core lancé depuis GitHub, publication Studio depuis GitHub testée — [CICD.md](CICD.md) ; Core `0b11cc0`, bot `16600de`, Studio 0.1.7). À lire en premier dans toute nouvelle session, puis
`git status`. Vérifier soi-même `git log` / Coolify avant de se fier à un SHA écrit ici.

**Raptoru 2.0** : plateforme de stream auto-hébergée d'un streamer (Twitch `raptoru_`, id 83603689). Objectif : tout
piloter depuis Raptoru Studio ; le Core décide, le bot parle à Twitch, Studio pilote OBS, l'extension parle aux viewers.
SAMMI est **abandonné** (débranché le 20/10). Architecture : [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Où se trouvent les documents (important)

Les documents de référence sont sur **`origin/main`** (poussés le 24/10). Le checkout principal
`C:\Users\Antoni\Documents\Raptoru 2.0` est en retard (`main` local @ `11ffe3f`, Roue V2 non commitée par-dessus) :
seuls `CLAUDE.md` et ce fichier (copie non suivie, identique) y sont à jour. Lire les autres dans le worktree
**`C:\Users\Antoni\Documents\raptoru-docs`** (branche `docs/consolidation` = `origin/main` ; la mettre à jour avec
`git -C C:\Users\Antoni\Documents\raptoru-docs pull --ff-only origin main`) ou avec `git show origin/main:docs/ROADMAP.md`
depuis le checkout principal.

| Besoin                                                               | Document (`origin/main`, lisible dans `raptoru-docs\docs\`) |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Roadmap, état de chaque module, arbitrages                           | [ROADMAP.md](ROADMAP.md)                                    |
| Composants, flux, dépendances externes, doc de chaque module         | [ARCHITECTURE.md](ARCHITECTURE.md)                          |
| Tests, déploiement, retour arrière, build Studio, vérifications      | [OPERATIONS.md](OPERATIONS.md)                              |
| Sauvegardes, risques de perte, restauration                          | [BACKUPS.md](BACKUPS.md)                                    |
| Journal détaillé 21→24/10 (dont chantier Roue V2), anciens documents | [archive/](archive/README.md)                               |
| Règles de travail des agents                                         | `CLAUDE.md` (racine)                                        |

## 2. Production (relevé 25/10 ~03:00)

| Élément              | Version                                                                                                                                                                                                                                                          | Remarque                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Core `raptoru-core`  | **`0b11cc0`** (déployé 25/10 11:11 UTC **depuis GitHub Actions**, sans migration ; sert `/v1/ops/status`)                                                                                                                                                        | `running:healthy`, `/health` `/ready` 200, commit rapporté par le Core ; retour : `34e4120`                |
| Bot `raptoru-bot`    | **`16600de`** (déployé 24/10 16:01 UTC, inclut `cf21c4b`)                                                                                                                                                                                                        | `running:healthy`, VPS, bail repris proprement ; `CP_TWITCH_ACTIONS` ON (24/10 16:28) ; retour : `b8bc025` |
| `origin/main`        | CI/CD et documentation (PR #1 à #5) ; « État de la livraison » donne le commit exact                                                                                                                                                                             | Coolify : auto-deploy désactivé                                                                            |
| Studio installé (PC) | **0.1.7** (construite par GitHub depuis `34e4120`, publiée le 25/10) — installée à 10:07 UTC par erreur pendant le test de mise à jour (installation à la fermeture d'electron-updater, corrigée), Studio relancé à 10:15 : données, Spotify et Votekick intacts | retour : sup.9 (`Documents\raptoru-spotify-GO`)                                                            |
| Extension Twitch     | `0bf7907` publiée (version servie : non vérifiable depuis le dépôt)                                                                                                                                                                                              | publication manuelle par Antoni                                                                            |
| Staging              | `raptoru-core-staging`, branche `feat/compact-video-port`                                                                                                                                                                                                        | Node non épinglé (décision en attente)                                                                     |
| Flags                | Core `CAUTION_CHAT`, `VOTEKICK_CHAT`, `SPOTIFY_CHAT` = true ; bot `CAUTION`, `VOTEKICK`, `CP_TWITCH_ACTIONS` = true                                                                                                                                              | journaux du bot sur `/data`                                                                                |
| OBS au repos         | « Micro » non muté ; filtres Votekick désactivés ; `zoom` 1,000001, `zoom_max` 1,101, drive facteur 0,8, `mute_duration` 110                                                                                                                                     | ne pas modifier ces réglages sans GO                                                                       |

Fonctions en Production : économie canonique (Wallet, Daily, fidélité, présence), Commands V2 (`cmd_steps`), modération
D4, Tombola, Jeu des mots, Roulette / Slot / Duel, Soundboard, TTS, Bonk, alertes V2, Points de chaîne et effets,
Random Ban, Roue du Sub V1, Caution, Votekick V2, **Spotify V2** (demandes de musique sans SAMMI). Niveau de validation
de chacune : [ROADMAP.md](ROADMAP.md).

## 3. Dernières livraisons et décisions (24–25/10)

- **Spotify V2 / Studio sup.10 — validé par Antoni en réel le 25/10, chantier clos** ([SPOTIFY_V2.md](SPOTIFY_V2.md)) :
  demandes de musique, remboursements, `!songcancel 1` / `!songcancel 2`, quotas et exceptions par viewer, « File
  musicale », skip automatique d'une demande annulée. **Skip accepté tel quel** : une fraction de seconde peut s'entendre
  sur un morceau qui démarre aussitôt ; aucune optimisation supplémentaire prévue. Mesures du 25/10 : Studio traite une
  demande en 0,97–1,56 s (1,9–2,9 s avant) ; skip envoyé 6 ms après la détection. Aucune modification fonctionnelle
  Spotify ou Votekick sans nouvelle décision d'Antoni.
- Votekick V2 : mute au repos, zoom en décimal, bandeau synchronisé, compte à rebours 60 (et non 63), **durée de vote
  réglable dans Studio (15–300 s, défaut 60, appliquée par le Core aux nouveaux votes)** et **son de lancement**
  (désactivé par défaut, joué une fois par vote ouvert). **Son de lancement importé validé en réel par Antoni le 25/10**
  (correctif `31e3c0f`, sup.10). Aucune commande d'annulation d'un vote en cours n'existe (ni chat, ni Studio).
- Soundboard : lecteur rétabli après l'installation de sup.10 (vert en supervision le 25/10) ; son lecteur est un cadre
  de la fenêtre de Studio, pas une source OBS.
- Décisions : Audio Move conservé ; micro du streamer = « Micro » ; design legacy SAMMI de l'overlay (variante D
  interdite) ; horloge Windows resynchronisée chaque heure (régularité à confirmer : `w32tm /query /status`).

## 4. Travaux en cours — ne rien écraser

| Où                                                                                                    | Contenu                                                                                                                            | État                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0` (`main` @ `11ffe3f`, 33 commits de retard) | **Roue du Sub V2** (41 modifiés + 35 non suivis), correctif « écran gris » de l'extension, `CLAUDE.md` local, documents non suivis | non commité. **C'est aussi le dossier de données de Studio installé** (`.env`, jetons, `.runtime`) : jamais de `git clean`, `reset --hard` ou `checkout .` |
| `…\scratchpad\sup-wt` (`fix/supervision` @ `2d80c2a`)                                                 | supervision, OAuth du PC, Ctrl+R Soundboard, updater de test                                                                       | **intégré au dépôt** (PR #1, `eb3f05a`, identique au source de sup.10) ; le worktree peut être retiré après la fusion                                      |
| `C:\Users\Antoni\Documents\raptoru-release` (`chore/coolify-deploy` @ `1f10da3`)                      | script de déploiement Coolify (`ef79a37`, `80f3525`, `1f10da3`)                                                                    | **intégré au dépôt** (PR #1, historique conservé) et étendu (CI, live, vérifications) ; ce worktree n'est plus l'unique copie                              |
| `C:\Users\Antoni\Documents\rs-vk`                                                                     | clone de build Studio (patch `sup-wt` appliqué + `stash@{0}`), dossier `GO/` (runbook, SQL)                                        | ne pas nettoyer                                                                                                                                            |
| `…\scratchpad\{chat,wg,solde,node}-wt`                                                                | restes de lots déjà intégrés                                                                                                       | à revérifier avant tout retrait                                                                                                                            |
| `C:\Users\Antoni\Documents\raptoru-docs` (`docs/consolidation`)                                       | documentation, = `origin/main`                                                                                                     | poussé                                                                                                                                                     |
| `C:\Users\Antoni\Documents\raptoru-spotify` (`feat/spotify-v2` = `origin/main`)                       | **Spotify V2** ; installateurs sup.9 / sup.10 et SHA-256 : `Documents\raptoru-spotify-GO\`                                         | livré, validé et **clos** le 25/10 ; rien en attente                                                                                                       |

`scratchpad` = `C:\Users\Antoni\AppData\Local\Temp\claude\C--Users-Antoni-Documents-Raptoru-2-0\c435dbde-5dd7-4b54-8561-68eabf04712a\scratchpad`
(**dossier temporaire Windows ; l'Assistant de stockage y supprime des fichiers** : instantané du 24/10 dans
`Documents\Sauvegarde Raptoru 2.0\worktrees-2026-10-24\`, voir [BACKUPS.md](BACKUPS.md) § 3).

## 5. Risques et blocages connus

1. Données de travail de Studio (jetons, `.env`, `.runtime`) : sauvegardes ponctuelles vérifiées (24/10, avant sup.9,
   avant sup.10 — extraction complète testée le 25/10), aucune régulière ([BACKUPS.md](BACKUPS.md) § 1).
2. Base de Production : copie hors VPS du 24/10 09:56 vérifiée ; les suivantes demandent un téléchargement manuel dans
   Coolify (pas d'API, pas de SSH, pas de S3) ; restauration démontrée une seule fois (20/10).
3. Worktrees de travail non commité sous `AppData\Local\Temp` (risque de nettoyage automatique).
4. Bot : un 409 `not_lease_holder` est traité comme définitif → événements de fidélité perdus pendant une perte de
   bail (P1, préalable à la Roue V2 en Production).
5. `main` local en retard sur `origin/main` avec la Roue V2 non commitée par-dessus : l'intégration demande un rebase prudent.
6. Plusieurs documents de module ont encore un en-tête « non déployé » : la roadmap fait foi.

## 6. Prochaine action

1. Votekick : le son de lancement est validé (25/10) ; reste à confirmer la durée de vote réglable sur un vrai vote
   (GO requis pour tout vote réel).
2. **Trancher l'arbitrage** de [ROADMAP.md](ROADMAP.md) § 3 : Roue du Sub V2 (ordre de REPRISE) ou incident Twitch du
   22/10 + Bonk/DSK (ordre de TRUTH / STATE_AUDIT) ; et confirmer le correctif 409 comme préalable à la Roue V2.
3. Ensuite seulement : ouvrir le chantier choisi.

## 7. Actions en attente d'accord d'Antoni

- Lors de la mise à jour du checkout principal sur `origin/main` (avec la reprise de la Roue V2) : retirer d'abord la
  copie non suivie `docs/REPRISE.md` (identique à la version suivie), sinon Git refuse d'écraser un fichier non suivi.
- **CI/CD** ([CICD.md](CICD.md)) : chantier clos le 25/10 — CI, déploiement du Core depuis GitHub (11:11 UTC) et
  publication Studio depuis GitHub (brouillon de test 0.1.8 créé, vérifié, supprimé) validés pour de vrai. Restent :
  la première vérification réelle d'un déploiement du **bot** (au prochain changement du bot) et, facultatif,
  l'enregistrement DNS `coolify` chez OVH (CICD.md § 5).
- Sauvegardes : rythme des copies hors VPS (ou S3 dans Coolify) et des données de Studio ; nouveau test de restauration
  en base jetable ; déplacer les worktrees hors de `Temp`.
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

1. Lire ce fichier, puis `git -C "C:\Users\Antoni\Documents\Raptoru 2.0" status` et `git fetch` ; mettre à jour
   `raptoru-docs` (§ 1) pour lire les documents de référence.
2. Production en lecture seule : Actions → « État de la livraison », ou dans un worktree à jour de `origin/main` :
   `node scripts/delivery/status.mjs` (ou `node scripts/coolify-deploy.mjs status core` / `… status bot`).
3. Lire [ROADMAP.md](ROADMAP.md) § 3 (prochain travail, arbitrages), puis le document du module concerné
   ([ARCHITECTURE.md](ARCHITECTURE.md) § 5).
4. Travailler dans un worktree dédié basé sur `origin/main` (jamais dans le checkout principal, qui porte la Roue V2
   et les données de Studio), sauf pour reprendre la Roue V2 elle-même.
5. À chaque étape franchie et avant de s'arrêter : mettre à jour ce fichier (court : état, décisions, prochaine
   action) ; le détail daté va dans un journal sous `archive/`.
