// Compatibilité de capture (OBS) : ce que voit chaque méthode de capture quand le calque retourne une mire.
// Aucune action sur OBS : ses méthodes sont reproduites avec les mêmes API de Windows.
//   BitBlt écran            capture GDI de l'écran (contrôles du moteur)
//   BitBlt fenêtre          OBS « Capture de fenêtre », méthode BitBlt (contenu de la fenêtre du jeu)
//   WGC écran               OBS « Capture d'écran », méthode Windows 10
//   DXGI écran              OBS « Capture d'écran », méthode DXGI (Desktop Duplication) : celle de la source « Écran » d'Antoni
//   WGC fenêtre du jeu      OBS « Capture de fenêtre », méthode Windows 10
//   WGC fenêtre du calque   une source OBS « Capture de fenêtre » qui viserait le calque lui-même
// Cas : calque sur la fenêtre (mode D), écran entier (mode C, exclu des captures), et cible « écran » des fiches occupée
// par une fenêtre agrandie (mode E : la mire couvre l'écran sauf une bande en bas, comme la barre des tâches ; le calque
// doit couvrir aussi la bande, et la capture d'écran doit le voir).
// OBS « Capture de jeu » s'accroche au jeu (injection) : elle lit les images du jeu, jamais une autre fenêtre. Non
// reproduite (aucune injection), conclusion par construction.
// VISIBLE (mire retournée sur l'écran secondaire) : garde de jeu, jamais lancé par les contrôles automatiques.
// Usage : chaos-bench.exe --obs-compat [--screen \\.\DISPLAY2] [--engine <ChaosEngine.exe>] [--autorise-pendant-un-jeu]
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

namespace Raptoru.Chaos
{
    delegate int OutDuplicate(IntPtr self, IntPtr device, out IntPtr dup);                                                   // 22 (IDXGIOutput1)
    delegate int DupAcquire(IntPtr self, uint timeoutMs, out DXGI_OUTDUPL_FRAME_INFO info, out IntPtr resource);              // 8
    delegate int DupRelease(IntPtr self);                                                                                    // 14

    [StructLayout(LayoutKind.Sequential)]
    struct DXGI_OUTDUPL_FRAME_INFO
    {
        public long LastPresentTime, LastMouseUpdateTime;
        public uint AccumulatedFrames; public int RectsCoalesced, ProtectedContentMaskedOut;
        public int PointerX, PointerY, PointerVisible;
        public uint TotalMetadataBufferSize, PointerShapeBufferSize;
    }

