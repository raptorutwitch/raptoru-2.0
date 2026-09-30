# Raptoru 2.0 — HANDOFF (à lire en premier)

**État au 01/10/2026 · HEAD fonctionnel `5b66579` (Modération V2 — parité D4 complète) · dernière release publique Studio 0.1.5.**
Ce fichier est la **source de contexte prioritaire** pour un nouvel agent. Le détail historique complet (Presence, Wallet, Loyalty, Daily, Twitch, Studio, inventaire du stream, roadmap longue) reste dans `Raptoru-2.0-ETAT-PROJET.md`. La matrice de parité D4 (initiale et finale) est dans `docs/moderation-v2-d4-parity.md`. En cas de contradiction, **vérifier Git et le code**, puis corriger le document fautif.

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
3. E2E (scripts de session, **pas dans le repo**) ;
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

- **Public / installé** : Raptoru Studio **0.1.5** (validé manuellement) = Studio autonome + supervision Electron + Hub + Bonk V2 + Soundboard V2 + TTS V2 réel. Il **ne contient pas** la Modération V2.
- **Local, non releasé, NON validé manuellement** : **Modération V2 complète, parité D4** (`5b66579`) — chaque élément du prototype D4 est réel dans le Core Lab (permissions fines, sanctions sensibles, mots surveillés / bloqués, notes, pause globale, cooldown D4, wallet admin, stop / remboursements Soundboard, débit Bonk, Tombola V2 minimale, historiques Core) ; **une seule console** partagée par l’extension et l’onglet Studio « Modération ».
- **Tous les tests automatiques sont verts** ; **E2E réel 95/95** ; **package local construit** mais **pas encore testé par Antoni**.
- **Prochaine action** : Antoni valide manuellement le package `release/moderation-d4` (§ 11).

## 2. Workspace / commandes / chemins

| Quoi                                   | Où                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Workspace canonique                    | `C:\Users\Antoni\Documents\Raptoru 2.0` (branche `main`, aucun remote, aucun tag)                                            |
| Règles agent                           | `CLAUDE.md` (releases Studio) · ce fichier · `Raptoru-2.0-ETAT-PROJET.md` · `docs/moderation-v2-d4-parity.md` · `README.md`  |
| Studio source (dev)                    | `npm run studio` (Electron + serveur Studio 4100 + Core Lab 4301, base `raptoru_bonk_lab`)                                   |
| **Package local à tester**             | `apps/studio/desktop/release/moderation-d4/win-unpacked/Raptoru Studio.exe`                                                  |
| Packages obsolètes — **ne pas tester** | `release/mini-d4/` (état `a5b5d5e`), `release/win-unpacked/` (état `12ffdd0`), `release/win-unpacked.tmp` (build interrompu) |
| Studio installé                        | `%LOCALAPPDATA%\Programs\Raptoru Studio` (0.1.5) ; logs `%APPDATA%\Raptoru Studio\logs\studio-server.log`                    |
| Checks                                 | `npm run lint` · `npm run format:check` · `npm run typecheck` · `npm test`                                                   |
| Release (après validation seulement)   | `npm run studio:release` (dry-run : `-- --dry-run`)                                                                          |

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

- `5b66579 — feat: complete Moderation V2 with full D4 parity (Lab)` (dernier commit fonctionnel), suivi uniquement de commits de documentation.
- Toujours revérifier : `git status` · `git log --oneline -12`.
- Commits non releasés depuis 0.1.5 : `435f78d`, `706f8c7`, `12ffdd0`, `890e71d`, `a5b5d5e`, **`5b66579`** (+ docs `0da412d`, `5d48cee`, `3add3dd`, `e535b26`).

## 5. Architecture canonique

`Extension (viewer) → EBS (prod) / façade LabEbs (Lab, dans le serveur Studio) → Core → workers Studio → lecteurs / OBS → ACK → Core`.

- Lab : tout est `test_mode=true`, `payment_mode=simulated`, `real_debited=0` ; wallet de test Lab en base Lab, jamais l’économie réelle.
- Routes Lab exposées **uniquement** par le Core Lab : `/v1/lab/moderation/*` (actions, whoami, overview, search, viewers, interactions, ledger, team, words, audit), `/v1/lab/raffle/*`, `/v1/lab/wallet/*`, `/v1/lab/tts/rules`.
- Les read models ne sont jamais servis à un viewer : la façade nomme le lecteur (`as`, `as_role`) et **Core refuse** un viewer.
- Chaîne Studio : Electron main → serveur Studio → Local Runtime Manager → Postgres Docker → Core Lab / workers / lecteurs.
- **Une seule console Modération** : `apps/twitch-extension/extension/shared/moderation-v2.js` (+ `moderation-v2.css`), montée par l’extension (façade LabEbs, acteur = identité Twitch de l’appelant) et par Studio (`/ext/…` servi par Studio, acteur = broadcaster via `/api/lab`).

