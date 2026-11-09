# Reprise — point d'entrée

**Mis à jour : 04/11/2026, après la livraison de raptoru.fr V2.**

**07/11/2026 — Opération Coulisses (bascule du nouveau Studio) : préparation terminée, en attente du GO de bascule d'Antoni.**
Point de reprise unique : [studio-refonte/OPERATION_COULISSES.md](studio-refonte/OPERATION_COULISSES.md) (état, sauvegardes,
migrations répétées, compatibilité, plan, retour arrière). API Coolify : `COOLIFY_URL=https://dashboard.raptoru.fr`.

- À lire en premier dans toute nouvelle session, puis `git status`.
- Vérifier soi-même `git log` et Coolify avant de se fier à un SHA écrit ici :
  `node scripts/coolify-deploy.mjs status core`, et `curl -s https://raptoru.fr/api/status` pour le site.
- L'état détaillé du 28/10 au 04/11 (Halloween, chantier du site) est archivé dans
  [archive/REPRISE_2026-10-28_2026-11-04.md](archive/REPRISE_2026-10-28_2026-11-04.md).
- La version du 28/10 de ce fichier reste dans l'historique Git.

**Raptoru 2.0** : la plateforme de stream auto-hébergée d'un streamer (Twitch `raptoru_`, id 83603689).

