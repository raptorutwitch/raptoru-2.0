// Contrôles automatiques du lecteur Chaos (lot 1). Sortie : « ok » / « KO » par point, puis le total.
// Les contrôles visuels utilisent une mire 400×240 (jamais activée) sur l'écran secondaire s'il existe, et lisent les
// pixels réellement composés par Windows (BitBlt CAPTUREBLT). Options : --with-monitor (mode C, retourne tout
// l'écran de la mire 1,5 s), --bench-ms <n> (durée de la mesure, 8000 par défaut).
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Raptoru.Chaos
{
    sealed class Child
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        public static readonly Stopwatch Clock = Stopwatch.StartNew();
        public Process P;
        readonly BlockingCollection<Dictionary<string, object>> queue = new BlockingCollection<Dictionary<string, object>>();
        public readonly List<Dictionary<string, object>> All = new List<Dictionary<string, object>>();
        System.Threading.Timer pings;

        public static Child Start(string exe, string args)
        {
            var c = new Child();
            var psi = new ProcessStartInfo(exe, args) { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8 };
            c.P = Process.Start(psi);
            c.P.OutputDataReceived += (s, e) =>
            {
                if (e.Data == null) return;
                Dictionary<string, object> d;
                try { d = Json.Deserialize<Dictionary<string, object>>(e.Data); } catch (Exception) { return; }
                d["_rx"] = Clock.ElapsedMilliseconds;
                lock (c.All) c.All.Add(d);
                c.queue.Add(d);
            };
            c.P.BeginOutputReadLine();
            return c;
        }

        public void Send(Dictionary<string, object> d) { SendRaw(Json.Serialize(d)); }
        public void SendRaw(string s) { try { P.StandardInput.WriteLine(s); P.StandardInput.Flush(); } catch (Exception) { } }
        public void StartPings() { pings = new System.Threading.Timer(_ => SendRaw("{\"cmd\":\"ping\"}"), null, 0, 400); }
        public void StopPings() { if (pings != null) pings.Dispose(); pings = null; }
        public void CloseStdin() { try { P.StandardInput.Close(); } catch (Exception) { } }

        public Dictionary<string, object> Wait(string ev, int ms)
        {
            var sw = Stopwatch.StartNew();
            Dictionary<string, object> e;
            while (queue.TryTake(out e, Math.Max(0, ms - (int)sw.ElapsedMilliseconds))) if (Checks.S(e, "ev") == ev) return e;
            return null;
        }
        public Dictionary<string, object> Poll(string ev)
        {
            Dictionary<string, object> e;
            while (queue.TryTake(out e)) if (Checks.S(e, "ev") == ev) return e;
            return null;
        }
        public Dictionary<string, object> Last(string ev) { lock (All) return All.LastOrDefault(e => Checks.S(e, "ev") == ev); }
        public List<Dictionary<string, object>> Every(string ev) { lock (All) return All.Where(e => Checks.S(e, "ev") == ev).ToList(); }
        public void Kill() { StopPings(); try { if (!P.HasExited) P.Kill(); } catch (Exception) { } }
    }

    static class Checks
    {
        static int ok, ko;
        static string exe;
        static Rectangle where;
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public static string S(Dictionary<string, object> e, string k) { return e != null && e.ContainsKey(k) && e[k] != null ? Convert.ToString(e[k], Inv) : ""; }
        static double D(Dictionary<string, object> e, string k) { try { return Convert.ToDouble(e[k], Inv); } catch (Exception) { return double.NaN; } }

        static void Check(bool cond, string what, string detail)
        {
            if (cond) ok++; else ko++;
            Console.WriteLine((cond ? "  ok  " : "  KO  ") + what + (string.IsNullOrEmpty(detail) ? "" : " — " + detail));
        }
        static void Info(string s) { Console.WriteLine("  ··  " + s); }

        static int Main(string[] args)
        {
            N.SetProcessDpiAwarenessContext(new IntPtr(-4));
            exe = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ChaosPresenter.exe");
            bool withMonitor = args.Contains("--with-monitor");
            int benchMs = 8000;
            for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--bench-ms") int.TryParse(args[i + 1], out benchMs);
            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine("Contrôles Chaos lot 1 — " + exe);

            Protocol();
            Visual(benchMs, withMonitor);

            Console.WriteLine("Total : " + ok + " ok, " + ko + " KO");
            return ko == 0 ? 0 : 1;
        }

        static Dictionary<string, object> Play(Child c, long hwnd, int maxMs, int transitionMs, bool follow, string mode)
        {
            var p = new Dictionary<string, object> { { "hwnd", hwnd }, { "mode", mode }, { "transition_ms", transitionMs }, { "follow_foreground", follow } };
            var d = new Dictionary<string, object> { { "cmd", "play" }, { "id", "chk-" + Child.Clock.ElapsedMilliseconds }, { "effect", "flip" }, { "variant", "rotate180" }, { "max_ms", maxMs }, { "params", p } };
            c.Send(d);
            return d;
        }

        static Child Serve(string extra)
        {
            var c = Child.Start(exe, "--serve" + extra);
            if (c.Wait("ready", 5000) == null) { Check(false, "lecteur prêt", "pas d'événement ready en 5 s"); c.Kill(); return null; }
            return c;
        }

        // ---------- Protocole et arrêts (aucune fenêtre affichée) ----------
        static void Protocol()
        {
            Console.WriteLine("Protocole et arrêts");
            var c = Child.Start(exe, "--serve");
            var r = c.Wait("ready", 5000);
            Check(r != null, "lecteur prêt", r == null ? "aucun ready" : "en " + S(r, "ready_ms") + " ms · GPU " + S(r, "adapter"));
            if (r == null) { c.Kill(); return; }
            c.SendRaw("{pas du json");
            var err = c.Wait("error", 1000);
            Check(S(err, "reason") == "bad_json", "JSON invalide refusé sans planter", S(err, "reason"));
            long t0 = Child.Clock.ElapsedMilliseconds;
            c.CloseStdin();
            bool exited = c.P.WaitForExit(1000);
            var ex = c.Wait("exit", 300);
            Check(exited && S(ex, "reason") == "stdin_closed", "stdin fermé → le lecteur quitte", (Child.Clock.ElapsedMilliseconds - t0) + " ms, " + S(ex, "reason"));

            c = Serve("");
            if (c != null)
            {
                c.SendRaw("{\"cmd\":\"ping\"}");
                t0 = Child.Clock.ElapsedMilliseconds;
                exited = c.P.WaitForExit(4000);
                long dt = Child.Clock.ElapsedMilliseconds - t0;
                ex = c.Wait("exit", 300);
                Check(exited && S(ex, "reason") == "heartbeat" && dt >= 1800 && dt <= 3000, "plus de battement → arrêt de sécurité en ~2 s", dt + " ms, " + S(ex, "reason"));
                c.Kill();
            }

            var parent = Process.Start(new ProcessStartInfo("cmd.exe", "/c ping -n 60 127.0.0.1 >nul") { UseShellExecute = false, CreateNoWindow = true });
            c = Serve(" --parent " + parent.Id);
            if (c != null)
            {
                c.StartPings();
                Thread.Sleep(300);
                t0 = Child.Clock.ElapsedMilliseconds;
                parent.Kill();
                exited = c.P.WaitForExit(2000);
                ex = c.Wait("exit", 300);
                Check(exited && S(ex, "reason") == "parent_exit", "parent mort → le lecteur quitte", (Child.Clock.ElapsedMilliseconds - t0) + " ms, " + S(ex, "reason"));
                c.Kill();
            }
            try { parent.Kill(); } catch (Exception) { }

            c = Serve("");
            if (c != null)
            {
                c.StartPings();
                Play(c, 0x7FFFFFF0, 3000, 0, false, "window");
                var f = c.Wait("failed", 2000);
                Check(S(f, "reason") == "no_window" && c.P.WaitForExit(1000), "fenêtre inexistante → échec propre", S(f, "reason"));
                c.Kill();
            }
            c = Serve("");
            if (c != null)
            {
                c.StartPings();
                c.Send(new Dictionary<string, object> { { "cmd", "play" }, { "id", "x" }, { "effect", "blur" }, { "max_ms", 3000 }, { "params", new Dictionary<string, object> { { "hwnd", 1 } } } });
                var f = c.Wait("failed", 2000);
                Check(S(f, "reason") == "unsupported_effect", "effet inconnu refusé (seul le retournement existe)", S(f, "reason"));
                c.Kill();
            }
        }

        // ---------- Contrôles visuels sur la mire ----------
        static Child target;
        static IntPtr targetHwnd;

        static bool StartTarget()
        {
            var scr = Screen.AllScreens.FirstOrDefault(s => !s.Primary) ?? Screen.PrimaryScreen;
            var wa = scr.WorkingArea;
            target = Child.Start(exe, string.Format(Inv, "--test-target --x {0} --y {1} --w 400 --h 240", wa.Right - 440, wa.Bottom - 280));
            var t = target.Wait("target", 5000);
            if (t == null) return false;
            targetHwnd = new IntPtr(Convert.ToInt64(t["hwnd"], Inv));
            Thread.Sleep(400);
            RECT r = N.FrameBounds(targetHwnd);
            where = new Rectangle(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
            return true;
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
        [System.Runtime.InteropServices.DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);

        static readonly Color[] Original = { Color.Red, Color.Lime, Color.Blue, Color.Yellow };
        static readonly Color[] Flipped = { Color.Yellow, Color.Blue, Color.Lime, Color.Red };

        static string Classify()
        {
            using (var bmp = new Bitmap(where.Width, where.Height))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    IntPtr dst = g.GetHdc(), src = GetDC(IntPtr.Zero);
                    BitBlt(dst, 0, 0, where.Width, where.Height, src, where.X, where.Y, 0x00CC0020 | 0x40000000); // SRCCOPY | CAPTUREBLT
                    ReleaseDC(IntPtr.Zero, src); g.ReleaseHdc(dst);
                }
                var px = new[] { bmp.GetPixel(where.Width / 5, where.Height / 5), bmp.GetPixel(where.Width * 4 / 5, where.Height / 5),
                                 bmp.GetPixel(where.Width / 5, where.Height * 4 / 5), bmp.GetPixel(where.Width * 4 / 5, where.Height * 4 / 5) };
                if (Same(px, Original)) return "original";
                if (Same(px, Flipped)) return "flipped";
                return "other(" + string.Join(" ", px.Select(c => c.R.ToString("X2") + c.G.ToString("X2") + c.B.ToString("X2"))) + ")";
            }
        }
        static bool Same(Color[] a, Color[] b)
        {
            for (int i = 0; i < 4; i++) if (Math.Abs(a[i].R - b[i].R) > 40 || Math.Abs(a[i].G - b[i].G) > 40 || Math.Abs(a[i].B - b[i].B) > 40) return false;
            return true;
        }
        static long WaitScreen(string want, int ms)
        {
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < ms) { if (Classify() == want) return sw.ElapsedMilliseconds; Thread.Sleep(2); }
            return -1;
        }
        static bool NoOverlayLeft() { return N.FindWindowW(N.OverlayClass, null) == IntPtr.Zero; }

        static void Visual(int benchMs, bool withMonitor)
        {
            Console.WriteLine("Retournement sur la mire (écran " + (Screen.AllScreens.Length > 1 ? "secondaire" : "principal") + ")");
            if (!StartTarget()) { Check(false, "mire affichée", "pas de fenêtre-mire"); return; }
            if (where.Width < 50 || where.Height < 50)
            {
                RECT wr; N.GetWindowRect(targetHwnd, out wr);
                Check(false, "mire affichée", "bornes " + where + ", GetWindowRect " + wr.Left + "," + wr.Top + "," + wr.Right + "," + wr.Bottom + ", visible " + N.IsWindowVisible(targetHwnd));
                target.Kill(); return;
            }
            string first = Classify();
            Check(first == "original", "mire visible et lisible à l'écran", first + " @ " + where);
            if (first != "original") { target.Kill(); return; }

            // 1. Premier plan exigé : la mire n'est pas au premier plan → rien ne s'affiche.
            var c = Serve("");
            if (c != null)
            {
                c.StartPings();
                Play(c, targetHwnd.ToInt64(), 5000, 0, true, "window");
                Thread.Sleep(1200);
                Check(c.Last("started") == null && Classify() == "original", "fenêtre pas au premier plan → effet masqué (jamais par-dessus une autre appli)", Classify());
                c.Send(new Dictionary<string, object> { { "cmd", "stop_all" } });
                c.P.WaitForExit(1000); c.Kill();
            }

            // 2. Retournement instantané : pas de flash, clics traversants, focus intact, arrêt immédiat.
            c = Serve("");
            if (c != null)
            {
                c.StartPings();
                IntPtr fgBefore = N.GetForegroundWindow();
                long sent = Child.Clock.ElapsedMilliseconds;
                Play(c, targetHwnd.ToInt64(), 6000, 0, false, "window");
                var seen = new List<string>();
                Dictionary<string, object> st = null;
                long stRx = -1, firstFlipAt = -1;
                var sw = Stopwatch.StartNew();
                while (sw.ElapsedMilliseconds < 4000)
                {
                    string k = Classify();
                    if (seen.Count == 0 || seen[seen.Count - 1] != k) seen.Add(k);
                    if (k == "flipped" && firstFlipAt < 0) firstFlipAt = Child.Clock.ElapsedMilliseconds - sent;
                    if (st == null) { st = c.Poll("started"); if (st != null) stRx = Child.Clock.ElapsedMilliseconds; }
                    if (st != null && Child.Clock.ElapsedMilliseconds - stRx > 400) break;
                    Thread.Sleep(3);
                }
                Check(st != null, "effet démarré", st == null ? "pas de started" : "started en " + S(st, "started_ms") + " ms (1re image " + S(st, "first_frame_ms") +
                    " ms, préparation " + S(st, "setup_ms") + " ms), écran retourné " + firstFlipAt + " ms après l'ordre · bordure " + S(st, "border") + " (" + S(st, "border_access") + ")");
                Check(seen.All(k => k == "original" || k == "flipped") && seen.LastOrDefault() == "flipped", "aucune image intermédiaire (pas de flash noir ni d'image vide)", string.Join(" → ", seen));
                if (st != null)
                {
                    var overlay = new IntPtr(Convert.ToInt64(st["overlay_hwnd"], Inv));
                    int exs = N.GetWindowLongW(overlay, N.GWL_EXSTYLE);
                    int need = N.WS_EX_TOPMOST | N.WS_EX_TRANSPARENT | N.WS_EX_LAYERED | N.WS_EX_NOACTIVATE | N.WS_EX_TOOLWINDOW | N.WS_EX_NOREDIRECTIONBITMAP;
                    Check((exs & need) == need, "fenêtre traversable, jamais activée, hors barre des tâches", "styles 0x" + exs.ToString("X8"));
                    var center = new POINT { X = where.X + where.Width / 2, Y = where.Y + where.Height / 4 };
                    IntPtr hit = N.GetAncestor(N.WindowFromPoint(center), N.GA_ROOTOWNER);
                    Check(hit == targetHwnd, "un clic au milieu de l'effet atteint la fenêtre dessous", "WindowFromPoint → " + (hit == overlay ? "la fenêtre Chaos (KO)" : hit == targetHwnd ? "la mire" : "0x" + hit.ToInt64().ToString("X")));
                    Check(N.GetForegroundWindow() == fgBefore, "le premier plan n'a pas changé (aucun vol de focus)", "");
                    uint aff; N.GetWindowDisplayAffinity(overlay, out aff);
                    Check(aff == 0, "mode D : la fenêtre n'est pas exclue des captures (OBS la voit)", "affinité " + aff);
                    Play(c, targetHwnd.ToInt64(), 3000, 0, false, "window");
                    var busy = c.Wait("failed", 1000);
                    Check(S(busy, "reason") == "busy", "un deuxième effet dans le même lecteur est refusé", S(busy, "reason"));
                    var stats = c.Wait("stats", 1500);
                    if (stats != null) Info("mesure : capture " + S(stats, "capture_fps") + " i/s, affichage " + S(stats, "present_fps") + " i/s, traitement " + S(stats, "lat_p50_ms") + " ms, GPU " + S(stats, "gpu_ms") + " ms, CPU " + S(stats, "cpu_pct") + " %, composition " + S(stats, "comp_hz") + " Hz");
                    long t0 = Child.Clock.ElapsedMilliseconds;
                    c.Send(new Dictionary<string, object> { { "cmd", "stop_all" } });
                    long back = WaitScreen("original", 2000);
                    bool exited = c.P.WaitForExit(1000);
                    var en = c.Wait("ended", 300);
                    Check(back >= 0 && back <= 150, "ARRÊT : écran normal en moins de 150 ms", back + " ms (mesuré à l'écran)");
                    Check(exited && S(en, "reason") == "stopped" && !N.IsWindow(overlay), "le lecteur et sa fenêtre ont disparu", "fin " + (Child.Clock.ElapsedMilliseconds - t0) + " ms, " + S(en, "reason"));
                }
                c.Kill();
            }

            // 3. Bascule animée puis fin par la durée.
            c = Serve("");
            if (c != null)
            {
                c.StartPings();
                Play(c, targetHwnd.ToInt64(), 2000, 550, false, "window");
                var st = c.Wait("started", 3000);
                long stRx = Child.Clock.ElapsedMilliseconds;
                Thread.Sleep(250);
                string mid = Classify();
                long full = WaitScreen("flipped", 1500);
                var en = c.Wait("ended", 5000);
                long dt = Child.Clock.ElapsedMilliseconds - stRx;
                bool exited = c.P.WaitForExit(1000);
                Check(st != null && mid.StartsWith("other") && full >= 0, "bascule animée : image en rotation puis retournée", "à 250 ms : " + mid + " ; retournée après " + (250 + full) + " ms");
                Check(S(en, "reason") == "duration" && dt >= 2300 && dt <= 3300 && exited && Classify() == "original" && NoOverlayLeft(),
                    "fin automatique à la durée (2 s + 0,55 s de retour), écran normal", dt + " ms, " + S(en, "reason"));
                c.Kill();
            }

            // 4. Durée plafonnée à 60 s.
            c = Serve("");
            if (c != null)
            {
                c.StartPings();
                Play(c, targetHwnd.ToInt64(), 999999, 0, false, "window");
                var st = c.Wait("started", 3000);
                Check(S(st, "duration_ms") == "60000", "durée demandée de 1 000 s plafonnée à 60 s", S(st, "duration_ms"));
                c.Send(new Dictionary<string, object> { { "cmd", "stop_all" } });
                c.P.WaitForExit(1000); c.Kill();
            }

            // 5. Mesure : cadence, latence, GPU, CPU sur la mire animée à ~60 i/s.
            c = Serve("");
            if (c != null)
            {
                c.StartPings();
                Play(c, targetHwnd.ToInt64(), benchMs, 0, false, "window");
                c.Wait("ended", benchMs + 4000);
                var all = c.Every("stats").Skip(1).ToList(); // la 1re seconde contient le démarrage
                if (all.Count > 0)
                {
                    Func<string, string> avg = k => { var v = all.Select(e => D(e, k)).Where(x => x >= 0 && !double.IsNaN(x)).ToList(); return v.Count == 0 ? "—" : v.Average().ToString("0.##", Inv); };
                    var en = c.Last("ended");
                    Info("mesure " + (all.Count) + " s : capture " + avg("capture_fps") + " i/s, affichage " + avg("present_fps") + " i/s, composition " + avg("comp_hz") +
                        " Hz, traitement médian " + S(en, "lat_p50_ms") + " ms (p95 " + S(en, "lat_p95_ms") + "), GPU " + S(en, "gpu_ms") + " ms/image, CPU " + avg("cpu_pct") + " % (" + avg("cpu_ms_per_s") + " ms/s)");
                    Check(true, "mesure réalisée", "");
                }
                else Check(false, "mesure réalisée", "aucune statistique");
                c.Kill();
            }

            // 5 bis. Mesure en résolution réelle : capture de l'écran principal, rendu complet dans une fenêtre jamais montrée.
            c = Serve("");
            if (c != null)
            {
                c.StartPings();
                var p = new Dictionary<string, object> { { "hwnd", N.GetDesktopWindow().ToInt64() }, { "mode", "monitor" }, { "transition_ms", 0 }, { "follow_foreground", false }, { "hidden", true } };
                c.Send(new Dictionary<string, object> { { "cmd", "play" }, { "id", "bench-1440" }, { "effect", "flip" }, { "variant", "rotate180" }, { "max_ms", 10000 }, { "params", p } });
                Thread.Sleep(6200);
                c.Send(new Dictionary<string, object> { { "cmd", "stop_all" } });
                var en = c.Wait("ended", 2000);
                var all = c.Every("stats").Skip(1).ToList();
                if (all.Count > 0 && en != null)
                {
                    Func<string, string> avg = k => { var v = all.Select(e => D(e, k)).Where(x => x >= 0 && !double.IsNaN(x)).ToList(); return v.Count == 0 ? "—" : v.Average().ToString("0.##", Inv); };
                    Info("mesure écran principal " + S(all[0], "size") + " (" + all.Count + " s, rien affiché) : capture " + avg("capture_fps") + " i/s (Windows n'envoie que les images qui changent), composition " + avg("comp_hz") +
                        " Hz, traitement médian " + S(en, "lat_p50_ms") + " ms (p95 " + S(en, "lat_p95_ms") + "), GPU " + S(en, "gpu_ms") + " ms/image, CPU " + avg("cpu_pct") + " % (" + avg("cpu_ms_per_s") + " ms/s)");
                    Check(true, "mesure en 1440p réalisée sans rien afficher", "");
                }
                else Check(false, "mesure en 1440p réalisée sans rien afficher", en == null ? "pas de fin" : "aucune statistique");
                c.Kill();
            }

            // 6. Le lecteur tué brutalement : Windows retire la fenêtre, rien à restaurer.
            c = Serve("");
            if (c != null)
            {
                c.StartPings();
                Play(c, targetHwnd.ToInt64(), 10000, 0, false, "window");
                var st = c.Wait("started", 3000);
                WaitScreen("flipped", 1000);
                long t0 = Child.Clock.ElapsedMilliseconds;
                c.P.Kill();
                long back = WaitScreen("original", 2000);
                bool gone = c.P.WaitForExit(2000) && NoOverlayLeft();
                Check(st != null && back >= 0 && back <= 200 && gone, "lecteur tué (plantage simulé) → écran normal immédiatement",
                    back + " ms" + (st == null ? ", pas démarré" : "") + (gone ? "" : ", fenêtre encore présente"));
                c.Kill();
            }

            // 7. Mode C (écran entier) : exclu des captures, donc invisible à la lecture de l'écran.
            if (withMonitor)
            {
                c = Serve("");
                if (c != null)
                {
                    c.StartPings();
                    Play(c, targetHwnd.ToInt64(), 1500, 0, false, "monitor");
                    var st = c.Wait("started", 3000);
                    uint aff = 0;
                    if (st != null) N.GetWindowDisplayAffinity(new IntPtr(Convert.ToInt64(st["overlay_hwnd"], Inv)), out aff);
                    string k = Classify();
                    var en = c.Wait("ended", 4000);
                    Check(st != null && aff == N.WDA_EXCLUDEFROMCAPTURE && k == "original" && S(en, "reason") == "duration",
                        "mode C : écran entier retourné, exclu des captures (la lecture d'écran voit l'original)", "affinité 0x" + aff.ToString("X") + ", capture " + k);
                    c.Kill();
                }
            }

            // 8. Fenêtre cible fermée pendant l'effet.
            c = Serve("");
            if (c != null)
            {
                c.StartPings();
                Play(c, targetHwnd.ToInt64(), 10000, 0, false, "window");
                var st = c.Wait("started", 3000);
                long t0 = Child.Clock.ElapsedMilliseconds;
                target.Kill();
                var en = c.Wait("ended", 2000);
                bool exited = c.P.WaitForExit(1000);
                Check(st != null && S(en, "reason") == "target_lost" && exited && NoOverlayLeft(), "fenêtre cible fermée → effet arrêté", (Child.Clock.ElapsedMilliseconds - t0) + " ms, " + S(en, "reason"));
                c.Kill();
            }
            target.Kill();

            // 9. Chemin complet du panneau (invisible) : lancement du lecteur, battements, JSON, journal, fin par la durée.
            if (!StartTarget()) { Check(false, "panneau → lecteur", "mire non relancée"); return; }
            string journal = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "chaos-journal.txt");
            long before = File.Exists(journal) ? new FileInfo(journal).Length : 0;
            string png = Path.Combine(Path.GetTempPath(), "chaos-panel-selftest.png");
            var panel = Process.Start(new ProcessStartInfo(exe, "--panel-selftest " + targetHwnd.ToInt64() + " \"" + png + "\"") { UseShellExecute = false });
            long flip = WaitScreen("flipped", 4000);
            long backAt = flip >= 0 ? WaitScreen("original", 4000) : -1;
            bool closed = panel.WaitForExit(10000);
            string tail = "";
            if (File.Exists(journal))
                using (var fs = new FileStream(journal, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                { fs.Seek(before, SeekOrigin.Begin); tail = new StreamReader(fs, Encoding.UTF8).ReadToEnd(); }
            Check(flip >= 0 && backAt >= 0 && closed && tail.Contains("PANEL play") && tail.Contains("\"ev\":\"ended\"") && tail.Contains("\"reason\":\"duration\"") && NoOverlayLeft(),
                "panneau → lecteur : retournement lancé par le panneau, fini à la durée, journalisé", "retourné après " + flip + " ms, revenu après " + backAt + " ms ; état du panneau : " + png);
            if (!closed) try { panel.Kill(); } catch (Exception) { }
            target.Kill();
        }
    }
}