    static class CaptureCompat
    {
        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
        [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
        static readonly Guid IidOutput1 = new Guid("00cddea8-939b-4b83-a340-a685226666cc");

        static readonly Color[] Original = { Color.Red, Color.Lime, Color.Blue, Color.Yellow };
        static readonly Color[] Flipped = { Color.Yellow, Color.Blue, Color.Lime, Color.Red };
        static Rectangle where;
        static Gpu gpu;

        /// Points de mesure : centres des quatre quadrants de la mire (coordonnées écran).
        static Point[] Points()
        {
            if (pointsOverride != null) return pointsOverride;
            return new[] { new Point(where.X + where.Width / 5, where.Y + where.Height / 5), new Point(where.X + where.Width * 4 / 5, where.Y + where.Height / 5),
                           new Point(where.X + where.Width / 5, where.Y + where.Height * 4 / 5), new Point(where.X + where.Width * 4 / 5, where.Y + where.Height * 4 / 5) };
        }

        static string Classify(Color[] px)
        {
            if (px == null) return "indisponible";
            Func<Color[], bool> same = b => { for (int i = 0; i < 4; i++) if (Math.Abs(px[i].R - b[i].R) > 40 || Math.Abs(px[i].G - b[i].G) > 40 || Math.Abs(px[i].B - b[i].B) > 40) return false; return true; };
            if (same(Original)) return "mire d'origine";
            if (same(Flipped)) return "RETOURNÉE";
            if (px.All(c => c.R < 16 && c.G < 16 && c.B < 16)) return "noir";
            return "autre (" + string.Join(" ", px.Select(c => c.R.ToString("X2") + c.G.ToString("X2") + c.B.ToString("X2"))) + ")";
        }

        // ---------- Méthodes ----------
        static Color[] GdiScreen()
        {
            var pts = Points();
            IntPtr dc = GetDC(IntPtr.Zero);
            try
            {
                using (var bmp = new Bitmap(where.Width, where.Height))
                {
                    using (var g = Graphics.FromImage(bmp))
                    {
                        IntPtr dst = g.GetHdc();
                        BitBlt(dst, 0, 0, where.Width, where.Height, dc, where.X, where.Y, 0x00CC0020 | 0x40000000);
                        g.ReleaseHdc(dst);
                    }
                    return pts.Select(p => bmp.GetPixel(p.X - where.X, p.Y - where.Y)).ToArray();
                }
            }
            finally { ReleaseDC(IntPtr.Zero, dc); }
        }

        static Color[] GdiWindow(IntPtr hwnd)
        {
            var pts = Points();
            IntPtr dc = GetDC(hwnd);
            try
            {
                using (var bmp = new Bitmap(where.Width, where.Height))
                {
                    using (var g = Graphics.FromImage(bmp))
                    {
                        IntPtr dst = g.GetHdc();
                        BitBlt(dst, 0, 0, where.Width, where.Height, dc, 0, 0, 0x00CC0020);
                        g.ReleaseHdc(dst);
                    }
                    return pts.Select(p => bmp.GetPixel(p.X - where.X, p.Y - where.Y)).ToArray();
                }
            }
            finally { ReleaseDC(hwnd, dc); }
        }

        /// Pixels d'une texture BGRA (lecture bloquante : outil de test seulement).
        static Color[] Read(IntPtr tex, uint w, uint h, int ox, int oy)
        {
            var staging = gpu.Texture(w, h, 1, 0, 0, 3, 0x20000);
            try
            {
                gpu.Copy(staging, tex, 0, 0, w, h);
                var px = gpu.ReadBack(staging, w, h);
                return Points().Select(p =>
                {
                    int x = p.X - ox, y = p.Y - oy;
                    if (x < 0 || y < 0 || x >= w || y >= h) return Color.Black;
                    int i = (int)((y * w + x) * 4);
                    return Color.FromArgb(px[i + 2], px[i + 1], px[i]);
                }).ToArray();
            }
            finally { Com.Release(ref staging); }
        }

        static string Hex(Color c) { return c.R.ToString("X2") + c.G.ToString("X2") + c.B.ToString("X2"); }

        /// Pixels aux points donnés (coordonnées écran), capturés par WGC ou DXGI (pas les quatre points de la mire).
        static Color[] WgcAt(IntPtr hwnd, IntPtr hmon, int ox, int oy, Point[] pts) { var keep = pointsOverride; pointsOverride = pts; try { return Wgc(hwnd, hmon, ox, oy); } finally { pointsOverride = keep; } }
        static Color[] DxgiAt(IntPtr hmon, int ox, int oy, Point[] pts) { var keep = pointsOverride; pointsOverride = pts; try { return Dxgi(hmon, ox, oy); } finally { pointsOverride = keep; } }
        static Point[] pointsOverride;

        static Color[] Wgc(IntPtr hwnd, IntPtr hmon, int ox, int oy)
        {
            var evt = new AutoResetEvent(false);
            WgcCaptureSource src;
            try { src = new WgcCaptureSource(gpu, null, evt, "compat", hwnd, hmon) { ZeroCopy = false }; }
            catch (Exception) { return null; }
            try
            {
                var sw = Stopwatch.StartNew();
                bool got = false;
                // La première image peut précéder l'état visé : on garde la plus récente pendant 400 ms.
                while (sw.ElapsedMilliseconds < 1500 && !(got && sw.ElapsedMilliseconds > 400)) { evt.WaitOne(50); if (src.Acquire(sw.ElapsedMilliseconds)) got = true; }
                return got ? Read(src.CopyTexture, src.Width, src.Height, ox, oy) : null;
            }
            finally { src.Dispose(); }
        }

        static Color[] Dxgi(IntPtr hmon, int ox, int oy)
        {
            IntPtr output = Pacer.FindOutput(gpu, hmon), o1 = IntPtr.Zero, dup = IntPtr.Zero;
            if (output == IntPtr.Zero) return null;
            try
            {
                o1 = Com.QI(output, IidOutput1);
                if (Com.Fn<OutDuplicate>(o1, 22)(o1, gpu.Device, out dup) < 0) return null;
                var acquire = Com.Fn<DupAcquire>(dup, 8);
                var release = Com.Fn<DupRelease>(dup, 14);
                Color[] last = null;
                var sw = Stopwatch.StartNew();
                while (sw.ElapsedMilliseconds < 1200)
                {
                    DXGI_OUTDUPL_FRAME_INFO info; IntPtr res;
                    int hr = acquire(dup, 100, out info, out res);
                    if (hr < 0) continue;
                    try
                    {
                        if (info.LastPresentTime != 0)
                        {
                            IntPtr tex = Com.QI(res, Iid.Texture2D);
                            D3D11_TEXTURE2D_DESC d; Com.Fn<TexGetDesc>(tex, 10)(tex, out d);
                            last = Read(tex, d.Width, d.Height, ox, oy);
                            Com.Release(ref tex);
                        }
                    }
                    finally { Com.Release(ref res); release(dup); }
                    if (last != null && sw.ElapsedMilliseconds > 300) break;
                }
                return last;
            }
            catch (Exception) { return null; }
            finally { Com.Release(ref dup); Com.Release(ref o1); Com.Release(ref output); }
        }

        /// --capture-probe [--screen \\.\DISPLAYn] : la capture d'écran d'OBS (DXGI, et WGC) voit-elle un calque Chaos
        /// (la même fenêtre DirectComposition que le moteur), et ne le voit-elle plus une fois exclu des captures ?
        /// SONDE QUASI INVISIBLE : le calque ne porte qu'un damier blanc à 2/255 d'opacité (cases de 8 px), quelques
        /// secondes ; la réponse se lit statistiquement (écart cases « damier » − cases vides, sur ~6 000 points, contre
        /// deux captures sans calque). Refusée pendant un jeu ou une application plein écran. Docs/chaos/ETUDE_HALLOWEEN_VS_V2.md.
        public static int InvisibleProbe(string[] a)
        {
            string game = N.GameActivity();
            if (game != null && !a.Contains("--autorise-pendant-un-jeu"))
            {
                Console.WriteLine("Sonde NON lancée : " + game + ".");
                return 2;
            }
            string primary = N.MonitorDevice(N.MonitorFromWindow(N.GetDesktopWindow(), 2));
            int ai = Array.IndexOf(a, "--screen");
            string dev = ai >= 0 && ai + 1 < a.Length ? a[ai + 1] : primary;
            IntPtr hmon = N.MonitorByDevice(dev);
            RECT mon = N.MonitorRectOf(hmon);
            int W = mon.Right - mon.Left, H = mon.Bottom - mon.Top;
            gpu = new Gpu();
            var lib = new ShaderLibrary(gpu, null);
            const int cell = 8; const byte A = 2;
            var px = new byte[W * H * 4];
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                    if (((x / cell) + (y / cell)) % 2 == 0) { int i = (y * W + x) * 4; px[i] = A; px[i + 1] = A; px[i + 2] = A; px[i + 3] = A; }
            IntPtr tex = gpu.TextureWithData((uint)W, (uint)H, px), srv = gpu.Srv(tex);
            var on = new List<Point>(); var off = new List<Point>();
            for (int cy = 2; cy < H / cell - 2; cy += 3)
                for (int cx = 2; cx < W / cell - 2; cx += 3)
                {
                    var p = new Point(mon.Left + cx * cell + cell / 2, mon.Top + cy * cell + cell / 2);
                    if ((cx + cy) % 2 == 0) on.Add(p); else off.Add(p);
                }
            var pts = on.Concat(off).ToArray();
            Func<string, Color[]> grab = m => m == "DXGI" ? DxgiAt(hmon, mon.Left, mon.Top, pts) : WgcAt(IntPtr.Zero, hmon, mon.Left, mon.Top, pts);
            var methods = new[] { "DXGI", "WGC" };
            var res = new Dictionary<string, Dictionary<string, Color[]>>();
            foreach (var m in methods) res[m] = new Dictionary<string, Color[]>();
            Surface surf = null;
            try
            {
                foreach (var m in methods) res[m]["avant"] = grab(m);
                surf = new Surface(gpu, "probe", IntPtr.Zero, hmon, (uint)W, (uint)H, false, false);
                var cb = new float[Gpu.CbFloats];
                cb[18] = 1; cb[19] = 1; cb[20] = W; cb[21] = H; cb[22] = W; cb[23] = H; cb[26] = 1;
                gpu.Target(surf.BackBuffer, (uint)W, (uint)H, false);
                gpu.Draw(lib.VsFull, lib.Pixel("layer_full"), srv, cb, 3);
                gpu.Unbind();
                surf.Present(false);
                surf.SetShown(true, 0);
                Thread.Sleep(150);
                foreach (var m in methods) res[m]["calque"] = grab(m);
                bool excl = surf.SetExcluded(true);
                Thread.Sleep(150);
                foreach (var m in methods) res[m]["calque exclu"] = grab(m);
                surf.SetShown(false, 0);
                surf.Dispose(); surf = null;
                Thread.Sleep(150);
                foreach (var m in methods) res[m]["après"] = grab(m);
                // Score = écart moyen (luminance) des cases « damier » moins celui des cases vides, par rapport à la moyenne
                // des captures sans calque ; bruit = même score entre « avant » et « après ».
                Func<Color[], Color[], Color[], double> score = (x, b0, b1) =>
                {
                    if (x == null || b0 == null || b1 == null) return double.NaN;
                    Func<int, double> lum = i => ((x[i].R + x[i].G + x[i].B) - (b0[i].R + b0[i].G + b0[i].B + b1[i].R + b1[i].G + b1[i].B) / 2.0) / 3.0;
                    double so = 0, sf = 0;
                    for (int i = 0; i < on.Count; i++) so += lum(i);
                    for (int i = on.Count; i < pts.Length; i++) sf += lum(i);
                    return so / on.Count - sf / off.Count;
                };
                var report = new List<object>();
                Console.WriteLine("Sonde de capture (" + dev + ", " + W + "×" + H + ", damier 2/255, " + on.Count + " + " + off.Count + " points), exclusion appliquée : " + excl);
                foreach (var m in methods)
                {
                    var r = res[m];
                    double vis = score(r["calque"], r["avant"], r["après"]), exc = score(r["calque exclu"], r["avant"], r["après"]);
                    double noise = Math.Abs(score(r["avant"], r["après"], r["après"]));
                    string verdictVis = double.IsNaN(vis) ? "capture indisponible" : vis > 0.3 && vis > 5 * noise ? "VOIT le calque" : "ne voit PAS le calque";
                    string verdictExc = double.IsNaN(exc) ? "capture indisponible" : exc > 0.3 && exc > 5 * noise ? "voit ENCORE le calque" : "ne le voit plus";
                    Console.WriteLine("  " + m.PadRight(5) + " calque non exclu : " + verdictVis + " (score " + vis.ToString("0.00") + ") ; exclu : " + verdictExc + " (score " + exc.ToString("0.00") + ") ; bruit " + noise.ToString("0.00"));
                    report.Add(J.Map("method", m, "visible_score", vis, "excluded_score", exc, "noise", noise, "sees_overlay", verdictVis, "sees_excluded", verdictExc));
                }
                string outFile = Path.Combine(Path.GetTempPath(), "chaos-capture-probe-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".json");
                File.WriteAllText(outFile, J.Write(J.Map("screen", dev, "size", W + "x" + H, "alpha", A / 255.0, "excluded_applied", excl, "results", report.ToArray())));
                Console.WriteLine("Résultats : " + outFile);
                return 0;
            }
            finally
            {
                if (surf != null) { try { surf.SetShown(false, 0); surf.Dispose(); } catch (Exception) { } }
                Com.Release(ref srv); Com.Release(ref tex);
            }
        }

        static List<KeyValuePair<string, string>> SampleAll(IntPtr target, IntPtr hmon, RECT mon)
        {
            var r = new List<KeyValuePair<string, string>>();
            Action<string, Func<Color[]>> m = (name, f) => { string c; try { c = Classify(f()); } catch (Exception e) { c = "erreur " + e.GetType().Name; } r.Add(new KeyValuePair<string, string>(name, c)); };
            IntPtr overlay = N.FindWindowW(N.OverlayClass, null);
            m("BitBlt écran (GDI)", GdiScreen);
            m("BitBlt fenêtre du jeu (OBS fenêtre, BitBlt)", () => GdiWindow(target));
            m("WGC écran (OBS écran, Windows 10 : méthode actuelle)", () => Wgc(IntPtr.Zero, hmon, mon.Left, mon.Top));
            m("DXGI écran (OBS écran, DXGI)", () => Dxgi(hmon, mon.Left, mon.Top));
            m("WGC fenêtre du jeu (OBS fenêtre, Windows 10)", () => Wgc(target, IntPtr.Zero, where.X, where.Y));
            m("WGC fenêtre du calque", () => overlay == IntPtr.Zero ? null : Wgc(overlay, IntPtr.Zero, N.FrameBounds(overlay).Left, N.FrameBounds(overlay).Top));
            return r;
        }

        public static int Run(string[] a, string engineExe)
        {
            string game = N.GameActivity();
            if (game != null && !a.Contains("--autorise-pendant-un-jeu"))
            {
                Console.WriteLine("Test NON lancé : " + game + ". Aucun essai visible pendant un jeu ; accord d'Antoni : --autorise-pendant-un-jeu.");
                return 2;
            }
            string primary = N.MonitorDevice(N.MonitorFromWindow(N.GetDesktopWindow(), 2));
            int ai = Array.IndexOf(a, "--screen");
            string dev = ai >= 0 && ai + 1 < a.Length ? a[ai + 1] : N.Monitors().Select(N.MonitorDevice).FirstOrDefault(s => s != primary) ?? primary;
            IntPtr hmon = N.MonitorByDevice(dev);
            RECT mon = N.MonitorRectOf(hmon);
            gpu = new Gpu();
            int tw = 480, th = 270, tx = mon.Left + (mon.Right - mon.Left - tw) / 2, ty = mon.Top + (mon.Bottom - mon.Top - th) / 2;
            var target = Process.Start(new ProcessStartInfo(engineExe, "--test-target --x " + tx + " --y " + ty + " --w " + tw + " --h " + th)
            { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, CreateNoWindow = true });
            IntPtr hwnd = new IntPtr((long)J.Num(J.Parse(target.StandardOutput.ReadLine()), "hwnd", 0));
            Thread.Sleep(500);
            RECT tr = N.FrameBounds(hwnd);
            where = new Rectangle(tr.Left, tr.Top, tr.Right - tr.Left, tr.Bottom - tr.Top);
            var e = EngineProc.Start(engineExe, "--serve --state-dir \"" + Path.Combine(Path.GetTempPath(), "chaos-obs-compat") + "\" --heartbeat-ms 3000");
            var results = new List<object>();
            Console.WriteLine("Compatibilité de capture (OBS) : mire " + tw + "×" + th + " sur " + dev + ", rien n'est fait dans OBS.");
            try
            {
                if (e.Event("engine.ready", 10000) == null) { Console.WriteLine("moteur non prêt"); return 1; }
                e.Pings(500);
                var win = J.Map("kind", "window", "hwnd", hwnd.ToInt64(), "follow_foreground", false);
                var cut = J.Map("in", J.Map("kind", "cut"), "out", J.Map("kind", "cut"));
                Action<string> report = title =>
                {
                    var r = SampleAll(hwnd, hmon, mon);
                    Console.WriteLine("  " + title);
                    foreach (var kv in r) Console.WriteLine("    " + kv.Key.PadRight(54) + kv.Value);
                    results.Add(J.Map("case", title, "methods", r.Select(kv => (object)J.Map("method", kv.Key, "sees", kv.Value)).ToArray()));
                };
                report("Sans effet");
                e.Call("effect.request", J.Map("request_id", "compat-d", "effect", "flip", "source", J.Map("kind", "test"), "target", win, "transition", cut, "duration_ms", 20000));
                if (e.Event("effect.started", 5000, x => J.Str(x, "request_id", "") == "compat-d") == null) Console.WriteLine("  l'effet n'a pas démarré");
                Thread.Sleep(400);
                report("Calque sur la fenêtre (mode D, défaut), retourné");
                e.Call("effect.cancel", J.Map("request_id", "compat-d", "immediate", true));
                e.Event("effect.ended", 3000, x => J.Str(x, "request_id", "") == "compat-d");
                Thread.Sleep(300);
                // Transition : la capture d'écran doit montrer les étapes intermédiaires de la rotation.
                e.Call("effect.request", J.Map("request_id", "compat-t", "effect", "flip", "source", J.Map("kind", "test"), "target", win,
                    "transition", J.Map("in", J.Map("kind", "ramp", "duration_ms", 3000)), "duration_ms", 20000));
                e.Event("effect.started", 5000, x => J.Str(x, "request_id", "") == "compat-t");
                var mid = new List<string>();
                var sw = Stopwatch.StartNew();
                while (sw.ElapsedMilliseconds < 2600) { mid.Add(Classify(Wgc(IntPtr.Zero, hmon, mon.Left, mon.Top))); }
                Console.WriteLine("  Transition (WGC écran, pendant 2,6 s d'une rotation de 3 s) : " + string.Join(" → ", mid.Select(m => m.StartsWith("autre") ? "en rotation" : m).Distinct()));
                results.Add(J.Map("case", "transition", "wgc_screen", mid.ToArray()));
                e.Call("effect.cancel", J.Map("request_id", "compat-t", "immediate", true));
                e.Event("effect.ended", 3000, x => J.Str(x, "request_id", "") == "compat-t");
                Thread.Sleep(300);
                var mon2 = J.Map("kind", "monitor", "device", dev);
                e.Call("effect.request", J.Map("request_id", "compat-c", "effect", "flip", "source", J.Map("kind", "test"), "target", mon2, "transition", cut, "duration_ms", 20000));
                if (e.Event("effect.started", 5000, x => J.Str(x, "request_id", "") == "compat-c") == null) Console.WriteLine("  l'effet écran entier n'a pas démarré");
                Thread.Sleep(400);
                report("Calque sur l'écran entier (mode C, exclu des captures)");
                e.Call("stop_all");
                e.Event("effect.ended", 3000);
                Thread.Sleep(300);
                // Mode E : fenêtre « agrandie » (toute la largeur, une bande libre en bas), cible « écran » des fiches.
                target.StandardInput.Close(); target.WaitForExit(3000);
                int strip = 60, bw = mon.Right - mon.Left, bh = mon.Bottom - mon.Top - strip;
                target = Process.Start(new ProcessStartInfo(engineExe, "--test-target --x " + mon.Left + " --y " + mon.Top + " --w " + bw + " --h " + bh)
                { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, CreateNoWindow = true });
                hwnd = new IntPtr((long)J.Num(J.Parse(target.StandardOutput.ReadLine()), "hwnd", 0));
                Thread.Sleep(500);
                tr = N.FrameBounds(hwnd);
                where = new Rectangle(tr.Left, tr.Top, tr.Right - tr.Left, tr.Bottom - tr.Top);
                // Bande du bas (hors fenêtre) et haut de l'écran : retournés, ils échangent leur contenu.
                Func<string> stripView = () =>
                {
                    var pts = new[] { new Point(mon.Left + bw / 2, mon.Bottom - strip / 2), new Point(mon.Left + bw / 2, mon.Top + strip / 2) };
                    Func<Color[], string> fmt = px => px == null ? "indisponible" : "bas " + Hex(px[0]) + " · haut " + Hex(px[1]);
                    return "WGC écran : " + fmt(WgcAt(IntPtr.Zero, hmon, mon.Left, mon.Top, pts)) + " ; DXGI écran : " + fmt(DxgiAt(hmon, mon.Left, mon.Top, pts));
                };
                string before = stripView();
                Console.WriteLine("  Mode E, sans effet : " + before);
                var screen = J.Map("kind", "screen", "device", dev);
                var resp = e.Call("effect.request", J.Map("request_id", "compat-e", "effect", "flip", "source", J.Map("kind", "test"), "target", screen, "transition", cut, "duration_ms", 20000));
                if (e.Event("effect.started", 5000, x => J.Str(x, "request_id", "") == "compat-e") == null) Console.WriteLine("  l'effet « écran » (mode E) n'a pas démarré");
                Thread.Sleep(600);
                report("Cible « écran » occupée par une fenêtre agrandie (mode E), retournée");
                string after = stripView();
                Console.WriteLine("  Mode E, retourné : " + after);
                results.Add(J.Map("case", "mode_e_strip", "before", before, "after", after, "request", resp));
                e.Call("stop_all");
                e.Event("effect.ended", 3000);
                Thread.Sleep(300);
                // Mode C (écran + OBS, docs/chaos/MODE_C.md) : même cible, sortie OBS demandée. Le calque doit être exclu des
                // captures : la capture d'écran (WGC, DXGI) voit la mire DROITE (OBS appliquera l'effet une fois), alors que
                // le calque lui-même (WGC fenêtre du calque) est retourné. Une mire retournée vue par la capture d'écran =
                // double application.
                resp = e.Call("effect.request", J.Map("request_id", "compat-c2", "effect", "flip", "source", J.Map("kind", "test"), "target", screen, "transition", cut,
                    "duration_ms", 20000, "outputs", new object[] { "screen", "obs" }, "obs", J.Map("width", mon.Right - mon.Left, "height", mon.Bottom - mon.Top)));
                if (e.Event("effect.started", 5000, x => J.Str(x, "request_id", "") == "compat-c2") == null) Console.WriteLine("  l'effet « écran + OBS » n'a pas démarré");
                Thread.Sleep(600);
                report("Mode C (écran + OBS) : calque exclu, OBS doit voir la mire droite");
                string dual = stripView();
                Console.WriteLine("  Mode C, retourné à l'écran : " + dual + " (attendu : comme sans effet)");
                results.Add(J.Map("case", "mode_c_dual", "before", before, "during", dual, "excluded_ok", dual == before, "request", resp));
                e.Call("stop_all");
                e.Event("effect.ended", 3000);
            }
            finally
            {
                try { e.Call("stop_all"); } catch (Exception) { }
                e.Kill();
                try { target.StandardInput.Close(); target.WaitForExit(3000); if (!target.HasExited) target.Kill(); } catch (Exception) { }
            }
            string outFile = Path.Combine(Path.GetTempPath(), "chaos-obs-compat-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".json");
            File.WriteAllText(outFile, J.Write(J.Map("screen", dev, "results", results.ToArray())));
            Console.WriteLine("Résultats : " + outFile);
            return 0;
        }
    }
}
