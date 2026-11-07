# Lab : tester un module sans Twitch, OBS ni Production

## Le Lab sur le véritable Core (par défaut depuis le 06/11)

`npm run studio:lab` :

- refuse de démarrer si un Studio tourne déjà (Electron ne ferait que lui donner le focus) ;
- démarre la base du Lab, `raptoru-lab-core-pg` (Docker, `127.0.0.1:55460`, son propre volume) ;
- ouvre Studio sur `.lab-data` : aucun `.env`, aucun jeton, aucun profil Production ne peuvent y être lus ;
- Studio prépare `raptoru_core_lab` et lance le Core principal (`CORE_ENVIRONMENT=lab`, port 4302, 127.0.0.1), puis lui parle
  comme au VPS.

Twitch, comptes, Jetons et OBS y sont fictifs ; le Core refuse de démarrer avec une base distante, une autre chaîne que
900100, une app Twitch réelle ou `OPS_TOKEN`.

- Retour à l'ancien Lab : `npm run studio:legacy` ; `E2E_STACK=legacy npx playwright test`. Son retrait : [RETRAIT_ANCIEN_LAB.md](../RETRAIT_ANCIEN_LAB.md).
- Vérifier : `npx playwright test` (toutes les specs) ; recette sur un vrai serveur : `studio-lab.boot.ts`.
- **Attention** : `npm run studio` lit le dossier de données du checkout. Depuis le dossier principal, il y trouverait le profil
  Production. Pour le Lab, toujours `npm run studio:lab`.
- Le tableau ci-dessous et la suite décrivent encore l'ancien Lab là où ils citent `createLabCore`, `LabEbs` ou `lab-stack.ts`.

## Ce qui est isolé, et comment le vérifier

| Élément   | Lab                                                                                                                 | Vérification                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Économie  | portefeuille Lab fictif (`labEconomy`) ; les modules `labOnly` ne sont **jamais** montés sur l'économie canonique   | `modules-host.test.ts` « Lab-only modules are not mounted »                       |
| Base      | PGlite en mémoire (tests), ou le PostgreSQL jetable `studio-ux-test-pg` sur `127.0.0.1:55499` (tests d'intégration) | `docker ps` : le conteneur et le port                                             |
| Core      | Core Lab local (`createLabCore`), client Studio limité à une liste de routes `/v1/lab/…` en `127.0.0.1`             | `studio/server/src/lab-moderation/proxy.ts` (refuse toute autre adresse ou route) |
| Extension | EBS du Lab, jetons Lab (`Bearer lab.…`), même porte que la Production                                               | `studio/server/test/modules-lab-chain.test.ts`                                    |
| Live      | toujours ouvert en Lab (H1) ; en Production, le live canonique                                                      | `modules-host.test.ts` (Production : `stream_offline` puis achat)                 |
| OBS       | lecteur fictif (action Studio)                                                                                      | démonstration B                                                                   |

**Ne jamais toucher** :

- le Studio installé (ports 4100 et 4110) ;
- le dossier de données du checkout principal ;
- les identifiants réels ;
- Coolify.

L'aperçu Studio de développement utilise le port 4411.

## Scénarios reproductibles (automatisés)

| Scénario                                                                                                                | Test                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Démonstration A : compteur, réglage, action Studio, état                                                                | `core-api/test/modules-host.test.ts`                                                                                         |
| Démonstration B : coffre, avec achat unique par intention, refus, lecteur réussi ou en échec, expiration, remboursement | `modules-host.test.ts`, `ext-frontier.test.ts` (vraies portes de Production), `modules-lab-chain.test.ts` (vraie chaîne Lab) |
| Concurrence : 10 envois d'une même intention sur deux Cores, course remboursement / expiration / lecteur                | `modules-host.integration.test.ts` (PostgreSQL réel)                                                                         |
| Démonstration C : mini-jeux                                                                                             | `core-api/test/mini-games-settings.test.ts`                                                                                  |

## Avant de dire « ça marche »

Un test automatisé n'est pas une validation : c'est Antoni qui valide, dans le Lab réel.

Ce qu'Antoni doit voir dans le vrai Lab (`npm run studio:lab`) : [RECETTE_FOUNDATION.md](../RECETTE_FOUNDATION.md), notamment :

- la page « Modules du socle » ;
- la carte « Roulette · Slots · Duels » ;
- le coffre dans l'Extension Lab ;
- le panneau de modération sous le coffre (avec une identité modérateur).

## Pile d'aperçu (mise à jour du 05/11)

`e2e/lab-stack.ts` (port 4411) sert maintenant :

- la même chaîne de relais que le vrai Studio (mini-jeux, réglages, socle) ;
- le relais `/api/lab` (console D4 de Studio).

Il n'a toujours ni lecteurs ni Points de chaîne : Votekick et Caution y affichent « indisponible », honnêtement.

**Arrêt.** Arrêter la tâche laisse le processus `node … lab-stack.ts` vivant. Vérifier la ligne de commande du processus
qui écoute sur 4411, puis l'arrêter. Jamais un autre.
