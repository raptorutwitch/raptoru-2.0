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
  - `transform` : une seule orientation à la fois par cible (retournement, miroir) ;
  - `camera` : mouvement et cadrage, 2 à la fois (zoom, tunnel, tremblement, ivre) ;
  - `filter` : jusqu'à 3 filtres à la fois ;
  - `overlay` : calques sans capture, jusqu'à 4.
  - Un nouvel emplacement se déclare dans `slots`.
- **`order`** (facultatif) : place dans la chaîne de rendu, par défaut celle de l'emplacement (un tremblement, 18, passe
  après un zoom, 14).
- **`capture: "snapshot"`** : l'effet ne capture qu'une image (flash) ; sinon, la capture est celle de l'emplacement.
- **`cooldown_ms`**, **`photosensitive`** : délai minimal entre deux activations sur une cible ; effet lumineux refusé
  en mode sûr.
- **Variantes** = préréglages complets : `params`, et facultativement `duration_ms` et `transition`. Elles sont
  vérifiées au démarrage comme une demande (bornes, durée), et Studio les montre en puces.
- **Paramètres** : `advanced: true` (replié dans la fiche), `step` (pas du curseur), `widget: "point"` + `pair` (le
  point visé se choisit d'un clic ; le paramètre y porte `widget: "point_y"`).
- **`viewer`** : préparation de la boutique (durées proposées, paliers = variantes, variante d'aperçu, l'intensité
  change-t-elle le prix). Les prix restent au Core ([ETUDE_EFFETS_V2.md](ETUDE_EFFETS_V2.md) § 4).
- **Paramètre animable** : `animatable` + `neutral`. La transition l'interpole de la valeur neutre à la valeur cible,
  sans code de transition dans l'effet.
- **`exposed: false`** : réservé aux variantes. Le Core et l'extension ne peuvent pas le régler.
- **`stop_all`** est obligatoire dans `stop_conditions`.
- Une rotation en degrés (`unit: "deg"`) est automatiquement plafonnée à 520°/s.
- **`input`** (facultatif) : la transformation d'entrée liée, appliquée quand la cible est l'écran entier. Aujourd'hui
  seulement `invert_xy`, celle du retournement : Windows retourne l'écran, la souris est inversée, le clic tombe sous
  le vrai curseur. La logique de l'effet n'a rien à faire : le moteur applique et rétablit l'orientation, et son rendu
  compense la rotation de Windows. Limites et obligations : [COUCHE_ENTREES.md](COUCHE_ENTREES.md).

**Studio** : la carte et la fiche de l'effet viennent de cette déclaration ([GUIDE_STUDIO_CHAOS.md](GUIDE_STUDIO_CHAOS.md)) :
`icon` (icône de la carte), première phrase de `description`, paramètres exposés avec leur contrôle (`labels` donne
des libellés lisibles aux valeurs d'un `enum`), transitions, durée, écran. Rien à écrire dans Studio.

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

| Primitive                                       | Pour                                                                         | Exemple                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `fb.Transform(rad, sx, sy, tx, ty, fill)`       | rotation, miroir, inclinaison, zoom, tremblement                             | retournement, miroir, zoom                                             |
| `fb.Filter("shader", u[16], blurredInput, lod)` | couleur, flou, brouillard, distorsion, VHS, aberration                       | noir et blanc : `fb.Filter("grayscale", new[]{ amount })`              |
| `fb.Add(Layer)`                                 | formes, texte, images, flèches, repères, messages (sans capture)             | `Layer.Centered(x, y, w, h)` + `Shape`, `Texture = ctx.Text.Text(...)` |
| `fb.Overlay("shader", u[32], scale, aux)`       | calque shader plein écran, sans capture, en résolution réduite au besoin     | paupières, brouillard (`scale` 0,5), masque du tunnel                  |
| `fb.Retain(image)`                              | retenir l'image affichée (une fois), puis rendre la capture (`NeedsCapture`) | flash : image fantôme lue par le calque (`aux = image.Srv`)            |

- Plusieurs appels dans un même `Render` produisent un effet composé : ses passes s'enchaînent sur la même capture.
- `f.Presence` vaut de 0 à 1 (entrée et sortie). `f.ElapsedMs` sert aux animations continues ; `f.Exiting` dit si la
  sortie a commencé ; `f.Seed` (ou `c.Seed` dans `Prepare`) donne une graine par activation : des variations
  reproductibles, différentes d'un déclenchement à l'autre (`Fx.Hash`, `Fx.Noise`, `Fx.Pulses`, `Fx.ZoomFrame` dans
  `Effects/Motion.cs`).
- Aucune allocation par image : réutiliser ses tableaux de constantes (champ de l'effet).
- `Prepare(ctx)` sert aux ressources éventuelles (textures de texte, images). Ne jamais créer de capture, de fenêtre
  ni de cible de rendu.
- Une exception dans l'effet l'arrête seul (`effect.failed`, `effect_error`) ; les autres continuent.

## 3. L'enregistrer

Ajouter une ligne dans `EffectCatalog` (`Effects/Effect.cs`) : `{ "mirror", () => new MirrorEffect() }`. Le moteur
refuse de démarrer si le registre et le catalogue divergent (`ChaosEngine.exe --describe` les compare).

## 4. Le vérifier

1. `build.cmd`, puis `bin\chaos-unit.exe` : tests de la logique pure.
2. Rendu hors écran, rien d'affiché :
   - `bin\ChaosEngine.exe --render-effects <dossier> [effet]` : une planche par effet (variantes × instants) ;
   - `--strip <dossier> <effet> <variante|-> <t0> <t1> <n>` : l'évolution image par image ;
   - `--combo <dossier> fog:dense,color:nb <t0> <t1> <n>` : plusieurs effets ensemble.
3. `bin\ChaosEngine.exe --bench-effects` : coût GPU de chaque effet en 1440p (jeu fermé : le banc charge le GPU).
4. `bin\chaos-checks.exe` : intégration sur la mire.
5. Studio › Chaos ou `npm run chaos:lab` : l'effet apparaît dans le catalogue et se teste localement, sans autre
   changement.

Un shader nouveau : [GUIDE_SHADERS.md](GUIDE_SHADERS.md).
