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

   | Réglage                      | Ce que c'est                                                                                                                                                            |
   | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Préréglage                   | les variantes du registre en un clic (ex. tremblement : léger, secousse, impact, séisme) : paramètres, et parfois durée et transitions ; le préréglage actif est montré |
   | Écran                        | « Écran gauche », « Écran droit », « Écran du milieu », « Tous les écrans », rangés selon leur vraie position dans Windows ; nom Windows, taille et fréquence en petit  |
   | Durée                        | 5, 10, 20 ou 30 s, ou n'importe quelle valeur dans les limites de sécurité                                                                                              |
   | Entrée, sortie               | transition animée (rotation pour le retournement) ou instantanée, et sa durée                                                                                           |
   | Paramètres propres à l'effet | ceux que le registre expose, avec le bon contrôle (choix, curseur numérique, couleur, texte) ; les réglages fins sont repliés dans « Réglages avancés »                 |
   | Point visé                   | zoom et vision tunnel : un clic dans l'écran miniature (ou les flèches) ; coordonnées relatives, valables à toutes les résolutions                                      |
   | Curseur qui suit l'image     | pour les effets qui déplacent l'image (retournement, miroir, zoom, tremblement, ivre, tunnel)                                                                           |
   | Disponible                   | les déclenchements des viewers (à venir) ne passent que si l'effet est disponible ; Tester et Activer restent possibles ici                                             |

   **Aperçu** (à gauche de la fiche) : le moteur rend l'effet avec ces réglages, hors écran, sur une scène de jeu de
   démonstration (rien ne s'affiche sur tes écrans) : le début, puis la dernière seconde, en boucle. Il est refait
   après chaque changement (en 2 s environ, puis gardé en mémoire). Le retournement garde son aperçu dessiné.

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
- **Compatibilité** : le moteur annonce ses commandes au démarrage (`engine.ready.commands`, moteur 0.4.0). Si une
  commande de la page lui manque (moteur plus ancien que Studio), `/api/chaos/state` la liste dans
  `engine.missing_commands` : la page affiche « Moteur trop ancien » et grise Tester / Activer au lieu d'échouer au
  clic. C'est ce qui manquait le 23/11 : la liste des commandes du protocole (`Protocol.Commands`) n'avait pas
  `effect.activate` ni `effect.stop`, d'où « commande inconnue : effect.activate » dans le Lab.
- **Dans Studio installé** : le serveur de Studio démarre le moteur à la première ouverture de la page Chaos (aucun
  PowerShell, aucun Lab), le relance s'il plante (0,5 s, 2 s, 5 s, 10 s), et l'arrête (STOP ALL, curseur rendu) avant
  de quitter. Le moteur surveille aussi Studio : si le serveur disparaît, il s'arrête seul ; son gardien rend le
  curseur. Réglages : `.runtime/chaos` du dossier de données (profil Production) ou `.runtime/lab-main/chaos` (Lab).
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

## 4. Installer dans Raptoru Studio (version de test)

Le paquet de Studio embarque le moteur : `stage.mjs` le compile depuis le même commit (`build.cmd`, compilateur C#
de Windows) et le place dans `apps/chaos-engine/bin/ChaosEngine.exe` du paquet, là où le serveur le démarre.

Studio installé aujourd'hui : **0.1.44-chaos.2** (13 effets, essayée par Antoni le 24/11).

Version de test **0.1.44-chaos.3** (24/11), construite en local, **ni publiée ni installée** :

- `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\chaos-v2\apps\studio\desktop\release\Raptoru Studio Setup 0.1.44-chaos.3.exe`
- 126 729 317 o, SHA-256 `9ffcc0c11327f8efbec304bcd78e042de22bea613e93d2e57ccec73b67236418`
- contenu :
  - tout ce que contenait 0.1.44-chaos.2 (`main` du 24/11, inchangé depuis) ;
  - effets sur tout l'écran (mode E) ;
  - polissage : clignement, brouillard, tunnel, flash, ivre ;
  - intensités ;
  - Chaos Performance Lab.
- commit `5f501392` de `feat/chaos-studio` (local) ;
- aucun `.env`, aucun jeton, aucune valeur secrète locale dans le paquet (vérifié).
- étiquette de test posée dans le paquet seulement (`package.json` du dépôt inchangé) : Studio désactive alors ses
  mises à jour automatiques (« Version de test… »), sans erreur GitHub.

Installer (hors live, **jeu fermé** : les essais sont visibles) :

1. Fermer Raptoru Studio (fenêtre et serveur) et tout Chaos Lab (Ctrl+C dans sa fenêtre) : un moteur du Lab garde
   Ctrl+Maj+F11 et Studio afficherait « déjà pris ».
2. Lancer `Raptoru Studio Setup 0.1.44-chaos.3.exe` : il remplace la version installée dans le même dossier et garde
   les données (`%APPDATA%\Raptoru Studio` et le dossier de données `Documents\Raptoru 2.0`).
3. Ouvrir Studio : « À propos » = 0.1.44-chaos.3 ; profil, OBS et comptes Twitch comme avant.
4. Modules › Effets & mise en scène › **Chaos · effets d'écran** : « Moteur prêt » en quelques secondes, 13 cartes.
5. Avec une fenêtre agrandie (Studio, un navigateur) sur l'écran choisi : **la barre des tâches participe à l'effet**.
   - Elle doit le faire pour l'écran ivre, le clignement et le retournement.
   - Si OBS tourne avec une **capture d'écran** de cet écran, la vue d'OBS montre aussi l'effet sur tout l'écran.
   - Pendant un effet qui transforme l'image, la barre est figée (horloge, survol) : c'est normal.
6. Fiches, avec la nouvelle ligne **Intensité** (Léger, Marqué, Extrême, Personnalisé) :
   - **Clignement** (Naturel, Rapide, Yeux fermés) : au plus fort, plus rien du jeu ne se voit ; le clignement rapide
     laisse voir la fermeture ;
   - **Brouillard** : Brume légère → Marqué → Dense → **Occultant**. En Occultant, de grosses masses cachent des régions
     entières pendant que des trouées passent ; ce doit rester du brouillard ;
   - **Vision tunnel** : l'ombre s'épaissit avec la distance au point visé ; Extrême = gros zoom sur une petite zone ;
     réglages « Largeur du dégradé » et « Douceur du bord » ;
   - **Flash** (Intense), **sur une scène qui bouge** : blanc, puis l'image figée qui masque le jeu, puis le jeu qui
     réapparaît dessous ;
   - **Écran ivre** (Ivre mort, Vertige) : franchement désorientant, sans être un tremblement ;
   - changer de préréglage garde l'intensité ; toucher un réglage passe en Personnalisé.
7. **Performance Lab** (bouton dans l'en-tête de la page Chaos) :
   - **banc hors écran** jeu fermé, puis exporter le rapport HTML ;
   - **validation en jeu** sur Overwatch avec OBS, selon le protocole de
     [PERFORMANCE_LAB.md](PERFORMANCE_LAB.md) § 4.
8. STOP ALL pendant deux effets en même temps (ex. brouillard + noir et blanc) : tout s'arrête.
9. Quitter Studio pendant un effet : l'effet s'arrête et le curseur revient.
10. Soundboard : « Ajouter un son » répond comme dans la 0.1.44 de `main`.

Retour arrière :

- relancer `Raptoru Studio Setup 0.1.44-chaos.2.exe` (même dossier `release`, SHA-256 `676a1f42…`), ou
  `0.1.44-chaos.1` (`bec90cc2…`) ;
- ou désinstaller Raptoru Studio (Paramètres Windows › Applications ; les données restent), puis réinstaller la
  0.1.43 depuis `raptoru-studio-releases`.

La version officielle suivante, publiée seulement sur demande d'Antoni, devra être construite depuis `main` après
fusion de Chaos ; elle se réinstalle par-dessus.

Reconstruire la version de test : `npx turbo run build`, puis dans `apps/studio/desktop` : `node scripts/stage.mjs`,
version de test posée dans `stage/app/package.json` et `stage/app/build-info.json`, puis
`npx electron-builder --config electron-builder.json --win --x64 --publish never`.

## 5. Tests

- `npx vitest run test/chaos-runtime.test.ts` (dans `apps/studio/server`) : routes de la fiche (Tester, Activer,
  Arrêter, refus d'un effet invalide, source toujours `studio`), réglages par effet et ordre des écrans sur le vrai
  moteur.
- `npx tsx apps/studio/server/scripts/chaos-lab-e2e.ts [--port 4120]` contre un Lab en marche : partie sans
  affichage (catalogue, fiche, chaque réglage enregistré puis relu après rechargement, ni sélecteur global ni compte à
  rebours, méthode technique seulement en diagnostic avancé ; Tester, Arrêter et STOP ALL jusqu'au vrai moteur sans
  rien afficher : écran débranché refusé `screen_missing`) ; partie visible (Tester, Arrêter, Activer, STOP ALL)
  seulement si la garde de jeu le permet.
- Un second Lab d'essai peut tourner à côté de celui d'Antoni : `CHAOS_ENGINE_EXE`, `CHAOS_LAB_STATE`,
  `CHAOS_LAB_DIST`, `CHAOS_LAB_PORT`.
