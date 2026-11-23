// Compatibilité de capture (OBS) : ce que voit chaque méthode de capture quand le calque retourne une mire.
// Aucune action sur OBS : ses méthodes sont reproduites avec les mêmes API de Windows.
//   BitBlt écran            capture GDI de l'écran (contrôles du moteur)
//   BitBlt fenêtre          OBS « Capture de fenêtre », méthode BitBlt (contenu de la fenêtre du jeu)
//   WGC écran               OBS « Capture d'écran », méthode Windows 10 (méthode choisie par l'OBS d'Antoni)
//   DXGI écran              OBS « Capture d'écran », méthode DXGI (Desktop Duplication)
//   WGC fenêtre du jeu      OBS « Capture de fenêtre », méthode Windows 10
//   WGC fenêtre du calque   une source OBS « Capture de fenêtre » qui viserait le calque lui-même
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
