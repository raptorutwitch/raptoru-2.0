# Mini-jeux / Random Ban V4 — livraison préparée

14/11/2026. Branche `audit/mini-jeux-random-ban`, PR #67 (brouillon). **Rien n'est fusionné ni déployé** : la fusion
et la Production attendent la validation visuelle d'Antoni. Après elle, la livraison suit ce document sans autre
phase de développement.

## 1. Ce que la livraison contient

| Composant | Changements                                                                                                                                                                                                                                                                                                                              | Nécessaire pour                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Core      | prix progressif en Jetons (extension et `!rb`), achat depuis l'extension (`random_ban_ext`, **OFF par défaut**), Sniper (texte libre, `unresolved`, `resolve_sniper`), bande du tirage (`stats.strip`), état du joueur (prix, disponibilité, historique public), modération Random Ban, statistiques publiques, cache des photos partagé | tout                                                |
| Migration | `20261123130000_random_ban_purchase.sql` (+ jumelle Lab) : colonnes ajoutées (`price_paid`, `series_level`, `wish_*`, `wish_text`, `sniper`, `canceled_by`, `cancel_reason`), contraintes élargies (`source` + `extension`, `status` + `canceled`, modules de blocage/délai + `random_ban`), un index                                    | le Core                                             |
| Bot       | attente `delay_ms` avant le timeout **seulement** si le Core l'envoie (réglage `random_ban.sequence` = 1 et Studio présent) ; simulateur Lab                                                                                                                                                                                             | rien en Production tant que `sequence` = 0 (défaut) |
| Studio    | Modération › Random Ban (demandes, cible, sanction réelle, Sniper, annuler, rembourser Jetons ou points, résoudre un Sniper, bloquer, délai, lever) ; réglages du prix progressif et du Sniper sur la page Random Ban                                                                                                                    | la modération                                       |
| Extension | catalogue Mini-jeux, écran Random Ban V4                                                                                                                                                                                                                                                                                                 | le jeu côté viewers                                 |

Ce qui ne change pas : les alertes de ban du stream (lecteur d'effets de Studio, vidéos et phrases d'Antoni), la
récompense Twitch « Random Ban » déjà créée et ses règles, le cooldown des points de chaîne, les durées de timeout,
l'immunité et le tirage du streamer, les remboursements existants.

## 2. Ce qui change en live dès le déploiement du Core

- **`!rb` passe au prix progressif** (décision du 12/11, SPEC § 2) : un `!rb` seul n'achète qu'au tarif normal
  (25 000) ; au-dessus, le Core répond le prix du joueur sans rien débiter, et `!rb 30000` confirme. Levier
  immédiat sans redéploiement : Studio › Random Ban › « Retour d'un palier toutes les » = **0** (prix fixe).
- Les autres nouveautés restent invisibles tant que `random_ban_ext.enabled` = 0 et que l'extension n'est pas
  publiée.

## 3. Vérifications faites (Lab, 14/11)

- Core : suite complète, intégration PostgreSQL (migrations prod/Lab, Sniper), tests Random Ban et Sniper (texte libre,
  résolution unique, disponibilité). Extension : tests purs (jauge continue, carrousel, Sniper, historique).
- **Parcours de bout en bout dans Chromium** : `npm run mini-jeux:check -w @raptoru/core-api` lance sa propre démo et
  vérifie : catalogue → jeu ; un double-clic n'achète pas ; un achat = un débit ; la machine s'arrête sur la cible
  du Core ; un rafraîchissement ne rejoue pas ; pause et délai de modération dits avant le clic ; Sniper réussi payé
  une fois ; animations réduites ; 651×434, 480×320, 318×496 sans débordement.
- Emballage de l'extension : `node scripts/package.mjs --target production --check` vérifie l'archive (voir § 5).

