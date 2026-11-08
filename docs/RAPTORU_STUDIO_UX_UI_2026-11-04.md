# Raptoru Studio nouvelle génération

> **Note de consolidation (08/11/2026).** Proposition du 04/11, historique. Sa navigation a été adoptée ; sa palette a été remplacée par la direction D « Coulisses » ([studio-refonte/DESIGN_SYSTEM.md](studio-refonte/DESIGN_SYSTEM.md)). Studio Coulisses est en Production depuis le 07/11.

## Dossier unique d’audit UX/UI et de conception — 4 novembre 2026

**Statut : proposition de conception à arbitrer. Aucune implémentation dans Studio.**

**Référence technique : Studio 0.1.25 / `8a897a5f7b1a840f8c520a6909a446b703502a89`.** Les propositions ne modifient ni les règles économiques, ni les permissions, ni les données. Aucun défi, objet, récompense ou réglage actif n’a été créé. Aucun test Twitch/OBS, redémarrage, déploiement, migration ou installation n’a été effectué.

Le dossier principal est conservé dans `docs/RAPTORU_STUDIO_UX_UI_2026-11-04.md` du worktree Core/Studio à jour. Une maquette HTML autonome de six écrans l’accompagne dans le même répertoire documentaire. Les captures et la copie de consultation sont livrées dans les outputs du chat. Les notes de recherche intermédiaires restent dans `work/`, hors du projet.

### Décision proposée

**Organiser Studio autour de destinations stables, et ajouter une régie de live qui réutilise leurs actions.** Six entrées principales : **Centre de contrôle, Régie live, Modules, Communauté, Activité, Système**. Le Laboratoire reste un outil séparé, accessible sans transformer l’application entière en un catalogue de tests.

Un module possède une adresse et une implémentation de ses réglages/actions. Une récompense Twitch, une commande, un favori ou une tuile de régie peuvent y conduire. Cette pluralité de parcours ne crée pas plusieurs moteurs d’exécution.

La transformation prioritaire concerne l’architecture de l’information et la sémantique des actions. La couleur vient ensuite. Les nouveaux Défis doivent devenir un atelier avec condition lisible et vérification préalable ; la Boutique doit distinguer l’objet, son apparence et ses offres. Les intégrations OBS/Twitch restent visibles, mais cessent de définir à elles seules le rangement des fonctions.

### Conclusions qui orientent toute la refonte

1. **Le désordre est structurel.** Quinze onglets globaux mêlent administration, jeux, intégrations et tests. Points de chaîne contient à lui seul Spotify, Random Ban, Caution, Votekick et la Roue du Sub. Plusieurs fonctions importantes n’ont aucune destination propre.
2. **Les libellés de contexte constituent un risque opérationnel.** « Paiement simulé », SAMMI et « migration à venir » apparaissent dans un Studio Production actuel. Le code confirme des textes obsolètes ; cela ne prouve pas un fonctionnement simulé du backend.
3. **La supervision est utile, mais monopolise le contenu.** Lors de l’observation, deux pannes et trois rétablissements occupaient une grande bande au-dessus de toutes les pages. Les incidents doivent rester visibles sans reconstruire cette pile à chaque écran.
4. **Le socle peut évoluer sans réécriture.** TypeScript/Vite, composants DOM `mountX`, serveur local et Core possèdent des frontières exploitables. Une migration de framework, du Core ou du modèle économique n’est pas nécessaire.
5. **Les garanties métier doivent précéder leur présentation.** « Vérifier », « enregistrer », « activer », « recompter », « arrêter » et « rembourser » n’ont pas le même effet. La refonte doit rendre ces différences visibles.
6. **Storyboard n’a pas été retrouvé.** Aucun composant nommé ainsi dans la base auditée ou le paquet installé. L’éditeur d’Alertes fournit de bonnes références vérifiables, mais n’est pas assimilé au Storyboard évoqué dans le brief. Sa préservation reste une exigence avant de toucher son artefact réel.

### Lecture et niveau de preuve

- **A — Diagnostic :** référentiel, observations, inventaire, formulaires et parcours.
- **B — Options UX :** trois modèles différents, choix, arborescence et navigation.
- **C — Direction graphique :** tokens et contrats de composants.
- **D — Écrans cibles :** six spécifications reliées à la maquette.
- **E — Implémentation future :** socle, couplages, lots cohérents, tests et coexistence.
- **F — Charte durable :** conventions d’extension et critères de sortie.

Les mentions **observé** désignent une lecture de la véritable interface installée. **Code** désigne une déduction étayée par des sources. **Documenté** désigne un état annoncé par les documents, sans contrôle de Production indépendant. **Proposé** désigne une conception future. Aucun de ces termes ne signifie « validé par Antoni ».

---

# Partie A — Diagnostic

## A.1 Référentiel réellement analysé

