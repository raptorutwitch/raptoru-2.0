// Aperçu et banc des effets du catalogue, hors écran (aucune fenêtre, aucune capture, rien d'affiché) :
//   --render-effects <dossier> [effet…] [--frames]  planche par effet : une ligne par variante, une colonne par instant
//                                                    (entrée, maintien, sortie), sur une image de jeu de synthèse ;
//                                                    --frames écrit aussi des images pleine taille (évolution détaillée).
//   --bench-effects [--w 2560 --h 1440 --frames 300] temps GPU par passe de chaque effet (variante d'aperçu), à la
//                                                    résolution donnée ; ne mesure ni un jeu, ni la capture, ni la
//                                                    présentation.
// C'est la vraie chaîne : registre, résolution des paramètres (variantes), effets, FrameBuilder, shaders, pool.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

namespace Raptoru.Chaos
{
    static class EffectPreview
    {
        sealed class Rig
        {
            public Gpu Gpu; public ShaderLibrary Lib; public TexturePool Pool; public GpuTimer Timer; public TextRaster Text;
            public uint W, H; public IntPtr Src, SrcSrv, Out, OutRtv, Staging, Big;
            public Rig(uint w, uint h, bool staging)
            {
                W = w; H = h;
                Gpu = new Gpu(); Lib = new ShaderLibrary(Gpu, null); Pool = new TexturePool(Gpu); Timer = new GpuTimer(Gpu); Text = new TextRaster(Gpu);
                Src = Gpu.Texture(w, h, 0, 0x8 | 0x20, 0x1, 0, 0); SrcSrv = Gpu.Srv(Src);
                // Panorama 1,5 × plus large que l'écran : la « caméra du jeu » le parcourt (Pan), pour que les effets qui
                // retiennent une image (flash) ou suivent le mouvement se jugent sur une image qui bouge.
                Big = Gpu.TextureWithData(w * 3 / 2, h, Scene((int)(w * 3 / 2), (int)h));
                Pan(0);
                Out = Gpu.Texture(w, h, 1, 0x8 | 0x20, 0, 0, 0); OutRtv = Gpu.Rtv(Out);
                if (staging) Staging = Gpu.Texture(w, h, 1, 0, 0, 3, 0x20000);
            }
            /// Image « capturée » à l'instant t (ms) : la caméra balaie le panorama (aller-retour en 8 s).
            public void Pan(long t)
            {
                uint x = (uint)Math.Round((0.5 - 0.5 * Math.Cos(t / 8000.0 * 2 * Math.PI)) * (W / 2));
                Gpu.Copy(Src, Big, x, 0, W, H);
                Gpu.GenerateMips(SrcSrv);
            }
        }

        /// Une activation simulée : paramètres résolus (variante), animateur, effet préparé, graine fixe.
        sealed class Sim
        {
            public ResolvedParams P; public Animator Anim; public Effect Fx; public readonly EffectFrame F = new EffectFrame();
            public long Total;
            public Sim(Registry reg, Rig rig, EffectDef def, string variant, int seed)
            {
                P = Params.Resolve(def, variant, null, null, null, null, reg.Limits, new SafetyConfig { MaxDurationMs = reg.Limits.MaxDurationMs }, true);
                Anim = new Animator(P.In, P.Out);
                Anim.Start(0);
                Fx = EffectCatalog.Create(def.Id);
                Fx.Prepare(new EffectContext { Gpu = rig.Gpu, Shaders = rig.Lib, Text = rig.Text, P = P, Seed = seed });
                Fx.Start();
                F.P = P; F.Seed = seed; F.Width = rig.W; F.Height = rig.H;
                Total = P.DurationMs + (P.Out.Instant ? 0 : P.Out.DurationMs);
            }
            /// Rend l'instant t (ms depuis le départ) dans fb ; la sortie commence à la fin de la durée.
            public void Render(FrameBuilder fb, long t)
            {
                if (t >= P.DurationMs) Anim.BeginExit(P.DurationMs);
                F.Presence = Anim.Presence(t); F.NowMs = t; F.ElapsedMs = t; F.Exiting = t >= P.DurationMs;
                fb.CurrentLabel = P.Def.Id;
                Fx.Update(F);
                Fx.Render(fb, F);
            }
        }

