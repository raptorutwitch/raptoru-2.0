# Mini-jeux / Random Ban V5 — livraison préparée

13/11/2026. Branche `audit/mini-jeux-random-ban`, PR #67 (brouillon). **Rien n'est fusionné ni déployé** : la fusion
et la Production attendent la validation d'Antoni (visuelle et de la nouvelle mécanique). Après elle, la livraison
suit ce document sans autre phase de développement. Remplace LIVRAISON_V4 (prix progressif abandonné).

## 1. Ce que la livraison contient

| Composant | Changements                                                                                                                                                                                                                                                                                                               | Nécessaire pour                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Core      | prix fixes (25 000 Jetons extension et `!rb`), **charges communes** aux trois moyens (3, une toutes les 10 min), limite de la chaîne (OFF), refus du chat limités à 1 / 5 min par viewer, achat depuis l'extension (`random_ban_ext`, **OFF par défaut**), Sniper, modération Random Ban (dont « Recharger ses charges ») | tout                                                |
| Migration | `20261123130000_random_ban_purchase.sql` (+ jumelle Lab) : colonnes ajoutées (`price_paid`, `charge`, `wish_*`, `wish_text`, `sniper`, `canceled_by`, `cancel_reason`), contraintes élargies (`source` + `extension`, `status` + `canceled`, modules de blocage/délai + `random_ban`), un index                           | le Core                                             |
| Bot       | attente `delay_ms` avant le timeout **seulement** si le Core l'envoie (`random_ban.sequence` = 1) ; simulateur Lab                                                                                                                                                                                                        | rien en Production tant que `sequence` = 0 (défaut) |
| Studio    | Modération › Random Ban (demandes, annuler, rembourser Jetons ou points, résoudre un Sniper, bloquer, délai, lever, **recharger les charges**) ; Sanctions › Random Ban : « Prix et charges », « Limite de la chaîne », « Sniper et extension »                                                                           | la modération et les réglages                       |
| Extension | catalogue Mini-jeux, écran Random Ban V5 (jauge des charges, achat en un clic, machine agrandie)                                                                                                                                                                                                                          | le jeu côté viewers                                 |

Ce qui ne change pas : les alertes de ban du stream (lecteur d'effets de Studio, vidéos et phrases d'Antoni), la
récompense Twitch « Random Ban » déjà créée et son coût (3 000 points), les durées de timeout, l'immunité et le
tirage du streamer, les probabilités, les remboursements existants.

## 2. Ce qui change en live dès le déploiement du Core

- **`!rb` et la récompense de points utilisent les charges** (3 par viewer, une toutes les 10 min, communes). Un
  viewer sans charge est refusé avant tout : `!rb` ne débite rien, la rédemption de la récompense Raptoru est annulée
  et remboursée par Twitch. Le cooldown individuel de 10 min des points de chaîne disparaît (remplacé).
- Les demandes acceptées des 24 dernières heures comptent dès le déploiement (colonne `charge` à vrai par défaut).
- **Levier immédiat sans redéploiement :** Studio › Sanctions › Random Ban › « Charges par viewer » = **0** (aucune
  limite). Les autres nouveautés restent invisibles tant que `random_ban_ext.enabled` = 0 et que l'extension n'est pas
  publiée.

## 3. Vérifications faites (Lab, 13/11)

- Core : suite complète ; intégration PostgreSQL (migrations prod/Lab, Sniper, **5 achats simultanés d'un viewer sur
  deux Cores, `!rb` et points mélangés : exactement 3 acceptés**) ; tests des charges (règle pure, recharge, refus qui
  ne repousse rien, échec remboursé qui rend la charge, rejeu, partage avec les points, récompense non gérée, priorité
  de la modération, limite de la chaîne, recharge par un modérateur, refus du chat limités à 1 / 5 min).
- Extension : tests purs (jauge des charges continue et en minutes entières, carrousel, Sniper, historique).
- **Parcours de bout en bout dans Chromium** : `npm run mini-jeux:check -w @raptoru/core-api` lance sa propre démo et
  vérifie 23 points, dont : un double-clic n'achète pas ; un achat = un débit = une charge ; plus de charge (points
  compris) = bouton fermé, attente affichée, refus court dans le chat ; recharge par la modération ; achat en un clic
  (un double clic paie une fois) ; Sniper payé une fois ; animations réduites ; 651×434, 480×320, 318×496.
