// Contrôle d'intégration du curseur retourné dans le MOTEUR (docs/chaos/ETUDE_CURSEUR.md, décision du 23/11) :
// retournement 180° d'une mire placée sous le curseur actuel (la souris n'est jamais déplacée), puis :
//   1. curseur matériel masqué (état du moteur, Desktop Duplication), image du curseur dessinée au point miroir
//      (pixels à l'écran), ce que voit une capture d'écran WGC d'OBS (curseur réel absent, curseur retourné présent),
//      drapeaux GetCursorInfo (la méthode DXGI d'OBS dessine le curseur si « affiché ») ;
//   2. fin de l'effet → curseur rétabli (délai) ;  3. arrêt d'urgence → rétabli ;
//   4. moteur tué → rétabli par le gardien ;  5. moteur gelé → rétabli par le gardien, moteur arrêté ;
//   6. réglage cursor_follow coupé → curseur de Windows inchangé (référence des mesures de pixels) ;
//   latence estimée du curseur dessiné (télémétrie du moteur).
// VISIBLE et masque le curseur quelques secondes à chaque étape : garde de jeu, et 2 minutes sans souris ni clavier
// (--maintenant : essai voulu par Antoni, souris immobile pendant environ 40 s).
// Usage : chaos-bench.exe --cursor-check [--maintenant] [--engine <ChaosEngine.exe>]
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