        static IEnumerable<EffectDef> Catalogue(Registry reg, IList<string> only)
        {
            return reg.Effects.Values.Where(d => !d.Internal && (only.Count == 0 || only.Contains(d.Id)));
        }

        public static int Run(string dir, IList<string> only, bool frames, uint W = 480, uint H = 270)
        {
            Directory.CreateDirectory(dir);
            var reg = Registry.Embedded();
            var rig = new Rig(W, H, true);
            foreach (var def in Catalogue(reg, only))
            {
                var rows = new List<KeyValuePair<string, List<KeyValuePair<string, Bitmap>>>>();
                var variants = def.Variants.Count > 0 ? def.Variants.Keys.ToList() : new List<string> { null };
                int vi = 0;
                foreach (var v in variants)
                {
                    var sim = new Sim(reg, rig, def, v, 12345 + vi++);
                    var times = Times(sim);
                    var row = new List<KeyValuePair<string, Bitmap>>();
                    var fb = new FrameBuilder(W, H, true);
                    // Les effets à état (flash : image retenue) sont rendus image par image, dans l'ordre, à 30 i/s.
                    int k = 0;
                    for (long t = 0; k < times.Count; t += 33)
                    {
                        bool shot = t >= times[k];
                        fb.Reset(W, H, true);
                        rig.Pan(shot ? times[k] : t);
                        sim.Render(fb, shot ? times[k] : t);
                        if (fb.NeedsInputMips) { /* image de référence : mipmaps déjà générés */ }
                        fb.Execute(rig.Gpu, rig.Lib, rig.Pool, null, rig.SrcSrv, rig.OutRtv, t, t / 1000f);
                        if (!shot) continue;
                        var bmp = Read(rig);
                        row.Add(new KeyValuePair<string, Bitmap>(Label(sim, times[k]), bmp));
                        if (frames && (only.Count == 0 || only.Contains(def.Id))) bmp.Save(Path.Combine(dir, def.Id + "-" + (v ?? "defaut") + "-" + times[k].ToString("00000") + ".png"), ImageFormat.Png);
                        k++;
                    }
                    sim.Fx.Dispose();
                    var label = (v == null ? "(défaut)" : v) + " · " + sim.P.DurationMs / 1000.0 + " s";
                    rows.Add(new KeyValuePair<string, List<KeyValuePair<string, Bitmap>>>(label, row));
                }
                string file = Path.Combine(dir, "fx-" + def.Id + ".png");
                Contact(def.Label, rows, file, (int)W, (int)H);
                Console.WriteLine(file);
            }
            return 0;
        }

        /// Bande temporelle : n images de t0 à t1 (ms) d'une variante, rendues image par image à 60 i/s (évolution fine :
        /// un clignement, un flash, une secousse).
        public static int Strip(string dir, string id, string variant, long t0, long t1, int n, uint W = 480, uint H = 270)
        {
            Directory.CreateDirectory(dir);
            var reg = Registry.Embedded();
            var def = reg.Get(id);
            if (def == null) { Console.WriteLine("effet inconnu"); return 1; }
            var rig = new Rig(W, H, true);
            var sim = new Sim(reg, rig, def, variant == "-" ? null : variant, 12345);
            var fb = new FrameBuilder(W, H, true);
            var row = new List<KeyValuePair<string, Bitmap>>();
            int k = 0;
            for (long t = 0; k < n; t += 16)
            {
                long want = n == 1 ? t0 : t0 + (t1 - t0) * k / (n - 1);
                bool shot = t >= want;
                fb.Reset(W, H, true);
                rig.Pan(shot ? want : t);
                sim.Render(fb, shot ? want : t);
                fb.Execute(rig.Gpu, rig.Lib, rig.Pool, null, rig.SrcSrv, rig.OutRtv, t, t / 1000f);
                if (!shot) continue;
                var img = Read(rig);
                if (n == 1) img.Save(Path.Combine(dir, "frame-" + id + "-" + (variant ?? "defaut") + "-" + want + ".png"), ImageFormat.Png);
                row.Add(new KeyValuePair<string, Bitmap>(Label(sim, want), img));
                k++;
            }
            sim.Fx.Dispose();
            string file = Path.Combine(dir, "strip-" + id + "-" + (variant ?? "defaut") + "-" + t0 + "-" + t1 + ".png");
            var rows = new List<KeyValuePair<string, List<KeyValuePair<string, Bitmap>>>>();
            for (int i = 0; i < row.Count; i += 6) rows.Add(new KeyValuePair<string, List<KeyValuePair<string, Bitmap>>>(i == 0 ? (variant ?? "") : "", row.Skip(i).Take(6).ToList()));
            Contact(def.Label + " · " + (variant ?? "défaut"), rows, file, (int)W, (int)H);
            Console.WriteLine(file);
            return 0;
        }

