# Shaders du moteur Chaos

Tous les shaders vivent dans `apps/chaos-engine/src/Render/ShaderLibrary.cs`.

- Ils partagent un **en-tête HLSL commun** (`Prelude`) : constantes, nuanceurs de sommets et fonctions utiles. Aucun
  copier-coller.
- Ils sont compilés à la demande (`D3DCompile`, profil `ps_5_0`, optimisation de niveau 3).
- Ils sont gardés en mémoire et sur disque (`<state-dir>/shader-cache`), par empreinte du source complet.

## 1. Ce que chaque shader reçoit

```hlsl
cbuffer Frame : register(b0) {
  float4 u0, u1, u2, u3; // constantes propres à la passe (FrameBuilder.Filter / Overlay, u[0..15])
  float4 rect;           // calque : x, y, largeur, hauteur (0..1) ; plein écran : 0, 0, 1, 1
  float4 view;           // largeur et hauteur de sortie, de la source
  float4 misc;           // temps (s), présence, opacité, niveau de flou (mip)
  float4 color;          // couleur RVBA (calques, calques shader)
  float4 u4, u5, u6, u7; // 16 constantes de plus (u[16..31])
};
Texture2D src : register(t0);      // l'image d'entrée (capture ou passe précédente)
Texture2D aux : register(t1);      // seconde texture facultative (image retenue)
SamplerState smp : register(s0);   // linéaire, bords bloqués, mipmaps
struct V { float4 pos : SV_Position; float2 uv : TEXCOORD0; };
```

Fonctions disponibles : `aspect()`, `mirror_uv(uv)`, `inside(uv)`, `luma(c)`, et les bruits procéduraux `hash12`,
`hash22` (D. Hoskins, « Hash without Sine », MIT), `gnoise` (bruit de gradient 2D) et `fbm(p, octaves)`. Ils ne sont
compilés que dans les shaders qui les appellent. Les shaders des effets du catalogue sont dans
`Render/EffectShaders.cs` ; un shader ne lit jamais l'horloge du moteur : l'effet lui passe ses temps en constantes
(double précision, temps de l'effet).

Entrées et sorties :

- La sortie est **opaque** pour une passe sur l'image, en **alpha prémultiplié** pour un calque.
- Une passe qui veut lire une image floue passe `blurredInput: true`. Le moteur génère alors les mipmaps de son entrée,
  seulement quand il le faut, et elle lit `src.SampleLevel(smp, uv, misc.w)`.

## 2. Ajouter un shader

```csharp
// Dans le constructeur statique de ShaderLibrary :
Register("grayscale", @"
float4 ps(V i) : SV_Target {
  float3 c = src.SampleLevel(smp, i.uv, 0).rgb;
  float g = dot(c, float3(0.299, 0.587, 0.114));
  return float4(lerp(c, g.xxx, u0.x), 1); // u0.x = force, déjà animée par la transition
}");
```

Puis, dans l'effet : `fb.Filter("grayscale", new[] { (float)f.Animated("amount") })`.

## 3. Règles de performance

- Une passe plein écran coûte environ 0,03 ms en 1440p sur la RTX 3070 (`--bench-gpu`). Viser **moins de 0,5 ms par
  effet**.
- Pas de boucle longue dans un shader. Un flou s'obtient avec des mipmaps (`lod`) ou plusieurs passes `Filter`
  enchaînées. Les cibles intermédiaires viennent du pool.
- Jamais de lecture GPU → CPU.
- La télémétrie affiche le temps de chaque passe (`<effet>:<shader>`).
- Le repli de qualité automatique ne touche aujourd'hui que le remplissage flou. Un effet coûteux peut lire
  `fb.LowQuality` pour s'alléger.

## 4. Vérifier visuellement sans écran

`ChaosEngine.exe --render-preview <dossier>` produit `chaos-preview.png`, une planche contact. La chaîne réelle y est
appliquée à une image de test (quadrants, grille, flèche « HAUT »), sans fenêtre ni capture. Ajouter son effet à
`Preview.Run` (`Program.cs`) pour obtenir sa ligne.

## 5. Sécurité visuelle

Les effets agressifs (flash, stroboscope, contraste extrême) suivent les plafonds de
[CATALOGUE_EFFETS_CHAOS_V2.md](CATALOGUE_EFFETS_CHAOS_V2.md) § 4 :

- au plus 2 changements de luminance par seconde ;
- jamais de flash rouge saturé ;
- refus en mode sûr.

Le moteur applique déjà le plafond de vitesse angulaire et le mode sûr aux rotations. Les autres plafonds
s'ajouteront avec les effets concernés.
