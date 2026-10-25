# CI/CD — livrer Raptoru 2.0

Mis en place le 25/10/2026. Tout se fait depuis l'onglet **Actions** du dépôt GitHub, sans ligne de commande. La
Production n'est jamais touchée par un simple push ou une fusion : seuls « Déployer Core / bot » et « Studio —
construire / publier », lancés à la main, agissent sur elle.

```
branche ──► Pull Request ──► CI (verdict automatique) ──► fusion dans main ──► CI complète de main
                                                                          ├─► Déployer Core / bot   (plan, puis deploy)
                                                                          ├─► Studio — construire / publier
                                                                          └─► État de la livraison  (ce qui tourne vraiment)
```

## 1. Livrer une modification

1. Travailler sur une branche, la pousser, ouvrir une Pull Request vers `main`.
2. La **CI** se lance seule. Elle ne teste que ce que la branche touche (Core, bot, Studio, extension…). Résultat :
   onglet « Checks » de la PR. Le job `verdict` en fait le tableau.
3. CI verte → fusionner dans `main`. La CI repasse alors **entièrement** sur le commit de `main` : c'est cette preuve
   que le déploiement exige.
4. Déployer (§ 2) et/ou publier Studio (§ 3) quand c'est le bon moment (jamais pendant un live : c'est vérifié).

Ce que la CI vérifie (`.github/workflows/ci.yml`) :

| Job       | Contenu                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| quality   | cohérence workspaces / lockfile / Dockerfiles / version Node (`scripts/ci/check-workspaces.mjs`), Prettier, ESLint, types, build complet |
| core      | toute la suite du Core, dont les tests d'intégration sur un vrai PostgreSQL 17                                                           |
| bot       | suite du bot                                                                                                                             |
| studio    | serveur et desktop de Studio                                                                                                             |
| extension | tests + archive ZIP de production vérifiée, en artefact (jamais envoyée à Twitch par la CI)                                              |
| e2e       | navigateur (Playwright) sur une pile Lab isolée : lecteurs OBS, alertes, effets, commandes — aucun service réel                          |
| tooling   | outils de livraison (déploiement, garde-fous, CI) avec Coolify, Core, GitHub et PostgreSQL simulés ; actionlint                          |
| images    | les images Docker du Core et du bot, construites comme Coolify les construit (jamais poussées)                                           |

Une PR purement documentaire ne lance que le contrôle de formatage.

## 2. Déployer le Core et/ou le bot

Actions → **Déployer Core / bot** → Run workflow :

| Champ                    | Valeur                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| component                | `core`, `bot` ou `core+bot` (le Core, puis le bot)                                                       |
| sha                      | le commit exact de `main` (40 caractères, bouton « copy full SHA » du commit)                            |
| mode                     | `plan` d'abord (lecture seule), puis `deploy`                                                            |
| migrations               | `none` ; `preapplied` si le SQL a déjà été appliqué à la main ; `post-deploy` (voir § 7)                 |
| rollback                 | coché seulement pour revenir à un commit plus ancien                                                     |
| auto_rollback            | coché par défaut                                                                                         |
| allow_single_live_source | décoché (arbitrage, voir § 6)                                                                            |
| confirm                  | pour `deploy` seulement : `DEPLOY <component> <7 premiers caractères du SHA>`, ex. `DEPLOY core 36a4cec` |

Avant toute écriture, l'outil (`scripts/coolify-deploy.mjs`, le même qu'en local) bloque si :

- la personne n'est pas administrateur du dépôt et listée dans `DEPLOY_ACTORS`, ou le workflow ne vient pas de `main` ;
- le commit n'est pas sur `main`, ou sa CI de `main` n'est pas verte avec les jobs du composant (un commit purement
  documentaire passe sur la preuve du dernier commit de code) ;
- un live est en cours ou n'est pas exclu (§ 6) ;
- un déploiement Coolify est déjà en cours, une variable requise manque (noms seulement), une migration n'a pas de mode ;
- pour le bot : le Core ne tourne pas encore sur ce commit.

Après le déploiement, il vérifie :

