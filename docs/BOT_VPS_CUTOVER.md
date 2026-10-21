# Bascule du bot LeCroupier_ : PC → VPS Contabo (lot 4) — procédure

**Révisée le 21/10/2026 pour l'exécution.** Toujours **hors live**.

- 🖐 : geste d'Antoni (le garde-fou de Claude Code bloque les déploiements et redémarrages Coolify) ;
- 🤖 : vérification faite par Claude, en lecture seule.

Aucune étape ne touche aux Jetons, aux Daily ni à l'historique, et aucun test n'utilise de vrais Jetons.

**Résultat visé :** le bot tourne en permanence sur le VPS, supervisé par Docker et journalisé. Sur le PC : **Studio et OBS seulement**.
`run-production.ps1` reste un mode de secours, jamais un prérequis.

**Règle absolue :** jamais deux bots actifs.

- Depuis les lots 1 et 2, un bot ne se connecte à Twitch qu'en détenant le bail du Core.
- Le seul moment sensible est l'ancien bot du PC, qui ne connaît pas le bail. Il doit être **remplacé (étape 5) avant** le premier démarrage du VPS (étape 6).

Fichiers privés, hors git, à ne jamais coller dans une conversation : `C:\Users\Antoni\Documents\Raptoru\_migration-exports\production\`

- `migration-39.txt` : la commande de migration protégée, sans aucun secret à l'intérieur ;
- `raptoru-bot.env` : les variables du bot pour Coolify, **avec secrets**.

---

## 1. 🤖 Préparatifs (faits)

- Lots 1 à 3 commités et poussés sur `origin/main`.
- Protection serveur tolérante pendant la fenêtre de déploiement : tant que la table `bot_lease` n'existe pas, les routes du bot restent servies, pour que l'ancien bot ne reçoive
  pas d'erreurs 500 entre le déploiement et la migration.
- Image du Core construite en local. Le script de migration 39 a été testé dans cette image, sur une base jetable aux 38 migrations de la Production :
  - seule la 39 est appliquée ;
  - l'économie est identique avant et après ;
  - un second passage ne fait rien.
- Image du bot construite et testée contre un faux Core, sans jeton et sans aucun appel Twitch (lot 2).

## 2. 🖐 Sauvegarde de la base Production

Coolify → base `raptoru_prod` → **Backups** → **Backup now**, ou un `pg_dump` comme le 20/10. Me donner l'heure de la sauvegarde.

## 3. 🖐 Déployer le Core

Coolify → `raptoru-core` → **Redeploy**. Le commit doit être celui de `origin/main` que je donne, pas `473de25`.

- **Pendant le déploiement (environ 2 min), le bot actuel du PC continue :** il met en file ce que le Core ne prend pas, puis le rejoue.
- **Attendu :** `running:healthy` et `https://core.raptoru.fr/ready` → `ready`.

## 4. 🖐 Appliquer la migration 39 (Terminal du Core)

Coolify → `raptoru-core` → **Terminal**. Coller **tout** le contenu de `migration-39.txt` (une seule ligne). Sortie attendue :

```
cible: 4jaqdyvzlelgwkyvuxhjy4mr /raptoru_prod
migrations appliquées: 38 | non appliquées (les *_lab sont hors Production, normal): …_lab.sql (×5), 20261031130000_bot_instance.sql
migrate exit: 0 | applied: 20261031130000_bot_instance.sql
migrations maintenant: 39 | nouvelle: OUI | tables: bot_instances,bot_lease
économie avant : {…}
économie après : {…}            ← identique
ÉCONOMIE INCHANGÉE ✔
bail: 0 ligne(s) (0 attendu)
```

Tout `REFUS` ou `ÉCART` : **stop**, me coller la sortie.

🤖 Je vérifie ensuite en lecture seule : `/ready`, statut du bot `none`, et le bot actuel qui répond toujours.

## 5. Remplacer le bot du PC par la version avec bail (toujours sur le PC)

1. 🤖 Je reconstruis le bot (`npm run build`). C'est sans effet sur le processus en cours, qui a déjà chargé l'ancienne version.
2. 🖐 Dans la fenêtre du bot : **Ctrl+C** (pas la croix), puis relancer
   `powershell -ExecutionPolicy Bypass -File apps\twitch-bot\scripts\run-production.ps1`.
3. Journal attendu : `waiting for the lease…`, puis `bail obtenu : cette instance est le bot actif`.
4. 🤖 Je vérifie le statut : `active`, `host: pc`, EventSub connecté.