| Élément                                                    | Vérification                                                                                                                                                                                               | Conséquence                                                                                                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout principal `Documents/Raptoru 2.0`                 | `main` à `11ffe3f`, 261 commits derrière `origin/main`, nombreux changements non commités                                                                                                                  | Écarté comme base de code ; conserve les données du Studio installé. Aucun nettoyage ni synchronisation.                                                                        |
| Worktree `Documents/Raptoru 2.0 - Worktrees/site-hub-core` | Branche `docs/site-hub-delivered`, HEAD `68420a0`, deux commits documentaires devant `origin/main`                                                                                                         | Base de l’audit Studio/Core. `origin/main` et son SHA distant vérifié par `git ls-remote` sont `8a897a5`.                                                                       |
| Code publié                                                | Tag `studio-v0.1.25` sur `8a897a5`                                                                                                                                                                         | Cohérence avec le code de l’interface examinée. Le `package.json` desktop à 0.1.6 ne représente pas la version du produit packagé.                                              |
| Release publique                                           | GitHub annonce [Raptoru Studio 0.1.25](https://github.com/raptorutwitch/raptoru-studio-releases/releases/tag/v0.1.25), publiée le 04/11 à 02:00:13 UTC, soit 03:00:13 à Paris ; ni brouillon ni préversion | La dernière release connue du brief est encore la dernière release renvoyée par GitHub pendant l’audit.                                                                         |
| Installation présente                                      | UI Electron : 0.1.25 et `8a897a5f7b1a` ; `resources/app/build-info.json` concordant, build du 04/11                                                                                                        | L’incertitude documentaire « installée à confirmer » est levée pour cette installation observée. Aucun test fonctionnel réel de ses modules.                                    |
| Site                                                       | `Documents/Raptoru 2.0 - Worktrees/raptoru-fr-refonte`, branche `feat/cosmetic-kit`, HEAD `e33d697` ; distant `main` à `74f7542`                                                                           | Le kit cosmétique local est postérieur à la livraison du site ; ne pas le présenter comme Production.                                                                           |
| Documentation                                              | `REPRISE`, `ARCHITECTURE`, `ROADMAP`, `OPERATIONS`, `RELEASE_SITE_HUB`, `CHALLENGES`, `COSMETIC_SHOP`, documents des modules et `lb-app/docs/SITE_CONTEXT`                                                 | Lecture croisée avec le code ; plusieurs documents d’architecture/opérations datent encore d’octobre. Les deux commits documentaires du worktree ne sont pas sur `origin/main`. |

Les dépôts vides des projets historiques `Documents/ChatGPT/Projet Complet` et `Site` ne sont pas les sources du produit actuel. Les worktrees anciens ont été inventoriés via Git, sans suppression ni déplacement.

L’état du Core distant, ses flags, sa base et ses services n’ont pas été interrogés. La documentation du 04/11 annonce `CHALLENGES_ENGINE` absent/désactivé. **Cela ne garantit pas qu’activer un défi ou cliquer Recompter soit sans effet : ces actions peuvent lancer un traitement immédiatement.**

## A.2 Observation directe de l’application

Inspection avec Computer Use de la fenêtre Electron déjà ouverte, sans lancer une seconde instance ni un environnement de développement qui pourrait charger des lecteurs. Navigation seulement entre Studio, Boutique, Points de chaîne, Alertes et Défis. Pas de clic sur un bouton de test, d’exécution, d’acquittement, de connexion ou de sauvegarde.

| Observation                          | Constat direct                                                                                                                                                                      | Limite et interprétation                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Fenêtre large, capture 2 048 × 1 104 | Quinze destinations de barre supérieure ; « Jeu des mots » et « Points de chaîne » se replient sur plusieurs lignes. Mise à jour, simulation et profil se disputent le même espace. | Dimensions de capture, pas une mesure certifiée du viewport CSS ou du zoom Windows.                            |
| Défis, même fenêtre                  | En-têtes du tableau presque collés ; formulaire en rangées de champs natifs, description rejetée à droite ; condition et dates alignées en une longue ligne.                        | Constat visuel cohérent avec la faiblesse du CSS propre aux Défis.                                             |
| Bandeaux globaux                     | Deux indisponibilités et trois rétablissements affichés simultanément ; début de Défis autour de y=450 dans la capture large.                                                       | Le nombre d’incidents observé est ponctuel. On ne conclut pas à une panne de Production générale.              |
| Fenêtre réduite, capture 1 347 × 894 | Barre supérieure et pastille de contexte rognées horizontalement ; défilement horizontal en bas ; début du contenu Défis autour de y=520.                                           | Redimensionnement constaté pendant la session ; aucun changement de résolution/zoom système réalisé.           |
| Studio/accueil                       | Santé du bot et lecteurs compréhensibles ; données techniques, appairage, lecteurs, journaux et liens de test cohabitent dans une longue page.                                      | Aucun secret ni identifiant d’installation n’est reproduit dans ce dossier.                                    |
| Boutique                             | Catalogue de titres existants dans une table très dense ; grande surface vide à droite ; éditeur et achats plus bas dans le même document.                                          | Aucune modification d’objet, import ou consultation de fiche d’achat. Aucun nom de viewer conservé.            |
| Points de chaîne                     | Récompenses à gauche et détail à droite ; Spotify et autres modules présents plus bas. Texte SAMMI encore visible.                                                                  | Le contenu chargé via l’arbre d’accessibilité a permis de vérifier les sections sans déclencher leurs actions. |
| Alertes                              | Organisation choix/aperçu utile, damier, contrôles temporels, sources et intégrations plus bas ; séparation explicite aperçu local/file réelle.                                     | Aucun aperçu joué, son émis ou événement ajouté à la file.                                                     |

Les captures de Défis et Alertes fournies avec les outputs ne contiennent ni URL de lecteur avec clé ni données nominatives de viewers. Les autres écrans ont été observés sans conservation de captures exposant leurs détails sensibles.

**Non inspectés visuellement :** formulaires en état rempli réel, tiroirs profonds de Modération/Commandes, Lab/Simulation actifs, historiques détaillés, erreurs réseau forcées, progression, rendu complet du kit local du site, séquençage Storyboard. Leur analyse ci-dessous est statique. Aucun test de zoom Windows, lecteur d’écran ou navigation réelle au clavier dans Studio n’a été réalisé. La maquette, elle, fait l’objet de contrôles séparés en Partie D.

## A.3 Problèmes prioritaires et compromis de correction

| Réf. / priorité                          | Problème concret et cause                                                                                                      | Solution proposée / fonctionnement                                                                                                                    | Compromis et preuve                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-01 — critique avant extension de l’UI | Profil Production présenté comme « paiement simulé » ; fallback initial « aucun crédit réel ». Littéraux dans le shell/profil. | Profil effectif dérivé du serveur ; état inconnu explicite ; portée par action. Ne pas activer une action dont le contexte requis n’est pas confirmé. | Un statut inconnu devient visible et peut gêner une action jusqu’au retour du service. Préférable à une fausse assurance. `studio-profile.ts:111`, `main.ts:79, studio-profile.ts:96`. |
| UX-02 — élevée                           | Des fonctions autonomes sont cachées sous un déclencheur : Points de chaîne.                                                   | Destinations canoniques pour Spotify, sanctions et Roue ; la récompense ouvre le panneau partagé de l’action liée.                                    | Réapprentissage du rangement ; conserver noms, alias et liens historiques. `channel-points.ts:56-96`.                                                                                  |
| UX-03 — élevée                           | Quinze onglets sans regroupement ni adaptation globale.                                                                        | Six destinations principales, catalogue de modules lisible, favoris limités et palette commune.                                                       | Une fonction rare passe parfois par un catalogue ; les fréquentes restent en un clic via favoris/régie. `main.ts:61-75`, `style.css:20-54`.                                            |
| UX-04 — élevée                           | Les incidents résolus restent empilés partout jusqu’à Vu.                                                                      | Un résumé global borné et un centre d’incidents ; panne critique prioritaire ; les rétablissements vont dans l’activité avec acquittement conservé.   | Moins de détails immédiatement visibles, mais accès direct au journal. Ne supprimer ni les événements ni le sens de Vu. `supervision-banner.ts:54-86`.                                 |
| UX-05 — élevée                           | Un recomptage Défis ressemble à une action d’actualisation.                                                                    | « Recompter et traiter les récompenses… », explication d’impact, contrôle autorisé et résultat de run. Dry-run clairement distinct.                   | Une étape supplémentaire pour une écriture potentiellement économique. `challenges.ts:394-399`, Core `challenges/service.ts:899-947`.                                                  |
| UX-06 — élevée                           | Défis donne la même importance à un slug, une condition et une date facultative.                                               | Trois sections de tâche, résumé en français, champs techniques repliés, validation locale + serveur.                                                  | Formulaire plus haut, mais lecture et erreurs plus faciles ; pas de wizard bloquant obligatoire. Sources détaillées A.5.                                                               |
| UX-07 — élevée                           | Statut d’objet, publication, offre et achat sont proches visuellement.                                                         | Atelier objet + disponibilité séparée ; publier et ouvrir une offre nommés explicitement ; monnaie attachée à chaque montant.                         | Deux étapes mentales nécessaires, car le backend distingue bien ces objets. A.5.                                                                                                       |
| UX-08 — élevée                           | Les « tests » ont des portées très différentes.                                                                                | « Aperçu ici », « Envoyer vers OBS… », « Tirage à blanc Twitch », « Sanction de test… » avec conséquence visible.                                     | Libellés plus longs ; pas de simple badge global censé tout sécuriser. `random-ban-view.ts:285-286`, `channel-points.ts:228`.                                                          |
| UX-09 — moyenne                          | Tableaux/formulaires et grille héritée d’Halloween ne s’adaptent pas uniformément.                                             | Primitives neutres, grilles selon l’espace disponible, tables contenues, détail en panneau puis pleine page sur petit espace.                         | Plusieurs représentations de la même donnée à tester. `halloween.css:1-47`, `challenges.css:1-13`.                                                                                     |
| UX-10 — moyenne                          | Les clics d’onglets ne reflètent pas la navigation dans l’URL ; le lien Simulation est omis du validateur.                     | Route UI canonique et alias `?tab=` ; précédent/suivant dans l’historique normal.                                                                     | Petit adaptateur de navigation à maintenir ; aucun changement d’API métier. `main.ts:192-221`.                                                                                         |
| UX-11 — moyenne                          | Réglages TTS, lecteur et file sont dispersés entre accueil, Modération et Extension Lab.                                       | Fiche TTS unique ; file accessible en régie et modération par le même composant.                                                                      | Déplacement des habitudes ; ne pas monter plusieurs consommateurs du lecteur.                                                                                                          |
| UX-12 — à clarifier avant lot concerné   | Storyboard non localisé ; plusieurs prototypes hors Git dans l’ancien checkout.                                                | Préserver les artefacts existants ; retrouver son chemin et comparer avant toute migration de cette zone.                                             | Le reste de la refonte peut avancer ; aucune qualité précise du Storyboard n’est affirmée sans preuve.                                                                                 |

Les risques économiques relevés en A.5 doivent être instruits séparément d’un chantier esthétique. Ils ne donnent aucune autorisation de modifier le Core pendant cette étude.

## A.4 Cartographie des fonctionnalités accessibles

Les fiches suivantes viennent du code effectivement monté. Les pistes de regroupement sont consolidées par l’arborescence et la matrice de déplacement de la Partie B, qui font autorité pour la proposition finale.

### Couverture et navigation observées dans le code

`index.html` ne définit qu’un conteneur `#app` et charge `src/main.ts` (`apps/studio/web/index.html:5-12`). Studio est une SPA à onglets, pas un ensemble de routes de page distinctes.

**15 onglets principaux**, chacun avec un bouton et un `<main>` correspondant (`apps/studio/web/src/main.ts:52-96`) :

1. `studio` — Studio / runtime
2. `moderation` — Modération
3. `tombola` — Tombola
4. `commands` — Commandes
5. `word-game` — Jeu des mots
6. `alerts` — Alertes
7. `channel-points` — Points de chaîne
8. `halloween` — Halloween
9. `progression` — Progression
10. `shop` — Boutique
11. `challenges` — Défis
12. `simulation` — Simulation / Lab
13. `test-lab` — Test Lab / services
14. `extension-lab` — Extension Lab / preview
15. `soundboard` — Soundboard config

Tous les écrans ci-dessus sont montés au démarrage depuis `main.ts:97-135` et leurs modules sont activés/masqués par `show()` (`main.ts:137-185`). La sélection est mémorisée dans `localStorage` (`main.ts:186-190`). Les clics changent le panneau sans mettre à jour l’URL (`main.ts:192-195`). Les liens `/?tab=…` du tableau de bord servent de liens de lancement/rechargement, et `?surface=…` affine l’Extension Lab (`studio-home.ts:112-128`, `extension-lab.ts:160-180`).

**Incohérence de deep link :** `simulation` figure dans le type, le menu, le panneau et la restauration `localStorage`, mais manque dans la liste des valeurs `asked` acceptées pour `?tab=…` (`main.ts:26-43`, `main.ts:61-76`, `main.ts:169-171`, `main.ts:207-221`). Un lien direct `/?tab=simulation` retombe donc sur l’onglet mémorisé ou Studio. C’est le seul des 15 identifiants principaux absent du validateur de query string.

**Sous-navigation recensée :** Modération a 5 vues ; Tombola 3 ; Commandes a 6 vues (`lib`, détail, création, historique, droits, catégories), cinq filtres de liste, puis Réglages/Historique dans le détail ; Points de chaîne contient six modules, dont Spotify et la Roue du Sub avec leurs propres sous-onglets ; Extension Lab expose 6 surfaces ; Soundboard a 3 filtres ; Test Lab a 7 filtres de logs. Détails dans les fiches ci-dessous.

### Fiches des zones effectivement montées

Pour chaque zone : emplacement et objectif, actions/informations, dépendances, doublons/parcours, constat UX déduit du code, cible de regroupement et risques explicites.

#### 1. Barre globale et shell

**Emplacement / fonction.** Barre supérieure avec marque, 15 onglets, widget de simulation, widget de mise à jour et pastille d’état/profil (`main.ts:57-80`). Le bandeau incidents est juste sous la barre; les 15 `main` sont sous lui (`main.ts:81-96`). La page ouverte par défaut est Studio, sinon onglet mémorisé puis query string reconnue (`main.ts:198-238`).

**Dépendances / parcours.** Les modules sont importés et montés d’emblée; l’état du menu est conservé localement. L’Extension Lab reçoit les deep links `surface`, `role`, `identity`, `video` (`extension-lab.ts:160-180`). L’onglet courant n’est pas reflété dans l’URL ou l’historique navigateur (`main.ts:192-195`).

**Doublons / constat UX.** Les 15 destinations sont au même niveau, sans regroupement fonctionnel dans le menu. `.topbar` et `.tabs` sont des rangées flex sans règle responsive propre à la barre (`style.css:20-54`); aucun `@media` global ne réorganise ces 15 boutons. Le risque de barre encombrée/écrasée sur une fenêtre étroite est déduit de cette structure CSS, pas vérifié en rendu. Les badges `Core`, `Lab`, emoji et `preview` mélangent provenance, statut et type d’outil dans le même espace.

**Cible.** Six destinations stables et un Laboratoire dédié selon B.2 ; liens profonds cohérents et URL mise à jour lors des changements de vues. Les domaines visuels du catalogue ne sont pas des niveaux de navigation obligatoires.

**Risque.** La pastille d’état dynamique est aussi un message de sécurité sur le profil; voir fiche Studio/Profile ci-dessous.

#### 2. Studio — accueil/runtime

**Emplacement / fonction.** Onglet initial. Cartes : Centre de contrôle, Profil Studio, lecteurs Production (masqués hors profil Production), Runtime local, Connexions, Modules, Dev/Lab, Prototypes, Journal du runtime (`studio-home.ts:85-135`).

- **Runtime local :** liste dynamique des services/statuts/détails et boutons « Réessayer / redémarrer le Core local » et « Relancer le serveur Studio » (ce dernier n’apparaît que si le serveur est injoignable et que le bridge Electron existe). Le premier poste `/api/runtime/restart`; le second appelle le bridge Electron (`studio-home.ts:100-103`, `studio-home.ts:152-169`, `studio-home.ts:208-220`).
- **Connexions :** état OBS, lecteur Soundboard, lecteur TTS, données locales et mode Production, plus l’interface comptes Twitch (`studio-home.ts:105-108`, `studio-home.ts:208-217`, `studio-home.ts:260-270`).
- **Modules :** Hub, Bonk, Soundboard, TTS V2, Tombola V2 (tuile désactivée « Simulation du Lab · migration à venir »), Modération V2 (`studio-home.ts:110-119`).
- **Dev/Lab :** liens Extension Lab Vidéo/Panel/Mobile, Soundboard config, Test Lab et prototypes disponibles seulement si lancé depuis le repo; journal limité à 14 entrées runtime/Lab Core/Postgres/Studio (`studio-home.ts:121-134`, `studio-home.ts:170-181`, `studio-home.ts:276-292`).
- **Lecteurs Production :** trois cartes Bonk, Soundboard et TTS sont créées uniquement en profil Production; elles montrent connexion/URL/état et le lecteur local (`studio-home.ts:183-205`, `sound-lab.ts:4-48`, `tts-lab.ts:53-92`, `bonk-lab.ts:10-33`).

**Dépendances / parcours.** Requêtes au serveur local Studio : profil, runtime, Bonk, Soundboard, TTS et logs Test Lab (`studio-home.ts:191-219`). La page rafraîchit le runtime quand l’onglet Studio est visible, toutes les 2 s (`studio-home.ts:282-303`). Les cartes Production ne sont instanciées qu’après lecture du profil.

**Doublons / constats UX.** C’est un tableau de bord riche, mais il cohabite avec 15 destinations globales et répète les états runtime du Centre de contrôle et les statuts d’incident du bandeau. Le raccourci « Tombola V2 » apparaît indisponible alors qu’un onglet Tombola pleinement monté est présent (`studio-home.ts:117`, `main.ts:63`, `main.ts:103`). Les raccourcis Bonk et TTS V2 ouvrent tous deux la même surface Panel de l’Extension Lab (`studio-home.ts:112-115`), donc pas un emplacement de configuration distinct par module. Les cartes Modules ne couvrent qu’une sélection des onglets principaux. Les Prototypes sont absents de la release, avec explication dans le code UI.

**Cible.** Faire de cette page le cockpit : profil/environnement, incidents/services, lecteurs connectés et raccourcis vers les modules. Relier les tuiles de statut au panneau de gestion concerné; rendre le statut des modules explicite dans le Centre de contrôle. Clarifier la tuile Tombola et les liens Bonk/TTS.

**Risque.** Le redémarrage agit sur les services locaux. Les lecteurs Production indiquent eux-mêmes des paiements réels en Jetons/crédits; voir les contradictions de libellé dans la synthèse des risques.

#### 3. Centre de contrôle

**Emplacement / fonction.** Grande carte en haut de l’accueil (`studio-home.ts:92`, `control-center.ts:69-78`). Une tuile par module depuis `/api/control/status`, avec niveau, état, résumé, faits, conseil et dernière mise à jour. Carte des coupures récentes depuis le démarrage de Studio, limitée à 15 entrées et complétée par un historique dans `supervision-banner.ts` (`control-center.ts:19-67`, `control-center.ts:69-100`, `supervision-banner.ts:89-107`). Rafraîchit toutes les 5 s quand l’accueil est visible.

**Dépendances / parcours.** En lecture seule; le code précise que chaque module se pilote encore depuis son propre onglet (`control-center.ts:3-5`, `control-center.ts:70-78`). Si le serveur est inaccessible, une tuile unique propose de le relancer depuis la carte Runtime local (`control-center.ts:57-67`).

**Doublons / constat UX.** L’état des services apparaît aussi dans Runtime local, Connections, le bandeau incidents et parfois les écrans propres aux modules. Le Centre n’a ni lien contextuel vers l’écran d’action, ni filtre, ni commande; il informe mais oblige à revenir au menu global et à rechercher le module.

**Cible.** Garder les indicateurs et la chronologie dans le Centre de contrôle, mais rendre les tuiles navigables vers l’écran propriétaire; distinguer clairement « santé du service », « incident confirmé » et « action à prendre ».

**Risque.** Faible en lecture seule; le bouton « Vu » du bandeau masque un incident terminé, sans résoudre l’incident.

#### 4. Profil Studio

**Emplacement / fonction.** Carte de l’accueil (`studio-home.ts:93`, montée à `studio-home.ts:140-143`). Affiche version/build, Core cible, chaîne/étiquette, état de connexion et détails, ID d’installation et code d’appairage copiable; actions « Activer le profil Production », « Revenir au profil Lab », « Régénérer l’identité » (`studio-profile.ts:72-80`, `studio-profile.ts:101-138`). Les mutations passent par le bridge Electron, avec confirmation native côté app (commentaire `studio-profile.ts:1-4`).

**Dépendances / parcours.** Le profil « effectif » choisit le Core interrogé par les écrans. Plusieurs modules changent leur copy, leur source ou leur portée avec ce profil. Les URL OBS de lecteurs changent lors d’un changement de profil (copy `studio-profile.ts:123`).

**Doublons / constat UX.** Cette carte est la frontière Lab/Production, mais l’avertissement de profil est également réduit à une pastille de barre. Le statut `selected` et le statut `effective` existent dans le modèle, tandis que l’étiquette de la barre est rendue selon `effective` (`studio-profile.ts:19-20`, `studio-profile.ts:101-112`).

**Cible.** Garder le sélecteur de profil dans le Centre de contrôle, mais l’exposer comme contexte persistant/visible de toutes les vues lorsque le profil modifie la portée.

**Risque / incohérence.** La barre dit en profil Production « paiement simulé » de façon inconditionnelle (`studio-profile.ts:111`), alors que les cartes TTS/Soundboard/Bonk Production disent « paiement réel » (`tts-lab.ts:64`, `sound-lab.ts:12`, `bonk-lab.ts:19`). Le message statique initial dit « Local uniquement · aucun crédit réel » (`main.ts:79`), remplacé ensuite par cette copy dynamique. Ces formulations se contredisent; l’état de paiement devrait suivre l’environnement/les mots de configuration affichés par le profil.

#### 5. Comptes Twitch

**Emplacement / fonction.** Section sous Connexions sur l’accueil (`studio-home.ts:105-108`, montée à `studio-home.ts:144`). Pour chaque rôle configuré : état, Vérifier et, hors Production, Réautoriser Twitch; affiche l’étape de consentement, l’ouverture Twitch, l’annulation d’une autorisation en cours et les erreurs (`twitch-connections.ts:129-139`, `twitch-connections.ts:178-225`, `twitch-connections.ts:232-286`).

**Dépendances / parcours.** Vérifier interroge Twitch; réautorisation peut renouveler l’accès. L’UI précise que ces jetons du PC ne sont pas ceux du bot Production sur VPS, que les rôles/EventSub ne sont pas vérifiés ici et que les emotes viewer se connectent dans l’Extension (`twitch-connections.ts:218`).

**Doublons / constat UX.** Le suivi du bot Production et l’autorisation locale appartiennent à deux lieux différents (Centre de contrôle vs Comptes Twitch), distinction explicitée dans la copy mais non unifiée par un lien direct.

**Cible.** Système > Connexions, avec séparation visible « jetons Studio de ce PC » / « bot Production sur VPS » et navigation vers l’Extension pour emotes.

**Risque.** Même en profil Lab, l’autorisation peut permettre des actions Twitch réelles; l’écran le signale (`twitch-connections.ts:218`). Ne pas assimiler « Lab » à « aucune connexion externe ».

#### 6. Bandeau incidents et mises à jour

**Emplacement / fonction.** Bandeau global monté une fois; incident non résolu, cause/durée et action manuelle/automatique; une fois rétabli, garder l’état jusqu’à « Vu » (`supervision-banner.ts:1-4`, `supervision-banner.ts:54-86`, `supervision-banner.ts:112-139`). Ne montre que les incidents confirmés selon le commentaire source. Widget de mise à jour dans la barre : rechercher, télécharger, redémarrer/installer; caché si le bridge Electron n’existe pas (`main.ts:131-136`, `update.ts:37-109`).

**Dépendances / doublons / cible.** Le bandeau et l’historique du Centre consomment `/api/supervision`; le premier pousse l’incident au-dessus de chaque tab, le second en conserve l’historique. Garder ce partage, et réserver l’historique au Centre. Le contrôle de mise à jour relève du shell/Electron et reste en barre globale.

**Constat UX / risque.** Le bandeau est le seul élément transversal de pilotage hors menu. « Vu » signifie acquitter l’incident terminé, pas l’effacer de l’historique.

#### 7. Modération

**Emplacement / fonction.** Onglet global Core, sous-menu de 5 vues (`moderation.ts:78-95`) : Console D4, Tombola Studio, Supermods, Configuration TTS, Wallet de test Lab.

- **Console D4 :** charge dynamiquement la même console de modération V2 que l’Extension, via `/ext/shared/moderation-v2.js`, et appelle l’API Studio sous le préfixe `/api/lab` (`moderation.ts:58-61`, `moderation.ts:132-181`). Ce préfixe est le nom du relais : le serveur cible le Core du profil effectif (Lab local ou cockpit Production) (`index.ts:790-806`, `production.ts:100-114`).
- **Tombola Studio :** inscription gratuite, cagnotte offerte, état/participants, ouvrir, fermer sans tirage, tirer et voir dernier résultat (`moderation.ts:192-221`).
- **Supermods :** liste de l’équipe, nommer/retirer supermod; permissions fines dans le tiroir « Équipe & permissions » D4 (`moderation.ts:224-243`).
- **Configuration TTS :** paliers de prix/longueur/crédits/cooldown, limites de texte et de file, sauvegarder/réinitialiser (`moderation.ts:271-295`).
- **Wallet de test :** viewer, ajuster Jetons/crédits, set/reset et effacer cooldown TTS (`moderation.ts:337-354`).

**Dépendances / doublons / parcours.** Modération renvoie à la console D4 de l’Extension, mais ajoute des outils Studio. Le TTS est aussi affiché sur Accueil/Extension Lab et le Wallet de test est aussi présenté dans le texte de l’Extension Lab Production comme « Jetons de test » (`extension-lab.ts:653-660`). La Tombola Studio ici est distincte de l’onglet Tombola V2 et de la simulation d’inscription Extension Lab.

**Constat UX.** Sous-navigation de second niveau dans un onglet déjà dédié, puis tiroirs/outils internes D4. Les fonctions se répartissent par capacité et profil, sans lien global direct entre le réglage TTS, la file/lecteur et l’état de module. La copy fixe « Core local » du bandeau D4 (`moderation.ts:78-95`) peut induire en erreur quand le profil effectif est Production.

**Cible.** Regrouper le pilotage de Modération et ses outils de gestion ici; relier la console D4 à la même page Extension ou afficher une provenance clairement visible. Faire apparaître « Tombola Studio (modération D4) » distinctement de « Tombola V2 ».

**Risque.** Le sous-écran « Wallet de test » est un outil Lab fictif; il ne faut pas étendre cette portée au D4 complet : en profil Production, la même console passe par le cockpit appairé et ses ajustements de Wallet ciblent le Core Production (`index.ts:790-806`, `production.ts:100-114`, `studio-cockpit-routes.ts:3-10`). TTS config modifie le Core à l’enregistrement (`moderation.ts:271`). La console peut exécuter les actions Twitch prévues au rôle si le profil/jeton le permet; les permissions sont éditées via D4.

#### 8. Tombola V2

**Emplacement / fonction.** Onglet global, sous-menu « Préparer & lancer », « En direct », « Historique » (`tombola.ts:287-318`). La source d’état est le Core via relais Studio; le chat/simulateur partagé est dans Simulation (`tombola.ts:11-16`).

- **Préparer :** configurer monnaie/récompense (Jetons ou lot, monnaies disponibles), montant fixe/aléatoire et tranches, durée, gagnants, entrée par chat/Extension, commande d’annulation, texte et style/durée overlay, mode Full oseille, Super Tombola, planification automatique liée au stream, sons d’ouverture, commandes et alias (`tombola.ts:448-481`, `tombola.ts:493-519`, `tombola.ts:652-674`, `tombola.ts:774-881`).
- **En direct :** état du timer/résultat, pause/reprise, +30 s, tirage immédiat, annulation avec confirmation, participants chat/Extension/manuels, recherche et ajout/retrait manuel, paiements/réessai, aperçu de la vraie page overlay et comparaison Extension (`tombola.ts:994-1088`).
- **Historique :** table des manches, fiche détaillée participants, gagnants/paiements et audit (`tombola.ts:1095-1172`).

**Dépendances / parcours.** `/api/raffle/*`, Core comme source, Extension, overlay OBS, chat d’entrée Lab et monnaies configurées. Certaines actions sont aussi disponibles dans Modération (open/close/draw) et dans l’Extension Lab pour le scénario local.

**Constat UX / doublons.** Forte densité d’options dans Préparer; puis une autre barre de sous-navigation dans l’écran. La fonction Tombola existe à au moins trois niveaux différents : onglet V2, vue Tombola de Modération, simulation Lab Extension. L’accueil affiche en outre une tuile V2 désactivée. La terminologie seule ne distingue pas immédiatement leurs profils et objectifs.

**Cible.** Canoniser l’onglet Tombola comme console de configuration/live/historique; exposer dans Modération une entrée clairement « actions modération D4 » et dans Extension Lab un panneau « scénario fictif ». Retirer l’état « migration à venir » si la destination est déjà active.

**Risque.** Le résultat peut être payé automatiquement par le Core et l’écran propose relancer un paiement échoué (`tombola.ts:1079-1084`); portée liée au Core effectif. Les actions launch/draw/extend/pause/cancel sont opérationnelles, pas une simple preview.

#### 9. Commandes V2

**Emplacement / fonction.** Onglet Commandes (`commands.ts:256`). Interface interne à sidebar : Toutes, Favoris, À vérifier, Désactivées, Cachées; réglages Catégories, Historique, Droits de l’équipe; état sortie chat réelle/ingestion/exécuteur (`commands.ts:518-540`). Recherche, filtre, groupement, tri, favoris, création, édition, suppression (`commands.ts:499-516`).

- **Détail/réglages :** alias, noms/description, apparence, activation/visibilité, rôle autorisé, réponses, destinataire, cooldown, quotas, actions en messages séparés, arguments, options avancées et droits d’équipe (`commands.ts:600-806`, `commands.ts:836-930`).
- **Historique** des invocations/refus et modifications (`commands.ts:912-912`, `commands.ts:985-1000`); **Catégories** (`commands.ts:1001-1020`); **Droits équipe** (`commands.ts:1025-1050`); **Test commande** en tiroir avec viewer/rôle/badges fictifs et aperçu (`commands.ts:1080-1134`).

**Dépendances / parcours.** Core propriétaire des règles/décisions/historique; sortie chat réelle indiquée dans sidebar. Commandes réservées par modules listées en bas du catalogue. Les actions de chat sont aussi testables dans Simulation, avec identities/roles.

**Constat UX.** L’écran concentre au moins trois profondeurs de navigation (menu global → sidebar catégorie/vue → détails avec tabs/tiroir). La séparation « création simple » / paramètres avancés est expliquée dans le formulaire de création, utile, mais les statuts réels d’exécution restent dans la sidebar de ce module.

**Cible.** Conserver Commandes comme espace cohérent avec liste, édition, historiques/droits; depuis le Centre de contrôle et Simulation, lier vers la commande/problème plutôt que dupliquer les actions.

**Risque.** Le code affiche si la sortie chat réelle est ON; le bouton Tester utilise la version enregistrée, même si le brouillon est modifié (`commands.ts:806`, `commands.ts:1134`).

#### 10. Jeu des mots

**Emplacement / fonction.** Onglet simple : état, arrêter/reprendre, demander un nouveau mot, mots actifs, afficher/masquer localement une réponse, série/dernières trouvailles, URL de son OBS, volume (`word-game.ts:13-148`, `word-game-view.ts:71-125`).

**Dépendances / doublons / parcours.** État et actions via routes du Core; Simulation peut envoyer des commandes de chat au jeu. Les réponses révélées sont locales en mémoire et se remasquent en quittant/rechargeant l’onglet (`word-game.ts:6-8`, `word-game.ts:132-141`).

**Constat UX / cible.** Peu de navigation; les commandes de test sont ailleurs dans Simulation. Garder dans Modules > Jeux, avec action « tester dans Simulation » ou lien de contexte. Donne une vue de statut et d’exploitation, pas un éditeur des règles du jeu.

**Risque.** `Nouveau mot` est action Core; volume enregistré immédiatement lors du changement de curseur (`word-game.ts:46-77`).

#### 11. Alertes

**Emplacement / fonction.** Onglet Alertes; éditeur de prévisualisation, données fictives, famille/variante, lancer/rejouer/arrêter, volume, timeline/scrub frame, calibrage, test dans file, file réelle, URL OBS, état média, événements Twitch, variantes par famille, dons StreamElements, Dock OBS (`alerts-tab.ts:33-111`).

**Dépendances / parcours.** Calibrage par variante enregistré via API placement; mode Twitch, jeton StreamElements, variantes, Dock OBS et média sont des sous-composants montés dans cet onglet (`alerts-tab.ts:121-127`, `alerts-calibrate.ts:42-80`, `alerts-twitch.ts:134-192`, `alerts-se.ts:126-210`, `alerts-variants.ts:114-146`, `dock-panel.ts:52-94`). La prévisualisation locale est distincte du test dans la file (`alerts-tab.ts:67-83`, `alerts-tab.ts:343-365`).

**Constat UX / doublons.** Une page mêle réglage visuel, preview, calibration, intégration Twitch/StreamElements, sources OBS et exploitation de file. Certains éléments sont un panneau secondaire masqué plus bas plutôt qu’une destination distincte. Le niveau et la conséquence d’un bouton « Envoyer dans la file réelle » sont éloignés de la preview fictive.

**Cible.** Garder Alertes sous Modules, mais séparer clairement « Créer / prévisualiser » de « Production : sources, file, Twitch/StreamElements », et faire ressortir la frontière entre données fictives et vraie file.

**Risque.** La file est explicitement réelle; l’écran est compatible Core Production et le mode Twitch réel apparaît dans l’onglet (`alerts-tab.ts:80-106`, `alerts-tab.ts:219-220`). Les jetons SE sont saisis dans le module, pas dans Connexions Twitch.

#### 12. Points de chaîne

**Emplacement / fonction.** Un grand onglet avec switch global, état, règles de récompense Twitch/actions et historique, puis cinq sous-modules : Musique/Spotify, Random Ban, Caution, Votekick, Roue du Sub (`channel-points.ts:56-96`). Les règles décrivent jusqu’à cinq actions (effets OBS, sons/vidéos, interaction, crédits), enregistrer et tester (`channel-points.ts:149-236`). Le test exécute la règle enregistrée « pour de vrai (OBS / Soundboard) ».

**Sous-modules enfouis.**

- **Spotify :** File musicale, Viewers, Réglages, Récompense Twitch, Connexion et diagnostic, Simulateur Lab conditionnel; gestion de la file, skip, réclamation/remboursement/retirer une demande (`spotify.ts:32-309`, `spotify-view.ts:60-188`).
- **Random Ban :** état, règles, historiques et traçabilité, essais d’animation, tirage à blanc Twitch, test de caution et test mute streamer (`random-ban-view.ts:245-289`).
- **Caution :** état de l’exécuteur, lecture/levée Twitch, Jetons débité/remboursé/à vérifier, derniers cas. Actions du payeur se passent en chat (`caution-view.ts:1-5`, `caution-view.ts:79-137`).
- **Votekick :** durée/activation/son/import/volume/écoute/enregistrer (`votekick-config-view.ts:102-127`).
- **Roue du Sub :** En attente, Droits, À vérifier, Historique, Réglages, onglet Simulateur Lab conditionnel; gérer droits/tours, rattraper, vérifier doublons/récupérations, rejouer/valider animations, règle/mode/invitations/annonce et scénarios Lab (`sub-wheel-view.ts:583-620`, `sub-wheel-rights-view.ts:66-162`, `sub-wheel.ts:208-371`).

**Dépendances / parcours.** Points Twitch, OBS, Soundboard, lecteur d’effets, Spotify, exécuteur Twitch et modes Lab/Production. Roue activée signifie que les vrais subs/resubs/Prime déclenchent le mécanisme; le code affiche un confirm avant activation (`sub-wheel.ts:218`). Spotify et Roue ont leurs propres tabs imbriqués dans une page déjà très longue.

**Constat UX / doublons.** Six fonctions opérationnelles de nature différente sont regroupées dans un seul document vertical; le menu global ne révèle pas Random Ban/Caution/Votekick/Spotify/Sub-wheel. Spotify a aussi son Simulateur, Sub-wheel le sien; un autre simulateur partagé est dans Simulation. Le chemin vers un effet peut être Points de chaîne > Règle > action, ou aller directement dans sous-module.

**Cible.** Dans Modules, afficher Points de chaîne comme une page d’ensemble des récompenses et extraire des sous-onglets/tuiles de premier niveau pour automatisations, musique, sanctions, Votekick et Roue du Sub. Lier de chaque récompense au sous-module concerné.

**Risque élevé.** Le bouton « Tester » lance la règle enregistrée réellement sur OBS/Soundboard (`channel-points.ts:228`). À l’activation, l’écran répète un avertissement disant que SAMMI exécute encore certaines récompenses Production et qu’une double exécution est possible (`channel-points.ts:77`, `channel-points.ts:323`); cette copy est obsolète au regard de `CLAUDE.md:20` (SAMMI abandonné, ne pas réactiver), et ne prouve aucune exécution actuelle ni double exécution constatée. Random Ban a des commandes réellement externes : son bouton « Test Caution Random Ban » explique qu’il impose une sanction de 60 s et débite vraiment les Jetons; le test mute coupe vraiment le micro OBS 60 s (`random-ban-view.ts:285-286`). La Caution est un workflow de levée de sanction Twitch, avec des statuts de débit à vérifier; la vue présente bien ce risque (`caution-view.ts:67-75`, `caution-view.ts:108-137`).

### Inventaire transversal : mini-jeux, duels et effets

#### Roulette / Slots / Duels

- **Emplacement visible :** uniquement Simulation (widget global de la topbar et page `Simulation`). Le widget expose un switch commun « Mini-jeux Roulette / Slot », états ON/OFF/indisponible et l’avertissement StreamElements; il indique que `!roulette` et `!slots` répondent (`simulation-view.ts:170-180`). La confirmation de sortie réelle cite aussi `!roulette`/`!slots` et rappelle StreamElements (`simulation-view.ts:196-203`). Le switch appelle `/api/mini-games/settings`, tandis que le chat partagé est `/api/lab-chat/*` (`simulation.ts:34-67`).
- **Parcours de test :** la page Simulation propose un chat avec identité/rôle, texte, envoyer; placeholder `!roulette 100`, `!mots`, `!join…` (`simulation-tab.ts:48-59`). Les messages/réponses et événements de modules apparaissent dans une timeline commune; le modèle reconnaît `mini_game_played` et les origines `mini_game` (`sim-chat-view.ts:1-5`, `sim-chat-view.ts:56-78`). Le switch de jeu est le seul réglage Studio trouvé; pas de page individuelle Roulette/Slots ni de paramètres spécifiques visibles dans `apps/studio/web/src`.
- **Duels :** pas d’onglet ou de panneau dédié. Le duel est essayé comme commande chat `!duel @lab_modo` dans l’identité simulée; le rendu comprend « défi lancé », « duel joué », « défi refusé », « défi annulé »/« refusé » (`simulation-tab.ts:163-169`, `sim-chat-view.ts:60-78`). Le simulator met aussi le login du viewer test dans le message, nécessaire au ciblage (`simulation-tab.ts:156-174`). Pas d’écran Studio de réglage ou de gestion Duel trouvé; emplacement actuel = message/chat de Simulation et état de timeline.
- **Doublon/UX/risque :** le même groupe de quatre switchs apparaît dans widget global et page entière; Roulette/Slots n’ont pas de route propre. Le placeholder ne suggère ni `!slots` ni `!duel` alors que le code prend en charge ces chemins. Ingestion peut recevoir les vrais messages Twitch dans la même timeline que les messages simulés, avec source distincte par message (`simulation-view.ts:134-149`, `sim-chat-view.ts:142-157`). Si sortie réelle ON, Commandes, Jeu des mots et mini-jeux peuvent écrire dans le vrai chat. La confirmation recommande StreamElements et mentionne aussi SAMMI; cette dernière mention est historique/obsolète au regard de `CLAUDE.md:20`, sans preuve d’une exécution SAMMI actuelle (`simulation-view.ts:196-203`).
- **Cible :** Laboratoire > Simulation pour toutes les sessions chat; un sous-panneau Jeux avec state/activation et une aide de commandes comprenant Roulette, Slots et Duel. Conserver le widget comme résumé et raccourci, pas comme second écran de réglage.

#### Effets OBS / lecteur d’effets

- **Configuration des récompenses :** Points de chaîne peut combiner jusqu’à cinq actions : son Soundboard, son/vidéo d’effet, source/filtre/scène OBS, crédit TTS/Soundboard ou interaction native (`channel-points.ts:23-40`, `channel-points.ts:149-210`). Les interactions fixes proposées sont Creepy, BRB, FX Cam, Couleur Cam, Random Ban, demande Spotify et skip Spotify (`channel-points-view.ts:21-91`). Les descriptions expliquent prérequis de scène, durées, filtres/sons et règles; ce ne sont pas des éditeurs d’effets, elles apparaissent lors du choix d’une action (`channel-points.ts:195-202`).
- **Lecteur d’effets :** section repliable « Lecteur d’effets (source OBS) » sous l’état Points de chaîne. Affiche une URL de source navigateur plein cadre 1920×1080 et le nombre de médias importés/absents; le header annonce lecteur absent/muet/obsolète/prêt et nombre de lecture en cours (`channel-points-view.ts:253-295`, `channel-points-view.ts:317-327`). Cette carte ne fournit pas d’action d’import; les médias s’affichent « à importer », sans bouton/import workflow dans cette vue.
- **Autres usages répartis :** animation/test Random Ban dans Points de chaîne; source de son Votekick; sons Tombola par classe normale/super/giveaway; effets d’Halloween (overlay, chaos, ambiance, médias testables); scènes Bonk; jeux d’animations/son de la Roue du Sub (`random-ban-view.ts:282-286`, `votekick-config-view.ts:102-127`, `tombola.ts:506-519`, `halloween.ts:333-348`, `halloween-chaos.ts:118-130`, `sub-wheel-view.ts:462-504`). Les cartes ne sont pas réunies dans une bibliothèque d’effets Studio.
- **Doublons/constat UX.** « Effets » désigne à la fois le lecteur navigateur OBS global, médias audio/vidéo, effets temporaires OBS (scène/source/filtre), interactions natives, et Soundboard. L’état et le setup sont imbriqués dans Points de chaîne, mais le lecteur sert aussi Votekick, Random Ban, Roue et autres scénarios. À l’inverse, les médias et tests s’administrent depuis chaque module. Le nom seul ne révèle pas la différence lecteur/banque/interaction.
- **Cible.** Modules > Points de chaîne pour l’association récompense→action; une fiche/carte commune d’état lecteur OBS et lien vers les médias utilisés, puis chaque module propriétaire garde ses règles métier et son test. Faire apparaître la source, l’état prêt, les médias manquants et les conséquences de lecture avant un essai réel.

### Fiches complémentaires et matrice de couverture

#### 13. Halloween

1. **Zone :** Halloween, tab principal `halloween`.
2. **Emplacement :** carte longue, multi-colonnes, avec STOP ALL et sections Overlay sur mon écran, Chaos, Ambiance OBS, Alertes Twitch, Boutique, Catalogue, Trouver un viewer, Bonbons (`halloween.ts:464-489`).
3. **Objectif :** exploiter l’événement Halloween, ses effets stream et son économie de Bonbons.
4. **Actions :** activer l’overlay, écran/volume/mode sûr, tester effets et médias, éditer règles/audience tous ou testeurs, gérer la boutique/catalogue, chercher un viewer, lui créditer des Bonbons, consulter achats et mouvements (`halloween.ts:333-388`, `halloween.ts:420-485`, `halloween-viewer.ts:83-120`).
5. **Informations :** disponibilité média, état OBS/chaos, alertes événement, achats, ledger viewer; cartes enfants chaos/ambiance/alertes/viewer (`halloween.ts:12-24`, `halloween.ts:764`, `halloween-chaos.ts:78-130`, `halloween-ambiance.ts:42-56`, `halloween-alerts.ts:101-104`).
6. **Dépendances :** OBS, médias installés, alertes Twitch, Core et wallet Bonbons.
7. **Parcours :** entrée par le menu global; tests et configuration sont dans le même tab, crédits et recherches plus bas dans la page.
8. **Doublons :** la Boutique Halloween est différente de Boutique (titres/badges/cadres/bannières); les alertes et effets ont aussi leur tab/famille hors événement.
9. **Problème UX déduit :** plusieurs domaines et portées (streamer, viewers, Twitch, économie) cohabitent dans une vue scroll; le libellé/tooltip STOP ALL (« arrête immédiatement tout effet ») peut sembler global à Studio alors que l’action est limitée à Halloween; la portée d’un « Tester » doit rester visible au contexte de chaque carte (`halloween.ts:477`, `runtime.ts:545-563`).
10. **Regroupement cible :** Modules > Événements > Halloween, en sous-vues Effets OBS / Alertes / Boutique & viewer.
11. **Risque :** STOP ALL arrête le traitement des effets Halloween en cours, coupe le chaos OBS et demande au Core d’arrêter les éléments Halloween encore en attente, avec remboursement de ceux-ci; ce n’est pas un arrêt universel de Studio (`halloween.ts:602-603`, `runtime.ts:545-563`). Actions OBS et soldes sont opérationnels; conserver les messages testeurs/public près de leurs actions.
12. **Montage :** réellement monté depuis `main.ts:114-116`; sous-modules appelés depuis `halloween.ts:12-24`, `halloween.ts:764`.

#### 14. Progression

1. **Zone :** Progression, tab principal `progression`.
2. **Emplacement :** panneau long; activation/règles, Titres et badges, Un viewer, Reprise de WizeBot, Historiques en attente (`progression.ts:208-279`).
3. **Objectif :** régler progression XP et récompenses, administrer un viewer et importer l’ancien historique.
4. **Actions :** activer/désactiver, enregistrer règles, créer/mettre à jour titre ou badge, recherche viewer, attribuer/retirer un objet, modifier XP avec motif, importer/annuler import et rattacher les lignes WizeBot (`progression.ts:210-279`, actions `progression.ts:328-451`).
5. **Informations :** niveau/XP/viewer, inventaire/journal, lignes import en attente, résultats de simulation/import.
6. **Dépendances :** Core du profil effectif, récompenses Boutique, données d’historique WizeBot.
7. **Parcours :** onglet global direct; outils migration et opérations quotidiennes sont dans la même page.
8. **Doublons :** récompenses liées à Boutique et Défis; progression saisie manuelle peut chevaucher le suivi d’événement.
9. **Problème UX déduit :** migration ponctuelle, édition des règles, gestion individuelle et import/reprise sont mêlés; nombreux boutons d’écriture dispersés.
10. **Regroupement cible :** Communauté > Progression, sous-vues Règles / Récompenses / Viewers / Import historique.
11. **Risque :** mutations Core (XP, droits, récompenses, import/revert); profil effectif détermine la cible.
12. **Montage :** réellement monté dans `main.ts:117-119`; composant `progression.ts:129-155`.

#### 15. Boutique (renvoi à l’analyse dédiée)

1. **Zone :** Boutique, tab principal `shop`.
2. **Emplacement :** écran catalogue/édition, ventes, achats, don viewer (`cosmetics.ts:200-221`, `cosmetics.ts:298-427`).
3. **Objectif :** gérer l’offre globale d’objets cosmétiques et les opérations associées.
4. **Actions :** créer/modifier/dupliquer, configurer prix/offres/visibilité, consulter achats/rembourser, donner à un viewer.
5. **Informations :** catalogue, type/état/offres/owners et achats récents.
6. **Dépendances :** Core effectif, monnaies Jetons/Bonbons, médias images; consommée par Défis/Progression.
7. **Parcours :** entrée directe du menu global; détails en A.5.
8. **Doublons :** Boutique Halloween et certaines distributions de Progression sont des espaces distincts.
9. **Problème UX déduit :** à distinguer explicitement de la Boutique Halloween et d’un magasin de sons.
10. **Regroupement cible :** Communauté > Boutique, liens contextuels depuis Défis/Progression.
11. **Risque :** ventes, remboursements et dons écrivent au Core effectif.
12. **Montage :** `mountCosmetics` branché dans `main.ts:120`; détails en A.5.

#### 16. Défis (renvoi à l’analyse dédiée)

1. **Zone :** Défis, tab principal `challenges`.
2. **Emplacement :** liste, éditeur, prévisualisation, suivi et journal (`challenges.ts:244-368`).
3. **Objectif :** créer des objectifs suivis par le Core, et distribuer une récompense par viewer/période.
4. **Actions :** créer/modifier, vérifier/prévisualiser, activer/suspendre/reprendre/archiver, recompter, ouvrir suivi et révoquer une récompense (`challenges.ts:254-368`).
5. **Informations :** métriques disponibles, périodes, participants/progressions, états de récompense et erreurs.
6. **Dépendances :** données des modules, moteur du Core, objets Boutique ou Jetons (`challenges.ts:254-321`).
7. **Parcours :** menu global; création et suivi accessibles dans le même panneau.
8. **Doublons :** récompenses créées dans Boutique; règles globales de Progression séparées.
9. **Problème UX déduit :** suivi est intégré sous l’éditeur/liste; état moteur/migration peut rendre l’écran indisponible (`challenges.ts:244`).
10. **Regroupement cible :** Communauté > Défis, avec lien vers objet Boutique et suivi.
11. **Risque :** activer, recompter ou révoquer peut écrire des récompenses dans le Core effectif.
12. **Montage :** `mountChallenges` branché dans `main.ts:121-123`; détails en A.5.

#### 17. Simulation — panneau et page

1. **Zone :** `simulation`, à la fois le widget fixe de barre et l’onglet Simulation (`main.ts:135` pour le widget, `main.ts:124-126` pour la page).
2. **Emplacement :** widget compact global; page avec contrôles, journaux ingestion et chat partagé (`simulation.ts:121-186`, `simulation-tab.ts:32-95`).
3. **Objectif :** gérer la session live, l’ingestion Twitch, la sortie de messages et le switch mini-jeux; tester les routes chat communes.
4. **Actions :** live simulé début/fin, ingestion on/off, sortie réelle on/off, jeux Roulette/Slots on/off; choisir identité/rôle, envoyer un message, vider seulement l’affichage local (`simulation.ts:34-67`, `simulation-tab.ts:48-95`, `simulation-tab.ts:140-195`).
5. **Informations :** état Live/Chat/Sortie/Jeux, envoi réel ou simulé, provenance message Twitch/simulateur, résultat module, texte Core et statut d’envoi (`simulation-view.ts:43-203`, `sim-chat-view.ts:1-5`, `sim-chat-view.ts:142-190`).
6. **Dépendances :** session raffle, Lab chat, exécuteur LeCroupier_, mini-games API; le mode Production peut rendre plusieurs états indisponibles (`simulation.ts:61-82`, `simulation-view.ts:106-180`).
7. **Parcours :** panneau rapide depuis chaque tab ou page avec chat détaillé; la page est le point de test pour Roulette/Slots/Duels/Commandes/Jeu des mots.
8. **Doublons :** les quatre switches existent dans les deux surfaces, synchronisées via event (`simulation.ts:78-111`, `simulation-tab.ts:180-194`).
9. **Problème UX déduit :** le placeholder montre `!roulette`, `!mots`, `!join`, mais pas `!slots` ni `!duel`; l’ingestion réelle et les messages simulés partagent le chat, source marquée seulement au niveau ligne. `?tab=simulation` n’est pas reconnu (cf. diagnostic shell).
10. **Regroupement cible :** Laboratoire > Simulation; widget global en résumé + lien vers le chat détaillé.
11. **Risque :** sortie active = réponses dans le vrai chat Twitch; confirmations nécessaires, notamment lors d’activation ingestion/jeux quand sortie active (`simulation-view.ts:196-203`). La copy recommande couper StreamElements; sa mention de SAMMI est héritée/obsolète selon les règles du projet, et ne constitue pas une dépendance active.
12. **Montage :** le widget et la page sont tous deux montés dans `main.ts:133-135`; la page est explicitement branchée dans `main.ts:124-126`.

#### 18. Test Lab

1. **Zone :** `test-lab`, onglet principal et lien Dev/Lab de l’accueil (`main.ts:73`, `studio-home.ts:121-128`).
2. **Emplacement :** panneau services suivi d’un panneau Logs.
3. **Objectif :** démarrer/arrêter et diagnostiquer l’environnement local de test, y compris Postgres/Core/bot.
4. **Actions :** Start All/Stop All, Start/Stop Postgres, Start/Stop/Restart Core et Bot, Twitch preflight, effacer logs; filtres all/core/bot/presence/preflight/studio/errors (`test-lab.ts:123-232`, `test-lab.ts:251-306`).
5. **Informations :** Postgres, état/health Core, compte/scopes/preflight Twitch, bot/flags, Loyalty sans crédits, état/rapport Presence Shadow et logs (`test-lab.ts:136-231`).
6. **Dépendances :** API test-lab Studio et processus locaux; preflight/Twitch Auth interroge Twitch. L’en-tête dit NO WALLET/NO CREDITS/SHADOW MODE/no chat messages (`test-lab.ts:123`).
7. **Parcours :** entrée menu global ou Accueil > Dev/Lab; rapports complets/CSV restent indiqués comme commandes CLI (`test-lab.ts:174-185`, `test-lab.ts:215-216`).
8. **Doublons :** lecture de l’état Core et logs recoupe Accueil/Runtime/Centre de contrôle; suivi de bot Production est ailleurs.
9. **Problème UX déduit :** plusieurs boutons sont en anglais au milieu d’une UI française; le rafraîchissement continue dès que la fenêtre est visible, même si l’onglet est masqué; rapports non accessibles depuis l’interface.
10. **Regroupement cible :** Laboratoire > Services de test, avec statut profil/environnement en tête.
11. **Risque :** contrôle de processus et Postgres locaux; preflight est un appel Twitch. Ne pas confondre ce panneau Test Lab dédié avec toutes les pages dont le nom contient `Lab`.
12. **Montage :** monté directement depuis `main.ts:99`; polling dans `test-lab.ts:229-315`.

#### 19. Extension Lab et cartes Bonk/TTS/Soundboard

1. **Zone :** `extension-lab`, page d’aperçu Twitch; cartes TTS/Bonk/Soundboard au volet scène en Lab et à l’accueil pour les lecteurs Production.
2. **Emplacement :** écran trois volets; choix à gauche, iframe au centre, scène locale/état/journal à droite (`extension-lab.ts:160-225`, `extension-lab.css:9-17`).
3. **Objectif :** tester l’Extension dans différents contextes réalistes et contrôler le rendu local des actions.
4. **Actions :** choisir 6 surfaces — Panel viewer, Moderator Window, Mobile viewer, Video component, Config, Live config (`extension-lab.ts:59-124`, `extension-lab.ts:247-277`); choisir Viewer/Modérateur/Broadcaster, partager identité, régler viewport/phone, recharger/ouverture page seule; wallet fictif par rôle, activer/désactiver TTS/Soundboard/Bonk/Tombola, ouvrir/tirer/fermer la Tombola, couper/activer son, réinitialiser le lab (`extension-lab.ts:247-277`, `extension-lab.ts:400-455`, `extension-lab.ts:469-633`).
5. **Informations :** iframe URL/surface/taille/rôle; effets et événements (son, TTS, Bonk, inscription Tombola, refus), file/état, journal; événements affichés localement (`extension-lab.ts:385-455`, `extension-lab.ts:469-550`).
6. **Dépendances :** pages Extension `/ext/`, Lab EBS local et services Studio; le code marque « jetons fictifs, aucun appel prod » (`extension-lab.ts:1-15`, `extension-lab.ts:385-391`). Profil effectif reste un concept séparé: le message explicite masque la preview en Production et indique d’autres écrans de réglage (`extension-lab.ts:653-680`).
7. **Parcours :** accueil donne liens vers Vidéo/Panel/Mobile seulement; les surfaces Config/Live config exigent d’ouvrir Lab puis de les sélectionner (`studio-home.ts:112-128`, `extension-lab.ts:59-124`).
8. **Doublons :** cartes Bonk/TTS/Soundboard existent aussi à Accueil en Production; Soundboard config et Modération TTS sont ailleurs. Bonk/TTS Home links sont tous deux la même surface Panel.
9. **Problème UX déduit :** le volet de scène combine l’Extension simulée, un lecteur local et contrôles du scénario; distinction visuelle/portée à maintenir. À 1180px CSS passe à deux colonnes puis scène sous les autres; en dessous, pas de breakpoint explicitement recensé (`extension-lab.css:507-513`).
10. **Regroupement cible :** Laboratoire > Extension, avec liens distincts pour six surfaces; lecteurs Production restent sous Système > Lecteurs.
11. **Risque :** Extension Lab est local et fictif, mais ne pas appliquer cette isolation par analogie au reste de Studio. Bonk Lab permet connexion OBS et prévisualisations; en carte Production, le code avertit que le Bonk peut être visible si sa source est dans la scène diffusée (`bonk-lab.ts:19-33`). TTS Production dit paiement réel et renvoie pause/stop/file vers Modération (`tts-lab.ts:53-84`). Soundboard Production dit paiement réel (`sound-lab.ts:4-48`).
12. **Montage :** page montée dans `main.ts:127-129`; Studio Home crée les cartes Production dans `studio-home.ts:183-205`; trois cartes Lab sont montées par `extension-lab.ts:229-233`.

#### 20. Soundboard config et lecteur

1. **Zone :** tab `soundboard`, plus lecteurs Lab/Production dans Extension Lab et Accueil.
2. **Emplacement :** liste compacte avec en-tête/résumé, filtre, trois filtres Tous/Actifs/Désactivés et lignes dépliables (`sound-config.ts:81-124`, `sound-config.ts:221-227`).
3. **Objectif :** régler la banque de sons Core et la lecture des achats.
4. **Actions :** préécouter/stop, activer, modifier nom, prix Jetons/crédits, cooldown, stratégie superposer/file/ignorer, volume, protection volume (`sound-config.ts:176-227`).
5. **Informations :** sons actifs, identifiant, variantes/durée, prix/cooldown/mode/volume, état de sauvegarde par ligne.
6. **Dépendances :** `/api/sound-lab/*`, Core et lecteur local; mises à jour propagées aux iframes Extension Lab (`sound-config.ts:1-5`, `sound-config.ts:125-129`). Le player Soundboard est ailleurs: historique/lecteur local en Lab et carte Production sur Studio Home (`sound-lab.ts:4-48`).
7. **Parcours :** l’entrée principale est l’onglet; le lecteur n’est pas ici. En Production, l’Extension Lab explique que la config reste dans cet onglet (`extension-lab.ts:653-660`).
8. **Doublons :** banque et lecteur se séparent; Lab player, Production player et config apparaissent en trois zones. Les sons d’effet dans Points de chaîne sont une autre banque/lecteur.
9. **Problème UX déduit :** chaque modification est appliquée immédiatement; note fixe « Lab · aucun débit réel » reste affichée dans le composant même si la config est indiquée comme écran de réglage Production (`sound-config.ts:108`). La copy contredit la documentation des lecteurs Production.
10. **Regroupement cible :** Modules > Soundboard avec réglages + état/lecteur comme sous-vues, étiquette de portée selon profil effectif.
11. **Risque :** prix/activation s’appliquent immédiatement; cartes Production décrivent paiement réel au Wallet Core (`sound-config.ts:108`, `sound-config.ts:125`, `sound-lab.ts:12`).
12. **Montage :** config montée dans `main.ts:130-132`; player Lab via Extension Lab et player Production via Studio Home.

#### 21. Matrice formelle des 15 onglets principaux

|   # | `data-tab` / label global           | Preuve de montage (`main.ts`)   | Fiche(s) de ce rapport                                      | Couverture       |
| --: | ----------------------------------- | ------------------------------- | ----------------------------------------------------------- | ---------------- |
|   1 | `studio` — Studio/runtime           | `main.ts:61`, `main.ts:98`      | 2 Accueil, 3 Centre, 4 Profil, 5 Twitch, 6 incidents/update | Oui              |
|   2 | `moderation` — Modération           | `main.ts:62`, `main.ts:100-102` | 7 Modération / console D4 / outils                          | Oui              |
|   3 | `tombola` — Tombola                 | `main.ts:63`, `main.ts:103`     | 8 Tombola V2                                                | Oui              |
|   4 | `commands` — Commandes              | `main.ts:64`, `main.ts:104-106` | 9 Commandes V2                                              | Oui              |
|   5 | `word-game` — Jeu des mots          | `main.ts:65`, `main.ts:107-109` | 10 Jeu des mots                                             | Oui              |
|   6 | `alerts` — Alertes                  | `main.ts:66`, `main.ts:110`     | 11 Alertes                                                  | Oui              |
|   7 | `channel-points` — Points de chaîne | `main.ts:67`, `main.ts:111-113` | 12 Points de chaîne, sous-zones; transversal Effets OBS     | Oui              |
|   8 | `halloween` — Halloween             | `main.ts:68`, `main.ts:114-116` | 13 Halloween / chaos / ambiance / alertes / viewer          | Oui              |
|   9 | `progression` — Progression         | `main.ts:69`, `main.ts:117-119` | 14 Progression                                              | Oui              |
|  10 | `shop` — Boutique                   | `main.ts:70`, `main.ts:120`     | 15 Boutique, détail A.5                                     | Oui (inventaire) |
|  11 | `challenges` — Défis                | `main.ts:71`, `main.ts:121-123` | 16 Défis, détail A.5                                        | Oui (inventaire) |
|  12 | `simulation` — Simulation           | `main.ts:72`, `main.ts:124-126` | 17 Simulation; transversal Roulette/Slots/Duels             | Oui              |
|  13 | `test-lab` — Test Lab               | `main.ts:73`, `main.ts:99`      | 18 Test Lab                                                 | Oui              |
|  14 | `extension-lab` — Extension Lab     | `main.ts:74`, `main.ts:127-129` | 19 Extension Lab, 6 surfaces et cartes joueurs              | Oui              |
|  15 | `soundboard` — Soundboard config    | `main.ts:75`, `main.ts:130-132` | 20 Soundboard config/lecteur                                | Oui              |

Le shell expose 15 identifiants et monte leurs écrans; seul le deep link de `simulation` n’est pas accepté par la validation de `?tab=`. Boutique/Défis ont été inventoriés ici à leur profondeur d’entrée, états, actions et dépendances; leur audit détaillé est intégré en A.5.

#### 22. Éléments non localisés

- **Storyboard :** non localisé dans la source installée et les répertoires apps/packages/docs selon la vérification de couverture de cette étude; à traiter comme fonctionnalité non localisée, sans la rattacher arbitrairement à Halloween ou à un autre écran.
- **Code mort :** le scan statique des imports TypeScript sous `apps/studio/web/src` trouve au moins un importeur pour chaque `.ts`, sauf `main.ts` qui est l’entrée. Ce scan n’a identifié aucun fichier TypeScript orphelin ; un import ne prouve pas l’absence de branches mortes ni la disponibilité de chaque action dans tous les profils. Les restrictions de profil/capacité restent à respecter.

#### 23. Capacités existantes sans page économique / Daily / analytics dans Studio

- **Daily et fidélité :** aucune page ni configuration Studio dédiée dans les 15 entrées de `main.ts:52-76`. L’Extension expose les commandes viewer `!daily` et `!streak` (`apps/twitch-extension/extension/shared/experience.js:60-61`); les endpoints Daily résident dans Core (`apps/core-api/src/http/server.ts:457-481`). Dans Studio, Test Lab montre les flags Daily/Loyalty du bot et l’état Loyalty avec garde « NO CREDITS » / Presence Shadow (`apps/studio/web/src/test-lab.ts:164-184`), mais cette vue est diagnostique, sans réglage canonique des récompenses Daily, de la fidélité ou des crédits. Progression gère l’XP et les titres/badges, pas Daily. Traiter les accès à ces capacités existantes comme des liens vers le bot/Core et les diagnostics Test Lab; ne pas inventer un nouvel écran de configuration administrative.
- **Wallet Production / économie :** aucun onglet économique transversal dans le menu Studio. Les chemins opérationnels existent déjà par viewer dans D4 (« Créditer » / « Débiter » Jetons et crédits, soumis à permission) (`apps/twitch-extension/extension/shared/moderation-v2.js:1356-1381`; console chargée dans `apps/studio/web/src/moderation.ts:78-95` et profil effectif branché dans `apps/studio/server/src/index.ts:790-806`) et par les opérations Boutique cosmétiques (« Donner » inclut titre/badge, Bonbons ou Jetons) (`apps/studio/web/src/cosmetics.ts:415-427`, `apps/studio/web/src/cosmetics.ts:632-643`). Le trajet D4 `/api/lab` est un nom de relais; en Production le cockpit appairé cible le Core Production (`apps/studio/server/src/prod-transport/production.ts:100-114`). La page « Wallet de test » reste séparée et Lab-only; l’existence des ajustements par viewer ne constitue pas un tableau de bord économique agrégé. Cible UX : rendre ces accès existants repérables depuis le profil viewer et les écrans concernés, sans ajouter une API ou une page financière supposée.
- **Statistiques de modules (`moduleStats`) :** capacité read-only du Core, disponible côté site avec jeton site, pour les totaux par viewer des interactions, Random Ban, mini-jeux/duels, Roue du Sub et achats événementiels (`apps/core-api/src/module-stats/service.ts:1-13`, `apps/core-api/src/http/module-stats-routes.ts:4-15`, enregistrement conditionné au jeton site dans `apps/core-api/src/http/server.ts:344-348`). Aucun onglet Analytics Studio parmi les 15 (`main.ts:52-76`) et aucune page Studio observée qui consomme cette route. Si une vue Studio est souhaitée, le point d’entrée cible est une navigation vers les statistiques existantes du site; ne pas présenter cela comme une nouvelle capacité Core déjà implémentée.

## A.5 Formulaires complexes, économie et bonnes idées à conserver

### Défis

#### Formulaire, champ par champ

| Champ       | Contrôle et règle effective                                                                                                                        | Implication UX                                                                                                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identifiant | Texte, max 48, minuscules/chiffres/`_`/`-`, premier caractère alphanumérique; `meta`, `runs`, `run`, `preview` réservés. Désactivé après création. | Stable une fois créé; un brouillon se supprime puis se recrée si l'identifiant doit changer.                                                                                                                                                                                                                                |
| Titre       | Obligatoire, trim, 1–80 caractères.                                                                                                                | Visible sur le site et dans le suivi.                                                                                                                                                                                                                                                                                       |
| Description | Facultative, max 400 caractères.                                                                                                                   | Modifiable après activation.                                                                                                                                                                                                                                                                                                |
| Catégorie   | Slug, max 32, par défaut `general`.                                                                                                                | L'interface est un champ libre; la validation impose un identifiant plutôt qu'un libellé accentué.                                                                                                                                                                                                                          |
| Icône       | Facultative, texte max 32 et caractères limités; aucun sélecteur d'icônes.                                                                         | Une icône inconnue retombe visuellement sur `trophy` côté site. Un choix guidé éviterait les icônes silencieusement non reconnues.                                                                                                                                                                                          |
| Visibilité  | `public` ou `secret` (secret montré au viewer une fois terminé).                                                                                   | Le défi secret reste masqué à chaque viewer jusqu'à sa propre première complétion; la révélation n'est pas globale.                                                                                                                                                                                                         |
| Métrique    | Choisie dans la liste Core; sources absentes grisées.                                                                                              | Mots trouvés/rapides; participations/victoires Tombola; Daily; Random Ban lancé/réussi/reçu; usages payés Bonk/TTS/Soundboard; duels gagnés; minutes de présence; messages. Les dernières métriques ne disposent que de totaux semaine/mois et d'un total à vie, avec les limites historiques indiquées à côté du contrôle. |
| Seuil       | Entier 1 à 1 000 000 000.                                                                                                                          | L'unité suit la métrique; la limite numérique ne signifie pas que la métrique possède autant d'historique.                                                                                                                                                                                                                  |
| Période     | Unique (défaut), semaine ou mois. Semaine = lundi–dimanche, heure de Paris.                                                                        | Le Core recalcule la période courante et la précédente pour absorber les événements tardifs. Pour `watch_minutes`/`messages`, un défi unique exige rétroactif + aucune date; un défi périodique non rétroactif commence à la première période complète après activation.                                                    |
| Rétroactif  | Case à cocher, défaut décoché.                                                                                                                     | « Historique » veut dire ce que les tables Core contiennent; l'ancien historique non daté ou les usages gratuits non stockés ne sont pas reconstitués.                                                                                                                                                                      |
| Début / fin | `datetime-local`, facultatifs. Fin après début; une fin déjà passée bloque l'activation.                                                           | Le modèle convertit depuis le fuseau local du PC (commentaire supposant Paris), alors que la Boutique convertit explicitement `Europe/Paris`. Recommandation: afficher le fuseau et partager une conversion Paris explicite.                                                                                                |
| Récompense  | Aucune, objet Boutique ou Jetons; Jetons 1–1 000 000. Objet sélectionné parmi le catalogue Core.                                                   | Pas de quantité globale/plafond budgétaire affiché. Une récompense périodique peut se répéter par viewer et par période.                                                                                                                                                                                                    |

Références: formulaire et actions `apps/studio/web/src/challenges.ts:253-327`; modèle/défauts/fuseau `apps/studio/web/src/challenges-model.ts:8-75`; contrat strict `packages/schemas/src/challenges.ts:6-55`; métriques et historiques `apps/core-api/src/challenges/metrics.ts:55-212`, `docs/CHALLENGES.md:53-69`.

#### Vérification, persistance et cycle d'état

- **Vérifier et prévisualiser** est un dry-run Core: règles + fenêtres + nombre de viewers qui compteraient et termineraient; jusqu'à dix noms/valeurs en tête. Le service ne persiste rien pour cette action (`apps/core-api/src/challenges/service.ts:611-659`). L'écran affiche les problèmes et les complétions immédiates possibles.
- **Enregistrer** crée réellement `challenge_defs` avec `status='draft'` dans le PostgreSQL du Core; le brouillon n'est pas un brouillon local Studio. L'UI garde les champs en mémoire jusqu'à Enregistrer. Édition/version/journal sont également Core (`apps/core-api/src/challenges/service.ts:360-449`).
- **Activation** est l'unique étape qui rend le défi opérationnel/public; il n'y a ni statut distinct « à vérifier », ni publication puis activation. Une confirmation précède l'action. Le Core revalide (métrique disponible, dates, règle de période, récompense) puis fait un recomptage immédiat; un rétroactif peut compléter et payer dès cette action (`challenges.ts:447-460`; `service.ts:483-537`).
- **Condition après activation**: métrique, seuil, période, dates, rétroactivité et récompense sont figés. Titre, description, catégorie, icône et visibilité restent éditables, versionnés et journalisés. Pour changer la règle, archiver et créer un nouveau défi (`challenges.ts:151-162`; `service.ts:397-449`; doc `CHALLENGES.md:71-80`).
- **Suspendu**: le moteur ignore la progression et les paiements tant que le statut n'est pas actif. Reprendre repasse par un recomptage/paiement. D'après le calcul des fenêtres, `activated_at` conserve la première activation; un recomptage après reprise peut donc intégrer des événements survenus pendant la suspension, dans la fenêtre encore comptée. Si pause doit signifier « gel sans rattrapage », cette sémantique doit être décidée et indiquée avant usage (`service.ts:514-537,542-579,706-718,826-845`).
- **Archivé**: final, retiré du catalogue public; les succès obtenus restent. Seul le brouillon est supprimable. L'API permet brouillon → archivé, mais l'interface n'expose, sur un brouillon, qu'Activer et Supprimer (`challenges.ts:273-276`; `service.ts:452-461,492-503`; site `service.ts:1233-1261`).
- La progression, les complétions, les paiements et leur historique vivent dans `challenge_progress`, `challenge_awards`, `challenge_log`, `challenge_runs`; les changements de progression sont des recomptages sur tables source et journalisent aussi une baisse sous le seuil (`service.ts:706-820`). Une ligne d'attribution par (défi, période, viewer), clé stable; échecs retentés jusqu'à 50 tentatives selon la doc (`service.ts:826-897`; `CHALLENGES.md:31-51`). La date de succès est celle du constat Core, pas la date d'un événement source, et aucune notification « défi réussi » n'est encore envoyée au viewer (`CHALLENGES.md:31-35,108-114`).
- La minuterie toutes les 60 s est derrière `CHALLENGES_ENGINE`, défaut `false`; l'activation et le bouton manuel déclenchent quand même un run. La doc Production du 04/11 indique variable absente/moteur coupé, zéro défi créé: le premier run viendrait donc d'une activation ou d'un clic manuel, avec ses écritures et paiements immédiats (`config.ts:48-50`; `ext/public-frontier.ts:224-238`; `service.ts:528-536,963-971`; `CHALLENGES.md:3-10,94-106`).

#### Autorisations et effets économiques / annulation

- En Production, toutes les routes d'écriture Studio (création, modification, status, run, retrait) sont sous l'authentification de l'installation Studio appairée; le Lab utilise son auth Studio. L'acteur journalisé est `Studio`/`Studio (Lab)`. Le site n'a qu'une route GET sous son jeton et lit le viewer fourni par sa session; pas d'écriture viewer (`apps/core-api/src/http/challenges-routes.ts:13-43,44-139,140-157`; `docs/CHALLENGES.md:82-92`). Pas de contrôle de rôle fin par action dans ces handlers.
- Un run manuel n'est **pas** une prévisualisation: il recalcule les défis actifs, écrit les deltas et paie les attributions en attente/échec. Le bouton n'a pas de confirmation, contrairement à Activer. Recommandation prioritaire: afficher le nombre de complétions et l'exposition Jetons/objets, puis confirmer avant ce run et avant une activation rétroactive (`challenges.ts:255,394-399`; `service.ts:899-947`).
- Une baisse de la donnée source (ex. achat/interaction ensuite remboursée) peut faire baisser `value`; la complétion enregistrée et sa récompense restent. Pour un objet, **Retirer…** exige une raison et marque l'attribution révoquée; Jetons refusés par cette commande et ajustement Wallet externe requis (`service.ts:1104-1159`; `CHALLENGES.md:33-45`). L'attribution d'objet passe par une possession unique par viewer+reward; le retrait met cette possession à révoquée et déséquipe le titre/badge/cadre/bannière. Le Core ne tient pas plusieurs sources de possession dans ces lignes, donc retrait d'une récompense challenge peut aussi enlever le même objet acquis ailleurs (`apps/core-api/src/progression/service.ts:557-592,685-713`).
- **Écart à corriger avant d'utiliser une récompense objet**: la doc dit qu'il faut un item publié et actif. En réalité la liste `meta` des récompenses inclut tout item `status <> draft AND active`, et `problems()` n'interdit que brouillon/inactif; `CosmeticShopService.award()` a la même condition. `hidden`/`archived` peuvent donc apparaître sans état dans la liste Studio, être validés puis attribués. Les créations Boutique partent avec `active=true` (`challenges/service.ts:240-258,321-331`; `cosmetics/service.ts:231-236,827-839`). Recommandation: filtrer strictement `published && active` à la fois en UI/méta et dans l'activation/attribution Core, et afficher type + statut du reward.

### Boutique — atelier cadres et bannières

#### Édition, publication et assets

Le même catalogue de progression contient titres, badges, cadres et bannières; pas de second inventaire. L'éditeur propose ID, type, nom, catégorie, rareté, statut, ordre, niveau de déblocage, événement, description, look (couleur, dégradé, angle, effet prédéfini, graisse) et image pour les non-titres (`apps/studio/web/src/cosmetics.ts:314-378`; payload strict `cosmetics-item.ts:4-27`; schéma `packages/schemas/src/cosmetics.ts:39-80`). Type/ID sont bloqués en édition; l'ID ne se renomme qu'en brouillon. Les états sont Brouillon, Publié, Masqué, Archivé: seuls les publiés sont vendables; masqué/archivé sortent de la boutique, mais restent aux propriétaires. Publication = enregistrer `status=published`, sans seconde confirmation. Vente et statut item sont deux opérations séparées (`cosmetics.ts:333-343,376-396`; `cosmetics/service.ts:195-254,464-479`).

- **Cadre**: PNG ou WebP fixe, carré 128–512 px (512 conseillé), ≤96 Ko. L'atelier exige un cercle central transparent (62,5 % de l'emplacement, recouvrement toléré indiqué) et 8 px sans pixels sur le bord; aperçu à cinq tailles du site. Le contrôle alpha est dans Studio avant l'envoi seulement; le Core vérifie MIME/octets, taille et dimensions, pas les pixels de transparence (`cosmetics.ts:34-56,368-370`; `cosmetics-item.ts:31-64`; `apps/core-api/src/cosmetics/images.ts:10-31`; doc `COSMETIC_SHOP.md:157-163`).
- **Bannière**: PNG ou WebP fixe, ratio 4:1, largeur 1024–2048 px, ≤256 Ko; garder les 40 % de gauche peu importants car recouverts d'un voile. Aperçu profil/carte et ligne étroite. Le conseil de composition n'est pas un contrôle de contenu côté Core (`cosmetics.ts:34-43,370-372`; `cosmetics.css:40-70`; `images.ts:26-30`).
- Un cadre ou une bannière doit avoir son image avant de quitter le brouillon. Pas de conversion serveur; le fichier uploadé est servi tel quel. Le Core détecte le type sur les octets, refuse SVG/GIF/animé/autres formats, et hash SHA-256 le contenu. L'upload stocke immédiatement les octets dans `cosmetic_images`; l'item enregistré référence cet ID. L'API consultée ne présente pas de suppression d'image: annuler l'éditeur après upload ne revient pas sur le stockage, et enlever l'image d'un item ne supprime pas l'asset (`packages/schemas/src/cosmetics.ts:72-97`; `images.ts:114-133`; `cosmetics/service.ts:345-390`; route `cosmetics-routes.ts:164-172`).
- Le preview Studio charge la feuille de style générée par le Core, comme le site; les images publiques servent leur type exact, `nosniff`, cache immuable d'un an (`cosmetics.ts:211-218`; `cosmetics-routes.ts:68-100`). Les champs de style sont des données contrôlées, sans CSS ou HTML fourni par l'opérateur (`packages/schemas/src/cosmetics.ts:7-36`).
- Note de cohérence secondaire: le texte interface/doc badges annonce 128×128 fixe, mais le validateur Core impose seulement largeur et hauteur ≤128, sans égalité ni carré (`cosmetics.ts:35-40`; `images.ts:17-20`). À décider si c'est une tolérance voulue ou à aligner.

