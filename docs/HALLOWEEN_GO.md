# Halloween 2026 — runbook de livraison (un GO, étape par étape)

Préparé le 28/10, mis à jour le 29/10 (intégration de la PR #37), état vérifié en lecture seule :

- **Production** :
  - Core `dc06344` (`running:healthy`, `/health` et `/ready` à 200), bot `4ba9243`, hors live ;
  - dernière sauvegarde automatique : 28/10 à 04:00 UTC.
- **PR #35** (contient depuis le 29/10 la **PR #37** : Roue du Sub — présence en live ; Dock — défilement, tailles,
  lisibilité ; fusionnée dans `feat/halloween`, commit `f1c9a7d`) :
  - CI verte sur la tête de branche, fusionnable sans conflit ; fusionner #35 livre aussi #37 (GitHub la marque
    fusionnée) ;
  - depuis `dc06344` : **une seule migration de Production** (`20261112130000_event_shop.sql`) et **aucun
    changement du bot** ;
  - `main` n'a reçu que de la doc depuis.

Rien de ce document n'est exécuté sans le GO d'Antoni. Chaque étape a sa vérification et son critère d'arrêt.

## 0. Conditions (sinon on ne commence pas)

- Pas de live et pas d'enregistrement OBS. L'outil de déploiement le vérifie aussi.
- Le Studio installé tourne normalement (0.1.17).

## 1. Sauvegarde de la base (Antoni, 2 min)

