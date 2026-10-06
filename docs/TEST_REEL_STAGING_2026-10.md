# Premier test réel Raptoru 2.0 — Hosted Test sur le Core staging (préparé le 06/10/2026)

**Statut :** préparation technique terminée et vérifiée de bout en bout sur le staging réel (Studio réel en
profil Production + lecteurs + viewer Twitch signé). **Pas encore validé manuellement par Antoni.** Ce n'est
pas un cutover : le legacy (SAMMI, ancien bot, Extension publiée, `raptoru.fr/api`) reste la production.

Références : [`CUTOVER_PLAN_2026-10.md`](CUTOVER_PLAN_2026-10.md) (§ 4.2 P1-006, § 4.5 P1-019) ·
[`../Raptoru-2.0-HANDOFF.md`](../Raptoru-2.0-HANDOFF.md).

## 1. Architecture du test

```
Stream normal (inchangé) : SAMMI · ancien bot · Extension publiée · raptoru.fr/api (legacy)

Comptes testeurs seulement :
  Extension « Hosted Test » (ZIP STAGING, badge « STAGING · test »)
    → https://core-staging.raptoru.fr/v1/ext   (JWT Twitch vérifié par le Core, rate limit)
    → services V2 du Core staging, Wallet de test (Jetons fictifs, paiement simulé)
    → Raptoru Studio (profil Production · Staging, identité appairée)
    → OBS (overlay Bonk, lecteur Soundboard, source TTS)
```

Aucun appel de la nouvelle Extension ne part vers `raptoru.fr` (contrôlé à la construction du ZIP). Bot /
chat 2.0 : OFF (pas de `!join`, pas de commandes chat, pas d'EventSub 2.0 sur `raptoru_`). Aucun Channel
Point, aucun solde StreamElements, aucun Wallet canonique, aucune migration de soldes.

## 2. État par fonctionnalité (au 06/10/2026 — Core staging déployé `44c895c`, Studio candidat `5de2444`)

| Fonctionnalité                                 | État pour le test                                                                                                    | Preuve                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Identité / session viewer Twitch (JWT)         | **Prêt** dès que le vrai secret d'Extension est posé (secret de test aujourd'hui)                                    | JWT HS256 vérifié, chaîne `83603689`, CORS `*.ext-twitch.tv`, identité partagée ou non, noms Twitch réels (Helix)  |
| Hub / navigation / wallet de test              | **Prêt**                                                                                                             | session staging : 12 000 Jetons de test par viewer, `payment_mode: simulated`, aucun mode Points de chaîne proposé |
| Soundboard                                     | **Prêt**                                                                                                             | admission → Studio → lecteur → `completed` (staging réel)                                                          |
| TTS                                            | **Prêt**                                                                                                             | admission → Studio → lecteur → lecture → STOP                                                                      |
| STOP                                           | **Prêt** (onglet « Modération » de Studio, même Core)                                                                | TTS arrêté (`cancelled`) depuis le cockpit Studio                                                                  |
| Bonk (chaîne technique)                        | **Prêt avec OBS** (overlay Bonk + connexion OBS dans Studio) ; emotes Unicode uniquement                             | sans OBS : refus explicite `obs_offline`, aucun Jeton débité                                                       |
| Bonk final (fidelity, emotes Twitch perso)     | **Hors test**                                                                                                        | OAuth viewer non raccordé sur le Core                                                                              |
| Crédit de Jetons de test aux testeurs          | **Prêt** (Studio → Modération → fiche viewer → Créditer)                                                             | +1 000 vérifié                                                                                                     |
| Modération V2 depuis Studio                    | **Prêt**                                                                                                             | cockpit `/v1/studio/cockpit`                                                                                       |
| Modération V2 depuis l'Extension (modérateurs) | Lecture **prête** ; **actions bloquées** tant que la migration `lab_moderation_idempotency` n'est pas sur le staging | décision Antoni (§ 4)                                                                                              |
| Tombola V2                                     | **Exclue** tant que la migration `lab_stream_session_twitch_id` n'est pas sur le staging                             | décision Antoni (§ 4)                                                                                              |
| Commands V2                                    | Hors test                                                                                                            | chat 2.0 OFF                                                                                                       |
| Mobile                                         | **Possible** (même Extension, surface mobile)                                                                        | —                                                                                                                  |

