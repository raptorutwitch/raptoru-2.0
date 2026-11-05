# Preuves : les trois démonstrations, mesurées (05/11/2026)

Branche `feat/studio-ux`, commits `54b2b87` → `c4166e2`. Données fictives, Lab uniquement.

**Rien n'est validé** au sens du projet : ni testé à la main par Antoni, ni publié.

## Le socle (écrit une fois)

| Surface | Fichiers | Lignes |
|---|---|---|
| Core | `modules/kit.ts`, `modules/host.ts`, `http/modules-routes.ts`, 2 migrations | 234 + ~630 + ~160 + 82 |
| Studio | `modules/relay.ts`, `control-center/modules.ts`, `web/module-host.ts`, `web/http.ts` | 96 + 119 + 195 + 48 |
| Extension (2 serveurs) | `packages/schemas/module-facade.ts` | 157 |
| Extension (client) | `module-registry.js`, `purchase.js`, `module-moderation.js` | 61 + 90 + 56 |
| Outillage | `scripts/new-module.mjs` | 91 |

Total : environ 2 000 lignes, plus environ 1 070 lignes de tests.

Raccordement unique des fichiers centraux :
- `app.ts` / `lab-core.ts` : quelques lignes ;
- `ui.js` : +25 lignes ;
- `studio/server/src/index.ts` : une regex et un fournisseur.

## Démonstration A — module simple « Objectif de soirée »

| Mesure | Valeur |
|---|---|
| Fichiers créés | 1 (`core-api/src/modules/objectif-soiree.ts`, 64 lignes) |
| Fichiers centraux modifiés | 2 lignes : `modules/index.ts` (1 ligne), `shell/registry.ts` (1 entrée) |
| Code spécifique | 64 lignes : réglage `cible`, actions `ajouter` (avec saisie bornée) et `remettre_a_zero` (confirmation), état |
| Réutilisé sans écrire | identité et catalogue, navigation (page générique), réglage borné et validé par le Core avec persistance, état persistant (`module_state`), journal et audit des actions Studio, permission (streamer), supervision (Centre de contrôle) |
| Raccordement manuel | 2 lignes |
| Tests | `modules-host.test.ts` (démo A), `modules-socle.test.ts` (relais, Centre de contrôle, page, contrôle de navigation) |
| Chemin historique comparable | un module Studio simple : ~9 fichiers (`FRICTIONS.md`) |

## Démonstration B — module transversal « Coffre mystère »

| Mesure | Valeur |
|---|---|
| Fichiers créés | 2 : `core-api/src/modules/coffre-mystere.ts` (133 lignes), `twitch-extension/extension/shared/coffre-mystere.js` (67 lignes) |
| Fichiers centraux modifiés | 3 lignes : `modules/index.ts`, `shell/registry.ts`, `ui.js` (1 `import`) |
| Code spécifique | 200 lignes : la rotation des objets, la limite par viewer, le lecteur fictif, l'état, la vue viewer |
| Réutilisé sans écrire | Jetons (débit et remboursement du débit d'origine, Lab fictif et Wallet canonique), idempotence par intention (clé client et unicité en base), règle de live H1, pause globale, blocages, interrupteur coupé par défaut, journal, modération Studio et extension (journal équipe, remboursement motivé et audité, permission serveur), expiration à 2 min et remboursement unique, porte du lecteur OBS, porte de l'extension identique en Production et en Lab, négociation (Hub = liste du serveur ∩ vues connues), bouton d'achat (deux touches, raison du refus en mots), Centre de contrôle |
| Raccordement manuel | 3 lignes |
| Duplications évitées | façade de Production / EBS du Lab (E1), parcours payant (C2), relais Studio (S2), achat de l'extension (E3), branches de `ui.js` (E2) |
| Tests | Core 10, intégration PostgreSQL 2 (10 envois concurrents sur 2 Cores → 1 débit ; course remboursement / expiration / lecteur → 1 remboursement), façade de Production de bout en bout 2, chaîne Lab réelle 2, extension 6 |
| Chemin historique comparable | ~45 fichiers / ~65 endroits (`FRICTIONS.md`) |

## Démonstration C — module historique « Mini-jeux » (Roulette, Slot, Duel)

| Mesure | Valeur |
|---|---|
| Ajouter un réglage | 6 réglages H10 : mises minimales et délais de Roulette et Slot, plafond et délai du Duel. Bornés, défauts = valeurs appliquées jusqu'ici |
| Réorganiser une interface | la page « Roulette · Slots · Duels » ouvre la carte du module : état réel et réglages. L'interrupteur et les essais restent sur « Simulation » |
| Améliorer son état | interrupteur + live + parties de la dernière heure. Jamais vert sur l'interrupteur seul : « Allumés, mais rien ne se joue hors live » |
| Intégrer une capacité commune | réglages et supervision de l'hôte, sans réécrire le service |
| Règles métier conservées | chances, gains, textes, idempotence, verrous inchangés. Les fonctions pures prennent la valeur, défaut historique |
| Fichiers créés | 1 (`modules/mini-games.ts`, 144 lignes) + 1 test (116 lignes) |
| Fichiers modifiés | 4 fichiers du module (`rules.ts`, `duel-rules.ts`, `duel.ts`, `service.ts`, ~40 lignes) ; raccordement `games.ts`, `app.ts`, `lab-core.ts` (8 lignes) ; contrat généralisé `kit.ts` / `host.ts` (+10, l'interrupteur propre d'un module historique) ; `registry.ts`, `module-host.ts` (8 lignes) |
| Tests préservés | `mini-games-service`, `mini-games-rules`, `duel-rules`, `duel-service` : verts, sans modification |
| Chemin historique comparable | réglages H10 de Bonk (mission précédente) : liste centrale `MODULE_SETTINGS` + service + panneau monté à la main, **sans** supervision |

## Contrôles automatiques (§ 11)

| Ce qui est contrôlé | Où |
|---|---|
| Capacité déclarée sans implémentation, ou implémentée sans déclaration | `checkModule` (au démarrage du Core et en test) |
| Module à actions viewer sans politique de modération ; module payant invisible pour la modération | `checkModule` |
| Achat sans clé | refusé par la porte de l'extension (`idempotency_key_required`) et par le Core (motif de clé obligatoire) |
| Module du socle sans page Studio | `modules-socle.test.ts` |
| Migration oubliée dans une liste de lancement | `migration-scopes.test.ts` (existant) |

## Résultats des suites (05/11, ce commit)

| Suite | Résultat |
|---|---|
| Core complète (PGlite) | **1 380 verts**, 0 échec |
| Intégration PostgreSQL (port 55499) | **191 verts** (dont 1 fichier relancé seul après le plantage connu 0xC0000409) |
| Studio serveur | **884 verts** (dont 1 fichier relancé seul après le même plantage) |
| Extension | 78 verts |
| Bot | 287 verts |
| Build web Studio, lint du dépôt, typecheck Core, serveur Studio et web | propres |

## Limites (honnêtes)

1. **Les modules historiques ne sont pas sur l'hôte** (TTS, Soundboard, Bonk, Tombola, Caution, Votekick, Spotify,
   Random Ban, Roue, Alertes…). Leur double assemblage, leurs parcours payants et leurs listes restent. Un module
   historique rejoint l'hôte par petites étapes, comme dans la démonstration C.
