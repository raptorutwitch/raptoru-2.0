# Reprise — point d'entrée

Mis à jour : **28/10/2026 ~01:15 UTC** — passation de session. **Aucun chantier en cours : attendre les instructions
d'Antoni.** Dernier chantier : **Dock OBS V1.2, clos et validé à 100 % par Antoni dans son OBS** ([OBS_DOCK.md](OBS_DOCK.md)).
À lire en premier dans toute nouvelle session, puis `git status` / `git fetch`. Vérifier soi-même `git log`, Coolify et
la version de Studio installée avant de se fier à un SHA écrit ici.

**Raptoru 2.0** : plateforme de stream auto-hébergée d'un streamer (Twitch `raptoru_`, id 83603689). Tout se pilote
depuis Raptoru Studio : le **Core** décide (seule vérité, PostgreSQL), le **bot** LeCroupier_ parle à Twitch (EventSub,
chat, sanctions), **Studio** (Electron, PC d'Antoni) pilote OBS, les lecteurs et le dock, l'**extension** parle aux
viewers. SAMMI est **retiré** (débranché le 20/10, ne jamais le réactiver). Architecture : [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Documents

Les documents de référence sont sur **`origin/main`**. Le checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0`
est en retard (`main` local @ `11ffe3f`, vérifié le 28/10) : seuls `CLAUDE.md` et ce fichier (copie non suivie) y sont
à jour. Lire les autres avec `git show origin/main:docs/<fichier>` depuis le checkout principal, ou dans un worktree à
jour (par exemple `C:\Users\Antoni\Documents\raptoru-docs` après
`git -C C:\Users\Antoni\Documents\raptoru-docs pull --ff-only origin main`).

| Besoin                                                          | Document                                                                                                                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| État de chaque module (niveau de validation), sujets ouverts    | [ROADMAP.md](ROADMAP.md)                                                                                                                                                                        |
| Composants, flux, dépendances, document de chaque module        | [ARCHITECTURE.md](ARCHITECTURE.md) (§ 5)                                                                                                                                                        |
| Livrer : CI, déploiement Core / bot, publication Studio, échecs | [CICD.md](CICD.md)                                                                                                                                                                              |
| Tests, retour arrière, vérifications en lecture seule, Coolify  | [OPERATIONS.md](OPERATIONS.md)                                                                                                                                                                  |
| Sauvegardes, restauration, risques de perte                     | [BACKUPS.md](BACKUPS.md)                                                                                                                                                                        |
| Dock OBS (référence finale)                                     | [OBS_DOCK.md](OBS_DOCK.md)                                                                                                                                                                      |
| Random Ban V3 · Caution · Votekick · Spotify · Roue du Sub V2   | [RANDOM_BAN_V2.md](RANDOM_BAN_V2.md) § V3 · [CAUTION.md](CAUTION.md) · [VOTEKICK_V2.md](VOTEKICK_V2.md) · [SPOTIFY_V2.md](SPOTIFY_V2.md) · [SUB_WHEEL_V2_DELIVERY.md](SUB_WHEEL_V2_DELIVERY.md) |
| Journaux anciens (21→24/10…)                                    | [archive/](archive/README.md)                                                                                                                                                                   |
| Règles de travail des agents                                    | `CLAUDE.md` (racine)                                                                                                                                                                            |

## 2. Production (relevé en lecture seule le 28/10 ~00:50 UTC)

| Élément             | Version / état                                                                                                       | Preuve / remarque                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Core `raptoru-core` | **`dc06344`** (Dock OBS V1.2, déployé 28/10 ~00:09 UTC, sans migration)                                              | Coolify `running:healthy`, `/health` et `/ready` 200 (vérifié) ; retour : `190bc0a`   |
| Bot `raptoru-bot`   | **`4ba9243`** (Random Ban V3, 27/10 01:47 UTC ; inchangé depuis)                                                     | Coolify `running:healthy` (vérifié) ; retour : `5e7ebe6`                              |
| `origin/main`       | `05b9a1c` (documentation) ; dernier code = `dc06344` (= Core déployé)                                                | vérifié                                                                               |
| Studio (PC)         | **0.1.17 installée** (= dernière release publique, `raptoru-studio-releases` `v0.1.17`)                              | version lue sur l'application installée (vérifié) ; retour : réinstaller 0.1.16       |
| Dock OBS            | **V1.2 validée à 100 % par Antoni** dans son OBS (dock « Raptoru », port 4110, URL et clé inchangées depuis la V1)   | [OBS_DOCK.md](OBS_DOCK.md)                                                            |
| Roue du Sub         | V2 active (mode `v2`) depuis le 26/10, invitations ON, récupération des doubles crédits OFF                          | relevé du 26/10, non revérifié ; [SUB_WHEEL_V2_DELIVERY.md](SUB_WHEEL_V2_DELIVERY.md) |
| Extension Twitch    | `0bf7907` publiée ; aucune nouvelle version depuis                                                                   | version servie non vérifiable depuis le dépôt ; publication manuelle par Antoni       |
| Flags               | Core `CAUTION_CHAT`, `VOTEKICK_CHAT`, `SPOTIFY_CHAT` = true ; bot `CAUTION`, `VOTEKICK`, `CP_TWITCH_ACTIONS` = true  | relevé du 26/10, non revérifié                                                        |
| OBS au repos        | « Micro » non muté ; filtres Votekick désactivés ; `zoom` 1,000001, `zoom_max` 1,101, drive 0,8, `mute_duration` 110 | relevé du 26/10 ; ne rien modifier sans GO                                            |
| Staging             | `raptoru-core-staging`, branche `feat/compact-video-port`                                                            | Node non épinglé (décision en attente)                                                |

Fonctions en Production : économie canonique (Wallet, Daily, fidélité, présence), Commands V2, modération D4, Tombola,
Jeu des mots, Roulette / Slot / Duel, Soundboard, TTS, Bonk, alertes V2, Points de chaîne et effets, Random Ban V3,
Roue du Sub V2, Caution, Votekick V2, Spotify V2, **Dock OBS V1.2**. Niveau de validation de chacune :
[ROADMAP.md](ROADMAP.md) § 1.

## 3. Acquis récents (24–28/10) et niveau de validation

« Validé » = testé à la main par Antoni ; sinon, seulement déployé et couvert par des tests automatiques.

- **Dock OBS V1 → V1.2 (27–28/10) — clos, validé à 100 % par Antoni dans son OBS** : fil d'activité Twitch (follows,
  subs, subgifts, bits, raids, dons, points de chaîne) et Raptoru (TTS, Soundboard, Bonk, Random Ban, Tombola) ; journal
  projeté par le Core (lecture seule), relais Studio et serveur local dédié (`127.0.0.1:4110`, clé dans l'URL) ;
  identité visuelle par famille, avatars Twitch, temps courts, coûts des récompenses masqués par défaut, filtres
  détaillés et par récompense, seuls les Bonks regroupés, rejeu des alertes en un clic (animation seule, aucun effet
  économique), sélection multiple et corbeille d'affichage locale. Les cas rares sont couverts par les tests
  automatiques, pas par la validation. Détails : [OBS_DOCK.md](OBS_DOCK.md).
- **Random Ban V3 (27/10)** — en Production ; **« Test Caution Random Ban » validé en réel par Antoni** ; le reste est
  couvert par les tests et le suivi des tirages : acheteur tiré avec un poids 1/4 (« CSC ») ; streamer tiré 2 % des
  fois s'il est éligible → « Micro » coupé 60 s dans OBS + zoom + bandeau MUTED (jamais de timeout) ; micro partagé et
  sanctions coordonnées Random Ban / Votekick / BRB (la voix revient à la fin de la dernière) ; Caution sur un mute OBS :
  300 Jetons par tranche de 10 s restantes, libère toute la sanction ; signal « prêt » d'OBS envoyé à part des
  animations ; chaque tirage garde la décision pour le streamer et le motif d'inéligibilité (résumé dans Studio).
  [RANDOM_BAN_V2.md](RANDOM_BAN_V2.md) § V3, [CAUTION.md](CAUTION.md).
- **Deuxième passe (26/10)** — déployée, **non observée en live** : Tombola (tranches en brouillon), Bonk (un tir sur six
  appuyé), Spotify (éditions d'un même morceau départagées), bot `5e7ebe6` (Caution et chat plus réactifs).
- **Correctifs stream (26/10)** — déployés, **non observés en live** : mini-jeux seulement en live, messages courts,
  Tombola (gain égal, une annonce, au moins 2 gagnants dès 4 participants), Jeu des mots (8 phrases de série).
- **Roue du Sub V2 (26/10)** — active ; validation réelle au premier live ([SUB_WHEEL_V2_DELIVERY.md](SUB_WHEEL_V2_DELIVERY.md) § 7).
- **Spotify V2 (25/10) — validé en réel par Antoni, clos** : demandes `!song`, `!songcancel 1` / `2`, remboursements,
  quotas et exceptions, File musicale, skip automatique (accepté tel quel).
- **Votekick V2** — validé en réel en partie (votes du 23/10, son de lancement le 25/10) ; durée réglable à confirmer.
- **Caution** — validée en réel le 23/10 ; sur mute OBS validée via le test Random Ban.
- **Infrastructure (25/10) — close** : CI et déploiements Core / bot depuis GitHub Actions + Coolify, publication Studio
  depuis GitHub ([CICD.md](CICD.md)) ; Coolify `https://dashboard.raptoru.fr`, API `https://coolify.raptoru.fr`, ports
  d'administration fermés ([OPERATIONS.md](OPERATIONS.md) § 8) ; sauvegarde de la base avant chaque migration, retours
  arrière et vérifications de santé intégrés à l'outil de déploiement.

## 4. Ne rien écraser

| Où                                                                                | Contenu                                                                                                                                                                                                                                                                                  | Règle                                                                       |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0` (`11ffe3f`)            | **dossier de données de Studio installé** (`.env`, jetons Twitch, `apps/studio/server/.runtime`) ; correctif « écran gris » de l'extension non commité ; ancienne copie non commitée de la Roue V2 (obsolète, remplacée par `main`) ; documents non suivis                               | jamais `git clean`, `reset --hard`, `checkout .` ; ne pas y développer      |
| Worktrees `Documents\raptoru-{dock,random-ban,roue-v2,spotify,cicd,docs,release}` | branches fusionnées dans `origin/main` (vérifié le 28/10 ; `raptoru-release` : contenu repris par PR #1 sous d'autres SHA ; `raptoru-roue-v2-backup` = sauvegarde volontaire) ; quelques fichiers locaux non suivis (`lab-rb3.cmd`, `vps-ports-commandes.txt` dans `raptoru-random-ban`) | retirables après accord d'Antoni ; `raptoru-roue-v2-backup` = sauvegarde    |
| `C:\Users\Antoni\Documents\rs-vk`                                                 | clone de build Studio, dossier `GO/` (runbook, SQL)                                                                                                                                                                                                                                      | ne pas nettoyer                                                             |
| Worktrees `…\Temp\claude\…\scratchpad\{chat,wg,solde,node,rb,sb,sup,deliv,vk}-wt` | restes de lots déjà intégrés                                                                                                                                                                                                                                                             | dossier temporaire Windows (risque de nettoyage) ; revérifier avant retrait |

Copies de sécurité : [BACKUPS.md](BACKUPS.md) (§ 3 : instantané des worktrees du 24/10).

## 5. Risques connus

1. Données de travail de Studio (jetons, `.env`, `.runtime`) : sauvegardes ponctuelles seulement ; chaque publication
   Studio vérifie que la mise à jour garde les fichiers utilisateur à l'identique ([BACKUPS.md](BACKUPS.md) § 1).
2. Base de Production : sauvegarde Coolify avant chaque migration ; copie hors VPS manuelle (dernière vérifiée : 24/10) ;
   restauration démontrée une seule fois (20/10).
3. Checkout principal en retard : sa mise à jour doit préserver les données de Studio et le correctif « écran gris »
   (retirer d'abord la copie non suivie `docs/REPRISE.md`, sinon Git refuse d'écraser).
4. Faux « ÉCHEC » possible au déploiement du bot (état Docker lu une fois ; relancer à l'identique) ; tests instables
   connus : `sub-wheel-v2-studio` « Lab bug » (échoue sur le PC, vert en CI), `sub-wheel-r2`, `alerts-se`, plantage
   Windows `prod-transport`, crash 0xC0000409 sous charge.
5. Plusieurs documents de module gardent un en-tête « non déployé » : la roadmap fait foi.

## 6. Prochaine action

**Attendre les nouvelles instructions d'Antoni.** Ne lancer aucun chantier (pas de « V1.3 » du dock, pas d'audit
général) sans sa demande. Les sujets ouverts connus sont listés, sans priorité ni engagement, dans
[ROADMAP.md](ROADMAP.md) § 3 (observations en live, Votekick, pistes du dock, CI instable, arbitrages anciens,
sauvegardes).

## 7. Règles (texte complet dans `CLAUDE.md`)

- GO explicite d'Antoni pour : tout push vers la Production, déploiement, migration, flag / variable, redémarrage,
  installation de Studio, release Studio, modification d'OBS (scènes, sources, réglages), remboursement / ajustement
  Wallet, sanction Twitch, vote réel, test économique réel. Exception : une PR **strictement documentaire** peut être
  fusionnée si sa CI est verte, quand Antoni l'a autorisé pour la mission en cours.
- Distinguer toujours : code écrit · tests verts · PR fusionnée · Production déployée · **validé en réel par Antoni**.
  Les tests automatiques ne remplacent jamais une validation dans le vrai OBS / Studio.
- Développer dans un worktree isolé basé sur `origin/main`, jamais dans le checkout principal ; préserver profils
  Studio, réglages OBS et secrets ; ne jamais afficher un secret (jeton Coolify, mot de passe OBS, jetons Twitch, `.env`).
- Aucun vrai événement Twitch, achat, rejeu, transaction ou mouvement de jetons pour tester sans autorisation ; pas de
  Lab séparé imposé à Antoni pour ce qui se teste hors live dans le vrai Studio.
- Ne pas modifier silencieusement un réglage fonctionnel déjà validé ; pas de refonte ni d'audit non demandés ;
  préférer les solutions simples, intégrées et maintenables aux infrastructures parallèles.
- Interfaces : modernes, intuitives, dynamiques mais sobres, très soignées ; l'ancienne esthétique de Studio n'est pas
  une référence de qualité obligatoire.
- Git : ajouter les fichiers un par un (jamais un dossier ni un `.runtime*-test-*`) ; jamais de reset, clean ni
  réécriture d'historique ; ne jamais committer `docs/HANDOFF_MIGRATION_2026-10-20.md` ni
  `docs/POST_LIVE_AUDIT_2026-10-20.md`. Ne jamais réactiver SAMMI.

## 8. Procédure de reprise (nouvelle session)

1. Lire ce fichier et `CLAUDE.md` ; `git -C "C:\Users\Antoni\Documents\Raptoru 2.0" fetch` puis `status`.
2. Production en lecture seule : Actions → « État de la livraison », ou dans un worktree à jour de `origin/main` :
   `node scripts/delivery/status.mjs` (ou `node scripts/coolify-deploy.mjs status core` / `… status bot`).
3. Lire [ROADMAP.md](ROADMAP.md) (§ 1 états, § 3 sujets ouverts, § 4 décisions), puis le document du module concerné.
4. Attendre la demande d'Antoni ; pour un développement, créer un worktree dédié depuis `origin/main`.
5. À chaque étape franchie et avant de s'arrêter : mettre à jour ce fichier (court : état, décisions, prochaine action) ;
   le détail daté va dans le document du module ou un journal sous `archive/`.