        /// Instants montrés : début d'entrée, fin d'entrée, maintien (3), début et milieu de sortie, fin.
        static List<long> Times(Sim s)
        {
            long d = s.P.DurationMs, inMs = s.P.In.Instant ? 0 : s.P.In.DurationMs, outMs = s.P.Out.Instant ? 0 : s.P.Out.DurationMs;
            var l = new List<long> { Math.Min(d, inMs / 3), Math.Min(d, Math.Max(inMs, 120)), d / 4, d / 2, d * 3 / 4, d - 1, d + outMs / 2 };
            return l.Select(x => Math.Max(0, x)).Distinct().OrderBy(x => x).ToList();
        }

        static string Label(Sim s, long t)
        {
            string ph = t < s.P.DurationMs ? (s.Anim.Phase == AnimPhase.Entering ? "entrée" : "") : "sortie";
            return (t / 1000.0).ToString("0.00") + " s " + ph + " · p " + s.F.Presence.ToString("0.00");
        }

        public static int Bench(int w, int h, int frames)
        {
            var reg = Registry.Embedded();
            var rig = new Rig((uint)w, (uint)h, false);
            rig.Lib.Warm();
            var results = new Dictionary<string, object>();
            foreach (var def in Catalogue(reg, new List<string>()))
            {
                object pv; string variant = null;
                var viewer = def.Raw.TryGetValue("viewer", out pv) ? pv as Dictionary<string, object> : null;
                if (viewer != null) variant = J.Str(viewer, "preview", null);
                var sim = new Sim(reg, rig, def, variant, 777);
                var per = new Dictionary<string, Samples>();
                Action<string, double> add = (label, ms) => { Samples s; if (!per.TryGetValue(label, out s)) per[label] = s = new Samples(); s.Add(ms); };
                var fb = new FrameBuilder((uint)w, (uint)h, true);
                var cpu = System.Diagnostics.Stopwatch.StartNew();
                long steady = Math.Max(1, sim.P.DurationMs / 2);
                for (int i = 0; i < frames; i++)
                {
                    long t = Math.Min(sim.P.DurationMs - 1, steady + i * 16);
                    fb.Reset((uint)w, (uint)h, true);
                    sim.Render(fb, t);
                    // Comme le moteur : les mipmaps de l'entrée sont refaits à chaque image s'ils sont lus (capture neuve).
                    if (fb.NeedsInputMips) { rig.Timer.Begin(def.Id + ":mips"); rig.Gpu.GenerateMips(rig.SrcSrv); rig.Timer.End(); }
                    fb.Execute(rig.Gpu, rig.Lib, rig.Pool, rig.Timer, rig.SrcSrv, rig.OutRtv, t, t / 1000f);
                    rig.Timer.Collect(add);
                }
                double cpuMs = cpu.Elapsed.TotalMilliseconds / frames;
                System.Threading.Thread.Sleep(150);
                rig.Timer.Collect(add);
                sim.Fx.Dispose();
                double total = per.Values.Sum(s => s.P(50));
                results[def.Id] = J.Map("variant", variant, "gpu_ms_p50_total", Math.Round(total, 3),
                    "passes", per.ToDictionary(kv => kv.Key, kv => (object)J.Map("gpu_ms_p50", kv.Value.P(50), "gpu_ms_p95", kv.Value.P(95), "samples", kv.Value.Count)),
                    "cpu_ms_per_frame", Math.Round(cpuMs, 3), "pool_targets", rig.Pool.Live);
            }
            Console.WriteLine(J.Write(J.Map("resolution", w + "x" + h, "frames_per_effect", frames, "adapter", rig.Gpu.Adapter, "effects", results,
                "note", "GPU par passe (horodatages), entrée = image fixe de la taille donnée ; hors capture, présentation et jeu.")));
            return 0;
        }

