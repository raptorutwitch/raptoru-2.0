// Point d'entrée de ChaosEngine.exe.
//   --serve [--parent <pid>] [--config <fichier>] [--state-dir <dossier>] [--heartbeat-ms <n>] [--no-guardian]
//   --guardian <pid du moteur>          (lancé par le moteur lui-même)
//   --test-target [--x --y --w --h]     (mire des contrôles automatiques)
//   --render-preview <dossier>          (aperçu hors écran des transitions en PNG : développement des shaders)
//   --render-effects <dossier> [effet…] [--frames]   (planches des effets du catalogue, hors écran)
//   --bench-effects [--w --h --frames]  (temps GPU par passe de chaque effet, hors écran)
//   --preview-anim <fichier.jpg> <effet> <variante|-> <préréglage.json|-> [--w --h --cache]  (aperçu des fiches)
//   --restore-display                   (secours : écrans aux réglages enregistrés de Windows, curseur rétabli)
//   --game-check                        (garde des essais visibles : code 1 et la raison si un jeu est actif)
//   --describe | --version
// L'interface est la page Chaos de Raptoru Studio ; le moteur n'a pas de fenêtre de contrôle.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Raptoru.Chaos
{
    static class Program
    {
        public const string Version = "0.4.0";

        [STAThread]
        static int Main(string[] args)
        {
            string mode = args.Length > 0 ? args[0] : "";
            N.SetProcessDpiAwarenessContext(new IntPtr(-4)); // pixels physiques
            // Outils hors écran : niveau d'intensité appliqué aux effets rendus (--level leger|marque|extreme…).
            if (mode != "--serve") EffectPreview.DefaultLevel = StrArg(args, "--level", null);
            switch (mode)
            {
                case "--serve":
                    var opt = new EngineOptions
                    {
                        ParentPid = IntArg(args, "--parent", 0), HeartbeatMs = IntArg(args, "--heartbeat-ms", 3000),
                        Guardian = !args.Contains("--no-guardian"), StateDir = StrArg(args, "--state-dir", null)
                    };
                    opt.ConfigPath = StrArg(args, "--config", opt.StateDir != null ? Path.Combine(opt.StateDir, "config.json") : ConfigStore.DefaultPath());
                    try { return new EngineHost(opt).Run(); }
                    catch (Exception e)
                    {
                        var o = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
                        o.WriteLine(J.Write(Protocol.Event("engine.error", 0, J.Map("code", e is RegistryError ? "registry_invalid" : e is ConfigError ? ((ConfigError)e).Code : "startup", "message", e.Message))));
                        return 2;
                    }
                case "--guardian": return Guardian.Run(int.Parse(args[1]));
                case "--test-target":
                    Application.Run(new TestTarget(IntArg(args, "--x", 100), IntArg(args, "--y", 100), IntArg(args, "--w", 400), IntArg(args, "--h", 240)));
                    return 0;
                case "--render-preview": return Preview.Run(args.Length > 1 ? args[1] : ".");
                case "--bench-gpu": return Preview.Bench(IntArg(args, "--w", 2560), IntArg(args, "--h", 1440), IntArg(args, "--frames", 600));
                case "--render-effects": return EffectPreview.Run(args.Length > 1 ? args[1] : ".", args.Skip(2).Where((x, i) => !x.StartsWith("--") && !args.Skip(1).ElementAt(i).StartsWith("--w") && !args.Skip(1).ElementAt(i).StartsWith("--h")).ToList(), args.Contains("--frames"), (uint)IntArg(args, "--w", 480), (uint)IntArg(args, "--h", 270));
                case "--strip": return EffectPreview.Strip(args[1], args[2], args[3], long.Parse(args[4]), long.Parse(args[5]), int.Parse(args[6]), (uint)IntArg(args, "--w", 480), (uint)IntArg(args, "--h", 270));
                case "--preview-anim": return EffectPreview.Anim(args[1], args[2], args[3], args[4], (uint)IntArg(args, "--w", 320), (uint)IntArg(args, "--h", 180), StrArg(args, "--cache", null));
                case "--combo": return EffectPreview.Combo(args[1], args[2], long.Parse(args[3]), long.Parse(args[4]), int.Parse(args[5]));
                case "--sysinfo": return PerfLab.SysInfoMain();
                case "--resolve-screens":
                    // Ciblage « écran » de chaque écran branché, sans rien afficher ni capturer (contrôle multi-écrans).
                    var rreg = Registry.Embedded();
                    var list = new List<object>();
                    foreach (var sc in Targets.Screens())
                    {
                        try
                        {
                            int self = System.Diagnostics.Process.GetCurrentProcess().Id;
                            var t = Targets.Resolve(J.Map("kind", "screen", "device", sc.Device), "window", self, rreg.Get("blink"), false);
                            var to = Targets.Resolve(J.Map("kind", "screen", "device", sc.Device), "window", self, rreg.Get("blink"), false, true);
                            list.Add(J.Map("device", sc.Device, "kind", t.Kind, "key", t.Key, "mode", J.Str(t.Info, "mode", null), "process", J.Str(t.Info, "process", null),
                                "title", J.Str(t.Info, "title", null), "mode_with_obs_output", J.Str(to.Info, "mode", null),
                                "monitor", J.Map("x", sc.X, "y", sc.Y, "width", sc.Width, "height", sc.Height)));
                        }
                        catch (ProtocolError e) { list.Add(J.Map("device", sc.Device, "error", e.Code)); }
                    }
                    Out(J.Write(J.Map("screens", list.ToArray())));
                    return 0;
                case "--perf-offscreen": return PerfLab.Offscreen(args);
                case "--perf-monitor": return PerfLab.Monitor(args);
                case "--check-hold": return EffectPreview.CheckHold(args[1], (uint)IntArg(args, "--w", 480), (uint)IntArg(args, "--h", 270), args.Contains("--expect-motion"));
                case "--measure": return EffectPreview.Measure(args[1], args[2], args[3], (uint)IntArg(args, "--w", 640), (uint)IntArg(args, "--h", 360), StrArg(args, "--level", null));
                case "--obs-export":
                    return ObsExport.Run(args[1], args[2], StrArg(args, "--out", "obs-export"), StrArg(args, "--level", null), IntArg(args, "--seed", 4242),
                        args.Contains("--duration-ms") ? IntArg(args, "--duration-ms", 10000) : (int?)null, StrArg(args, "--params", null),
                        (uint)IntArg(args, "--w", 640), (uint)IntArg(args, "--h", 360), StrArg(args, "--refs", null), IntArg(args, "--stop-at", -1));
                case "--bench-effects": return EffectPreview.Bench(IntArg(args, "--w", 2560), IntArg(args, "--h", 1440), IntArg(args, "--frames", 300));
                case "--describe":
                    var reg = Registry.Embedded();
                    Console.WriteLine(J.Write(J.Map("registry_version", reg.Version, "effects", reg.Effects.Keys.ToArray(),
                        "implemented", EffectCatalog.Implemented.ToArray(), "mismatches", EffectCatalog.Mismatches(reg).ToArray())));
                    return EffectCatalog.Mismatches(reg).Count == 0 ? 0 : 1;
                case "--version": Console.WriteLine(Version); return 0;
                case "--game-check":
                    // Diagnostic complet : règle, processus, fenêtre, écran ; notes (ce que Windows signale sans que ce soit un jeu).
                    var gc = N.CheckGame();
                    Out(gc.Detail());
                    return gc.Blocked ? 1 : 0;
                case "--restore-display":
                    int rr = InputLayer.RestoreAllDisplays();
                    bool cr = CursorLayer.RestoreSystem();
                    Out((rr == 0 ? "écrans rétablis (réglages enregistrés de Windows)" : "écrans : échec, code " + rr) + " ; curseur " + (cr ? "rétabli" : "non rétabli"));
                    return rr == 0 ? 0 : 1;
                default:
                    // Une option inconnue (outil plus ancien, faute de frappe) ne doit jamais ouvrir de fenêtre : elle
                    // s'afficherait sur l'écran, peut-être pendant un jeu. La boîte d'information est réservée au
                    // double-clic sur l'exécutable (aucun argument).
                    if (args.Length > 0)
                    {
                        Console.Error.WriteLine("option inconnue : " + args[0]);
                        return 2;
                    }
                    MessageBox.Show("Le moteur Chaos se pilote depuis Raptoru Studio (page Chaos) ou le banc Chaos Lab.\n\n" +
                        "Arrêt d'urgence à tout moment : Ctrl+Maj+F11.", "Raptoru Chaos " + Version);
                    return 0;
            }
        }

        /// Sortie texte en UTF-8 (le moteur est une application sans console : Console.OutputEncoding y échoue).
        static void Out(string line)
        {
            using (var o = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false))) o.WriteLine(line);
        }

        static int IntArg(string[] a, string name, int def)
        {
            for (int i = 0; i + 1 < a.Length; i++) if (a[i] == name) { int v; if (int.TryParse(a[i + 1], out v)) return v; }
            return def;
        }
        static string StrArg(string[] a, string name, string def)
        {
            for (int i = 0; i + 1 < a.Length; i++) if (a[i] == name) return a[i + 1];
            return def;
        }
    }

    /// Aperçu hors écran : la vraie chaîne de rendu (FrameBuilder, shaders, pool) appliquée à une image de test, écrite
    /// en PNG (planche contact). Aucune fenêtre, aucune capture : sert à vérifier un shader ou une transition.
    static class Preview
    {
        const uint W = 480, H = 270;

        public static int Run(string dir)
        {
            Directory.CreateDirectory(dir);
            var gpu = new Gpu();
            var lib = new ShaderLibrary(gpu, null);
            var pool = new TexturePool(gpu);
            var timer = new GpuTimer(gpu);
            var text = new TextRaster(gpu);
            var src = gpu.Texture(W, H, 0, 0x8 | 0x20, 0x1, 0, 0);
            var srcSrv = gpu.Srv(src);
            Upload(gpu, src, Pattern());
            gpu.GenerateMips(srcSrv);
            var outTex = gpu.Texture(W, H, 1, 0x8 | 0x20, 0, 0, 0);
            var outRtv = gpu.Rtv(outTex);
            var staging = gpu.Texture(W, H, 1, 0, 0, 3, 0x20000);
            var rows = new List<KeyValuePair<string, List<Bitmap>>>();
            foreach (var fill in new[] { "mirror", "black", "cover" })
            {
                var row = new List<Bitmap>();
                foreach (var deg in new[] { 0, 30, 60, 90, 120, 150, 180 })
                {
                    var fb = new FrameBuilder(W, H, true);
                    fb.Transform(deg * Math.PI / 180, 1, 1, 0, 0, fill);
                    row.Add(Render(gpu, lib, pool, timer, fb, srcSrv, outTex, outRtv, staging));
                }
                rows.Add(new KeyValuePair<string, List<Bitmap>>("flip fill=" + fill, row));
            }
            var chain = new FrameBuilder(W, H, true);
            chain.Transform(Math.PI, 1, 1, 0, 0, "mirror");
            chain.Filter("tint", new[] { 0f, 1f, 1f, 0.5f });
            var marker = new DiagMarkerEffect();
            marker.Prepare(new EffectContext { Gpu = gpu, Shaders = lib, Text = text });
            var reg = Registry.Embedded();
            var mp = Params.Resolve(reg.Get("diag.marker"), null, null, null, null, null, reg.Limits, new SafetyConfig(), true);
            marker.Render(chain, new EffectFrame { P = mp, Presence = 1, Width = W, Height = H, ElapsedMs = 500 });
            rows.Add(new KeyValuePair<string, List<Bitmap>>("chaîne flip + teinte + calques", new List<Bitmap> { Render(gpu, lib, pool, timer, chain, srcSrv, outTex, outRtv, staging) }));
            string sheet = Path.Combine(dir, "chaos-preview.png");
            Contact(rows, sheet);
            Console.WriteLine(sheet);
            return 0;
        }

        /// Banc GPU reproductible, hors écran : la chaîne réelle à la résolution donnée (sans capture ni présentation).
        /// Mesure le temps GPU par passe : retournement exact, rotation avec coins flous (mipmaps), avec coins noirs,
        /// et retournement + filtre + calques. Ne mesure PAS un jeu ni la latence ressentie.
        public static int Bench(int w, int h, int frames)
        {
            var gpu = new Gpu();
            var lib = new ShaderLibrary(gpu, null);
            lib.Warm();
            var pool = new TexturePool(gpu);
            var timer = new GpuTimer(gpu);
            var text = new TextRaster(gpu);
            uint uw = (uint)w, uh = (uint)h;
            var src = gpu.Texture(uw, uh, 0, 0x8 | 0x20, 0x1, 0, 0);
            var srcSrv = gpu.Srv(src);
            var outTex = gpu.Texture(uw, uh, 1, 0x8 | 0x20, 0, 0, 0);
            var outRtv = gpu.Rtv(outTex);
            var reg = Registry.Embedded();
            var marker = new DiagMarkerEffect();
            marker.Prepare(new EffectContext { Gpu = gpu, Shaders = lib, Text = text });
            var mp = Params.Resolve(reg.Get("diag.marker"), null, null, null, null, null, reg.Limits, new SafetyConfig(), true);
            var results = new Dictionary<string, object>();
            var scenarios = new[] { "flip_180_exact", "flip_rotating_mirror", "flip_rotating_black", "flip_tint_layers" };
            foreach (var sc in scenarios)
            {
                var per = new Dictionary<string, Samples>();
                Action<string, double> add = (label, ms) => { Samples s; if (!per.TryGetValue(label, out s)) per[label] = s = new Samples(); s.Add(ms); };
                var cpu = System.Diagnostics.Stopwatch.StartNew();
                for (int i = 0; i < frames; i++)
                {
                    double angle = sc == "flip_180_exact" || sc == "flip_tint_layers" ? Math.PI : Math.PI * (i % 60) / 60.0;
                    var fb = new FrameBuilder(uh == 0 ? 1 : uw, uh, true);
                    fb.CurrentLabel = sc;
                    fb.Transform(angle, 1, 1, 0, 0, sc == "flip_rotating_black" ? "black" : "mirror");
                    if (sc == "flip_tint_layers")
                    {
                        fb.Filter("tint", new[] { 0f, 1f, 1f, 0.5f });
                        marker.Render(fb, new EffectFrame { P = mp, Presence = 1, Width = uw, Height = uh, ElapsedMs = i * 16 });
                    }
                    if (fb.NeedsInputMips) gpu.GenerateMips(srcSrv);
                    fb.Execute(gpu, lib, pool, timer, srcSrv, outRtv, i, i / 60f);
                    timer.Collect(add);
                }
                double cpuMs = cpu.Elapsed.TotalMilliseconds / frames;
                System.Threading.Thread.Sleep(200);
                timer.Collect(add);
                results[sc] = J.Map("passes", per.ToDictionary(kv => kv.Key, kv => (object)J.Map("gpu_ms_p50", kv.Value.P(50), "gpu_ms_p95", kv.Value.P(95), "gpu_ms_max", kv.Value.P(100), "samples", kv.Value.Count)),
                    "cpu_submit_ms_per_frame", Math.Round(cpuMs, 3));
            }
            Console.WriteLine(J.Write(J.Map("resolution", w + "x" + h, "frames_per_scenario", frames, "adapter", gpu.Adapter, "vram_mb", gpu.VideoMemoryMB(), "scenarios", results,
                "note", "GPU par passe (horodatages), hors capture et hors présentation ; ne mesure pas un jeu.")));
            return 0;
        }

        static Bitmap Render(Gpu gpu, ShaderLibrary lib, TexturePool pool, GpuTimer timer, FrameBuilder fb, IntPtr srcSrv, IntPtr outTex, IntPtr outRtv, IntPtr staging)
        {
            fb.Execute(gpu, lib, pool, timer, srcSrv, outRtv, 0, 0);
            gpu.Copy(staging, outTex, 0, 0, W, H);
            var px = gpu.ReadBack(staging, W, H);
            var bmp = new Bitmap((int)W, (int)H, PixelFormat.Format32bppArgb);
            var data = bmp.LockBits(new Rectangle(0, 0, (int)W, (int)H), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            for (int y = 0; y < H; y++) Marshal.Copy(px, (int)(y * W * 4), new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), (int)(W * 4));
            bmp.UnlockBits(data);
            return bmp;
        }

        /// Image de test : quatre quadrants, une grille, une flèche vers le haut, le mot HAUT.
        static byte[] Pattern()
        {
            using (var bmp = new Bitmap((int)W, (int)H, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.FillRectangle(Brushes.Firebrick, 0, 0, W / 2, H / 2); g.FillRectangle(Brushes.SeaGreen, W / 2, 0, W / 2, H / 2);
                    g.FillRectangle(Brushes.RoyalBlue, 0, H / 2, W / 2, H / 2); g.FillRectangle(Brushes.Goldenrod, W / 2, H / 2, W / 2, H / 2);
                    using (var pen = new Pen(Color.FromArgb(90, 255, 255, 255))) for (int i = 0; i < W; i += 30) { g.DrawLine(pen, i, 0, i, H); if (i < H) g.DrawLine(pen, 0, i, W, i); }
                    g.FillPolygon(Brushes.White, new[] { new Point((int)W / 2, 20), new Point((int)W / 2 - 30, 70), new Point((int)W / 2 + 30, 70) });
                    using (var f = new Font("Segoe UI", 28, FontStyle.Bold)) g.DrawString("HAUT", f, Brushes.White, W / 2 - 50, 80);
                }
                var data = bmp.LockBits(new Rectangle(0, 0, (int)W, (int)H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                var bytes = new byte[W * H * 4];
                for (int y = 0; y < H; y++) Marshal.Copy(new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), bytes, (int)(y * W * 4), (int)(W * 4));
                bmp.UnlockBits(data);
                return bytes;
            }
        }

        static void Upload(Gpu gpu, IntPtr tex, byte[] bgra)
        {
            var t = gpu.TextureWithData(W, H, bgra);
            gpu.Copy(tex, t, 0, 0, W, H);
            Com.Release(ref t);
        }

        static void Contact(List<KeyValuePair<string, List<Bitmap>>> rows, string file)
        {
            int cols = rows.Max(r => r.Value.Count), tw = (int)W / 2, th = (int)H / 2, pad = 6, label = 22;
            using (var sheet = new Bitmap(cols * (tw + pad) + pad, rows.Count * (th + label + pad) + pad))
            using (var g = Graphics.FromImage(sheet))
            using (var f = new Font("Segoe UI", 11))
            {
                g.Clear(Color.FromArgb(30, 30, 36));
                for (int r = 0; r < rows.Count; r++)
                {
                    int y = pad + r * (th + label + pad);
                    g.DrawString(rows[r].Key, f, Brushes.Gainsboro, pad, y);
                    for (int c = 0; c < rows[r].Value.Count; c++) g.DrawImage(rows[r].Value[c], pad + c * (tw + pad), y + label, tw, th);
                }
                sheet.Save(file, ImageFormat.Png);
            }
        }
    }

    /// Mire des contrôles automatiques : 4 quadrants de couleurs connues (rouge, vert / bleu, jaune) et une bande
    /// centrale animée (pour que Windows envoie des images). Jamais activée, au premier plan. Se ferme avec son stdin.
    sealed class TestTarget : Form
    {
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 15 };
        int tick;

        public TestTarget(int x, int y, int w, int h)
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Bounds = new Rectangle(x, y, w, h);
            Text = "Chaos test target";
            TopMost = true;
            ShowInTaskbar = false;
            DoubleBuffered = true;
            BackColor = Color.Black;
            timer.Tick += (s, e) => { tick++; Invalidate(); };
            timer.Start();
        }

        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= N.WS_EX_NOACTIVATE | N.WS_EX_TOOLWINDOW | N.WS_EX_TOPMOST; return cp; }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            var o = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
            o.WriteLine("{\"ev\":\"target\",\"hwnd\":" + Handle.ToInt64() + ",\"pid\":" + System.Diagnostics.Process.GetCurrentProcess().Id + "}");
            if (!Console.IsInputRedirected) return;
            new Thread(() =>
            {
                try { var r = new StreamReader(Console.OpenStandardInput()); while (r.ReadLine() != null) { } } catch (Exception) { }
                Environment.Exit(0);
            }) { IsBackground = true }.Start();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            int w = ClientSize.Width, h = ClientSize.Height, hw = w / 2, hh = h / 2;
            var g = e.Graphics;
            g.FillRectangle(Brushes.Red, 0, 0, hw, hh);
            g.FillRectangle(Brushes.Lime, hw, 0, w - hw, hh);
            g.FillRectangle(Brushes.Blue, 0, hh, hw, h - hh);
            g.FillRectangle(Brushes.Yellow, hw, hh, w - hw, h - hh);
            int band = h / 5;
            g.FillRectangle(Brushes.Gray, 0, hh - band / 2, w, band);
            g.FillRectangle(Brushes.White, (tick * 6) % w, hh - band / 2 + 4, band - 8, band - 8);
            g.DrawString("HAUT " + tick, SystemFonts.DefaultFont, Brushes.Black, 6, 6);
        }
    }
}
