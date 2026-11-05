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

## Vérification ciblée du socle (mission continue, 05/11)

| Question | Réponse | Preuve |
|---|---|---|
| Les modules du socle passent-ils par les contrats communs ? | oui : achat, journal, remboursement et réglages ne passent que par `ModuleHost` | `modules-host.test.ts`, `modules-robustness.test.ts` |
| Production et Lab ont-ils les mêmes règles, sans partager leurs données ? | même hôte depuis la même liste ; économie Lab ou Wallet canonique ; modules `labOnly` absents en Production, **réglages compris** (ajouté ici) | `modules-host.test.ts` « Lab-only modules are not mounted… » |
| Une action viewer est-elle possible avec une identité arbitraire côté Studio ? | non : le cockpit refuse `…/viewer/…` (404) ; le relais Studio n'a pas de route viewer | `ext-frontier.test.ts` « the cockpit never buys for a viewer » |
| Le remboursement porte-t-il uniquement sur la transaction d'origine ? | oui : `economy.refund(activityId)`, une seule fois, sous verrou de ligne ; aucune route de crédit | `modules-host.integration.test.ts` (course sur PostgreSQL) |
| Les anciennes fonctionnalités ont-elles un seul exécuteur ? | oui : les adaptateurs ne font que lire, le moteur historique reste le seul à agir | `status-adapters.ts`, `votekick.ts`, `caution.ts` (aucun `run`) |
| Les adaptateurs reflètent-ils leur moteur ? | oui : intention et « prêt » lus sur le moteur réel (exécuteur, live, pouls) | `votekick-module`, `caution-module`, `status-adapters` |
| Les réglages H10 sont-ils lus par les exécuteurs ? | oui : chaque réglage a un test qui change le comportement | `mini-games-settings`, `votekick-module` (plage, délai), `caution-module` (tarif) |
| Le registre de l'extension crée-t-il une vérité concurrente ? | non : il affiche la liste du serveur, croisée avec les vues connues ; il ne décide rien | `module-host.test.js` |
| Les routes sont-elles accessibles dans le Lab, par le vrai client Studio ? | oui : la liste blanche est corrigée et testée sur la vraie chaîne | `modules-lab-chain.test.ts` |
| Les migrations préparées sont-elles compatibles avec les données historiques ? | oui : elles sont additives et testées sur des bases passées | `migration-scopes.test.ts`, `migration-main-core` et `sub-wheel-v2` (intégration) |

## Mission continue (05/11) : ce qui a changé, avec preuve

| Lot | Problème réel | Changement | Preuve | Ce qui devient plus simple |
|---|---|---|---|---|
| Socle | aucun test ne prouvait qu'un module Lab ne laisse aucun réglage en Production | assertion ajoutée (réglages listés, réglage refusé) | `modules-host.test.ts` | — |
| Extension | 7 endroits de `ui.js` par module autonome | `registerSessionModule` ; un seul chemin de montage | 3 E2E, dont un nouveau (aller-retour sans rechargement) | un module de session = son fichier + une ligne d'import |
| OBS | le faux lecteur de la démo contournait la porte `claim` / `report` | un lecteur fictif générique, en Lab seulement, par la vraie porte ; doublon supprimé | navigateur : achat → prise en charge → échec → « remboursé » chez le viewer et dans Studio ; `modules-socle.test.ts` (404 en Production) | tester tout module OBS en Lab sans écrire de faux lecteur |
| Studio | « Prêt pour le live » en longue liste qui masquait Santé et Favoris | grille de cartes, en CSS seulement | captures 1440 px et 420 px, sans défilement horizontal | voir l'état du live en un coup d'œil |
| Spotify H6 | la grâce n'avait pas été vérifiée de bout en bout | vérifié : seules les demandes `QUEUED` sont annulées, une coupure plus courte que la grâce et une reconnexion ne touchent rien | `MIGRATIONS.md` § Spotify | — |
| Livraison | aucun plan | `LIVRAISON.md` : 8 migrations, coexistence des versions, ordre, contrôles, retour arrière | — | le jour du GO |

## Mission d'exécution (05/11) : extension

| Lot | Problème | Changement | Preuve |
|---|---|---|---|
| Parité d'abord (`b9ea6c4`) | aucun E2E de l'extension sur TTS V2 et Tombola V2 ; la pile d'aperçu n'offrait que TTS V1 | `tts-tombola.e2e.ts` vert **avant** de toucher au code ; vrai worker TTS et lecteur fictif sur la pile | 2 E2E |
| Variantes (`50e8601`) | les règles de rafraîchissement rapide de chaque module étaient codées dans `ui.js` | `registerModuleVariant` (`onState`) : TTS V2 et Tombola V2 dans leurs propres fichiers | les mêmes E2E, verts après ; une régression (`start` absent) trouvée par eux et corrigée |
| Liste du Hub (`602401a`) | « Voir tous les modules » se refermait sous le viewer à chaque nouvel état | l'état ouvert est conservé entre deux dessins | reproduit (1 tuile → 0), corrigé, E2E de non-régression |
| D4 (`2d9f7b2`) | console et vue « Commandes » câblées dans `ui.js` | variante de « moderation » | `commands-public.e2e.ts`, parcours modérateur |
| P1 (`2d9f7b2`) | écran vide pour un modérateur sur TTS V2 et Tombola V2 (panneau du socle monté à tort) | panneau réservé aux vues du socle | E2E en modérateur ; confirmé aussi par la revue |
| Chemin rapide prouvé | l'E2E ne prouvait pas `onState` (signalé par la revue) | marqueur sur l'en-tête de l'hôte, vérifié à la lecture d'état suivante | mutation : `onState` forcé à `false` → échec ; code réel → succès |