## 6. 🖐 Créer `raptoru-bot` dans Coolify (il **attendra**)

Projet **Raptoru 2.0**, environnement **production**, **+ New → Application**, même dépôt et même branche (`main`) que `raptoru-core`, même serveur et
même destination (`coolify`).

| Réglage                 | Valeur                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Build pack              | **Dockerfile**                                                                                                                                  |
| Base directory          | `/`                                                                                                                                             |
| Dockerfile location     | `/apps/twitch-bot/Dockerfile`                                                                                                                   |
| Domaines                | **aucun**                                                                                                                                       |
| Ports exposés           | aucun ; si Coolify exige une valeur : `3000` (rien n'écoute, aucune route publiée sans domaine)                                                 |
| Déploiement automatique | **désactivé**                                                                                                                                   |
| Health check Coolify    | désactivé : c'est le `HEALTHCHECK` du Dockerfile qui fait foi, comme pour le Core                                                               |
| Persistent storage      | **Volume mount** : nom `raptoru-bot-data`, destination `/data`                                                                                  |
| Variables               | Environment Variables → **Developer view** → coller **tout** `raptoru-bot.env` (17 variables, `CORE_API_URL=https://core.raptoru.fr` au départ) |

Puis **Deploy**.

- **Attendu dans le journal du conteneur :** `instance vps-… (vps): waiting for the lease`, puis `en attente : une autre instance est active (pc, pc-…) — aucune connexion Twitch`.
- **Attendu dans Coolify :** le conteneur passe `healthy` en moins de 2 min.
- 🤖 Je vérifie : actif `pc` et une instance en attente `vps`.

> Si le journal du VPS affiche `bail obtenu`, faire **Stop** aussitôt et me prévenir : le PC ne tiendrait pas le bail.

## 7. 🖐 Réseau Docker privé (décision A4)

`raptoru-bot` → **Terminal** :

```sh
node -e "fetch('http://3m7cputub9wt7nwx2k78cme3:3000/health').then(r=>r.text()).then(console.log,e=>console.log('KO',e.message))"
```

- **`{"service":"core-api","status":"ok"}`** : remplacer `CORE_API_URL` par `http://3m7cputub9wt7nwx2k78cme3:3000`, puis **Redeploy**. Le conteneur repart en attente.
- **KO** : garder `https://core.raptoru.fr`. Ça fonctionne tout autant ; ce n'est qu'une optimisation.

## 8. Bascule, environ 3 min, le bot coupé quelques minutes, hors live

L'ordre évite toute course entre les deux instances et tout renouvellement de jeton entre la copie et le démarrage.

1. 🖐 Coolify → `raptoru-bot` → **Stop**. L'instance en attente s'arrête, et le PC reste actif.
2. 🖐 Dans la fenêtre du bot du PC : **Ctrl+C**. Le bail est libéré, et **plus aucun bot ne tourne**.
3. 🖐 Copier les jetons, que le bot du PC arrêté ne renouvelle plus, vers le VPS, sans afficher leur contenu (PowerShell, dans le dossier du dépôt) :

   ```powershell
   scp apps\twitch-bot\.twitch-tokens.json apps\twitch-bot\.twitch-tokens.broadcaster.json root@<IP du VPS>:/root/raptoru-bot-tokens/
   ```

   Créer le dossier avant si besoin : `ssh root@<IP> mkdir -p /root/raptoru-bot-tokens`.

4. 🖐 Sur le VPS, en SSH, les déposer dans le volume :

   ```sh
   V=$(docker volume ls --format '{{.Name}}' | grep raptoru-bot-data); echo "$V"
   docker run --rm -v "$V":/data -v /root/raptoru-bot-tokens:/src:ro alpine sh -c \
     'cp /src/.twitch-tokens.json /src/.twitch-tokens.broadcaster.json /data/ && chown 1000:1000 /data/.twitch-tokens*.json && chmod 600 /data/.twitch-tokens*.json && ls -la /data'
   shred -u /root/raptoru-bot-tokens/.twitch-tokens*.json && rmdir /root/raptoru-bot-tokens
   ```

   Attendu : un seul nom de volume affiché, puis les deux fichiers (`node`/`1000`, `-rw-------`).

5. 🖐 Coolify → `raptoru-bot` → **Start**. Journal attendu :
   - `bail obtenu : cette instance est le bot actif` ;
   - `token ok for lecroupier_ …` ;
   - `broadcaster events on: …` ;
   - `main Core: chat games true, alerts active, chat answers true`.
6. 🤖 Je vérifie :
   - statut `active`, `host: vps`, EventSub du bot et du diffuseur connectés ;
   - réception des alertes (abonnements EventSub) ;
   - cycles de présence au premier live.
7. 🖐 Sur le PC, renommer `apps\twitch-bot\.twitch-tokens.json` en `.twitch-tokens.json.vps-actif`, et de même pour `.twitch-tokens.broadcaster.json`. Fermer la fenêtre PowerShell.
   **C'est terminé pour PowerShell.**

## 9. Tests après la bascule (hors live, sans vrais Jetons)

| Domaine                            | Test                                                                                                | Attendu                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Commandes                          | `!solde` par raptoru_ (lecture seule)                                                               | réponse de LeCroupier_                                     |
| Daily                              | `!daily` hors live                                                                                  | message « pas de live », rien n'est crédité                |
| Points de chaîne + effets OBS      | une **Couleur Cam** par raptoru_ (points Twitch, pas des Jetons)                                    | couleur appliquée dans OBS par Studio                      |
| Alertes                            | 🤖 réception EventSub déclarée par le bot (`/v1/bot/alerts/status`) ; Studio → Alertes → « Tester » | abonnements présents ; alerte OBS                          |
| Roue du Sub                        | Studio → « Tester »                                                                                 | roue affichée, gain `test` (aucun crédit)                  |
| Random Ban                         | Studio → essai à blanc                                                                              | `simulated`                                                |
| Robustesse 1                       | Coolify → **Restart** `raptoru-bot`                                                                 | reprise du bail sans attente, `active` en moins de 1 min   |
| Robustesse 2                       | lancer `run-production.ps1` sur le PC (jetons renommés)                                             | `en attente … aucune connexion Twitch` ; fermer            |
| Jeux chat, présence, Daily en live | au **premier live**                                                                                 | Jeu des mots, `!slot`, présence `ok` avec le worker du VPS |

## 10. Retour arrière (environ 3 min)

1. 🖐 Coolify → `raptoru-bot` → **Stop**. Un SIGTERM provoque un arrêt propre et libère le bail.
2. 🖐 Récupérer les jetons **les plus récents**, que le VPS a pu renouveler :

   ```sh
   V=$(docker volume ls --format '{{.Name}}' | grep raptoru-bot-data); mkdir -p /root/back
   docker run --rm -v "$V":/data:ro -v /root/back:/b alpine sh -c 'cp /data/.twitch-tokens*.json /b/'
   ```

   Puis `scp root@<IP>:/root/back/.twitch-tokens*.json apps\twitch-bot\` sur le PC, et `shred -u /root/back/*` sur le VPS.

3. 🖐 Sur le PC : `run-production.ps1`. Journal `bail obtenu`, statut `active` avec `pc`.
4. Si le VPS est tombé sans libérer le bail, le PC le prend de lui-même **45 s** plus tard.
5. Si le **Core** doit revenir à `473de25` : un bot de la nouvelle version, qu'il soit sur le PC ou le VPS, **attend** (ancien Core sans bail). Il faut alors relancer
   l'**ancienne** version du bot sur le PC (`git checkout 473de25 -- apps/twitch-bot && npm run build -w @raptoru/twitch-bot`). La migration 39 est additive : on la
   laisse en place, l'ancien Core l'ignore.

## 11. Ce qui reste sur le PC

| Plus nécessaire                                     | Encore nécessaire                                                                             | Secours seulement                                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| PowerShell, `run-production.ps1`, `.env.production` | **Studio** (sources OBS sur `127.0.0.1:4100`, effets, TTS, Soundboard, Jeu des mots), **OBS** | `run-production.ps1` (retour arrière), `npm run twitch:auth` (réautorisation : à remplacer par un geste guidé dans Studio) |

## 12. Points ouverts

- Rotation des journaux Docker sur le VPS : `docker info --format '{{.LoggingDriver}}'` et `/etc/docker/daemon.json`, à vérifier une fois en SSH.
- Nom DNS interne du Core : vérifié à l'étape 7, à revérifier après chaque redéploiement du Core.
- Studio 0.1.7 (tuile du bot) : non publié. Le suivi passe par mes lectures du statut du Core en attendant.
