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
using System.Text;

namespace Raptoru.Chaos
{
    static class EffectPreview
    {
        /// Niveau d'intensité appliqué par les outils (--level), sauf s'ils en donnent un.
        public static string DefaultLevel;
        internal sealed class Rig
        {
            public Gpu Gpu; public ShaderLibrary Lib; public TexturePool Pool; public GpuTimer Timer; public TextRaster Text;
            public uint W, H; public IntPtr Src, SrcSrv, Out, OutRtv, Staging, Big;
            public Rig(uint w, uint h, bool staging, string shaderCache = null)
            {
                W = w; H = h;
                Gpu = new Gpu(); Lib = new ShaderLibrary(Gpu, shaderCache); Pool = new TexturePool(Gpu); Timer = new GpuTimer(Gpu); Text = new TextRaster(Gpu);
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
        internal sealed class Sim
        {
            public ResolvedParams P; public Animator Anim; public Effect Fx; public readonly EffectFrame F = new EffectFrame();
            public long Total;
            /// Début de la sortie (ms depuis le départ) : fin de la durée, ou arrêt anticipé / prolongation (session OBS).
            public long ExitAt;
            public Sim(Registry reg, Rig rig, EffectDef def, string variant, int seed, Preset preset = null, string level = null,
                Dictionary<string, object> overrides = null, int? durationMs = null)
                : this(Params.Resolve(def, variant, preset, overrides, durationMs, null, reg.Limits, new SafetyConfig { MaxDurationMs = reg.Limits.MaxDurationMs }, true, level ?? DefaultLevel),
                       seed, rig.Gpu, rig.Lib, rig.Text, rig.W, rig.H, -1) { }
            /// Réplique d'une activation (paramètres déjà résolus, graine de l'activation), sur le GPU du moteur.
            public Sim(ResolvedParams p, int seed, Gpu gpu, ShaderLibrary lib, TextRaster text, uint w, uint h, long exitAt)
            {
                P = p;
                Anim = new Animator(P.In, P.Out);
                Anim.Start(0);
                Fx = EffectCatalog.Create(P.Def.Id);
                Fx.Prepare(new EffectContext { Gpu = gpu, Shaders = lib, Text = text, P = P, Seed = seed });
                Fx.Start();
                F.P = P; F.Seed = seed; F.Width = w; F.Height = h;
                ExitAt = exitAt >= 0 ? exitAt : P.DurationMs;
                Total = ExitAt + (P.Out.Instant ? 0 : P.Out.DurationMs);
            }
            /// Rend l'instant t (ms depuis le départ) dans fb ; la sortie commence à ExitAt (fin de la durée par défaut).
            public void Render(FrameBuilder fb, long t)
            {
                if (t >= ExitAt) Anim.BeginExit(ExitAt);
                F.Presence = Anim.Presence(t); F.NowMs = t; F.ElapsedMs = t; F.Exiting = t >= ExitAt;
                fb.CurrentLabel = P.Def.Id;
                Fx.Update(F);
                Fx.Render(fb, F);
            }
        }

        /// --check-hold <effet> [--level x] [--w --h] [--expect-motion] : non-régression du maintien animé (bug VHS du 24/11).
        /// Image source FIXE, aucune nouvelle capture, comme une fenêtre immobile ou l'image figée du mode E. La cadence du
        /// moteur (Cadence.Timed et Due, la même règle) est rejouée à 60 Hz : une image n'est rendue que si elle est due ;
        /// sinon la précédente reste affichée. Relevés : entrée, cinq instants du maintien, sortie. Conforme si chaque
        /// rafraîchissement du maintien est rendu et, avec --expect-motion, si l'image affichée change d'un relevé du
        /// maintien au suivant. L'ancienne règle (horloge ignorée) est rejouée pour comparaison. JSON ; code 0 = conforme.
        public static int CheckHold(string effect, uint W, uint H, bool expectMotion)
        {
            var reg = Registry.Embedded();
            EffectDef def;
            if (!reg.Effects.TryGetValue(effect, out def)) { Console.Error.WriteLine("effet inconnu : " + effect); return 2; }
            var rig = new Rig(W, H, true);
            var rules = new List<object>();
            bool ok = true;
            foreach (bool oldRule in new[] { true, false })
            {
                var sim = new Sim(reg, rig, def, null, 4242);
                var fb = new FrameBuilder(rig.W, rig.H, true);
                long inMs = sim.P.In.Instant ? 0 : sim.P.In.DurationMs, outMs = sim.P.Out.Instant ? 0 : sim.P.Out.DurationMs;
                long holdA = inMs, holdB = sim.ExitAt;
                var marks = new List<KeyValuePair<string, long>>();
                if (inMs > 0) marks.Add(new KeyValuePair<string, long>("entrée", inMs / 2));
                for (int i = 1; i <= 5; i++) marks.Add(new KeyValuePair<string, long>("maintien " + i, holdA + (holdB - holdA) * i / 6));
                if (outMs > 0) marks.Add(new KeyValuePair<string, long>("sortie", sim.ExitAt + outMs / 2));
                bool shown = false, clockDriven = false, fresh = true;
                int holdTicks = 0, holdRenders = 0, changed = 0, pairs = 0, k = 0, renders = 0;
                byte[] prevHold = null;
                var shots = new List<object>();
                for (int n = 0; ; n++)
                {
                    long t = (long)Math.Round(n * 1000.0 / 60);
                    if (t > sim.Total) break;
                    if (t >= sim.ExitAt) sim.Anim.BeginExit(sim.ExitAt);
                    bool timed = Cadence.Timed(sim.Anim.Animating(t), def.RequiresCapture, false, false, !oldRule && clockDriven);
                    bool due = Cadence.Due(shown, timed, true, fresh), hold = t >= holdA && t < holdB;
                    if (hold) holdTicks++;
                    if (due)
                    {
                        fb.Reset(rig.W, rig.H, true);
                        sim.F.ClockRead = false;
                        sim.Render(fb, t);
                        clockDriven = sim.F.ClockRead;
                        fb.Execute(rig.Gpu, rig.Lib, rig.Pool, null, rig.SrcSrv, rig.OutRtv, t, t / 1000f);
                        shown = true; fresh = false; renders++;
                        if (hold) holdRenders++;
                    }
                    while (k < marks.Count && t >= marks[k].Value)
                    {
                        // Image affichée à cet instant : la dernière rendue (rig.Out), comme le calque à l'écran.
                        rig.Gpu.Copy(rig.Staging, rig.Out, 0, 0, rig.W, rig.H);
                        var img = rig.Gpu.ReadBack(rig.Staging, rig.W, rig.H);
                        bool isHold = marks[k].Key.StartsWith("maintien");
                        double diff = -1;
                        if (isHold && prevHold != null)
                        {
                            int c = 0;
                            for (int i = 0; i < img.Length; i += 4) if (Math.Abs(img[i] - prevHold[i]) + Math.Abs(img[i + 1] - prevHold[i + 1]) + Math.Abs(img[i + 2] - prevHold[i + 2]) > 6) c++;
                            diff = Math.Round(100.0 * c / (img.Length / 4), 2);
                            pairs++; if (diff >= 1) changed++;
                        }
                        if (isHold) prevHold = img;
                        shots.Add(J.Map("at", marks[k].Key, "t_ms", t, "presence", Math.Round(sim.Anim.Presence(t), 3), "renders_so_far", renders,
                            "pixels_changed_since_previous_hold_pct", diff >= 0 ? (object)diff : null));
                        k++;
                    }
                }
                // Un filtre qui ne lit pas l'horloge (couleur) est immobile au maintien : une image par capture suffit.
                bool animated = (!clockDriven || holdRenders == holdTicks) && (!expectMotion || changed == pairs);
                if (!oldRule && !animated) ok = false;
                rules.Add(J.Map("rule", oldRule ? "avant (horloge ignorée)" : "après (Cadence.Timed + horloge)", "hold_ticks", holdTicks, "hold_renders", holdRenders,
                    "hold_pairs_changed", changed + "/" + pairs, "hold_animated", animated, "clock_read", clockDriven, "shots", shots.ToArray()));
                sim.Fx.Dispose();
            }
            // UTF-8 (relevés nommés « entrée », « sortie ») : le moteur est une application sans console.
            using (var o = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)))
                o.WriteLine(J.Write(J.Map("effect", effect, "requires_capture", def.RequiresCapture, "ok", ok, "rules", rules.ToArray())));
            return ok ? 0 : 1;
        }