## 6. Modules

| Module            | Référence UX (vérité)                                                              | État réel                                                                                                    | Validation Antoni                                                              |
| ----------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Hub**           | `prototypes/hub-nav-dots-footer/` (variante C « Tous dominant ») + Hub Pop Premium | Implémenté (`0a5c4e9`, `5538111`), dans 0.1.5                                                                | **Validé** (28–29/09)                                                          |
| **Bonk V2**       | Implémentation validée + audit Bonk V2 (pas de prototype dans `prototypes/`)       | Réel en Lab, dans 0.1.5 ; **depuis `5b66579` débité sur le wallet Lab** (200 J, remboursé si jamais affiché) | **Validé** (27/09, avant le débit) ; reste Bonk Fidelity (polish)              |
| **Soundboard V2** | Implémentation validée (pas de prototype)                                          | Réel en Lab, dans 0.1.5 ; **depuis `5b66579` débité sur le wallet Lab**, stop réel d’un son, remboursements  | **Validé** (28/09, avant débit / stop)                                         |
| **TTS V2**        | `prototypes/tts-v2-extension-ux/` (D3) + `prototypes/tts-v2-player/`               | Réel en Lab, dans 0.1.5 ; **depuis `5b66579` : mots surveillés / bloqués, cooldown D4, pause globale**       | **Validé** (30/09) — dette : lecture possible avant la fin du shuffle / reveal |
| **Modération V2** | **`prototypes/moderation-v2-d4/`** (spécification)                                 | **Parité D4 complète** (`5b66579`) — non releasé                                                             | **Non validé**                                                                 |
| **Tombola**       | Pas de prototype viewer V2 ; section Tombola de la D4                              | **Tombola V2 minimale dans Core** (modèle réel : inscription gratuite) ; écran viewer inchangé, branché Core | **Non validé**                                                                 |

### Modération V2 — détail exact (`5b66579`)

Décisions d’Antoni (30/09) appliquées : Tombola = modèle réel (inscription gratuite) ; mot surveillé = TTS **retenu** jusqu’à « Laisser passer » ; un mod ne donne que les permissions qu’il possède ; « Rembourser » après coup = Admin Wallet.

- **Permissions (Core)** : rôles Broadcaster / Supermod / Moderator / Viewer + **6 permissions D4 par mod** (Admin Wallet, Désactiver un module, Pause globale, Gérer les permissions, Sanctions sensibles, Mots surveillés / bloqués), stockées dans `lab_staff.grants`, appliquées par Core (403 avec la permission nommée). Anti-escalade : jamais ses propres droits, jamais un supermod ou le broadcaster, uniquement les permissions qu’on possède. Un mod rejoint l’équipe à sa première ouverture de la console (rôle Twitch) ; supermod nommé depuis Studio.
- **Sanctions sensibles** (D4) : « Tout Raptoru », plus d’une heure (> 3600 s) ou « Jusqu’au déblocage » ⇒ permission « Sanctions sensibles ». Un membre de l’équipe ne peut pas être sanctionné (refus Core).
- **Mots** : bloqué = refus avant la file (rien payé) ; surveillé = TTS payé, **retenu** « À vérifier » (jamais remis au lecteur) jusqu’à « Laisser passer », la file continue sans lui, expiration = remboursement auto. Casse et accents ignorés, mots entiers. Ajout / retrait = file réévaluée.
- **Notes internes**, **pause globale** (refuse TTS / sons / bonks / tombola, compte les refus, ne coupe rien), **cooldown D4** (délai imposé entre deux utilisations pendant une durée ou « Ce stream » = 3 h), **wallet admin** (créditer / débiter jetons, crédits TTS, crédits Sons, plancher 0, raison, acteur).
- **Soundboard / Bonk** : débit du wallet Lab à l’admission, remboursement au plus une fois (modération ; automatique si jamais joué / affiché). **Stop d’un son en cours** et **Stop tous les sons** : Core annule → worker Studio → lecteur coupe le son → ACK `stopped` → Core (`stopped_at`).
- **Tombola V2 minimale** : Studio ouvre (cagnotte, durée, gagnants) / ferme / tire ; inscription gratuite depuis l’extension (une par viewer) ; gagnant payé sur le wallet Lab (mouvement `raffle_win`) ; l’écran viewer existant lit l’état Core ; section D4 réelle.
- **Historique** : interactions de tous les modules et Jetons de toute la chaîne, filtrés et paginés par Core ; drawer interaction (qui l’a retirée, mouvements liés) ; drawer mouvement (liens remboursement / débit d’origine, `visible_in_moderation_activity`).
- **Studio** : onglet « Modération » = la même console D4 (mode Window) + outils Studio : Tombola, Supermods, Configuration TTS, Wallet de test (dont « Effacer le cooldown TTS »). Extension Lab : surface « Moderator Window » (1100×720, pop-out).
- **Ajouts hors D4 conservés (extensions explicites)** : « Jusqu’au déblocage » (sensible), « Rembourser » après coup (Admin Wallet), onglet « Modération » (audit), « Annuler sans rembourser ». Puce « 1 h » retirée du dialogue Bloquer (absente de D4).

