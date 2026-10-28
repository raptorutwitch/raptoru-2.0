# Halloween 2026 — runbook de livraison (un GO, étape par étape)

Préparé le 28/10, état vérifié en lecture seule :

- **Production** :
  - Core `dc06344` (`running:healthy`, `/health` et `/ready` à 200), bot `4ba9243`, hors live ;
  - dernière sauvegarde automatique : 28/10 à 04:00 UTC.
- **PR #35** :
  - `281cf0a`, CI verte, fusionnable sans conflit ;
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

**Arrêt** si la sauvegarde échoue. L'outil refuse de toute façon une migration sans sauvegarde de moins de 60 min.

## 2. Fusion de la PR #35 (agent, sur GO)

- `gh pr merge 35 --merge`, puis attendre la CI de `main` (environ 15 min). C'est la seule exécution de CI nécessaire.

**Arrêt** si la CI de `main` est rouge : on corrige, rien n'est déployé.

## 3. Core : migration et déploiement (agent, sur GO)

Depuis un worktree à jour de `origin/main` :

```
node scripts/coolify-deploy.mjs plan core <sha40 de main>                  → doit dire PRÊT
node scripts/coolify-deploy.mjs deploy core <sha40> --migrations-approved --go
node scripts/coolify-deploy.mjs status core
```

**Attendu** :

- `applied: 20261112130000_event_shop.sql` ;
- `running:healthy`, `/health` et `/ready` à 200 ;
- le Core rapporte le nouveau commit ;
- le bot inchangé (`4ba9243`) garde son bail.

Ce qui change pour les viewers à cet instant : **rien**.

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
viewer », le garde-fou Tombola en Bonbons et le réglage du délai du Dock.

Le workflow GitHub « Studio — construire / publier » sur `main` :

- `publish = draft`, vérification, puis `publish = public` (environ 25 min sur Windows) ;
- il teste aussi la mise à jour 0.1.17 → nouvelle version, avec les données intactes ;
- secours sans minutes GitHub : construction locale `release.mjs --ci --dry-run --out=<dossier>` depuis une copie
  détachée de `origin/main`, puis `release.mjs --publish-from=<dossier> --public`.

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

- **Paquet** : `npm run build:production -w @raptoru/twitch-extension` sur le commit de `main` donne
  `raptoru-live-PRODUCTION-<sha>.zip`. Il pointe vers `https://core.raptoru.fr/v1/ext`.
  - Il a déjà été construit et vérifié sur `839e1ad` : module, CSS et 36 miniatures présents.
  - Il sera reconstruit après la fusion.
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
