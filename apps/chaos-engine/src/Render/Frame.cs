// Construction d'une image : les effets actifs d'une surface DÉCLARENT ce qu'ils veulent (passes sur l'image capturée,
// calques par-dessus) ; le moteur exécute la chaîne une seule fois, sur une seule capture, avec des cibles
// intermédiaires réutilisées (pool), puis dessine les calques. Un effet ne crée jamais de capture, de fenêtre ni de
// texture lui-même.
//
// Primitives (volontairement peu nombreuses, voir docs/chaos/GUIDE_EFFETS.md) :
//   Transform : rotation / échelle / translation de l'image, avec une stratégie de remplissage des zones découvertes ;
//   Filter    : un shader plein écran de la bibliothèque, 16 constantes libres (couleurs, flous, distorsions…) ;
//   Layer     : un calque (forme, texte, image) positionné, tourné, translucide, sans capture.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Raptoru.Chaos
{
    /// Texture de rendu réutilisable (avec mipmaps pour les flous).
    sealed class PooledTarget
    {
        public IntPtr Tex, Srv, Rtv;
        public uint W, H;
        public long LastUsed;
    }

    sealed class TexturePool
    {
        readonly Gpu gpu;
        readonly List<PooledTarget> free = new List<PooledTarget>();
        public int Created, Live;
        public TexturePool(Gpu gpu) { this.gpu = gpu; }

        public PooledTarget Rent(uint w, uint h, long now)
        {
            var t = free.FirstOrDefault(x => x.W == w && x.H == h);
            if (t != null) free.Remove(t);
            else
            {
                t = new PooledTarget { W = w, H = h, Tex = gpu.Texture(w, h, 0, 0x8 | 0x20, 0x1, 0, 0) };
                t.Srv = gpu.Srv(t.Tex); t.Rtv = gpu.Rtv(t.Tex);
                Created++; Live++;
            }
            t.LastUsed = now;
            return t;
        }

        public void Return(PooledTarget t, long now) { if (t != null) { t.LastUsed = now; free.Add(t); } }

        /// Libère les cibles inutilisées depuis idleMs (au repos, le pool redescend à zéro).
        public void Trim(long now, long idleMs)
        {
            foreach (var t in free.Where(x => now - x.LastUsed > idleMs).ToList())
            {
                Com.Release(ref t.Rtv); Com.Release(ref t.Srv); Com.Release(ref t.Tex);
                free.Remove(t); Live--;
            }
        }
    }

    /// Texture affichable par un calque (texte rasterisé, image).
    sealed class TextureRef
    {
        public IntPtr Tex, Srv;
        public int W, H;
        public void Release() { Com.Release(ref Srv); Com.Release(ref Tex); }
    }

    enum LayerShape { RoundedRect = 0, Ellipse = 1, Ring = 2 }

    /// Un calque : rectangle normalisé (0..1, coin haut-gauche + taille), rotation, opacité, forme ou texture.
    sealed class Layer
    {
        public double X, Y, W, H, Rotation, Opacity = 1, RadiusPx, StrokePx;
        public LayerShape Shape;
        public float[] Color = { 1, 1, 1, 1 };
        public TextureRef Texture;

        /// Centre un calque de taille (w, h) normalisée sur (cx, cy).
        public static Layer Centered(double cx, double cy, double w, double h)
        {
            return new Layer { X = cx - w / 2, Y = cy - h / 2, W = w, H = h };
        }
    }

    sealed class FramePass
    {
        public string Label, Shader;
        public float[] U = new float[16];
        public bool NeedsBlurredInput;
        public float Lod;
    }

    sealed class FrameBuilder
    {
        public readonly uint Width, Height;
        public readonly bool HasCapture;
        public string CurrentLabel = "effect";
        /// Repli de qualité (moteur ralenti) : remplissages flous remplacés par du noir, pas de mipmaps.
        public bool LowQuality;
        /// Rotation que Windows applique déjà à l'écran (couche Entrées) : Transform la retranche, l'image affichée
        /// reste celle que l'effet décrit, quelle que soit l'orientation de l'écran.
        public double DisplayRotationRad;
        readonly List<FramePass> passes = new List<FramePass>();
        readonly List<KeyValuePair<string, Layer>> layers = new List<KeyValuePair<string, Layer>>();

        public FrameBuilder(uint w, uint h, bool hasCapture) { Width = w; Height = h; HasCapture = hasCapture; }
        public int PassCount { get { return passes.Count; } }
        public int LayerCount { get { return layers.Count; } }
        public bool NeedsInputMips { get { return passes.Count > 0 && passes[0].NeedsBlurredInput; } }

        /// Transformation de l'image capturée. fill : mirror (prolongement flou et sombre de l'image transformée),
        /// black, cover (agrandit juste assez pour qu'aucune zone ne soit découverte), clamp.
        public void Transform(double rotationRad, double scaleX, double scaleY, double tx, double ty, string fill)
        {
            if (!HasCapture) throw new InvalidOperationException("Transform exige une capture (registre : emplacement à capture)");
            var p = new FramePass { Label = CurrentLabel, Shader = "transform" };
            if (LowQuality && fill == "mirror") fill = "black";
            rotationRad -= DisplayRotationRad;
            double c = Math.Abs(Math.Cos(rotationRad)), s = Math.Abs(Math.Sin(rotationRad));
            bool axisAligned = s < 1e-6 || c < 1e-6 && Width == Height;
            bool uncovered = !axisAligned || Math.Abs(scaleX) < 1 || Math.Abs(scaleY) < 1 || tx != 0 || ty != 0;
            float mode = 0;
            if (fill == "cover")
            {
                double ratio = Math.Max(Width / (double)Height, Height / (double)Width);
                double k = c + ratio * s;
                scaleX *= k; scaleY *= k; mode = 2;
            }
            else if (fill == "black") mode = 1;
            else if (fill == "clamp") mode = 2;
            p.U[0] = (float)rotationRad; p.U[1] = (float)scaleX; p.U[2] = (float)scaleY; p.U[3] = mode;
            p.U[4] = (float)tx; p.U[5] = (float)ty; p.U[6] = 0.45f;
            p.NeedsBlurredInput = uncovered && mode == 0;
            p.Lod = 4.5f;
            passes.Add(p);
        }

        /// Passe plein écran d'un shader de la bibliothèque (16 constantes). blurredInput : le shader lit des mips.
        public void Filter(string shader, float[] u, bool blurredInput = false, float lod = 0)
        {
            if (!HasCapture) throw new InvalidOperationException("Filter exige une capture");
            var p = new FramePass { Label = CurrentLabel, Shader = shader, NeedsBlurredInput = blurredInput, Lod = lod };
            Array.Copy(u, p.U, Math.Min(16, u.Length));
            passes.Add(p);
        }

        public void Add(Layer l) { if (l.Opacity > 0 && l.W > 0 && l.H > 0) layers.Add(new KeyValuePair<string, Layer>(CurrentLabel, l)); }

        /// Exécute : chaîne de passes (entrée = capture), dernière passe directement dans la cible finale, puis calques.
        public void Execute(Gpu gpu, ShaderLibrary lib, TexturePool pool, GpuTimer timer, IntPtr inputSrv, IntPtr outRtv, long now, float presenceTime)
        {
            var cb = new float[Gpu.CbFloats];
            cb[16] = 0; cb[17] = 0; cb[18] = 1; cb[19] = 1;               // rect plein écran
            cb[20] = Width; cb[21] = Height; cb[22] = Width; cb[23] = Height; // view
            cb[24] = presenceTime; cb[26] = 1;                             // misc : temps, -, opacité
            IntPtr input = inputSrv;
            PooledTarget prev = null;
            if (passes.Count == 0)
            {
                // Pas d'effet sur l'image : fond transparent (calques seuls) ou image capturée telle quelle.
                gpu.Clear(outRtv, 0, 0, 0, 0);
                if (HasCapture && inputSrv != IntPtr.Zero)
                {
                    gpu.Target(outRtv, Width, Height, false);
                    var u = new float[Gpu.CbFloats]; Array.Copy(cb, u, Gpu.CbFloats); u[1] = 1; u[2] = 1; u[3] = 2;
                    gpu.Draw(lib.VsFull, lib.Pixel("transform"), inputSrv, u, 3);
                }
            }
            // L'image de la fenêtre n'est rendue par Windows qu'à son rafraîchissement (écran entier surtout) : la vider
            // d'abord place cette attente hors des mesures GPU des passes, qui ne mesurent alors que leur coût réel.
            if (passes.Count > 0) gpu.Clear(outRtv, 0, 0, 0, 0);
            for (int i = 0; i < passes.Count; i++)
            {
                var p = passes[i];
                bool last = i == passes.Count - 1;
                PooledTarget dst = last ? null : pool.Rent(Width, Height, now);
                if (p.NeedsBlurredInput && i > 0 && prev != null) gpu.GenerateMips(prev.Srv);
                Array.Copy(p.U, cb, 16);
                cb[27] = p.Lod;
                timer.Begin(p.Label + ":" + p.Shader);
                gpu.Target(last ? outRtv : dst.Rtv, Width, Height, false);
                gpu.Draw(lib.VsFull, lib.Pixel(p.Shader), input, cb, 3);
                timer.End();
                if (prev != null) pool.Return(prev, now);
                prev = dst;
                if (dst != null) input = dst.Srv;
            }
            if (layers.Count > 0)
            {
                gpu.Target(outRtv, Width, Height, true);
                foreach (var kv in layers)
                {
                    var l = kv.Value;
                    var u = new float[Gpu.CbFloats];
                    u[0] = (float)l.Shape; u[1] = (float)l.RadiusPx; u[2] = (float)l.StrokePx; u[15] = (float)l.Rotation;
                    u[16] = (float)l.X; u[17] = (float)l.Y; u[18] = (float)l.W; u[19] = (float)l.H;
                    u[20] = Width; u[21] = Height; u[22] = Width; u[23] = Height;
                    u[24] = presenceTime; u[26] = (float)Math.Max(0, Math.Min(1, l.Opacity));
                    Array.Copy(l.Color, 0, u, 28, Math.Min(4, l.Color.Length));
                    if (l.Color.Length < 4) u[31] = 1;
                    timer.Begin(kv.Key + ":layer");
                    if (l.Texture != null) gpu.Draw(lib.VsQuad, lib.Pixel("layer_texture"), l.Texture.Srv, u, 4);
                    else gpu.Draw(lib.VsQuad, lib.Pixel("layer_shape"), IntPtr.Zero, u, 4);
                    timer.End();
                }
            }
            gpu.Unbind();
        }
    }
}