## 7. Validation matrix

| Élément                                                              | Code | Tests auto | E2E               | Validé Antoni | Package local                     | Release   |
| -------------------------------------------------------------------- | ---- | ---------- | ----------------- | ------------- | --------------------------------- | --------- |
| Studio autonome + supervision                                        | oui  | oui        | oui               | **oui**       | —                                 | **0.1.5** |
| Hub / Bonk V2 / Soundboard V2 / TTS V2                               | oui  | oui        | oui               | **oui**       | —                                 | **0.1.5** |
| Modération V2 parité D4 complète (Core + console extension + Studio) | oui  | oui        | **95/95**         | **non**       | **oui** (`release/moderation-d4`) | non       |
| Tombola V2 minimale (Core, Studio, extension)                        | oui  | oui        | oui (dans les 95) | **non**       | oui                               | non       |
| Débit Lab Soundboard / Bonk, stop de son                             | oui  | oui        | oui (dans les 95) | **non**       | oui                               | non       |
| Correctif cooldown TTS (`890e71d`), non-régression sur le modèle D4  | oui  | oui        | oui               | **non**       | oui                               | non       |

Tests sur le HEAD : **Core 208** (7 skipped) · **Studio server 64** · **desktop 17** · **extension 10** · **bot 69** · lint / format / typecheck verts.

## 8. Known debts / limitations (réelles à ce jour)

- TTS : la lecture peut commencer avant la fin de l’animation shuffle / reveal de l’extension.
- Badges **VIP / Sub** : inconnus du Core (JWT d’extension sans ces rôles ; API Twitch avec le token broadcaster `raptoru_` non autorisée). Rôles affichés : Streamer / Supermod / Mod / Viewer.
- **Mouvements automatiques** (présence, watchtime…) : mécanisme D4 en place, mais ils appartiennent au Wallet réel, non branché au Lab (cutover non décidé).
- Tombola : écran viewer inchangé (inscription gratuite) ; lancement automatique / Big Tombola du legacy non migrés (hors périmètre D4).
- Aucune synchro ban / timeout Twitch : toutes les sanctions sont internes à Raptoru.
- Pop-out Twitch réel non configuré (demande une publication de l’extension) ; la console gère la Moderator Window.

## 9. Decisions pending (à trancher par Antoni)

Aucune décision de modération en attente (tranchées le 30/09, voir § 6). Après la validation manuelle : release Studio (nouvelle version) via `npm run studio:release`.

## 10. What NOT to do

- Ne pas appeler « validé » une implémentation non testée par Antoni.
- Ne pas supprimer ni masquer un élément du prototype.
- Ne pas simuler un backend absent ; ne pas faire de l’ancienne simulation Tombola du Lab EBS une source de vérité (elle ne sert plus quand le Core Lab est connecté).
- Ne pas refaire Bonk V2, Soundboard V2, TTS V2, le Hub ni Studio autonome : ils sont validés.
- Ne pas release, pousser, taguer, publier l’extension (ZIP / Hosted Test) ni toucher SAMMI / OBS / StreamElements / prod sans feu vert explicite.
- Ne pas tester `release/mini-d4` ni `release/win-unpacked` (obsolètes).
- Ne pas refactorer au passage.

## 11. Next exact step

1. **Antoni teste manuellement le package** : fermer tout Studio ouvert (installé, source, anciens packages), lancer `apps/studio/desktop/release/moderation-d4/win-unpacked/Raptoru Studio.exe`, puis :
   - Studio → Modération : console D4, outils Tombola / Supermods / Configuration TTS / Wallet de test ;
   - Extension Lab → rôle Modérateur **et** Broadcaster → Modération, sur Panel / Vidéo / Mobile / **Moderator Window** ;
   - en particulier : Équipe & permissions (accorder / retirer, verrous), mots surveillés (TTS retenu, Laisser passer) et bloqués, pause globale, Stop d’un son / Stop tous les sons (le son se coupe dans le lecteur), remboursements, cooldown D4, notes, wallet admin, Tombola (ouvrir dans Studio, s’inscrire comme viewer, tirer), historiques et filtres, « Effacer le cooldown TTS ».
2. Corriger **uniquement** les écarts qu’il constate.
3. Seulement après validation explicite : `npm run studio:release`.
4. Ensuite : audits de parité stricts des autres modules disposant d’un prototype validé ; Tombola V2 complète (écran viewer, lancement automatique) quand un prototype existera.

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
| **`5b66579`**                     | **Modération V2 — parité D4 complète** (HEAD fonctionnel) — non releasé   |