1. Coolify (`https://dashboard.raptoru.fr`) › base de Production › Backups › **Backup now**.
2. Télécharger la sauvegarde (copie hors VPS) dans `Documents\Sauvegarde Raptoru 2.0\2026-10-xx-prod-db-avant-halloween\`.

3. Vérification (agent, 3 min, rien en Production). Critères de restauration, tous requis :
   - taille du fichier = taille affichée par Coolify, statut « success » ;
   - `pg_restore --list` (`postgres:17-alpine`) sans erreur, au moins autant de tables avec données que le 24/10 (104) ;
   - **restauration complète** dans une base jetable locale (conteneur Docker, supprimé après) sans erreur, avec des
     lignes dans `wallets`, `wallet_transactions`, `sw_spins` et `alert_items`.

**Arrêt** si la sauvegarde échoue ou si un critère manque. L'outil de déploiement refuse de toute façon une migration
sans sauvegarde de moins de 60 min (`BACKUP_MAX_AGE_MS`) : faire les étapes 2 et 3 dans l'heure qui suit.

## GitHub Actions : rétabli (28/10)

Bloqué par la facturation le 28/10 après-midi, Actions fonctionne de nouveau depuis le passage du dépôt en public :
la CI complète est verte sur `523a27e` (run 40719308960, tous les jobs, dont e2e et images). **La voie A s'applique.**
La voie B reste documentée en secours si Actions retombait.

Deux chemins, au choix d'Antoni :

- **A — Rétablir Actions** (GitHub › Settings › Billing & plans : paiement ou plafond de dépenses). Le plan se déroule
  alors avec la CI et les workflows, comme d'habitude.
- **B — Sans Actions (prévu par les outils)** :
  - la fusion n'est pas bloquée : le dépôt n'a pas de protection de branche ;
  - comme `main` est un ancêtre de la branche, le code fusionné est **exactement** l'arbre de la branche ;
  - la preuve CI est donc refaite en local sur ce même arbre (lint, typecheck, build, toutes les suites, e2e,
    PostgreSQL réel) ;
  - le Core se déploie avec `--skip-ci-gate`, arbitrage local tracé par l'outil ;
  - Studio se construit et se publie depuis le PC (§ 4, voie B).

## 2. Fusion de la PR #35 (agent, sur GO)

- `gh pr merge 35 --merge`.
- **Voie A** : attendre la CI de `main` (environ 15 min). **Arrêt** si elle est rouge.
- **Voie B** : vérifier que l'arbre du commit de fusion est identique à celui de la branche
  (`git rev-parse <fusion>^{tree}` = `git rev-parse feat/halloween^{tree}`). La preuve locale vaut alors pour `main`.
  **Arrêt** sinon.

## 3. Core : migration et déploiement (agent, sur GO)

Depuis un worktree à jour de `origin/main` :

```
node scripts/coolify-deploy.mjs plan core <sha40 de main>                  → doit dire PRÊT
node scripts/coolify-deploy.mjs deploy core <sha40> --migrations-approved --go
  (voie B : ajouter --skip-ci-gate aux deux commandes ; l'outil inscrit « CI NON vérifiée (arbitrage local) »)
node scripts/coolify-deploy.mjs status core
```

**Attendu** :

- `applied: 20261112130000_event_shop.sql` ;
- `running:healthy`, `/health` et `/ready` à 200 ;
- le Core rapporte le nouveau commit ;
- le bot inchangé (`4ba9243`) garde son bail.

Ce qui change pour les viewers à cet instant : **rien de Halloween**. Un seul changement visible, voulu (PR #37) : un
sub / resub reçu en live, roue active, lance la Roue du Sub sans attendre le relevé des chatters ; « Tirer » reprend un
tour accepté par le viewer. Effectif dès le Core, avec Studio 0.1.17 comme 0.1.18 (aucune migration de plus).

- La boutique est **fermée par défaut** (créée fermée au premier accès) : ni module, ni `!peur`, ni Bonbons
  supplémentaires dans `!solde`.
- L'extension publiée actuelle ignore la nouvelle clé de session.

**Compatibilité avec le Studio installé (0.1.17) pendant la transition** :

- il ignore les nouvelles routes ;
- son Dock afficherait un achat Halloween comme « Événement », mais il n'y en a pas, puisque la boutique est fermée ;
- son onglet Tombola liste « Bonbons », mais le Core le refuse tant que l'événement est fermé (le montant 25 000 de
  l'ancien onglet ne peut donc pas partir).

**Arrêt et retour** :

- déploiement en `ÉCHEC` ou Core non sain → `node scripts/coolify-deploy.mjs deploy core dc06344c274a0e2f02ce87d76fbc30809a894d68 --rollback --go` ;
- la migration reste en place : elle est additive, l'ancien Core l'ignore et l'ancien Core refuse aussi la monnaie
  Bonbons.

## 4. Studio : release (agent, sur GO)

Répétition faite le 28/10 : l'installateur se construit en local (`studio:package`, rien de publié, 121 Mo). Il
embarque la page et le runtime Halloween, la fenêtre overlay d'Electron, le Dock avec Halloween, « Trouver un
viewer », le garde-fou Tombola en Bonbons et le réglage du délai du Dock ; plus, depuis la PR #37, le Dock sans
défilement parasite, ses quatre tailles (Minimaliste / Moyen / Gros / Géant) et son texte plus clair.

Le workflow GitHub « Studio — construire / publier » sur `main` :

- `publish = draft`, vérification, puis `publish = public` (environ 25 min sur Windows) ;
- il teste aussi la mise à jour 0.1.17 → nouvelle version, avec les données intactes ;
- **voie B, sans GitHub Actions** :
  - depuis une copie **détachée et propre** de `origin/main` (jamais le checkout principal), lancer
    `node apps/studio/desktop/scripts/release.mjs --ci --dry-run --out=<dossier>` : tests Studio Windows, paquet et
    vérifications ;
  - puis `node apps/studio/desktop/scripts/release.mjs --publish-from=<dossier> --public` : brouillon, publication et
    re-téléchargement comparé, via la connexion `gh` du PC ;
  - différence avec la voie A : le test automatique de mise à jour 0.1.17 → nouvelle version n'est pas rejoué. La
    sauvegarde de `%APPDATA%` (§ 5.1) et la réinstallation de 0.1.17 couvrent ce risque.

**Arrêt** : la vérification du paquet ou le test de mise à jour échoue → on ne publie pas, le Studio installé reste
en 0.1.17.

## 5. Installation sur le PC (Antoni)

1. Sauvegarder `%APPDATA%\Raptoru Studio` et `%APPDATA%\@raptoru` (comme pour chaque version).
2. Studio › « Rechercher une mise à jour » › installer, puis relancer Studio.
3. Médias (environ 1 min, ne touche aucun original) :

   ```
   cd "C:\Users\Antoni\Documents\Raptoru 2.0 - Livraisons\2026-10-31-halloween-medias"
   node halloween-media-install.mjs --from .
   node halloween-media-install.mjs --from . --check      → « 30 déjà identiques, 0 problème »
   ```

4. Studio › Halloween 🎃 › « Recharger les médias » : 30 médias, et aucun avertissement « absente de ce PC » dans le
   Catalogue.

**Retour Studio** : réinstaller 0.1.17 (`v0.1.17` dans `raptoru-studio-releases`). Les médias peuvent rester, puisque
0.1.17 ne les lit pas.

## 6. Vérification sans viewers (Antoni, 10 min, boutique toujours fermée)

Studio › Halloween 🎃 :

- **Moteur** : « Prêt » (Core joint, page overlay prête, 30 médias).
- **Effet de test** : « Tester sur mon écran » › « Foxy », sans achat, sans Core, sans viewer.
- **OBS** : le test ci-dessous (§ 7).
- **Dock** : les tests locaux n'y apparaissent pas, puisque ce ne sont pas des achats. Le Dock se vérifie avec un
  achat (§ 8).

## 7. Validation humaine minimale dans OBS (sans toucher aux scènes)

Dans OBS, regarde l'aperçu de ta scène habituelle (aucune modification), le jeu en **fenêtré sans bordure** :

1. Studio › Halloween › « Tester sur mon écran » › **Foxy**. Le screamer est **visible dans l'aperçu OBS** (pas de
   rectangle noir) et la jauge « Son du pc » bouge.
2. Teste **Brouillard** (9 s) et clique **STOP ALL** pendant l'effet. L'écran est propre aussitôt.
3. Teste **Brouillard** de nouveau, clique dans le jeu, puis appuie sur **Ctrl+Maj+F12**. L'écran est propre aussitôt.
4. **Dock** (PR #37) : roue crantée › Taille d'affichage › essayer les quatre ; descendre dans l'historique et attendre
   1 à 2 min : la vue ne bouge pas.

## 8. Ouverture progressive (Antoni, quand il le décide)

1. Studio › Halloween › « Ouvrir la boutique ».
2. Avant d'ouvrir, vérifie qu'aucune commande Studio ne s'appelle `!peur` ou `!bonbons`.
3. **Premier achat réel de contrôle** : `!peur blink` dans le chat avec un compte qui a des Bonbons (Studio › Trouver
   un viewer › Créditer, par exemple 5). Attendu :
   - le clignement sur l'écran ;
   - **environ 5 s plus tard**, la ligne Halloween (chauve-souris, viewer, effet, coût) dans le Dock ;
   - le solde diminué.
4. **Extension** : tant que la nouvelle version n'est pas approuvée par Twitch, le chat porte l'événement pour tout le
   monde.

**Arrêt pendant le stream** :

- un effet gênant → **STOP ALL** ou **Ctrl+Maj+F12** ;
- un problème de boutique → « Fermer la boutique » : les achats pas encore joués sont remboursés et les soldes
  gardés ;
- tout le reste de Raptoru continue normalement.

## 9. Extension Twitch (séparé, sur GO)

| Version                    | Ce que c'est                                                                                     | Qui la voit                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Extension Lab              | `/ext/...` servie par Studio, faux viewers, Core Lab                                             | toi, en local                                                                                                                  |
| Hosted Test                | la version téléversée, servie par Twitch                                                         | les comptes testeurs de Twitch ; **sur la chaîne où elle est activée, les autres viewers n'ont plus d'extension** (doc Twitch) |
| Version publique approuvée | celle qui tourne sur `raptoru_` aujourd'hui (`0bf7907`), avec ses restrictions d'accès actuelles | les viewers autorisés                                                                                                          |

- **Paquet prêt** : `apps/twitch-extension/release/raptoru-live-PRODUCTION-f1c9a7d8c347.zip` (worktree
  `raptoru-halloween`, SHA-256 dans le `.sha256` voisin), construit le 29/10 sur l'arbre qui sera fusionné. Contenu
  identique à celui vérifié le 28/10 (`839e1ad`) sauf l'identifiant de build ; pointe vers
  `https://core.raptoru.fr/v1/ext` ; aucun lien local ni `/v1/lab`. La PR #37 ne touche pas l'extension.
- **Peut partir en revue avant le déploiement du Core** (gain de temps) : le module n'apparaît que si le Core envoie
  `event_shop.enabled === true` (absent sur `dc06344`, faux tant que la boutique est fermée) ; la Roue du Sub n'est
  jamais montrée en Production (`sub_wheel: false` côté Core). Approuvée tôt, elle ne change rien de visible.
- **Étapes** :
  1. téléversement comme **nouvelle version** ;
  2. Hosted Test sur un compte ou une chaîne de test, **jamais activée sur `raptoru_` pendant le live** ;
  3. soumission en revue (une seule version à la fois).
- **À l'approbation** :
  - la version publiée remplace l'actuelle, avec les mêmes restrictions d'accès qu'aujourd'hui ;
  - le module « Événements » apparaît aux viewers autorisés dès que la boutique est ouverte ;
  - le réglage Studio « Testeurs seulement » existe, mais reste **inactif** (« Tous » par défaut) : les restrictions
    d'accès de l'extension suffisent.

## Retour arrière (résumé)

| Quoi              | Comment                                                                                                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core              | `deploy core dc06344c274a0e2f02ce87d76fbc30809a894d68 --rollback --go` (la migration reste : additive, ignorée par l'ancien Core)                                                                                                                                                                          |
| Base              | normalement rien. Si les tables doivent disparaître : le SQL de retour en tête de `20261112130000_event_shop.sql`, **démontré** sur PostgreSQL réel (`event-shop-rollback.integration.test.ts` : schéma précédent exact, puis réapplication propre). Il efface les soldes de Bonbons : les exporter avant. |
| Studio            | réinstaller 0.1.17                                                                                                                                                                                                                                                                                         |
| Médias            | rien à faire (0.1.17 ne les lit pas) ; ils restent aussi dans le paquet                                                                                                                                                                                                                                    |
| Pendant le stream | STOP ALL / Ctrl+Maj+F12, puis « Fermer la boutique »                                                                                                                                                                                                                                                       |