        /// --measure <effet> <variante|-> <t1,t2,…> [--w --h] : couverture d'un calque à chaque instant demandé, hors écran.
        /// Alpha par pixel = 1 − (rendu sur blanc − rendu sur noir) : min, moyenne, quantiles, part de l'écran couverte
        /// (≥ 95 %, ≥ 99,9 %), part encore bien visible (< 30 %), cases d'un quadrillage 16×9 presque masquées (≥ 90 %) ou
        /// dégagées (< 40 %), profil radial (distance au point focal, en hauteurs d'écran). Sortie JSON (tests, réglages).
        public static int Measure(string effect, string variant, string times, uint W, uint H, string level = null)
        {
            var reg = Registry.Embedded();
            EffectDef def;
            if (!reg.Effects.TryGetValue(effect, out def)) { Console.Error.WriteLine("effet inconnu : " + effect); return 2; }
            if (variant == "-") variant = null;
            var rig = new Rig(W, H, true);
            IntPtr srcRtv = rig.Gpu.Rtv(rig.Src);
            var sim = new Sim(reg, rig, def, variant, 4242, null, level);
            // « peak » : toutes les images (33 ms) jusqu'à la fin de la sortie ; on garde la plus couvrante et la plus dégagée.
            bool peak = times == "peak";
            var ts = peak ? Enumerable.Range(0, (int)(sim.Total / 33) + 1).Select(i => (long)i * 33).ToList() : times.Split(',').Select(long.Parse).ToList();
            var black = Shots(reg, rig, def, variant, ts, srcRtv, 0f, level);
            var white = Shots(reg, rig, def, variant, ts, srcRtv, 1f, level);
            double fx = sim.P.Values.ContainsKey("focus_x") ? sim.P.Num("focus_x") : 0.5, fy = sim.P.Values.ContainsKey("focus_y") ? sim.P.Num("focus_y") : 0.5;
            sim.Fx.Dispose();
            var res = new List<Dictionary<string, object>>();
            for (int i = 0; i < ts.Count; i++) res.Add(Coverage(black[i], white[i], (int)W, (int)H, fx, fy, ts[i]));
            if (peak)
            {
                var most = res.OrderByDescending(x => (double)x["mean"]).First();
                res = new List<Dictionary<string, object>> { most };
            }
            Console.WriteLine(J.Write(J.Map("effect", effect, "variant", variant, "level", level, "size", W + "x" + H, "duration_ms", sim.P.DurationMs, "shots", res.Cast<object>().ToArray())));
            return 0;
        }

