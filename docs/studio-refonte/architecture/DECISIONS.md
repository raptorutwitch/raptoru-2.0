# Décisions d'architecture (prises seul, mission fondatrice du 05/11/2026)

Décisions techniques ordinaires, prises seul (règle « Workflow » de CLAUDE.md). Une ligne marquée **à arbitrer**
attend Antoni.

| #   | Décision                                                                                                                                                             | Pourquoi                                                                                                            | Alternative écartée                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| D1  | Un module = un objet TypeScript dans un fichier, plus une ligne dans une liste                                                                                       | Le plus simple qui supprime les ~12 listes ; vérifié à la compilation et par `checkModule`                          | Manifeste JSON, moteur de plugins, découverte de fichiers (§ 16 : rien de tout ça) |
| D2  | Un hôte unique (`ModuleHost`) construit par les deux Cores depuis la même liste                                                                                      | Supprime la dérive Lab / Production pour tout nouveau module (C1)                                                   | Réécrire `createCore` et le Core Lab : refonte massive, interdite                  |
| D3  | Un journal générique `module_activity` + `module_state` JSON                                                                                                         | Idempotence, montants, statuts et opérateur pour tous ; pas de migration par module simple                          | Une table par module (coût C6 × N)                                                 |
| D4  | Les capacités sont **calculées depuis l'implémentation** et comparées à la déclaration                                                                               | Une capacité déclarée sans implémentation, ou l'inverse, empêche le démarrage                                       | Liste déclarative seule (pouvait mentir)                                           |
| D5  | La porte de l'extension est une fonction de `@raptoru/schemas` utilisée par la façade de Production ET l'EBS du Lab                                                  | Un seul code pour deux serveurs (E1)                                                                                | Un fichier jumeau par serveur                                                      |
| D6  | La clé d'idempotence vit le temps de l'**intention** (bouton d'achat partagé)                                                                                        | Une reprise après un délai dépassé ne débite pas deux fois                                                          | Une clé par clic (comportement historique)                                         |
| D7  | Le Hub de l'extension montre l'**intersection** de la liste du serveur et des modules connus du client                                                               | Compatibilité dans les deux sens, sans écran vide                                                                   | Version numérotée du protocole (inutile à ce stade)                                |
| D8  | Pas de lecteur OBS universel : le contrat commun est seulement `queued → settle → remboursement unique` et l'expiration                                              | Les rendus OBS n'ont rien en commun au-delà                                                                         | Lecteur générique paramétrable (sur-ingénierie)                                    |
| D9  | Les modules historiques ne sont **pas** migrés vers l'hôte ; ils peuvent le rejoindre par petites étapes (`enabled` propre, lecteur de réglages, défauts identiques) | Règle ASTRA-P1-008 : pas de grand refactor ; règles métier inchangées                                               | Tout migrer (risque Production, aucune décision)                                   |
| D10 | Les réglages des mini-jeux (H10 : mises, délais, plafond du Duel) passent par l'hôte, avec les défauts d'avant ; jamais les chances ni les gains                     | Démonstration C, couverte par H10                                                                                   | —                                                                                  |
| D11 | Modération des modules du socle : un panneau sous le module **et** D4 › « Autres modules » (extension et Studio), la même implémentation                             | Tranché par ton message du 05/11 (« intègre les nouveaux modules dans la console D4 sans deuxième implémentation ») | —                                                                                  |
| D12 | Les migrations `module_activity` de Production sont préparées, **pas appliquées**                                                                                    | Interdiction de migrer une base réelle ; aucun module non `labOnly` n'en a besoin aujourd'hui                       | —                                                                                  |
| D13 | Le générateur `module:new` a deux profils (`admin`, `paid`) et n'écrit que deux fichiers neufs                                                                       | Proportionné ; il ne touche jamais un fichier central                                                               | Générateur qui modifie les listes (fragile)                                        |
| D14 | La page Studio « Roulette · Slots · Duels » ouvre la carte du module ; l'interrupteur et les essais restent sur « Simulation »                                       | Les réglages et l'état réel au même endroit, sans dupliquer l'interrupteur                                          | Copier l'interrupteur dans la carte (deux commandes pour un même état)             |

## Corrections faites en route (bugs trouvés)

- **Liste blanche du client Lab** (`studio/server/src/lab-moderation/proxy.ts`). Il manquait `/v1/lab/module-settings/`,
  `/v1/lab/daily/` et `/v1/lab/modules/`. Conséquence : en profil Lab, les réglages H10 / H12 / H14 (mission
  précédente) et le socle étaient refusés. Les tests de l'époque contournaient ce client. Corrigé et testé sur la vraie
  chaîne (8ef2912).
- **Contrôle d'hôte absent** sur les relais Progression, Boutique et Défis de Studio (037a7db).
- **Pile d'aperçu** (`e2e/lab-stack.ts`) : le relais passé à `null` (paramètre positionnel, S1). Mini-jeux, réglages H10
  et socle étaient injoignables. Bouton d'achat sans style (paraissait désactivé). Trouvés en navigateur, corrigés
  (`dbb1798`).
- **Typecheck du serveur Studio** rouge à cause des tests qui importent des sources web (mission précédente). Corrigé
  (8ef2912).

## Consolidation du 05/11 (mission « Opération fondation totale »)

| #   | Décision                                                                                                                                                   | Pourquoi                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| D15 | Revue indépendante du socle avant toute migration ; ses 13 constats corrigés ou encadrés (`77e614d`)                                                       | Ne pas propager une faille dans vingt modules                                       |
| D16 | Les migrations `module_activity` (jamais appliquées hors tests) sont modifiées sur place : colonnes de réservation et index, en `add column if not exists` | Plus simple et sans risque, plutôt qu'une paire de migrations de plus (C6)          |
| D17 | Modules historiques en **adaptateurs** (stratégie B, `MIGRATIONS.md`) : réglages H10 et état, le moteur reste seul exécuteur                               | Aucune régression ; jamais deux exécuteurs                                          |
| D18 | Un interrupteur qui est un drapeau de déploiement (`VOTEKICK_CHAT`, `CAUTION_CHAT`) est lu, jamais écrit depuis Studio                                     | Changer une variable de Production exige le GO d'Antoni                             |
| D19 | Caution : « prolongé » compté en minutes, plus en prix                                                                                                     | Même règle SAMMI, indépendante d'un tarif changé pendant le devis                   |
| D20 | Bonk, Soundboard, TTS et Tombola restent hors de l'hôte pour l'instant (E)                                                                                 | Supervision et modération D4 déjà complètes ; un adaptateur dupliquerait l'existant |

## Deux environnements : Lab local et Production (05/11, décision d'Antoni)

- **Lab local** : le véritable Core (même point d'entrée `index.ts`, même assemblage `main-server.ts`, mêmes migrations
  que la Production, mêmes portes `/v1/ext`, `/v1/studio`, `/v1/bot`), `CORE_ENVIRONMENT=lab`, données fictives,
  services extérieurs simulés à leur frontière (transport, jamais la règle).
- **Production VPS** : le véritable Core, données et services réels.
- **Pas de staging permanent.** Le Core staging existant (`core-staging.raptoru.fr`) n'est ni supprimé, ni arrêté, ni
  modifié : son retrait éventuel fera l'objet d'une décision explicite. Un test distant ponctuel reste possible
  (Hosted Test Twitch) sans le maintenir au quotidien.
- Conséquence : `extension-lab/lab-ebs.ts` (second backend métier dans Studio), l'assemblage `bonk-lab/lab-core.ts`
  et les migrations jumelles `_lab` sont à retirer une fois le Lab de Studio basculé (MIGRATIONS § « Lab cible »).

## Mission Foundation (06/11)

| #   | Décision                                                                                                                                         | Pourquoi                                                                                                    | Alternative écartée                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| D30 | Le Lab tourne par défaut sur le Core principal ; `npm run studio:legacy` et `E2E_STACK=legacy` restent le retour arrière                         | Autorisé par Antoni une fois la parité prouvée (91/91) ; la validation Electron reste la sienne             | Garder l'option et les deux défauts                                                             |
| D31 | `npm run studio:lab` a sa propre base Docker et son propre dossier de données                                                                    | Aucun `.env`, jeton ou profil Production ne peut y être lu, quel que soit le checkout                       | Lire `apps/core-api/.env` : absent du worktree, réel dans le dossier principal                  |
| D32 | La commande refuse de démarrer à côté d'un autre Studio                                                                                          | Electron partage le verrou du Studio installé et ne fait que lui donner le focus : un échec muet            | Dossier de profil séparé : Electron rejoindrait alors le serveur de Production sur le port 4100 |
| D33 | TTS et Bonk ont une vraie page, aux deux profils ; le lecteur Soundboard de Production passe sur la page Soundboard                              | Ces pages renvoyaient à l'Extension Lab, absente en Production, et les réglages étaient cachés dans Système | Laisser les cartes dans Système                                                                 |
| D34 | La Configuration TTS quitte Modération pour la page TTS, mêmes routes et mêmes règles                                                            | Un prix se règle avec son module                                                                            | Dupliquer l'écran                                                                               |
| D35 | Un module du socle reçoit sa page Studio du catalogue du Core                                                                                    | Une ligne de raccordement de moins, et plus de registre à oublier                                           | Garder l'entrée obligatoire et le test qui la vérifiait                                         |
| D36 | Les vues historiques gardent leurs jetons, leurs valeurs viennent de la charte (`studio-theme.css`) ; la console D4 aussi, côté Studio seulement | Une identité visuelle sans fork ni réécriture ; l'extension garde ses couleurs                              | Réécrire chaque feuille                                                                         |
| D37 | Le retrait de l'ancien Lab reste préparé, pas exécuté, et le profil Lab du Studio installé devient une décision                                  | `stage.mjs` embarque l'ancien Core Lab ; il faut choisir avant de le retirer                                | Retirer maintenant                                                                              |