#### Offres, achat, don, retour

Offre séparée: ID, Jetons ou Bonbons, prix entier, activée, ouverture/fermeture Europe/Paris, événement. Le produit doit être publié et actif au moment de l'achat; Bonbons seulement si l'événement est ouvert. Le Core fixe prix, solde, disponibilité et propriété; achat atomique/idempotent, un seul achat par item possédé; remboursement Studio avec raison crédite la même monnaie et retire l'objet une fois. Le don de Studio peut donner un cosmétique, des Bonbons ou des Jetons (`cosmetics.ts:382-429`; `packages/schemas/src/cosmetics.ts:99-125`; `cosmetics/service.ts:464-478,557-700,715-791,794-869`; `docs/COSMETIC_SHOP.md:15-25,42-64`). Les cadres/bannières suivent ces mêmes routes et inventaire (`docs/COSMETIC_SHOP.md:141-161`). La doc d'état du 04/11: cadres/bannières publiés côté logiciel, mais aucune offre en vente et aucun objet final encore créé (`COSMETIC_SHOP.md:3-8,141-164`).

### Storyboard et prototypes: ce qui est vérifiable

Aucune source « Storyboard » ni répertoire `prototypes/` n'a été trouvée dans ce checkout; je ne peux pas attribuer de qualités ni de validation à un prototype absent. La référence voisine est la timeline du panneau Alertes, **pas un Storyboard**: l'aperçu iframe utilise le même moteur que la source OBS mais sans file; la timeline fige un instant de la vraie vidéo et ses textes sans son, avec curseur, repères sémantiques et pas ±1 image/±0,01 s, temps et numéro d'image lisibles (`apps/studio/web/src/alerts-tab.ts:25-28,42-44,67-98`; `alerts-view.ts:338-359`; `alerts.css:173-196`).

