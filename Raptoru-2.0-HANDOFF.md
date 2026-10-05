# Raptoru 2.0 — HANDOFF (à lire en premier)

## État courant — 05/10/2026 : PRÉPARATION DU CUTOVER (lire en premier)

Vérifier `git status` / `git log` (HEAD ≥ `9ab0523` au début de cette phase).

- **Consolidation globale VALIDÉE manuellement par Antoni le 05/10/2026.** Smoke test final OK : Hub / navigation ;
  TTS réel (normal, STOP, second TTS — un player OBS / preview est requis : sans lui le TTS s'affiche « indisponible »,
  comportement normal) ; Soundboard (lecture, STOP) ; Bonk Unicode / local et Bonk Twitch en **rôle viewer lié**
  (broadcaster / modérateur Lab = identités fictives, emotes Twitch non sélectionnables depuis `9ab0523`) ; Tombola ;
  Modération ; Commands. L'ingestion Twitch réelle n'était pas un critère bloquant.
- **Commands V2 A0 → F** terminé et validé ([`docs/COMMANDS_V2_STATUS.md`](docs/COMMANDS_V2_STATUS.md)).
- **Audit Astra** ([`docs/ASTRA_GLOBAL_AUDIT_2026-10.md`](docs/ASTRA_GLOBAL_AUDIT_2026-10.md), registre canonique) :
  P0 = 0 · P1 = 14 fermés + **5 bloqués pour le cutover** (001 Wallet canonique, 006 EBS public / JWT Twitch, 007 session
  de stream canonique, 010 Channel Points réels, 019 transport Studio ↔ Core prod) · P2 = 26 fermés + 3 différés (015,
  021, 025) · P3 = 3 fermés / acceptés + 3 ouverts volontairement (001 signature Windows, 002 nommage BonkLab, 006 UX).
- **Phase actuelle = préparation du cutover.** Référence canonique : [`docs/CUTOVER_PLAN_2026-10.md`](docs/CUTOVER_PLAN_2026-10.md)
  (les 5 P1 revalidés sur `9ab0523`, dépendances, rollback, coexistence, décisions D1–D6).
- **Ordre recommandé** : socle staging Coolify → P1-019 transport → P1-001 port économique (parallélisable) → P1-006 EBS
  public → parcours vertical future-prod (Bonk Unicode payé en Jetons de test, plan § 7) → P1-007 session → P1-010
  Channel Points → cutover économique unique.
- **Rien n'est autorisé au-delà de la préparation** : aucune release (`studio:release`), aucun push, déploiement,
  migration distante, écriture en base de production, changement Twitch réel, SAMMI ou StreamElements, aucun cutover
  sans validation explicite d'Antoni. **SAMMI + StreamElements + EBS legacy (`raptoru.fr/api`, Coolify) + Extension
  publiée restent la production.** Cible d'hébergement : VPS Coolify (Vercel est historique).
- **Aucune release Studio depuis 0.1.5.** E2E navigateur versionnés : `npm run e2e`.
- **P1-019 — lot 1 terminé le 05/10/2026** (`fe7d524`, `b12bfec`, `9d8e305`, `48d5fa6`, `5b6fc49` + docs ; HEAD ≥ ces commits) :
  transport future-prod Studio → Core **local**, en HTTPS (certificat de test), identité d'installation Studio +
  identifiant révocable, version de protocole (426 `protocol_incompatible`), routes `/v1/studio/*` liées à
  l'installation, client Studio séparé des clients Lab, même journal / `execution_unknown` / aucun rejeu. **Lab
  inchangé.** Tests automatiques verts (Core `studio-transport` 7, Studio `prod-transport` 13 ; suites Core 386 / Studio
  server 162 / Bot 98 / Extension 38 / Desktop 20 ; lint, typecheck, build). En parallélisme complet sur cette machine
  chargée, la suite Core montre des timeouts PGlite **préexistants** (40 échecs aussi sur `86d314f`) : lancer
  `npx vitest run --maxWorkers=3` dans `apps/core-api`. **P1-019 n'est pas fermé** : profil production non câblé dans
  Studio (D6), Soundboard / TTS, cockpit, staging, appairage distant, rate limiting (plan § 4.5 « Lot 1 »).