Ce qui ne peut pas être vérifié ici : les vraies photos Twitch (le cache se remplit par l'application Twitch du Core),
la charge réelle d'un live, le rendu dans le lecteur Twitch réel.

## 4. Ordre de livraison (après validation)

`SHA` = le commit de fusion de la PR #67 sur `main`, CI verte. Hors live. Outil : `scripts/coolify-deploy.mjs`
(`COOLIFY_URL=https://dashboard.raptoru.fr`).

1. Sauvegarde de la base (< 60 min) : `PATCH /api/v1/databases/4jaqdyvzlelgwkyvuxhjy4mr/backups/ha3t1pu8q83re2gjvg5wetbu {"backup_now":true}`.
2. `plan core SHA --migrations-approved` → PRÊT, puis `deploy core SHA --migrations-approved --go`. Attendu :
   `applied: 20261123130000_random_ban_purchase.sql`, `/health`, `/ready`, `status core`.
3. `plan bot SHA` puis `deploy bot SHA --go`, `status bot` (bail actif, EventSub, jeton diffuseur).
4. Studio : workflow « Studio — construire / publier », `publish=public`, confirmation `PUBLISH studio <sha7>`.
   Antoni installe la nouvelle version hors live.
5. Contrôles : Studio › Modération › Random Ban liste les demandes ; Studio › Random Ban montre « Prêt » ;
   « Tirage à blanc » (aucun timeout) aboutit et apparaît dans la modération.
6. Extension : inventaire `release-inventory/INVENTAIRE-<dernier commit de l'extension>.md` (préparé, voir § 5)
   validé par Antoni, puis `npm run package:production -- --shell v2`, upload, Hosted Test, soumission à Twitch.
7. Quand la version de l'extension est en ligne : Studio › Random Ban › `random_ban_ext.enabled` = 1.

Compatibilité pendant la bascule : nouveau Core + ancien bot = sans effet (le bot n'attend que si `delay_ms`
arrive, jamais avec `sequence` = 0) ; nouveau Core + Studio 0.1.31 = tout fonctionne sauf l'onglet de modération
Random Ban ; nouveau Core + extension publiée actuelle = rien de visible (Mini-jeux n'existe pas dans cette version) ;
nouvelle extension + `random_ban_ext` OFF = pas de carte Mini-jeux.

## 5. Point d'attention : l'extension publiée a du retard

La version servie par Twitch est présumée `0bf7907`. Publier la V4 publie **aussi** les commits de l'extension
déjà en attente (archive Hosted Test du 11/11, inventaire `INVENTAIRE-bb8700814939.md`, non validé). L'inventaire
de cette livraison les reprend tels quels et ajoute ceux de Mini-jeux. Sans validation de ce lot, la livraison
Core/bot/Studio peut se faire seule : `random_ban_ext` reste OFF et rien ne change pour les viewers de l'extension.

## 6. Retour arrière

| Quoi                               | Comment                                                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Achat dans l'extension             | Studio › Random Ban › `random_ban_ext.enabled` = 0 (immédiat)                                                                                                                                              |
| Prix progressif (`!rb`, extension) | « Retour d'un palier toutes les » = 0 (prix fixe, immédiat)                                                                                                                                                |
| Core                               | `deploy core fc937833ecaf6a822635031a48a7d03f28c5b909 --rollback --go` ; la migration reste (additive : l'ancien Core ignore les colonnes ajoutées, les valeurs par défaut gardent ses insertions valides) |
| Bot                                | `deploy bot fc937833ecaf6a822635031a48a7d03f28c5b909 --rollback --go`, après le Core                                                                                                                       |
| Studio                             | réinstaller 0.1.31 (BACKUPS.md § 5)                                                                                                                                                                        |
| Extension                          | ne pas publier ; publiée : version précédente dans la console Twitch, ou `random_ban_ext` = 0                                                                                                              |

## 7. Après la validation

Fusionner la PR #67 (CI verte), suivre le § 4 dans l'ordre, puis le § 6 au besoin. Pas encore décidé, donc pas
livré : les charges progressives des points de chaîne, le tampon SNIPER sur le stream, les pages raptoru.fr.