## Continuation (05/11) : Soundboard, Bonk, cycle de vie

| Lot | Problème | Changement | Preuve |
|---|---|---|---|
| E2E TTS intermittent (`480ee5c`) | échec 1 fois sur 2 en série | cause 1 : la vue TTS remplace son premier composer par le TTS en cours → signal `data-recovered` ; cause 2 : les lecteurs fictifs n'acquittaient rien, chaque achat était remboursé ≈ 15 s plus tard pendant le test suivant (mesuré : solde 19 500 → 20 000) → ils acquittent | 3 séries vertes ; mutation `onState` toujours détectée |
| Volume Soundboard (`208791e`) | après un nouvel état, Échap ne refermait plus l'aperçu | vue détachée neutralisée ; focus rendu au curseur | E2E en échec avant, vert après |
| Glisser retenu (`208791e`, `d3e564a`) | — | signal déterministe : la lecture qui suit celle qui porte le nouveau solde | mutation `holdState → false` détectée |
| Bonk : ancien message au retour (`c960894`, `d3e564a`) | « Salve ×1 acceptée ✓ » d'une visite passée | effacé en quittant ; aussi pour une requête encore en vol (trouvé par la revue) | E2E en échec avant ; test unitaire en échec avant |
| Bonk sur la pile (`dbf64cb`) | aucun E2E Bonk ; 7TV/BTTV/FFZ passent par le réseau | fournisseurs fictifs injectés dans le Lab Core ; images servies localement | 0 requête hors machine, vérifiée |
| Cycle de vie (`dc209e2`) | — | `lifecycle.e2e.ts` : 3 rôles, transitions Hub, lectures arrêtées, coupure réseau | 4/4 |
| Isolation (`d3e564a`) | rien n'empêchait un navigateur E2E de joindre Internet | Chromium ne résout plus aucun nom (sauf 127.0.0.1) | suite E2E complète |

Revue indépendante (sous-agent, code seul) : 1 défaut réel (message Bonk d'une requête en vol), 1 test trop faible
(glisser), 4 remarques ; corrigés dans `d3e564a` sauf « `channelTwitchId: '900100'` touche aussi Random Ban / Votekick sur
la pile » (hypothèse, aucun test n'en dépend aujourd'hui) — noté ici.

## Frontières Soundboard et Bonk (05/11)

| Lot | Problème précis | Preuve |
|---|---|---|
| Tri de la Soundboard (`9c45e91`) | à la souris, choisir « A → Z » ou « Prix » ne faisait rien (le menu se fermait au `mousedown`, avant le clic) | E2E en échec avant, vert après |
| Volume de la Soundboard (`9c45e91`) | à la souris, « couper » fermait l'aperçu sans agir | idem |
| Échap (`9c45e91`) | après une visite de la Soundboard, Échap n'atteignait plus les historiques Tombola V1 / modération V1 | par construction (la pile E2E n'offre que les V2) |
| Prix Bonk du Lab (`d163944`) | l'extension affichait 200 quand le Core facturait le prix réglé dans Studio | E2E en échec avant (200 au lieu de 350), vert après |
| Délai Bonk (`d163944`) | « Une erreur est survenue. » au lieu du délai réglé par le streamer | E2E |
| Étoile des favoris (`d163944`) | cellules de 44 px (panneau, composant vidéo) : l'étoile couvrait le milieu de l'emote, un clic après survol ajoutait un favori au lieu d'un Bonk | E2E en échec avec l'ancien CSS (320 px), vert après |
| Pile E2E (`59bb0fb`) | deux morts en cours de série, jamais reproduites depuis (≈ 15 séries) | erreurs fatales désormais écrites dans le journal ; non provoqué |

Identités fictives : canal 900100 (le Lab) et compte Twitch 900101 (le viewer Lab). Random Ban, Votekick et Caution
traitent 900100 comme le streamer, ce qui correspond aux conventions du Lab ; aucun E2E de ces modules sur la pile, leurs
tests Core ont leurs propres fixtures ; suite E2E complète 83/83 après l'ajout.

Revue indépendante (sous-agent, code seul) des frontières : 1 défaut réel (Échap sorti du panneau : l'Overlay vidéo
ferme son tiroir sur un Échap de la page ; latent avec les pages actuelles, toujours en vue composant) et 4 points
(vue gardée si le module disparaît, clics écoutés sur tout le document, tutoriel Bonk perdu sur un retour rapide, étoile
réduite sur les grandes cellules) : corrigés dans `dccec77`, avec un test qui échoue sur la version d'avant. La même
série a révélé que le prix Bonk n'était relu qu'au premier chargement (corrigé : relu à chaque lecture de l'extension).

Tests rendus déterministes : `halloween-studio` comptait les tuiles du Hub sur une page encore en chargement (échec
sous charge, jamais seul) et laissait la pile en « testeurs seulement » en cas d'échec (cascade sur 2 autres specs).
- Studio « + Testeur extension » : bouton actif mais inerte tant que l'historique du viewer n'était pas chargé (le clic
  partait avec un identifiant vide). Visible seulement sous charge ; désactivé comme « Créditer ». Suite E2E complète
  84/84 après reconstruction de l'interface Studio (la pile sert `apps/studio/web/dist`).

## Chemins V1 (05/11)

| Lot | Problème précis | Preuve |
|---|---|---|
| Modération V1 (`b27da6e`) | ouvrir l'historique d'un utilisateur redessinait le panneau et perdait le focus hors du panneau : Échap ne fermait plus le tiroir | E2E en échec sur l'ancien code (vérifié en remettant les fichiers de HEAD), vert après |

Harnais : l'extension en mode démo sur la pile E2E (`runtime-config.js` servi par le test) ; fixtures locales ; requêtes
sortantes enregistrées et vides.