Ce qui se transpose bien si un Storyboard est localisé: aperçu source réelle synchronisé avec l'élément choisi, marqueurs signifiants plutôt qu'un curseur opaque, position/temps lisible, séparation entre modification non enregistrée et persistance. Le calibrage Alertes superpose ses poignées au-dessus de l'iframe, convertit les coordonnées selon l'échelle de la scène, et n'écrit dans le stockage Studio qu'après Enregistrer; Annuler et Valeurs d'origine sont distincts (`alerts-calibrate.ts:19-23,66-86,101-115`). Sa limite: c'est une calibration de placement vidéo/texte par variante, pas un outil de séquençage, montage ou composition de plusieurs scènes. Le run timeline est un aperçu local sans son; la validation manuelle du storyboard lui-même reste impossible tant que l'artefact exact n'est pas identifié.

### Styling partagé et responsive — priorités

Les écrans Défis/Boutique réutilisent `.hw`/`.hw-grid` du CSS Halloween importé par `main.ts`; la grille a `minmax(380px, 1fr)` et les sections `card wide` prennent toute la largeur (`main.ts:1-16`; `halloween.css:1-47`). Boutique ajoute une bonne grille de champs `auto-fill/minmax(200px)` avec labels empilés; le CSS Défis ne définit que le preview et `.ch-actions { white-space: nowrap }` (`cosmetics.css:75-96`; `challenges.css:1-13`). Les `row-in` du formulaire Défis n'ont donc pas cette mise en page dédiée. Les deux écrans affichent plusieurs tableaux larges (catalogue 7 colonnes, défis 8, offres 6, suivi/récompenses/journal); aucun wrapper de défilement horizontal ni règle responsive propre à ces tableaux dans leurs feuilles. `.tbl` est stylé uniquement dans le scope Commandes, pas globalement (`commands.css:1470,3183`).

| Priorité           | Recommandation                                                                                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1                 | Encadrer les tables dans un conteneur `overflow-x:auto` avec largeur minimale des cellules; à très petite largeur, présenter les actions et détails du viewer sous forme de cartes ou lignes développables. Ne pas laisser `white-space:nowrap` des actions imposer la largeur minimale du tableau. |
| P1                 | Donner au formulaire Défis une grille de labels/inputs comme Boutique, avec empilement sous ~700–800 px; aligner dates et aide contextuelle sous les champs concernés.                                                                                                                              |
| P2                 | Distinguer visuellement état d'objet, offre en vente, état du défi et résultat de paiement avec libellés/couleurs cohérents et statut visible dans la sélection du reward; ne pas faire porter une distinction métier sur le seul texte du bouton.                                                  |
| P2                 | Vérifier le bandeau global: `.topbar` et `.tabs` sont en flex sans règle de retour à la ligne dans `style.css:20-56`; la densité de navigation peut comprimer les onglets sur une fenêtre étroite.                                                                                                  |
| Référence positive | Alertes applique un breakpoint 1100 px qui empile ses deux grilles; le scrubber prend 100 % de largeur (`alerts.css:173-196`). Réutiliser ce principe de breakpoint, pas ses tailles exactes sans essai des deux écrans.                                                                            |

Ces constats statiques sont recoupés par les observations Défis/Boutique/Alertes en A.2. La validation manuelle des parcours complets par Antoni reste à faire.

## A.6 Parcours de travail : les ruptures qui comptent

Les nombres de clics ci-dessous sont des estimations de structure, pas des mesures chronométrées auprès d’Antoni. Un scroll long, une lecture d’état et une confirmation sensible comptent aussi dans l’effort ; les supprimer artificiellement du décompte ne rendrait pas un parcours meilleur.

