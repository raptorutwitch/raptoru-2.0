# Extension Next — Hosted Test, publication et retour arrière (préparés, **rien n'est fait**)

> Aucune de ces étapes n'est autorisée sans GO explicite d'Antoni pour l'étape. Ce document les prépare seulement.
> Contexte : [EXTENSION_NEXT_EXECUTION_STATE.md](EXTENSION_NEXT_EXECUTION_STATE.md) · socle : [SOCLE.md](SOCLE.md).

## 1. Ce qu'il faut savoir avant tout

- **Version servie aujourd'hui : non prouvée.** `apps/twitch-extension/PUBLISHED` contient `0bf7907` (présumé). Preuve,
  sans rien modifier : twitch.tv/raptoru_ › F12 › Sources › `<client-id>.ext-twitch.tv` › `shared/runtime-config.js` ›
  `buildId: "production-<commit>-<date>"`. Corriger `PUBLISHED` avec ce commit avant tout emballage de Production.
- **Écart avec `main`** : tout ce qui est entre `PUBLISHED` et le commit emballé part dans le zip. Sur cette branche :
  les 44 commits non publiés de `main` (inventaire par famille : plan § 12.1) + les commits de la refonte.
- **Le shell par défaut reste `legacy`.** Un zip construit sans `--shell v2` donne aux viewers l'ancienne interface,
  avec les correctifs du lot 1 et la garde « écran gris ». Le shell v2 n'est servi qu'avec `--shell v2`.

## 2. Emballages (locaux, aucun téléversement)

```sh
cd apps/twitch-extension
node scripts/package.mjs --target staging --shell v2        # Hosted Test sur le Core de staging, badge STAGING
node scripts/package.mjs --target production --check        # tout vérifier, rien écrire
node scripts/package.mjs --target production --shell v2     # REFUSÉ sans inventaire validé (voulu)
node scripts/verify-package.mjs release/<zip>               # relire un zip avant tout téléversement
```

Inventaire exigé par la Production : `apps/twitch-extension/release-inventory/INVENTAIRE-<sha12>.md`, une ligne par
commit entre `PUBLISHED` et la source, et la ligne exacte `Validé par Antoni : oui` — **écrite par Antoni seulement**.

## 3. Hosted Test (à faire par Antoni, sur son GO)

1. Console Twitch › extension › version de test › téléverser le zip **staging v2** (jamais un zip de Production à ce stade).
2. Vérifier les contraintes reprises de l'audit : helper chargé en premier, aucun script inline, composant 65 %, panel,
   mobile activé.
3. Comptes : LeCroupier_ (test) ; Antoni ; si accord, Wenhuir et Ace of Spade (message préparé au plan lot 0, non envoyé).
4. Parcours à faire, chacun en viewer puis en modérateur :

| #   | Parcours                                                 | Où              | Attendu                                                                    |
| --- | -------------------------------------------------------- | --------------- | -------------------------------------------------------------------------- |
| 1   | Ouvrir le composant à 65 %, zoom 100 / 110 / 125 / 150 % | PC              | Hub entier ou défilant, rien de coupé ; textes ≥ 10 px                     |
| 2   | Mode théâtre, plein écran                                | PC              | cartes plus grandes, Soundboard avec plus de sons                          |
| 3   | TTS : écrire, changer de monnaie, confirmer              | PC + mobile     | paiement visible, un seul débit, message de file                           |
| 4   | Soundboard : écouter, favori, jouer                      | PC + mobile     | requête identique, favoris conservés                                       |
| 5   | Bonk : choisir une emote, tirer                          | PC + mobile     | emojis chargés à l'ouverture (premier affichage plus léger)                |
| 6   | Tombola : participer, liste des participants             | PC (521–600 px) | liste lisible et défilante                                                 |
| 7   | Modération D4 : file TTS, restrictions, Créditer/Débiter | PC              | toutes les actions présentes                                               |
| 8   | Bloqueur de pub actif / boucliers Brave                  | PC              | message « Connexion à Twitch impossible » + Réessayer, jamais d'écran gris |
| 9   | iPhone (iOS ≥ 16.4) et Android, portrait et paysage      | mobile          | personnages TTS et flèches atteignables, défilement sain                   |

## 4. Publication (sur GO explicite, après le Hosted Test validé par Antoni)

1. Prouver la version servie, corriger `PUBLISHED`.
2. Antoni relit l'inventaire des commits (familles, risques) et écrit la ligne de validation.
3. `node scripts/package.mjs --target production --shell v2` (ou sans `--shell v2` pour publier seulement les correctifs
   sur l'ancienne interface) ; `verify-package` ; Antoni téléverse et soumet. Review Twitch : 8 à 14 jours ; « Rejected »
   est définitif → une seule soumission, après Hosted Test complet.
4. Après approbation : `PUBLISHED` = commit publié, dans le même commit que la note de version.

## 5. Retour arrière

| Situation                               | Moyen                                                                                                                                                                                                                                                                                                                        | Délai                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Pendant le développement                | abandonner la branche `feat/extension-next` (rien n'est fusionné)                                                                                                                                                                                                                                                            | immédiat                                 |
| Après fusion, avant publication         | le défaut reste `legacy` : rien ne change pour les viewers                                                                                                                                                                                                                                                                   | immédiat                                 |
| Après publication d'un zip `--shell v2` | (1) remettre en ligne la version précédente depuis la console — **possibilité non vérifiée**, à relever par Antoni ; (2) nouvelle soumission du même code avec `--shell legacy` (le shell legacy est dans chaque zip) ; (3) interrupteur sans review par le service de configuration Twitch — décision § 13-3, non construit | (1) minutes si possible ; (2) 8–14 jours |

Le shell legacy (`overlay.js`, `mobile.js`, `shared/ui.js`, `base/overlay/mobile.css`) reste dans chaque zip jusqu'au
lot 6 (nettoyage, sur accord d'Antoni après ≥ 2 semaines stables).

## 6. Notes de version (brouillon)

- Plus aucun bouton coupé : paiement TTS, bas du Hub, participants de la Tombola, personnages TTS sur mobile.
- Message clair au lieu d'un écran gris quand un bloqueur empêche la connexion à Twitch.
- (v2) Interface plus légère à l'ouverture (≈ 2,2 Mo → ≈ 0,74 Mo avant le Hub), textes plus lisibles (≥ 10 px),
  composition identique à la version 75 % mise à l'échelle de chaque fenêtre, zones de clic agrandies.