- Emballage de l'extension : `node scripts/package.mjs --target production --check` (voir § 5).

Ce qui ne peut pas être vérifié ici : les vraies photos Twitch, la charge réelle d'un live, le rendu dans le lecteur
Twitch réel, le remboursement réel d'une rédemption par Twitch (simulé).

## 4. Ordre de livraison (après validation)

`SHA` = le commit de fusion de la PR #67 sur `main`, CI verte. Hors live. Outil : `scripts/coolify-deploy.mjs`
(`COOLIFY_URL=https://dashboard.raptoru.fr`).

1. Sauvegarde de la base (< 60 min) : `PATCH /api/v1/databases/4jaqdyvzlelgwkyvuxhjy4mr/backups/ha3t1pu8q83re2gjvg5wetbu {"backup_now":true}`.
2. `plan core SHA --migrations-approved` → PRÊT, puis `deploy core SHA --migrations-approved --go`. Attendu :
   `applied: 20261123130000_random_ban_purchase.sql`, `/health`, `/ready`, `status core`.
3. `plan bot SHA` puis `deploy bot SHA --go`, `status bot` (bail actif, EventSub, jeton diffuseur).
4. Studio : workflow « Studio — construire / publier », `publish=public`, confirmation `PUBLISH studio <sha7>`.
   Antoni installe la nouvelle version hors live.
5. Contrôles : Studio › Sanctions › Random Ban montre « Prix et charges » (25 000, 3, 10 min) ; Studio › Modération ›
   Random Ban liste les demandes ; « Tirage à blanc » (aucun timeout) aboutit.
6. Extension : inventaire `release-inventory/INVENTAIRE-<dernier commit de l'extension>.md` (préparé, voir § 5)
   validé par Antoni, puis `npm run package:production -- --shell v2`, upload, Hosted Test, soumission à Twitch.
7. Quand la version de l'extension est en ligne : Studio › Random Ban › `random_ban_ext.enabled` = 1.

Compatibilité pendant la bascule : nouveau Core + ancien bot = sans effet (le bot n'attend que si `delay_ms` arrive) ;
nouveau Core + Studio 0.1.31 = tout fonctionne sauf l'onglet de modération Random Ban et les nouveaux réglages
(réglables après installation) ; nouveau Core + extension publiée actuelle = rien de visible ; nouvelle extension +
`random_ban_ext` OFF = pas de carte Mini-jeux.

## 5. Point d'attention : l'extension publiée a du retard

La version servie par Twitch est présumée `0bf7907`. Publier la V5 publie **aussi** les commits de l'extension
déjà en attente (archive Hosted Test du 11/11, non validée). L'inventaire de cette livraison les reprend et ajoute
ceux de Mini-jeux. Sans validation de ce lot, la livraison Core/bot/Studio peut se faire seule : `random_ban_ext` reste
OFF et rien ne change pour les viewers de l'extension (les charges s'appliquent quand même à `!rb` et aux points).

## 6. Retour arrière

| Quoi                    | Comment                                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Achat dans l'extension  | Studio › Random Ban › `random_ban_ext.enabled` = 0 (immédiat)                                                                                                                                              |
| Charges (`!rb`, points) | « Charges par viewer » = 0 (aucune limite, immédiat) ; « Une charge revient toutes les » pour assouplir                                                                                                    |
| Limite de la chaîne     | « Limite de la chaîne » = 0 (défaut)                                                                                                                                                                       |
| Core                    | `deploy core fc937833ecaf6a822635031a48a7d03f28c5b909 --rollback --go` ; la migration reste (additive : l'ancien Core ignore les colonnes ajoutées, les valeurs par défaut gardent ses insertions valides) |
| Bot                     | `deploy bot fc937833ecaf6a822635031a48a7d03f28c5b909 --rollback --go`, après le Core                                                                                                                       |
| Studio                  | réinstaller 0.1.31 (BACKUPS.md § 5)                                                                                                                                                                        |
| Extension               | ne pas publier ; publiée : version précédente dans la console Twitch, ou `random_ban_ext` = 0                                                                                                              |

## 7. Après la validation

Fusionner la PR #67 (CI verte), suivre le § 4 dans l'ordre, puis le § 6 au besoin. Pas décidé, donc pas livré : le
tampon SNIPER sur le stream, les pages raptoru.fr.