- que Coolify a terminé sur ce commit et que l'application est `running:healthy` ;
- que `/health` et `/ready` répondent ;
- que le Core rapporte ce commit lui-même ;
- que le bot détient le bail avec cette version, EventSub et jetons valides ;
- qu'aucune ligne fatale n'apparaît au démarrage.

Le résumé du run donne le verdict (`DÉPLOYÉ`, `BLOQUÉ`, `ÉCHEC`) et la commande de retour. L'onglet « Deployments » du
dépôt garde l'historique.

## 3. Publier Studio

Actions → **Studio — construire / publier** → Run workflow :

- `publish = none` : construit l'installateur sur Windows (GitHub), lance les tests Windows de Studio, vérifie le
  paquet (version, sha512, blockmap, flux de mise à jour, aucun secret), puis **teste une mise à jour** : la dernière
  version publique installée, les données d'un streamer posées (profil, `studio.json`, OBS, StreamElements,
  connexions Twitch / Spotify, `.env`, jetons), la nouvelle version installée par-dessus → tout doit rester identique
  à l'octet près. L'installateur est en artefact (Run → Artifacts), avec `SHA256SUMS.txt`.
- `publish = draft` : en plus, un **brouillon** dans `raptoru-studio-releases` — invisible pour les Studio installés.
- `publish = public` : en plus, publié et retéléchargé anonymement pour comparaison. Le Studio installé le **propose**
  (« Rechercher une mise à jour ») mais ne télécharge ni n'installe rien seul. Confirmation :
  `PUBLISH studio <7 premiers caractères du SHA de main>`.

Version : vide = patch suivant de la dernière version publique (0.1.6 → 0.1.7). Le `package.json` du dépôt n'est
plus modifié par les publications : l'étiquette `studio-v<version>` relie la version à son commit.

Signature : les installateurs ne sont pas signés (comme toutes les versions déjà publiées). La mise à jour automatique
fonctionne (l'application installée n'exige aucune signature) ; Windows SmartScreen avertit lors d'une installation
manuelle. Signer demande un certificat (OV/EV, payant) : décision ASTRA-P3-001, avant toute diffusion à des tiers.

`npm run studio:release` (local) reste disponible et inchangé.

**Version 0.1.7 (25/10)** : construite par ce workflow (`34e4120`, artefact vérifié), mise à jour contrôlée avant
publication avec electron-updater lui-même (0.1.7 proposée à `0.1.7-sup.10` et à 0.1.6, rien proposé à 0.1.7,
téléchargement et SHA-512 acceptés), puis publiée : brouillon, publication, re-téléchargement anonyme identique.

**Publication depuis GitHub validée (25/10)** : `publish = draft` a construit 0.1.8 sur Windows, testé la mise à jour
0.1.7 → 0.1.8 (données intactes), créé le brouillon avec `STUDIO_RELEASES_TOKEN` ; fichiers retéléchargés identiques
à la construction (SHA-256, SHA-512 de `latest.yml`), brouillon invisible anonymement ; brouillon, étiquette et
artefact de test supprimés ensuite, 0.1.7 inchangée. Secours sans GitHub : `node apps/studio/desktop/scripts/release.mjs
--publish-from=<dossier de l'artefact> [--public]` depuis le PC (connexion `gh`).

## 4. Si un déploiement échoue

1. Lire le résumé du run : la ligne `VERDICT` et la liste « Problèmes ».
2. `BLOQUÉ` = rien n'a été modifié. Corriger la cause (attendre la fin du live, faire passer la CI, donner le mode de
   migration, créer la variable manquante…) et relancer.
3. `ÉCHEC` après déploiement :
   - sans migration dans la plage et hors live, le retour arrière automatique a déjà été tenté : le résumé dit
     « Retour arrière : effectué » ou « EN ÉCHEC » ;
   - sinon, relancer le workflow avec `sha` = le commit précédent (colonne « Précédent » de « État de la livraison »),
     `rollback` coché, `mode = deploy`. Un commit ayant déjà tourné en Production n'a pas besoin de CI.
