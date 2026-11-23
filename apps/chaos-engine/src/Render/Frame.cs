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
        public string Label, Shader, TimerLabel;
        public readonly float[] U = new float[16];
        public bool NeedsBlurredInput;
        public float Lod;

        /// Réutilisation d'une passe : l'étiquette de mesure n'est recalculée que si l'effet ou le shader change.
        public void Set(string label, string shader)
        {
            if (!ReferenceEquals(label, Label) || !ReferenceEquals(shader, Shader)) { Label = label; Shader = shader; TimerLabel = label + ":" + shader; }
            Array.Clear(U, 0, U.Length);
            NeedsBlurredInput = false;
            Lod = 0;
        }
    }

    /// Réutilisé d'une image à l'autre (une instance par surface) : aucune allocation par image dans le moteur.
    sealed class FrameBuilder
    {
        public uint Width { get; private set; }
        public uint Height { get; private set; }
        public bool HasCapture { get; private set; }
        public string CurrentLabel = "effect";
        /// Repli de qualité (palier 1 de surcharge) : remplissages flous remplacés par du noir, pas de mipmaps.
        public bool LowQuality;
        /// Rotation que Windows applique déjà à l'écran (couche Entrées) : Transform la retranche, l'image affichée
        /// reste celle que l'effet décrit, quelle que soit l'orientation de l'écran.
        public double DisplayRotationRad;
        /// Résolution des passes intermédiaires (performance.render_scale, palier 2 de surcharge) ; la dernière passe
        /// écrit toujours à pleine résolution.
        public double Scale = 1;
        readonly List<FramePass> all = new List<FramePass>();
        int passCount;
        readonly List<KeyValuePair<string, Layer>> layers = new List<KeyValuePair<string, Layer>>();
        readonly Dictionary<string, string> layerLabels = new Dictionary<string, string>();
        readonly float[] cb = new float[Gpu.CbFloats];

        public FrameBuilder(uint w, uint h, bool hasCapture) { Reset(w, h, hasCapture); }

        public void Reset(uint w, uint h, bool hasCapture)
        {
            Width = w; Height = h; HasCapture = hasCapture;
            passCount = 0; layers.Clear();
            CurrentLabel = "effect"; LowQuality = false; DisplayRotationRad = 0; Scale = 1;
        }

        public int PassCount { get { return passCount; } }
        public int LayerCount { get { return layers.Count; } }
        public bool NeedsInputMips { get { return passCount > 0 && all[0].NeedsBlurredInput; } }
        /// Retire les passes et calques ajoutés après (passes, calques) : effet refusé en cours d'image (trop coûteux).
        public void Truncate(int passes, int layerCount)
        {
            if (passes < passCount) passCount = passes;
            if (layerCount < layers.Count) layers.RemoveRange(layerCount, layers.Count - layerCount);
        }

        /// Étiquettes de mesure GPU de l'image (estimation du temps GPU par image).
        public void Labels(List<string> into)
        {
            for (int i = 0; i < passCount; i++) into.Add(all[i].TimerLabel);
            foreach (var kv in layers) { string l; if (layerLabels.TryGetValue(kv.Key, out l)) into.Add(l); }
        }

        FramePass NewPass(string shader)
        {
            if (passCount == all.Count) all.Add(new FramePass());
            var p = all[passCount++];
            p.Set(CurrentLabel, shader);
            return p;
        }

        /// Transformation de l'image capturée. fill : mirror (prolongement flou et sombre de l'image transformée),
        /// black, cover (agrandit juste assez pour qu'aucune zone ne soit découverte), clamp.
        public void Transform(double rotationRad, double scaleX, double scaleY, double tx, double ty, string fill)
        {
            if (!HasCapture) throw new InvalidOperationException("Transform exige une capture (registre : emplacement à capture)");
            var p = NewPass("transform");
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
        }

        /// Passe plein écran d'un shader de la bibliothèque (16 constantes). blurredInput : le shader lit des mips.
        public void Filter(string shader, float[] u, bool blurredInput = false, float lod = 0)
        {
            if (!HasCapture) throw new InvalidOperationException("Filter exige une capture");
            var p = NewPass(shader);
            Array.Copy(u, p.U, Math.Min(16, u.Length));
            p.NeedsBlurredInput = blurredInput;
            p.Lod = lod;
        }

        public void Add(Layer l) { if (l.Opacity > 0 && l.W > 0 && l.H > 0) layers.Add(new KeyValuePair<string, Layer>(CurrentLabel, l)); }

        /// Empreinte de l'image décrite : identique et sans nouvelle capture → rien à redessiner ni à présenter.
        /// Un shader qui lit le temps (misc.x) rend l'empreinte différente à chaque image.
        public long Signature(ShaderLibrary lib, float time)
        {
            long h = 1469598103934665603L;
            Mix(ref h, Width); Mix(ref h, Height); Mix(ref h, LowQuality ? 1 : 0); Mix(ref h, Q(DisplayRotationRad)); Mix(ref h, Q(Scale));
            for (int i = 0; i < passCount; i++)
            {
                var p = all[i];
                Mix(ref h, p.Shader.GetHashCode()); Mix(ref h, p.NeedsBlurredInput ? 1 : 0); Mix(ref h, Q(p.Lod));
                for (int k = 0; k < 16; k++) Mix(ref h, Q(p.U[k]));
                if (lib.UsesTime(p.Shader)) Mix(ref h, Q(time));
            }
            foreach (var kv in layers)
            {
                var l = kv.Value;
                Mix(ref h, Q(l.X)); Mix(ref h, Q(l.Y)); Mix(ref h, Q(l.W)); Mix(ref h, Q(l.H)); Mix(ref h, Q(l.Rotation)); Mix(ref h, Q(l.Opacity));
                Mix(ref h, Q(l.RadiusPx)); Mix(ref h, Q(l.StrokePx)); Mix(ref h, (long)l.Shape);
                foreach (var c in l.Color) Mix(ref h, Q(c));
                Mix(ref h, l.Texture != null ? l.Texture.Srv.ToInt64() : 0);
            }
            return h;
        }

        static long Q(double v) { return (long)Math.Round(v * 65536.0); }
        static void Mix(ref long h, long v) { unchecked { h = (h ^ v) * 1099511628211L; } }

        /// Exécute : chaîne de passes (entrée = capture), dernière passe directement dans la cible finale, puis calques.
        /// Les passes intermédiaires écrivent à Scale × la taille de sortie (la dernière lit et agrandit en bilinéaire).
        public void Execute(Gpu gpu, ShaderLibrary lib, TexturePool pool, GpuTimer timer, IntPtr inputSrv, IntPtr outRtv, long now, float presenceTime)
        {
            Array.Clear(cb, 0, cb.Length);
            cb[18] = 1; cb[19] = 1;                                         // rect plein écran
            cb[24] = presenceTime; cb[26] = 1;                              // misc : temps, -, opacité
            IntPtr input = inputSrv;
            uint inW = Width, inH = Height;
            uint sw = Math.Max(1, (uint)Math.Round(Width * Math.Min(1, Math.Max(0.25, Scale)))), sh = Math.Max(1, (uint)Math.Round(Height * Math.Min(1, Math.Max(0.25, Scale))));
            PooledTarget prev = null;
            // L'image de la fenêtre n'est rendue par Windows qu'à son rafraîchissement (écran entier surtout) : vider la cible
            // d'abord place l'attente de son tampon hors des mesures GPU des passes, qui ne mesurent alors que leur coût réel.
            gpu.Clear(outRtv, 0, 0, 0, 0);
            if (passCount == 0 && HasCapture && inputSrv != IntPtr.Zero)
            {
                // Pas d'effet sur l'image : image capturée telle quelle (sous des calques).
                cb[1] = 1; cb[2] = 1; cb[3] = 2;
                cb[20] = Width; cb[21] = Height; cb[22] = Width; cb[23] = Height;
                gpu.Target(outRtv, Width, Height, false);
                gpu.Draw(lib.VsFull, lib.Pixel("transform"), inputSrv, cb, 3);
            }
            for (int i = 0; i < passCount; i++)
            {
                var p = all[i];
                bool last = i == passCount - 1;
                uint ow = last ? Width : sw, oh = last ? Height : sh;
                PooledTarget dst = last ? null : pool.Rent(ow, oh, now);
                if (p.NeedsBlurredInput && i > 0 && prev != null) gpu.GenerateMips(prev.Srv);
                Array.Copy(p.U, cb, 16);
                cb[16] = 0; cb[17] = 0; cb[18] = 1; cb[19] = 1;
                cb[20] = ow; cb[21] = oh; cb[22] = inW; cb[23] = inH;
                cb[27] = p.Lod;
                if (timer != null) timer.Begin(p.TimerLabel);
                gpu.Target(last ? outRtv : dst.Rtv, ow, oh, false);
                gpu.Draw(lib.VsFull, lib.Pixel(p.Shader), input, cb, 3);
                if (timer != null) timer.End();
                if (prev != null) pool.Return(prev, now);
                prev = dst;
                if (dst != null) { input = dst.Srv; inW = ow; inH = oh; }
            }
            if (layers.Count > 0)
            {
                gpu.Target(outRtv, Width, Height, true);
                foreach (var kv in layers)
                {
                    var l = kv.Value;
                    Array.Clear(cb, 0, cb.Length);
                    cb[0] = (float)l.Shape; cb[1] = (float)l.RadiusPx; cb[2] = (float)l.StrokePx; cb[15] = (float)l.Rotation;
                    cb[16] = (float)l.X; cb[17] = (float)l.Y; cb[18] = (float)l.W; cb[19] = (float)l.H;
                    cb[20] = Width; cb[21] = Height; cb[22] = Width; cb[23] = Height;
                    cb[24] = presenceTime; cb[26] = (float)Math.Max(0, Math.Min(1, l.Opacity));
                    Array.Copy(l.Color, 0, cb, 28, Math.Min(4, l.Color.Length));
                    if (l.Color.Length < 4) cb[31] = 1;
                    string label;
                    if (!layerLabels.TryGetValue(kv.Key, out label)) layerLabels[kv.Key] = label = kv.Key + ":layer";
                    if (timer != null) timer.Begin(label);
                    if (l.Texture != null) gpu.Draw(lib.VsQuad, lib.Pixel("layer_texture"), l.Texture.Srv, cb, 4);
                    else gpu.Draw(lib.VsQuad, lib.Pixel("layer_shape"), IntPtr.Zero, cb, 4);
                    if (timer != null) timer.End();
                }
            }
            gpu.Unbind();
        }
    }
}
