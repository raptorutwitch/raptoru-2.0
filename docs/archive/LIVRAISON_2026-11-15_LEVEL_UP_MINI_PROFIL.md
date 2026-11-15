# Livraison du 15/11/2026 : Level Up V2 et mini-profil

GO explicite d'Antoni (« Livraison finale », 15/11) : fusion, déploiement, migration, activation. Journal daté ; l'état
courant est dans [../REPRISE.md](../REPRISE.md), le fonctionnement dans [../LEVEL_UP_V2.md](../LEVEL_UP_V2.md) et
[../MINI_PROFIL.md](../MINI_PROFIL.md).

## 1. Fusions et versions

| Élément                     | Résultat                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR #70 (Level Up V2)        | fusionnée → `e3fc3e36` (CI 10/10)                                                                                                                        |
| PR #43 (brouillon du 30/10) | fermée, remplacée par #70                                                                                                                                |
| PR #71 (mini-profil, tests) | fusionnée → `main` = `f04b41a2` (CI de la PR et de `main` vertes : quality, core, e2e, studio, extension, images)                                        |
| Core                        | **`f04b41a2` déployé** le 15/11 ~03:53 UTC (Coolify, 139 s), `running:healthy`, `/health` et `/ready` OK, commit rapporté par `/v1/ops/status` identique |
| Migration                   | `20261126130000_progression_level_up.sql` appliquée (additive)                                                                                           |
| Bot                         | inchangé, `13969a8c` actif (aucun fichier du bot ni symbole de schéma lu par le bot modifié)                                                             |
| Site raptoru.fr             | inchangé (il lit déjà l'inventaire et les images des badges du Core)                                                                                     |
| Studio                      | **0.1.34** : workflow « Studio — construire / publier », `publish = public` (§ 5)                                                                        |
| Extension                   | inventaire `INVENTAIRE-7355c44acce2.md` (94 commits depuis `0bf7907`) : **en attente de la ligne de validation d'Antoni**, puis ZIP, Hosted Test, revue  |

## 2. Sauvegarde

- Coolify « Backup now » le 15/11 à 03:34:03 UTC.
  - Exécution `success`, 9 565 742 octets, fichier `pg-dump-raptoru_prod-1794713643-…dmp` sur le VPS.
  - La veille : 9 563 796 octets.
- Moins de 60 min avant la migration.
- Niveau de confiance **B** :
  - l'API Coolify ne permet pas de télécharger le dump ;
  - le format est **A** (dumps Coolify restaurés sans erreur les 20/10, 04/11 et 07/11).
- Retour arrière propre à Level Up : l'audit `progression_normalizations` et « Annuler la normalisation ».

## 3. Simulation et conditions d'arrêt (données réelles)

Résultats détaillés et noms : dossier privé `Documents\Raptoru\_migration-exports\level-up-prod-2026-11-15\` (hors git).

| Contrôle                     | Résultat                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Comptes                      | 1 840, dont 1 636 avec un historique WizeBot rattaché, 332 avec de l'XP native                                                             |
| Historiques WizeBot          | 7 852 lignes, niveau max 135 (75 niveaux distincts)                                                                                        |
| Formule (exposant 0,7, → 50) | recalculée indépendamment : OK sur les 25 plus grandes variations ; aucun historique > 1 ramené au niveau 1                                |
| XP native                    | recalculée indépendamment (XP − import) sur les 25 plus grandes variations : 25/25 identiques, 19 d'entre elles avec de l'XP native gardée |
| Comptes en conflit           | 2 conflits et 6 214 historiques en attente : jamais rattachés au hasard, inchangés                                                         |
| Badges avant activation      | 11 badges publiés, 0 détenteur (aucune attribution sur l'ancienne échelle)                                                                 |
| Simulation = activation      | identiques à l'unité près                                                                                                                  |

Aucune condition d'arrêt n'est atteinte.

## 4. Activation (15/11 ~03:55 UTC)

| Mesure                  | Valeur                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XP normalisée           | 910 comptes                                                                                                                                             |
| Niveau changé           | 441 comptes                                                                                                                                             |
| Niveaux avant → après   | 1 : 854 → 923 · 2–5 : 615 → 600 · 6–9 : 159 → 158 · 10–19 : 101 → 95 · 20–29 : 36 → 36 · 30–39 : 18 → 17 · 40–49 : 15 → 7 · 50+ : 42 → 4 · max 135 → 57 |
| Niveau 1 (+69)          | comptes sans historique WizeBot et sous 1 000 XP (la règle des 1 000 XP par niveau) : leur XP est inchangée                                             |
| Badges attribués        | 266 : niveau 10 → 159 · 20 → 64 · 30 → 28 · 40 → 11 · 50 → 4 · 60 à 110 → 0                                                                             |
| Après activation        | modèle `fixed` (1 000 XP par niveau), normalisation v1 figée (max 135 → 50), gains 1 XP/min, 3 XP/message, 60 s                                         |
| Vérification par viewer | 25/25 : XP et niveau réels = activation, audit (XP avant, XP native, XP après) cohérent, mouvement « normalization » = différence                       |
| Notifications           | 0 événement de Level Up créé par la migration ou l'activation (aucune annonce, aucun son)                                                               |

Ensuite :

- **Annonces** de LeCroupier\_ et **Sons Level Up** allumés :
  - une ligne au plus toutes les 30 s ;
  - une annonce abandonnée après 120 s ;
  - un son au plus toutes les 60 s.
- La « Sortie chat réelle » est active et le bot réclame la file. Toujours 0 événement.

## 5. Préférences du son (ancienne extension)

- Simulation en Production : 5 activés, 1 coupé, 0 doublon, aucun choix récent prioritaire.
- Import réel : identique.
- Relecture :
  - les 6 sont « inchangés » ;
  - côté Core, les 6 viewers lus un par un ont le choix de l'export (source `legacy`).
- 10 viewers sans choix : son coupé.
- Stockage PostgreSQL (`progression_viewer_prefs`). Aucun redémarrage du Core fait pour le prouver.

## 6. Ce qui n'a pas été fait ici

- **Aucun message public** : le test « [TEST] » du chat reste un bouton de Studio, pour Antoni. La route est vérifiée
  en Production sans rien envoyer : refus sans la phrase de confirmation (400).
- **Aucun faux Level Up** sur de vrais viewers.
- **Extension** : la publication Twitch demande la ligne de validation d'Antoni, puis un téléversement et une revue
  dans la console Twitch. Le mini-profil n'est donc pas encore public.

## 7. Retour arrière

1. Couper « Annoncer les Level Up » ou « Sons Level Up » dans Studio (immédiat).
2. Studio › Level Up › « Annuler la normalisation » (tant qu'aucun historique WizeBot n'a été rattaché depuis
   l'activation ; les badges donnés restent).
3. Core précédent : `node scripts/coolify-deploy.mjs deploy core 0ceb9736f95fef6ad918ccafa0af21fb676320d8 --rollback --go`
   (la migration reste, additive).
4. En dernier recours : la sauvegarde du 15/11 03:34 UTC (téléchargement par Antoni dans Coolify, `pg_restore`).