4. Une migration n'est jamais annulée automatiquement : un retour de code sur un schéma migré se décide à la main.
5. Diagnostic conservé : artefact `deploy-…` (journal sans secret, 90 jours) et onglet Deployments.

En local (même outil, mêmes règles) : `node scripts/coolify-deploy.mjs status core`, `plan core <sha>`,
`deploy core <sha>` (dry-run), `deploy core <sha> --go`. En local, OBS peut servir de source de live
(`OBS_WS_URL=ws://127.0.0.1:4455`, `OBS_WS_PASSWORD_FILE=~/.raptoru/obs-ws-password.txt`).

## 5. Secrets et variables (Settings → Secrets and variables → Actions)

| Nom (secret)                                | Pour                                      | Valeur                                                                                                                         |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `COOLIFY_URL`                               | Déployer, État                            | **en place** : `https://coolify.raptoru.fr` (voir « HTTPS de Coolify »)                                                        |
| `COOLIFY_TOKEN`                             | Déployer, État                            | **en place** : le jeton Coolify « raptoru-deploy-automation » (read, write, deploy, read:sensitive), copie de `~/.raptoru`     |
| `OPS_TOKEN`                                 | Déployer, État                            | **en place** : la même valeur que la variable `OPS_TOKEN` de `raptoru-core` dans Coolify et que `~/.raptoru/ops-token.txt`     |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Déployer (3e source de live, facultative) | absents (inutiles : le Core fournit déjà deux sources) ; sinon une application Twitch dédiée, sans droit utilisateur           |
| `STUDIO_RELEASES_TOKEN`                     | Studio (draft / public)                   | **en place** : jeton « fine-grained », dépôt `raptoru-studio-releases` uniquement, « Contents: Read and write » (à renouveler) |

| Nom (variable)                | Valeur                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `DEPLOY_ACTORS`               | `raptorutwitch` (défaut si absente) — comptes autorisés à déployer / publier            |
| `COOLIFY_ALLOW_INSECURE_HTTP` | absente. `true` = arbitrage explicite d'envoyer le jeton Coolify en clair (déconseillé) |

**HTTPS de Coolify (adresse définitive depuis le 25/10)** : `https://coolify.raptoru.fr` (DNS OVH : A `coolify` →
`62.84.187.170`), certificat Let's Encrypt renouvelé automatiquement par Traefik.

- projet Coolify « Raptoru ops », application `coolify-api-https` (nginx) ;
- seul `/api/` est transmis à Coolify (`http://coolify:8080`, réseau interne). Le reste répond 404 : l'interface de
  Coolify n'est pas exposée ici. Le HTTP en clair est redirigé vers HTTPS ;
- toutes les routes de l'API exigent le jeton (401 sinon), sauf `/api/health`, la sonde publique de Coolify, qui ne
  renvoie aucune donnée ;
- l'adresse provisoire `https://core-staging.raptoru.fr/_coolify` (du 25/10 matin) est retirée ;
- l'interface de Coolify reste accessible comme avant sur `http://62.84.187.170:8000` (accès direct, non chiffré) ;
- les scripts (`coolify-deploy.mjs`, `delivery/status.mjs`) visent `https://coolify.raptoru.fr` par défaut, en local
  comme depuis GitHub.

`OPS_TOKEN` : en place depuis le 25/10 (variable de `raptoru-core`, secret GitHub, `~/.raptoru/ops-token.txt`). Le Core
`34e4120`, déployé le 25/10 en local avec deux sources de live (Twitch Helix et OBS), sert `/v1/ops/status`. Depuis,
GitHub dispose de deux sources de live sans aucun secret Twitch : la session de stream du Core et Helix interrogé par le
Core.

## 6. Jamais pendant un live

Sources : la session de stream du Core (EventSub → bot → Core) et Twitch Helix interrogé par le Core lui-même (toutes
deux via `GET /v1/ops/status`), plus Helix depuis GitHub si `TWITCH_CLIENT_ID/SECRET` existent, plus OBS en local.

