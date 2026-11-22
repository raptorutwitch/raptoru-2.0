# Moteur Chaos V2 (`ChaosEngine.exe`)

Le moteur natif des effets d'écran (« Chaos Overlay », que tu appelles aussi « KO Overlay »). C'est un processus séparé
de Studio. Il pilote :

- une capture partagée et sans curseur (Windows.Graphics.Capture) ;
- un rendu GPU par passes (Direct3D 11) ;
- des calques ;
- une fenêtre DirectComposition traversable, qui ne prend jamais le focus.

Un seul effet réel existe : **le retournement à 180°** de l'écran entier. Windows retourne lui-même l'affichage :
le vrai curseur reste le seul, la souris est inversée et le clic tombe sous le curseur (couche Entrées,
[COUCHE_ENTREES.md](../../docs/chaos/COUCHE_ENTREES.md)).

- Architecture : [docs/chaos/ARCHITECTURE_MOTEUR.md](../../docs/chaos/ARCHITECTURE_MOTEUR.md)
- Contrats : [CONTRATS_MOTEUR.md](../../docs/chaos/CONTRATS_MOTEUR.md)
- Ajouter un effet : [GUIDE_EFFETS.md](../../docs/chaos/GUIDE_EFFETS.md)
- Shaders : [GUIDE_SHADERS.md](../../docs/chaos/GUIDE_SHADERS.md)
- Configuration : [GUIDE_CONFIGURATION.md](../../docs/chaos/GUIDE_CONFIGURATION.md)
- Tests : [PROCEDURE_TESTS.md](../../docs/chaos/PROCEDURE_TESTS.md)
- **Arrêt d'urgence** : [ARRET_URGENCE.md](../../docs/chaos/ARRET_URGENCE.md)

## Lancer (Antoni)

L'interface est **Studio › Chaos**. Sans toucher au Studio installé, on peut utiliser le **Chaos Lab**, un banc
indépendant (port 4120, réglages séparés, aucun Core, OBS ni Jeton) :

```bat
cd "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\chaos-v2"
npm run chaos:lab
```

1. La page s'ouvre dans le navigateur. Le moteur démarre tout seul (« Moteur prêt »).
2. **Écran retourné** : règle les coins (Miroir flou, Noir ou Zoom), la durée et les rotations d'entrée et de sortie.
   « Rejouer l'aperçu » montre le résultat.
3. **Tester sur ce PC** : choisis un écran, ou « Écran du jeu au premier plan, dans 3 s », clique « Tester » puis
   passe dans le jeu (fenêtré sans bordure ; le plein écran exclusif est refusé).
4. **Arrêter** :
   - **Ctrl+Maj+F11**, partout, même en jeu ;
   - ou **STOP ALL** dans la page ;
   - ou « Arrêter » sur la ligne de l'effet.
   - Fermer le banc (Ctrl+C dans sa fenêtre) arrête tout.
   - Si le moteur s'arrête pour n'importe quelle raison, Windows remet l'écran à l'endroit. Secours :
     `bin\ChaosEngine.exe --restore-display`.

L'ancien panneau du lot 1 (`ChaosPresenter.exe`) doit être fermé : il tient le même raccourci.

## Construire et vérifier (développement)

```bat
build.cmd                         :: moteur + tests (compilateur C# de Windows, rien à installer)
bin\chaos-unit.exe                :: 22 tests de logique pure
bin\chaos-checks.exe [--quick]    :: 51 contrôles d'intégration : mire puis écran secondaire retourné (environ 1 min 30)
bin\ChaosEngine.exe --restore-display   :: secours : écrans remis aux réglages enregistrés de Windows
bin\ChaosEngine.exe --bench-gpu   :: coût GPU par passe en 1440p, hors écran
bin\ChaosEngine.exe --render-preview <dossier>   :: planche des transitions (PNG)
bin\ChaosEngine.exe --describe    :: registre ↔ implémentations
```

## Structure

| Dossier       | Rôle                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `src/Model`   | logique pure : registre, paramètres, configuration, transitions, ordonnanceur, protocole              |
| `src/Capture` | capture : interface `ICaptureSource`, technique WGC, partage et comptage                              |
| `src/Render`  | GPU : périphérique, bibliothèque de shaders, `FrameBuilder` (Transform / Filter / Layer), pool, texte |
| `src/Present` | surfaces (fenêtre DirectComposition traversable)                                                      |
| `src/Input`   | couche Entrées : orientation de l'écran par Windows (souris inversée, vrai curseur), restauration     |
| `src/Effects` | runtime (cycle de vie isolé), catalogue, effets (`FlipEffect` et diagnostics internes)                |
| `src/Host`    | hôte (boucle, commandes, télémétrie), entrées-sorties, chiens de garde, gardien, cibles               |
| `tests`       | `UnitTests.cs` (logique pure), `Checks.cs` (intégration)                                              |

Le registre des effets n'est pas ici : il est partagé dans `packages/schemas/src/chaos-registry.json`.
