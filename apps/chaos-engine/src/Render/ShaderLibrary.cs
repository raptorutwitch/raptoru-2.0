// Bibliothèque de shaders : un en-tête HLSL commun (constantes, sommets, fonctions utiles) + un corps par shader.
// Compilation à la demande, cache mémoire et cache disque (%LOCALAPPDATA%\Raptoru\Chaos\shader-cache, clé = SHA-1 du
// source complet) : aucun shader n'est recompilé à chaque effet ni à chaque lancement.
// Ajouter un shader : Register("nom", "corps HLSL avec une fonction float4 ps(V i) : SV_Target"). Guide :
// docs/chaos/GUIDE_SHADERS.md.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Raptoru.Chaos
{
    sealed class ShaderLibrary
    {
        /// En-tête commun : 32 flottants de constantes (Gpu.CbFloats), deux nuanceurs de sommets, fonctions partagées.
        public const string Prelude = @"
cbuffer Frame : register(b0) {
  float4 u0; float4 u1; float4 u2; float4 u3; // paramètres propres à la passe (16 premiers flottants)
  float4 rect;                               // calque : x, y, largeur, hauteur (0..1) ; plein écran : 0, 0, 1, 1
  float4 view;                               // largeur et hauteur de sortie, largeur et hauteur de la source
  float4 misc;                               // temps (s), présence (0..1), opacité, niveau de flou (mip)
  float4 color;                              // couleur RVBA (calques)
  float4 u4; float4 u5; float4 u6; float4 u7; // paramètres propres à la passe (16 suivants)
};
Texture2D src : register(t0);
Texture2D aux : register(t1);                // seconde texture (image retenue), facultative
SamplerState smp : register(s0);
struct V { float4 pos : SV_Position; float2 uv : TEXCOORD0; };

// Triangle couvrant toute la cible (3 sommets, aucun tampon).
V vs_full(uint id : SV_VertexID) {
  V o; float2 uv = float2((id << 1) & 2, id & 2);
  o.pos = float4(uv.x * 2 - 1, 1 - uv.y * 2, 0, 1); o.uv = uv; return o;
}
// Quadrilatère d'un calque (4 sommets en bande) : rect en coordonnées normalisées, rotation u3.w (radians).
V vs_quad(uint id : SV_VertexID) {
  V o; float2 c = float2(id & 1, id >> 1);
  float2 half_px = rect.zw * view.xy * 0.5;
  float2 p = (c - 0.5) * 2 * half_px;
  float s = sin(u3.w), k = cos(u3.w);
  p = float2(k * p.x - s * p.y, s * p.x + k * p.y);
  float2 center = (rect.xy + rect.zw * 0.5) * view.xy;
  float2 q = (center + p) / view.xy;
  o.pos = float4(q.x * 2 - 1, 1 - q.y * 2, 0, 1); o.uv = c; return o;
}
float2 aspect() { return float2(view.x / view.y, 1); }
float2 mirror_uv(float2 uv) { return 1 - abs(fmod(abs(uv), 2) - 1); }
bool inside(float2 uv) { return all(uv >= 0) && all(uv <= 1); }
float luma(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }

// Bruits procéduraux sans texture (compilés seulement là où un shader les appelle).
// Hachages : « Hash without Sine », Dave Hoskins (licence MIT), stables sur tous les GPU (pas de sin()).
float hash12(float2 p) { float3 p3 = frac(p.xyx * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return frac((p3.x + p3.y) * p3.z); }
float2 hash22(float2 p) { float3 p3 = frac(p.xyx * float3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return frac((p3.xx + p3.yz) * p3.zy); }
// Bruit de gradient 2D (Perlin, interpolation quintique) : continu, sans blocs, dans [-1, 1].
float gnoise(float2 p) {
  float2 i = floor(p), f = frac(p);
  float2 u = f * f * f * (f * (f * 6 - 15) + 10);
  float n00 = dot(hash22(i) * 2 - 1, f), n10 = dot(hash22(i + float2(1, 0)) * 2 - 1, f - float2(1, 0));
  float n01 = dot(hash22(i + float2(0, 1)) * 2 - 1, f - float2(0, 1)), n11 = dot(hash22(i + 1) * 2 - 1, f - 1);
  return 1.41 * lerp(lerp(n00, n10, u.x), lerp(n01, n11, u.x), u.y);
}
// Somme fractale (fBm) : octaves tournées de 37° (aucun axe privilégié), lacunarité 2,03, gain 0,5. Résultat ≈ [-1, 1].
float fbm(float2 p, int octaves) {
  float s = 0, a = 0.5, n = 0;
  [unroll(6)] for (int k = 0; k < octaves; k++) { s += a * gnoise(p); n += a; p = mul(float2x2(0.8, -0.6, 0.6, 0.8), p) * 2.03 + 17.1; a *= 0.5; }
  return s / n;
}
";

        static readonly Dictionary<string, string> Bodies = new Dictionary<string, string>();

        static ShaderLibrary()
        {
            // Transformation affine de l'image (rotation, échelle, translation) avec stratégie de remplissage des zones
            // découvertes. u0 = (rotation rad, échelle x, échelle y, mode), u1 = (translation x, y, assombrissement, -).
            // Modes : 0 miroir flou sombre de l'image TRANSFORMÉE (jamais l'image d'origine), 1 noir, 2 bord étiré.
            // u1.w = 1 : fort grossissement (zoom ≥ ×1,8) → lecture Catmull-Rom 9 points (image nette au lieu du flou
            // bilinéaire ; Jimenez, « Filmic SMAA », SIGGRAPH 2016).
            Register("transform", @"
float3 catmull(float2 uv) {
  float2 size = view.zw, sp = uv * size, tp = floor(sp - 0.5) + 0.5, f = sp - tp;
  float2 w0 = f * (-0.5 + f * (1 - 0.5 * f)), w1 = 1 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  float2 w12 = w1 + w2, t0 = (tp - 1) / size, t3 = (tp + 2) / size, t12 = (tp + w2 / w12) / size;
  float3 r = (src.SampleLevel(smp, float2(t0.x, t0.y), 0).rgb * w0.x + src.SampleLevel(smp, float2(t12.x, t0.y), 0).rgb * w12.x + src.SampleLevel(smp, float2(t3.x, t0.y), 0).rgb * w3.x) * w0.y
           + (src.SampleLevel(smp, float2(t0.x, t12.y), 0).rgb * w0.x + src.SampleLevel(smp, t12, 0).rgb * w12.x + src.SampleLevel(smp, float2(t3.x, t12.y), 0).rgb * w3.x) * w12.y
           + (src.SampleLevel(smp, float2(t0.x, t3.y), 0).rgb * w0.x + src.SampleLevel(smp, float2(t12.x, t3.y), 0).rgb * w12.x + src.SampleLevel(smp, t3, 0).rgb * w3.x) * w3.y;
  return saturate(r);
}
float4 ps(V i) : SV_Target {
  float2 a = aspect();
  float2 p = (i.uv - 0.5) * a - u1.xy;
  float s = sin(u0.x), k = cos(u0.x);
  float2 q = float2(k * p.x + s * p.y, -s * p.x + k * p.y) / u0.yz;
  float2 uv = q / a + 0.5;
  if (inside(uv)) return float4(u1.w > 0.5 ? catmull(uv) : src.SampleLevel(smp, uv, 0).rgb, 1);
  if (u0.w < 0.5) return float4(src.SampleLevel(smp, mirror_uv(uv), misc.w).rgb * u1.z, 1);
  if (u0.w < 1.5) return float4(0, 0, 0, 1);
  return float4(src.SampleLevel(smp, saturate(uv), 0).rgb, 1);
}");
            // Diagnostic : teinte (couleur u0.rgb, force u0.a déjà animée par la transition).
            Register("tint", @"
float4 ps(V i) : SV_Target {
  float3 c = src.SampleLevel(smp, i.uv, 0).rgb;
  return float4(lerp(c, c * u0.rgb + u0.rgb * 0.25, u0.a), 1);
}");
            // Diagnostic : charge réglable, u0.x taps répartis en spirale autour du pixel (léger flou), u0.y mélange.
            Register("diag_load", @"
float4 ps(V i) : SV_Target {
  float2 px = 1.0 / view.zw;
  float3 acc = 0; int n = max(1, (int)u0.x);
  [loop] for (int k = 0; k < n; k++) { float a = k * 2.39996; acc += src.SampleLevel(smp, i.uv + float2(cos(a), sin(a)) * (1.5 + k * 0.5) * px, 0).rgb; }
  float3 c = src.SampleLevel(smp, i.uv, 0).rgb;
  return float4(lerp(c, acc / n, u0.y), 1);
}");
            // Calque forme (distance signée) : u0 = (forme 0 rectangle arrondi / 1 ellipse / 2 anneau, rayon des coins px,
            // épaisseur du trait px (0 = plein), -). Alpha prémultiplié.
            Register("layer_shape", @"
float4 ps(V i) : SV_Target {
  float2 size = rect.zw * view.xy;
  float2 p = (i.uv - 0.5) * size;
  float d;
  if (u0.x < 0.5) { float2 b = size * 0.5 - u0.y; float2 q = abs(p) - b; d = length(max(q, 0)) + min(max(q.x, q.y), 0) - u0.y; }
  else { float r = min(size.x, size.y) * 0.5; d = length(p) - r; }
  if (u0.z > 0 || u0.x > 1.5) d = abs(d + max(u0.z, 1) * 0.5) - max(u0.z, 1) * 0.5;
  float a = saturate(0.5 - d) * color.a * misc.z;
  return float4(color.rgb * a, a);
}");
            // Calque image ou texte (texture BGRA prémultipliée) : opacité misc.z ; u1.x = retourné horizontalement.
            Register("layer_texture", @"
float4 ps(V i) : SV_Target { float2 uv = u1.x > 0.5 ? float2(1 - i.uv.x, i.uv.y) : i.uv; return src.SampleLevel(smp, uv, 0) * misc.z; }");
            // Copie (image retenue) et calque plein écran prémultiplié (calque shader rendu en résolution réduite).
            Register("copy", @"
float4 ps(V i) : SV_Target { return float4(src.SampleLevel(smp, i.uv, 0).rgb, 1); }");
            Register("layer_full", @"
float4 ps(V i) : SV_Target { return src.SampleLevel(smp, i.uv, 0); }");
            EffectShaders.Register();
        }

        /// Déclare un shader de pixels (corps HLSL définissant float4 ps(V i) : SV_Target).
        public static void Register(string name, string body) { Bodies[name] = body; }

        readonly Gpu gpu;
        readonly string cacheDir;
        readonly Dictionary<string, IntPtr> ps = new Dictionary<string, IntPtr>();
        public IntPtr VsFull, VsQuad;
        public int Compiled, FromDisk;
        public double CompileMs;

        public ShaderLibrary(Gpu gpu, string cacheDir)
        {
            this.gpu = gpu; this.cacheDir = cacheDir;
            VsFull = gpu.VertexShader(Bytecode("vs", "", "vs_full", "vs_5_0"));
            VsQuad = gpu.VertexShader(Bytecode("vs", "", "vs_quad", "vs_5_0"));
        }

        public IntPtr Pixel(string name)
        {
            IntPtr s;
            if (ps.TryGetValue(name, out s)) return s;
            string body;
            if (!Bodies.TryGetValue(name, out body)) throw new InvalidOperationException("shader inconnu : " + name);
            s = gpu.PixelShader(Bytecode(name, body, "ps", "ps_5_0"));
            ps[name] = s;
            return s;
        }

        /// Le shader lit-il le temps (misc.x) ? Alors son image change à chaque instant (pas d'image réutilisée).
        public bool UsesTime(string name)
        {
            bool t;
            if (usesTime.TryGetValue(name, out t)) return t;
            string body;
            t = Bodies.TryGetValue(name, out body) && body.Contains("misc.x");
            usesTime[name] = t;
            return t;
        }
        readonly Dictionary<string, bool> usesTime = new Dictionary<string, bool>();

        /// Compile tous les shaders déclarés (au démarrage du moteur : aucun à-coup au premier effet).
        public void Warm() { foreach (var n in new List<string>(Bodies.Keys)) Pixel(n); }

        byte[] Bytecode(string name, string body, string entry, string target)
        {
            string source = Prelude + body;
            string key;
            using (var sha = SHA1.Create()) key = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(source + "|" + entry + "|" + target + "|O3"))).Replace("-", "");
            string file = cacheDir == null ? null : Path.Combine(cacheDir, name + "-" + entry + "-" + key.Substring(0, 16) + ".cso");
            if (file != null && File.Exists(file))
            {
                try { var b = File.ReadAllBytes(file); FromDisk++; return b; } catch (Exception) { }
            }
            var sw = Stopwatch.StartNew();
            IntPtr code, errors;
            int hr = N.D3DCompile(source, new IntPtr(source.Length), name + ".hlsl", IntPtr.Zero, IntPtr.Zero, entry, target, 1u << 15, 0, out code, out errors);
            if (hr < 0)
            {
                string msg = errors != IntPtr.Zero ? Marshal.PtrToStringAnsi(Com.Fn<BlobPtr>(errors, 3)(errors)) : "";
                throw new ComFail("D3DCompile " + name + " : " + msg, hr);
            }
            Com.Release(ref errors);
            IntPtr ptr = Com.Fn<BlobPtr>(code, 3)(code);
            int len = (int)Com.Fn<BlobPtr>(code, 4)(code);
            var bytes = new byte[len];
            Marshal.Copy(ptr, bytes, 0, len);
            Com.Release(ref code);
            Compiled++; CompileMs += sw.Elapsed.TotalMilliseconds;
            if (file != null)
            {
                try { Directory.CreateDirectory(cacheDir); File.WriteAllBytes(file + ".tmp", bytes); if (File.Exists(file)) File.Delete(file); File.Move(file + ".tmp", file); } catch (Exception) { }
            }
            return bytes;
        }
    }
}