- une source dit « en live » → **bloqué**, toujours ;
- au moins deux sources disent « hors live » → autorisé ;
- une seule source sûre, les autres inconnues (Twitch en panne, Core injoignable…) → **bloqué**, sauf la case
  `allow_single_live_source` (arbitrage explicite, écrit dans le résumé) ;
- vérifié au plan, juste avant la première écriture, et entre le Core et le bot de `core+bot`.

Si un live démarre pendant un déploiement déjà lancé dans Coolify : il n'est pas interrompu (couper une construction
en cours serait pire) ; l'étape suivante (le bot de `core+bot`, un retour arrière automatique) ne part pas.

Sans risque pendant un live : la CI, les builds Studio (`publish = none`), « État de la livraison », les plans.

## 7. Migrations PostgreSQL

Aucune opération SQL sur la Production n'est faite par la CI/CD sans mode explicite :

- `none` : la plage n'en contient aucune (sinon bloqué) ;
- `preapplied` : le SQL a été appliqué **avant** par Antoni (terminal de la base dans Coolify), comme pour Spotify V2.
  Le nouveau conteneur vérifie sur la vraie base que chaque objet existe avec la bonne définition, puis le migrateur
  les enregistre ; tout écart = `ÉCHEC`. Exige une sauvegarde de moins de 60 min et le droit `read:sensitive` ;
- `post-deploy` : le migrateur s'exécute après le déploiement (commande post-déploiement de Coolify). Attention : Coolify
  bascule le trafic **avant** cette commande (≈ 50 s observées le 24/10) — à réserver aux migrations dont le nouveau
  code n'a pas besoin pour démarrer.

Aucune connexion PostgreSQL publique n'est ouverte pour la CI. Retour arrière : le code revient, le schéma reste.

## 8. Vérifier sans toucher la Production

- La CI d'une branche / PR ne lit aucun secret.
- « Déployer » en `mode = plan` : plan complet, CI, live, variables, migrations — aucune écriture.
- Localement :
  - `node --test scripts/*.test.mjs scripts/ci/*.test.mjs scripts/delivery/*.test.mjs` : déploiement, garde-fous et CI
    contre des simulateurs ;
  - `node scripts/ci/check-workspaces.mjs` ;
  - `node scripts/delivery/status.mjs`.
- « Studio — construire / publier » en `publish = none` : installateur et test de mise à jour, sans publication.

## 9. Traçabilité

Actions → **État de la livraison** (ou `node scripts/delivery/status.mjs`) :

- le commit de `main` et sa CI ;
- pour le Core et le bot : le commit déployé selon Coolify **et** selon le service lui-même, le précédent (retour
  arrière) et le retard sur `main` ;
- les migrations à venir ;
- la dernière version publique de Studio, et le Studio installé (sur le PC).

Les documents (REPRISE, ROADMAP) résument ; en cas d'écart, l'état constaté fait foi.

## 10. Sécurité

- Dépôt privé, plan GitHub Free : ni règles de protection de branche ni environnements protégés. Compensations :
  - les workflows qui utilisent des secrets ne se lancent qu'à la main, depuis `main` ;
  - ils vérifient eux-mêmes l'identité et le rôle d'administrateur ;
  - un seul collaborateur (administrateur) peut pousser des branches.
- Limite assumée : une branche modifiée par quelqu'un ayant le droit d'écriture pourrait lire les secrets du dépôt
  (aucun environnement protégé sur ce plan). Ne jamais ajouter de collaborateur en écriture sans passer à GitHub Pro
  (environnement `production` limité à `main`, relecteur obligatoire).
- Aucun `pull_request_target` ; la CI des PR n'a aucun secret ; permissions minimales par job ; actions épinglées par
  SHA vérifié, actionlint par empreinte d'image.
- Jetons jamais affichés (masqués par GitHub et par l'outil), jamais dans les artefacts.
- Coût : sur un dépôt privé gratuit, 2 000 minutes Actions par mois (Windows compte double). Une CI complète ≈ 40
  minutes-runner, une construction Studio ≈ 40–60 minutes facturées. Suivre Settings → Billing.
