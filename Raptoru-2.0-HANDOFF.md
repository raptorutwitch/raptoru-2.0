# Raptoru 2.0 — HANDOFF (à lire en premier)

**État au 30/09/2026 · HEAD fonctionnel `a5b5d5e` · dernière release publique Studio 0.1.5.**
Ce fichier est la **source de contexte prioritaire** pour un nouvel agent. Le détail historique complet (Presence, Wallet, Loyalty, Daily, Twitch, Studio, inventaire du stream, roadmap longue) reste dans `Raptoru-2.0-ETAT-PROJET.md`. En cas de contradiction, **vérifier Git et le code**, puis corriger le document fautif.

---

## 0. RÈGLES DE REPRISE (non négociables)

### Prototype = spécification

- Pour toute UX déjà validée, **le prototype est une spécification, pas une inspiration**.
- Toute migration commence par une **matrice de couverture** :
  `élément prototype | backend existe | porté | adaptation | bloqué`.
- **Aucun élément ne doit être supprimé, simplifié ou remplacé silencieusement.**
- Une limitation backend se remonte **comme limitation backend** (élément visible, désactivé, marqué « backend manquant »), jamais comme décision UX implicite.
- Précédent à ne pas répéter : la première console Modération de l’extension (`12ffdd0`) a été annoncée « D4 » alors qu’un audit strict a montré une migration **fortement simplifiée** (~50 % du prototype).

### Validation — toujours distinguer

1. code présent ;
2. tests unitaires / intégration ;
3. E2E (scripts de session, **pas dans le repo**) ;
4. **validation manuelle par Antoni** ;
5. package local ;
6. release publique.

**Ne jamais écrire « validé » pour quelque chose qu’Antoni n’a pas testé lui-même.**

### Architecture

- **Core = source de vérité** (métier, économie, états, audit).
- Twitch Bot = adaptateur fin Twitch → Core.
- Studio = cockpit / runtime local du streamer (pas de logique métier).
- Extension = interface viewer-first ; **aucune logique métier dupliquée**, aucun état local présenté comme vérité.
- **Aucune simulation présentée comme backend réel.**

### Git / release / prod

- Pas de push (le repo source n’a pas de remote), pas de tag.
- **Pas de `npm run studio:release` sans validation explicite d’Antoni** (« c’est bon », « validé », « go ») — voir `CLAUDE.md`.
- Ne jamais committer `.env`, tokens, secrets, fichiers runtime.
- `prototypes/` : local, non versionné (exclu via `.git/info/exclude`) — ne jamais le supprimer, l’ajouter à un commit ou le modifier.
- **SAMMI + StreamElements restent la production.** Aucun cutover, aucune migration prod, aucune publication d’extension Twitch sans feu vert global.
- Workspace legacy `C:\Users\Antoni\Documents\Raptoru\CANONICAL_WORKSPACE` et dossier `…\Alertes Twitch Pour Claude\TTS Webm` : lecture seule.

---

## 1. TL;DR état actuel

- **Public / installé** : Raptoru Studio **0.1.5** (validé manuellement) = Studio autonome + supervision Electron + Hub + Bonk V2 + Soundboard V2 + TTS V2 réel. Il **ne contient pas** la Modération V2.
- **Local, non releasé, NON validé manuellement** (après 0.1.5) :
  - Modération V2 dans le Core Lab + cockpit Studio « Modération » + configuration TTS + wallet de test Lab ;
  - console Modération de l’extension Lab, **puis mini-passe de parité D4** (dernier état) ;
  - correctif « Effacer le cooldown TTS ».
- **Tous les tests automatiques sont verts** sur le HEAD ; E2E mini-D4 36/36 ; **package local construit** mais **pas encore testé par Antoni**.
- **Prochaine action** : Antoni valide manuellement le package mini-D4 (§ 11).

## 2. Workspace / commandes / chemins