        static Bitmap Read(Rig r)
        {
            r.Gpu.Copy(r.Staging, r.Out, 0, 0, r.W, r.H);
            var px = r.Gpu.ReadBack(r.Staging, r.W, r.H);
            var bmp = new Bitmap((int)r.W, (int)r.H, PixelFormat.Format32bppArgb);
            var data = bmp.LockBits(new Rectangle(0, 0, (int)r.W, (int)r.H), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            for (int y = 0; y < r.H; y++) Marshal.Copy(px, (int)(y * r.W * 4), new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), (int)(r.W * 4));
            bmp.UnlockBits(data);
            // Sortie opaque (la référence est dessous) : alpha forcé à 255 pour l'enregistrement.
            var d2 = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            var all = new byte[d2.Stride * bmp.Height];
            Marshal.Copy(d2.Scan0, all, 0, all.Length);
            for (int i = 3; i < all.Length; i += 4) all[i] = 255;
            Marshal.Copy(all, 0, d2.Scan0, all.Length);
            bmp.UnlockBits(d2);
            return bmp;
        }

        static void Contact(string title, List<KeyValuePair<string, List<KeyValuePair<string, Bitmap>>>> rows, string file, int w, int h)
        {
            int cols = rows.Max(r => r.Value.Count), tw = Math.Min(320, w * 2 / 3), th = tw * h / w, pad = 6, label = 20, head = 28;
            using (var sheet = new Bitmap(cols * (tw + pad) + pad + 150, head + rows.Count * (th + label + pad) + pad))
            using (var g = Graphics.FromImage(sheet))
            using (var f = new Font("Segoe UI", 9)) using (var fb = new Font("Segoe UI", 12, FontStyle.Bold))
            {
                g.Clear(Color.FromArgb(28, 28, 34));
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.DrawString(title, fb, Brushes.White, pad, 4);
                for (int r = 0; r < rows.Count; r++)
                {
                    int y = head + r * (th + label + pad);
                    g.DrawString(rows[r].Key, f, Brushes.Gold, pad, y + label + th / 2 - 8);
                    for (int c = 0; c < rows[r].Value.Count; c++)
                    {
                        int x = 150 + pad + c * (tw + pad);
                        g.DrawString(rows[r].Value[c].Key, f, Brushes.Gainsboro, x, y + 2);
                        g.DrawImage(rows[r].Value[c].Value, x, y + label, tw, th);
                    }
                }
                sheet.Save(file, ImageFormat.Png);
            }
        }

