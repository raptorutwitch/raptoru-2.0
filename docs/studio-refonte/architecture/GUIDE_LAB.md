# Lab : tester un module sans Twitch, OBS ni Production

## Ce qui est isolé, et comment le vérifier

| Élément | Lab | Vérification |
|---|---|---|
| Économie | portefeuille Lab fictif (`labEconomy`) ; les modules `labOnly` ne sont **jamais** montés sur l'économie canonique | `modules-host.test.ts` « Lab-only modules are not mounted » |
| Base | PGlite en mémoire (tests), ou le PostgreSQL jetable `studio-ux-test-pg` sur `127.0.0.1:55499` (tests d'intégration) | `docker ps` : le conteneur et le port |
| Core | Core Lab local (`createLabCore`), client Studio limité à une liste de routes `/v1/lab/…` en `127.0.0.1` | `studio/server/src/lab-moderation/proxy.ts` (refuse toute autre adresse ou route) |
| Extension | EBS du Lab, jetons Lab (`Bearer lab.…`), même porte que la Production | `studio/server/test/modules-lab-chain.test.ts` |
| Live | toujours ouvert en Lab (H1) ; en Production, le live canonique | `modules-host.test.ts` (Production : `stream_offline` puis achat) |
| OBS | lecteur fictif (action Studio) | démonstration B |

**Ne jamais toucher** :
- le Studio installé (ports 4100 et 4110) ;
- le dossier de données du checkout principal ;
- les identifiants réels ;
- Coolify.

L'aperçu Studio de développement utilise le port 4411.

## Scénarios reproductibles (automatisés)

| Scénario | Test |
|---|---|
| Démonstration A : compteur, réglage, action Studio, état | `core-api/test/modules-host.test.ts` |
| Démonstration B : coffre, avec achat unique par intention, refus, lecteur réussi ou en échec, expiration, remboursement | `modules-host.test.ts`, `ext-frontier.test.ts` (vraies portes de Production), `modules-lab-chain.test.ts` (vraie chaîne Lab) |
| Concurrence : 10 envois d'une même intention sur deux Cores, course remboursement / expiration / lecteur | `modules-host.integration.test.ts` (PostgreSQL réel) |
| Démonstration C : mini-jeux | `core-api/test/mini-games-settings.test.ts` |

## Avant de dire « ça marche »

Un test automatisé n'est pas une validation : c'est Antoni qui valide, dans le Lab réel.

Vu en navigateur sur la pile isolée par Claude (PREUVES § Limites 7) : les pages Studio et l'achat dans l'Extension Lab.
Ce qu'Antoni doit voir dans le vrai Lab (`npm run studio`) :
- la page « Modules du socle » ;
- la carte « Roulette · Slots · Duels » ;
- le coffre dans l'Extension Lab ;
- le panneau de modération sous le coffre (avec une identité modérateur).
