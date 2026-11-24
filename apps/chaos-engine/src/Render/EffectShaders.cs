// Shaders des effets du catalogue (docs/chaos/ETUDE_EFFETS_V2.md). Chacun tient en UNE passe plein écran, sans boucle
// longue ni lecture GPU → CPU ; les valeurs qui dépendent du temps sont calculées par l'effet (double précision, temps
// de l'effet) et transmises en constantes : aucun shader ne lit l'horloge du moteur.
// Conventions : passes sur l'image (Filter) → sortie opaque ; calques (Overlay) → alpha prémultiplié, sans capture.
namespace Raptoru.Chaos
{
    static class EffectShaders
    {
        public static void Register()
        {
            // ---------- Flou ----------
            // Pyramide de mipmaps de l'entrée + lecture B-spline cubique de chaque niveau (4 lectures bilinéaires :
            // Sigg & Hadwiger, GPU Gems 2 ch. 20) : flou large sans blocs, coût constant (8 lectures) quel que soit le
            // rayon. Niveau fractionnaire : fondu entre deux niveaux voisins (rayon continu, animable).
            // u0.x = niveau de flou (0 = net, 1 = B-spline du niveau 0, k = B-spline du niveau k - 1).
            ShaderLibrary.Register("blur", @"
float3 bspline_level(float2 uv, float l) {
  float2 size = max(1, floor(view.zw / exp2(l)));
  float2 t = uv * size - 0.5, b = floor(t), f = t - b;
  float2 f2 = f * f, f3 = f2 * f;
  float2 w0 = (1 - 3 * f + 3 * f2 - f3) / 6, w1 = (4 - 6 * f2 + 3 * f3) / 6, w2 = (1 + 3 * f + 3 * f2 - 3 * f3) / 6, w3 = f3 / 6;
  float2 g0 = w0 + w1, g1 = w2 + w3;
  float2 h0 = (b - 0.5 + w1 / g0) / size, h1 = (b + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * src.SampleLevel(smp, h0, l).rgb + g1.x * src.SampleLevel(smp, float2(h1.x, h0.y), l).rgb)
       + g1.y * (g0.x * src.SampleLevel(smp, float2(h0.x, h1.y), l).rgb + g1.x * src.SampleLevel(smp, h1, l).rgb);
}
float3 level(float2 uv, float k) { return k < 0.5 ? src.SampleLevel(smp, uv, 0).rgb : bspline_level(uv, k - 1); }
float4 ps(V i) : SV_Target {
  float lod = max(0, u0.x), k0 = floor(lod);
  float3 a = level(i.uv, k0);
  if (lod - k0 < 0.002) return float4(a, 1);
  return float4(lerp(a, level(i.uv, k0 + 1), lod - k0), 1);
}");

            // ---------- Pixelisation ----------
            // Blocs ancrés au centre de l'écran (un changement de taille grandit depuis le centre) ; couleur = moyenne du
            // bloc (4 lectures au niveau de mip de la demi-taille du bloc) ; grille et réduction de palette facultatives.
            // u0 = (taille du bloc en pixels de sortie, grille 0..1, niveaux par canal (0 = tous), -).
            ShaderLibrary.Register("pixelate", @"
float4 ps(V i) : SV_Target {
  float b = max(1, u0.x);
  float2 px = i.uv * view.xy, c0 = view.xy * 0.5;
  float2 cell = floor((px - c0) / b);
  float2 cu = (c0 + (cell + 0.5) * b) / view.xy, d = b * 0.25 / view.xy;
  float lod = max(0, log2(b * 0.5 * view.z / view.x));
  float3 col = 0.25 * (src.SampleLevel(smp, cu - d, lod).rgb + src.SampleLevel(smp, cu + float2(d.x, -d.y), lod).rgb
                     + src.SampleLevel(smp, cu + float2(-d.x, d.y), lod).rgb + src.SampleLevel(smp, cu + d, lod).rgb);
  if (u0.z >= 2) { float n = u0.z - 1; col = floor(col * n + 0.5) / n; }
  if (u0.y > 0 && b >= 4) {
    float2 f = frac((px - c0) / b);
    float e = min(min(f.x, 1 - f.x), min(f.y, 1 - f.y)) * b;
    col *= 1 - u0.y * 0.45 * saturate(1.5 - e);
  }
  return float4(col, 1);
}");

            // ---------- Filtres de couleur ----------
            // Luminance calculée en lumière linéaire (Rec. 709) puis réencodée : un noir et blanc fidèle, sans
            // assombrir les verts ni éclaircir les bleus. u0 = (mode, force (animée), contraste, saturation) ;
            // u1.rgb = teinte (monochrome teinté). Modes : 0 noir et blanc, 1 sépia, 2 inversion, 3 saturation,
            // 4 monochrome teinté.
            ShaderLibrary.Register("color", @"
float3 lin(float3 c) { return pow(max(c, 0), 2.2); }
float3 enc(float3 c) { return pow(max(c, 0), 1 / 2.2); }
float4 ps(V i) : SV_Target {
  float3 c = src.SampleLevel(smp, i.uv, 0).rgb;
  float3 L = lin(c);
  float y = luma(L), g = enc(y.xxx).x;
  int m = (int)(u0.x + 0.5);
  float3 r;
  if (m == 0) r = g.xxx;
  else if (m == 1) r = lerp(float3(0.10, 0.06, 0.03), float3(1.0, 0.93, 0.78), g) * (0.85 + 0.15 * g);
  else if (m == 2) r = 1 - c;
  else if (m == 3) r = enc(max(0, lerp(y.xxx, L, u0.w)));
  else r = g < 0.5 ? lerp(float3(0, 0, 0), u1.rgb, g * 2) : lerp(u1.rgb, float3(1, 1, 1), (g - 0.5) * 2);
  r = saturate((r - 0.5) * u0.z + 0.5);
  // L'inversion entre et sort par un balayage diagonal (un fondu passerait par un gris uni).
  float k = m == 2 ? smoothstep(u0.y * 1.3 - 0.1, u0.y * 1.3 - 0.2, i.uv.x * 0.8 + i.uv.y * 0.2) : saturate(u0.y);
  return float4(lerp(c, r, k), 1);
}");

            // ---------- VHS / glitch ----------
            // Défauts d'un signal analogique reproduits un par un, chacun avec sa propre échelle de temps : base de temps
            // instable (gigue ligne à ligne + ondulation lente), bande de tracking qui roule, commutation des têtes en bas
            // d'image, chrominance de faible bande passante (floue et retardée, espace YIQ), grain, pertes de bande
            // (traits blancs), noirs relevés ; glitchs = rafales courtes (blocs de lignes décalés, couleurs séparées).
            // u0 = (intensité, tracking, gigue, grain) ; u1 = (rafale de glitch 0..1, graine de la rafale, bavure de la
            // chroma, glissement vertical) ; u2 = (position de la bande, hauteur de la bande, temps (s), parasites) ;
            // u3 = (délavage, -, -, -).
            ShaderLibrary.Register("vhs", @"
float3 rgb2yiq(float3 c) { return float3(dot(c, float3(0.299, 0.587, 0.114)), dot(c, float3(0.596, -0.274, -0.322)), dot(c, float3(0.211, -0.523, 0.312))); }
float3 yiq2rgb(float3 c) { return float3(dot(c, float3(1, 0.956, 0.621)), dot(c, float3(1, -0.272, -0.647)), dot(c, float3(1, -1.106, 1.703))); }
float4 ps(V i) : SV_Target {
  float t = u2.z;
  float2 uv = float2(i.uv.x, frac(i.uv.y + u1.w));
  float ln = floor(uv.y * 486), field = floor(t * 59.94);
  float dx = (hash12(float2(ln, field)) - 0.5) * u0.z * 0.0024 + gnoise(float2(ln * 0.015, t * 1.3)) * u0.z * 0.003;
  float bd = (uv.y - u2.x) / max(0.001, u2.y);
  float band = saturate(1 - abs(bd)); band *= band;
  dx += band * u0.y * (0.01 + 0.035 * hash12(float2(ln, field + 7)));
  float hs = saturate((uv.y - 0.955) / 0.045);
  dx += hs * hs * u0.x * (0.015 + 0.03 * hash12(float2(ln, field + 3)));
  float gb = floor(uv.y * 17 + u1.y * 13);
  float gr = hash12(float2(gb, u1.y * 91 + 1));
  dx += u1.x * step(0.6, gr) * (gr - 0.8) * 0.4;
  float2 s = float2(uv.x + dx, uv.y);
  float px = 1.0 / view.z;
  float Y = 0.25 * luma(src.SampleLevel(smp, s - float2(1.5 * px, 0), 0).rgb) + 0.5 * luma(src.SampleLevel(smp, s, 0).rgb)
          + 0.25 * luma(src.SampleLevel(smp, s + float2(1.5 * px, 0), 0).rgb);
  float2 IQ = 0;
  [unroll] for (int k = 0; k < 4; k++) IQ += rgb2yiq(src.SampleLevel(smp, s + float2((2 + k * 4) * u1.z * px, 0), 2.5).rgb).yz;
  IQ *= 0.25 * lerp(1, 0.78, saturate(u0.x));
  Y += (hash12(i.uv * view.xy + frac(t * 7.13) * 911) - 0.5) * u0.w * 0.14;
  Y += band * u0.y * step(0.982, hash12(float2(floor(i.uv.x * view.x * 0.35), ln + field))) * 0.65;
  float tk = floor(t * 12), dr = hash12(float2(ln, tk));
  if (dr > 1 - u2.w * 0.004) {
    float x0 = hash12(float2(ln, tk + 1)), w = 0.02 + 0.12 * hash12(float2(ln, tk + 2));
    Y += smoothstep(x0, x0 + 0.004, uv.x) * (1 - smoothstep(x0 + w, x0 + w + 0.01, uv.x)) * 0.75;
  }
  Y = lerp(Y, Y * 0.88 + 0.05, u3.x);
  Y *= 1 + 0.03 * u0.x * sin(uv.y * 6.283 - t * 0.9);
  float3 rgb = yiq2rgb(float3(Y, IQ));
  if (u1.x > 0.01) {
    float o = u1.x * 0.012 * (hash12(float2(gb, 3)) - 0.5);
    rgb.r = lerp(rgb.r, src.SampleLevel(smp, s + float2(o, 0), 0).r, u1.x);
    rgb.b = lerp(rgb.b, src.SampleLevel(smp, s - float2(o, 0), 0).b, u1.x);
  }
  float3 orig = src.SampleLevel(smp, i.uv, 0).rgb;
  return float4(lerp(orig, saturate(rgb), saturate(u0.x * 2)), 1);
}");

            // ---------- Écran ivre (déformation) ----------
            // Après la transformation de balancement (Transform) : un champ de déplacement lent et continu (bruit de
            // gradient, deux octaves) qui fait onduler l'image, une double vision (seconde lecture décalée, fondue), un
            // léger flou (mip) et un assombrissement des bords. u0 = (ondulation, échelle, double vision, écart x) ;
            // u1 = (écart y, flou (niveau de mip), vignette, phase a) ; u2.x = phase b.
            ShaderLibrary.Register("drunk", @"
float4 ps(V i) : SV_Target {
  float2 a = aspect(), p = (i.uv - 0.5) * a;
  float sc = u0.y;
  float2 w = float2(gnoise(p * sc + float2(u1.w, 3.7)), gnoise(p * sc + float2(8.1, u2.x)))
           + 0.5 * float2(gnoise(p * sc * 2.1 + float2(u2.x, 1.3)), gnoise(p * sc * 2.1 + float2(4.4, u1.w)));
  float2 uv = (p + w * u0.x * 0.03) / a + 0.5;
  float3 c1 = src.SampleLevel(smp, mirror_uv(uv), u1.y).rgb;
  float3 c2 = src.SampleLevel(smp, mirror_uv(uv + float2(u0.w, u1.x)), u1.y).rgb;
  float3 c = lerp(c1, c2, u0.z * 0.5);
  float v = 1 - u1.z * smoothstep(0.45, 1.0, length((i.uv - 0.5) * float2(1.0, 0.9)) * 1.45);
  return float4(c * v, 1);
}");

            // ---------- Paupières (calque, sans capture) ----------
            // Vue de l'intérieur : l'ouverture de l'œil est une amande (deux arcs qui se rejoignent aux coins) ; la
            // paupière haute fait l'essentiel du trajet, la basse remonte un peu ; le bord est très flou (la paupière est
            // à 1 cm de l'œil, hors de la mise au point) et irrégulier (cils) ; fermées, elles laissent passer une lueur
            // chaude ; l'image s'assombrit à mesure qu'elles se ferment.
            // u0 = (fermeture haute, fermeture basse, courbure, douceur) ; u1 = (ligne de fermeture y, inclinaison,
            // cils, lueur) ; u2 = (assombrissement, graine, -, -) ; color.rgb = teinte des paupières fermées.
            ShaderLibrary.Register("eyelids", @"
float shape_at(float x, float W, float k) { return pow(saturate(1 - (x / W) * (x / W)), k); }
float4 ps(V i) : SV_Target {
  float2 a = aspect();
  float x = (i.uv.x - 0.5) * a.x, y = i.uv.y - 0.5;
  // Grand ouvert, l'amande déborde largement de l'écran (bords presque droits, hors champ) ; elle se resserre en se
  // fermant : la courbure des paupières apparaît à mesure qu'elles entrent dans le champ.
  float cm = max(u0.x, u0.y);
  float W = a.x * lerp(1.5, 0.62, cm), k = 0.3 + u0.z * 0.9;
  float sh = shape_at(x, W, k), side = max(0.05, shape_at(a.x * 0.5, W, k));
  float yc = u1.x + u1.y * x;
  float m = 0.06;
  float hu = (1 - u0.x) * (0.5 + m + u1.x) / side, hl = (1 - u0.y) * (0.5 + m - u1.x) / side;
  float s = 0.012 + u0.w * 0.11;
  // Cils : bord irrégulier (bruit étiré verticalement), surtout la paupière haute, atténué quand l'œil est presque clos.
  float gap = (hu + hl) * sh;
  float lash = u1.z * s * 0.45 * saturate(gap * 6) * gnoise(float2(x * 38 + u2.y, (y - yc) * 3));
  float au = smoothstep(-s, s, (yc - hu * sh) - y + lash);
  float al = smoothstep(-s, s, y - (yc + hl * sh) + lash * 0.3);
  float lid = 1 - (1 - au) * (1 - al);
  float c = 0.5 * (u0.x + u0.y);
  float r = length(float2(x / a.x, y) * float2(1.6, 1.9));
  float dim = u2.x * c * c * (0.35 + 0.65 * smoothstep(0.15, 0.95, r));
  float glow = u1.w * c * (0.55 + 0.45 * saturate(1 - abs(y - yc) * 2.2));
  float3 lidc = color.rgb * glow;
  float alpha = lid + (1 - lid) * dim;
  return float4(lidc * lid, alpha);
}");

            // ---------- Vision tunnel (calque, sans capture) ----------
            // Masque à distance signée autour du point focal (cercle, ellipse ou rectangle arrondi) : contour très doux,
            // ombre intérieure légère. u0 = (centre x, centre y (écran), rayon (hauteur d'écran), douceur) ;
            // u1 = (obscurité, forme, allongement, rondeur des coins) ; u2.x = ombre intérieure ; color.rgb = voile.
            ShaderLibrary.Register("tunnel", @"
float4 ps(V i) : SV_Target {
  float2 a = aspect(), p = (i.uv - u0.xy) * a;
  float r = max(0.001, u0.z), d;
  int sh = (int)(u1.y + 0.5);
  if (sh == 0) d = length(p) - r;
  else if (sh == 1) { float2 e = float2(r * u1.z, r); d = (length(p / e) - 1) * min(e.x, e.y); }
  else { float2 b = float2(r * u1.z, r); float cr = min(b.x, b.y) * u1.w; float2 q = abs(p) - b + cr; d = length(max(q, 0)) + min(max(q.x, q.y), 0) - cr; }
  float f = max(0.003, u0.w);
  float edge = smoothstep(-0.25 * f, f, d);
  float tail = 1 - exp(-max(0, d) / (f * 2.5 + 0.02));
  float m = saturate(max(edge * 0.92, tail));
  float inner = u2.x * 0.45 * smoothstep(-r * 0.75, 0, d);
  float alpha = u1.x * max(m, inner);
  return float4(color.rgb * alpha, alpha);
}");

            // ---------- Flash aveuglant (calque, image retenue) ----------
            // Blanc (montée, maintien, récupération) par-dessus l'image fantôme de l'instant du flash (aux : image
            // retenue, floue par ses mipmaps, délavée et « brûlée ») ; les zones claires de l'image fantôme restent
            // imprimées (mélange proche d'un « écran ») pendant que le jeu réapparaît dessous.
            // u0 = (blanc 0..1, image fantôme 0..1, flou (mip), échelle) ; u1.x = délavage ; color.rgb = teinte.
            ShaderLibrary.Register("flash", @"
float4 ps(V i) : SV_Target {
  float2 uv = (i.uv - 0.5) / max(0.5, u0.w) + 0.5;
  float3 g = aux.SampleLevel(smp, saturate(uv), u0.z).rgb;
  float y = luma(g);
  g = lerp(g, y.xxx, u1.x);
  g = saturate(g * 1.3 + 0.06) * lerp(float3(1, 1, 1), color.rgb, 0.5);
  float ga = u0.y * saturate(y * 1.25 + 0.08);
  // Le blanc n'est pas un aplat : un peu plus intense au centre (lumière, pas un écran blanc).
  float w = saturate(u0.x * (1.04 - 0.1 * dot(i.uv - 0.5, i.uv - 0.5)));
  float3 rgb = color.rgb * w + g * ga * (1 - w);
  return float4(rgb, w + ga * (1 - w));
}");

            // ---------- Brouillard (calque, sans capture, rendu en résolution réduite) ----------
            // Deux nappes à des profondeurs différentes (lointaine : structures plus fines, plus lente, plus claire ;
            // proche : grandes volutes, plus rapide, plus dense) + un voile uniforme. Chaque nappe = fBm déformé par un
            // autre fBm (« domain warping », Inigo Quilez) dont le champ dérive lui-même : les formes se tordent et
            // évoluent au lieu de glisser ; rien ne se répète. Relief : la nappe proche est éclairée par le haut (écart de
            // densité vers la lumière). Bancs : une variation très lente de la densité. Arrivée : un front irrégulier
            // venu du côté d'où souffle le vent ; dissipation : le seuil monte, la nappe se défait en filaments.
            // u0 = (densité, opacité max, taille des structures, turbulence) ; u1 = (contraste, profondeur, au sol,
            // bancs) ; u2 = (front, dissolution, vent x, vent y) ; u3 = (dérive proche x, y, dérive lointaine x, y) ;
            // u4 = (évolution proche x, y, évolution lointaine x, y) ; u5 = (graine x, graine y, relief, voile) ;
            // color.rgb = couleur.
            ShaderLibrary.Register("fog", @"
float nappe(float2 p, float2 off, float2 evo, float turb, out float lit) {
  float2 q = float2(fbm(p * 0.65 + evo, 3), fbm(p * 0.65 + float2(5.2, 1.3) - evo.yx, 3));
  float2 r = p + off + turb * 0.95 * q;
  float n = fbm(r, 5);
  lit = n - fbm(r + float2(0.0, -0.09), 3);
  return n;
}
float cover(float n, float th, float soft) { return smoothstep(th - soft, th + soft, n * 0.9 + 0.5); }
float4 ps(V i) : SV_Target {
  float2 a = aspect(), c = (i.uv - 0.5) * a;
  float2 p = c / max(0.1, u0.z) + u5.xy;
  float litN, litF;
  float nN = nappe(p * 0.8, u3.xy, u4.xy, u0.w, litN);
  float nF = nappe(p * 1.7 + 31.7, u3.zw, u4.zw, u0.w * 0.8, litF);
  float D = saturate(u0.x);
  float bank = lerp(1, saturate(0.55 + 1.1 * gnoise(p * 0.22 + u4.xy * 0.35)), u1.w);
  float ground = lerp(1, 0.55 + 0.9 * smoothstep(-0.45, 0.5, c.y), u1.z);
  float2 wind = normalize(u2.zw + 1e-5);
  float along = dot(c, wind) / (0.5 * a.x + 0.5);
  float fr = u2.x * 2.4 - 1.2 + 0.25 * gnoise(p * 1.3 + 7.0);
  float front = smoothstep(fr + 0.35, fr - 0.15, along);
  float th = lerp(0.66, 0.3, D) + u2.y * 0.45;
  float soft = lerp(0.42, 0.1, saturate(u1.x));
  float k = bank * ground * front;
  float aN = cover(nN, th, soft) * k;
  float aF = cover(nF, th + 0.06, soft * 1.2) * k * lerp(0.55, 0.85, u1.y);
  float haze = u5.w * (0.25 + 0.75 * D) * front * (1 - u2.y) * ground * 0.55;
  float3 col = color.rgb;
  float3 cF = lerp(col, col * float3(0.94, 0.97, 1.04) + 0.04, 0.6) * (0.92 + 0.1 * u5.z * saturate(-litF * 4));
  float3 cN = col * (0.8 + 0.28 * u5.z * saturate(0.5 - litN * 5)) * lerp(1, 0.92, aN);
  float A = haze; float3 C = col * haze;
  C = cF * aF + C * (1 - aF); A = aF + A * (1 - aF);
  C = cN * aN + C * (1 - aN); A = aN + A * (1 - aN);
  float o = saturate(u0.y) * (1 - smoothstep(0.55, 1, u2.y));
  A = saturate(A * o + (hash12(i.uv * view.xy) - 0.5) / 255);
  return float4(C * o, A);
}");
        }
    }
}
