# Consigne commune de la refonte des pages

Mission : refaire tout Studio dans la direction D, validée par Antoni. Antoni veut ouvrir un module historique et constater qu'il a
été conçu comme une nouvelle interface, pas déplacé depuis l'ancien Studio. Il décide seul de l'esthétique finale.

Lire d'abord `docs/studio-refonte/DESIGN_SYSTEM.md`, puis `apps/studio/web/src/pages/tts.ts`, `tts.css`, `src/ds/ds.ts`, `src/mod/mod.ts`.
Voir le rendu attendu : `prototypes/studio-redesign/d-coulisses/d.css` et `d.js`.

## Ce qu'il veut

Interfaces vivantes, manipulables et conçues autour du résultat final. Une application créative et de pilotage de stream, pas un
tableau de bord administratif, ni un logiciel financier, ni une console d'ingénieur. Modern, élégante, agréable, avec une vraie
personnalité, couleurs et animations discrètes mais soignées, beaucoup de réglages sans les étaler partout. Pas de grosses cartes
identiques, pas d'éléments énormes.

## Méthode pour chaque écran

1. Identifier toutes les fonctions réellement disponibles : l'ancienne page, les routes, les réglages, les états, les cas d'erreur.
2. Conserver tous les paramètres et capacités utiles. Une option ne disparaît qu'après vérification de ses consommateurs.
3. Recomposer selon le parcours du streamer. L'ancienne interface n'est pas un modèle : c'est la source des fonctions.
4. Brancher les vraies API et contrats. Ne pas inventer de donnée, ne pas recalculer une règle métier : le Core décide.
5. Vérifier que les opérations sensibles gardent leur sémantique (idempotence, clés d'intention, remboursements, droits).
6. Contrôler visuellement sur la vraie page, à 1360 × 900 et 1024 × 768, et fonctionnellement.
7. Supprimer le code UI devenu obsolète (CSS et TS de l'ancienne page), après vérification de ses usages.

Les prototypes montrent une direction, pas une spécification : ne pas copier un prototype en supprimant ce qui n'y figure pas.

## Règles

- Worktree `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\studio-ux`, branche `feat/studio-ux`. Ne jamais toucher au checkout
  principal `Documents\Raptoru 2.0`.
- Interdits absolus : push, déploiement, migration distante, Studio installé (ports 4100 et 4110), Twitch ou OBS réels, Wallet réel,
  Production. Pas de `git clean`, `reset --hard`, `checkout .`, ni de `git stash`.
- Ne pas committer : le lanceur de la mission regroupe et committe. Laisser le travail dans l'arbre.
- D'autres agents travaillent en même temps sur d'autres pages du même worktree. Ne modifier que ses fichiers. Modifications autorisées
  hors de ses fichiers : une ligne d'import ou de montage dans `src/main.ts` et `src/module-pages.ts`, avec Edit, sans réécrire le fichier.
  Besoin d'un composant commun absent de `ds/` : l'ajouter à `ds/ds.ts` ou `ds/ds.css` par Edit ciblé, sans casser l'existant.
- Pas de nouvelle dépendance. TypeScript sans framework, comme le reste de Studio.
- Serveur Lab déjà lancé sur `http://127.0.0.1:4398` (profil Lab, base isolée, Core fictif). Ne pas le relancer, ne pas lancer d'autre
  Core. L'interface est servie depuis `apps/studio/web/dist`, reconstruite automatiquement à chaque enregistrement. Si une page ne se
  charge pas, attendre quelques secondes : un autre agent peut être en train d'écrire.
- Un changement de serveur ou de Core reste possible s'il est nécessaire : le faire, le tester en unitaire, le signaler dans le compte
  rendu ; il ne sera visible qu'au redémarrage du serveur. Aucune migration appliquée à une base distante.
- Captures : `node "C:/Users/Antoni/AppData/Local/Temp/claude/6bfb65db564f297c/e8d10c4e-9e28-4c65-9211-851acaa9b105/scratchpad/shot.mjs" 1360x900 <prefixe> <page,page>`
  écrit `scratchpad/shots/<prefixe>-<page>.png`, à regarder avec Read. Pour piloter la page, écrire un script Playwright dans le
  scratchpad (modèle `tts1.mjs` du même dossier, interception possible des lectures pour simuler un état).
- Fichiers longs : Write ou Edit, pas de heredoc Bash (les apostrophes le cassent). Scripts Python : les écrire dans le scratchpad.
- Tests : garder le sens des tests existants. Si une fonction pure testée change, adapter le test en gardant l'assertion métier. Lancer
  `cd apps/studio/server && npx vitest run test/<fichier>` pour ses fichiers. Adapter les sélecteurs des E2E concernés dans `apps/studio/server/e2e`,
  sans les lancer : ils le seront à la fin, tous ensemble. Ajouter seulement les tests qui protègent un comportement important modifié.
- Typecheck : `cd apps/studio/web && npx tsc -p tsconfig.json`. Les erreurs d'autres fichiers en cours d'écriture ne te concernent pas.
- Une page finie n'importe plus aucune classe historique (`rs-*`, `mod-*`, `xlab-*`…) et plus aucun `confirm()` natif.
- Commentaires utiles seulement, en français ou anglais selon le fichier. Pas de tiret cadratin dans les textes d'interface. Textes de
  l'interface en français, simples et courts, dans les mots du streamer, sans jargon technique (pas de `Core`, `payload`, `lease`…
  sauf dans « Détails techniques »).

## Compte rendu

Court : ce qui est fait, les fonctions conservées, ce qui a été retiré et pourquoi, les changements serveur ou Core, les tests adaptés,
ce qui n'a pas pu être vérifié. Pas de liste de commandes.
