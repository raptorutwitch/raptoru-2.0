# Reprise — point d'entrée

Mis à jour : **30/10/2026 ~19:30 UTC** (**Halloween livré** : Core `bb63b75` avec la migration `20261117130000_halloween_economy.sql`, Studio 0.1.21 installé, événement **fermé**, nouveaux gains désactivés — § 6 et [HALLOWEEN.md](HALLOWEEN.md) ; **Chaudron des subs** : Lab seulement, PR #47 brouillon ; bot `4ba9243` inchangé). À lire en premier dans toute nouvelle session, puis
`git status`. Vérifier soi-même `git log` / Coolify avant de se fier à un SHA écrit ici.

**Raptoru 2.0** : plateforme de stream auto-hébergée d'un streamer (Twitch `raptoru_`, id 83603689). Objectif : tout
piloter depuis Raptoru Studio ; le Core décide, le bot parle à Twitch, Studio pilote OBS, l'extension parle aux viewers.
SAMMI est **abandonné** (débranché le 20/10). Architecture : [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Où se trouvent les documents (important)

Les documents de référence sont sur **`origin/main`** (poussés le 24/10). Le checkout principal
`C:\Users\Antoni\Documents\Raptoru 2.0` est en retard (`main` local @ `11ffe3f`, avec par-dessus l'ancienne copie non commitée de la Roue V2, remplacée par
`main`) :
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

## 2. Production (relevé 30/10 ~19:30 UTC)

| Élément              | Version                                                                                                                                                                   | Remarque                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Core `raptoru-core`  | **`bb63b75`** (déployé 30/10 18:43 UTC, PR #46 : économie Halloween et variantes d'alertes ; migration additive `20261117130000_halloween_economy.sql` appliquée)         | `running:healthy`, `/health` `/ready` 200 ; retour : `6557f7b` (la migration peut rester)     |
| Bot `raptoru-bot`    | **`4ba9243`** (27/10 01:47 UTC ; inchangé par les PR #45 et #46)                                                                                                          | bail tenu, EventSub bot et diffuseur OK (30/10 18:45 UTC)                                     |
| `origin/main`        | `bb63b75` = PR #46, **déployé** (Core)                                                                                                                                    | Coolify : auto-deploy désactivé                                                               |
| Studio installé (PC) | **0.1.21** (publiée et installée le 30/10 ~18:56 UTC ; profil et 66 médias identiques ; lancé sans droits administrateur)                                                 | retour : réinstaller 0.1.20                                                                   |
| Roue du Sub          | **V2 active** (mode `v2`, interrupteur ON) depuis le 26/10 12:12 UTC ; **invitations ON** (activées par Antoni le 26/10 12:20 UTC) ; récupération des doubles crédits OFF | détails et retour arrière : [SUB_WHEEL_V2_DELIVERY.md](SUB_WHEEL_V2_DELIVERY.md)              |
| Extension Twitch     | version servie : non vérifiable depuis le dépôt ; la version avec le module Événements dépend de la revue Twitch (Antoni)                                                 | sans bouton d'échange de Jetons : le Core répond « fermé » ([HALLOWEEN.md](HALLOWEEN.md) § 7) |
| Staging              | `raptoru-core-staging`, branche `feat/compact-video-port`                                                                                                                 | Node non épinglé (décision en attente)                                                        |
| Flags                | Core `CAUTION_CHAT`, `VOTEKICK_CHAT`, `SPOTIFY_CHAT` = true ; bot `CAUTION`, `VOTEKICK`, `CP_TWITCH_ACTIONS` = true                                                       | journaux du bot sur `/data`                                                                   |
| OBS au repos         | « Micro » non muté ; filtres Votekick désactivés ; `zoom` 1,000001, `zoom_max` 1,101, drive facteur 0,8, `mute_duration` 110                                              | ne pas modifier ces réglages sans GO                                                          |

Fonctions en Production : économie canonique (Wallet, Daily, fidélité, présence), Commands V2 (`cmd_steps`), modération
D4, Tombola, Jeu des mots, Roulette / Slot / Duel, Soundboard, TTS, Bonk, alertes V2, Points de chaîne et effets,
Random Ban, **Roue du Sub V2** (26/10), Caution, Votekick V2, **Spotify V2** (demandes de musique sans SAMMI). Niveau de validation
de chacune : [ROADMAP.md](ROADMAP.md).

## 3. Dernières livraisons et décisions (24–30/10)

- **Halloween — 29–30/10** (PR #35, #45, #46 ; [HALLOWEEN.md](HALLOWEEN.md)) : boutique Bonbons, screamers et effets,
  Chaos (écran retourné / flou + filtres OBS), ambiance OBS, profil d'alertes Halloween (coupé), économie : échange
  Jetons → Bonbons **supprimé** (410), gains présence / Prime / resub / Bits / dons **ajoutés et désactivés**,
  variantes d'alertes par famille (rien d'enregistré = comportement d'avant). Sauvegarde 30/10 18:30 UTC copiée hors VPS
  (`Sauvegarde Raptoru 2.0\prod-db-2026-10-30`). Curseur Chaos : limite acceptée, reporté.

- **Random Ban V3 — 27/10** (PR #20, Core et bot `4ba9243`, Studio 0.1.11 publiée) : acheteur 4× moins souvent tiré
  (w / N) ; streamer tiré 2 % des fois → son micro « Micro » coupé 60 s dans OBS (jamais de timeout), seulement si
  Studio 0.1.11 voit OBS connecté et que rien ne coupe déjà le micro ; micro partagé (Votekick, BRB, Random Ban : la voix
  revient à la fin du dernier) ; Caution sur un mute OBS : 300 jetons / 10 s restantes, choix `votekick` / `rb` si les
  deux. Bouton Studio « Tester le mute du streamer » : le micro seulement (ni Twitch, ni jetons, ni chat, ni animation,
  ni caution). Prix Votekick : la Caution du mute streamer passe déjà à 300 / 10 s avec le Core `4ba9243`.
  **Non validé en réel** ; règles : [RANDOM_BAN_V2.md](RANDOM_BAN_V2.md) § V3, [CAUTION.md](CAUTION.md).

- **Deuxième passe — close le 26/10** (PR #16, #17, #18) :
  - Studio 0.1.9 : Tombola, tranches du montant aléatoire éditées en brouillon (Enregistrer / Annuler) ; Bonk, un tir
    sur six plus appuyé ; diagnostic Spotify en lecture seule (Spotify ne renvoie jamais la popularité).
  - Studio 0.1.10 : Spotify départage les éditions d'un même morceau quand aucune version n'est demandée (artistes exacts,
    sans featuring non demandé, pas d'album live, album / single avant compilation, plus ancienne sortie). Vérifié sur
    les vraies recherches du 26/10 : Indochine « J'ai demandé à la lune » → Paradize, Dirty Heads « Vacation » → SWIM
    TEAM ; « LISA Tarantino » et les demandes « live » restent ambiguës.
  - Bot `5e7ebe6` : Caution et sortie chat relisent une file vide toutes les 250 ms (au lieu de 1 s) ; Core en erreur
    → 1 s puis jusqu'à 5 s ; première relecture des bans 300 ms après le déban (puis 700 ms, 3 relectures). Prix,
    débits et remboursements inchangés. Mesure avant : devis en 1,0–2,4 s.
  - **Non encore observés en live** (aucun test économique en Production).

- **Correctifs stream — 26/10** (PR #14, Core et bot `d215778`) : mini-jeux (Roulette, Slot, Duel) seulement en live ;
  messages courts (Daily, `!solde`, Caution ; plus de confirmation pour `!rb` et `!tts` quand l'effet suffit) ; Tombola :
  même gain pour chaque gagnant (arrondi au-dessus), une seule annonce `/announce`, au moins 2 gagnants dès 4
  participants (gagnant unique = FULL, 1 %) ; Jeu des mots : 8 phrases de série par palier. **Non encore observés en
  live.** Texte d'aide Tombola de Studio : à la prochaine publication de Studio.
- **Roue du Sub V2 — livrée et active le 26/10** (PR #11 et #12) : droits persistants, tirage à l'affichage, reprise
  automatique des roues jamais démarrées sans second crédit, « À vérifier » pour les cas ambigus ; invitations ON.
  Livraison, états, limites, retour arrière : [SUB_WHEEL_V2_DELIVERY.md](SUB_WHEEL_V2_DELIVERY.md).
- **Infrastructure — chantier clos le 25/10** : CI/CD en service ([CICD.md](CICD.md)) ; Coolify : tableau de bord
  `https://dashboard.raptoru.fr`, API `https://coolify.raptoru.fr`, ports 8000/6001/6002 fermés depuis Internet en
  IPv4 et IPv6 ([OPERATIONS.md](OPERATIONS.md) § 8 : état, secours par la console VNC, retour arrière).

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

| Où                                                                                                           | Contenu                                                                                                                                                                                                                                                                                      | État                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0` (`main` @ `11ffe3f`, en retard sur `origin/main`) | ancienne copie non commitée de la **Roue du Sub V2** (remplacée par `main`, PR #11), correctif « écran gris » de l'extension (**non commité**), documents non suivis ; les deux premiers aussi dans `backup/roue-v2-wip-2026-10-25`                                                          | **C'est aussi le dossier de données de Studio installé** (`.env`, jetons, `.runtime`) : jamais de `git clean`, `reset --hard` ou `checkout .` |
| `…\scratchpad\sup-wt` (`fix/supervision` @ `2d80c2a`)                                                        | supervision, OAuth du PC, Ctrl+R Soundboard, updater de test                                                                                                                                                                                                                                 | **intégré au dépôt** (PR #1, `eb3f05a`, identique au source de sup.10) ; le worktree peut être retiré après la fusion                         |
| `C:\Users\Antoni\Documents\raptoru-release` (`chore/coolify-deploy` @ `1f10da3`)                             | script de déploiement Coolify (`ef79a37`, `80f3525`, `1f10da3`)                                                                                                                                                                                                                              | **intégré au dépôt** (PR #1, historique conservé) et étendu (CI, live, vérifications) ; ce worktree n'est plus l'unique copie                 |
| `C:\Users\Antoni\Documents\rs-vk`                                                                            | clone de build Studio (patch `sup-wt` appliqué + `stash@{0}`), dossier `GO/` (runbook, SQL)                                                                                                                                                                                                  | ne pas nettoyer                                                                                                                               |
| `…\scratchpad\{chat,wg,solde,node}-wt`                                                                       | restes de lots déjà intégrés                                                                                                                                                                                                                                                                 | à revérifier avant tout retrait                                                                                                               |
| `C:\Users\Antoni\Documents\raptoru-roue-v2`                                                                  | Roue du Sub V2 : **livrée** (PR #11) ; Lab isolé `lab-v2.cmd` (port 4200, base Docker `raptoru-lab-v2-pg`) ; paquet de livraison `Documents\raptoru-roue-v2-GO\` (SQL, installateur 0.1.8) ; ancien travail : `backup/roue-v2-wip-2026-10-25` + `Sauvegarde Raptoru 2.0\roue-v2-2026-10-25\` | worktree retirable (la copie non commitée du checkout principal est remplacée par `main`)                                                     |
| `C:\Users\Antoni\Documents\raptoru-halloween` (`feat/halloween`)                                             | **Opération Halloween** (stream du 31/10) : boutique à Bonbons (Core), moteur de screamers (Studio), module d'extension, `!peur` / `!bonbons` — [HALLOWEEN.md](HALLOWEEN.md) ; médias convertis dans son `.runtime\halloween\media` (hors Git)                                               | développé et testé automatiquement, **rien de validé ni de déployé**                                                                          |
| `C:\Users\Antoni\Documents\raptoru-docs` (`docs/consolidation`)                                              | documentation, = `origin/main`                                                                                                                                                                                                                                                               | poussé                                                                                                                                        |
| `C:\Users\Antoni\Documents\raptoru-spotify` (`feat/spotify-v2` = `origin/main`)                              | **Spotify V2** ; installateurs sup.9 / sup.10 et SHA-256 : `Documents\raptoru-spotify-GO\`                                                                                                                                                                                                   | livré, validé et **clos** le 25/10 ; rien en attente                                                                                          |

`scratchpad` = `C:\Users\Antoni\AppData\Local\Temp\claude\C--Users-Antoni-Documents-Raptoru-2-0\c435dbde-5dd7-4b54-8561-68eabf04712a\scratchpad`
(**dossier temporaire Windows ; l'Assistant de stockage y supprime des fichiers** : instantané du 24/10 dans
`Documents\Sauvegarde Raptoru 2.0\worktrees-2026-10-24\`, voir [BACKUPS.md](BACKUPS.md) § 3).

## 5. Risques et blocages connus

1. Données de travail de Studio (jetons, `.env`, `.runtime`) : sauvegardes ponctuelles vérifiées (24/10, avant sup.9,
   avant sup.10 — extraction complète testée le 25/10), aucune régulière ([BACKUPS.md](BACKUPS.md) § 1).
2. Base de Production : copie hors VPS du 24/10 09:56 vérifiée ; les suivantes demandent un téléchargement manuel dans
   Coolify (pas d'API, pas de SSH, pas de S3) ; restauration démontrée une seule fois (20/10).
3. Worktrees de travail non commité sous `AppData\Local\Temp` (risque de nettoyage automatique).
4. ~~Bot : 409 `not_lease_holder` définitif~~ : corrigé et déployé le 26/10 (`1df65d1`).
5. Checkout principal en retard sur `origin/main`, avec une copie de la Roue V2 désormais obsolète : sa mise à jour doit
   préserver les données de Studio et le correctif « écran gris » non commité (jamais de reset ni de clean).
6. Plusieurs documents de module ont encore un en-tête « non déployé » : la roadmap fait foi.

## 6. Prochaine action

- **Halloween (31/10)** — tout est livré ; restent les gestes d'Antoni ([HALLOWEEN.md](HALLOWEEN.md), liste « Avant le
  live ») : préparer et tester les filtres Chaos dans OBS, choisir les montants des nouveaux gains s'il le souhaite,
  ouvrir l'événement, activer le profil d'alertes Halloween. Ne rien déployer pendant le live.
- **Chaudron des subs** : PR #47 en brouillon (Lab, désactivé par défaut) ; livrable seulement sur GO (Core sans
  migration + Studio 0.1.22), après validation du design et de l'objectif par Antoni.
- Après Halloween : nouvelle version de l'extension (retire la section « Échanger des Jetons », liste les nouveaux
  gains), soumise en revue par Antoni.

0. **Dock OBS V1.2** (livré le 28/10 : Core `dc06344`, sans migration ; Studio 0.1.17 publiée) : installer Studio
   0.1.17, actualiser le dock dans OBS (même URL, même clé, préférences V1.1 reprises) et le tester en vrai
   ([OBS_DOCK.md](OBS_DOCK.md) « V1.2 »).
1. **Random Ban V3** : installer Studio 0.1.14. « Test Caution Random Ban » (Points de chaîne → Random Ban) : vraie
   sanction de 60 s libérable par `!caution raptoru_` (jetons réels, sans tirage ni Twitch). Suivi des tirages : paragraphe
   « Suivi du streamer ».
2. Premier live après la deuxième passe : délai des devis Caution (attendu sous ~1 s), demandes Spotify d'éditions
   (Indochine…), tranches Tombola, tirs Bonk.
3. Votekick : le son de lancement est validé (25/10) ; reste à confirmer la durée de vote réglable sur un vrai vote
   (GO requis pour tout vote réel).
4. **Roue du Sub V2** (livrée, active) : observer le premier live ([SUB_WHEEL_V2_DELIVERY.md](SUB_WHEEL_V2_DELIVERY.md) § 7, « À observer »).
5. Arbitrage restant de [ROADMAP.md](ROADMAP.md) § 3 : incident Twitch du 22/10 + Bonk/DSK.

## 7. Actions en attente d'accord d'Antoni

- Lors de la mise à jour du checkout principal sur `origin/main` (sa copie de la Roue V2 est remplacée par `main`) : retirer d'abord la
  copie non suivie `docs/REPRISE.md` (identique à la version suivie), sinon Git refuse d'écraser un fichier non suivi.
- **CI/CD** ([CICD.md](CICD.md)) : chantier clos le 25/10 — CI, déploiement du Core (11:11 UTC) et du bot (12:40
  UTC) depuis GitHub, publication Studio depuis GitHub (brouillon de test 0.1.8 créé, vérifié, supprimé) validés pour
  de vrai ; API Coolify sur `https://coolify.raptoru.fr`.
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
4. Travailler dans un worktree dédié basé sur `origin/main`, jamais dans le checkout principal (données de Studio,
   travail non commité).
5. À chaque étape franchie et avant de s'arrêter : mettre à jour ce fichier (court : état, décisions, prochaine
   action) ; le détail daté va dans un journal sous `archive/`.