| Situation / intention                                  | Parcours actuel et rupture                                                                                                | Parcours cible                                                                                             | Critère à vérifier avec Antoni                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Avant : savoir si le live peut utiliser TTS/Bonk       | Studio → centre de contrôle → cartes lecteurs/connexions plus bas ; même état répété, mots Lab/Production contradictoires | Centre → ligne indisponible → panneau de connexion concerné, puis retour au même état                      | Identifier le service manquant et sa prochaine action en moins de 10 s, sans confondre autorisation et disponibilité.                                              |
| Avant : modifier une récompense qui déclenche un effet | Points de chaîne → rechercher la récompense → règle → retrouver le module d’effet ou sa source ailleurs                   | Récompense → action liée → panneau partagé de cet effet ; retour conserve la sélection de récompense       | Aucun réglage copié entre récompense et module ; l’opérateur sait quelle version enregistrée sera exécutée.                                                        |
| Avant : préparer une tombola                           | Onglet Tombola malgré la tuile d’accueil « migration à venir » ; nombreux réglages de préparation                         | Modules → Tombola → Préparer ; résumé monnaie/lot, participants, durée, résultat attendu                   | Relecture de la configuration avant lancement, sans masquer les options de Full oseille/Super Tombola.                                                             |
| Pendant : arrêter un effet ou une lecture              | Trouver Modération/lecteur ou sous-module caché ; plusieurs « tests » peuvent agir réellement                             | Régie → arrêt nommé ou file du module ; état d’exécution renvoyé par le service                            | Un accès direct à l’arrêt disponible ; aucune promesse d’arrêt universel. Pas de confirmation pour l’arrêt réversible sans perte de file si son contrat le permet. |
| Pendant : traiter une interaction payée défaillante    | Modération/D4, Boutique ou écran métier selon l’origine                                                                   | Activité ou Régie → demande → panneau transaction/module avec monnaie, exécution, retour possible          | Ne jamais déduire un remboursement d’un simple stop ; état « à vérifier » conservé si résultat ambigu.                                                             |
| Pendant : accorder un droit Roue du Sub                | Points de chaîne → long défilement → Roue → Droits                                                                        | Favori/Régie → Roue du Sub → Droits → accorder…                                                            | État du droit et auteur visibles ; pas de nouveau tirage implicite lors de l’octroi.                                                                               |
| Pendant : changer ponctuellement un prix               | Réglage du module parfois sous Modération ; effet immédiat variable selon champ                                           | Fiche du module → réglage rapide → portée « demandes futures » ou règle réelle du backend → enregistrer    | La portée n’est pas inventée. Vérifier quelles opérations déjà engagées gardent leur prix.                                                                         |
| Après : comprendre une coupure et son impact           | Bandeaux rétablis, logs runtime et historiques propres séparés                                                            | Activité → Incidents → lien vers historique du module ; même identifiant d’événement si disponible         | Pas de fausse corrélation session/incident ; conservation des heures et états de source.                                                                           |
| Hors live : créer un défi                              | Liste + formulaire dense sous la même page ; slug en premier                                                              | Communauté → Défis → Nouveau → condition lisible → dry-run → enregistrer le brouillon → activation séparée | Comprendre avant activation si l’historique compte et si des récompenses peuvent être dues immédiatement.                                                          |
| Hors live : créer un cadre puis le vendre              | Catalogue, forme et offres enchaînés verticalement ; statut modifiable dans le même formulaire                            | Boutique → nouvel objet → type → identité/apparence → brouillon → publier → offre distincte                | L’aperçu reprend le rendu du site ; une offre n’est pas ouverte par accident en enregistrant une image.                                                            |

**Bonnes idées à généraliser :** le couple liste/détail de Points de chaîne ; les trois moments Préparer/En direct/Historique de Tombola ; les filtres et l’éditeur structuré de Commandes ; les fenêtres réelles de prévisualisation d’Alertes ; la distinction sélectionné/effectif du profil ; les messages d’erreur opérationnels de Caution et de supervision ; la validation de transparence de l’atelier Cadres. Leur contenu reste riche. On les rend cohérents sans les remplacer par des panneaux uniformes vides.

---

# Partie B — Options UX et organisation retenue

## B.1 Trois modèles réellement différents

### Option A — Des domaines stables, comme une bibliothèque d’outils

```text
Pilotage
Interactions audio & visuelles
Jeux & tirages
Économie & communauté
Commandes & modération
Événements
Connexions & système
Laboratoire
```

**Navigation principale :** barre latérale de domaines, indépendante du fait d’être en live. **Secondaire :** modules dans le domaine choisi, puis contrôle/réglages/historique quand ces trois usages existent. Les actions rapides sont des favoris de modules et des liens de détail.

**Regroupements :** TTS et Soundboard ensemble ; Wallet, progression, défis et cosmétiques ensemble ; Twitch et OBS en connexions ; musique autonome. Une récompense de points de chaîne est un déclencheur, pas le conteneur administratif de tous les modules qu’elle lance.

**Avantages :** stabilité spatiale ; préservation des noms familiers ; migration page par page ; peu de duplication. **Inconvénients :** les urgences du live traversent plusieurs domaines ; la bonne rubrique pour les fonctions hybrides peut rester discutée. **Coût probable : moyen**, surtout le shell et les extractions de Points de chaîne/Modération. **Apprentissage : faible à moyen**, ancien nom conservé mais rangement nouveau.

**Usage où il réussit :** retrouver les réglages de Spotify après plusieurs semaines. **Échec prévisible :** intervenir successivement sur TTS, Bonk et Tombola en plein live oblige à changer trois fois d’outil.

### Option B — Des espaces par moment de travail

```text
Préparer
En direct
Créer
Administrer
Analyser
```

**Navigation principale :** les cinq moments. **Secondaire :** outils pertinents dans chaque espace ; la même entité peut être présentée en vue de création, administration ou exécution. **Accès rapides :** commandes propres à l’espace, passage contextualisé d’un moment à l’autre.

**Regroupements :** connexions et checklist dans Préparer ; files et arrêts dans En direct ; défis, commandes et cosmétiques dans Créer ; économie/permissions dans Administrer ; statistiques dans Analyser.

**Avantages :** très bonne focalisation sur le live ; densité adaptée ; outils de création plus accueillants. **Inconvénients :** « où modifier le prix d’un TTS ? » peut raisonnablement relever de trois espaces ; un streamer seul change de moment plusieurs fois par minute ; risque de dupliquer état et composants. Il faut préserver la sélection d’objet et le brouillon lors des passages.

**Coût probable : élevé**, car les modules existants doivent exposer plusieurs vues cohérentes et partager leur contexte. **Apprentissage : moyen à élevé** ; on apprend à la fois le module et son emplacement selon l’intention. **Usage où il réussit :** animation d’un live avec une régie très préparée. **Échec prévisible :** correction rapide d’un réglage imprévu pendant une création.

### Option C — Des objets reliés dans un atelier de production

```text
Mon stream / projet de production
  Déclencheurs   [sub, points, commande, timer]
  Actions       [son, TTS, sanction, effet, tirage]
  Contenus      [médias, récompenses, cosmétiques]
  Règles        [conditions, prix, permissions]
  Sorties       [OBS, chat, extension, site]
Bibliothèque globale
Activité & diagnostics
```

**Navigation principale :** projet/collection, bibliothèque, activité. **Secondaire :** sélection d’un objet ; inspecteur avec relations entrantes/sortantes. **Accès rapides :** recherche d’objet, favoris, historique de sélection. Une récompense Twitch est liée visiblement à une action, à sa sortie et à sa condition.

**Avantages :** modèle puissant pour comprendre les dépendances ; excellente réponse aux actions dispersées ; prépare naturellement des compositions complexes. **Inconvénients :** la notion de projet n’existe pas comme agrégat métier universel dans le Core ; graphe difficile à lire en urgence ; risque de transformer Studio en outil de programmation visuelle. Les conditions/transactions des modules ne peuvent pas être unifiées sans perdre leur sémantique.

**Coût probable : très élevé** si le projet devient une vraie entité persistante ; moyen à élevé pour un inspecteur de relations en lecture seule. **Apprentissage : élevé** pour la navigation principale. **Usage où il réussit :** comprendre pourquoi une récompense Twitch déclenche tel effet. **Échec prévisible :** devoir arrêter un TTS en trois secondes.

### Comparaison et choix

| Critère                           | A — domaines           | B — moments              | C — objets reliés                 |
| --------------------------------- | ---------------------- | ------------------------ | --------------------------------- |
| Retrouver une fonction familière  | Fort                   | Variable selon le moment | Dépend de la recherche            |
| Urgence en live                   | Moyen sans favoris     | Fort                     | Faible sans régie ajoutée         |
| Création complexe                 | Bon atelier par module | Très bon                 | Très bon, mais abstrait           |
| Compatibilité avec le code actuel | Forte                  | Moyenne                  | Faible pour un projet persistant  |
| Risque de duplication UI          | Faible                 | Élevé sans discipline    | Moyen                             |
| Coût de migration relatif         | Moyen                  | Élevé                    | Très élevé pour le modèle complet |
| Risque d’apprentissage            | Faible/moyen           | Moyen/élevé              | Élevé                             |

Ce sont des appréciations de conception, pas des scores issus d’une étude utilisateur. **Retenir A comme ossature, compléter avec une régie transversale et des liens de dépendance empruntés à C.** Conserver les ateliers de B au sein de leur module, sans créer cinq modes globaux.

Cette combinaison répond au streamer seul : une fonction garde la même adresse avant, pendant et après le live ; le poste de contrôle expose seulement les actions dont il a besoin en direct. Passer en Régie est une navigation, jamais un changement de profil, de permissions ou de moteur.

## B.2 Arborescence recommandée

```text
Centre de contrôle
  Disponibilité et incidents utiles
  Préparation du live (repères, pas orchestration automatique)
  Raccourcis / dernières activités

Régie live
  Actions épinglées
  Files et interactions à traiter
  Arrêts disponibles / santé du live

Modules  [catalogue regroupé, liens directs sans page de catégorie obligatoire]
  Sons & voix                  → Soundboard, TTS
  Alertes & points de chaîne    → Alertes, Récompenses Twitch / règles
  Jeux & tirages               → Tombola, Jeu des mots, Roue du Sub
                               → Roulette / Slots / Duels : commande + diagnostic existants
  Effets & mise en scène       → Bonk, lecteur d’effets / interactions OBS, Overlay
                               → Chaos saisonnier ; Storyboard à localiser
  Interactions à sanction      → Random Ban, Caution, Votekick
  Musique                      → Spotify
  Commandes du chat            → Commandes Twitch
  Événements saisonniers       → Halloween et ses réglages

Communauté
  Viewers                      → recherche, équipement et actions existantes
  Jetons & économie             → Wallet / opérations autorisées / traces
  Progression & Daily           → règles XP existantes ; Daily : accès aux états disponibles
  Défis                        → catalogue / atelier / suivi / récompenses
  Boutique                     → catalogue / atelier / offres / achats et retours

Activité
  Activité des modules et actions administratives
  Achats et attributions (liens vers le détail propriétaire)
  Incidents
  Statistiques disponibles par module

Système
  Connexions                   → Core, bot VPS, Twitch de ce PC, OBS, services
  Lecteurs & sources            → état et accès aux réglages propriétaires
  Profil Studio                → Lab / Production, identité et diagnostic
  Réglages généraux / mises à jour / journal technique

Laboratoire  [outil distinct dans le bas de barre]
  Simulation / chat fictif / scénarios
  Test Lab / services / journaux
  Extension Lab : surfaces, rôle et identité
  Prototypes locaux
```

**Ce plan ne crée pas des capacités manquantes.** Roulette/Slots/Duels n’ont pas soudain un éditeur complet : leur fiche peut donner les commandes existantes, leur disponibilité et le lien au simulateur. Le portail Viewers réunit les panneaux qui existent déjà ; une nouvelle recherche serveur universelle n’est pas promise. Storyboard reste un emplacement proposé à confirmer, pas une fonctionnalité nouvellement identifiée. Les statistiques n’impliquent pas un suivi de sessions de live absent des données.

Daily ne possède pas de console complète repérée dans Studio : sa destination peut d’abord présenter les diagnostics et liens existants. De même, `moduleStats` est aujourd’hui exposé avec l’autorisation du site, pas comme route administrative Studio. Une première version peut renvoyer au site ; une intégration directe demanderait un contrat serveur authentifié adapté. Ne pas embarquer le jeton du site dans l’UI ni présenter cette intégration comme déjà disponible.

**Modération reste une capacité transversale, pas une septième rubrique concurrente.** Les files D4 apparaissent dans Régie, leur écran complet est une destination interne stable `regie/moderation`, et les droits d’équipe sont dans Système. Le réglage TTS quitte Modération pour TTS. Les actions « Tombola Studio » historiques restent identifiées comme workflow D4 tant que leur équivalence avec Tombola V2 n’a pas été prouvée. Aucune fusion métier par simple renommage.

### Matrice de déplacement sans suppression

| Emplacement actuel                                                                             | Destination de référence                      | Entrées supplémentaires / précaution                                                                     |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Studio → centre de contrôle / incidents                                                        | Centre de contrôle ; Activité → Incidents     | Résumé de santé en Régie et dans le shell.                                                               |
| Studio → runtime, profil, appairage, comptes Twitch                                            | Système                                       | Liens contextuels depuis une panne. Jetons du PC séparés du bot VPS.                                     |
| Studio → lecteurs Production                                                                   | Module propriétaire ; Système → Lecteurs      | Une seule instance d’un consommateur quand exigé ; clés masquées.                                        |
| Modération → D4, files, sanctions, remboursements                                              | Régie → Modération                            | Accès depuis activité/module ; mêmes permissions.                                                        |
| Modération → Supermods / équipe                                                                | Système → Équipe & permissions                | Tiroirs D4 réutilisés tant que leur contrat est unique.                                                  |
| Modération → TTS config                                                                        | Modules → TTS → Réglages                      | File en Régie, lecteur en TTS.                                                                           |
| Modération → Wallet test                                                                       | Laboratoire → Données fictives                | Ne pas le convertir en Wallet réel sous le même bouton.                                                  |
| Modération → Tombola Studio                                                                    | Régie → Modération → Tombola D4               | Workflow conservé distinct de V2 jusqu’à preuve d’équivalence.                                           |
| Tombola V2                                                                                     | Modules → Jeux & tirages → Tombola            | Favori et contrôle en Régie ; garder Préparer/En direct/Historique.                                      |
| Commandes                                                                                      | Modules → Commandes Twitch                    | Recherche par nom/alias, favoris, test dans Lab ; droits globalement accessibles.                        |
| Jeu des mots                                                                                   | Modules → Jeu des mots                        | Actions utiles en Régie ; révélation locale préservée.                                                   |
| Alertes                                                                                        | Modules → Alertes                             | Atelier, déclencheurs, file et historique ; liens vers sources/SE.                                       |
| Points de chaîne → récompenses/règles/historique                                               | Modules → Récompenses Twitch                  | Récompense ouvre le panneau partagé de l’action liée.                                                    |
| Points de chaîne → Spotify                                                                     | Modules → Spotify                             | File musicale en Régie ; connexion accessible depuis Système.                                            |
| Points de chaîne → Random Ban/Caution/Votekick                                                 | Modules → chacun sous Interactions à sanction | Portée Twitch/OBS et monnaie visibles ; pas de bouton générique « tester ».                              |
| Points de chaîne → Roue du Sub                                                                 | Modules → Roue du Sub                         | Droits et À vérifier accessibles en Régie, sans nouvelle attribution automatique.                        |
| Points de chaîne → lecteur d’effets                                                            | Modules → Effets & mise en scène              | Source OBS inchangée ; paramètres métier restent dans l’action propriétaire.                             |
| Progression → niveaux, viewers, équipement ; Daily via Core/bot, sans console complète repérée | Communauté → Progression/Daily et Viewers     | Préserver les capacités existantes ; ne pas inventer des réglages Daily ou un Wallet général.            |
| Boutique                                                                                       | Communauté → Boutique                         | Achats/retours accessibles depuis Activité, même détail.                                                 |
| Défis                                                                                          | Communauté → Défis                            | Atelier et suivi ; aucune rubrique globale « Récompenses » qui duplique Boutique.                        |
| Halloween / ambiance / chaos / alertes                                                         | Modules → Événements saisonniers              | Actions réelles dans leurs propriétaires ; vue thématique compose les liens.                             |
| Simulation / Test Lab / Extension Lab                                                          | Laboratoire                                   | Conserver outils/scénarios et leur isolation réelle ; ouvrir Lab ne bascule pas implicitement le profil. |
| Soundboard config                                                                              | Modules → Soundboard                          | Lecteur, banque et réglages proches ; crédits et points Twitch distincts.                                |
| Bonk/TTS actuellement dans Extension Lab                                                       | Modules → Bonk / TTS pour l’administration    | L’Extension Lab garde son rôle de surface viewer de test, pas de panneau admin caché.                    |
| Roulette/Slots/Duels depuis chat/simulation                                                    | Fiches légères Modules + Laboratoire          | Les règles restent dans Core/bot ; aucune nouvelle configuration inventée.                               |
| Dev/prototypes et widget mise à jour                                                           | Laboratoire / Système → Version               | Statut succinct de mise à jour possible dans le shell ; installation hors live à la main.                |

## B.3 Navigation choisie et mécanismes écartés

**Barre latérale :** 224 px en fenêtre large, six liens libellés et icônes ; favoris limités initialement à quatre liens, défilant séparément seulement si nécessaire. Aucun accordéon de vingt modules dans cette barre. À moins de 900 px, bouton de navigation et tiroir avec texte ; pas une rangée de symboles incompréhensibles. Le catalogue montre les groupes et tous leurs modules directement cliquables.

**Palette unique Ctrl+K :** entrée visible « Rechercher ou agir… ». D’abord index local du catalogue, alias historiques, vues et actions exposées par le registre UI. Résultats nommés « Ouvrir TTS », « Mettre la file TTS en pause » ; origine et portée visibles. Une recherche de viewers ou d’objets persistants n’est ajoutée que si une API existante le permet. Les actions sensibles ouvrent leur panneau/confirmation ; Entrée ne lance pas un remboursement/sanction depuis un résultat ambigu. Aucune exécution de texte libre, aucun nouveau langage d’automatisation.

**Détail contextuel :** panneau de 360–440 px pour une transaction, récompense liée ou incident court ; il ne doit pas porter le formulaire complet Défis. La page derrière garde filtres, sélection et scroll. Sous 900 px de largeur disponible, le détail devient pleine page avec retour contextualisé. Un seul panneau latéral à la fois ; ouvrir un détail lié remplace le contenu avec une trace de retour, au lieu d’empiler des tiroirs.

**Fil d’Ariane :** trois niveaux utiles au maximum, par exemple Communauté / Défis / « Nom du défi ». Pas sur l’accueil. Il exprime l’emplacement canonique même lorsqu’on vient d’un favori. Le retour à la liste conserve le filtre ; le bouton Précédent restaure le parcours réel.

**Favoris et régie :** un favori ouvre une destination. Une tuile de régie peut ouvrir un contrôle ou appeler une action déjà enregistrée dans le registre. Pour le premier lot, disposition prédéfinie et épinglage suffisent. Pas de constructeur de dashboard à glisser-déposer libre, pas de profils de disposition automatiques en fonction du jeu, pas de commande dangereuse fondée sur une touche seule.

**Actions récentes :** retenues dans la palette pour retrouver une destination, pas un bouton « rejouer la dernière sanction ». **Historique de navigation :** historique standard ; pas un nouveau panneau global. **Vue compacte :** densité par composant quand nécessaire, pas un second thème qui oblige à maintenir deux applications. **Notifications :** centre d’incidents + résultat local d’action ; pas une troisième boîte d’alertes concurrente.

## B.4 Recherche de références appliquée au projet

Recherche consultée le 04/11/2026. Les mécanismes ci-dessous sont vérifiés dans la documentation des éditeurs ; leur adaptation à Studio reste une proposition. Aucun test utilisateur comparatif de ces logiciels n’a été mené dans cette mission.