- **Lot 1 validé manuellement par Antoni le 05/10/2026** : smoke de non-régression dans `npm run studio`, OBS / player ouvert — Bonk Unicode OK, Bonk Twitch en rôle viewer lié OK, Soundboard OK, STOP Soundboard OK, TTS OK, STOP TTS OK, second TTS OK ; aucun comportement Lab dégradé observé.
- **P1-019 — lot 2 implémenté le 05/10/2026** (`4b5c1cf`, `d2854ed`, `a75ba24`, `5551ef3`, `8c2ab6d` + revue / docs ; vérifier
  `git log`) : **D6** — une app Studio, profils **Lab (défaut)** / **Production**, choix persistant lu au démarrage ;
  changement et régénération d'identité uniquement via Electron main (dialogue natif, redémarrage supervisé). Production :
  ni Core Lab ni outils Lab ; Bonk, Soundboard, TTS sur le transport HTTPS (journaux et jetons de lecteurs séparés).
  URL du Core Production et CA de test **par l'environnement** (`RAPTORU_PRODUCTION_CORE_URL`,
  `RAPTORU_PRODUCTION_CA_FILE`), identité liée à ce Core. Carte « Profil Studio » dans l'onglet Studio. Outil de test :
  `npm run test:local-https-core -w @raptoru/core-api` (Core en mémoire, jamais la prod). Tests verts : Studio server
  194, Core 388 (`--maxWorkers=3`), Desktop 20, Bot 98, Extension 38 ; lint, typecheck, build.
- **Correctif `ea1f3f8`** (trouvé pendant la validation manuelle du lot 2) : en profil Production, plus d'Extension
  Lab (la façade non reliée servait une simulation périmée) — message explicite à la place ; Lab inchangé.
