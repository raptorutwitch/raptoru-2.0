# Plan d'implémentation — Mini-jeux et Random Ban V2

12/11/2026, **plan actif** (numérotation du mandat d'Antoni du 12/11 : lots 0 à 3, puis les suivants). Tout est dans le
worktree `mini-jeux-random-ban`, **non commité**.

**Références :** [SPEC](SPEC_RANDOM_BAN_V2.md) (règles en vigueur, § 13 : état) · [UX](UX_UI_MINI_JEUX.md) ·
[AUDIT](AUDIT_MINI_JEUX_RANDOM_BAN.md) (constats).

**Règles :** lots verticaux testables dans le Lab (Core local, base Docker jetable, simulateurs, exécuteur à blanc) ;
**aucune action de Production sans GO pour chaque étape** : lecture ou écriture Twitch avec un jeton de Production,
migration distante, déploiement du Core et du bot, release de Studio, Hosted Test, publication de l'extension, création
ou pause d'une récompense, fusion dans `main`.

**Priorité (13/11, Antoni) : les récompenses Twitch dans Studio** — voir [RECOMPENSES_TWITCH.md](RECOMPENSES_TWITCH.md)
(statut de « Ban aléatoire », inventaire, procédure de migration). Le reste du chantier est conservé, en pause.

## 1. État des lots

| Lot | Contenu | État |
| --- | --- | --- |
| **0. Préparation** | état Git, dépendances, tests existants, fixtures fictives, scénarios | fait en local ; **mesures réelles à faire avec toi** (§ 3) |
| **1. Correctifs extension** | format K / M partagé, pastille « +N » (legacy **et** v2), en-tête Musique non figé, garde double-clic sur tous nos contrôles (protection Bonk réutilisée) | **fait**, tests auto + rendu Chromium (données fictives) ; à voir dans le vrai lecteur (Hosted Test) |
| **2. Socle Core** | prix progressif 5 min, achat sous verrou par viewer, `!rb <montant>`, action extension `launch` (OFF par défaut), plafond de 2, cooldown points de chaîne + `CANCELED` + message après Twitch, migration additive | **fait**, tests PGlite + vrai PostgreSQL concurrent |
| **3. Interface Mini-jeux** | vue Random Ban : prix, jauge, confirmation en deux appuis, états, historique personnel ; carte du Hub « Mini-jeux » | **fait** (première version) : modèle testé, parcours vu dans Chromium (banc, Core simulé), v2 et legacy, 651×434 et 318 px ; le solde est celui de l'en-tête |
| 3b. Exécuteur simulé du Lab | l'exécuteur réel avec un faux Twitch (8 viewers fictifs) : `npm run rb:lab-simulator` (Core local seulement) | **fait** ; test de bout en bout ; pas encore lancé contre un Lab Core démarré |
| 3c. Remboursement auto en points | demande `failed` d'une récompense Raptoru → `CANCELED` une fois + message après Twitch | **fait**, testé |
| **4. Sniper** | prédiction figée, fenêtre 30 min toutes sources, prime unique, liste des présents, stats | **fait**, testé (y compris vrai PostgreSQL) |
| **5. Le Viseur** | bande décidée par le Core, frappe différée par le bot, rouleau et « Esquivé ! » dans le lecteur d'effets, secours sans Studio | **fait**, OFF par défaut ; à régler en réel (`strike_offset_s`) ; release de Studio et déploiement du bot nécessaires |
| **6. Modération** | historique, À vérifier, annuler, rembourser un incertain, retirer une prime, pause, blocages et délais D4 | **fait** (Core + page Studio) ; « lever la sanction » non fait (Unban du bot) |
| **7. Statistiques et défi** | stats personnelles (extension, site), totaux publics (route du site), métriques du défi secret | **fait** côté Core ; page du site et défi à faire |
| 8. Recette et Production | démo locale prête (`npx tsx scripts/mini-jeux-demo.ts`, http://127.0.0.1:4495) ; puis ta recette, puis Production sur GO | à faire, avec toi |

**Démonstration locale** (aucun réseau, tout fictif) : `cd apps/core-api && npx tsx scripts/mini-jeux-demo.ts`, puis
http://127.0.0.1:4495 — la vraie extension (Hub › Mini-jeux), le vrai Core en mémoire, le vrai exécuteur du bot sur un
faux Twitch, le flux du stream (rouleau, « Esquivé ! », carte de ban), le chat d'Alice (`!rb`, `!rb 30000`), la
modération (pause, annulation). `TIER_STEP_MIN=1` raccourcit la récupération pour la tester.

## 2. Détail du lot 1 (correctifs extension, hors Random Ban)

- `shared/currency.js` `formatCompactAmount` (troncature, virgule, espace fine) ; `ui-primitives.js` (en-tête 2
  chiffres, pastille de gain) ; `tombola-v2.js` ; `modules/music/module.js` (le solde n'est plus absorbé).
- Pastille : styles dans `currency-switch.css` (legacy) **et** `app/css/currency-switch.css` (v2 — oubli trouvé au
  rendu Chromium, corrigé) ; mouvement réduit : simple fondu.
- `shared/dblclick-guard.js` : écouteur `dblclick` sur `<html>` (avant le helper Twitch sur `document`), arrêté pour
  les seuls contrôles ; zones vides libres ; installé dans `app/main.js`, `overlay.js`, `mobile.js`.
- Vérifié dans Chromium (banc, données fictives, v2 et legacy, 651×434 et 318 px) : 999 · 1 K · 999 K · 1 M · 6,2 M ;
  « +40 » animé puis retiré ; solde exact au survol et dans l'`aria-label`. Le Core (Random Ban) est détaillé dans la
  SPEC § 13.

## 3. Ce qui demande un accès réel (sur GO)

- GET Custom Reward `only_manageable_rewards=true` (jeton broadcaster de Production) : confirme la réponse B.
- Création de la récompense Raptoru, règle, test hors live, pause de l'ancienne (AUDIT § 12.1) ; jamais de suppression.
- Hosted Test `timeout-debug` : double-clic dans le vrai lecteur, extension pendant un timeout (PC, iOS, Android).
- Latence vidéo pour `strike_offset_s` (Le Viseur).

## 4. Ordre de mise en Production (chaque étape sur GO)

1. **Migrations** `20261123130000_random_ban_purchase.sql` et `20261124130000_cp_reward_admin.sql` (additives).
2. **Core** (prix progressif, Sniper, Viseur OFF, modération, stats). Effet immédiat sur `!rb` : le prix devient
   progressif dès le déploiement (retour arrière sans déploiement : `random_ban.tier_step_min` = 0).
3. **Studio** (release) : la page Sanctions sait lire `extension` / `canceled` ; le lecteur d'effets sait jouer le
   rouleau. **Studio doit précéder l'usage** : une Studio plus ancienne affiche les nouveaux statuts comme texte brut
   (protégé par un repli dans cette version, pas dans l'installée).
4. **Bot** (attente `delay_ms`) : seulement utile quand `random_ban.sequence` = 1 ; un bot plus ancien frappe tout de
   suite (le rouleau jouerait alors après coup).
5. **Récompense Raptoru** (lecture Twitch, création, règle, pause de l'ancienne) : AUDIT § 12.1.
6. **Extension** (release Hosted Test, puis publication) et `random_ban_ext.enabled` = 1.
7. **Le Viseur** : `random_ban.sequence` = 1 après mesure de la latence (`strike_offset_s`).

## 5. Restant (hors V1)

- Lever une sanction (Unban par le bot, permission `randomban.lift`).
- Tampon « SNIPER ! +2 000 » sur le stream ; vrais avatars Twitch dans le rouleau (cache d'avatars du Core).
- Page publique et personnelle sur raptoru.fr (dépôt du site) ; création du défi secret par Antoni.
- Demande arrêtée pendant l'attente du Viseur : aujourd'hui « à vérifier », pourrait être remboursée d'office.
- Exclusion des comptes `loyalty_exclusions` du tirage (retenue, SPEC § 6).

## 6. Risques

| Risque | Parade |
| --- | --- |
| Régression du Random Ban en Production (bot) | recherche inchangée ; propriété « tirage identique » ; Core avant bot ; `random_ban.sequence` = 0 par défaut |
| Facturation surprise | `expected_price` / `!rb <montant>` = plafond ; jamais de débit au-dessus |
| Double prime, double remboursement | clés d'idempotence, tests de concurrence sur vrai PostgreSQL |
| Points annoncés remboursés à tort | message seulement après la réponse de Twitch |
| Ban après l'arrêt du rouleau qui échoue | « Esquivé ! », remboursement ; « BANNI » seulement après confirmation |
| Revue Twitch et double-clic | protection limitée aux contrôles, lot séparé et retirable |
| Case de 40 px trop étroite avec l'espace fine | vérifié au banc Chromium (6,2 M tient) ; à revoir dans le vrai lecteur |

## 7. Retour arrière

- `random_ban_ext.enabled` OFF (défaut) : l'achat depuis l'extension est fermé ; `!rb` et les points de chaîne restent.
- `random_ban.sequence` = 0 (défaut) : timeout puis vidéo, comme aujourd'hui.
- `random_ban.tier_step_min` = 0 : prix fixe ; `random_ban.cp_cooldown_min` = 0 : plus de cooldown (sans déploiement).
- Migrations additives, laissées en place. Bot redéployable sur la version précédente (le Core accepte les rapports
  sans les nouveaux champs). Lot 1 : release de l'extension précédente. Animation : release de Studio
  précédente. Récompense : réactiver l'ancienne.
- **« Validé » = testé à la main par toi.**