        static List<byte[]> Shots(Registry reg, Rig rig, EffectDef def, string variant, List<long> ts, IntPtr srcRtv, float grey, string level)
        {
            var sim = new Sim(reg, rig, def, variant, 4242, null, level);
            var fb = new FrameBuilder(rig.W, rig.H, true);
            var res = new List<byte[]>();
            int k = 0;
            for (long t = 0; k < ts.Count; t += 33)
            {
                bool shot = t >= ts[k];
                long tt = shot ? ts[k] : t;
                rig.Gpu.Clear(srcRtv, grey, grey, grey, 1);
                rig.Gpu.GenerateMips(rig.SrcSrv);
                fb.Reset(rig.W, rig.H, true);
                sim.Render(fb, tt);
                fb.Execute(rig.Gpu, rig.Lib, rig.Pool, null, rig.SrcSrv, rig.OutRtv, tt, tt / 1000f);
                if (!shot) continue;
                rig.Gpu.Copy(rig.Staging, rig.Out, 0, 0, rig.W, rig.H);
                res.Add(rig.Gpu.ReadBack(rig.Staging, rig.W, rig.H));
                k++;
            }
            sim.Fx.Dispose();
            return res;
        }

        static Dictionary<string, object> Coverage(byte[] b, byte[] w, int W, int H, double fx, double fy, long t)
        {
            int n = W * H;
            var a = new double[n];
            for (int i = 0; i < n; i++)
            {
                int j = i * 4;
                double d = ((w[j] - b[j]) + (w[j + 1] - b[j + 1]) + (w[j + 2] - b[j + 2])) / (3 * 255.0);
                a[i] = Math.Max(0, Math.Min(1, 1 - d));
            }
            var sorted = (double[])a.Clone();
            Array.Sort(sorted);
            Func<double, double> q = p => sorted[Math.Min(n - 1, (int)(p * (n - 1)))];
            int c95 = 0, c999 = 0, v30 = 0;
            foreach (var x in a) { if (x >= 0.95) c95++; if (x >= 0.999) c999++; if (x < 0.3) v30++; }
            // Quadrillage 16×9 : régions presque masquées et régions dégagées au même instant.
            int masked = 0, clear = 0;
            for (int cy = 0; cy < 9; cy++)
                for (int cx = 0; cx < 16; cx++)
                {
                    double s = 0; int m = 0;
                    for (int y = cy * H / 9; y < (cy + 1) * H / 9; y++)
                        for (int x = cx * W / 16; x < (cx + 1) * W / 16; x++) { s += a[y * W + x]; m++; }
                    s /= Math.Max(1, m);
                    if (s >= 0.9) masked++;
                    if (s < 0.4) clear++;
                }
            // Profil radial autour du point focal (distance en hauteurs d'écran, pas de 0,05).
            var sum = new double[24]; var cnt = new int[24];
            for (int y = 0; y < H; y += 2)
                for (int x = 0; x < W; x += 2)
                {
                    double dx = (x + 0.5) / H - fx * W / H, dy = (y + 0.5) / H - fy;
                    int bin = Math.Min(23, (int)(Math.Sqrt(dx * dx + dy * dy) / 0.05));
                    sum[bin] += a[y * W + x]; cnt[bin]++;
                }
            var prof = new List<object>();
            for (int i = 0; i < 24; i++) if (cnt[i] > 0) prof.Add(Math.Round(sum[i] / cnt[i], 3));
            return J.Map("t_ms", t, "min", Math.Round(sorted[0], 4), "mean", Math.Round(a.Average(), 4), "p05", Math.Round(q(0.05), 3), "p50", Math.Round(q(0.5), 3),
                "p95", Math.Round(q(0.95), 3), "covered95", Math.Round(c95 / (double)n, 4), "covered999", Math.Round(c999 / (double)n, 4),
                "visible30", Math.Round(v30 / (double)n, 4), "cells_masked90", masked, "cells_clear40", clear, "radial", prof.ToArray());
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

        /// Aperçu animé d'une fiche Studio (et, plus tard, de l'extension) : la vraie chaîne avec les VRAIS réglages
        /// (variante, préréglage), sur la scène de jeu de synthèse, en images JPEG d'une grille. Deux séquences en temps
        /// réel à 15 i/s : le début (3,2 s : entrée et premiers instants) puis, si l'effet est plus long, sa dernière
        /// seconde (sortie). Sortie standard : description JSON de la grille. Aucune fenêtre ni capture : un processus
        /// court, séparé du moteur en marche.
        public static int Anim(string file, string id, string variant, string presetFile, uint W, uint H, string cache)
        {
            var reg = Registry.Embedded();
            var def = reg.Get(id);
            if (def == null || def.Internal) { Console.WriteLine(J.Write(J.Map("error", "unknown_effect"))); return 1; }
            Preset preset = null;
            if (presetFile != null && presetFile != "-") preset = Preset.FromJson(J.Parse(File.ReadAllText(presetFile)));
            // Réglages refusés comme le moteur les refuserait (bornes, durée, transitions) : rien n'est rendu.
            try { Params.Resolve(def, variant == "-" ? null : variant, preset, null, null, null, reg.Limits, new SafetyConfig { MaxDurationMs = reg.Limits.MaxDurationMs }, true); }
            catch (ParamError e) { Console.WriteLine(J.Write(J.Map("error", e.Code, "message", e.Message))); return 1; }
            var rig = new Rig(W, H, true, cache);
            var sim = new Sim(reg, rig, def, variant == "-" ? null : variant, 12345, preset);
            const int Fps = 15;
            long head = Math.Min(sim.Total, 3200), tailFrom = sim.Total > head + 1000 ? sim.Total - 1000 : -1;
            var times = new List<long>();
            for (long t = 0; t < head; t += 1000 / Fps) times.Add(t);
            if (tailFrom > 0) for (long t = tailFrom; t < sim.Total; t += 1000 / Fps) times.Add(t);
            int cols = 8, rows = (times.Count + cols - 1) / cols;
            var fb = new FrameBuilder(W, H, true);
            using (var sheet = new Bitmap((int)W * cols, (int)H * rows, PixelFormat.Format24bppRgb))
            using (var g = Graphics.FromImage(sheet))
            {
                int k = 0;
                for (long t = 0; k < times.Count; t += 16)
                {
                    // Avance image par image (effets à état), et saute directement à la sortie.
                    if (k > 0 && times[k] - t > 1500) t = times[k] - 500;
                    bool shot = t >= times[k];
                    long at = shot ? times[k] : t;
                    fb.Reset(W, H, true);
                    rig.Pan(at);
                    sim.Render(fb, at);
                    fb.Execute(rig.Gpu, rig.Lib, rig.Pool, null, rig.SrcSrv, rig.OutRtv, at, at / 1000f);
                    if (!shot) continue;
                    using (var bmp = Read(rig)) g.DrawImageUnscaled(bmp, (int)W * (k % cols), (int)H * (k / cols));
                    k++;
                }
                var enc = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
                var ps = new EncoderParameters(1);
                ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 78L);
                sheet.Save(file, enc, ps);
            }
            sim.Fx.Dispose();
            Console.WriteLine(J.Write(J.Map("frames", times.Count, "cols", cols, "w", W, "h", H, "fps", Fps,
                "head_ms", head, "tail_from_ms", tailFrom, "total_ms", sim.Total, "duration_ms", sim.P.DurationMs)));
            return 0;
        }

