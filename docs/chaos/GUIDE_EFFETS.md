# Ajouter un effet au moteur Chaos

Un effet se résume à **une déclaration et sa logique visuelle**. Le moteur fournit déjà le reste :

- la capture partagée ;
- l'ordonnancement, la file d'attente et la priorité ;
- la durée, les transitions et les arrêts ;
- la présentation et la télémétrie ;
- la configuration et les préréglages ;
- Studio et le protocole.

## 1. Déclarer l'effet (une seule fois)

Ajouter une entrée dans `packages/schemas/src/chaos-registry.json`. Le moteur l'embarque, Studio et le Core la lisent.

```json
{
  "id": "mirror",
  "version": 1,
  "label": "Miroir",
  "description": "L'image du jeu est inversée gauche-droite.",
  "family": "orientation",
  "slot": "transform",
  "internal": false,
  "on_conflict": "queue",
  "gpu": { "primitive": "transform", "cost": "low", "passes": 1 },
  "duration": { "default_ms": 10000 },
  "params": [
    {
      "id": "scale_x",
      "type": "number",
      "min": -1,
      "max": 1,
      "default": -1,
      "animatable": true,
      "neutral": 1,
      "exposed": false
    },
    {
      "id": "fill",
      "type": "enum",
      "values": ["mirror", "black", "cover"],
      "default": "mirror"
    }
  ],
  "variants": [],
  "transitions": {
    "in": {
      "kind": "ramp",
      "duration_ms": 400,
      "curve": "ease_in_out_sine",
      "kinds": ["ramp", "cut"]
    },
    "out": {
      "kind": "ramp",
      "duration_ms": 400,
      "curve": "ease_in_out_sine",
      "kinds": ["ramp", "cut"]
    }
  },
  "stop_conditions": [
    "duration",
    "stop",
    "stop_all",
    "target_lost",
    "capture_lost",
    "error"
  ]
}
```

Règles :

- **`slot`** :
  - `transform` : une seule transformation à la fois par cible ;
  - `filter` : jusqu'à 3 filtres à la fois ;
  - `overlay` : calques sans capture, jusqu'à 4.
  - Un nouvel emplacement se déclare dans `slots`.
- **Paramètre animable** : `animatable` + `neutral`. La transition l'interpole de la valeur neutre à la valeur cible,
  sans code de transition dans l'effet.
- **`exposed: false`** : réservé aux variantes. Le Core et l'extension ne peuvent pas le régler.
- **`stop_all`** est obligatoire dans `stop_conditions`.
- Une rotation en degrés (`unit: "deg"`) est automatiquement plafonnée à 520°/s.
- **`input`** (facultatif) : la transformation d'entrée liée, appliquée quand la cible est l'écran entier. Aujourd'hui
  seulement `invert_xy`, celle du retournement : Windows retourne l'écran, la souris est inversée, le clic tombe sous
  le vrai curseur. La logique de l'effet n'a rien à faire : le moteur applique et rétablit l'orientation, et son rendu
  compense la rotation de Windows. Limites et obligations : [COUCHE_ENTREES.md](COUCHE_ENTREES.md).

**Curseur** : un effet qui déplace l'image (emplacement `transform`) ajoute `"cursor": "follow"` à sa déclaration.
Le moteur masque alors le curseur matériel au-dessus de la cible et dessine l'image du vrai curseur par la même
transformation que l'image (`FrameBuilder.AddCursor`) : rien à écrire dans l'effet. Exemple : `flip`.

## 2. Écrire la logique visuelle

Dans `apps/chaos-engine/src/Effects/Effects.cs`, avec seulement les primitives du `FrameBuilder` :

```csharp
sealed class MirrorEffect : Effect
{
    public override void Render(FrameBuilder fb, EffectFrame f)
    {
        fb.Transform(0, f.Animated("scale_x"), 1, 0, 0, f.P.Str("fill"));
    }
}
```

| Primitive                                       | Pour                                                             | Exemple                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `fb.Transform(rad, sx, sy, tx, ty, fill)`       | rotation, miroir, inclinaison, zoom, tremblement                 | retournement, miroir, zoom                                             |
| `fb.Filter("shader", u[16], blurredInput, lod)` | couleur, flou, brouillard, distorsion, VHS, aberration           | noir et blanc : `fb.Filter("grayscale", new[]{ amount })`              |
| `fb.Add(Layer)`                                 | formes, texte, images, flèches, repères, messages (sans capture) | `Layer.Centered(x, y, w, h)` + `Shape`, `Texture = ctx.Text.Text(...)` |

- Plusieurs appels dans un même `Render` produisent un effet composé : ses passes s'enchaînent sur la même capture.
- `f.Presence` vaut de 0 à 1 (entrée et sortie). `f.ElapsedMs` sert aux animations continues.
- `Prepare(ctx)` sert aux ressources éventuelles (textures de texte, images). Ne jamais créer de capture, de fenêtre
  ni de cible de rendu.
- Une exception dans l'effet l'arrête seul (`effect.failed`, `effect_error`) ; les autres continuent.

## 3. L'enregistrer

Ajouter une ligne dans `EffectCatalog` (`Effects/Effect.cs`) : `{ "mirror", () => new MirrorEffect() }`. Le moteur
refuse de démarrer si le registre et le catalogue divergent (`ChaosEngine.exe --describe` les compare).

## 4. Le vérifier

1. `build.cmd`, puis `bin\chaos-unit.exe` : tests de la logique pure.
2. `bin\ChaosEngine.exe --render-preview <dossier>` : rendu hors écran. Ajouter l'effet à `Preview.Run` pour obtenir
   sa planche.
3. `bin\ChaosEngine.exe --bench-gpu` : coût GPU en 1440p.
4. `bin\chaos-checks.exe` : intégration sur la mire.
5. Studio › Chaos ou `npm run chaos:lab` : l'effet apparaît dans le catalogue et se teste localement, sans autre
   changement.

Un shader nouveau : [GUIDE_SHADERS.md](GUIDE_SHADERS.md).