| Référence vérifiée                                                                                                   | Mécanisme retenu                                                                                         | Application à Raptoru / ce que l’on écarte                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OBS Studio — guide de l’interface](https://obsproject.com/kb/OBS-Studio-Overview)                                   | Studio Mode distingue la scène préparée et la scène visible aux viewers.                                 | Rendre distincts aperçu local et envoi dans une file/source active. Ne pas ajouter une seconde régie de scènes concurrente d’OBS.                                               |
| [Streamer.bot — Actions](https://docs.streamer.bot/guide/core/actions)                                               | Les actions regroupent des sous-actions et peuvent être organisées indépendamment de leurs déclencheurs. | Une action d’effet reste unique, qu’elle soit appelée par points Twitch ou raccourci. Ne pas importer un éditeur universel de scripts dans Studio.                              |
| [Touch Portal — état des boutons](https://www.touch-portal.com/docs/state_button/)                                   | Les états/événements permettent de faire varier la représentation des contrôles.                         | Une tuile doit refléter l’état observé, pas seulement le dernier clic. Ne pas confondre « ordre envoyé » avec « effet confirmé ».                                               |
| [Stream Deck — dossiers](https://www.elgato.com/ca/en/explorer/products/stream-deck/how-to-use-folders-stream-deck/) | Un petit plan de touches expose l’essentiel et donne accès à des groupes.                                | Régie courte et stable ; le catalogue garde la richesse. Écarter l’arborescence de nombreux sous-dossiers comme navigation principale.                                          |
| [Discord — Quick Switcher](https://support.discord.com/hc/en-us/articles/115000070311-Quick-Switcher)                | Ctrl+K permet de rejoindre une destination sans parcourir ses menus.                                     | Palette utile aux modules enfouis et alias historiques. Elle complète une navigation claire.                                                                                    |
| [Linear — recherche](https://linear.app/docs/search)                                                                 | Recherche globale, recherche de la vue et destinations récentes ont des portées explicites.              | Distinguer recherche d’un module/action et filtre de sa liste ; garder les destinations récentes dans la palette. Pas de moteur universel de données avant les API nécessaires. |
| [Notion — barre latérale](https://www.notion.com/en-gb/help/navigate-with-the-sidebar)                               | Favoris et groupes repliables donnent accès aux pages utilisées fréquemment.                             | Quatre favoris pour un streamer seul ; pas une arborescence de contenus arbitraire.                                                                                             |
| [Figma — variantes](https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants)                   | Les variantes organisent les états d’un composant par propriétés explicites.                             | Décrire Button/Status/Field par variantes vérifiables, sans inventer une variante CSS par module. Ce n’est pas une prescription de framework.                                   |
| [DaVinci Resolve — pages spécialisées](https://www.blackmagicdesign.com/products/davinciresolve)                     | Les tâches de montage, effets, couleur, son et sortie disposent d’espaces spécialisés.                   | Autoriser des ateliers adaptés à Défis/Boutique/Alertes ; garder le même objet et sa navigation. Écarter cinq modes globaux pour toutes les petites tâches de Studio.           |

---

# Partie C — Direction artistique et design system

## C.1 Concept : une régie de création calme

Surfaces anthracite légèrement vertes, accent menthe désaturé, repères chaleureux pour l’attention. Le contraste vient d’abord de la typographie, des alignements et des niveaux de surface. La personnalité Raptoru vient d’une marque compacte et du contenu du stream ; elle ne dépend pas de néons, de textures derrière les formulaires ou d’une animation permanente.

La maquette propose une évolution de la base sombre existante. Elle garde des formes simples et une hiérarchie commune à tous les modules. Un jeu, un formulaire économique et un lecteur n’utilisent pas des palettes ou des boutons sans rapport.

### Tokens proposés

| Token                  | Valeur    | Usage                                                                            |
| ---------------------- | --------- | -------------------------------------------------------------------------------- |
| `--rs-canvas`          | `#101417` | Fond d’application et zones de lecture                                           |
| `--rs-sidebar`         | `#141A1E` | Navigation permanente                                                            |
| `--rs-surface`         | `#1A2227` | Panneaux fonctionnels                                                            |
| `--rs-raised`          | `#222C32` | Contrôle, menu, pied d’action                                                    |
| `--rs-border`          | `#34434B` | Séparation structurelle ; pas une garantie de contraste suffisante pour un champ |
| `--rs-input-border`    | `#667E88` | Bord des champs ; contraste calculé 4,32:1 sur canvas et 3,77:1 sur surface      |
| `--rs-text`            | `#EEF3F1` | Texte principal                                                                  |
| `--rs-muted`           | `#B2C1C4` | Texte secondaire utile                                                           |
| `--rs-dim`             | `#91A5AA` | Métadonnées, sans descendre à l’illisible                                        |
| `--rs-accent`          | `#83DFC1` | Action principale et sélection ; texte sombre `#10251D` sur remplissage          |
| `--rs-success-surface` | `#203B33` | Succès avec texte menthe                                                         |
| `--rs-warning`         | `#F0C780` | Attention, avec fond `#3B3223`                                                   |
| `--rs-danger`          | `#FF9797` | Action/état dangereux, avec fond `#3C272B`                                       |
| `--rs-info`            | `#9ECBFF` | Information et résultat de contrôle, avec fond `#233347`                         |
| `--rs-focus`           | `#C2A9FF` | Focus clavier, 2 px avec décalage de 3 px                                        |

**Couleur et sens sont séparés.** Une pastille menthe de navigation ne signifie pas « service disponible ». Les statuts comprennent texte + icône/forme. « Désactivé volontairement », « indisponible », « inconnu », « en cours » et « rétabli » ont des libellés différents. L’ambre hors live peut signaler un lecteur manquant sans prendre l’aspect d’une panne critique ; un contexte de travail choisi par l’opérateur ne doit pas masquer le problème réel.

**Typographie :** Segoe UI/system-ui conserve la lisibilité et ne nécessite pas de police distante. Texte de formulaire 14 px/20 px minimum cible ; aide 12 px/18 px ; titres page 28/34, section 16/24, panneau 15/22. Poids 400, 550–600 et 650 pour les titres/actions. Identifiants techniques en monospace seulement dans le détail. Nombres et durées en chiffres tabulaires. Texte à 200 % : aucune hauteur fixe qui coupe un libellé. Les métadonnées de 11 px de la maquette ne doivent pas porter une action, une monnaie ou un avertissement essentiel.

**Grille :** pas de maquette figée à 1 920 px. Sidebar 224 px ; contenu padding 32 px en large, 24 px intermédiaire, 16–20 px étroit. Colonnes fluides `minmax(0, 1fr)`. Espace entre zones 24 px, entre cartes 16–20, entre champs 16–18, label/champ 8, titre/description 6–8. Échelle réutilisable : 4, 8, 12, 16, 24, 32, 48. Un formulaire d’édition gagne à rester autour de 720–880 px de largeur utile, avec aperçu de 320–360 px si l’espace existe.

**Formes :** panneaux 12 px, contrôles 7–8 px, petites étiquettes 6 px. Bordures de 1 px ; séparateurs sans ombre. Ombre seulement pour menus/panneaux flottants, par exemple `0 12px 36px #0005`. Aucun dégradé décoratif dans les cartes de gestion. Icônes linéaires de 18–20 px, trait 1,5–1,75, même famille ; nom visible pour une action peu familière. Les emoji de titre ne font pas office de système d’icônes.

## C.2 Contrats concrets de composants

| Composant                 | Spécification commune et comportements                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Button**                | Variantes primary, secondary, quiet, danger. Hauteur normale 36–40 px, live 44 px minimum cible ; compact 32 px pour tables. Une intention principale par zone. Pending : libellé maintenu + indicateur, verrou du double clic ; résultat serveur avant succès. Texte « Rembourser 125 Jetons… » quand le contexte permet de connaître la valeur. |
| **Field**                 | Label au-dessus, valeur, unité adjacente, aide sous le champ, erreur locale reliée par `aria-describedby`. Obligatoire indiqué explicitement quand la majorité des champs est facultative. Input natif accessible stylé, sans remplacer les sélecteurs par un composant maison sans besoin.                                                       |
| **Select / choix visuel** | Select pour listes courtes ; choix par cartes pour 3–4 types d’objets réellement distincts. Picker recherchable pour un catalogue long. Afficher le type et le statut d’une récompense choisie ; pas seulement son nom.                                                                                                                           |
| **Toggle**                | État courant + action dans le libellé, dépendances visibles. Un switch de paramètre n’a pas le même sens qu’un bouton d’exécution. Confirmer une activation sensible, pas chaque préférence réversible. Ne pas inverser optimistement un état opérationnel avant réponse.                                                                         |
| **Tabs**                  | 2–4 vues de travail d’une même entité, ordre stable. Ne pas y cacher un module autonome. `tablist/tab/tabpanel` et flèches clavier si vrais onglets ; liens normaux si navigation de pages. Plus de quatre destinations : revoir le rangement avant d’ajouter un menu.                                                                            |
| **StatusBadge**           | axes séparés : profil, connexion, disponibilité, activation, exécution, paiement. Délai de fraîcheur et état inconnu. Un seul « Actif » sans sujet est interdit.                                                                                                                                                                                  |
| **Panel / card**          | Un but par panneau, titre court, action locale liée. Pas de carte autour de chaque champ. Fond neutre commun ; pas une couleur par module.                                                                                                                                                                                                        |
| **Table / liste**         | Entêtes espacées, cellules padding 10–12 px, ligne 40–48 px, alignement des nombres, unité conservée. Sélection ouvre détail ; action destructive dans le détail ou menu nommé. Wrapper de scroll seulement sur la table ; titre/filtres restent dans la page. Pagination/filtres s’appuient sur les possibilités serveur.                        |
| **FormSection**           | 3–5 groupes intelligibles, description du résultat, paramètres techniques repliés. Brouillon local non enregistré marqué, brouillon persistant confirmé par l’API ; abandon explicite si des changements non enregistrés sont perdus. Pas d’autosave universel.                                                                                   |
| **DetailPanel**           | Une entité courte ; largeur 360–440 px, fermeture visible et Escape, focus initial/retour. Pas deux panneaux imbriqués. Petit écran : pleine page.                                                                                                                                                                                                |
| **ConfirmDialog**         | Verbe, cible, profil/portée, conséquence, montant/monnaie, irréversibilité réelle, raison si le backend l’exige. Deux actions maximum hors fermeture. Ne pas demander de retaper un nom pour une pause banale.                                                                                                                                    |
| **Feedback**              | Validation inline pour une erreur de champ ; résumé avec liens si plusieurs erreurs. Toast pour succès bref ; erreur durable proche de l’action. Les incidents opérationnels vivent dans le centre de supervision. Une perte réseau après écriture donne « résultat à vérifier », sans retry automatique d’une écriture non idempotente.          |
| **EmptyState**            | « Aucun défi créé » + CTA ; « Aucun résultat pour ce filtre » + effacer ; « Données indisponibles » + cause/réessayer. Ces états ne sont pas interchangeables.                                                                                                                                                                                    |
| **Preview**               | Portée affichée, même renderer existant quand disponible, redimensionnement réel du média. Les contrôles d’aperçu local ne se mélangent pas au bouton d’envoi dans une file. Source OBS et clé masquées par défaut.                                                                                                                               |
| **Upload**                | Dropzone + bouton clavier ; formats/poids/dimensions avant choix, progression et validation. Distinguer fichier choisi, contrôlé, téléversé et lié à l’objet. « Annuler les modifications » ne promet pas de supprimer un asset déjà stocké.                                                                                                      |
| **Timeline / historique** | Heure, origine, résultat et lien vers détail. Animation interdite sur toute la liste à chaque poll. Dernière activité visible, pause de suivi si l’opérateur consulte une ligne ancienne ; ne pas lui faire perdre sa position.                                                                                                                   |

## C.3 Responsive et accessibilité

Les seuils suivants sont des points de départ à tester selon la **largeur disponible au composant**, pas des catégories d’appareils. Un panneau latéral ouvert peut faire changer la disposition même sur un écran large.

| Espace utile    | Adaptation                                                                                                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥ 1 200 px      | Sidebar libellée, atelier + aperçu latéral, colonnes de contrôle 2/1 si pertinentes ; navigation globale sur une seule colonne stable.                                                                                                                          |
| 900–1 199 px    | Sidebar plus courte ou repliable à la demande, aperçu sous le formulaire ou dans une vue dédiée ; tableaux avec colonnes essentielles et détail. Pas de réduction de police pour tout faire entrer.                                                             |
| 600–899 px      | Navigation en tiroir, contenu en une colonne ; détail remplace le contenu en pleine largeur. Cartes de régie 2–3 colonnes selon libellés.                                                                                                                       |
| < 600 px / dock | Formulaire une colonne, résumé après la section ou bouton de consultation ; table en liste de synthèse quand la comparaison n’est pas indispensable. Deux colonnes de touches seulement si leurs libellés restent lisibles. Sources URL se replient, copiables. |
| Faible hauteur  | Barre globale compacte ; jamais cinq bandeaux ; pas de résumé sticky qui masque les champs ou le focus. Les pieds d’action restent dans le flux lorsqu’ils occupent trop de place.                                                                              |

**Tableaux :** conserver le scroll horizontal local pour une matrice qui exige une comparaison ; offrir des lignes de synthèse pour objets/achats si elle n’est pas nécessaire. Ne pas masquer une monnaie, un état ou une action de retour uniquement pour gagner de la place. **Preview :** redimensionner le canevas avec sa transformation de coordonnées, sans appliquer `scale()` à tout l’éditeur. **Formulaire :** dates empilées, unités visibles, chaînes longues autorisées à se replier.

Référence d’accessibilité : [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow) et [taille minimale des cibles](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Cible de conception : contraste texte normal ≥4,5:1, grand texte ≥3:1, contrôles/focus informatifs ≥3:1 ; cibles d’au moins 24 × 24 CSS px ou espacement conforme aux exceptions, avec 44 px recommandé en régie. La palette seule ne vaut pas certification. Tester le focus non masqué, l’ordre clavier, les noms accessibles, le zoom texte 200 % et le reflow à 320 CSS px hors canevas/table intrinsèquement bidimensionnel. Chaque geste de drag a une alternative clavier/champ. `prefers-reduced-motion` supprime les transitions non nécessaires ; aucun clignotement pour attirer l’attention.

Cette robustesse ne constitue pas une promesse d’application mobile complète ni de pilotage distant du PC depuis un téléphone. Ces usages demanderaient un périmètre réseau/authentification qui n’est pas étudié comme produit ici.

---

# Partie D — Écrans cibles et maquette de référence

## D.1 Mode d’emploi et portée de la maquette

Ouvrir `RAPTORU_STUDIO_UX_UI_2026-11-04.prototype.html` depuis le dossier documentaire, ou `raptoru-studio-prototype.html` depuis les outputs. Le bandeau supérieur est un sélecteur **de maquette**, absent du produit cible. Six boutons montrent les six écrans. La barre latérale, les favoris, la palette Ctrl+K, les onglets du module, la recherche du catalogue, le résumé Défis et les choix de type cosmétique sont interactifs.

**Aucune connexion, aucune persistance, aucun backend simulé métier.** Les champs et actions illustrent la conception ; le bouton d’enregistrement ne conserve qu’un état de maquette dans sa session. Les valeurs, objets, pseudos et heures sont fictifs. Les autres modules ouvrent une note de destination, pas un faux écran présenté comme implémenté. Les avertissements d’isolation appartiennent au prototype ; ils ne sont pas un modèle de texte à répéter partout dans le futur produit.

Les paragraphes ci-dessous ont priorité pour le comportement métier. La maquette ne reproduit pas le renderer réel des alertes, les transactions Core, les contrôles complets d’asset ou le dry-run de Défis. Elle ne remplace pas les prototypes validés qui existent hors Git.

## D.2 Accueil / Centre de contrôle

```text
Navigation    Fil courant                             Recherche        Santé
              Centre de contrôle                  [Ouvrir Régie live]
              [Résumé des points à vérifier → détails]
              Disponibilité                         Préparation
              - Core/bot/autorisation                - repères utiles
              - OBS/lecteurs                         - liens de contrôle
              - modules utilisés
              Accès rapides                          Activité récente
```

**Hiérarchie :** état opérable avant informations techniques. Résumé global borné, puis deux colonnes. Les services indiquent disponibilité et fraîcheur. Un lien « Détails » ouvre la bonne connexion ; aucune obligation de retrouver son onglet. Pas de chiffre décoratif sur le nombre de viewers ou la santé du système.

**Actions :** ouvrir Régie, résoudre un point de préparation, accéder aux modules favoris. Les commandes de redémarrage et l’appairage quittent ce premier écran pour Système. **États :** démarrage/inconnu, prêt, fonctionnement partiel, perte Studio↔Core, panne locale, rétablissement, aucun module utilisé. Les états techniques importants restent consultables hors live ; aucune reconnaissance automatique d’un « mode hors live sûr » n’est supposée.

**Réemploi :** StatusBadge, ServiceRow, IssueSummary, ActivityList, QuickLink. **Responsive :** une colonne en fenêtre partagée ; les trois raccourcis deviennent deux puis un si nécessaire ; le résumé ne devient pas une pile illimitée. **Changement actuel :** séparer vue de décision et inventaire technique du runtime ; garder les bonnes informations de supervision.

## D.3 Navigation globale / catalogue des modules

**Structure :** six liens principaux et bas de barre Laboratoire/profil. Catalogue avec recherche de nom/alias et groupes visuels de modules directement cliquables. Le filtre Favoris est facultatif ; la recherche reste locale au catalogue. « TTS » ne renvoie pas uniquement à « Modération » ou à un Panel viewer.

**Actions :** ouvrir le module, épingler, suivre le lien lié à une récompense/commande. **États :** module disponible, désactivé, dépendance manquante, capacité absente de la version Core, destination de diagnostic sans éditeur dédié. L’état « non implémenté » reste explicite pour les surfaces futures ; pas de faux bouton activable.

**Navigation secondaire :** 2–4 vues de tâche par module selon son besoin ; pas de sous-menu vide imposé à Jeu des mots. **Réemploi :** ModuleCard, DestinationRegistry, CommandPalette, Breadcrumb. **Responsive :** groupes de trois cartes en large, deux intermédiaire, une étroite ; barre en tiroir. **Changement actuel :** la profondeur technique Core/Lab cesse d’être le libellé de chaque destination.

## D.4 Module représentatif : Alertes

**Choix :** Alertes révèle un vrai besoin transversal — contenu, preview, événements réels et OBS — tout en disposant déjà de composants à conserver.

```text
Modules / Alertes                        Statut des événements   Favori
[Atelier] [Déclencheurs] [Historique]
Aperçu local 16:9                        Famille, variante, données
Timeline + transport                    Calibrage avancé
                                        Diffusion / file / source
                               Enregistrer les réglages
```

**Atelier :** famille et variante, données fictives guidées, vrai moteur iframe, timeline image/centième, repères, calibrage ; prévisualisation toujours explicitement locale. **Déclencheurs :** mode Twitch, dons SE, variantes et récompenses liées ; connexion dépliée seulement pour configuration/incident. **Exploitation :** file réelle et arrêt restent visibles dans l’espace de contrôle du module, accessibles en Régie. Ne pas cacher une file active derrière l’atelier si l’utilisateur vient traiter une alerte.

**Actions :** lire/rejouer/stopper l’aperçu, enregistrer le placement, envoyer un test vers OBS avec portée, voir le résultat dans la file. La version exécutée est la version enregistrée si le backend fonctionne ainsi. **États :** preview prêt/erreur média, modification non enregistrée, source absente, file occupée, événements réels actifs/inactifs, test envoyé/résultat à vérifier. **Responsive :** preview au-dessus des réglages, puis timeline ; aucune iframe dimensionnée au-delà du parent ; coordonnées converties comme le composant actuel. **Changement :** préserver la précision existante tout en séparant création et diffusion.

## D.5 Éditeur de Défis — priorité d’atelier

**Liste initiale :** si aucun défi, état vide court avec « Créer un défi », explication de la différence brouillon/actif et état connu du moteur. Ne pas imposer la grande table vide et le formulaire complet simultanément. Si catalogue présent : titre/condition/état/récompense et suivi, détails à la sélection.

**Atelier :** page dédiée, trois sections visibles et paramètres secondaires repliés. Ce choix conserve une relecture globale ; un assistant à étapes peut être ajouté si les essais le justifient, mais n’est pas retenu comme obligation.

1. **Présentation :** titre (80 max), description (400 max), visibilité, catégorie. Identifiant et icône en paramètres secondaires, visibles et confirmés avant première sauvegarde ; l’identifiant est figé après création dans l’UI existante. Aucune génération automatique silencieuse qui entre en conflit avec un ID existant.
2. **Condition & période :** métrique venant de Core avec source, unité et historique disponible ; seuil (entier), unique/semaine/mois, rétroactif explicite, dates facultatives regroupées. Les incompatibilités des métriques agrégées se présentent près du choix de période. Zone Europe/Paris affichée avec conversion correcte, indépendamment du fuseau Windows.
3. **Récompense :** aucune, objet existant ou Jetons ; sélecteur avec type/statut/éligibilité ; montant et unité. Montrer le caractère périodique de l’attribution. Ne pas afficher un faux budget maximal : sans population éligible fiable, le total ne peut pas être garanti.

**Résumé :** phrase de condition avec fenêtre de comptage, source/historique, récompense et statut. Aperçu viewer séparé du résultat de dry-run. Le dry-run montre problèmes, nombre de viewers comptables/terminés et date de calcul ; il ne promet pas que l’activation ultérieure produira exactement les mêmes résultats. Aucune donnée nominative dans les exemples de prototype.

**Actions et états :**

| Action                | Libellé / retour attendu                                                              | Garantie à ne pas inventer                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Vérification          | « Vérifier et prévisualiser » ; appels de lecture/dry-run, erreurs liées aux champs   | Ne crée pas un statut métier « validé » ni une réservation de récompenses.                                  |
| Sauvegarde            | « Enregistrer le brouillon » ; réussite renvoyée par le Core, puis statut brouillon   | Les champs en mémoire avant ce clic ne sont pas un autosave durable.                                        |
| Activation            | Écran de confirmation avec règle figée, rétroactivité, récompense et portée immédiate | Le moteur périodique OFF ne rend pas l’activation inoffensive. Pas d’étape de publication séparée inventée. |
| Suspension/reprise    | Verbe et statut explicites ; reprise avertit du recomptage                            | Une suspension ne garantit pas l’exclusion définitive des événements survenus pendant elle.                 |
| Archivage             | Retrait du catalogue, succès conservés selon règles existantes                        | Pas de retour automatique d’un état final.                                                                  |
| Retrait d’attribution | Objet/cible/raison/conséquence ; accès restreint dans suivi                           | Pas d’annulation Jetons depuis Défis, pas de conservation garantie d’une possession acquise ailleurs.       |

**Réemploi :** ChallengeForm/payload et `conditionText` existants, API de métadonnées/preview, FormSection, RewardPicker, DraftState, ImpactConfirm. Le calcul économique reste dans Core. **Responsive :** aperçu latéral si ≥1 200 px disponibles ; sinon sous le formulaire, avec résumé textuel compact près de la validation. Actions dans le flux si un pied sticky masquerait un champ ou le clavier. **Changement :** passer d’une rangée de paramètres techniques à un objectif formulé et contrôlable.

## D.6 Atelier Boutique / cosmétiques

**Catalogue :** liste ou grille selon type, recherche/filtres type/état/événement, aperçu de l’objet, statut et offre effective séparés, compteur de propriétaires en détail. Les achats n’occupent plus le bas de chaque session de création ; ils restent accessibles par onglet/détail et depuis Activité.

**Atelier :** type visuel Titre/Badge/Cadre/Bannière → présentation → apparence → disponibilité/offres. L’identité/type restent sous les règles de modification existantes. Un titre utilise les styles autorisés ; les non-titres utilisent un visuel validé. Aucun éditeur CSS/HTML libre.

**Aperçu :** rendu de raptoru.fr alimenté par les mêmes données et sa feuille générée Core, contexte carte/ligne/équipement. Pour cadres : cinq tailles du site, cercle et marge de sécurité contrôlés dans Studio ; le serveur vérifie format/poids/dimensions, pas les pixels de transparence. Pour les bannières : ratio 4:1 vérifié, zone masquée de gauche montrée comme conseil de composition. Le kit local du site peut aider la préparation, mais ne doit pas créer un second validateur divergent des règles Core/Studio.

**Actions :** choisir/contrôler/téléverser un fichier, enregistrer le brouillon, publier l’objet, configurer une offre, ouvrir/fermer une offre, donner un objet, rembourser un achat avec raison. Les actions sensibles sont à leur propre emplacement ; « Enregistrer » ne dissimule pas une ouverture de vente dans un sélecteur d’état. **Important :** ce découpage présente les opérations existantes ; une transaction qui publierait objet+offre atomiquement n’est pas supposée.

**États :** fichier local invalide, upload pending/échoué/réussi non lié, brouillon avec image manquante, publié sans offre, offre future/ouverte/arrêtée/expirée, possession existante, achat payé/remboursé. Annuler un formulaire ne supprime pas l’image téléversée ; un remboursement retire aussi la possession et peut déséquiper.

**Responsive :** aperçu sous les champs, boutons de type 2×2, grille de catalogue en liste à petite largeur ; tableaux d’achats avec résumé objet/monnaie/état et détail pleine page. **Changement :** distinguer atelier visuel, disponibilité et transactions, tout en conservant l’inventaire unique des cosmétiques.

## D.7 Régie live / contrôle rapide

**Structure :** 6–8 actions utiles au maximum initialement, état des files/interventions, santé concise, activité récente. La maquette montre six touches ; cela n’impose pas six actions identiques à chaque live. Aucune horloge de session ou statistique d’audience inventée pour remplir le vide.

**Ordre :** arrêts et pause clairement repérables ; accès aux files et modules ; commandes secondaires dans le détail. « Arrêter l’effet en cours » n’est utilisable que si un module fournit la cible et l’action correspondantes ; sinon le contrôle ouvre le module. Ne pas construire un faux bouton PANIC qui promet d’arrêter OBS, les sanctions, les sons et les transactions ensemble.

**Actions :** référence à une action du registre, mêmes paramètres/droits/contrat que la page propriétaire. L’opérateur peut voir la portée avant de cliquer. L’état pending bloque le double clic. Pour un simple arrêt sans perte, privilégier l’immédiateté ; pour annuler une tombola avec effets économiques ou lancer une sanction, confirmation de conséquence. Le bouton Reprendre est distinct d’un nouveau lancement.

**États :** action indisponible avec raison, dépendance absente, file vide/active/en pause, commande envoyée mais non confirmée, erreur à vérifier, opération déjà traitée. **Responsive/dock :** 2 colonnes lisibles, aucune table complète au milieu des touches, détails pleine largeur. Le Dock OBS existant reste un client distinct ; son UI compacte peut reprendre les mêmes contrôles, sans changer ses URL ou sa clé.

## D.8 Contrôles de la maquette et limites

- 36 combinaisons contrôlées : 6 écrans × largeurs CSS 1 440, 1 280, 960, 768, 480 et 360 px, hauteur 960 px. Aucun débordement horizontal global détecté.
- 11 interactions contrôlées : binding du résumé, seuil invalide, enregistrement de session, recherche globale, navigation via résultat, onglet Déclencheurs, dialogue, fermeture Escape, menu étroit, navigation depuis celui-ci et filtre de modules.
- Aucune erreur JavaScript observée et aucune requête HTTP(S) émise. La CSP interdit les connexions et la maquette ne contient ni `fetch`, ni XHR, ni WebSocket.
- Captures des six écrans à 1 440 px et de Défis à 480 px ; inspection visuelle de l’accueil, des ateliers et de la version étroite. Un pied d’action initialement flottant a été replacé dans le flux pour éviter le recouvrement du formulaire.

Ces contrôles automatisés vérifient l’artefact de conception, pas Studio ni les transactions. Ils ne valent pas validation utilisateur, conformité WCAG complète ou test de zoom Windows réel. Les interactions non représentées, la navigation de chaque module et le vrai renderer restent à valider au fil des lots de migration.

---

# Partie E — Préparation de la future implémentation

## E.1 Socle et couplages à préserver

### Architecture observée

| Couche                | Rôle présent                                                                                                                                                                                                                                                                                          | Conséquence pour une migration                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Electron main**     | Démarre/supervise le serveur, possède la fenêtre, gère des connexions locales et leurs secrets avec le stockage sécurisé de l’OS. La fenêtre a `contextIsolation`, `sandbox`, `nodeIntegration: false` (`apps/studio/desktop/src/main.ts:461`, `apps/studio/desktop/src/preload.cts:1`).              | Garder les privilèges dans le processus principal. L’UI n’accède au main que par le pont IPC limité de `preload.cts:12` et `:36`.                                                             |
| **Web Studio**        | Bundle TypeScript/Vite, HTML généré par composants `mountX(root)`, navigation par onglets et `data-tab`; les composants appellent l’API locale (`apps/studio/web/src/main.ts:56`, `:97`, `:137`). Pas de framework de composants ni de paquet de design system dans `apps/studio/web/package.json:1`. | Garder le shell et le montage existants; ajouter un écran local plutôt que migrer toutes les vues.                                                                                            |
| **Serveur Studio**    | Processus Node utilisant `node:http` et un routeur local, pas le serveur Express du site (`apps/studio/server/src/index.ts:35`, `:400`). Il écoute sur loopback (`:87`, `:88`, `:99`) et sert le bundle et les routes `/api/...`.                                                                     | Les composants UI ne doivent pas appeler directement le Core ni réimplémenter ses règles. Le serveur local est l’adaptateur vers Core, OBS et les processus locaux.                           |
| **Core / bot / OBS**  | Le Core décide des règles, soldes et résultats; le bot parle à Twitch; Studio relaie, rend les effets localement et rapporte l’exécution. Voir `docs/ARCHITECTURE.md:14`, `:16`, `:29`, `:34`, `:36`.                                                                                                 | Garder les contrats actuels du Core et les responsabilités des composants. Une migration d’écran ne doit pas modifier la logique métier ou déplacer l’autorité économique dans le navigateur. |
| **Site `raptoru.fr`** | Autre dépôt et autre application : serveur Express avec routes `api/*.js`, frontend JS et routeur hash (`lb-app/docs/SITE_CONTEXT.md:40`, `:54`, `:82`).                                                                                                                                              | Réutiliser les contrats Core, pas fusionner les composants DOM/CSS des deux applications. `apps/viewer-web` reste un squelette (`docs/ARCHITECTURE.md:19`); le site livré vit dans `lb-app`.  |

Les contrats de requête/réponse partagés se trouvent dans `packages/schemas` (ex. `packages/schemas/src/cosmetics.ts`, `:challenges.ts`); ce paquet n’est pas un kit UI. Les écrans Studio relaient les contrats via leur serveur local. Dans `apps/studio/server/src/index.ts:439`, `:459`, `:470`, `:487` et `:501`, chaque domaine est branché comme une route séparée, tandis que le même fichier compose beaucoup de runtimes. Cela crée un couplage au niveau du point de composition, mais les implémentations sont déjà partiellement rangées par domaine. Le contour de migration naturel est le composant d’écran et son relais de domaine, pas une restructuration générale.

### UI, style et cycle de vie

#### Présentation

- Le shell est assemblé dans `apps/studio/web/src/main.ts:57`, `:82`, `:96`; il monte les vues métier au démarrage (`:97`, `:133`) et les affiche/masque selon l’onglet (`:137`, `:184`). Les deep links `?tab=` et l’onglet mémorisé en `localStorage` font partie du comportement existant (`:187`, `:221`, `:239`). Les identifiants d’onglet et ces liens sont donc des surfaces de compatibilité.
- Les écrans sont surtout du DOM natif et des fragments HTML construits dans leurs fichiers. Le montage s’appuie sur `root`, des `data-slot`/`data-act`, des écouteurs et des `fetch` locaux (`studio-home.ts:85`, `:138`, `:151`; `challenges.ts:1`; `cosmetics.ts:1`).
- Le style global (`style.css`) définit les bases; les CSS métier sont importés par `main.ts:1`, `:16`, tandis que `challenges.ts:6` et `cosmetics.ts:6` importent leur propre CSS. Les styles coexistent dans un même document; toute nouvelle vue devrait utiliser un préfixe de classes propre et éviter les règles globales. `commands.ts` compte 2 068 lignes et `commands.css` 4 457; `tombola.ts` 1 722 et `tombola.css` 1 673. Les grosses vues existent déjà à côté de composants plus petits, ce qui plaide pour l’extraction progressive quand une zone est effectivement touchée.
- La règle de dépôt est explicite : nouveau module/écran dans un fichier dédié, extraction des parties existantes seulement quand elles doivent changer, UX validée conservée (`CLAUDE.md:30`, `:36`, `:39`).

#### Polling et événements

La plupart des panneaux interrogent le serveur local, et non le Core directement. Le shell transmet `setVisible` aux écrans (`main.ts:141`, `:185`); des écrans démarrent leur polling seulement lorsqu’ils sont visibles, par exemple Tombola (`tombola.ts:1711`), Alertes (`alerts-tab.ts:374`), Home (`studio-home.ts:289`) et les lecteurs (`bonk-lab.ts:144`). Les fréquences vont du cycle 1 s/250 ms de Tombola à 1,5 s pour Alertes et 2 s pour les panneaux d’état. C’est un modèle existant, mais sa gestion est répartie entre composants plutôt que décrite par une interface commune.

Deux exceptions utiles à prendre en compte : le composant Profil interroge `/api/profile` toutes les 3 s et ne retourne ni `setVisible` ni `dispose` (`studio-profile.ts:141`, `:154`); il reste donc actif même hors de l’onglet Home. Le bandeau de profil peut aussi conserver une valeur initiale si le statut n’arrive pas (`main.ts:79`, `studio-profile.ts:96`). Pour les nouveaux écrans, un contrat de cycle de vie minime — montage, visibilité, arrêt/abonnement — aiderait à éviter des timers persistants et des requêtes simultanées, sans introduire de gestionnaire global d’état.

Les flux événementiels sont surtout côté serveur : le runtime du Jeu des mots relaie les événements Core par SSE vers les lecteurs OBS et coupe/reconnecte le flux selon les abonnés (`server/src/word-game/runtime.ts:214`, `:230`, `:239`); le Dock local expose aussi un flux d’événements et heartbeat (`server/src/dock/server.ts:270`, `:285`). Le lien de profil Production vérifie sa connexion par handshake périodique (`server/src/prod-transport/production.ts:66`, `:85`). Ne convertir le polling UI en flux push que pour un besoin de latence établi et un flux déjà détenu par le serveur.

### Profils, permissions et activation

#### Une séparation réelle côté serveur

- Lab est le défaut. Le choix persiste dans `profile.json`, est lu au démarrage, et le changement est suivi d’un redémarrage supervisé (`server/src/prod-transport/profile.ts:10`, `:138`, `:149`, `:171`). Les champs `selected` et `effective` ne sont pas synonymes : une configuration invalide fait revenir au Lab avec un avis (`:227`, `:233`, `:248`).
- La configuration du Core Production et son activation sont séparées. Le serveur vérifie la configuration statique et l’identité liée au Core (`profile.ts:47`, `:180`); le choix de profil décide du runtime lancé. En Production, le Core Lab local n’est pas démarré (`server/src/index.ts:631`, `:660`). Un échec de démarrage des runtimes Production est remonté comme erreur explicite; il ne bascule pas silencieusement sur le Lab (`:681`, `:690`, `:699`).
- La page demande le changement par IPC; le main Electron affiche une confirmation native et redémarre le serveur (`desktop/src/preload.cts:36`, `desktop/src/main.ts:336`, `:348`, `:365`, `:366`). Le serveur n’accepte les mutations de profil que depuis le main de confiance et refuse le basculement si une interaction est en cours (`server/src/prod-transport/production.ts:189`, `:261`, `:265`).
- Les routes UI passent par le serveur local, qui vérifie l’hôte d’origine et l’en-tête Studio sur les API sensibles (`server/src/index.ts:406`, `:410`, `:530`). Les secrets de connexion OBS/StreamElements sont gérés par le main et le stockage sécurisé; ils ne sont pas renvoyés à la page (`desktop/src/main.ts:384`, `:425`; `desktop/src/preload.cts:43`, `:51`).
- Le runtime Core Lab possède une base et des migrations dédiées et des paiements simulés, sans Wallet canonique. Cette isolation économique ne garantit pas l’absence d’actions externes : des connexions et contrôles locaux peuvent toujours toucher Twitch/OBS selon leurs réglages (`server/src/runtime/local-runtime.ts:16`, `:21`, `:29`). Le Core et Studio Production sont capables de traiter des opérations réelles, avec le Core comme autorité; chaque module doit afficher l’impact selon son contrat, pas selon une phrase globale (`server/src/prod-transport/production.ts:26`, `:94`, `:100`; `docs/ARCHITECTURE.md:14`).

#### Erreurs de libellé observées dans l’UI

Les phrases incohérentes viennent de littéraux statiques, pas de `profileStatus` :

1. studio-profile.ts:111 compose le bandeau par concaténation de Production et du libellé du Core; le libellé intégré vaut aussi Production (server/src/prod-transport/built-in.ts:11), ce qui explique la répétition visible. La même ligne ajoute toujours paiement simulé quand effective vaut production. Le statut Connecté vient séparément du lien (studio-profile.ts:49, :54, :60). Une action peut alors sembler sans effet réel alors que le profil effectif vaut Production. Le libellé doit être dérivé des métadonnées structurées par profil/module, et un état inconnu ne doit jamais être présenté comme Lab sûr.
2. `studio-home.ts:269`, `:270` affiche « Production — SAMMI + StreamElements » et « Économie de test » sans condition de profil, alors que SAMMI est abandonné et que les routes actuelles sélectionnent le Core du profil (`CLAUDE.md:15`, `server/src/index.ts:631`, `:789`).
3. `studio-home.ts:116` qualifie la Tombola V2 de « Simulation du Lab · migration à venir », bien que le serveur ait une route Tombola V2 (`server/src/index.ts:439`) et que la documentation d’architecture la place parmi les responsabilités Production (`docs/ARCHITECTURE.md:14`, `:16`).
4. Le texte initial de `main.ts:79` dit « Local uniquement · aucun crédit réel » avant que l’appel de statut ne le remplace. Si l’appel de profil échoue, `studio-profile.ts:96` retourne avant d’actualiser le bandeau; un état non confirmé reste alors affiché comme local. Le fallback devrait être « profil/état inconnu » et les actions à impact doivent rester désactivées tant que l’état effectif n’est pas reçu.

La page de profil expose aussi des champs d’installation pour aider l’appairage. Aucun de leurs contenus n’est nécessaire à l’audit; les valeurs n’ont pas été recopiées.

### Risques par intégration

| Domaine                | Risque de migration                                                                                                                                                | Garde-fou recommandé                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wallet / paiements** | Libellé Lab/Production erroné, appel UI direct ou double action pourrait masquer un débit/remboursement réel. Les défis et achats sont particulièrement sensibles. | Garder Core seul arbitre des soldes/prix/récompenses. Distinguer configuration, profil effectif, connexion, disponibilité du module et activation métier. Idempotence et autorisation restent côté Core; ne jamais tester avec le Wallet réel. |
| **Twitch**             | Une configuration locale ou un OAuth n’est pas nécessairement inactif; les événements peuvent être lus, et certaines actions Twitch ont un effet immédiat.         | Garder les jetons hors du DOM, du stockage Web, de l’URL et des journaux. Lab avec simulateur explicite. Les écritures Twitch restent derrière le serveur et les droits existants.                                                             |
| **OBS / lecteurs**     | Une vue de configuration peut déclencher lecture audio, scène, filtre ou mute. Les URLs de source et clés peuvent donner accès au flux.                            | Tester avec OBS simulé; garder les connexions et secrets dans Electron/main/serveur. Préserver les chemins et contrats des sources OBS existantes, y compris le comportement de lecture au rechargement.                                       |
| **Profil / identité**  | Un nouveau sélecteur UI ou un `hot switch` peut envoyer une identité au mauvais Core ou arrêter une interaction réclamée.                                          | Garder `selected/effective`, validation du Core, confirmation native, verrou `busy` et redémarrage supervisé; ne pas faire du profil un simple état de formulaire.                                                                             |
| **Données locales**    | Mise à jour d’installateur ou refonte peut écraser `.env`, tokens, `.runtime`, médias et journaux.                                                                 | Préserver le dossier de données Studio; la staging release exclut `.env`, tokens et runtime (`desktop/scripts/stage.mjs:1`). Pas de suppression ni migration destructive pour une refonte visuelle.                                            |

### Tests et preuves existantes

Aucun test n’a été lancé pendant cet audit. La suite consultée fournit cependant des points d’appui : 85 fichiers de tests unitaires dans `apps/studio/server/test`, 16 tests Playwright dans `apps/studio/server/e2e` et 8 tests Electron dans `apps/studio/desktop/test`. Il y a des tests d’état de profil (`server/test/prod-profile.test.ts:1`), de garde IPC (`desktop/test/ipc-guard.test.ts:1`), de connexions Twitch et des vues DOM pures; 25 fichiers unitaires du serveur référencent `apps/studio/web/src`.

Le paquet `apps/studio/web/package.json:5` ne déclare pas de script `test` : il a build, typecheck, dev et preview. Les tests de vues vivent dans la suite du serveur, pas dans une suite dédiée du frontend. Des E2E couvrent des parcours d’écran/lecteur tels que `server/e2e/challenges.e2e.ts`, `cosmetic-frames.e2e.ts` et `players.e2e.ts`. Le rapport de livraison note des échecs Windows intermittents, en particulier `alerts-se` (`docs/RELEASE_SITE_HUB.md:11`) et des E2E Studio nommés dans `lb-app/docs/SITE_CONTEXT.md:341`; une relance réussie n’équivaut pas à une validation manuelle (`CLAUDE.md:17`).

Les outils existants suffisent pour migrer par lots sans ajouter un framework : tests unitaires des règles de présentation, tests du serveur sur profils/faux Core, puis E2E Lab. Pour toute écriture de droits, Jetons ou transaction, les règles du dépôt demandent tests de concurrence, idempotence et permissions (`CLAUDE.md:51`).

### Écart de documentation et versions

| Référence                                                           | Ce qu’elle dit                                                                           | État observé / action documentaire                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/ARCHITECTURE.md:3`                                            | Architecture arrêtée au 24/10, Core `0f753c1`; `:19` indique `viewer-web` non commencé.  | `docs/REPRISE.md:52` situe le Core Production à `8a897a5` le 04/11. `lb-app/docs/SITE_CONTEXT.md:54` et `:163` décrivent le site réellement livré dans un autre dépôt. Il faut distinguer le squelette `apps/viewer-web` du site séparé et dater/rafraîchir les versions de l’architecture.                                                                    |
| `docs/ROADMAP.md:3`, `:48`                                          | État du 24/10, mise à jour du 26/10 et Studio officiel 0.1.6 / build local sup.8.        | Ce document ne reflète pas la release 0.1.25 (`docs/REPRISE.md:53`; `docs/RELEASE_SITE_HUB.md:11`). Ne pas prendre son statut module par module pour le checkpoint courant.                                                                                                                                                                                    |
| `docs/OPERATIONS.md:3`, `:84`, `:91`, `:95`                         | Procédures arrêtées au 24/10 et exemple Studio 0.1.7-sup.N.                              | Le workflow de release a depuis publié 0.1.25; les exemples de build local sont historiques. Maintenir les procédures génériques, déplacer/étiqueter l’exemple ancien.                                                                                                                                                                                         |
| `docs/RELEASE_SITE_HUB.md:3`, `:11`, `:21` dans le worktree courant | Compte rendu Core `8a897a5`, site `74f7542`, Studio 0.1.25 publiée.                      | À `origin/main` `8a897a5`, le même fichier reste le plan « rien n’est fait »; les deux commits doc `0c7e564`/`68420a0` du worktree ne sont pas intégrés à `origin/main`. La section qui suit le compte rendu conserve le plan pré-publication; la lire comme plan suivi, pas comme état courant.                                                               |
| `lb-app/docs/SITE_CONTEXT.md:200`, `:287`, `:339`                   | Release Studio 0.1.25 publiée, installation sur le PC à confirmer.                       | L’UI Studio observée durant cet audit affiche 0.1.25; si cette observation est retenue, retirer cette incertitude du checkpoint et de la prochaine action.                                                                                                                                                                                                     |
| `apps/studio/desktop/package.json:20`                               | Version du workspace desktop : 0.1.6.                                                    | Cette version du workspace diffère de la version produit affichée : le workflow accepte une version de release et les métadonnées du build portent cette version (`.github/workflows/studio-release.yml:94`, `apps/studio/desktop/scripts/stage.mjs:186`, `:199`, `:204`). Garder le mécanisme de release et ne jamais bump à la main (`CLAUDE.md:64`, `:72`). |
| Site `SITE_CONTEXT` / worktree                                      | Le checkpoint parle du site livré; branche actuelle `feat/cosmetic-kit`, HEAD `e33d697`. | Le worktree comprend deux commits locaux postérieurs au site Production `74f7542`; ne pas les présenter comme livrés avec le site V2.                                                                                                                                                                                                                          |

## E.2 Contrat d’interaction pour les opérations sensibles

Le tableau décrit l’interface à construire autour des règles existantes. Il n’ajoute pas de permission, d’annulation ou de transaction. Les mots de l’écran doivent suivre le comportement de la route réellement appelée.

| Opération                              | Lecture / prévisualisation                                                                  | Modifier / enregistrer                                                           | Application réelle / activation                                                                                           | Annulation ou retour possible                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Jetons / Wallet / crédits              | Solde, ledger, monnaie, état d’exécution ; test uniquement avec données fictives isolées    | Un ajustement de solde n’est pas un simple paramètre à enregistrer               | Verbe créditer/débiter/rembourser + cible + montant + monnaie + raison ; réponse autoritaire du Core                      | Pas de undo local. Compensation séparée si le système la permet. Ne pas relancer automatiquement après timeout sans vérifier l’idempotence.      |
| Objet Boutique                         | Apparence locale et aperçu du site sans achat                                               | Brouillon Core et asset téléversé sont deux persistances ; ID/type selon contrat | Publication rend l’objet éligible aux usages prévus ; offre ouverte séparément ; don est une attribution réelle           | Abandon des champs non sauvés seulement. Masquer/archiver n’efface pas les propriétés acquises. Aucun effacement d’asset promis.                 |
| Achat Boutique                         | Détail transaction + devise + item + possession                                             | Pas de modification locale du prix de l’achat passé                              | Rembourser avec raison, même devise, effet sur objet/équipement annoncé                                                   | Remboursement idempotent selon Core ; ne pas présenter une réattribution automatique ou le remboursement comme purement visuel.                  |
| Défi                                   | Métadonnées, condition, dry-run sans écriture                                               | Brouillon persistant ; règle verrouillée après première activation               | Activer/reprendre ou recompter peut compter et attribuer immédiatement ; moteur périodique distinct                       | Suspendre/archiver ne récupère pas les gains. Retrait d’objet limité et sensible ; pas de remboursement Jetons depuis Défis.                     |
| Sanction Twitch / Random Ban / Caution | Résultat à blanc quand il existe ; une lecture Twitch reste une lecture externe             | Configuration durée/règles enregistrée selon route                               | Timeout/levée de sanction réels ; éventuel débit Caution traité par Core                                                  | Levée de sanction n’est pas une annulation de la transaction. Afficher résultat Twitch et paiement séparément ; état ambigu reste à vérifier.    |
| Votekick                               | Préécoute locale du son uniquement si contrat le garantit                                   | Durée, son, volume, activation à relire                                          | Vote/action peuvent affecter Twitch/OBS suivant module ; préciser cible                                                   | Arrêter le rendu ne prouve pas que les effets de sanction sont revenus à l’état initial. Utiliser les retours réellement implémentés.            |
| Roue du Sub                            | Voir droits, file, résultat et cas à vérifier                                               | Règles/mode/invitations enregistrés ; droits accordés sont une écriture          | Activer, accorder, lancer/réessayer/rejouer ont des effets différents                                                     | Ne pas dupliquer un droit ni consommer un second tour pour rejouer une animation ; conserver les opérations de revue existantes.                 |
| OBS / effets / Bonk / Chaos            | Aperçu local séparé de l’envoi au lecteur ; un aperçu connecté à la scène peut être visible | Placement/cible/volume : annoncer si appliqué immédiatement ou après Enregistrer | Nommer source/scène/filtre/mute et durée ; distinguer état souhaité et état observé                                       | Stop et restauration dépendent du module. Pas d’arrêt/restauration universel. Conserver les chemins des lecteurs et leur authenticité de profil. |
| TTS / Soundboard                       | File, lecteur prêt, coût et origine de chaque demande                                       | Prix/longueur/cooldown sont réglages ; la file est une ressource en cours        | Pause, stop, rejeter, jouer, réessayer et rembourser sont des commandes distinctes                                        | Ne pas rembourser par hypothèse lors de stop. Préserver crédits TTS/Soundboard, Jetons et paiements Twitch comme unités distinctes.              |
| Tombola / jeux                         | Configuration et historique ; simulation de chat explicitement identifiée                   | Préparer un prochain tirage ne modifie pas silencieusement la manche en cours    | Lancer, tirer, annuler et réessayer un paiement sont des opérations réelles selon profil                                  | Annulation suit le Core, pas un reset d’état UI. Aucun résultat recalculé au rechargement.                                                       |
| Commandes Twitch                       | Aperçu et test de version enregistrée vs brouillon clairement indiqués                      | Sauvegarder une définition est distinct de l’exécuter                            | Sortie chat réelle, ingestion et activation ne sont pas déduites d’une fenêtre « Simulation »                             | Pas de suppression possible d’un message déjà envoyé par simple undo UI. Les commandes réservées restent protégées.                              |
| Profil Studio / identité / maintenance | selected/effective, connexion, version et état busy                                         | Configuration ne vaut pas activation                                             | Basculement existant par IPC + confirmation native + redémarrage ; installation/redémarrage hors action ordinaire de live | Conserver verrou d’interaction en cours et retour explicite ; pas de hot switch qui conserve des lecteurs de l’ancien profil.                    |

**Règle d’erreur commune :** si la réponse d’une écriture est perdue, afficher « Demande envoyée, résultat à vérifier » avec l’identifiant disponible et un chemin de relecture. « Réessayer » n’est automatique que pour une commande dont le backend garantit la répétition sans double effet. L’UI désactive le double clic, mais cela ne remplace pas l’idempotence et les verrous Core.

**Points d’arbitrage fonctionnel séparés :** l’éligibilité d’objets masqués/archivés comme récompense Défis diverge de la documentation ; le retrait d’un objet peut toucher une possession obtenue ailleurs ; la reprise de Défis peut rattraper la fenêtre de suspension ; la tolérance réelle des dimensions de badge diffère du texte. Ces questions doivent être décidées avec les propriétaires des règles. Aucun filtre UI ne doit se présenter comme une nouvelle règle économique officielle, et aucune correction Core n’est appliquée par le présent dossier.

## E.3 Abstractions UI minimales

Introduire seulement ce qui rend les nouvelles vues cohérentes et évite une double implémentation. La structure suivante est une spécification, pas du code ajouté :

```text
Destination
  id, libellé, alias historiques, groupe, icône, route canonique
  fonction de montage / activation de la vue existante

Action UI
  id stable, module propriétaire, libellé, intention
  capacité / disponibilité selon état serveur
  portée [local | Core | Twitch | OBS | paiement]
  version utilisée [enregistrée | brouillon si route dédiée]
  paramètres / ouverture du panneau / confirmation nécessaire
  exécution via l’adaptateur actuel, résultat et relecture
  compensation uniquement si une route existante la fournit

Vue
  mount(root), setVisible(bool), dispose()
  arrêt timers / listeners / requêtes à la fermeture
```

Le registre est un index de navigation et de commandes UI, pas un second moteur métier. Il ne contient ni prix, ni permissions décidées côté navigateur, ni règle de victoire. La palette, les favoris et la régie lisent cet index et ouvrent le même panneau ou la même fonction d’action. Le serveur/Core restent responsables du refus.

**Styles :** nouveaux tokens et primitives sous préfixe `rs-` ou un scope racine ; anciens `.hw`, `.al`, `.cmd` conservés tant que leur vue n’a pas migré. Éviter d’ajouter une règle `.row`, `.card` ou `button` globale qui casse un module encore ancien. Ne pas importer directement la feuille du site dans tout Studio ; le rendu cosmétique déjà généré par Core reste une frontière partagée spécifique.

**État :** conserver la sélection/filtres/scroll par destination ; les brouillons de formulaire dans leur contrôleur, avec dirty state ; les statuts opérationnels dans une lecture partagée du serveur quand plusieurs surfaces les affichent. Ne pas monter deux contrôleurs qui pollent et commandent la même file. Une future optimisation des flux doit répondre à une latence mesurée ; aucun event bus ou store global complet n’est requis pour déplacer une page.

**Navigation :** adaptateur UI autour des `?tab=` historiques ; pas besoin d’une migration de framework. Une route canonique doit pouvoir sélectionner un module et un détail sans recharger les lecteurs. Les anciennes URL OBS, chemins HTML, tokens de profil et contrats SSE sont des intégrations externes à conserver.

## E.4 Lots de migration cohérents

Les coûts sont relatifs à l’existant, sans estimation calendaire garantie. Chaque lot livre une capacité utilisable et testée ; le suivant peut attendre sans laisser quinze modules à moitié convertis. Une ancienne vue peut être conservée comme implémentation derrière la nouvelle navigation jusqu’à son lot.

| Lot / ordre                                             | Résultat utilisable en fin de lot                                                                                                                                     | Dépendances et coût relatif                                                                                                                               | Acceptation / risque / retour                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Vérité des états**                                | Profil, portée et textes actuels cohérents ; plus de faux « paiement simulé » en Production, plus de conseil SAMMI obsolète                                           | Petit lot de présentation, sans modifier routes ou règles. Priorité avant nouvelles actions                                                               | Tests Lab/Prod/inconnu/non appairé/injoignable ; aucune assurance de sécurité sur statut inconnu. Retour UI seul, aucune restauration de base.                                                                                                                                    |
| **1 — Shell + centre + système**                        | Six destinations, catalogue complet, favoris, accueil lisible, connexions/profil/maintenance regroupés ; tous les anciens modules restent accessibles via adaptateurs | Lot moyen ; cycle de vie/navigation et tokens de base. Ne pas réécrire les écrans métier                                                                  | Parcourir les 15 anciens `tab`, alias et surfaces Extension ; historique navigateur ; même profil/dossier de données ; absence de double lecteur/timer. Retour au shell précédent, API intactes.                                                                                  |
| **2 — Défis complet**                                   | Catalogue/état vide, atelier, dry-run, brouillon, activation, suivi, suspension/archive et attribution clairement présentés                                           | Moyen ; dépend du lot 1 et des arbitrages explicites A.5/E.2 sans les modifier en douce                                                                   | Tous les champs et états couverts, erreurs serveur ; condition figée ; run et activation testés sur base locale uniquement. Aucun bouton « annuler les gains » inventé. Ancienne vue maintenable sur contrats identiques.                                                         |
| **3 — Boutique complète**                               | Catalogue, atelier des quatre types, uploads, publication, offres, dons, achats/retours ; aperçu fidèle aux données/rendu du site                                     | Moyen/élevé ; API existantes et validateurs. Le kit local reste outil annexe                                                                              | Formats/poids/dimensions côté serveur ; transparence/marge contrôlées dans Studio, composition de bannière conseillée. Fichier choisi vs téléversé, statut vs offre, remboursement une fois ; propriété déjà acquise et droits. Retour ancien écran sans supprimer images/objets. |
| **4 — Récompenses Twitch et extraction des satellites** | Points de chaîne devient une page récompenses/actions/historique ; Spotify, Random Ban, Caution, Votekick et Roue ont leur destination propre avec toutes leurs vues  | Moyen/élevé ; nombreux composants existent déjà. Extraire le montage, pas les moteurs. Chaque satellite peut être un sous-lot achevé, sans doublon vivant | Ancien lien ouvre le bon panneau ; une seule instance de chaque contrôleur ; règles/test utilisent la version enregistrée ; permissions/monnaies/effets intacts. Aucune fusion de Tombola D4 avec V2 sans preuve.                                                                 |
| **5 — Chaîne audio/visuelle**                           | TTS, Soundboard, Bonk, Alertes et lecteur d’effets disposent de contrôle/réglages/connexion liés ; preview et diffusion clairement séparés                            | Élevé à cause des lecteurs/OBS ; sous-lots complets par module, avec compatibilité des lecteurs                                                           | Fakes OBS/Twitch, un seul consommateur, rechargement/retour après panne, source inactive, paiement/exécution/refund inchangés. Ne pas utiliser le vrai OBS pour les E2E.                                                                                                          |
| **6 — Autres outils de travail**                        | Tombola, Jeu des mots, Commandes, Progression/Daily et Halloween adaptés au shell/tokens avec leurs parcours entiers                                                  | Moyen par module ; conserver organisation utile de Tombola/Commandes. Défi/Boutique restent des écrans achevés                                            | Commandes réservées, favoris/alias/droits, local reveal, planification et histories inchangés ; événements clos distincts d’un module indisponible. Pas de nouveau paramétrage économique de mini-jeux.                                                                           |
| **7 — Régie et activité transversales**                 | Actions éprouvées des lots précédents épinglées, files D4 et arrêts réels intégrés, liens d’historiques/incident/statistiques disponibles                             | Moyen ; chaque action doit avoir contrat/capacité/résultat. Une régie de liens peut exister dès lot 1 ; l’exécution s’ajoute seulement quand qualifiée    | Même action depuis module/palette/régie ; double clic/reconnexion/permissions ; aucune statistique de session inventée ; petit dock utilisable. Retour à régie de liens sans retirer les modules.                                                                                 |
| **8 — Fermeture de coexistence**                        | Ancien shell retiré après couverture prouvée, primitives documentées, alias conservés selon usages                                                                    | Petit/moyen ; après validation des modules, pas pour gagner du temps avant                                                                                | Matrice ancien→nouveau complète, pas de destination perdue, comparaison des paramètres avant/après, aucun accès lecteur cassé. Suppression technique uniquement du code UI prouvé inutile.                                                                                        |

**Storyboard :** lot distinct après localisation de l’artefact, comparaison à l’organisation appréciée et inventaire de ses fonctions. Cela ne bloque pas les lots 0–4. Aucun composant ressemblant vaguement à une timeline ne l’autorise à être supprimé ou remplacé.

## E.5 Tests, livraison et coexistence

**Pas de suite métier lancée pour cet audit documentaire.** Les suites existantes ont été inspectées ; seuls les contrôles de la maquette ont été exécutés. Pour l’implémentation future :

1. Tests de présentation ciblés sur les états réellement risqués : profil inconnu, indisponible, refus d’autorisation, version incompatible, édition modifiée pendant refresh, résultat d’écriture incertain.
2. Tests de composants/règles de mapping utiles : payloads stricts, données de présentation jamais réenvoyées au Core, champs figés, monnaie/unité, action sur version enregistrée vs brouillon.
3. E2E avec transport Core local, Twitch/OBS simulés et base jetable lorsque des écritures sont concernées. Concurrence, idempotence et permissions pour toute zone touchant Jetons/droits/transactions, conformément au projet. Les anciens tests Lab ne doivent pas être supprimés pour obtenir du vert.
4. Vérification de parcours en 1 920×1 080, 1 440×900, 1 280×720 et 960×720, puis docks 480×800 et cas étroit 360 CSS px. Fenêtres réelles, zoom navigateur 125/150/200 %, texte agrandi, panneau ouvert, labels longs, liste vide/longue/erreur et clavier. Ces dimensions sont une matrice de recette future ; elles ne sont pas toutes testées sur Studio pendant cet audit.
5. Typecheck, lint, build et suites pertinentes selon `OPERATIONS`/règles de dépôt au moment du lot. Un échec intermittent connu est rapporté avec preuve ; une relance réussie n’équivaut pas à une validation manuelle par Antoni.

**Conserver pendant la coexistence :** toutes les routes Studio/Core actuelles, les protocoles des lecteurs, les identités et profils, la persistance des réglages, les scripts de release et la séparation du dossier de données. Si un futur besoin UI requiert une API additive, l’ancien Studio doit continuer à fonctionner ; aucune migration DB pour un simple déplacement visuel.

**Éviter deux consoles concurrentes :** le shell route vers un seul contrôleur du module ; les favoris et la régie sont des hôtes ou entrées de ce contrôleur. Ancien et nouveau rendu ne se montent pas simultanément avec deux pollers/consommateurs. Si un retour à l’ancien écran est disponible pendant le lot, il démonte correctement le nouveau.

**Retour arrière :** code UI précédent ou installateur compatible selon procédure ; les données écrites après une activation restent des données métier. Revenir à l’ancienne interface n’annule pas un achat, un don, une sanction ou un défi. Une correction de données se décide et se trace séparément.

**Pour Claude Code :** commencer par `REPRISE`, le SHA/état Git, ce dossier et les documents du module ; choisir un lot complet ; joindre une courte matrice ancien/nouveau/contrat/régression. Implémenter en worktree approprié, garder les dépendances en place, montrer le parcours isolé complet et le diff ciblé. Aucune publication, installation, migration ou action réelle ne découle du seul fait que le dossier existe. Elles suivent les instructions explicites d’Antoni et les règles du projet.

## E.6 Arbitrages qui restent à la décision, sans bloquer l’étude

| Sujet                | Proposition                                   | Ce qu’il faut décider ou vérifier avant le lot                                                                        |
| -------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Ossature             | Six destinations + catalogue + régie          | Tester le repérage avec Antoni sur les noms réels, sans expliquer d’abord l’arborescence.                             |
| Direction artistique | Anthracite / menthe, accents sémantiques      | Choisir cette direction ou adapter l’accent à l’identité existante ; garder contrastes et tokens.                     |
| Régie                | Quelques favoris/actions explicites           | Les 6–8 actions que l’opérateur utilise réellement en live, sans présumer d’une fréquence issue d’analytics absents.  |
| Défis                | Dry-run avant activation, état moteur visible | Arbitrer les écarts de règles A.5 et confirmer la sémantique de reprise/retrait ; ne pas les trancher dans du CSS.    |
| Storyboard           | Préserver son organisation                    | Localiser son artefact et ses actions ; évaluer ses qualités sur pièces.                                              |
| Écrans transversaux  | Composition des données existantes            | API réellement disponibles pour recherche viewers, agrégation d’activité et capacités ; pas de promesse sans contrat. |

---

# Partie F — Charte UX/UI durable pour les futures fonctionnalités

Cette partie doit devenir une référence consultée avant toute interface significative, avec `CLAUDE.md` et la documentation du module. Elle ne remplace pas leurs règles de sécurité, de validation et de livraison.

## F.1 Décider de l’emplacement

1. Décrire l’intention en une phrase : « Je veux … pendant/avant/hors live ». Nommer l’entité métier propriétaire et ses utilisateurs.
2. Si la fonction est un réglage/action d’une entité existante, l’ajouter dans sa page/panneau propriétaire. Son déclencheur peut fournir un lien, pas une copie du formulaire.
3. Si elle possède un cycle autonome, une file, des droits ou un historique cohérent, créer une destination de module dans le domaine existant.
4. Si elle traverse plusieurs domaines en lecture/contrôle, composer une vue transversale avec leurs capacités ; ne pas déplacer leurs règles dans cette vue.
5. Une nouvelle entrée principale exige un usage autonome récurrent non couvert par les six destinations. Un nouveau module ne justifie pas un nouvel onglet global. Une catégorie visuelle peut grouper des liens sans devenir une étape obligatoire.

## F.2 Choisir page, panneau ou onglet

| Forme             | Quand l’utiliser                                                          | À éviter                                                                  |
| ----------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Page              | Tâche longue, création complète, cycle métier autonome, liste importante  | Formulaire complet dans une modale étroite                                |
| Panneau de détail | Consultation/action courte liée à une ligne ; retour à la liste essentiel | Empilement de trois panneaux et navigation invisible                      |
| Section           | Paramètres du même objectif visibles ensemble                             | Carte par champ, contenu toujours replié au point de cacher le principal  |
| Onglet local      | 2–4 vues de travail du même objet/module                                  | Un nouvel onglet pour loger un module sans rapport                        |
| Dialogue          | Décision courte ou conséquence sensible précisément définie               | Confirmation de chaque clic, wizard multi-page, erreur réseau sans sortie |
| Accordéon avancé  | Options rares compréhensibles une fois ouvertes                           | Cacher l’état actif, une monnaie, une dépendance bloquante ou une erreur  |

## F.3 Décrire le contrat avant de dessiner

Chaque nouvelle action doit déclarer : propriétaire, entrée, droits requis, profil effectif, dépendances, paramètres enregistrés/brouillon, persistance, portée externe, résultat confirmé, comportement au timeout, répétition/idempotence, compensation disponible ou absente. Les permissions UI restent des indications ; le serveur les impose toujours.

Une modification immédiate doit être écrite comme telle. Une modification différée utilise Enregistrer/Annuler. L’état « Modifications non enregistrées » n’est pas le statut métier « Brouillon ». Une action aux effets réels a un verbe réel ; « Tester » seul est insuffisant.

## F.4 Formulaires et extensions visuelles

- Regrouper les champs par décision utilisateur, pas par ordre des colonnes SQL. Essentiels visibles, avancés accessibles. Maintenir les limites et validations Core.
- Utiliser primitives/tokens existants. Nouvelle variante seulement si une différence de rôle/état le justifie ; pas une palette par module.
- Proposer un résumé lorsqu’une combinaison de paramètres a un effet difficile à comprendre, et un aperçu fidèle lorsqu’un renderer existe. Ne jamais inventer un montant garanti ou une annulation globale.
- Conserver le brouillon pendant un refresh de statut. Si le backend n’a pas de version/conflit, ne pas promettre une édition collaborative sûre ; relecture avant écriture ou avertissement ciblé selon le contrat.
- Prévoir loading, vide, sans résultat, erreur, indisponible, inconnu, busy, refus de droit et réussite ; ne pas transformer une erreur de chargement en « aucun objet ».

## F.5 Intégrer une action à la régie

La régie accepte les actions fréquentes ou utiles à une urgence, avec cible lisible et résultat observable. Les réglages complexes y ouvrent leur page. Les actions critiques gardent leur confirmation nécessaire et leur raison. Une touche n’embarque pas un second fetch ou une nouvelle règle de remboursement ; elle invoque le même contrat que le module.

Une action globale « tout arrêter », un macro scénario ou un mode de live automatique demande un vrai contrat d’orchestration backend. Ce n’est jamais une commodité de design ajoutée au passage.

## F.6 Recette obligatoire d’une nouvelle zone

Avant livraison d’un lot, joindre une fiche courte :

```text
Intention et destination canonique
Anciennes entrées conservées / nouveaux raccourcis
Fonctions conservées (inventaire avant → après)
Profil, état, droits et portée des actions
Champs persistants / brouillons / application immédiate
Erreurs, timeout, idempotence et retours disponibles
Dispositions : large / fenêtre partagée / dock / texte agrandi
Clavier : focus, retour de panneau, pas de geste obligatoire
Tests exécutés et limites
Validation manuelle d’Antoni : à faire / retour recueilli
```

**Critères de réussite UX :** l’opérateur trouve une destination sans connaître son fichier ou son endpoint ; identifie l’état réel avant d’agir ; distingue aperçu et exécution ; retrouve la même entité depuis ses différentes entrées ; ne perd pas ses champs lors d’un poll ; conserve une action d’arrêt utilisable dans une petite fenêtre. Les cibles de temps de la Partie A sont des hypothèses à mesurer, pas des résultats déjà atteints.

**Méthode de vérification humaine :** faire exécuter 8–10 tâches représentatives avant/après, sans guider le premier clic ; noter mauvais emplacements, retour arrière, hésitations, scroll, erreurs et temps. Tester « trouver la file TTS », « revoir une offre arrêtée », « expliquer ce que ferait Recompter », « arrêter un effet », « accorder un droit Roue », « modifier une commande enregistrée », « comprendre pourquoi Bonk est indisponible ». Vérifier les fonctions rares avec la matrice de conservation, pas seulement les six écrans les plus beaux.

## F.7 Ordre d’application de cette étude

Les invariants métier et les sources vérifiées priment sur une simplification graphique. Les Parties B–D constituent la proposition cohérente à prototyper/choisir ; les lots de E définissent la réalisation progressive ; les règles de F empêchent les ajouts de recréer la barre à quinze onglets.

Aucune suppression de fonctionnalité métier n’est recommandée. Les seuls retraits proposés concernent des libellés obsolètes, la duplication d’implémentations UI une fois leur équivalence prouvée, et les anciennes structures de navigation après migration complète. La richesse reste accessible ; son emplacement et sa portée deviennent prévisibles.

---

# Annexes — preuves et reprise

## Références de lecture

Les chemins abrégés `main.ts`, `challenges.ts`, `cosmetics.ts` et les autres fichiers UI désignent `apps/studio/web/src/`, sauf préfixe explicite. Les références au service Défis sont dans `apps/core-api/src/challenges/`, celles à Boutique dans `apps/core-api/src/cosmetics/`. Les numéros de ligne sont ceux du code `8a897a5` ; les documents peuvent inclure les deux commits documentaires locaux du worktree.

Références prioritaires : `docs/REPRISE.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `OPERATIONS.md`, `RELEASE_SITE_HUB.md`, `CHALLENGES.md`, `COSMETIC_SHOP.md`, `CONTROL_CENTER.md`, `OBS_DOCK.md`, `COMMANDS_V2_STATUS.md`, les documents des modules et `lb-app/docs/SITE_CONTEXT.md` du site. Les sources externes sont citées au point d’application en B.4/C.3.

## Références visuelles

- [Défis actuel, observé en fenêtre réduite](assets/studio-ux-actuel-defis.jpg)
- [Alertes actuel, observé en fenêtre réduite](assets/studio-ux-actuel-alertes.jpg)
- [Accueil proposé](assets/studio-ux-home.png) · [Catalogue/navigation](assets/studio-ux-modules.png)
- [Module Alertes proposé](assets/studio-ux-module.png) · [Atelier Défis](assets/studio-ux-challenges.png)
- [Atelier Boutique](assets/studio-ux-shop.png) · [Régie live](assets/studio-ux-live.png)
- [Défis proposé à 480 px](assets/studio-ux-defis-480.png)
- [Maquette interactive autonome](RAPTORU_STUDIO_UX_UI_2026-11-04.prototype.html)

## État de fin de mission

Audit documentaire et conception terminés. Aucun changement d’application, de Core, de profil actif, de données, de monnaie, de permission ou d’intégration. Seuls ce dossier, sa maquette, ses preuves visuelles et des références documentaires dans REPRISE et CLAUDE ont été ajoutés au worktree. Aucun commit/push/publication. Prochaine étape : choix de direction par Antoni, puis mise en œuvre du premier lot autorisé par Claude Code selon E.4.