## 3. Actions manuelles restantes (une seule fois, avant le stream)

1. **Secret d'Extension** (console Twitch › Extension › Settings › Secret Keys) : le copier dans
   `C:\Users\Antoni\.raptoru\twitch-extension-secret.txt` (une ligne). Claude le pose sur le Core staging
   sans l'afficher et redéploie (le secret de test actuel est alors remplacé).
2. **Console Twitch (Hosted Test)** : nouvelle version de l'Extension → Asset Hosting : téléverser le ZIP
   `apps/twitch-extension/release/raptoru-live-STAGING-hosted-test-1e6236a7d735.zip`
   (SHA-256 `d4b3a37fbccf18ebc564d1610da82858567de5c08590e81dd3c0180967311e5c`) (mêmes chemins :
   `panel.html`, `mobile.html`, `video_component.html`, `config.html`) → Capabilities : ajouter
   `https://core-staging.raptoru.fr` aux « Allowlist for URL Fetching Domains » → Access : comptes testeurs →
   passer la version en **Hosted Test**. Ne jamais la publier (Release).
3. **Raptoru Studio 0.1.6** : installer le candidat `apps/studio/desktop/release/Raptoru Studio Setup 0.1.6.exe`
   (SHA-256 `cf513de6b0ff9989c214440e019b5e00da98efbd715c05845600bc5b6684aa4f`, source `5de2444`, non publié — feu vert requis), puis dans l'onglet Studio : « Régénérer
   l'identité… » (l'ancienne, liée au Core de test local, est archivée) puis « Activer le profil Production ».
4. **Appairage** du Studio : Claude appaire avec le code affiché (route opérateur HTTPS, sans Coolify), ou
   en secours via le Terminal Coolify : `node apps/core-api/dist/scripts/studio-installation.js pair <code> "PC Antoni"`.

## 4. Décision en attente

Tombola V2 et les actions de modération depuis l'Extension ont besoin de deux migrations **Lab** additives
postérieures à la frontière Lab / prod (`20261015120000_lab_moderation_idempotency`,
`20261016130000_lab_stream_session_twitch_id`), absentes du staging (18 migrations `prod`). Les appliquer au
seul staging est simple et sans donnée réelle, mais déroge à la frontière figée (`migration-scopes.ts`) :
décision et validation explicites d'Antoni requises.

## 5. Checklist « demain avant stream »

1. Lancer OBS (scènes habituelles ; l'overlay Bonk Raptoru 2.0 dans une scène de test si Bonk est testé).
2. Lancer **Raptoru Studio** depuis la recherche Windows.
3. Vérifier la barre du haut : `Studio 0.1.6 · 5de2444 · Production Staging (core-staging.raptoru.fr) · Connecté · paiement simulé`.
4. Onglet Studio › « Lecteurs Production » : activer le lecteur Soundboard (un clic), vérifier la source TTS
   et, pour Bonk, la connexion OBS + overlay.
5. Lancer le stream normalement (SAMMI / legacy inchangés).
6. Les testeurs ouvrent l'Extension (badge « STAGING · test » visible) et partagent leur identité.
7. Créditer des Jetons de test si besoin (Studio › Modération › fiche du viewer).
8. Tester ; STOP depuis Studio › Modération.

## 6. Rollback simple

- **Arrêter le test côté viewers** : dans la console Twitch, retirer la version Hosted Test (ou les comptes
  testeurs). L'Extension publiée n'est jamais touchée.
- **Couper l'exécution** : Studio › « Revenir au profil Lab » (plus rien n'est exécuté) ; ou fermer Studio.
- **Couper le Core staging** : Coolify › `raptoru-core-staging` › Stop (aucun impact legacy).
- **Révoquer le Studio** si besoin : route opérateur ou Terminal Coolify `… studio-installation.js revoke <id>`.
- Rien à défaire sur le legacy, SAMMI, StreamElements ou les Channel Points : ils ne sont jamais touchés.