- Objectif : tout piloter depuis Raptoru Studio.
- Le **Core** décide (données, économie, règles, progression, récompenses).
- Le **bot** parle à Twitch (EventSub, commandes du chat).
- **Studio**, l'app Electron du PC, administre, crée, modère et pilote OBS.
- L'**extension** parle aux viewers pendant le live.
- **raptoru.fr** présente la communauté.
- SAMMI est **abandonné** depuis le 20/10 : ne jamais le réactiver.
- Architecture : [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Où lire quoi

| Besoin                                                                                              | Document                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Le site raptoru.fr** : contexte, architecture, état, décisions, prochaines étapes, **checkpoint** | **`lb-app/docs/SITE_CONTEXT.md`**, dépôt du site (`raptorutwitch/Leaderboard-Jeu-des-mots`, worktree `Documents\Raptoru 2.0 - Worktrees\raptoru-fr-refonte`) |
| Roadmap du projet, état de chaque module, arbitrages                                                | [ROADMAP.md](ROADMAP.md)                                                                                                                                     |
| Composants, flux, document de chaque module                                                         | [ARCHITECTURE.md](ARCHITECTURE.md)                                                                                                                           |
| Tests, déploiement, retour arrière, build Studio                                                    | [OPERATIONS.md](OPERATIONS.md), [CICD.md](CICD.md)                                                                                                           |
| Sauvegardes, restauration                                                                           | [BACKUPS.md](BACKUPS.md)                                                                                                                                     |
| Cosmétiques côté Core / défis / statistiques des modules                                            | [COSMETIC_SHOP.md](COSMETIC_SHOP.md), [CHALLENGES.md](CHALLENGES.md), [MODULE_STATS.md](MODULE_STATS.md)                                                     |
| Dernière publication (site, Core, Studio) : plan, compte rendu, retour arrière                      | [RELEASE_SITE_HUB.md](RELEASE_SITE_HUB.md)                                                                                                                   |
| Règles de travail des agents                                                                        | `CLAUDE.md` (racine)                                                                                                                                         |
| Anciens journaux                                                                                    | [archive/](archive/README.md)                                                                                                                                |

**Attention, deux copies.** Le checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0` est très en retard sur
`origin/main` : environ 260 commits le 04/11.

- Seuls `CLAUDE.md` et `docs/REPRISE.md`, une copie **non suivie** du présent fichier, y sont à jour.
- Lire les autres documents :
  - dans un worktree à jour de `origin/main`, par exemple `Documents\Raptoru 2.0 - Worktrees\site-hub-core` après `git fetch` ;
  - ou depuis le checkout principal, avec `git show origin/main:docs/<FICHIER>.md`.
- `C:\Users\Antoni\Documents\raptoru-docs` est en retard lui aussi.

## 2. Production (04/11/2026 ~02:00 UTC)

| Élément             | Version                                                                                                                                                   | Retour arrière                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Core `raptoru-core` | **`8a897a5`** (PR #55, 04/11) ; migrations `cosmetic_frames_banners` et `challenges` appliquées ; `CHALLENGES_ENGINE` absent (= off)                      | `deploy core 8b2189e --rollback --go`                 |
| Bot `raptoru-bot`   | **`4ba9243`** (27/10), inchangé                                                                                                                           | —                                                     |
| Site raptoru.fr     | **`74f7542`** (PR site #116, 04/11) ; ancien site sur `/classic/`                                                                                         | Coolify › redéployer `542b1f2`                        |
| Studio              | **0.1.25 publiée** le 04/11 (atelier Cadres / Bannières, onglet Défis). Version **installée sur le PC : à confirmer** par Antoni                          | réinstaller la 0.1.24                                 |
| Sauvegarde du Core  | Coolify quotidienne (04:00 UTC) ; 04/11 01:44 UTC juste avant les migrations ; dump 00:06 UTC vérifié par restauration (fichier chez Antoni, `Downloads`) | [BACKUPS.md](BACKUPS.md)                              |
| Coolify             | tableau de bord `https://dashboard.raptoru.fr` ; proxy API `https://coolify.raptoru.fr` en **502** le 04/11                                               | `COOLIFY_URL=https://dashboard.raptoru.fr` fonctionne |

En Production, relevé du 30/10 (non revérifié module par module le 04/11) :

- économie canonique (Wallet, Daily, fidélité, présence), Commands V2, modération ;
- Tombola, Jeu des mots, Roulette / Slot / Duel, Soundboard, TTS, Bonk, alertes V2 ;
- Points de chaîne et effets, Random Ban V3, Roue du Sub V2 ;
- Caution, Votekick V2, Spotify V2, Dock OBS ;
- Boutique cosmétique (depuis le 30/10 au soir).
- Événement Halloween **fermé** le 02/11.
- Niveau de validation de chaque module : [ROADMAP.md](ROADMAP.md).

## 3. Où on en est

- **raptoru.fr V2 : livré et clos le 04/11.**
  - Classements avec équipement, carte de joueur, cadres et bannières, statistiques des modules (privées), défis, Twitch,
    Portfolio, panneau « EN LIVE », Daily à 10 points.
  - Tout le détail est dans `lb-app/docs/SITE_CONTEXT.md` ; le **checkpoint du site est son § 13** (il n'y en a pas d'autre).
- **Protections actives** :
  - moteur de défis coupé ;
  - **aucun défi ni cosmétique définitif créé** : le contenu est à décider par Antoni.
- **Prochain chantier** : les vrais cosmétiques, les récompenses et les premiers défis.
  - Avant : confirmer Studio 0.1.25 installé et valider les parcours connectés du site (`SITE_CONTEXT.md` § 10-11).
- **En cours (GO du 04/11) : refonte UX/UI du Studio** — branche locale `feat/studio-ux`, worktree
  `Raptoru 2.0 - Worktrees\studio-ux`. **Reprise : [studio-refonte/CHECKPOINT.md](studio-refonte/CHECKPOINT.md)**,
  puis [CONTEXTE.md](studio-refonte/CONTEXTE.md) et [ROADMAP.md](studio-refonte/ROADMAP.md) (dans ce worktree).
  Rien de poussé, validé ni publié ; aucune release Studio sans GO explicite.
  - **Audit fonctionnel du 04/11** (démarrages, cycle du live, automatisations, réglages) :
    [studio-refonte/AUDIT_FONCTIONNEL.md](studio-refonte/AUDIT_FONCTIONNEL.md). Arbitrages H1-H16 à trancher par Antoni.
- **En cours (GO du 08/11) : Music Hub** — module « Musique » de l'extension sur la file Spotify V2 existante, payé en
  Jetons. Branche locale `feat/music-hub`, worktree `Raptoru 2.0 - Worktrees\music-hub`. Lab seulement, non validé.
  Design final (« une seule liste » : rideau de recherche, bandeau prix / demandes / délai, « en cours » en tête,
  notifications, « Musiques de la soirée » réelles) **intégré dans le vrai module**, tests verts. Lancement :
  `Ouvrir Music Hub (Lab).cmd` à la racine du worktree. 09/11 : Spotify V2 optimisé (quotas, priorités,
  `docs/music/SPOTIFY_QUOTA.md`) et vrai catalogue Spotify prêt en Lab, lecture seule par défaut
  (`Ouvrir Music Hub (Lab, Spotify reel).cmd`, `docs/music/SPOTIFY_REEL_LAB.md`). Musique en cours par Windows (SMTC)
  dans Studio et l'extension, plus « Musiques du stream » (`docs/music/SMTC_STUDIO.md`). Overlay musique OBS, 6 modèles,
  éditeur Studio (`docs/music/MUSIC_OVERLAYS.md`) ; 09/11 soir : bandeau compact « Jeu chargé » en deux lignes,
  défilement aller-retour / continu, languette « Demandé par », réglages de lisibilité, sections de l'éditeur qui
  restent ouvertes. 09/11 nuit (passe de finalisation) : overlay événementiel 30 s (« Afficher » = armé), `!song` en
  annonce Twitch (repli en message, 30 s de délai global, Windows d'abord), Pause / Passer directs pour les supermods
  et seek confirmé sur la barre, **skip payant des viewers** (25 000 Jetons doublés dans les 30 min, global,
  remboursé s'il échoue, demandes payées protégées), **Open Bar** (demandes gratuites sans limite par personne).
  Prochaine étape : essai d'Antoni (`docs/music/MUSIC_HUB_STATE.md` § 14.8), puis un vrai OBS.
  État et reprise : `docs/music/MUSIC_HUB_STATE.md` § 0.
- Profil d'alertes Halloween `halloween_alerts` : **encore actif** le 02/11, à couper sur GO d'Antoni.
- Un achat Halloween d’un viewer (125 Jetons, non remboursé) attend une décision d’Antoni ; le détail est conservé hors du dépôt public.
- PRs ouvertes du dépôt Raptoru 2.0 au 04/11 : #54 (titres équipés depuis Studio ; commit local `5d24614` non poussé),
  #47 (brouillon, chaudron des subs), #44 et #43 (brouillons), et les PRs de documentation #48, #40, #38, #36, #34.
- Côté site : PR #76 (ancienne) ; #115 est remplacée par la documentation de clôture et peut être fermée.
- Extension : nouvelle version après Halloween (sans « Échanger des Jetons »), à soumettre en revue par Antoni.
- Tests e2e de Studio instables (`tombola-bonbons`, `progression-studio`, `halloween-*`) et test Windows `alerts-se`
  pendant les releases : les relances passent, cause à traiter dans un chantier dédié.

## 5. Espaces de travail — ne rien écraser

- **Checkout principal** `C:\Users\Antoni\Documents\Raptoru 2.0` :
  - c'est **le dossier de données du Studio installé** (`.env`, jetons Twitch, `.runtime`) ;
  - il contient du travail non commité (`tools/subgoal/`, un correctif « écran gris » de l'extension…) ;
  - **jamais** de `git clean`, `reset --hard` ni `checkout .`.
- **Worktrees de travail** : `Documents\Raptoru 2.0 - Worktrees\…`. Nouveaux worktrees **uniquement** à cet endroit.
  - `raptoru-fr-refonte` : site, branche de documentation `docs/site-context` (locale, non poussée) ;
  - `site-hub-core` : Core et Studio, branche de documentation `docs/site-hub-delivered` (locale, non poussée ; elle remplace le `REPRISE.md` du 28/10 d’`origin/main`) ;
  - `studio-ux` : refonte du Studio, branche `feat/studio-ux` (locale, partie de `docs/site-hub-delivered`).
  - `music-hub` : Music Hub, branche `feat/music-hub` (locale, partie de `feat/extension-next` 2f45ac1).
- **Anciens worktrees** (`git worktree list`) :
  - sous `AppData\Local\Temp\…\scratchpad\*-wt` ;
  - `Documents\raptoru-*` ;
  - `Documents\Raptoru 2.0 - Worktrees\{halloween-24h, halloween-titles, live-feedback, responsive-live}`.
  - Ce sont surtout des chantiers fusionnés. **À vérifier un par un avant tout retrait** ; aucun n'a été nettoyé.
- **Sauvegardes** : `Documents\Sauvegarde Raptoru 2.0\` (accès restreint). Ne jamais les déplacer ni les supprimer.

## 6. Risques connus

1. Données de travail de Studio (`.env`, jetons, `.runtime`) : sauvegardes ponctuelles seulement ([BACKUPS.md](BACKUPS.md)).
2. Copies hors VPS de la base : manuelles (téléchargement dans Coolify). La restauration a été prouvée le 20/10, puis le
   04/11.
3. Checkout principal en retard et non commité : sa mise à jour doit préserver les données de Studio. Retirer d'abord
   la copie non suivie `docs/REPRISE.md`, sinon Git refuse d'écraser un fichier non suivi.
4. Proxy API Coolify en 502 : le workflow GitHub « Déployer » en dépend.

## 7. Règles (texte complet dans `CLAUDE.md`)

- GO explicite d'Antoni pour :
  - push, fusion, déploiement, migration ;
  - flag ou variable, redémarrage ;
  - release ou installation de Studio ;
  - OBS, Wallet, sanction Twitch hors test consenti, vote réel.
- « Validé » = testé à la main par Antoni. Les tests automatiques ne sont pas une validation.
- Git : ajouter les fichiers un par un ; jamais de reset, clean ni réécriture d'historique. Ne jamais committer
  `docs/HANDOFF_MIGRATION_2026-10-20.md` ni `docs/POST_LIVE_AUDIT_2026-10-20.md`.
- Ne jamais afficher un secret : jeton Coolify, `.env`, jetons Twitch, mot de passe OBS.
- Ne jamais créer de contenu métier à la place d'Antoni (défis, montants, récompenses, objets).

## 8. Procédure de reprise (nouvelle session)

1. Lire ce fichier, puis lancer `git -C "C:\Users\Antoni\Documents\Raptoru 2.0" status` et `git fetch`.
2. Pour le site : lire `lb-app/docs/SITE_CONTEXT.md`, en entier ou ses § 4, 10, 11 et 13.
3. Vérifier la Production en lecture seule : `node scripts/coolify-deploy.mjs status core`, depuis un worktree à jour (ajouter
   `COOLIFY_URL=https://dashboard.raptoru.fr` si `coolify.raptoru.fr` répond 502), et `https://raptoru.fr/api/status`.
4. Travailler dans un worktree basé sur `origin/main`, jamais dans le checkout principal.
5. À chaque étape franchie et avant de s'arrêter :
   - mettre à jour ce fichier (court : état, décisions, prochaine action) ;
   - mettre à jour `SITE_CONTEXT.md` pour le site ;
   - le détail daté va dans `archive/`.