2. **Réponses chat des modules du socle** : la contrainte SQL `cmd_steps_origin_check` liste les origines. Un module du
   socle qui répond dans le chat demande encore une migration pour son origine (C4). Aucune démonstration n'en avait
   besoin.
3. **Rendu OBS** : la porte du lecteur est commune, mais l'exécuteur Studio et la page d'overlay restent à écrire pour
   chaque module. Aucun exécuteur réel n'a été écrit pour la démonstration B : le lecteur est fictif.
4. **Console D4** : la modération des modules du socle est sous le module, pas dans D4 (à arbitrer, DECISIONS D11).
5. **`createStudioServer`** garde ses 24 paramètres positionnels (S1) : sans conséquence pour un module du socle, qui
   n'y ajoute rien.
6. **Production** : la migration `module_activity` est préparée, pas appliquée. Aucun module du socle n'est actif en
   Production : les mini-jeux y gagnent seulement des réglages, aux valeurs d'avant.
7. **Vu dans un vrai navigateur, par moi** (pile isolée du port 4411, Playwright, données fictives), pas par Antoni :
   - Studio : « Modules du socle » et la carte « Roulette · Slots · Duels » (6 réglages bornés, défauts) ;
   - Extension Lab : le Coffre dans le Hub, achat en deux touches, solde de l'en-tête 5K → 4,9K, historique ;
   - Studio : la ligne d'activité, avec « Rembourser… ».

   Ce passage a trouvé trois défauts, corrigés dans `dbb1798`. Ce n'est pas une validation.
   **Pas vu** : le panneau de modération sous le module avec une identité modérateur ; le remboursement cliqué. Ces deux
   points sont couverts seulement par des tests HTTP.

## Mesure après consolidation (05/11, « Opération fondation totale »)

| Scénario | Avant le socle | Maintenant | Il reste à écrire |
|---|---|---|---|
| Nouveau mini-jeu **du chat** | service + migration d'origine chat + liste de mots réservés + câblage dans `createChatGames` et les deux Cores + écran | 1 fichier `modules/<id>.ts` (`chat`, `chatWords`, `ctx.say`) + 1 ligne d'index + 1 entrée de registre | la règle du jeu |
| Nouveau module **extension** (achat en Jetons) | ~45 fichiers, ~65 endroits (`FRICTIONS.md`) | 2 fichiers (Core + vue) + 3 lignes | la règle, la vue |
| Nouveau module **économique** | débit, clé, live, pause, blocages, journal, remboursement à recoder | tout est fourni : prix confirmé, une personne à la fois, remboursement unique, auto-remboursement refusé, cockpit fermé aux achats | rien de commun |
| Nouveau module **OBS** | file, expiration, remboursement à recoder | file avec bail (`claim`), compte rendu (`report`), expiration et remboursement unique fournis | la page d'overlay et l'exécuteur Studio |
| Nouvelle fonction de **modération** | une console par module | journal, remboursement motivé, D4 › « Autres modules » (extension et Studio) fournis | une action propre au module, s'il en faut une |
| **Modifier un module historique** (réglage + état) | liste centrale, service, panneau monté à la main, aucune supervision | un adaptateur (`modules/<x>.ts`) + une lecture dans le service + une ligne `modules.add` par Core (Votekick : 1 fichier, ~10 lignes de service, 2 lignes de raccordement) | la matrice de parité |
| **Ajouter un réglage** | Core, route, schéma, écran | une entrée `settings` : bornes, stockage, validation, écran (panneau partagé) et catalogue suivent | la lecture par le moteur, testée |

Limites mesurées :
- un adaptateur demande toujours une ligne dans chacun des deux Cores ;
- un lecteur OBS réel reste à écrire par module ;
- Bonk, Soundboard, TTS et Tombola gardent leur câblage (`MIGRATIONS.md`, D20) ;
- `ui.js` garde ses branches historiques (6 300 lignes).