        /// Superpositions : plusieurs effets en même temps (« fog,color:nb »), rendus dans l'ordre du moteur (registre :
        /// order), n images de t0 à t1. Vérifie les combinaisons (brouillard + noir et blanc, zoom + tunnel, flash pendant
        /// un retournement…).
        public static int Combo(string dir, string spec, long t0, long t1, int n, uint W = 480, uint H = 270)
        {
            Directory.CreateDirectory(dir);
            var reg = Registry.Embedded();
            var rig = new Rig(W, H, true);
            var sims = new List<Sim>();
            int seed = 500;
            foreach (var part in spec.Split(','))
            {
                var kv = part.Split(':');
                var def = reg.Get(kv[0]);
                if (def == null) { Console.WriteLine("effet inconnu : " + kv[0]); return 1; }
                sims.Add(new Sim(reg, rig, def, kv.Length > 1 ? kv[1] : null, seed++));
            }
            sims.Sort((a, b) => a.P.Def.Order.CompareTo(b.P.Def.Order));
            var fb = new FrameBuilder(W, H, true);
            var row = new List<KeyValuePair<string, Bitmap>>();
            int k = 0;
            for (long t = 0; k < n; t += 16)
            {
                long want = n == 1 ? t0 : t0 + (t1 - t0) * k / (n - 1);
                bool shot = t >= want;
                long at = shot ? want : t;
                fb.Reset(W, H, true);
                rig.Pan(at);
                foreach (var s in sims) s.Render(fb, at);
                fb.Execute(rig.Gpu, rig.Lib, rig.Pool, null, rig.SrcSrv, rig.OutRtv, at, at / 1000f);
                if (!shot) continue;
                row.Add(new KeyValuePair<string, Bitmap>((want / 1000.0).ToString("0.00") + " s", Read(rig)));
                k++;
            }
            foreach (var s in sims) s.Fx.Dispose();
            string file = Path.Combine(dir, "combo-" + spec.Replace(':', '_').Replace(',', '+') + ".png");
            var rows = new List<KeyValuePair<string, List<KeyValuePair<string, Bitmap>>>>();
            for (int i = 0; i < row.Count; i += 6) rows.Add(new KeyValuePair<string, List<KeyValuePair<string, Bitmap>>>("", row.Skip(i).Take(6).ToList()));
            Contact(spec, rows, file, (int)W, (int)H);
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