- **Correctifs `8d7416c` + `afa99c1`** (validation du lot 2) : en Production, les lecteurs se règlent dans l'onglet
  Studio (carte « Lecteurs Production » : overlay Bonk + connexion OBS, lecteur Soundboard, source OBS TTS) ; les
  ressources `/ext/` des lecteurs sont de nouveau servies (seules les pages de l'Extension sont refusées).
- **Lot 2 validé manuellement par Antoni le 05/10/2026** (profil Production local contre le Core de test HTTPS) : appairage OK ; Bonk, Soundboard + STOP, TTS + STOP + second TTS en Production OK ; Extension Lab indisponible en Production OK ; retour au Lab avec la preview actuelle complète OK ; `revoke <installation_id>` → Studio « Révoqué » OK. Le `overlay_not_ready` Bonk observé venait de la source OBS absente / inactive dans la scène, pas du transport. Correctifs trouvés pendant la validation, validés aussi : `ea1f3f8` (pas de fausse Extension Lab en Production), `8d7416c` (ressources statiques des lecteurs Production servies), `afa99c1` (carte « Lecteurs Production » dans Studio).
- **Reste de P1-019 (non fermé)** : staging Coolify ; appairage distant réel (opérateur sur le Core distant, révocation à distance) ; TLS public du reverse proxy ; rate limiting ; cockpit Production incomplet (wallet admin, staff, modération, configuration TTS / sons, Tombola, Commands encore sous `STUDIO_SECRET` / Lab) ; URL Production en constante de build ; seams des futurs paiements réels (lecteurs n'acceptant encore que `simulated`, lié à P1-001).
- **P1-001 — lot 1 fait le 05/10/2026** (`1e86d96`, `ad2be7f`, `a69dd19`) : débit économique et admission dans **une seule transaction**
  (`WalletService.spendIn` / `creditIn`, `EconomyPort` : `labEconomy` par défaut — Lab inchangé —, `coreWalletEconomy`
  pour le Wallet canonique, utilisé par les tests seulement). Preuves PGlite + PostgreSQL réel (concurrence). Aucune
  migration, aucun runtime branché sur le Wallet réel, aucune donnée StreamElements. **P1-001 non fermé** : D1 + import
  SE, D2 (crédits), schéma d'interactions de production, lecteurs pour paiement réel, branchement, cutover économique.
  Pas de surface manuelle à valider pour ce lot (rien d'observable en Studio).
- Prochaine action : à décider par Antoni (D1 / D2, socle staging D3, ou P1-007 session canonique en local).

Le reste de ce fichier décrit le **checkpoint du 03/10/2026** (historique, toujours utile pour les règles et le
contexte).

---

**État au 03/10/2026 · HEAD `ed781f6` (passe UX post-Tombola) · Tombola V2 TERMINÉE / VALIDÉE / CHECKPOINT FIGÉ (Lab) · Modération V2 parité D4 validée · dernière release publique Studio 0.1.5.**
Ce fichier est la **source de contexte prioritaire** pour un nouvel agent. Le détail historique complet (Presence, Wallet, Loyalty, Daily, Twitch, Studio, inventaire du stream, roadmap longue) reste dans `Raptoru-2.0-ETAT-PROJET.md`. La matrice de parité D4 (initiale et finale) est dans `docs/moderation-v2-d4-parity.md` ; celle de la Tombola V2 dans `docs/tombola-v2-parity.md`. En cas de contradiction, **vérifier Git et le code**, puis corriger le document fautif.

---

## 0. RÈGLES DE REPRISE (non négociables)

### Prototype = spécification

- Pour toute UX déjà validée, **le prototype est une spécification, pas une inspiration**.
- Toute migration commence par une **matrice de couverture** :
  `élément prototype | backend existe | porté | adaptation | bloqué`.
- **Aucun élément ne doit être supprimé, simplifié ou remplacé silencieusement.**
- Une limitation backend se complète dans le backend ; si elle est objectivement impossible (dépendance extérieure), elle se remonte **comme limitation**, jamais comme décision UX implicite.
- Précédent à ne pas répéter : la première console Modération de l’extension (`12ffdd0`) a été annoncée « D4 » alors qu’un audit strict a montré une migration **fortement simplifiée** (~50 % du prototype).

### Validation — toujours distinguer

1. code présent ;
2. tests unitaires / intégration ;
3. E2E (navigateur : `npm run e2e`, versionnés depuis le 04/10/2026 ; les anciens scripts de session restent hors dépôt) ;
4. **validation manuelle par Antoni** ;
5. package local ;
6. release publique.

**Ne jamais écrire « validé » pour quelque chose qu’Antoni n’a pas testé lui-même.**

### Architecture

- **Core = source de vérité** (métier, économie, états, permissions, audit).
- Twitch Bot = adaptateur fin Twitch → Core.
- Studio = cockpit / runtime local du streamer (pas de logique métier).
- Extension = interface viewer-first ; **aucune logique métier dupliquée**, aucun état local présenté comme vérité.
- **Aucune simulation présentée comme backend réel.**

### Git / release / prod

- Pas de push (le repo source n’a pas de remote), pas de tag.
- **Pas de `npm run studio:release` sans validation explicite d’Antoni** (« c’est bon », « validé », « go ») — voir `CLAUDE.md`.
- Ne jamais committer `.env`, tokens, secrets, fichiers runtime.
- `prototypes/` : local, non versionné (exclu via `.git/info/exclude`) — ne jamais le supprimer, l’ajouter à un commit ou le modifier.
- **SAMMI + StreamElements restent la production.** Aucun cutover, aucune migration prod, aucune publication d’extension Twitch (ni ZIP, ni Hosted Test) sans feu vert global.
- Workspace legacy `C:\Users\Antoni\Documents\Raptoru\CANONICAL_WORKSPACE` et dossier `…\Alertes Twitch Pour Claude\TTS Webm` : lecture seule.

---

## 1. TL;DR état actuel

- **Public / installé** : Raptoru Studio **0.1.5** (validé manuellement) = Studio autonome + supervision Electron + Hub + Bonk V2 + Soundboard V2 + TTS V2 réel. Il **ne contient ni** la Modération V2 **ni** la Tombola V2.
- **Local, non releasé, VALIDÉ MANUELLEMENT par Antoni** :
  - **Modération V2 complète, parité D4** (`5b66579`, validée le 01/10/2026) : une seule console partagée par l’extension et l’onglet Studio « Modération ».
  - **Tombola V2 — TERMINÉE / VALIDÉE / CHECKPOINT FIGÉ** (Lab, phases C → H + passe UX, validée le 02–03/10/2026) : voir § 13.
  - **Passe UX post-Tombola** (`ed781f6`, 03/10/2026) : onglet Studio Tombola en sections repliables ; Modération V2 sans menu « … », actions en icônes d’en-tête.
- **Tous les tests automatiques sont verts** sur `ed781f6` (chiffres § 7 et § 13).
- **Aucun package local** n’a été construit depuis `release/moderation-d4` (état `5b66579`, avant la Tombola V2) ; rien n’est releasé.
- **Prochaine action** : à décider par Antoni (§ 11). Aucun chantier ouvert.

## 2. Workspace / commandes / chemins

| Quoi                                   | Où                                                                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace canonique                    | `C:\Users\Antoni\Documents\Raptoru 2.0` (branche `main`, aucun remote, aucun tag)                                                                           |
| Règles agent                           | `CLAUDE.md` (releases Studio) · ce fichier · `Raptoru-2.0-ETAT-PROJET.md` · `docs/moderation-v2-d4-parity.md` · `README.md`                                 |
| Studio source (dev)                    | `npm run studio` (Electron + serveur Studio 4100 + Core Lab 4301, base `raptoru_bonk_lab`)                                                                  |
| Dernier package local (ancien)         | `apps/studio/desktop/release/moderation-d4/win-unpacked/Raptoru Studio.exe` — état `5b66579`, **sans la Tombola V2** : tester le HEAD avec `npm run studio` |
| Packages obsolètes — **ne pas tester** | `release/mini-d4/` (état `a5b5d5e`), `release/win-unpacked/` (état `12ffdd0`), `release/win-unpacked.tmp` (build interrompu)                                |
| Studio installé                        | `%LOCALAPPDATA%\Programs\Raptoru Studio` (0.1.5) ; logs `%APPDATA%\Raptoru Studio\logs\studio-server.log`                                                   |
| Checks                                 | `npm run lint` · `npm run format:check` · `npm run typecheck` · `npm test`                                                                                  |
| Release (après validation seulement)   | `npm run studio:release` (dry-run : `-- --dry-run`)                                                                                                         |

Pièges connus :

- Studio installé, Studio source et packages locaux **partagent le même verrou d’instance** : fermer l’un avant de lancer l’autre.
- Le Studio installé sert une **copie figée** de l’extension : il ne montre jamais les changements locaux.
- **La migration Lab `20261007120000_moderation_d4.sql` est appliquée à la base Lab `raptoru_bonk_lab` au premier lancement du package** : elle remplace la table des cooldowns (données Lab uniquement). Après ça, ne plus lancer le package `mini-d4` (son code de cooldown n’est plus compatible). Studio 0.1.5 reste compatible (colonnes ajoutées avec valeurs par défaut).
- Vitest sous Windows peut crasher un fichier sous charge turbo (0xC0000409) : relancer ; supprimer les dossiers `apps/studio/server/.runtime-*-test-*` restants.
- Tests E2E : environnement isolé (Studio 4111 / Core Lab 4311, base dédiée `raptoru_bonk_lab_modd4e2e`, supprimée après usage) piloté par des scripts de session **non versionnés** (Electron : vraies pages, vrais lecteurs, vrais achats Lab EBS, clics dans la console).

## 3. Release publique actuelle

- **Raptoru Studio 0.1.5**, tag `v0.1.5`, publiée le 30/09/2026 sur le repo public `raptorutwitch/raptoru-studio-releases` (commit source `f81955d`).
- Validée manuellement par Antoni avant publication.
- L’extension Twitch n’a **jamais** été republiée : la production Twitch reste l’ancienne extension.

## 4. HEAD local actuel

- `ed781f6 — feat: post-Tombola UX pass — Studio Tombola sections and Moderation header actions (Lab)` (dernier commit fonctionnel), suivi du commit docs de checkpoint Tombola.
- Toujours revérifier : `git status` · `git log --oneline -12`.
- Commits non releasés depuis 0.1.5 : `435f78d`, `706f8c7`, `12ffdd0`, `890e71d`, `a5b5d5e`, **`5b66579`**, Tombola V2 `023cb64`, `3cc5fab`, `fef50df`, `0e90f13`, `72269b1`, **`ecc0275`**, **`ed781f6`** (+ commits docs).

## 5. Architecture canonique

`Extension (viewer) → EBS (prod) / façade LabEbs (Lab, dans le serveur Studio) → Core → workers Studio → lecteurs / OBS → ACK → Core`.

- Lab : tout est `test_mode=true`, `payment_mode=simulated`, `real_debited=0` ; wallet de test Lab en base Lab, jamais l’économie réelle.
- Routes Lab exposées **uniquement** par le Core Lab : `/v1/lab/moderation/*` (actions, whoami, overview, search, viewers, interactions, ledger, team, words, audit), `/v1/lab/raffle/*`, `/v1/lab/wallet/*`, `/v1/lab/tts/rules`.
- Les read models ne sont jamais servis à un viewer : la façade nomme le lecteur (`as`, `as_role`) et **Core refuse** un viewer.
- Chaîne Studio : Electron main → serveur Studio → Local Runtime Manager → Postgres Docker → Core Lab / workers / lecteurs.
- **Une seule console Modération** : `apps/twitch-extension/extension/shared/moderation-v2.js` (+ `moderation-v2.css`), montée par l’extension (façade LabEbs, acteur = identité Twitch de l’appelant) et par Studio (`/ext/…` servi par Studio, acteur = broadcaster via `/api/lab`).

## 6. Modules

| Module            | Référence UX (vérité)                                                              | État réel                                                                                                      | Validation Antoni                                                              |
| ----------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Hub**           | `prototypes/hub-nav-dots-footer/` (variante C « Tous dominant ») + Hub Pop Premium | Implémenté (`0a5c4e9`, `5538111`), dans 0.1.5                                                                  | **Validé** (28–29/09)                                                          |
| **Bonk V2**       | Implémentation validée + audit Bonk V2 (pas de prototype dans `prototypes/`)       | Réel en Lab, dans 0.1.5 ; **depuis `5b66579` débité sur le wallet Lab** (200 J, remboursé si jamais affiché)   | **Validé** (27/09, avant le débit) ; reste Bonk Fidelity (polish)              |
| **Soundboard V2** | Implémentation validée (pas de prototype)                                          | Réel en Lab, dans 0.1.5 ; **depuis `5b66579` débité sur le wallet Lab**, stop réel d’un son, remboursements    | **Validé** (28/09, avant débit / stop)                                         |
| **TTS V2**        | `prototypes/tts-v2-extension-ux/` (D3) + `prototypes/tts-v2-player/`               | Réel en Lab, dans 0.1.5 ; **depuis `5b66579` : mots surveillés / bloqués, cooldown D4, pause globale**         | **Validé** (30/09) — dette : lecture possible avant la fin du shuffle / reveal |
| **Modération V2** | **`prototypes/moderation-v2-d4/`** (spécification)                                 | **Parité D4 complète** (`5b66579`) — non releasé                                                               | **Validé** (01/10)                                                             |
| **Tombola V2**    | `prototypes/tombola-v2/` (spécification) + section Tombola de la D4                | **Complète en Lab** (Core, Studio, Extension Panel / Mobile / Vidéo, overlay OBS, modération D4) — non releasé | **Validé** (02–03/10) — **checkpoint figé** (§ 13)                             |

### Modération V2 — détail exact (`5b66579`)

Décisions d’Antoni (30/09) appliquées : Tombola = modèle réel (inscription gratuite) ; mot surveillé = TTS **retenu** jusqu’à « Laisser passer » ; un mod ne donne que les permissions qu’il possède ; « Rembourser » après coup = Admin Wallet.

- **Permissions (Core)** : rôles Broadcaster / Supermod / Moderator / Viewer + **6 permissions D4 par mod** (Admin Wallet, Désactiver un module, Pause globale, Gérer les permissions, Sanctions sensibles, Mots surveillés / bloqués), stockées dans `lab_staff.grants`, appliquées par Core (403 avec la permission nommée). Anti-escalade : jamais ses propres droits, jamais un supermod ou le broadcaster, uniquement les permissions qu’on possède. Un mod rejoint l’équipe à sa première ouverture de la console (rôle Twitch) ; supermod nommé depuis Studio.
- **Sanctions sensibles** (D4) : « Tout Raptoru », plus d’une heure (> 3600 s) ou « Jusqu’au déblocage » ⇒ permission « Sanctions sensibles ». Un membre de l’équipe ne peut pas être sanctionné (refus Core).
- **Mots** : bloqué = refus avant la file (rien payé) ; surveillé = TTS payé, **retenu** « À vérifier » (jamais remis au lecteur) jusqu’à « Laisser passer », la file continue sans lui, expiration = remboursement auto. Casse et accents ignorés, mots entiers. Ajout / retrait = file réévaluée.
- **Notes internes**, **pause globale** (refuse TTS / sons / bonks / tombola, compte les refus, ne coupe rien), **cooldown D4** (délai imposé entre deux utilisations pendant une durée ou « Ce stream » = 3 h), **wallet admin** (créditer / débiter jetons, crédits TTS, crédits Sons, plancher 0, raison, acteur).
- **Soundboard / Bonk** : débit du wallet Lab à l’admission, remboursement au plus une fois (modération ; automatique si jamais joué / affiché). **Stop d’un son en cours** et **Stop tous les sons** : Core annule → worker Studio → lecteur coupe le son → ACK `stopped` → Core (`stopped_at`).
- **Tombola V2 minimale** (historique `5b66579`, **remplacée depuis par la Tombola V2 complète**, § 13) : Studio ouvre (cagnotte, durée, gagnants) / ferme / tire ; inscription gratuite depuis l’extension (une par viewer) ; gagnant payé sur le wallet Lab (mouvement `raffle_win`) ; l’écran viewer existant lit l’état Core ; section D4 réelle.
- **Historique** : interactions de tous les modules et Jetons de toute la chaîne, filtrés et paginés par Core ; drawer interaction (qui l’a retirée, mouvements liés) ; drawer mouvement (liens remboursement / débit d’origine, `visible_in_moderation_activity`).
- **Studio** : onglet « Modération » = la même console D4 (mode Window) + outils Studio : Tombola, Supermods, Configuration TTS, Wallet de test (dont « Effacer le cooldown TTS »). Extension Lab : surface « Moderator Window » (1100×720, pop-out).
- **Ajouts hors D4 conservés (extensions explicites)** : « Jusqu’au déblocage » (sensible), « Rembourser » après coup (Admin Wallet), onglet « Modération » (audit), « Annuler sans rembourser ». Puce « 1 h » retirée du dialogue Bloquer (absente de D4).

## 7. Validation matrix

| Élément                                                                       | Code | Tests auto | E2E                                | Validé Antoni                | Package local                     | Release   |
| ----------------------------------------------------------------------------- | ---- | ---------- | ---------------------------------- | ---------------------------- | --------------------------------- | --------- |
| Studio autonome + supervision                                                 | oui  | oui        | oui                                | **oui**                      | —                                 | **0.1.5** |
| Hub / Bonk V2 / Soundboard V2 / TTS V2                                        | oui  | oui        | oui                                | **oui**                      | —                                 | **0.1.5** |
| Modération V2 parité D4 complète (Core + console extension + Studio)          | oui  | oui        | **95/95**                          | **oui** (01/10)              | **oui** (`release/moderation-d4`) | non       |
| **Tombola V2 complète** (Core, Studio, Extension, overlay OBS, modération D4) | oui  | oui        | **Phase H 57/57** + suites dédiées | **oui** (02–03/10)           | non (pas encore packagée)         | non       |
| Passe UX post-Tombola (Studio Tombola, en-têtes Modération sans « … »)        | oui  | oui        | **UX 34/34**, D4 95/95             | **oui** (03/10)              | non                               | non       |
| Débit Lab Soundboard / Bonk, stop de son                                      | oui  | oui        | oui (dans les 95)                  | **oui** (01/10)              | oui                               | non       |
| Correctif cooldown TTS (`890e71d`), non-régression sur le modèle D4           | oui  | oui        | oui                                | **oui** (01/10, cooldown D4) | oui                               | non       |

Tests sur le HEAD `ed781f6` : **Core 257** (7 skipped) · **Studio server 92** · **Desktop 17** · **Extension 12** · **Bot 77** · lint / format / typecheck verts. E2E (scripts de session, hors repo) : D4 95/95 · UX 34/34 · console G 23/23 · Studio 46/46 · Extension 49/49 · Phase H A–L 57/57.

## 8. Known debts / limitations (réelles à ce jour)

- TTS : la lecture peut commencer avant la fin de l’animation shuffle / reveal de l’extension.
- Badges **VIP / Sub** : inconnus du Core (JWT d’extension sans ces rôles ; API Twitch avec le token broadcaster `raptoru_` non autorisée). Rôles affichés : Streamer / Supermod / Mod / Viewer.
- **Mouvements automatiques** (présence, watchtime…) : mécanisme D4 en place, mais ils appartiennent au Wallet réel, non branché au Lab (cutover non décidé).
- Tombola V2 : aucune dette produit ouverte (checkpoint figé, § 13). L’ingestion chat Twitch réelle du Lab reste un interrupteur OFF par défaut, jamais activé automatiquement ; le calibrage fin de l’anti-spoil se fait sur le vrai stream.
- Aucune synchro ban / timeout Twitch : toutes les sanctions sont internes à Raptoru.
- Pop-out Twitch réel non configuré (demande une publication de l’extension) ; la console gère la Moderator Window.

## 9. Decisions pending (à trancher par Antoni)

Aucune décision de modération ni de Tombola en attente. À décider par Antoni : construire un package local puis publier une release Studio embarquant Modération V2 + Tombola V2 (toutes deux validées en Lab), et choisir le prochain chantier.

## 10. What NOT to do

- Ne pas appeler « validé » une implémentation non testée par Antoni.
- Ne pas supprimer ni masquer un élément du prototype.
- Ne pas simuler un backend absent ; ne pas faire de l’ancienne simulation Tombola du Lab EBS une source de vérité (elle ne sert plus quand le Core Lab est connecté).
- Ne pas refaire Bonk V2, Soundboard V2, TTS V2, le Hub, Studio autonome, la Modération V2 D4 ni la **Tombola V2 (checkpoint figé, § 13)** : ils sont validés.
- Ne pas release, pousser, taguer, publier l’extension (ZIP / Hosted Test) ni toucher SAMMI / OBS / StreamElements / prod sans feu vert explicite.
- Ne pas tester `release/mini-d4` ni `release/win-unpacked` (obsolètes).
- Ne pas refactorer au passage.

## 11. Next exact step

1. **Tombola V2 close** (checkpoint figé, § 13) ; Modération V2 D4 validée ; passe UX post-Tombola validée.
2. **Aucun chantier en cours.** Le prochain est à choisir par Antoni : package local de test puis release Studio (`npm run studio:release`, uniquement sur feu vert explicite) ; audits de parité stricts des autres modules à prototype validé ; roadmap `Raptoru-2.0-ETAT-PROJET.md` § 16.

## 12. Key commits

| Commit                            | Contenu                                                                   |
| --------------------------------- | ------------------------------------------------------------------------- |
| `f81955d`                         | release Raptoru Studio 0.1.5 (dernière release publique)                  |
| `76c94c4` · `ef4025d`             | Studio autonome (runtime local) · supervision Electron                    |
| `eb798b9` · `bcfc7ee`             | TTS V2 Core / Studio / lecteur · UX D3 extension                          |
| `4df6af5` · `0a5c4e9` · `dbfb91b` | Soundboard V2 · Hub Pop Premium + wallet switch · noms des sons           |
| `5538111`                         | navigation Hub (dots + grille)                                            |
| `3665773` … `717d97b`             | Bonk V2                                                                   |
| `435f78d` · `706f8c7`             | Modération V2 Core + cockpit Studio (première version) — non releasé      |
| `12ffdd0` · `a5b5d5e`             | consoles extension précédentes (simplifiée, puis mini-passe) — remplacées |
| `890e71d`                         | correctif « Effacer le cooldown TTS » — non releasé                       |
| **`5b66579`**                     | **Modération V2 — parité D4 complète** — non releasé                      |
| `023cb64` · `3cc5fab`             | Tombola V2 : modèle Core (phase C) · planificateur + son de lancement     |
| `fef50df` · `0e90f13` · `72269b1` | Tombola V2 : Studio (D) · Extension (E) · overlay OBS (F)                 |
| **`ecc0275`**                     | **Tombola V2 : modération D4, noms figés, polish (G)** — checkpoint       |
| **`ed781f6`**                     | **Passe UX post-Tombola** (HEAD fonctionnel) — checkpoint                 |

## 13. Checkpoint Tombola V2 — TERMINÉE / VALIDÉE / CHECKPOINT FIGÉ

**Ne plus modifier Tombola V2 sauf bug réel découvert en usage ou nouvelle feature explicitement décidée par Antoni.
Les petites préférences UX futures ne rouvrent pas le chantier métier.**

- **Commits de référence** : `ecc0275` (fonctionnel / modération / noms figés / monnaies) · `ed781f6` (passe UX finale). Historique : `023cb64` → `3cc5fab` → `fef50df` → `0e90f13` → `72269b1` → `ecc0275` → `ed781f6`.
- **Migrations figées** (appliquées — **ne jamais les réécrire** ; toute évolution = nouvelle migration additive) :
  `20261008120000_raffle_v2.sql` · `20261009120000_raffle_scheduler.sql` · `20261010120000_raffle_round_labels.sql` ;
  dépendance Modération D4 : `20261007120000_moderation_d4.sql`.
- **Validé manuellement par Antoni (Lab, 02–03/10/2026)** : phases E / F / G / H terminées ; Extension Panel / Mobile / Vidéo ; overlay OBS ; planificateur (début / fin de stream, relance après une manche manuelle) ; paiements / wallet ; modération D4 Tombola (permissions existantes, ajout / retrait, forcer = « Sanctions sensibles », audit) ; noms figés par manche (+ nom actif sur la carte Hub) ; anti-spoil (compte jusqu’à 0, marge configurée) ; SUPER / FULL OSEILLE / Giveaway / aucun participant / annulation ; monnaies compactes (Je / Cr) ; passe UX Studio Tombola ; Modération V2 sans menu « … » (actions en icônes d’en-tête).
- **Tests de référence (verts sur `ed781f6`)** : Core 257 · Studio server 92 · Bot 77 · Extension 12 · Desktop 17 · lint / format / typecheck OK · E2E UX 34/34 · E2E D4 95/95 · E2E console G 23/23 · E2E Studio 46/46 · E2E Extension 49/49 · Phase H A–L 57/57 (scripts E2E de session, non versionnés).
- **Non fait volontairement** : aucun package local, aucune release, aucun push ; production inchangée (SAMMI + StreamElements).
