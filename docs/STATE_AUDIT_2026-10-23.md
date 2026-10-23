# Audit de synchronisation Raptoru 2.0 — 20 → 23 octobre 2026

**Réalisé le 23/10/2026 vers 01:00–02:00 UTC, en lecture seule. Révisé le 23/10 :** SAMMI a été **débranché
volontairement** lors de la bascule vers Raptoru 2.0 (confirmation d'Antoni) — son inactivité n'est ni une panne ni un
risque ; les fonctions qu'il portait et que Raptoru n'a pas encore reprises sont **à reprendre dans Raptoru 2.0**.
Aucun code, commit, push, déploiement, migration,
configuration, OBS ou Twitch modifié. Fichier non commité, écrit dans le worktree isolé `vk-wt` ; les anciens documents ne
sont **pas** corrigés (en attente de ton accord).

Légende des preuves : **[D]** directe, observée pendant cet audit (commande, endpoint, fichier) · **[H]** confirmation
historique datée (rapport, audit, sortie collée par Antoni) · **[NV]** NON VÉRIFIÉ. Niveaux d'avancement jamais
confondus : codé · tests unitaires · tests PostgreSQL réel · tests simulés Twitch/OBS · commit local · poussé ·
déployé · installé · validé par Antoni.

Sources lues : `git log origin/main` ; worktrees ; Coolify (`raptoru-release/scripts/coolify-deploy.mjs status`,
lecture seule) ; `https://core.raptoru.fr/health|ready` ; Studio local en profil Production (GET `/api/profile`,
`/api/control/status`, `/api/channel-points/state`, `/api/random-ban/state`, `/api/sub-wheel/state`,
`/api/word-game/state`, `/api/commands/steps`, `/api/tts-lab/status`, `/api/sound-lab/status`, `/api/lab/ledger`,
champs non sensibles et comptes seulement) ; GitHub releases Studio (`gh release list`) ; fichiers OBS et SAMMI
(dates, configuration, lecture seule) ; documents `docs/*`, `CLAUDE.md`, `RAPTORU_2_0_CHATGPT_HANDOFF_2026-10-23.md`.

---

## 1. Résumé exécutif

- **Économie : migration réelle faite le 20/10** (import Jetons + crédits, Core en `canonical`) et **toujours active le
  23/10** [D : lignes `reward` / `word_game` du ledger canonique, la dernière à 00:02 UTC le 23/10]. Mon checkpoint
  (`docs/CLAUDE_HANDOFF_CURRENT.md`) disait le contraire : **faux**.
- **Production** : Core **et** bot sur `2d80c2a`, `running:healthy` [D]. Studio installé **0.1.7** (GitHub : 0.1.6) [D].
- **SAMMI est débranché depuis la bascule du 20/10 — décision de migration** [H : confirmation d'Antoni, 23/10 ;
  cohérent avec D : dernière écriture de ses fichiers le 20/10 19:56 locale, aucun processus]. Système historique
  désactivé, **jamais un secours à redémarrer**. Les fonctions qu'il portait et que Raptoru n'a pas encore reprises
  (Votekick, Caution, banque, 24H, cash-in, blacklist) sont **à reprendre dans Raptoru 2.0** ; elles ne sont pas
  censées fonctionner aujourd'hui.
- **Bonk « En attente de l'overlay » avec DSK : cause probable trouvée** [D code + config OBS] : Studio exige que la
  source nommée exactement « Raptoru Bonk Lab » soit active ; le DSK affiche « Alerte complète », dont l'overlay Bonk
  est la source **« Bonk v2 »** (même URL, autre nom). Non testé dans OBS.
- **Incident Twitch du 22/10** : le processus du bot **n'a pas redémarré** (actif depuis 22/10 16:24 UTC) [D] ; rétabli
  par une revérification des autorisations dans Studio [H : relais ChatGPT]. Cause **non établie** [NV].
- **Caution V2 : aucun blocage technique** pour la validation Lab ; l'économie réelle est prête. Code complet et testé
  (unitaire, chaîne simulée, PostgreSQL réel), **non poussé, non déployé, non validé**.

## 2. Chronologie 19 → 23/10 (UTC sauf mention)

| Date / heure               | Événement                                                                                                                                                                                                                                 | Nature                | Preuve                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------- |
| 19/10 17:12 → 21:49        | Économie canonique Phase 2 lots 1–7 (jeux, Bonk/Soundboard/TTS, Tombola, Roue, modération, crédits, import d'ouverture, activation gardée)                                                                                                | commits poussés       | [D] `git log origin/main` `1b0f47f`…`0586439`                                                        |
| 20/10 00:46 → 05:58        | Jeux chat + alertes réelles sur le Core principal (lot 8), Studio pilote le Core principal (lot 9), crédits historiques (lot 10), taux passifs 10/20, banque de mots dans l'image, extension `build:production`, profil Production Studio | commits poussés       | [D] `97e45e0`…`3640ea7`                                                                              |
| 20/10 13:37                | Studio **0.1.6** publié                                                                                                                                                                                                                   | release               | [D] GitHub v0.1.6 20/10 11:37 UTC                                                                    |
| 20/10 14:36 / 16:19        | Exécuteur Random Ban dans le bot ; paliers Daily legacy                                                                                                                                                                                   | commits poussés       | [D] `832b1bf`, `473de25`                                                                             |
| 20/10 15:50                | **Import Jetons : 543 comptes, 39 336 444**                                                                                                                                                                                               | données Production    | [H] `POST_LIVE_AUDIT` § 4 (CONFIRMÉ, SQL lecture seule)                                              |
| 20/10 15:58                | Import crédits TTS (3 comptes) et Soundboard (7)                                                                                                                                                                                          | données Production    | [H] idem                                                                                             |
| 20/10 16:11–16:13          | **Core redémarré en économie canonique**                                                                                                                                                                                                  | config Production     | [H] idem ; [D] toujours actif (§ 4)                                                                  |
| 20/10 16:20 → 23:51        | Premier live Raptoru 2.0 : économie saine ; extension staging servie ~52 min (I4) ; plantage bot 0xC0000409                                                                                                                               | live                  | [H] `POST_LIVE_AUDIT`                                                                                |
| 20/10 ~17:56 (19:56 local) | **SAMMI débranché** (décision de bascule ; dernière écriture `alert.log`, `settings.ini`)                                                                                                                                                 | décision de migration | [H] Antoni 23/10 ; [D] dates des fichiers                                                            |
| 21/10 03:13 / 03:36        | Bot unique (bail Core, auto-fencing, image) ; Centre de contrôle                                                                                                                                                                          | commits poussés       | [D] `45ae1c8`, `49c1870`                                                                             |
| 21/10 02:31 / 02:54        | Bot `49c1870` déployé (VPS)                                                                                                                                                                                                               | déploiement           | [D] Coolify bot                                                                                      |
| 21/10 10:40                | Une récompense par réabonnement (§ 14.2)                                                                                                                                                                                                  | commit poussé         | [D] `11ffe3f`                                                                                        |
| 21/10 soir                 | Live 2 (Core `11ffe3f`, bot `49c1870`) : 1 790 récompenses, 0 incohérence ; bug RB/Points de chaîne                                                                                                                                       | live                  | [H] `REPRISE.md` « Bilan du live du 21/10 » (collecte Antoni)                                        |
| 21/10 23:30 → 22/10 00:45  | Core `11ffe3f` → `2e8bfcb` (correctif RB) → `530950b` (annonces) → `efadea9` (Tombola +6 s)                                                                                                                                               | déploiements          | [D] Coolify Core                                                                                     |
| 22/10 13:26 → 17:37        | Passe UX extension `0bf7907` ; `!solde @`, `!tts`/`!rb`/`!fxcam` + migration `20261104120000` (`ed29d23`) ; Jeu des mots + volume (`2d80c2a`) ; push `origin/main`                                                                        | commits poussés       | [D] `git log`                                                                                        |
| 22/10                      | ZIP extension `0bf7907` publié par Antoni                                                                                                                                                                                                 | publication           | [H] relais ChatGPT § 2 + `REPRISE.md` « SHA inchangé = ZIP publié » ; [NV] version servie par Twitch |
| 22/10 16:10                | Sauvegarde `ihcsmwrbheboooopbyiolsxf` (1 265 218 o)                                                                                                                                                                                       | sauvegarde            | [D] Coolify (dernière réussie)                                                                       |
| 22/10 16:15                | **Core `2d80c2a`** + migration FX Cam appliquée au Terminal                                                                                                                                                                               | déploiement           | [D] Coolify ; [H] sortie « applied: … » collée par Antoni                                            |
| 22/10 16:22                | **Bot `2d80c2a`**                                                                                                                                                                                                                         | déploiement           | [D] Coolify bot `hamm4l73hlfdd8kaxyvu122t`                                                           |
| 22/10 ~16:24               | Processus bot démarré (plus redémarré depuis)                                                                                                                                                                                             | runtime               | [D] Centre de contrôle « Actif depuis 18:24:42 »                                                     |
| 22/10 soir                 | Studio **0.1.7** installé (build local, non publié)                                                                                                                                                                                       | installation          | [D] `/api/profile` build 0.1.7 `2d80c2aa548a`                                                        |
| 22/10 live                 | Incident : bot inopérant, rétabli par revérification des autorisations Twitch dans Studio                                                                                                                                                 | incident              | [H] relais ChatGPT § 6 ; cause [NV]                                                                  |
| 22/10 live                 | Utilisés en réel : `!rb` chat (2 confirmés), `!tts` chat (3 réponses), annonces Tombola (32), Jeu des mots (143), mini-jeux (19), Points de chaîne (27 done / 2 BRB refusés), RB récompense (13)                                          | live                  | [D] Studio GET (comptes)                                                                             |
| 22–23/10                   | Votekick V2 + Caution + variantes : worktree `vk-wt`, 12 commits locaux                                                                                                                                                                   | local                 | [D] `git rev-list origin/main..HEAD` = 12                                                            |
| 23/10                      | Intégration PostgreSQL complète `vk-wt` 69/69 ; décisions Caution prises                                                                                                                                                                  | local                 | [D] cette session                                                                                    |

## 3. État réel des composants

### Core API

| Élément                  | État                                                                   | Preuve                             |
| ------------------------ | ---------------------------------------------------------------------- | ---------------------------------- |
| Commit                   | `2d80c2aa548a…`, déployé 22/10 16:15 UTC                               | [D] Coolify                        |
| Santé                    | `/health` 200, `/ready` 200                                            | [D] 23/10 ~01:00 UTC               |
| Économie                 | `canonical` (Wallet Raptoru)                                           | [D] ledger (§ 4)                   |
| Chat                     | « Sortie chat réelle » ON ; 469 réponses `succeeded`                   | [D] `/api/commands/steps`          |
| Points de chaîne         | interrupteur ON (depuis 20/10 16:15), 39 récompenses, 0 job en attente | [D]                                |
| Random Ban               | exécuteur prêt (recherche + timeout autorisés)                         | [D]                                |
| Roue du Sub              | V1, interrupteur ON, 0 gain en attente                                 | [D]                                |
| Jeu des mots             | hors live, volume 45 %                                                 | [D]                                |
| TTS / Soundboard         | actifs, lecteur prêt                                                   | [D]                                |
| `payment_mode` extension | `wallet` en canonique (I8 corrigé)                                     | [D] code `2d80c2a` `ext-facade.ts` |
| Journaux Core            | illisibles avec le jeton Coolify actuel                                | [D] limite connue                  |

### Bot LeCroupier_

| Élément                   | État                                                                                                                                           | Preuve                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Commit                    | `2d80c2a` (le relais ChatGPT le croyait encore `49c1870` : **dépassé**)                                                                        | [D] Coolify + Centre de contrôle « Version 2d80c2aa548a » |
| Hébergement               | VPS Contabo (`vps-f1df63f2f2e0-1`)                                                                                                             | [D]                                                       |
| Twitch                    | chat LeCroupier_ connecté ; subs/bits/points raptoru_ connectés ; autorisation raptoru_ valide ; dernier signal ~12 s                          | [D] instantané 23/10 ~01:00 UTC                           |
| Fonctions                 | jeux chat, réponses chat, `!daily`, `!solde`/`!give`, subs/bits/follows, points de chaîne, présence, Ban aléatoire, alertes (active)           | [D] bail (drapeaux)                                       |
| Caution                   | absente de Production (code non poussé)                                                                                                        | [D]                                                       |
| « healthy » vs disponible | `running:healthy` Coolify ne dit rien de Twitch : seul le bail (Centre de contrôle) montre chat/OAuth/EventSub. L'incident du 22/10 l'illustre | [D] + [H]                                                 |
| 409 `not_lease_holder`    | correctif transverse **toujours absent** d'`origin/main`                                                                                       | [D] `git grep` vide ; `REPRISE.md`                        |

### Raptoru Studio

| Élément            | État                                                                         | Preuve             |
| ------------------ | ---------------------------------------------------------------------------- | ------------------ |
| Installé           | 0.1.7 (`2d80c2a`), profil Production                                         | [D] `/api/profile` |
| Dépôt / GitHub     | `package.json` 0.1.6 ; dernière release GitHub v0.1.6                        | [D]                |
| OBS                | connecté ; lecteur d'effets prêt                                             | [D]                |
| Centre de contrôle | module bot seul                                                              | [D]                |
| Lab vs Production  | même binaire ; Lab = Core local + migrations Lab ; Production = Core distant | [D] code           |

### Extension Twitch

| Élément                                           | État                                                                               | Preuve                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| ZIP publié                                        | `raptoru-live-PRODUCTION-0bf7907cdb5e.zip` (`sb-wt/apps/twitch-extension/release`) | [H] relais ChatGPT ; [NV] version servie |
| Achats extension                                  | débit réel en Jetons (TTS, Soundboard, Bonk, Tombola)                              | [H] `POST_LIVE_AUDIT` § 5                |
| Correctif « écran gris » (overlay.js / mobile.js) | local, non commité (dépôt principal)                                               | [D] `git status`                         |

### Base de données

| Élément               | État                                                                                                                  | Preuve                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations appliquées | 39 (état 21/10) + `20261031140000` (annonces) + `20261104120000` (FX Cam) = 41                                        | `20261031140000` : [D] indirecte (32 étapes d'origine `raffle` réussies, refusées sans elle) ; `20261104120000` : [H] sortie Terminal |
| En attente            | `20261105130000_caution.sql` (local `vk-wt`) ; Roue V2 `2026110{1,2,3}*` (local, dépôt principal)                     | [D]                                                                                                                                   |
| Cohérence Wallets     | 20/10 : 0 écart, 0 doublon ; 21/10 : 0 incohérence                                                                    | [H] audit 20/10, bilan 21/10 ; 22/10 [NV]                                                                                             |
| Données fictives      | tables `lab_*` présentes sur le Core principal (migrations Lab partagées) mais non utilisées par l'économie canonique | [D] code ; contenu [NV]                                                                                                               |
| Sauvegardes           | quotidienne 04:00 UTC + manuelle 22/10 16:10                                                                          | [D] ; **aucune restauration testée** [NV]                                                                                             |

## 4. Économie et migrations

- **Source de vérité** : Wallet canonique Raptoru (Jetons `main`, crédits TTS / Soundboard) [D/H].
- **`lab`** = portefeuille de test séparé (`lab_wallets`, `lab_wallet_ledger`), défaut du Lab ; `ECONOMY_MODE=lab`
  était le mode Production **avant** le 20/10 16:11 UTC. Preuve que ce n'est plus le cas : le ledger renvoyé par le Core
  Production contient des lignes `reward`, type qui n'existe que dans `wallet_transactions` (le ledger de test n'accepte
  pas `reward` : contrainte `lab_wallet_ledger_kind_check`) [D].
- **StreamElements** : plus source de vérité. Désactivation de sa fidélité / de ses jeux après la bascule : [NV].
- **Caution** : utilise `core.economy` (canonique en Production) ; testée sur Wallet canonique (chaîne + PostgreSQL réel).

## 5. Migré vs encore dépendant de SAMMI / StreamElements

| Fonction                                                             | Production actuelle                                                                                                                                      | Preuve                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Jetons, Daily, présence, bonus sub/bits/follow                       | Raptoru (Wallet canonique)                                                                                                                               | [H] audit 20/10 ; [D] ledger |
| Jeu des mots, Roulette / Slot / Duel, Tombola, Roue du Sub V1        | Raptoru                                                                                                                                                  | [D] steps 22/10              |
| Points de chaîne (FX Cam, Couleur Cam, Creepy, BRB, NTM, Random Ban) | Raptoru                                                                                                                                                  | [D] 27 done                  |
| `!solde`, `!tts`, `!rb`, `!fxcam` (chat)                             | Raptoru (`!fxcam` jamais utilisé en réel [NV])                                                                                                           | [D] steps                    |
| Extension (TTS, Soundboard, Bonk, Tombola)                           | Raptoru                                                                                                                                                  | [H]                          |
| Alertes Twitch                                                       | Raptoru (`ALERTS_MODE` active)                                                                                                                           | [D] bail                     |
| **Votekick, Caution**                                                | **non migrés — à reprendre dans Raptoru** (V2 en cours, `vk-wt`) ; SAMMI débranché volontairement                                                        | [H] décision ; [D] code      |
| Banque, 24H, `!cashin`, `!blacklist`/`!whitelist`                    | **non migrés — à reprendre dans Raptoru** (pas commencés)                                                                                                | [H] décision                 |
| Dons                                                                 | StreamElements (via Studio)                                                                                                                              | [H] ; [NV]                   |
| Précaution permanente                                                | **ne jamais réactiver SAMMI** : ses anciens boutons liraient / débiteraient les **points StreamElements gelés** (deck : `get_balance` / `remove_jetons`) | [D] deck SAMMI 18/10         |

## 6. Chantiers ouverts

| Chantier                  | Codé                                                                                                                 | Tests                                                                                              | Commit local                       | Poussé | Déployé | Validé Antoni                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------- |
| **Caution V2**            | Core, bot, Studio, migrations                                                                                        | unitaires 23+2+11+3, chaîne simulée 15 (Lab + canonique), PostgreSQL réel 4 + suite complète 69/69 | oui (`vk-wt`, `417a195`…`47394d3`) | non    | non     | non (décisions § 8 prises le 23/10)                                                               |
| **Votekick V2**           | règles, moteur (ports, mémoire), MuteController, overlay V2                                                          | unitaires 30 + 8 (OBS simulé) + 9 (overlay)                                                        | oui (`7cef411`…`3a5bed1`)          | non    | non     | non ; **non raccordé** (persistance, routes, chat, bot, Studio)                                   |
| **Variantes balance**     | A/B/C/D + comparateur réel 1920×1080                                                                                 | navigateur headless                                                                                | oui (`a12892c`)                    | non    | non     | retour live : D plaît, exécution « trop goofy » → itérations sobres **non commencées** [H relais] |
| **Incident Twitch 22/10** | rien                                                                                                                 | —                                                                                                  | —                                  | —      | —       | cause [NV] ; bot non redémarré [D]                                                                |
| **Bonk / DSK**            | rien                                                                                                                 | —                                                                                                  | —                                  | —      | —       | cause probable [D code + config], non testée                                                      |
| **Roue V2**               | dépôt principal, **non commité** (72 entrées dont ce relais et 2 docs) ; R1–R3 validés local, R4/R7/R8/R9 en attente | tests rapportés 22/10                                                                              | non                                | non    | non     | partiel                                                                                           |

## 7. Contradictions documentaires

| #   | Document (date)                                                                                                  | Affirmation                                                                                     | Réalité / preuve la plus récente                                                                                                       | Confiance |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| C1  | `docs/CLAUDE_HANDOFF_CURRENT.md` (23/10) § 1, § 3                                                                | économie Production `lab`, Jetons réels sur StreamElements                                      | canonique depuis 20/10, active 23/10 [D ledger]                                                                                        | haute     |
| C2  | `docs/CAUTION.md` (vk-wt, 23/10) § 7 prérequis, § 8.3                                                            | activation à la bascule économique / économie canonique requise                                 | bascule déjà faite → condition remplie                                                                                                 | haute     |
| C3  | `CLAUDE_HANDOFF_CURRENT.md`, `CAUTION.md`, `VOTEKICK_V2.md`                                                      | « SAMMI reste la Caution / le Votekick en service »                                             | SAMMI débranché volontairement à la bascule (20/10) [H Antoni 23/10 + D fichiers] — `CAUTION.md` et `VOTEKICK_V2.md` corrigés le 23/10 | haute     |
| C4  | `docs/ECONOMY_MIGRATION.md` (statut 19/10)                                                                       | « aucun import, aucune bascule »                                                                | import + bascule 20/10 [H audit]                                                                                                       | haute     |
| C5  | `docs/HANDOFF_MIGRATION_2026-10-20.md` (avant bascule)                                                           | `ECONOMY_MODE (=lab)`, gel non commencé, SE/SAMMI actifs                                        | état d'avant 16:11 UTC le 20/10                                                                                                        | haute     |
| C6  | `Raptoru-2.0-ETAT-PROJET.md` (19/10)                                                                             | Production legacy uniquement ; Wallet « implémenté local, non branché » ; `!rb`/`!tts` « rien » | tout cela est en Production [D]                                                                                                        | haute     |
| C7  | `docs/CUTOVER_PLAN_2026-10.md` (18/10)                                                                           | canonique aujourd'hui = points SE                                                               | Wallet Raptoru                                                                                                                         | haute     |
| C8  | `docs/REPRISE.md` (22/10) « Annonces… PAS ENCORE DÉPLOYÉ » + « migration `20261031140000` à confirmer »          | déployé (efadea9 puis 2d80c2a) ; migration appliquée [D indirecte : étapes `raffle`]            | haute                                                                                                                                  |
| C9  | `REPRISE.md` « Livraison Production — POUSSÉE, NON déployée » ; « Passe UX extension… non poussée… non publiée » | Core + bot déployés [D] ; ZIP publié [H]                                                        | haute / moyenne                                                                                                                        |
| C10 | relais ChatGPT (23/10) § 2                                                                                       | bot peut-être encore `49c1870`                                                                  | bot `2d80c2a` [D]                                                                                                                      | haute     |
| C11 | relais ChatGPT § 3                                                                                               | « 5 commits locaux »                                                                            | 12 [D]                                                                                                                                 | haute     |
| C12 | `CLAUDE.md` (21/10)                                                                                              | « Current phase : cutover preparation »                                                         | cutover fait, SAMMI débranché ; restent à reprendre dans Raptoru : Votekick, Caution, banque, 24H, cash-in, blacklist                  | moyenne   |
| C13 | mémoire de session Claude (`project_production_core.md`)                                                         | « core.raptoru.fr live 20/10 (empty economy) »                                                  | économie importée et canonique                                                                                                         | haute     |
| C14 | `POST_LIVE_AUDIT` I8                                                                                             | libellé `payment_mode=simulated`                                                                | corrigé (`wallet` en canonique) [D code]                                                                                               | haute     |

## 8. Risques classés

| Niveau              | Risque                                                                                                                                                             | Preuve                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| **P0**              | Incident Twitch non expliqué : le bot peut redevenir inopérant en live **sans alerte** (healthy ≠ connecté)                                                        | [H] 22/10 ; [D] bot non redémarré |
| **P1**              | 409 `not_lease_holder` traité comme définitif par le bot (perte d'événements de fidélité pendant une perte de bail)                                                | [D] non corrigé                   |
| **P1**              | Bonk « En attente de l'overlay » via DSK (nom de source figé « Raptoru Bonk Lab »)                                                                                 | [D] code + config                 |
| **P1**              | Aucune restauration de sauvegarde jamais testée                                                                                                                    | [H]                               |
| **P2**              | Studio 0.1.7 hors canal de mise à jour (GitHub 0.1.6) ; rebuild futur sous le même numéro                                                                          | [D]                               |
| **P2**              | Annonces / migrations non vérifiables via Coolify (jeton sans `read:sensitive`)                                                                                    | [D]                               |
| **P2**              | 50 000 Jetons ajoutés au compte du bot (20/10) non régularisés ; 6 anciennes rédemptions RB                                                                        | [H]                               |
| **P2**              | `main` local à `11ffe3f` (6 derrière `origin/main`) avec Roue V2 non commitée : rebase délicat                                                                     | [D]                               |
| **P2 (précaution)** | Réactivation accidentelle de SAMMI : ses anciennes transactions viseraient les points StreamElements gelés. Rester débranché ; ne jamais s'en servir comme secours | [D] deck SAMMI ; [H] décision     |

Hors risques (feuille de route) : Votekick, Caution, banque, 24H, cash-in, blacklist ne sont pas encore repris dans
Raptoru 2.0 — absence attendue depuis le débranchement volontaire de SAMMI, pas une panne.

## 9. Vérifications impossibles ou manquantes

- Contenu de la base Production (migrations exactes, cohérence Wallets du 22/10) : pas d'accès SQL dans cet audit [NV].
- Journaux Core et bot (Coolify sans `read:sensitive`) : cause de l'incident du 22/10 [NV].
- Version d'extension servie par Twitch [NV].
- État StreamElements (fidélité, jeux, dons) [NV].
- Comportement réel du Bonk avec DSK dans OBS ; source micro à muter pour Votekick [NV].

## 10. Prochaines actions recommandées (ordre)

1. **Corriger les documents** (C1–C14) sur ton accord, en une passe (`CLAUDE_HANDOFF_CURRENT.md`, `CAUTION.md`,
   `VOTEKICK_V2.md`, `REPRISE.md`, mémoire Claude ; les docs historiques gardent leur date avec un renvoi).
2. **Incident Twitch** : collecter les preuves (horodatages du 22/10, journal du bot sur le VPS — demande un accès aux
   journaux ou un export par toi), avant tout correctif ; ajouter ensuite une alerte visible dans le Centre de contrôle.
3. **Caution** : validation Lab (`docs/CAUTION.md` § 7.1) — aucun blocage technique.
4. **Bonk / DSK** : confirmer l'hypothèse en lecture (statut Bonk dans Studio quand « Alerte complète » est en DSK),
   puis correctif ciblé (détection de la source active quel que soit son nom / par URL).
5. Prioriser la reprise dans Raptoru des fonctions historiques non migrées (Votekick, banque, 24H, cash-in,
   blacklist) ; SAMMI reste débranché (aucun redémarrage, aucun secours).
6. Votekick : itérations sobres de la balance (rapides, non bloquantes), puis raccordement.

---

## Tableau de traçabilité

| Affirmation                                       | Type                    | Référence                                                                                                              |
| ------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Core et bot sur `2d80c2a`, healthy                | directe                 | Coolify status 23/10 ~01:00 UTC ; `/health`, `/ready`                                                                  |
| Économie canonique active                         | directe                 | `/api/lab/ledger` (Production) : `reward`/tokens 95, `word_game`/tokens 5, dernière 23/10 00:02 UTC                    |
| Import 543 comptes / 39 336 444 J ; bascule 16:11 | historique              | `docs/POST_LIVE_AUDIT_2026-10-20.md` § 4                                                                               |
| Migration `20261031140000` appliquée              | directe (indirecte)     | 32 étapes `raffle` `succeeded`                                                                                         |
| Migration `20261104120000` appliquée              | historique              | sortie Terminal d'Antoni, 22/10                                                                                        |
| Bot non redémarré depuis le déploiement           | directe                 | Centre de contrôle « Actif depuis 18:24:42 »                                                                           |
| SAMMI débranché volontairement à la bascule       | historique + directe    | confirmation d'Antoni 23/10 ; dates `alert.log`, `settings.ini` ; aucun processus                                      |
| Cause probable Bonk / DSK                         | directe (code + config) | `apps/studio/server/src/bonk-lab/obs.ts` `sourceReady` ; OBS `modules.downstream_keyers` (DSK 1 → « Alerte complète ») |
| Incident Twitch 22/10                             | historique              | `RAPTORU_2_0_CHATGPT_HANDOFF_2026-10-23.md` § 6                                                                        |
| ZIP extension 0bf7907 publié                      | historique              | relais ChatGPT § 2 ; `REPRISE.md`                                                                                      |
| Version d'extension servie                        | non vérifiée            | —                                                                                                                      |
| StreamElements désactivé                          | non vérifié             | —                                                                                                                      |
| Restauration de sauvegarde                        | non vérifiée            | —                                                                                                                      |

**Mini patchnote — Audit de synchronisation**

- État Production : **partiellement vérifié** — Core, bot, Studio, économie et modules vérifiés en direct ; base,
  journaux, extension servie et StreamElements non vérifiables d'ici.
- Économie : **Wallet canonique Raptoru, source de vérité depuis le 20/10, toujours active le 23/10.**
- Fonctionnalités migrées : inventaire § 5 — tout sauf Votekick, Caution, banque, 24H, cash-in, blacklist, **à
  reprendre dans Raptoru** (SAMMI débranché volontairement à la bascule).
- Contradictions corrigibles : **14** (états d'avant bascule présentés comme actuels, déploiements non reportés,
  mention erronée de SAMMI en service, compteurs dépassés).
- Risques détectés : **P0 : 1** (incident Twitch sans alerte) · **P1 : 3** · **P2 : 5** (dont la précaution
  « ne jamais réactiver SAMMI »).
- Caution V2 : **prête pour la validation Lab** — économie réelle disponible, code testé (PostgreSQL réel inclus),
  aucun blocage technique ; déploiement après ta validation.
- Code modifié : **aucun**.
- Production modifiée : **aucune**.