        /// Image de jeu de synthèse : ciel, soleil, montagnes, ville, sol en perspective, personnage, interface (vie,
        /// munitions, mini-carte, viseur, texte). Assez de détails fins et de contrastes pour juger un flou, une
        /// pixelisation, un brouillard ou une rémanence.
        public static byte[] Scene(int w, int h)
        {
            using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    float s = h / 270f;
                    using (var sky = new LinearGradientBrush(new Rectangle(0, 0, w, h), Color.FromArgb(40, 90, 170), Color.FromArgb(240, 170, 110), 90f))
                        g.FillRectangle(sky, 0, 0, w, h);
                    g.FillEllipse(new SolidBrush(Color.FromArgb(255, 245, 200)), w * 0.72f, h * 0.18f, 34 * s, 34 * s);
                    var rnd = new Random(7);
                    var mount = new List<PointF> { new PointF(0, h * 0.62f) };
                    for (int i = 0; i <= 12; i++) mount.Add(new PointF(w * i / 12f, h * (0.38f + 0.14f * (float)rnd.NextDouble())));
                    mount.Add(new PointF(w, h * 0.62f));
                    g.FillPolygon(new SolidBrush(Color.FromArgb(70, 80, 110)), mount.ToArray());
                    for (int i = 0; i < 14; i++)
                    {
                        float bx = w * (i / 14f), bw = w / 16f, bh = h * (0.12f + 0.16f * (float)rnd.NextDouble());
                        g.FillRectangle(new SolidBrush(Color.FromArgb(45 + i * 3, 50, 70)), bx, h * 0.62f - bh, bw, bh);
                        for (int wy = 0; wy < 5; wy++) for (int wx = 0; wx < 3; wx++)
                                if (rnd.NextDouble() < 0.55) g.FillRectangle(Brushes.Khaki, bx + 3 * s + wx * 6 * s, h * 0.62f - bh + 4 * s + wy * 7 * s, 3 * s, 3 * s);
                    }
                    g.FillRectangle(new SolidBrush(Color.FromArgb(60, 95, 55)), 0, h * 0.62f, w, h * 0.38f);
                    using (var pen = new Pen(Color.FromArgb(110, 200, 230, 160), 1))
                    {
                        for (int i = -10; i <= 10; i++) g.DrawLine(pen, w / 2f, h * 0.62f, w / 2f + i * w / 7f, h);
                        for (int i = 1; i < 8; i++) { float y = h * 0.62f + h * 0.38f * (float)Math.Pow(i / 8.0, 1.8); g.DrawLine(pen, 0, y, w, y); }
                    }
                    g.FillEllipse(Brushes.SaddleBrown, w * 0.30f, h * 0.55f, 14 * s, 14 * s);
                    g.FillRectangle(Brushes.DarkRed, w * 0.30f - 2 * s, h * 0.55f + 13 * s, 18 * s, 30 * s);
                    g.FillRectangle(new SolidBrush(Color.FromArgb(160, 0, 0, 0)), 10 * s, h - 26 * s, 120 * s, 16 * s);
                    g.FillRectangle(Brushes.LimeGreen, 12 * s, h - 24 * s, 80 * s, 12 * s);
                    using (var f = new Font("Segoe UI", 11 * s, FontStyle.Bold))
                    {
                        g.DrawString("30 / 120", f, Brushes.White, w - 90 * s, h - 30 * s);
                        g.DrawString("OBJECTIF : POINT B", f, Brushes.White, 10 * s, 8 * s);
                    }
                    g.FillRectangle(new SolidBrush(Color.FromArgb(150, 10, 20, 30)), w - 70 * s, 8 * s, 60 * s, 60 * s);
                    g.DrawEllipse(Pens.Cyan, w - 44 * s, 34 * s, 8 * s, 8 * s);
                    using (var pen = new Pen(Color.White, 2 * s))
                    {
                        g.DrawLine(pen, w / 2f - 9 * s, h / 2f, w / 2f - 3 * s, h / 2f); g.DrawLine(pen, w / 2f + 3 * s, h / 2f, w / 2f + 9 * s, h / 2f);
                        g.DrawLine(pen, w / 2f, h / 2f - 9 * s, w / 2f, h / 2f - 3 * s); g.DrawLine(pen, w / 2f, h / 2f + 3 * s, w / 2f, h / 2f + 9 * s);
                    }
                }
                var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                var bytes = new byte[w * h * 4];
                for (int y = 0; y < h; y++) Marshal.Copy(new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), bytes, y * w * 4, w * 4);
                bmp.UnlockBits(data);
                return bytes;
            }
        }
    }
}