namespace Raptoru.Chaos
{
    static class CursorCheck
    {
        [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
        [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
        [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr h);
        static int ok, ko;
        static readonly List<string> report = new List<string>();
        static Gpu gpu;

        static void Check(bool c, string what, string detail)
        {
            if (c) ok++; else ko++;
            string line = (c ? "  ok  " : "  KO  ") + what + (string.IsNullOrEmpty(detail) ? "" : " — " + detail);
            Console.WriteLine(line); report.Add(line);
        }
        static void Note(string s) { Console.WriteLine("  ··  " + s); report.Add("  ··  " + s); }

        /// Pixels « de curseur » (presque noirs ou presque blancs) dans une zone de l'écran (GDI : sans curseur matériel).
        static int CursorPixels(int x0, int y0, int w, int h)
        {
            IntPtr dc = GetDC(IntPtr.Zero);
            try
            {
                using (var bmp = new Bitmap(w, h))
                {
                    using (var g = Graphics.FromImage(bmp)) { IntPtr d = g.GetHdc(); BitBlt(d, 0, 0, w, h, dc, x0, y0, 0x00CC0020 | 0x40000000); g.ReleaseHdc(d); }
                    int n = 0;
                    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
                    {
                        var c = bmp.GetPixel(x, y);
                        if ((c.R < 40 && c.G < 40 && c.B < 40) || (c.R > 215 && c.G > 215 && c.B > 215)) n++;
                    }
                    return n;
                }
            }
            finally { ReleaseDC(IntPtr.Zero, dc); }
        }

        /// Desktop Duplication : le pointeur est-il visible ? (attend jusqu'à ms)
        static long WaitPointer(IntPtr hmon, string want, int ms)
        {
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < ms) { if (CursorProto.DdPointer(gpu, hmon) == want) return sw.ElapsedMilliseconds; Thread.Sleep(20); }
            return -1;
        }

        static EngineProc StartEngine(string exe, string dir)
        {
            var e = EngineProc.Start(exe, "--serve --state-dir \"" + dir + "\" --heartbeat-ms 3000");
            if (e.Event("engine.ready", 10000) == null) throw new Exception("moteur non prêt");
            e.Pings(500);
            e.Call("config.set", J.Map("section", "engine", "values", J.Map("telemetry_interval_ms", 250, "cursor_follow", true)));
            Thread.Sleep(800); // gardien lancé
            return e;
        }

        static bool Flip(EngineProc e, IntPtr target, string id)
        {
            e.Call("effect.request", J.Map("request_id", id, "effect", "flip", "source", J.Map("kind", "test"),
                "target", J.Map("kind", "window", "hwnd", target.ToInt64(), "follow_foreground", false),
                "transition", J.Map("in", J.Map("kind", "cut"), "out", J.Map("kind", "cut")), "duration_ms", 30000));
            bool started = e.Event("effect.started", 5000, x => J.Str(x, "request_id", "") == id) != null;
            Thread.Sleep(400);
            return started;
        }

        static bool Hidden(EngineProc e) { return J.Bool(J.Obj(e.Result("status"), "cursor"), "hidden", false); }

        public static int Run(string[] a, string engineExe)
        {
            string game = N.GameActivity();
            if (game != null && !a.Contains("--autorise-pendant-un-jeu")) { Console.WriteLine("Contrôle NON lancé : " + game + "."); return 2; }
            if (CursorProto.IdleSeconds() < 120 && !a.Contains("--maintenant"))
            {
                Console.WriteLine("Contrôle NON lancé : souris ou clavier utilisés il y a moins de 2 minutes (--maintenant pour un essai voulu, souris immobile 40 s).");
                return 2;
            }
            gpu = new Gpu();
            POINT p; GetCursorPos(out p);
            IntPtr hmon = N.MonitorFromWindow(N.WindowFromPoint(p), 2);
            RECT mon = N.MonitorRectOf(hmon);
            // Mire placée pour que la pointe soit à (25 %, 30 %) : quadrant rouge uni ; son point miroir (75 %, 70 %) montre
            // alors ce même rouge, sur lequel le curseur dessiné (noir et blanc) se compte.
            int tw = 480, th = 270;
            int tx = Math.Max(mon.Left, Math.Min(mon.Right - tw, p.X - tw / 4)), ty = Math.Max(mon.Top, Math.Min(mon.Bottom - th, p.Y - th * 3 / 10));
            var target = Process.Start(new ProcessStartInfo(engineExe, "--test-target --x " + tx + " --y " + ty + " --w " + tw + " --h " + th)
            { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, CreateNoWindow = true });
            IntPtr hwnd = new IntPtr((long)J.Num(J.Parse(target.StandardOutput.ReadLine()), "hwnd", 0));
            Thread.Sleep(500);
            RECT tr = N.FrameBounds(hwnd);
            int mx = tr.Right - 1 - (p.X - tr.Left), my = tr.Bottom - 1 - (p.Y - tr.Top);
            string dir = Path.Combine(Path.GetTempPath(), "chaos-cursor-check");
            Console.WriteLine("Curseur retourné — pointe (" + p.X + ", " + p.Y + "), mire " + tw + "×" + th + " en (" + tx + ", " + ty + "), point miroir (" + mx + ", " + my + ").");
            report.Add("Contrôle du curseur retourné, " + DateTime.Now.ToString("dd/MM HH:mm:ss"));
            EngineProc e = null;
            try
            {
                e = StartEngine(engineExe, dir);
                // 6 d'abord (référence) : réglage coupé, curseur de Windows inchangé.
                e.Call("config.set", J.Map("section", "engine", "values", J.Map("cursor_follow", false)));
                Flip(e, hwnd, "ref");
                int refPixels = CursorPixels(mx - 20, my - 20, 22, 22);
                bool refHidden = Hidden(e);
                string refDd = CursorProto.DdPointer(gpu, hmon);
                bool refWgc = CursorProto.CursorInWgc(gpu, hmon, mon, p.X, p.Y);
                Check(!refHidden && refDd == "visible", "6. réglage coupé : curseur de Windows inchangé", "Desktop Duplication « " + refDd + " », capture WGC avec curseur : " + (refWgc ? "curseur réel présent" : "absent"));
                e.Call("stop_all"); e.Event("effect.ended", 2000);
                e.Call("config.set", J.Map("section", "engine", "values", J.Map("cursor_follow", true)));

                // 1. Retournement avec le curseur suivi.
                bool started = Flip(e, hwnd, "flip-1");
                bool hidden = Hidden(e);
                string dd = CursorProto.DdPointer(gpu, hmon);
                int drawn = CursorPixels(mx - 20, my - 20, 22, 22);
                bool wgcReal = CursorProto.CursorInWgc(gpu, hmon, mon, p.X, p.Y);
                string flags = CursorProto.Flags();
                Check(started && hidden && dd == "invisible", "1a. curseur matériel masqué au-dessus de la cible", "moteur : masqué = " + hidden + ", Desktop Duplication « " + dd + " »");
                Check(drawn >= refPixels + 15, "1b. image du curseur dessinée au point miroir", drawn + " pixels de curseur (référence sans curseur suivi : " + refPixels + ")");
                Check(!wgcReal, "1c. capture d'écran WGC (OBS) : pas de curseur réel à la vraie position", "le seul curseur capturé est le curseur retourné (fait partie du calque)");
                Note("1d. GetCursorInfo pendant le masquage : " + flags + " (la méthode DXGI d'OBS dessine son curseur seulement si « affiché »)");
                Thread.Sleep(1200);
                var tels = e.Events("engine.telemetry").Where(t => J.Arr(t, "surfaces").Count > 0).ToList();
                var last = tels.Count > 0 ? J.Arr(tels[tels.Count - 1], "surfaces")[0] as Dictionary<string, object> : null;
                if (last != null)
                    Note("1e. latence estimée du curseur dessiné (position lue → composition) : p50 " + J.Num(last, "cursor_latency_est_p50_ms", -1) + " ms, p95 " +
                        J.Num(last, "cursor_latency_est_p95_ms", -1) + " ms ; image du jeu ajoutée p50 " + J.Num(last, "added_latency_est_p50_ms", -1) + " ms ; écran " + J.Num(last, "refresh_hz", -1) + " Hz");

                // 2. Fin de l'effet.
                e.Call("effect.cancel", J.Map("request_id", "flip-1", "immediate", true));
                long back = WaitPointer(hmon, "visible", 2000);
                Check(back >= 0 && back < 300 && !Hidden(e), "2. fin de l'effet : curseur rétabli", back + " ms");

                // 3. Arrêt d'urgence (même voie que Ctrl+Maj+F11).
                Flip(e, hwnd, "flip-2");
                using (var mmf = MemoryMappedFile.OpenExisting(Server.SharedName(e.P.Id)))
                using (var v = mmf.CreateViewAccessor(0, 64)) v.Write(12, 1);
                back = WaitPointer(hmon, "visible", 2000);
                Check(back >= 0 && back < 400, "3. arrêt d'urgence : curseur rétabli", back + " ms");

                // 4. Moteur tué pendant l'effet : le gardien rétablit le curseur.
                Flip(e, hwnd, "flip-3");
                bool hid3 = CursorProto.DdPointer(gpu, hmon) == "invisible";
                e.P.Kill();
                back = WaitPointer(hmon, "visible", 3000);
                Check(hid3 && back >= 0 && back < 1000, "4. moteur tué : curseur rétabli (gardien ou Windows)", back + " ms");
                e.Kill();

                // 5. Moteur gelé pendant l'effet : le gardien rétablit le curseur (1,2 s) puis arrête le moteur (2,5 s).
                e = StartEngine(engineExe, dir);
                Flip(e, hwnd, "flip-4");
                bool hid4 = CursorProto.DdPointer(gpu, hmon) == "invisible";
                NtSuspendProcess(e.P.Handle);
                back = WaitPointer(hmon, "visible", 4000);
                bool killed = e.P.WaitForExit(4000);
                int code = killed ? e.P.ExitCode : -1;
                Check(hid4 && back >= 0 && back < 2000 && code == 9, "5. moteur gelé : curseur rétabli par le gardien, moteur arrêté", back + " ms, code de sortie " + code);
                e.Kill();
                e = null;
            }
            catch (Exception x) { Check(false, "contrôle interrompu", x.Message); }
            finally
            {
                if (e != null) { try { e.Call("stop_all"); } catch (Exception) { } e.Kill(); }
                CursorLayer.RestoreSystem();
                try { target.StandardInput.Close(); target.WaitForExit(3000); if (!target.HasExited) target.Kill(); } catch (Exception) { }
            }
            string state = CursorProto.DdPointer(gpu, hmon);
            Check(state == "visible", "fin du contrôle : curseur visible", "Desktop Duplication « " + state + " »");
            string outFile = Path.Combine(Path.GetTempPath(), "chaos-cursor-check-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".txt");
            report.Add("Total : " + ok + " ok, " + ko + " KO");
            File.WriteAllLines(outFile, report);
            Console.WriteLine("Total : " + ok + " ok, " + ko + " KO — " + outFile);
            return ko == 0 ? 0 : 1;
        }
    }
}
