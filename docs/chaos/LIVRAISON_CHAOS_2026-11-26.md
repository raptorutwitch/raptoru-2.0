# Chaos V2 — livraison du lot 2 (26/11/2026) : intégration réelle, rien de publié

Branche locale `feat/chaos-integration` (worktree `Raptoru 2.0 - Worktrees\agent`), **non poussée**. Aucun déploiement,
aucune migration distante, aucun Jeton réel, aucune activation. Ordre et GO : [DEPLOIEMENT_CHAOS.md](DEPLOIEMENT_CHAOS.md).

## 1. Ce qui fonctionne réellement (vérifié par l'agent, pas une validation d'Antoni)

Banc Lab réel : extension (coque v2) servie par un Studio Lab du worktree → Core Lab (base isolée `raptoru_bonk_lab`,
Jetons du Lab) → boucle Studio → **vrai moteur Chaos installé** → écran principal. Garde de jeu avant chaque effet,
OBS fermé, aucun stream.

| Parcours                                                          | Résultat                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Achat Miroir 10 s (API de l'extension)                            | en file → pris par Studio (+1,0 s) → démarré (+1,3 s) → fini (+12 s) ; débit 22 600 une fois ; le même envoi rejoué = doublon                                                                                    |
| Achat par la vraie interface (Miroir, Zoom, Ivresse, Tremblement) | « Lancer » → « Confirmer » → effet à l'écran ; solde de l'en-tête 82K → 59K ; pied : « en route », puis compte à rebours                                                                                         |
| Prix falsifié par le navigateur                                   | 409 `price_changed`, rien débité                                                                                                                                                                                 |
| Deux viewers en même temps (Couleur + Zoom)                       | chacun débité et joué ; délai personnel appliqué                                                                                                                                                                 |
| Clin d'œil ponctuel ×3 sans confirmation                          | 3 achats (charges), 3 effets, 24 000 débités ; renvoi de la 1re clé = doublon                                                                                                                                    |
| STOP ALL Studio pendant un Brouillard 20 s                        | fin `stopped_by_studio`, **remboursé** (joué < 25 %, règle de l'arrêt)                                                                                                                                           |
| Redémarrage du moteur pendant Écran retourné 20 s                 | fin `shutdown`, **remboursé**                                                                                                                                                                                    |
| Modération (extension)                                            | viewer « stop » → 403 ; modérateur stop + rembourser → remboursé ; 2e remboursement → `already_refunded` ; suspendre → « Suspendu » ; reprendre ; offrir → joué sans débit ; crédit accordé → acheté à 0 et joué |
| Console FX (bouclier)                                             | s'ouvre sur FX avec les données du Core (récents, Rembourser, offrir, crédit, Tout arrêter)                                                                                                                      |
| Mobile (390 px)                                                   | Hub → Interactions → fiche Brouillard, devis du Core                                                                                                                                                             |
| Bilan du banc                                                     | 18 demandes, 0 ouverte à la fin, 3 remboursées, écarts de solde exacts                                                                                                                                           |

## 2. Ce qui reste simulé ou non vérifié ici

- Aucun essai avec de **vrais Jetons**, le vrai Core de Production, la vraie extension Twitch (Hosted Test) ni OBS en
  marche (OBS fermé pendant le banc) : le chemin d'affichage est celui de chaos.11 (mode écran, vu par « Écran »).
- Studio en **profil Production** (routes `/v1/studio/chaos/*`, jeton d'installation) : testé par les tests
  automatiques, pas en vrai.
- Panne Studio **avant** la prise en charge, expiration, redémarrage du Core : tests automatiques (PostgreSQL réel),
  pas provoqués sur le banc.
- Tarifs : calculés, **non validés** ; réglables dans Studio › Chaos › Tarifs (§ 8).
- Décision à prendre (Antoni) : un effet démarré dont Studio ne confirme jamais la fin (Studio coupé plus longtemps que
  la durée de l'effet + 15 s) finit en « fin inconnue », compté joué, **non remboursé automatiquement** (la modération
  peut rembourser). Alternative : rembourser d'office si Studio a disparu avant la moitié de l'effet.

## 3. Commits (branche locale)

`e618c68e` Core `chaos` · `052930db`, `4a95ba68` boucle Studio · `f3605271`, `ca8fa870` relais et session du Lab ·
`fe5b8b6f` bout à bout Core ↔ Studio · `b5dfcff9`, `a4fd2972` corrections trouvées sur le banc réel (textes Jetons
réels, refus formulés comme la maquette, devis qui suivent l'état du Core, bouclier → FX) · `4b844d57` panne du moteur
remboursée comme une panne (sa fin part avant le STOP ALL : 50 % et non 25 %, trouvé par la suite Studio) · plus les commits d'intégration
précédents (`d2f8e045`, `569d02fa`, `db08815b`, `0da2a76b`, `8953b0bc`, `bf984e9c`, `1228542b`).

## 4. Tests

- Core, suite complète (`npm test`) : 1 791 / 1 792 ; l'échec est `sub-wheel-r2` (18,5 s seul pour une limite de 30 s,
  dépassée sous la charge de la suite ; vert 3 fois sur 3 seul ; la branche ne touche ni la Roue du Sub ni la fidélité).
- Core Chaos : `chaos.test.ts` 19 (PGlite) ; `chaos.integration.test.ts` 8 sur **PostgreSQL réel local** (10 envois
  parallèles → 1 débit, course sur la file, remboursement en course avec balayage / modération / Studio → une fois,
  double remboursement refusé, ACK rejoué ou dans le désordre, bail expiré remboursé, crédits et charges en parallèle,
  reprise après redémarrage) ; parité Core ↔ extension 5 (plus de 1 000 réglages).
- Studio, suite complète (`npm test`) : 1er tour 1 193 / 1 194 (le test bout à bout a révélé la course fin de panne /
  STOP ALL, corrigée en `4b844d57`) ; 2e tour après correction 1 192 / 1 194 : `effects-player` et `moderation-d4`
  échouent une fois sous la charge de la suite, verts au 1er tour, seuls (3/3) et sous charge parallèle (2/2) ; non
  prouvés étrangers à la branche (`moderation-d4` passe par `lab-ebs.ts`) : à surveiller dans la CI de la PR.
  Ciblés : boucle Core 11 (dont l'ordre fin de panne → STOP ALL), bout à bout Core ↔ boucle ↔ moteur
  simulé 2, relais du Lab 1 (+ 7).
- Extension : 300 / 300 (37 fichiers) ; matrice visuelle de la maquette 49 / 49 ; bot 305 / 305.
- Typage OK partout (schémas, Core, Studio serveur et tests, Studio web, bot) ; ESLint et Prettier propres sur tous les
  fichiers de la branche (Prettier vérifié en fins de ligne LF, comme la CI).

## 5. ZIP et composants

- Extension : `--check` de Production OK (2 233 fichiers, 17,8 Mo, coque v2, API `core.raptoru.fr`, `verify-package`
  OK) ; **aucun ZIP écrit** : l'inventaire `release-inventory/INVENTAIRE-a4fd2972be05.md` (55 commits depuis
  `be1744e`) attend la ligne de validation d'Antoni.
- Core : migrations `20261206130000_chaos.sql` (Production) / `20261206120000_chaos_lab.sql` (Lab), additives.
- Studio : aucune version construite (release seulement depuis `main` après fusion, sur demande d'Antoni).

## 6. Verdict

**NO-GO pour un lancement public payant ce soir** ; **GO technique pour commencer le déploiement fermé**, étape par
étape (DEPLOIEMENT_CHAOS.md § 3) : le code des débits, confirmations et remboursements est testé (PostgreSQL réel, banc
Lab réel), mais le parcours réel avec de vrais Jetons, le Studio installé en Production, OBS en marche et l'extension
Twitch n'a pas été validé par Antoni, et les tarifs ne sont pas validés. Rien ne s'ouvre aux viewers avant l'étape 7.

## 7. Actions qui demandent l'accord d'Antoni

1. Pousser `feat/chaos-integration` et ouvrir / fusionner la PR (CI).
2. Déployer le Core avec la migration `20261206130000_chaos.sql` (sauvegarde < 60 min, `--migrations-approved`).
3. `npm run studio:release` depuis `main`, puis installer la version (Antoni).
4. Inscrire « Validé par Antoni : oui » dans `release-inventory/INVENTAIRE-a4fd2972be05.md` → ZIP → Hosted Test.
5. `CHAOS_EXTENSION=testers:<son id>` + `chaos.enabled = 1` pour l'essai réel sur son compte (§ 5 de DEPLOIEMENT).
6. Valider les tarifs (TARIFS.md, ou les régler dans Studio › Chaos › Tarifs) ; Sécurité à 60 000 ms s'il veut 60 s.
7. Revue Twitch, puis `CHAOS_EXTENSION=on`.

## 8. Éditeur de tarifs (26/11 soir, même branche, rien de publié)

- **Studio › Chaos › Tarifs** : une ligne par effet (minimum, maximum, fourchette en vigueur, « personnalisé » avec la
  date), « Enregistrer » (confirmé par le serveur), « Par défaut » (avec confirmation) ; en ouvrant un effet, aperçu du
  prix par préréglage, force et durée avec les montants en cours de saisie, plafond du live (Sécurité) indiqué.
- **Core** : `GET` / `POST /v1/lab/chaos/<chaîne>/prices` (Lab) et `/v1/studio/cockpit/chaos/<chaîne>/prices` (Production,
  installation appairée, chaîne du Core seulement) ; contrôle : effet connu, Jetons entiers, pas de 50, 50 à 1 000 000,
  min ≤ max ; stockage : réglages de module masqués `chaos.price_<effet>_min|max` (table existante, **aucune
  migration**), écrits par paire sous le verrou de la chaîne (le même que l'achat), tracés au journal de modération.
- **Calcul** : le moteur de prix existant, normalisé entre le réglage le plus doux et le plus sévère (le minimum est
  désormais atteint : Écran retourné dès 25 000 au lieu de 35 850 ; tableaux régénérés dans TARIFS.md).
- **Extension** : l'état du Core porte `prices` ; « dès » et le détail du prix suivent ; un changement relance chaque
  devis (relu toutes les 2 s) ; un ancien prix confirmé → `price_changed`, rien débité, le nouveau s'affiche.
- **Testé** (automatique, et banc isolé dans un vrai navigateur : vraie page Studio › Chaos, vrai relais, Core Lab en
  mémoire) : Flou 15 000 – 100 000 → 10 000 – 75 000, aperçu = devis du Core (25 100 → 17 700 à 10 s), valeurs
  retrouvées après rechargement, « Par défaut » confirmé. Pas encore dans le Studio installé ni sur le vrai Core.

## 9. PR #130 (27/11) — poussée, CI verte, non fusionnée

- Branche poussée et PR #130 ouverte vers `main` sur GO d'Antoni (push + PR seulement). CI : 11 / 11 verts au commit
  `33ec9861` ; fusion sans conflit.
- Correctifs trouvés par la CI : `7d62d4c9` (formatage : GUIDE_STUDIO_CHAOS.md en fins de ligne CR seules, JSON du
  banc — données identiques) ; `33ec9861` (**vrai défaut** du curseur OBS, lot précédent : à la fin d'un effet, la
  capture du curseur pouvait rester coupée jusqu'à l'effet suivant quand le minuteur sonnait un peu avant l'horloge ;
  test à horloge figée qui échoue sans le correctif). E2E « Overlay musique » : coupure de connexion au simulateur
  Spotify, 3 / 3 en local, contrôle relancé seul → vert.
- Fusion simulée (commit non référencé) : arbre identique à la branche, dernier commit de l'extension `2e2d664208a9`
  (56 commits) → l'inventaire reste exact après une fusion en « Create a merge commit ».
- Ordre, valeurs réelles de Production, essai fermé, retour arrière et décisions avant l'ouverture :
  DEPLOIEMENT_CHAOS.md § 3 à § 8.