| Quoi                                 | Où                                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace canonique                  | `C:\Users\Antoni\Documents\Raptoru 2.0` (branche `main`, aucun remote, aucun tag)                                                                               |
| Règles agent                         | `CLAUDE.md` (releases Studio) · ce fichier · `Raptoru-2.0-ETAT-PROJET.md` · `README.md`                                                                         |
| Studio source (dev)                  | `npm run studio` (Electron + serveur Studio 4100 + Core Lab 4301, base `raptoru_bonk_lab`)                                                                      |
| **Package local à tester**           | `apps/studio/desktop/release/mini-d4/win-unpacked/Raptoru Studio.exe`                                                                                           |
| Package obsolète — **ne pas tester** | `apps/studio/desktop/release/win-unpacked/` (état `12ffdd0`, avant correctif cooldown et mini-passe) ; `release/win-unpacked.tmp` = reste d’un build interrompu |
| Studio installé                      | `%LOCALAPPDATA%\Programs\Raptoru Studio` (0.1.5) ; logs `%APPDATA%\Raptoru Studio\logs\studio-server.log`                                                       |
| Checks                               | `npm run lint` · `npm run format:check` · `npm run typecheck` · `npm test`                                                                                      |
| Release (après validation seulement) | `npm run studio:release` (dry-run : `-- --dry-run`)                                                                                                             |

Pièges connus :

- Studio installé, Studio source et package local **partagent le même verrou d’instance** : fermer l’un avant de lancer l’autre.
- Le Studio installé sert une **copie figée** de l’extension : il ne montre jamais les changements locaux.
- Vitest sous Windows peut crasher un fichier sous charge turbo (0xC0000409) : relancer ; supprimer les dossiers `apps/studio/server/.runtime-*-test-*` restants.
- Tests E2E : environnement isolé (Studio 4111 / Core 4311, base `raptoru_bonk_lab_ttse2e`) piloté par des scripts de session **non versionnés**.

## 3. Release publique actuelle

- **Raptoru Studio 0.1.5**, tag `v0.1.5`, publiée le 30/09/2026 sur le repo public `raptorutwitch/raptoru-studio-releases` (commit source `f81955d`).
- Validée manuellement par Antoni avant publication.
- L’extension Twitch n’a **jamais** été republiée : la production Twitch reste l’ancienne extension.

## 4. HEAD local actuel

- `a5b5d5e — feat(extension): bring the moderation console closer to D4` (dernier commit fonctionnel), suivi uniquement de commits de documentation.
- Toujours revérifier : `git status` · `git log --oneline -12`.
- Commits non releasés depuis 0.1.5 : `435f78d`, `706f8c7`, `12ffdd0`, `890e71d`, `a5b5d5e` (+ docs `0da412d`, `5d48cee`).

## 5. Architecture canonique

`Extension (viewer) → EBS (prod) / façade LabEbs (Lab, dans le serveur Studio) → Core → workers Studio → lecteurs / OBS → ACK → Core`.

- Lab : tout est `test_mode=true`, `payment_mode=simulated`, `real_debited=0` ; wallet de test Lab en base Lab, jamais l’économie réelle.
- Routes Lab (`/v1/lab/moderation`, `/v1/lab/wallet`, `/v1/lab/tts/rules`) exposées **uniquement** par le Core Lab.
- Chaîne Studio : Electron main → serveur Studio → Local Runtime Manager → Postgres Docker → Core Lab / workers / lecteurs.

## 6. Modules

| Module            | Référence UX (vérité)                                                              | État réel                                                                                                                                                        | Validation Antoni                                                              |
| ----------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Hub**           | `prototypes/hub-nav-dots-footer/` (variante C « Tous dominant ») + Hub Pop Premium | Implémenté (`0a5c4e9`, `5538111`), dans 0.1.5                                                                                                                    | **Validé** (28–29/09)                                                          |
| **Bonk V2**       | Implémentation validée + audit Bonk V2 (pas de prototype dans `prototypes/`)       | Réel en Lab (Core → Studio → OBS), dans 0.1.5                                                                                                                    | **Validé** (27/09) ; reste Bonk Fidelity (polish)                              |
| **Soundboard V2** | Implémentation validée (pas de prototype)                                          | Réel en Lab (Core → Studio → lecteur audio), dans 0.1.5 ; modes `stack` / `queue` / `ignore_if_running` (pas de `replace`), 2 sons différents simultanés (max 8) | **Validé** (28/09)                                                             |
| **TTS V2**        | `prototypes/tts-v2-extension-ux/` (D3) + `prototypes/tts-v2-player/`               | Réel en Lab (Core → Studio → lecteur OBS), dans 0.1.5                                                                                                            | **Validé** (30/09) — dette : lecture possible avant la fin du shuffle / reveal |
| **Modération V2** | **`prototypes/moderation-v2-d4/`** (spécification)                                 | Core Lab + cockpit Studio + console extension après mini-passe D4 — **non releasé**                                                                              | **Non validé**                                                                 |
| **Tombola**       | Pas encore de prototype V2                                                         | **Ancien système / simulation locale du Lab EBS**, pas migrée vers le Core                                                                                       | — (Tombola V2 = prochain gros chantier)                                        |

