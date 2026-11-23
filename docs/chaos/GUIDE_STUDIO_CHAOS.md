# Studio › Chaos : le catalogue des effets

23/11/2026. La page Chaos de Studio et du Chaos Lab est organisée **autour des effets**. On ouvre un effet, on le
règle une fois, puis on le teste ou on l'active tout de suite, sur l'écran voulu.

Code : [`apps/studio/web/src/pages/chaos.ts`](../../apps/studio/web/src/pages/chaos.ts) (page, relevés, actions) et
[`chaos-effects.ts`](../../apps/studio/web/src/pages/chaos-effects.ts) (catalogue et fiche, générés depuis le registre).

## 1. Utiliser la page

1. **Lancer** : `npm run chaos:lab` (banc local, port 4120, aucun Jeton, aucun viewer, aucune source OBS). Il
   recompile le moteur et la page, puis ouvre le navigateur. Dans Studio, c'est la page Chaos.
2. **Choisir un effet** : chaque effet du registre a sa carte (icône, nom, première phrase de sa description, état réel
   dans le moteur). Un clic ouvre sa fiche juste en dessous. Les effets de diagnostic n'apparaissent qu'avec
   l'interrupteur « Diagnostic ».
3. **Le régler** (enregistré dans le moteur à chaque clic, retrouvé à la réouverture) :

   | Réglage                       | Ce que c'est                                                                                                                                                           |
   | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Écran                         | « Écran gauche », « Écran droit », « Écran du milieu », « Tous les écrans », rangés selon leur vraie position dans Windows ; nom Windows, taille et fréquence en petit |
   | Durée                         | 5, 10, 20 ou 30 s, ou n'importe quelle valeur dans les limites de sécurité                                                                                             |
   | Entrée, sortie                | transition animée (rotation pour le retournement) ou instantanée, et sa durée                                                                                          |
   | Paramètres propres à l'effet  | ceux que le registre expose, avec le bon contrôle (choix, curseur numérique, couleur, texte)                                                                           |
   | Curseur retourné avec l'image | pour les effets qui le déclarent (retournement)                                                                                                                        |
   | Disponible                    | les déclenchements des viewers (à venir) ne passent que si l'effet est disponible ; Tester et Activer restent possibles ici                                            |

4. **Tester** : l'effet part tout de suite sur l'écran choisi, avec ses réglages, pendant 5 s au plus. Aucun délai,
   aucun Jeton, aucun point de chaîne.
5. **Activer / Arrêter** : déclenchement manuel avec la durée réglée ; le bouton devient « Arrêter » tant que l'effet
   tourne, et la fiche comme la carte montrent l'état et la durée restante, lus dans le moteur chaque seconde.
6. **Tout arrêter** : STOP ALL (en haut à droite), ou Ctrl+Maj+F11 partout, même en jeu.

**Quel écran est retourné ?** La fenêtre qui occupe l'écran choisi (un jeu en fenêtré sans bordure, une fenêtre
agrandie) est retournée en calque GPU, même si elle n'est pas au premier plan : elle reste visible dans la capture
d'écran d'OBS. S'il n'y en a pas, c'est l'écran entier (le calque est alors exclu des captures). Le jeu doit être en
fenêtré sans bordure ; le plein écran exclusif est refusé.

**Écran débranché ou disposition changée** : « gauche » et « droit » désignent toujours l'écran le plus à gauche et
le plus à droite. Un écran du milieu qui n'existe plus est signalé dans la fiche, et l'effet est refusé avec un message
clair (`screen_missing`) plutôt que d'aller ailleurs. La liste des écrans est relue toutes les 5 s.

**Réglages › Diagnostic avancé** (replié) : la rotation native de Windows (expérimentale, jamais pour les viewers),
l'interrupteur général du curseur retourné, et l'essai d'un effet sur une fenêtre précise.

## 2. Ce qui se passe derrière

| Action de la page              | API Studio                 | Commande du moteur                                                    |
| ------------------------------ | -------------------------- | --------------------------------------------------------------------- |
| relevé (chaque seconde)        | `GET /api/chaos/state`     | `describe` (une fois), `status`                                       |
| écrans (toutes les 5 s)        | `GET /api/chaos/screens`   | `targets.list {windows: false}`                                       |
| paramètres, durée, transitions | `POST /api/chaos/preset`   | `preset.set` (`presets.<effet>.default`)                              |
| écran, disponible, curseur     | `POST /api/chaos/config`   | `config.set {section: "effects", values: {<effet>: {...}}}`           |
| Tester / Activer               | `POST /api/chaos/activate` | `effect.activate {effect, kind: test\|manual}` (source `studio`)      |
| Arrêter                        | `POST /api/chaos/stop`     | `effect.stop {effect}` (toutes ses activations, transition de sortie) |
| STOP ALL                       | `POST /api/chaos/stop-all` | `stop_all`                                                            |

- `effect.activate` lit les réglages de l'effet dans le moteur (écran, préréglage) ; « Tous les écrans » donne une
  activation par écran, toutes validées avant la première lancée. Le futur Core utilisera la même commande : un
  déclenchement des viewers suivra exactement la fiche.
- Des réglages changés coup sur coup partent dans l'ordre, chacun sur le précédent, et la fiche les montre aussitôt.
- **Rien ne tourne au repos** : la page ne lit que l'état du moteur ; aucune capture, aucun rendu GPU, aucune fenêtre
  tant qu'aucun effet n'est actif. L'aperçu animé de la fiche est du CSS, joué seulement quand on change un réglage
  ou qu'on clique sur « Rejouer ».

## 3. Ajouter un effet à la page

Rien à écrire dans Studio pour un effet ordinaire : sa carte et sa fiche viennent du registre
(`packages/schemas/src/chaos-registry.json`, [GUIDE_EFFETS.md](GUIDE_EFFETS.md)).

- `label`, `description` (sa première phrase est la ligne de la carte), `icon` (un nom du jeu d'icônes de Studio :
  `repeat`, `filter`, `layers`, `sparkle`, `eye`, `wave`, `film`, `image`, `bolt`, `star`, `grid`, `pulse`, `warn`).
- `params` exposés : `enum` (avec `labels` pour des libellés lisibles), `number` (`min`, `max`, `unit`), `color`,
  `string` (`max_length`) ; `label` et `help` s'affichent dans la fiche ; un paramètre `exposed: false` n'apparaît pas.
- `transitions.in/out.kinds` : les transitions proposées ; `cursor: "follow"` : la ligne « Curseur retourné ».
- Un aperçu animé propre à l'effet est facultatif : une fonction de plus dans `PREVIEWS` (`chaos.ts`).

## 4. Tests

- `npx vitest run test/chaos-runtime.test.ts` (dans `apps/studio/server`) : routes de la fiche (Tester, Activer,
  Arrêter, refus d'un effet invalide, source toujours `studio`), réglages par effet et ordre des écrans sur le vrai
  moteur.
- `npx tsx apps/studio/server/scripts/chaos-lab-e2e.ts [--port 4120]` contre un Lab en marche : partie sans
  affichage (catalogue, fiche, chaque réglage enregistré puis relu après rechargement, ni sélecteur global ni compte à
  rebours, méthode technique seulement en diagnostic avancé) ; partie visible (Tester, Arrêter, Activer, STOP ALL)
  seulement si la garde de jeu le permet.
- Un second Lab d'essai peut tourner à côté de celui d'Antoni : `CHAOS_ENGINE_EXE`, `CHAOS_LAB_STATE`,
  `CHAOS_LAB_DIST`, `CHAOS_LAB_PORT`.
