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
            // Sans allocation (chaque image) : recherche à la main plutôt qu'une requête LINQ.
            PooledTarget t = null;
            for (int i = 0; i < free.Count; i++) if (free[i].W == w && free[i].H == h) { t = free[i]; free.RemoveAt(i); break; }
            if (t != null) { }
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

    /// Image retenue par un effet (flash : l'instant du déclenchement), copiée de l'image capturée par FrameBuilder.Retain
    /// à la prochaine image rendue, avec ses mipmaps (lecture floue). Allouée à la première copie ; l'effet la libère
    /// (Dispose). Une passe ou un calque la lit comme seconde texture (aux, register t1).
    sealed class RetainedImage
    {
        public IntPtr Tex, Srv, Rtv;
        public uint W, H;
        /// Une image a été copiée (lisible).
        public bool Ready;
        internal bool Pending;
        public void Release() { Com.Release(ref Rtv); Com.Release(ref Srv); Com.Release(ref Tex); Ready = false; Pending = false; }
    }

    /// Texture affichable par un calque (texte rasterisé, image).
    sealed class TextureRef
    {
        public IntPtr Tex, Srv;
        public int W, H;
        public void Release() { Com.Release(ref Srv); Com.Release(ref Tex); }
    }

    enum LayerShape { RoundedRect = 0, Ellipse = 1, Ring = 2 }

    /// Un calque : rectangle normalisé (0..1, coin haut-gauche + taille), rotation, opacité, forme ou texture ; ou un
    /// shader de la bibliothèque plein écran (FrameBuilder.Overlay).
    sealed class Layer
    {
        public double X, Y, W, H, Rotation, Opacity = 1, RadiusPx, StrokePx;
        public LayerShape Shape;
        public float[] Color = { 1, 1, 1, 1 };
        public TextureRef Texture;
        /// Texture retournée horizontalement (curseur d'une image en miroir).
        public bool FlipX;
        /// Calque shader (plein écran, alpha prémultiplié) : nom, 16 constantes, résolution de rendu (1 = pleine),
        /// seconde texture facultative.
        public string Shader;
        public readonly float[] U = new float[32];
        public double Scale = 1;
        public IntPtr Aux;
        internal string TimerLabel, LabelEffect;

        /// Centre un calque de taille (w, h) normalisée sur (cx, cy).
        public static Layer Centered(double cx, double cy, double w, double h)
        {
            return new Layer { X = cx - w / 2, Y = cy - h / 2, W = w, H = h };
        }
    }

    sealed class FramePass
    {
        public string Label, Shader, TimerLabel;
        /// 32 constantes : u0..u3 puis u4..u7 du shader.
        public readonly float[] U = new float[32];
        public bool NeedsBlurredInput;
        public float Lod;
        /// Seconde texture (image retenue), register t1 ; zéro = aucune.
        public IntPtr Aux;

        /// Réutilisation d'une passe : l'étiquette de mesure n'est recalculée que si l'effet ou le shader change.
        public void Set(string label, string shader)
        {
            if (!ReferenceEquals(label, Label) || !ReferenceEquals(shader, Shader)) { Label = label; Shader = shader; TimerLabel = label + ":" + shader; }
            Array.Clear(U, 0, U.Length);
            NeedsBlurredInput = false;
            Lod = 0;
            Aux = IntPtr.Zero;
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
        // Transformations de l'image, dans l'ordre des passes (AddCursor pose le curseur par leur composition) :
        // 5 valeurs chacune (rotation, échelle x, échelle y, translation x, y), 4 au plus.
        const int MaxTransforms = 4;
        readonly double[] chain = new double[MaxTransforms * 5];
        int chainCount;
        static readonly float[] White = { 1, 1, 1, 1 };
        // Calques shader réutilisés d'une image à l'autre, images à retenir à cette image.
        readonly List<Layer> overlayPool = new List<Layer>();
        int overlayCount;
        readonly List<RetainedImage> retains = new List<RetainedImage>();

        public FrameBuilder(uint w, uint h, bool hasCapture) { Reset(w, h, hasCapture); }

        public void Reset(uint w, uint h, bool hasCapture)
        {
            Width = w; Height = h; HasCapture = hasCapture;
            passCount = 0; layers.Clear();
            CurrentLabel = "effect"; LowQuality = false; DisplayRotationRad = 0; Scale = 1;
            chainCount = 0; overlayCount = 0; retains.Clear();
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
            foreach (var kv in layers)
            {
                if (kv.Value.Shader != null) { into.Add(kv.Value.TimerLabel); continue; }
                string l; if (layerLabels.TryGetValue(kv.Key, out l)) into.Add(l);
            }
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
            if (chainCount < MaxTransforms)
            {
                int k = chainCount++ * 5;
                chain[k] = rotationRad; chain[k + 1] = scaleX; chain[k + 2] = scaleY; chain[k + 3] = tx; chain[k + 4] = ty;
            }
            p.U[4] = (float)tx; p.U[5] = (float)ty; p.U[6] = 0.45f; p.U[7] = Math.Min(Math.Abs(scaleX), Math.Abs(scaleY)) >= 1.8 ? 1 : 0;
            p.NeedsBlurredInput = uncovered && mode == 0;
            p.Lod = 4.5f;
        }

        /// Passe plein écran d'un shader de la bibliothèque (32 constantes : u0..u7). blurredInput : le shader lit des
        /// mips. aux : seconde texture lue par le shader (image retenue).
        public void Filter(string shader, float[] u, bool blurredInput = false, float lod = 0, IntPtr aux = default(IntPtr))
        {
            if (!HasCapture) throw new InvalidOperationException("Filter exige une capture");
            var p = NewPass(shader);
            Array.Copy(u, p.U, Math.Min(32, u.Length));
            p.NeedsBlurredInput = blurredInput;
            p.Lod = lod;
            p.Aux = aux;
        }

        /// Calque plein écran dessiné par un shader de la bibliothèque, en alpha prémultiplié, SANS capture (paupières,
        /// brouillard, masque) : u = 16 constantes ; scale < 1 : rendu à résolution réduite puis agrandi (motifs doux,
        /// coût divisé par 1/scale²) ; aux : seconde texture (image retenue). Aucune allocation par image.
        public void Overlay(string shader, float[] u, double scale = 1, IntPtr aux = default(IntPtr), double opacity = 1, float[] color = null)
        {
            if (overlayCount == overlayPool.Count) overlayPool.Add(new Layer());
            var l = overlayPool[overlayCount++];
            l.X = 0; l.Y = 0; l.W = 1; l.H = 1; l.Rotation = 0; l.Opacity = opacity; l.Texture = null; l.FlipX = false;
            if (!ReferenceEquals(l.LabelEffect, CurrentLabel) || !ReferenceEquals(l.Shader, shader)) { l.LabelEffect = CurrentLabel; l.TimerLabel = CurrentLabel + ":" + shader; }
            l.Shader = shader; l.Scale = Math.Max(0.125, Math.Min(1, scale)); l.Aux = aux;
            Array.Clear(l.U, 0, 32);
            Array.Copy(u, l.U, Math.Min(32, u.Length));
            if (color != null) { l.Color = color; } else { l.Color = White; }
            Add(l);
        }

        /// Retient l'image d'entrée de cette image (la capture) dans r, avec mipmaps : r.Ready à l'image suivante.
        public void Retain(RetainedImage r)
        {
            if (!HasCapture) throw new InvalidOperationException("Retain exige une capture");
            r.Pending = true;
            retains.Add(r);
        }

        /// Image du vrai curseur (forme lue à cette image), posée par la MÊME transformation que l'image capturée :
        /// au retournement, pointe au point miroir et image tournée ; pendant la rotation animée, au point tourné. Ce que
        /// l'on voit sous ce curseur est donc toujours ce que le clic, qui tombe à la vraie position, touchera.
        /// (px, py) : pointe du vrai curseur dans la cible, en pixels. Calque par-dessus tout le reste.
        /// Plusieurs transformations (miroir puis tremblement, zoom puis secousse…) : le curseur suit leur composition, dans
        /// l'ordre des passes ; son image prend la même orientation (rotation, miroir) et la même échelle.
        public void AddCursor(TextureRef tex, int hotX, int hotY, double px, double py)
        {
            double w0 = Width, h0 = Height, ax = w0 / h0;
            // Espace « aspect » du shader (x × largeur/hauteur) : unités égales sur les deux axes.
            double qx = ((px + 0.5) / w0 - 0.5) * ax, qy = (py + 0.5) / h0 - 0.5;
            double m00 = 1, m01 = 0, m10 = 0, m11 = 1; // partie linéaire composée
            for (int i = 0; i < chainCount; i++)
            {
                int j = i * 5;
                double k = Math.Cos(chain[j]), s = Math.Sin(chain[j]), sx = chain[j + 1], sy = chain[j + 2];
                // Inverse exacte du shader « transform » (sortie → source) : source → sortie.
                double ux = qx * sx, uy = qy * sy;
                qx = k * ux - s * uy + chain[j + 3]; qy = s * ux + k * uy + chain[j + 4];
                double a00 = k * sx, a01 = -s * sy, a10 = s * sx, a11 = k * sy;
                double n00 = a00 * m00 + a01 * m10, n01 = a00 * m01 + a01 * m11, n10 = a10 * m00 + a11 * m10, n11 = a10 * m01 + a11 * m11;
                m00 = n00; m01 = n01; m10 = n10; m11 = n11;
            }
            double cx = (qx / ax + 0.5) * w0, cy = (qy + 0.5) * h0;
            double det = m00 * m11 - m01 * m10;
            bool flip = det < 0;
            if (flip) { m00 = -m00; m10 = -m10; } // M × diag(-1, 1) : rotation pure (à l'échelle près)
            double rot = Math.Atan2(m10, m00), scale = Math.Sqrt(Math.Abs(det));
            double sw = tex.W * scale, sh = tex.H * scale;
            // Pointe (hotspot) : décalage depuis le centre de l'image, transformé comme l'image (miroir puis rotation).
            double hx = (hotX + 0.5 - tex.W / 2.0) * scale * (flip ? -1 : 1), hy = (hotY + 0.5 - tex.H / 2.0) * scale;
            double kr = Math.Cos(rot), sr = Math.Sin(rot);
            double centerX = cx - (kr * hx - sr * hy), centerY = cy - (sr * hx + kr * hy);
            layers.Add(new KeyValuePair<string, Layer>("cursor", new Layer { X = (centerX - sw / 2) / w0, Y = (centerY - sh / 2) / h0, W = sw / w0, H = sh / h0, Rotation = rot, Texture = tex, FlipX = flip }));
        }

        public void Add(Layer l) { if (l.Opacity > 0 && l.W > 0 && l.H > 0) layers.Add(new KeyValuePair<string, Layer>(CurrentLabel, l)); }

        /// Empreinte de l'image décrite : identique et sans nouvelle capture → rien à redessiner ni à présenter.
        /// Un shader qui lit le temps (misc.x) rend l'empreinte différente à chaque image.
        public long Signature(ShaderLibrary lib, float time)
        {
            long h = 1469598103934665603L;
            Mix(ref h, Width); Mix(ref h, Height); Mix(ref h, LowQuality ? 1 : 0); Mix(ref h, Q(DisplayRotationRad)); Mix(ref h, Q(Scale));
            Mix(ref h, retains.Count);
            for (int i = 0; i < passCount; i++)
            {
                var p = all[i];
                Mix(ref h, p.Shader.GetHashCode()); Mix(ref h, p.NeedsBlurredInput ? 1 : 0); Mix(ref h, Q(p.Lod)); Mix(ref h, p.Aux.ToInt64());
                for (int k = 0; k < 32; k++) Mix(ref h, Q(p.U[k]));
                if (lib.UsesTime(p.Shader)) Mix(ref h, Q(time));
            }
            foreach (var kv in layers)
            {
                var l = kv.Value;
                Mix(ref h, Q(l.X)); Mix(ref h, Q(l.Y)); Mix(ref h, Q(l.W)); Mix(ref h, Q(l.H)); Mix(ref h, Q(l.Rotation)); Mix(ref h, Q(l.Opacity));
                Mix(ref h, Q(l.RadiusPx)); Mix(ref h, Q(l.StrokePx)); Mix(ref h, (long)l.Shape); Mix(ref h, l.FlipX ? 1 : 0);
                foreach (var c in l.Color) Mix(ref h, Q(c));
                Mix(ref h, l.Texture != null ? l.Texture.Srv.ToInt64() : 0);
                if (l.Shader != null)
                {
                    Mix(ref h, l.Shader.GetHashCode()); Mix(ref h, Q(l.Scale)); Mix(ref h, l.Aux.ToInt64());
                    for (int k = 0; k < 32; k++) Mix(ref h, Q(l.U[k]));
                    if (lib.UsesTime(l.Shader)) Mix(ref h, Q(time));
                }
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
            // Images retenues (flash) : ce qui est AFFICHÉ, sans les calques. Sans passe : l'image capturée ; avec des passes
            // (retournement, zoom…) : la sortie de la dernière, qui écrit alors dans une cible du pool, copiée ensuite.
            bool retainAfter = false;
            foreach (var r in retains) if (r.Pending && inputSrv != IntPtr.Zero) { if (passCount > 0) retainAfter = true; else RetainFrom(gpu, lib, r, inputSrv); }
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
                bool last = i == passCount - 1 && !retainAfter;
                uint ow = last ? Width : sw, oh = last ? Height : sh;
                PooledTarget dst = last ? null : pool.Rent(ow, oh, now);
                if (p.NeedsBlurredInput && i > 0 && prev != null) gpu.GenerateMips(prev.Srv);
                Array.Copy(p.U, 0, cb, 0, 16);
                Array.Copy(p.U, 16, cb, 32, 16);
                cb[16] = 0; cb[17] = 0; cb[18] = 1; cb[19] = 1;
                cb[20] = ow; cb[21] = oh; cb[22] = inW; cb[23] = inH;
                cb[27] = p.Lod;
                if (timer != null) timer.Begin(p.TimerLabel);
                gpu.Target(last ? outRtv : dst.Rtv, ow, oh, false);
                gpu.Draw(lib.VsFull, lib.Pixel(p.Shader), input, cb, 3, p.Aux);
                if (timer != null) timer.End();
                if (prev != null) pool.Return(prev, now);
                prev = dst;
                if (dst != null) { input = dst.Srv; inW = ow; inH = oh; }
            }
            if (retainAfter && prev != null)
            {
                // Image finale des passes : retenue, puis recopiée dans la cible (cette image seulement).
                foreach (var r in retains) if (r.Pending) RetainFrom(gpu, lib, r, prev.Srv);
                Array.Clear(cb, 0, cb.Length);
                cb[18] = 1; cb[19] = 1; cb[20] = Width; cb[21] = Height; cb[22] = inW; cb[23] = inH; cb[26] = 1;
                gpu.Target(outRtv, Width, Height, false);
                gpu.Draw(lib.VsFull, lib.Pixel("copy"), prev.Srv, cb, 3);
                pool.Return(prev, now);
                prev = null;
            }
            if (layers.Count > 0)
            {
                gpu.Target(outRtv, Width, Height, true);
                foreach (var kv in layers)
                {
                    var l = kv.Value;
                    Array.Clear(cb, 0, cb.Length);
                    if (l.Shader != null) { DrawShaderLayer(gpu, lib, pool, timer, l, outRtv, now, presenceTime); continue; }
                    cb[0] = (float)l.Shape; cb[1] = (float)l.RadiusPx; cb[2] = (float)l.StrokePx; cb[15] = (float)l.Rotation;
                    cb[4] = l.FlipX ? 1 : 0;
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

        void RetainFrom(Gpu gpu, ShaderLibrary lib, RetainedImage r, IntPtr srv)
        {
            if (r.Tex == IntPtr.Zero || r.W != Width || r.H != Height)
            {
                r.Release();
                r.W = Width; r.H = Height;
                r.Tex = gpu.Texture(Width, Height, 0, 0x8 | 0x20, 0x1, 0, 0);
                r.Srv = gpu.Srv(r.Tex); r.Rtv = gpu.Rtv(r.Tex);
            }
            Array.Clear(cb, 0, cb.Length);
            cb[18] = 1; cb[19] = 1; cb[20] = Width; cb[21] = Height; cb[22] = Width; cb[23] = Height;
            gpu.Target(r.Rtv, Width, Height, false);
            gpu.Draw(lib.VsFull, lib.Pixel("copy"), srv, cb, 3);
            gpu.GenerateMips(r.Srv);
            r.Pending = false; r.Ready = true;
        }

        /// Calque shader plein écran : directement dans la cible (pleine résolution), ou dans une cible réduite du pool
        /// puis agrandi en bilinéaire par-dessus l'image (scale < 1).
        void DrawShaderLayer(Gpu gpu, ShaderLibrary lib, TexturePool pool, GpuTimer timer, Layer l, IntPtr outRtv, long now, float time)
        {
            string label = l.TimerLabel;
            Array.Copy(l.U, 0, cb, 0, 16);
            Array.Copy(l.U, 16, cb, 32, 16);
            Array.Copy(l.Color, 0, cb, 28, Math.Min(4, l.Color.Length));
            cb[18] = 1; cb[19] = 1; cb[22] = Width; cb[23] = Height;
            cb[24] = time; cb[26] = (float)Math.Max(0, Math.Min(1, l.Opacity));
            if (timer != null) timer.Begin(label);
            if (l.Scale >= 0.999)
            {
                cb[20] = Width; cb[21] = Height;
                gpu.Draw(lib.VsFull, lib.Pixel(l.Shader), IntPtr.Zero, cb, 3, l.Aux);
            }
            else
            {
                uint lw = Math.Max(1, (uint)Math.Round(Width * l.Scale)), lh = Math.Max(1, (uint)Math.Round(Height * l.Scale));
                var t = pool.Rent(lw, lh, now);
                cb[20] = lw; cb[21] = lh;
                gpu.Target(t.Rtv, lw, lh, false);
                gpu.Draw(lib.VsFull, lib.Pixel(l.Shader), IntPtr.Zero, cb, 3, l.Aux);
                Array.Clear(cb, 0, cb.Length);
                cb[18] = 1; cb[19] = 1; cb[20] = Width; cb[21] = Height; cb[22] = lw; cb[23] = lh;
                gpu.Target(outRtv, Width, Height, true);
                gpu.Draw(lib.VsFull, lib.Pixel("layer_full"), t.Srv, cb, 3);
                pool.Return(t, now);
            }
            if (timer != null) timer.End();
        }
    }
}