### Modération V2 — détail exact

**Core Lab (`435f78d`, correctif `890e71d`)** : permissions (Mod / Supermod / Broadcaster, supermod nommé via `lab_staff`), états module, file TTS réelle (stop, stop + remboursement, purge ± remboursement, retrait), blocages global / par module, cooldowns (remplacer / ajouter / effacer), remboursements idempotents, audit unifié, configuration TTS, wallet de test Lab.

- Règles actuelles du Core : remboursement et désactivation = Supermod ; configuration TTS, staff, wallet de test = Broadcaster ; wallet éditable **depuis Studio uniquement**.
- Correctif `890e71d` : un « Effacer le cooldown TTS » fait pendant que le TTS attend n’est plus réarmé au démarrage de la lecture (migration Lab `20261006120000_tts_lab_cooldown_clear.sql`). La règle « un TTS à la fois par viewer » (`viewer_busy`) est conservée ; message extension : « Ton TTS précédent n’est pas encore terminé ».

**Cockpit Studio « Modération » (`706f8c7`)** : inspiré de D4 (colonne modules / file / fiche viewer, dialogues), onglets Configuration TTS et Wallet de test. **Pas audité en parité stricte avec le prototype** (mise en page et composants propres à Studio).

**Console extension Lab** :

- `12ffdd0` : première console « D4 » → **audit strict : migration fortement simplifiée (~50 %)**.
- **`a5b5d5e` : mini-passe de parité** (sans changement Core, sans gros chantier backend, sans faux fonctionnement). Remis en parité :
  - console plein écran, plus de double header (seul ajout au D4 : bouton retour Hub à côté de la recherche) ;
  - fond / ambiance du prototype ; pied de colonne D4 « En direct » + bouclier Équipe & permissions ;
  - fiche viewer Bloquer / Cooldown / **Plus** (Historique complet, Activité Jetons, Notes, Wallet admin, Détails), crédits TTS + Soundboard, Bloquer / Cooldown désactivés pour un supermod, « Voir tout » ;
  - vue Activité Jetons par viewer + drawer mouvement (montant, débité / crédité / remboursé, source, heure, viewer, acteur, interaction liée, liens remboursement / débit, détails techniques) ;
  - historique Interactions / Jetons / Modération + filtres module / statut / période / viewer (sur les données chargées) ;
  - menu Bonk, menus modules D4 (« Purger toute la file »), progression / temps restant des sons.
  - **Visibles mais marqués « backend manquant » / « à venir »** : Tombola (« Non branché — Tombola V2 à migrer »), Notes, Pause globale, Surveillance des mots, permissions fines par mod, Stop d’un son / Stop tous les sons, remboursement Soundboard.
- Hors Lab (EBS de production sans Core Lab), l’extension garde l’ancien écran de modération.

## 7. Validation matrix

| Élément                                                       | Code | Tests auto          | E2E                          | Validé Antoni | Package local               | Release   |
| ------------------------------------------------------------- | ---- | ------------------- | ---------------------------- | ------------- | --------------------------- | --------- |
| Studio autonome + supervision                                 | oui  | oui                 | oui                          | **oui**       | —                           | **0.1.5** |
| Hub / Bonk V2 / Soundboard V2 / TTS V2                        | oui  | oui                 | oui                          | **oui**       | —                           | **0.1.5** |
| Modération V2 Core + cockpit Studio + config TTS + wallet Lab | oui  | oui                 | oui (23/23 + synchro 3/3)    | **non**       | oui (mini-d4)               | non       |
| Correctif cooldown TTS (`890e71d`)                            | oui  | oui (+4 tests Core) | oui (réel)                   | **non**       | oui (mini-d4)               | non       |
| Console extension mini-D4 (`a5b5d5e`)                         | oui  | oui                 | **36/36** (source + package) | **non**       | **oui** (`release/mini-d4`) | non       |
| Tombola V2                                                    | non  | —                   | —                            | —             | —                           | —         |

Tests sur le HEAD : **Core 183** (7 skipped) · **Studio server 60** · **desktop 17** · **extension 10** · **bot 69** · lint / format / typecheck verts.

## 8. Known debts / limitations (réelles à ce jour)

