# Inventaire des versions, déploiements et archives

Relevé du **10/11/2026**, lecture seule.

- Core et bot : `node scripts/coolify-deploy.mjs status core|bot`.
- Studio : étiquettes Git `studio-v*`, dépôt public `raptorutwitch/raptoru-studio-releases`, `build-info.json` de
  l'installation.
- Extension : empreintes SHA-256 **recalculées** sur les fichiers.

Aucune archive n'a été créée, copiée ni versionnée. Les ZIP **ne vont jamais dans Git**.

Les 7 statuts à ne pas confondre : sur `main` → construit → publié → déployé → activé → vérifié en test → **testé en
live**. Seul « validé par Antoni » vaut validation ([PROJECT_STATUS.md](PROJECT_STATUS.md) § 2).

## 1. Core et bot (Coolify, VPS)

| Date (UTC)      | Core                   | Bot               | Contenu                                                                                                                         | Statut                                                                                                                                              |
| --------------- | ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **11/11 11:24** | **`052ab2e`** (PR #64) | —                 | passe post-live : Portefeuille, `!addpoints` / `!removepoints`, `!wallet` unifié, Musique dans la modération ; aucune migration | **déployé, sain** (déploiement `xtugwkjyb0f9mnrpy5bfz98e`, 125 s) ; retour : `deploy core bbce1048a0783cc1bdbb9a2ca86fb1769ce01872 --rollback --go` |
| 10/11 05:08     | `bbce104` (PR #61)     | —                 | Music Hub : progression du skip payant réglable                                                                                 | **déployé, sain** (`/health`, `/ready`) ; aucune migration                                                                                          |
| 10/11 02:31     | `900637f` (PR #59)     | —                 | audit de fiabilité, Music Hub (fermé par défaut), migration `20261122130000_music_hub.sql` (sauvegarde de la base à 02:30:59)   | remplacé                                                                                                                                            |
| **10/11 02:35** | —                      | **`900637f`**     | compatibilité (le bot ne lit pas les changements de `bbce104`)                                                                  | **déployé, sain**, bail actif                                                                                                                       |
| 07/11 18:58     | `1b25f30` (PR #56)     | `1b25f30` (19:02) | Opération Coulisses, 5 migrations                                                                                               | point de retour arrière                                                                                                                             |
| 04/11 01:45     | `8a897a5`              | —                 | raptoru.fr lots 1–5                                                                                                             | historique                                                                                                                                          |
| 31/10 13:02     | `8b2189e`              | —                 | Halloween (attente entre screamers)                                                                                             | historique                                                                                                                                          |
| 27/10           | —                      | `4ba9243`         | Random Ban V3                                                                                                                   | historique                                                                                                                                          |

- **Activé** : `MUSIC_HUB_EXTENSION=on` depuis le 10/11 au soir (auparavant `testers:…`).
- **Retour arrière** :
  - Core : `node scripts/coolify-deploy.mjs deploy core 900637f2b000cd9531970452cf11342876befe82 --rollback --go`. La
    migration reste : elle est additive.
  - Plus loin : `1b25f30`, voir [RELEASE_2026-11-10.md](RELEASE_2026-11-10.md) § 5.

## 2. Raptoru Studio

| Version         | Commit                | Publiée (UTC) | Statut                                                                                                                                                                                                                                                  |
| --------------- | --------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0.1.30**      | `052ab2e`             | 11/11 11:32   | **publiée** (workflow run 43011771406 : mise à jour 0.1.29 → 0.1.30 testée, 8 fichiers utilisateur identiques ; re-téléchargement anonyme identique) ; **pas encore installée** ; passe post-live (Musique dans la modération native, « Portefeuille ») |
| 0.1.29          | `bbce104`             | 10/11 05:18   | installée sur le PC (`build-info.json` : `0.1.29`, `bbce104`, construite à 05:14:50) ; clignotement du lecteur, confirmations Spotify, réglages du skip                                                                                                 |
| 0.1.28          | `900637f`             | 10/11 03:09   | installée puis remplacée ; publiée au 2ᵉ essai (nettoyage `alerts-se` sous Windows)                                                                                                                                                                     |
| 0.1.27          | `13ed6e8`             | 07/11 22:22   | Dock sans les tests de Studio                                                                                                                                                                                                                           |
| 0.1.26          | `1b25f30`             | 07/11 19:17   | Coulisses (installateur sauvegardé)                                                                                                                                                                                                                     |
| 0.1.25          | `8a897a5`             | 04/11         | installateur sauvegardé                                                                                                                                                                                                                                 |
| 0.1.18 → 0.1.24 | `7223b0a` → `8b2189e` | 29–31/10      | période Halloween                                                                                                                                                                                                                                       |

- Une publication ne prouve pas l'installation : Studio ne s'installe jamais seul (Antoni : « Rechercher une mise à
  jour »).
- Installateurs de retour arrière gardés : 0.1.25 et 0.1.26 ([BACKUPS.md](BACKUPS.md)). Pas de copie locale de 0.1.27
  et 0.1.28 ; ils sont dans les releases publiques.

## 3. Extension Twitch « Raptoru Live »

### 3.0 Nouvelle archive (passe post-live du 11/11) : **construite, à téléverser par Antoni**

| Champ       | Valeur                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nom         | `raptoru-live-PRODUCTION-45cb7224b16d-depuis-0bf7907-78-commits-shell-v2.zip` (+ `.sha256`)                                                                                                                               |
| Emplacement | `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\release-2026-11-11\apps\twitch-extension\release\`                                                                                                                     |
| SHA-256     | `b9e438abc11828bf5461636a16c51cf6f9e9bf97ac0376f010fd1bc9bd0d9865` (recalculé), 12 820 968 octets                                                                                                                         |
| Source      | `45cb7224` (branche `docs/delivery-2026-11-11`, PR #65) = code de l'extension de `main` `052ab2ec` + inventaire validé ; shell **v2** ; `buildId` `production-45cb7224b16d-2026-11-11` ; `https://core.raptoru.fr/v1/ext` |
| Inventaire  | `INVENTAIRE-bb8700814939.md`, 78 commits, « Validé par Antoni : oui » (« go tu peux faire le zip », 11/11), embarqué                                                                                                      |
| Contenu     | mêmes 2 149 fichiers et mêmes 9 modules que `bbce1048a078` ; passe post-live (Portefeuille, Musique dans la modération, Tombola, tutoriel)                                                                                |
| Prérequis   | Core `052ab2ec` (déployé)                                                                                                                                                                                                 |
| Statut      | **non téléversé** : Hosted Test à remplacer par Antoni dans la console Twitch ; **ne pas soumettre ni publier**                                                                                                           |
| Retour      | remettre les fichiers de `bbce1048a078` (§ 3.1)                                                                                                                                                                           |

### 3.1 Référence actuelle

**Dernière archive complète connue : `raptoru-live-PRODUCTION-bbce1048a078-depuis-0bf7907-72-commits-shell-v2.zip`**

| Champ                        | Valeur                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Emplacement                  | `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\music-finish\apps\twitch-extension\release\` (avec son fichier `.sha256`)                                                                                                               |
| SHA-256 (recalculé le 10/11) | `80bdab0045f326d2ab55295ee4d4a242f8eb0eef355ed35af418c15b899f9f5b`, identique au rapport de livraison                                                                                                                                      |
| Taille                       | 12 814 888 octets, construite le 10/11 vers 05:52                                                                                                                                                                                          |
| Source                       | `bbce104` sur `main` (commit de l'extension le plus récent dans l'archive : `86646df`) ; `buildId` `production-bbce1048a078-2026-11-10` ; shell **v2** ; serveur `https://core.raptoru.fr/v1/ext`                                          |
| Écart                        | 72 commits de l'extension depuis `PUBLISHED` = `0bf7907` (**présumé, non prouvé**)                                                                                                                                                         |
| Inventaire                   | `apps/twitch-extension/release-inventory/INVENTAIRE-86646df01d29.md` sur `main` (PR #62), ligne « Validé par Antoni : oui » ajoutée sur sa réponse du 10/11                                                                                |
| Contenu                      | Music Hub (13 commits), audit de fiabilité du 09/11 (double débit, session, TTS), socle Extension Next (shell v2, garde écran gris, chargement à la demande), Soundboard compact, etc. Détail dans l'inventaire                            |
| Statut Twitch                | **téléversée en Hosted Test par Antoni** (son retour du 10/11, non vérifiable par un agent), à la place des fichiers du ZIP `5ee8623`. **Non soumise, non publique.** La version publique est inchangée                                    |
| Prérequis                    | Core ≥ `bbce104` pour le texte de progression du skip. Studio ≥ 0.1.28 pour le skip ciblé : un Studio plus ancien reçoit `studio_outdated` avant tout débit. Music Hub n'est visible que pour les testeurs de `MUSIC_HUB_EXTENSION`        |
| Restriction Hosted Test      | visible seulement des comptes testeurs déclarés dans la console Twitch ; **ne jamais l'activer sur la chaîne en live** : les autres viewers n'auraient plus d'extension ([HALLOWEEN.md](HALLOWEEN.md) § 7)                                 |
| Validation                   | Studio 0.1.28 + Hosted Test `5ee8623`, testés par Antoni sur son vrai Spotify : pause, reprise, skip, volume, affichage ([music/MUSIC_HUB_STATE.md](music/MUSIC_HUB_STATE.md) § 15). **Aucune trace écrite d'un test de cette archive-ci** |

### 3.2 Archives précédentes (à ne pas confondre)

| Archive (nom)                                                                        | Emplacement                                                       | SHA-256 (recalculé)                                                | buildId / serveur                                 | Statut                                                                                       |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `raptoru-live-PRODUCTION-5ee8623ff82f-depuis-0bf7907-70-commits-shell-v2.zip`        | `…Worktrees\release-2026-11-10\apps\twitch-extension\release\`    | `045fff1beb8e93f87ad05bead6596f2476e2cc077b788e09ce8c7bd9a5bf14ce` | `production-5ee8623ff82f-2026-11-10`, Production  | **remplacée** en Hosted Test par `bbce104` (inventaire `INVENTAIRE-af7d00be51d5.md`, validé) |
| `raptoru-live-STAGING-hosted-test-715ac2cd9d96-shell-v2.zip`                         | idem                                                              | `b61be6a0b009f749ca05f753866f75ecfa07112b3390582e85fc4a34800ff73d` | `staging-715ac2cd9d96-2026-11-10`, `core-staging` | staging, jamais une référence Production                                                     |
| `…-900637f2b000-depuis-0bf7907-70-commits-shell-v2.zip`                              | —                                                                 | seul son `.sha256` existe ; le ZIP n'est plus sur le disque        | —                                                 | historique                                                                                   |
| `raptoru-extension-halloween-2026-10-31.zip`                                         | `Documents\Raptoru 2.0 - Livraisons\2026-10-31-extension-twitch\` | `d8e59f884e13c81653f89ed03f60c9b5d843cd2fe0ec0941c20e30b31aa89511` | `production-ab0560f39ba4-2026-10-31`              | préparée pour Halloween ; **soumission ou publication non tracée** (inconnu)                 |
| `raptoru-live-PRODUCTION-7223b0a6196f.zip`                                           | idem                                                              | `5b1f653a0a67c75c93aef57284657a50d4107e82c63eb4f6521d15a4902d0d89` | `production-7223b0a6196f-2026-10-29`              | historique                                                                                   |
| ZIP de `0bf7907` (22/10, présumé publié)                                             | **introuvable sur le disque** le 10/11                            | —                                                                  | —                                                 | version publique **présumée**, jamais prouvée                                                |
| `raptoru-live-PRODUCTION-f97e74a03955.zip` et ZIP STAGING / CALIBRATION des 06–20/10 | `Raptoru 2.0\apps\twitch-extension\release\` (checkout principal) | non recalculé                                                      | —                                                 | historique, avant la bascule                                                                 |
| Dossiers `Documents\Raptoru\…\dist\*.zip`, `ChatGPT\Extension Twitch\`               | ancien projet Raptoru (août–septembre 2026)                       | —                                                                  | ancien `raptoru.fr/api`                           | **ancien projet, hors Raptoru 2.0** : ne jamais téléverser                                   |

### 3.3 Prouver la version publique

Elle ne se lit pas hors live. Les deux moyens d'Antoni :

- console développeur Twitch › Raptoru Live › Versions ;
- pendant un live, F12 › `<client-id>.ext-twitch.tv` › `shared/runtime-config.js` › `buildId`.

Ensuite, corriger `apps/twitch-extension/PUBLISHED`.

Procédure de remplacement des fichiers Hosted Test : [extension/TWITCH_SUBMISSION_2026-11-10.md](extension/TWITCH_SUBMISSION_2026-11-10.md) § 7.

## 4. Site raptoru.fr

`74f7542` (lu sur `https://raptoru.fr/api/status` le 10/11), dépôt séparé `raptorutwitch/Leaderboard-Jeu-des-mots`.
Retour arrière : Coolify › redéployer `542b1f2`.