- TTS : la lecture peut commencer avant la fin de l’animation shuffle / reveal de l’extension.
- Tombola V2 non migrée dans le Core (le schéma Lab accepte `raffle`, mais il n’y a ni service ni commandes).
- Pause globale réelle absente.
- Notes internes absentes.
- Surveillance / blocage de mots absents (seulement le hook `TtsMessageFilter`).
- Permissions fines par mod absentes (règles fixes du Core).
- Stop d’un son Soundboard déjà remis au lecteur absent ; remboursement Soundboard absent (sons non débités dans le Lab).
- Historique Jetons de toute la chaîne absent (ledger par viewer uniquement, 15 derniers) ; historique des interactions limité aux 20 dernières par module.
- Premier passage du viewer absent ; badges rôle / restriction dans la recherche absents ; rôles Twitch (Mod / VIP / Sub) inconnus du Core.
- **Wallet admin de l’extension en lecture seule** (le Core refuse l’édition hors Studio).
- Modèle cooldown D4 (« délai entre deux utilisations pendant X ») non adopté : le Core applique un blocage temporaire.
- Aucune synchro ban / timeout Twitch : toutes les sanctions sont internes à Raptoru.
- Pop-out de l’extension (Moderator Window) non configuré.
- Cockpit Studio Modération non audité en parité D4.

## 9. Decisions pending (à trancher par Antoni)

1. Remboursement : **tout mod** (prototype D4) ou **Supermod** (Core actuel).
2. Cooldown : **modèle D4** (délai × durée, nouveau modèle de données) ou **modèle actuel** (blocage temporaire).
3. Ajouts absents de D4, à garder ou retirer : blocage « jusqu’au déblocage », bouton « Rembourser » manuel, onglet « Modération » (audit) dans l’historique, option « annuler sans rembourser ».
4. Ensuite seulement : nouvelle release Studio.

## 10. What NOT to do

- Ne pas appeler « D4 » (ni « validé ») une implémentation non auditée contre le prototype ou non testée par Antoni.
- Ne pas supprimer ni masquer un élément du prototype faute de backend : le montrer désactivé et marqué.
- Ne pas simuler un backend absent (pas de fausse Tombola, fausse pause globale, faux wallet éditable, fausses permissions).
- Ne pas brancher la Tombola sur la simulation du Lab EBS comme si c’était le Core.
- Ne pas refaire Bonk V2, Soundboard V2, TTS V2, le Hub ni Studio autonome : ils sont validés.
- Ne pas release, pousser, taguer, publier l’extension ni toucher SAMMI / OBS / StreamElements / prod sans feu vert explicite.
- Ne pas tester `release/win-unpacked` (obsolète).
- Ne pas refactorer au passage.

## 11. Next exact step

1. **Antoni teste manuellement le package mini-D4** : fermer tout Studio ouvert (installé, source, ancien package), lancer `apps/studio/desktop/release/mini-d4/win-unpacked/Raptoru Studio.exe`, puis Extension Lab → rôle Modérateur **et** Broadcaster → Modération, sur Panel / Vidéo / Mobile. Vérifier aussi le correctif cooldown TTS et le cockpit Studio « Modération ».
2. Corriger **uniquement** les écarts qu’il constate.
3. Faire trancher les décisions du § 9.
4. Seulement après validation explicite : `npm run studio:release`.
5. Puis **Tombola V2** (Core + extension) après stabilisation de la Modération.
6. Ensuite : audits de parité stricts des autres modules disposant d’un prototype validé (cockpit Studio Modération compris).

## 12. Key commits

| Commit                            | Contenu                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `f81955d`                         | release Raptoru Studio 0.1.5 (dernière release publique)                          |
| `76c94c4` · `ef4025d`             | Studio autonome (runtime local) · supervision Electron                            |
| `eb798b9` · `bcfc7ee`             | TTS V2 Core / Studio / lecteur · UX D3 extension                                  |
| `4df6af5` · `0a5c4e9` · `dbfb91b` | Soundboard V2 · Hub Pop Premium + wallet switch · noms des sons                   |
| `5538111`                         | navigation Hub (dots + grille)                                                    |
| `3665773` … `717d97b`             | Bonk V2                                                                           |
| `435f78d`                         | Modération V2 + configuration TTS + wallet de test (Core) — non releasé           |
| `706f8c7`                         | cockpit Studio Modération + extension routée vers le Core — non releasé           |
| `12ffdd0`                         | première console extension (audit : fortement simplifiée) — non releasé           |
| `890e71d`                         | correctif « Effacer le cooldown TTS » — non releasé                               |
| `a5b5d5e`                         | **mini-passe parité D4** de la console extension — non releasé (HEAD fonctionnel) |
