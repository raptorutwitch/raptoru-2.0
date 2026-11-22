// Contrôles d'intégration du moteur Chaos (protocole v2, vrai processus, vrai GPU, vrai écran).
// Les contrôles visuels utilisent une mire 400×240 jamais activée, sur l'écran secondaire s'il existe, et lisent les
// pixels réellement composés par Windows (BitBlt CAPTUREBLT). Aucun plein écran, aucune entrée simulée.
// L'écran entier (couche Entrées) se contrôle sur l'écran secondaire seulement : Windows le retourne quelques secondes,
// l'orientation est relue par EnumDisplaySettings (une capture d'écran GDI le montre toujours à l'endroit).
// Sortie : « ok » / « KO » par point, puis le total. Options : --quick (sans la mesure de 6 s), --no-screen (sans
// retourner l'écran secondaire), --screen-only (seulement l'écran entier).
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Raptoru.Chaos
{
    sealed class EngineProc
    {
        public static readonly Stopwatch Clock = Stopwatch.StartNew();
        public Process P;
        readonly BlockingCollection<Dictionary<string, object>> events = new BlockingCollection<Dictionary<string, object>>();
        readonly ConcurrentDictionary<string, Dictionary<string, object>> responses = new ConcurrentDictionary<string, Dictionary<string, object>>();
        public readonly List<Dictionary<string, object>> All = new List<Dictionary<string, object>>();
        System.Threading.Timer pings;
        int seq;

        public static EngineProc Start(string exe, string args)
        {
            var e = new EngineProc();
            var psi = new ProcessStartInfo(exe, args) { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8 };
            e.P = Process.Start(psi);
            e.P.OutputDataReceived += (s, a) =>
            {
                if (a.Data == null) return;
                Dictionary<string, object> d;
                try { d = J.Parse(a.Data); } catch (Exception) { return; }
                d["_rx"] = Clock.ElapsedMilliseconds;
                lock (e.All) e.All.Add(d);
                if (J.Str(d, "type", "") == "response") e.responses[J.Str(d, "id", "")] = d;
                else e.events.Add(d);
            };
            e.P.BeginOutputReadLine();
            return e;
        }

        public void Raw(string line) { try { P.StandardInput.WriteLine(line); P.StandardInput.Flush(); } catch (Exception) { } }
        /// Ligne brute dont la réponse n'a pas d'identifiant utilisable (JSON illisible, mauvaise version…).
        public Dictionary<string, object> RawCall(string line, int ms = 2000)
        {
            Dictionary<string, object> r;
            responses.TryRemove("", out r);
            Raw(line);
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < ms) { if (responses.TryRemove("", out r)) return r; Thread.Sleep(2); }
            return null;
        }
        public string Send(string cmd, Dictionary<string, object> body = null)
        {
            string id = "c" + Interlocked.Increment(ref seq);
            var d = body != null ? new Dictionary<string, object>(body) : new Dictionary<string, object>();
            d["v"] = 2; d["id"] = id; d["cmd"] = cmd;
            Raw(J.Write(d));
            return id;
        }
        public Dictionary<string, object> Call(string cmd, Dictionary<string, object> body = null, int ms = 3000)
        {
            string id = Send(cmd, body);
            var sw = Stopwatch.StartNew();
            Dictionary<string, object> r;
            while (sw.ElapsedMilliseconds < ms) { if (responses.TryRemove(id, out r)) return r; Thread.Sleep(2); }
            return null;
        }
        public Dictionary<string, object> Result(string cmd, Dictionary<string, object> body = null) { return J.Obj(Call(cmd, body), "result"); }
        public Dictionary<string, object> Event(string name, int ms, Func<Dictionary<string, object>, bool> where = null)
        {
            var sw = Stopwatch.StartNew();
            Dictionary<string, object> e;
            while (events.TryTake(out e, Math.Max(0, ms - (int)sw.ElapsedMilliseconds)))
                if (J.Str(e, "event", "") == name && (where == null || where(e))) return e;
            return null;
        }
        public List<Dictionary<string, object>> Events(string name) { lock (All) return All.Where(e => J.Str(e, "event", "") == name).ToList(); }
        public void Pings(int ms) { pings = new System.Threading.Timer(_ => Send("ping"), null, 0, ms); }
        public void Kill() { if (pings != null) pings.Dispose(); try { if (!P.HasExited) P.Kill(); } catch (Exception) { } }
        public void CloseStdin() { if (pings != null) pings.Dispose(); try { P.StandardInput.Close(); } catch (Exception) { } }
    }

    static class Checks
    {
        static int ok, ko;
        static string exe, state;
        static Rectangle where;
        static Process target;
        static IntPtr targetHwnd;
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
        [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
        [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr h);
        [DllImport("ntdll.dll")] static extern int NtResumeProcess(IntPtr h);
        [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);

        static void Check(bool cond, string what, string detail)
        {
            if (cond) ok++; else ko++;
            Console.WriteLine((cond ? "  ok  " : "  KO  ") + what + (string.IsNullOrEmpty(detail) ? "" : " — " + detail));
        }
        static void Info(string s) { Console.WriteLine("  ··  " + s); }
        static string S(Dictionary<string, object> d, string k) { return J.Str(d, k, ""); }
        static Dictionary<string, object> Err(Dictionary<string, object> r) { return J.Obj(r, "error"); }

        static int Main(string[] args)
        {
            N.SetProcessDpiAwarenessContext(new IntPtr(-4));
            Console.OutputEncoding = Encoding.UTF8;
            exe = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ChaosEngine.exe");
            state = Path.Combine(Path.GetTempPath(), "chaos-checks-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(state);
            Console.WriteLine("Contrôles du moteur Chaos — " + exe);
            try
            {
                if (!args.Contains("--screen-only")) { Protocol(); Visual(!args.Contains("--quick")); }
                if (!args.Contains("--no-screen")) WholeScreen();
            }
            finally
            {
                if (target != null) try { target.Kill(); } catch (Exception) { }
                try { Directory.Delete(state, true); } catch (Exception) { }
            }
            Console.WriteLine("Total : " + ok + " ok, " + ko + " KO");
            return ko == 0 ? 0 : 1;
        }

        static EngineProc Engine(string extra = "")
        {
            var e = EngineProc.Start(exe, "--serve --state-dir \"" + state + "\" --heartbeat-ms 2000" + extra);
            var r = e.Event("engine.ready", 8000);
            if (r == null) { Check(false, "moteur prêt", "pas d'engine.ready"); e.Kill(); return null; }
            e.Pings(500);
            return e;
        }

        static Dictionary<string, object> Request(EngineProc e, string id, string effect, Dictionary<string, object> extra = null)
        {
            var b = J.Map("request_id", id, "effect", effect, "source", J.Map("kind", "test"), "target", J.Map("kind", "window", "hwnd", targetHwnd.ToInt64(), "follow_foreground", false));
            if (extra != null) foreach (var kv in extra) b[kv.Key] = kv.Value;
            return e.Call("effect.request", b);
        }

        // ---------- Protocole, configuration, arrêts (aucune fenêtre) ----------
        static void Protocol()
        {
            Console.WriteLine("Protocole, configuration, arrêts");
            var sw = Stopwatch.StartNew();
            var e = EngineProc.Start(exe, "--serve --state-dir \"" + state + "\" --heartbeat-ms 2000");
            var ready = e.Event("engine.ready", 8000);
            Check(ready != null, "moteur prêt", ready == null ? "" : "en " + S(ready, "ready_ms") + " ms (GPU " + S(ready, "gpu_init_ms") + " ms, shaders " + S(ready, "shader_warm_ms") + " ms) · " + S(ready, "adapter"));
            if (ready == null) { e.Kill(); return; }
            e.Pings(500);
            var hello = e.Result("hello");
            Check(hello != null && S(hello, "protocol") == "2" && J.Strs(hello, "implemented").Contains("flip"), "hello : protocole 2, implémentations", string.Join(",", J.Strs(hello, "implemented")));
            var desc = e.Result("describe");
            var regEffects = J.Arr(J.Obj(desc, "registry"), "effects").Select(o => S(o as Dictionary<string, object>, "id")).ToList();
            Check(regEffects.Contains("flip") && regEffects.Count == J.Strs(desc, "implemented").Count, "describe : le registre partagé = les implémentations", string.Join(",", regEffects));
            Check(S(Err(e.RawCall("{pas du json")), "code") == "bad_json", "JSON invalide : erreur, pas de plantage", "");
            Check(S(Err(e.RawCall("{\"v\":1,\"cmd\":\"ping\"}")), "code") == "unsupported_version", "protocole v1 refusé", "");
            Check(S(Err(e.Call("format_disque")), "code") == "unknown_command", "commande inconnue refusée", "");
            Check(S(Err(e.Call("effect.request", J.Map("request_id", "x", "effect", "nope"))), "code") == "unknown_effect", "effet inconnu refusé", "");
            Check(S(Err(e.Call("effect.request", J.Map("request_id", "x", "effect", "diag.tint", "source", J.Map("kind", "extension")))), "code") == "internal_effect", "effet de diagnostic refusé à l'extension", "");
            Check(S(Err(e.Call("effect.request", J.Map("request_id", "x", "effect", "flip", "params", J.Map("fill", "arc-en-ciel")))), "code") == "invalid_param", "paramètre invalide refusé", "");
            Check(S(Err(e.Call("effect.request", J.Map("request_id", "x", "effect", "flip", "target", J.Map("kind", "window", "hwnd", 0x7FFFFFF0)))), "code") == "no_window", "fenêtre inexistante refusée", "");
            Check(S(Err(e.Call("config.set", J.Map("section", "safety", "values", J.Map("max_duration_ms", 999999)))), "code") == "invalid_config", "configuration hors bornes refusée", "");
            var cfg = J.Obj(e.Call("preset.set", J.Map("effect", "flip", "name", "default", "value", J.Map("params", J.Map("fill", "black"), "duration_ms", 4000))), "result");
            Check(cfg != null && File.Exists(Path.Combine(state, "config.json")), "préréglage enregistré sur disque", "");
            var diag = e.Result("diagnostics");
            var g = J.Obj(diag, "guardian");
            int gpid = (int)J.Num(g, "pid", 0);
            int guardians = Process.GetProcessesByName("ChaosEngine").Count(p => { try { return p.Id != e.P.Id && p.StartTime >= e.P.StartTime; } catch (Exception) { return false; } });
            Check(gpid > 0 && guardians == 1, "un seul gardien lancé", "pid " + gpid + ", raccourci " + S(g, "hotkey") + (guardians == 1 ? "" : ", " + guardians + " gardiens"));
            e.CloseStdin();
            bool exited = e.P.WaitForExit(2000);
            Thread.Sleep(300);
            bool guardianGone = true; try { guardianGone = Process.GetProcessById(gpid).HasExited; } catch (Exception) { }
            Check(exited && S(e.Event("engine.exit", 500), "reason") == "stdin_closed" && guardianGone, "stdin fermé → moteur et gardien terminés", "");

            e = Engine();
            if (e != null)
            {
                var p = J.Obj(J.Obj(J.Obj(e.Result("config.get"), "presets"), "flip"), "default");
                Check(S(J.Obj(p, "params"), "fill") == "black", "préréglage relu après redémarrage", "");
                e.Call("config.reset", J.Map("section", "presets"));
                e.Kill();
            }
            e = EngineProc.Start(exe, "--serve --state-dir \"" + state + "\" --heartbeat-ms 1500");
            e.Event("engine.ready", 8000);
            sw.Restart();
            bool hb = e.P.WaitForExit(5000);
            Check(hb && S(e.Event("engine.exit", 500), "reason") == "heartbeat", "client muet → arrêt de sécurité", sw.ElapsedMilliseconds + " ms (battement 1,5 s)");
            var parent = Process.Start(new ProcessStartInfo("cmd.exe", "/c ping -n 60 127.0.0.1 >nul") { UseShellExecute = false, CreateNoWindow = true });
            e = Engine(" --parent " + parent.Id);
            if (e != null)
            {
                parent.Kill();
                Check(e.P.WaitForExit(2000) && S(e.Event("engine.exit", 500), "reason") == "parent_exit", "parent mort → moteur terminé", "");
                e.Kill();
            }
        }

        // ---------- Mire et lecture de l'écran ----------
        static bool StartTarget(int w = 400, int h = 240)
        {
            var scr = Screen.AllScreens.FirstOrDefault(s => !s.Primary) ?? Screen.PrimaryScreen;
            var wa = scr.WorkingArea;
            var psi = new ProcessStartInfo(exe, string.Format(Inv, "--test-target --x {0} --y {1} --w {2} --h {3}", wa.Right - 560, wa.Bottom - 320, w, h))
            { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, CreateNoWindow = true };
            target = Process.Start(psi);
            string line = target.StandardOutput.ReadLine();
            if (line == null) return false;
            targetHwnd = new IntPtr((long)J.Num(J.Parse(line), "hwnd", 0));
            Thread.Sleep(400);
            Bounds();
            return true;
        }
        static void Bounds() { RECT r = N.FrameBounds(targetHwnd); where = new Rectangle(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top); }

        static readonly Color[] Original = { Color.Red, Color.Lime, Color.Blue, Color.Yellow };
        static readonly Color[] Flipped = { Color.Yellow, Color.Blue, Color.Lime, Color.Red };

        static Color[] Sample()
        {
            using (var bmp = new Bitmap(where.Width, where.Height))
            {
                using (var gr = Graphics.FromImage(bmp))
                {
                    IntPtr dst = gr.GetHdc(), src = GetDC(IntPtr.Zero);
                    BitBlt(dst, 0, 0, where.Width, where.Height, src, where.X, where.Y, 0x00CC0020 | 0x40000000);
                    ReleaseDC(IntPtr.Zero, src); gr.ReleaseHdc(dst);
                }
                return new[] { bmp.GetPixel(where.Width / 5, where.Height / 5), bmp.GetPixel(where.Width * 4 / 5, where.Height / 5),
                               bmp.GetPixel(where.Width / 5, where.Height * 4 / 5), bmp.GetPixel(where.Width * 4 / 5, where.Height * 4 / 5),
                               bmp.GetPixel(where.Width / 2, where.Height / 2 - (int)(0.08 * where.Height)) };
            }
        }
        static string Classify(Color[] px = null)
        {
            px = px ?? Sample();
            if (Same(px, Original)) return "original";
            if (Same(px, Flipped)) return "flipped";
            return "other(" + string.Join(" ", px.Take(4).Select(c => c.R.ToString("X2") + c.G.ToString("X2") + c.B.ToString("X2"))) + ")";
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
        static int Num(Dictionary<string, object> d, string k) { return (int)J.Num(d, k, -1); }

        static void Visual(bool bench)
        {
            Console.WriteLine("Retournement et moteur sur la mire (écran " + (Screen.AllScreens.Length > 1 ? "secondaire" : "principal") + ")");
            if (!StartTarget()) { Check(false, "mire affichée", ""); return; }
            Check(Classify() == "original", "mire visible et lisible", Classify() + " @ " + where);

            // 1. Retournement de bout en bout : registre → validation → ordonnancement → capture → rendu → présentation.
            var e = Engine();
            if (e == null) return;
            IntPtr fg = N.GetForegroundWindow();
            long sent = EngineProc.Clock.ElapsedMilliseconds;
            var resp = Request(e, "flip-1", "flip", J.Map("transition", J.Map("in", J.Map("kind", "cut"), "out", J.Map("kind", "cut"))));
            var seen = new List<string>();
            Dictionary<string, object> st = null;
            long flipAt = -1;
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < 3000)
            {
                string k = Classify();
                if (seen.Count == 0 || seen[seen.Count - 1] != k) seen.Add(k);
                if (k == "flipped" && flipAt < 0) flipAt = EngineProc.Clock.ElapsedMilliseconds - sent;
                if (st == null) st = e.Event("effect.started", 0, x => S(x, "request_id") == "flip-1");
                if (st != null && flipAt >= 0 && EngineProc.Clock.ElapsedMilliseconds - sent > flipAt + 300) break;
                Thread.Sleep(3);
            }
            Check(J.Bool(resp, "ok", false) && st != null && flipAt >= 0, "retournement : accepté, démarré, visible", "écran retourné " + flipAt + " ms après la demande");
            Check(seen.All(k => k == "original" || k == "flipped") && seen.LastOrDefault() == "flipped", "aucune image parasite (coupure franche)", string.Join(" → ", seen));
            IntPtr overlay = N.FindWindowW(N.OverlayClass, null);
            int need = N.WS_EX_TOPMOST | N.WS_EX_TRANSPARENT | N.WS_EX_LAYERED | N.WS_EX_NOACTIVATE | N.WS_EX_TOOLWINDOW | N.WS_EX_NOREDIRECTIONBITMAP;
            Check((N.GetWindowLongW(overlay, N.GWL_EXSTYLE) & need) == need, "fenêtre traversable, jamais activée", "");
            var hit = N.GetAncestor(N.WindowFromPoint(new POINT { X = where.X + where.Width / 2, Y = where.Y + where.Height / 4 }), N.GA_ROOTOWNER);
            Check(hit == targetHwnd, "un clic traverse l'effet jusqu'à la fenêtre", "");
            Check(N.GetForegroundWindow() == fg, "aucun vol de focus", "");
            Check(Screen.AllScreens.All(x => N.DisplayOrientation(x.DeviceName) == 0), "mode fenêtre : visuel seul, aucun écran retourné", "");
            var dup = Request(e, "flip-1", "flip");
            var status = e.Result("status");
            Check(J.Bool(dup, "ok", false) && J.Arr(status, "active").Count == 1, "demande rejouée (même request_id) : aucun doublon", "");
            var q = Request(e, "flip-2", "flip");
            var queued = e.Event("effect.queued", 1000, x => S(x, "request_id") == "flip-2");
            Check(queued != null && S(queued, "blocked_by") == "same_effect_active", "même effet sur la même cible : mis en file", "");

            // 2. Deux effets compatibles, une seule capture.
            var tint = Request(e, "tint-1", "diag.tint", J.Map("duration_ms", 2000, "params", J.Map("strength", 0.5), "transition", J.Map("in", J.Map("kind", "cut"))));
            e.Event("effect.started", 2000, x => S(x, "request_id") == "tint-1");
            Thread.Sleep(150);
            var px = Sample();
            status = e.Result("status");
            Check(Num(status, "captures_open") == 1 && J.Arr(status, "surfaces").Count == 1 && px[0].R < 190 && px[0].G > 200,
                "retournement + filtre : enchaînés sur UNE capture", "captures " + Num(status, "captures_open") + ", pixel haut-gauche " + px[0].R + "," + px[0].G + "," + px[0].B);
            var tEnd = e.Event("effect.ended", 3000, x => S(x, "request_id") == "tint-1");
            Thread.Sleep(100);
            Check(S(tEnd, "reason") == "duration" && Classify() == "flipped", "fin du filtre seul : le retournement continue", "");

            // 3. Panne d'un effet isolée.
            Request(e, "fault-1", "diag.fault", J.Map("params", J.Map("phase", "render", "after_ms", 200)));
            var fail = e.Event("effect.failed", 3000, x => S(x, "request_id") == "fault-1");
            Thread.Sleep(100);
            Check(S(fail, "reason") == "effect_error" && Classify() == "flipped" && J.Arr(e.Result("status"), "active").Any(a => S(a as Dictionary<string, object>, "request_id") == "flip-1"),
                "effet en panne arrêté seul, le retournement continue", S(fail, "detail"));

            // 4. Changement de taille de la cible.
            N.SetWindowPos(targetHwnd, N.HWND_TOPMOST, where.X - 80, where.Y - 30, 480, 270, N.SWP_NOACTIVATE);
            Thread.Sleep(600);
            Bounds();
            Check(Classify() == "flipped" && where.Width == 480, "cible redimensionnée et déplacée : l'effet suit", where.ToString());

            // 5. STOP ALL : tout s'arrête, la file aussi, écran normal immédiatement.
            long t0 = EngineProc.Clock.ElapsedMilliseconds;
            e.Send("stop_all");
            long back = WaitScreen("original", 2000);
            Thread.Sleep(100);
            status = e.Result("status");
            Check(back >= 0 && back < 150 && J.Arr(status, "active").Count == 0 && J.Arr(status, "queued").Count == 0 && NoOverlayLeft(),
                "STOP ALL : écran normal, file vidée, fenêtre détruite", back + " ms (mesuré à l'écran)");
            Thread.Sleep(2300);
            status = e.Result("status");
            Check(Num(status, "captures_open") == 0, "au repos : capture arrêtée après le délai de garde", "");

            // 6. Bascule animée puis arrêt pendant la transition (retour depuis la position courante).
            Request(e, "anim-1", "flip");
            e.Event("effect.started", 3000, x => S(x, "request_id") == "anim-1");
            Thread.Sleep(200);
            string mid = Classify();
            t0 = EngineProc.Clock.ElapsedMilliseconds;
            e.Send("effect.cancel", J.Map("request_id", "anim-1"));
            var end = e.Event("effect.ended", 2000, x => S(x, "request_id") == "anim-1");
            long dt = EngineProc.Clock.ElapsedMilliseconds - t0;
            Thread.Sleep(80);
            Check(mid.StartsWith("other") && end != null && dt < 450 && Classify() == "original", "arrêt pendant la rotation : retour fluide depuis l'angle atteint", "à 200 ms : " + mid + " ; retour en " + dt + " ms");

            // 7. Calque sans capture.
            Request(e, "marker-1", "diag.marker", J.Map("transition", J.Map("in", J.Map("kind", "cut"))));
            e.Event("effect.started", 3000, x => S(x, "request_id") == "marker-1");
            Thread.Sleep(150);
            px = Sample();
            status = e.Result("status");
            var surf = J.Arr(status, "surfaces").FirstOrDefault() as Dictionary<string, object>;
            Check(surf != null && J.Obj(surf, "capture") == null && px[4].R > 180 && px[4].G < 90 && px[4].B > 180 && Classify(px) == "original",
                "calque seul : affiché sans capture (la surface n'en a pas)", "anneau " + px[4].R + "," + px[4].G + "," + px[4].B);
            e.Send("stop_all");
            Thread.Sleep(200);

            // 8. Mesure.
            if (bench)
            {
                Request(e, "bench", "flip", J.Map("duration_ms", 7000, "transition", J.Map("in", J.Map("kind", "cut"))));
                e.Event("effect.ended", 10000, x => S(x, "request_id") == "bench");
                var tels = e.Events("engine.telemetry").Where(x => J.Arr(x, "surfaces").Count > 0).Skip(1).ToList();
                if (tels.Count > 0)
                {
                    Func<string, double> avg = k => tels.Select(x => J.Num(J.Arr(x, "surfaces")[0] as Dictionary<string, object>, k, -1)).Where(v => v >= 0).DefaultIfEmpty(-1).Average();
                    var last = tels.Last();
                    var passes = J.Obj(last, "passes") ?? new Dictionary<string, object>();
                    Info(string.Format(Inv, "mesure {0} s (mire {1}) : capture {2:0.#} i/s, présentation {3:0.#} i/s, traitement p50 {4:0.###} ms / p95 {5:0.###} ms, GPU {6}, CPU {7} %, mémoire {8} Mo, vidéo {9} Mo",
                        tels.Count, S(J.Arr(last, "surfaces")[0] as Dictionary<string, object>, "size"), avg("capture_fps"), avg("present_fps"), avg("processing_p50_ms"), avg("processing_p95_ms"),
                        string.Join(", ", passes.Select(kv => kv.Key + " " + S(kv.Value as Dictionary<string, object>, "p50_ms") + " ms")),
                        S(J.Obj(last, "process"), "cpu_pct"), S(J.Obj(last, "process"), "private_mb"), S(last, "vram_mb")));
                    Check(avg("capture_fps") > 30 && avg("present_fps") > 30, "mesure réalisée (télémétrie du moteur)", "");
                }
                else Check(false, "mesure réalisée", "aucune télémétrie");
            }

            // 9. Arrêt d'urgence (même chemin que le raccourci du gardien : drapeau partagé).
            Request(e, "urg", "flip", J.Map("transition", J.Map("in", J.Map("kind", "cut"))));
            e.Event("effect.started", 3000);
            WaitScreen("flipped", 1000);
            using (var mmf = MemoryMappedFile.OpenExisting("Local\\RaptoruChaos-" + e.P.Id))
            using (var v = mmf.CreateViewAccessor(0, 64)) v.Write(12, 1);
            back = WaitScreen("original", 2000);
            Check(back >= 0 && back < 200 && e.Event("engine.emergency_stop", 500) != null, "arrêt d'urgence : écran normal", back + " ms");

            // 10. Moteur figé : le gardien le tue, Windows retire la fenêtre.
            Request(e, "gel", "flip", J.Map("transition", J.Map("in", J.Map("kind", "cut"))));
            e.Event("effect.started", 3000);
            WaitScreen("flipped", 1000);
            t0 = EngineProc.Clock.ElapsedMilliseconds;
            NtSuspendProcess(e.P.Handle);
            back = WaitScreen("original", 6000);
            bool killed = e.P.WaitForExit(1000);
            if (!killed) NtResumeProcess(e.P.Handle);
            Check(killed && back >= 0 && NoOverlayLeft(), "moteur gelé : le gardien le termine, écran normal", (EngineProc.Clock.ElapsedMilliseconds - t0) + " ms");
            e.Kill();

            // 11. Moteur tué brutalement pendant un effet.
            e = Engine();
            if (e == null) return;
            Request(e, "kill", "flip", J.Map("transition", J.Map("in", J.Map("kind", "cut"))));
            e.Event("effect.started", 3000);
            WaitScreen("flipped", 1000);
            e.P.Kill();
            back = WaitScreen("original", 2000);
            Check(back >= 0 && back < 200 && e.P.WaitForExit(1000) && NoOverlayLeft(), "moteur tué : écran normal immédiatement", back + " ms");

            // 12. Cible fermée pendant l'effet, puis retour au repos sans fuite.
            e = Engine();
            if (e == null) return;
            Request(e, "lost", "flip", J.Map("transition", J.Map("in", J.Map("kind", "cut"))));
            e.Event("effect.started", 3000);
            target.Kill();
            var lost = e.Event("effect.ended", 2000, x => S(x, "request_id") == "lost");
            Thread.Sleep(3500);
            var diag = e.Result("diagnostics");
            Check(S(lost, "reason") == "target_lost" && NoOverlayLeft(), "fenêtre cible fermée : effet terminé", S(lost, "reason"));
            Check(Num(diag, "surfaces_open") == 0 && Num(diag, "captures_open") == 0 && Num(diag, "pool_targets") == 0,
                "au repos : aucune fenêtre, aucune capture, aucune cible GPU", "vidéo " + S(diag, "vram_mb") + " Mo");
            e.Kill();
        }

        // ---------- Écran entier : Windows retourne l'affichage (couche Entrées) ----------
        static long WaitOrientation(string dev, int want, int ms)
        {
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < ms) { if (N.DisplayOrientation(dev) == want) return sw.ElapsedMilliseconds; Thread.Sleep(2); }
            return -1;
        }
        static Dictionary<string, object> ScreenRequest(EngineProc e, string id, string dev, Dictionary<string, object> extra = null)
        {
            var b = J.Map("request_id", id, "effect", "flip", "source", J.Map("kind", "test"), "target", J.Map("kind", "monitor", "device", dev));
            if (extra != null) foreach (var kv in extra) b[kv.Key] = kv.Value;
            return e.Call("effect.request", b);
        }
        static readonly Dictionary<string, object> Cuts = J.Map("transition", J.Map("in", J.Map("kind", "cut"), "out", J.Map("kind", "cut")));
        static int Held(EngineProc e) { return J.Arr(J.Obj(e.Result("status"), "input"), "active").Count; }

        static void WholeScreen()
        {
            var scr = Screen.AllScreens.FirstOrDefault(x => !x.Primary);
            if (scr == null) { Info("un seul écran : retournement de l'écran entier non contrôlé (jamais sur l'écran principal)"); return; }
            string dev = scr.DeviceName;
            Console.WriteLine("Écran entier (" + dev + ", secondaire) : Windows retourne l'affichage, vrai curseur, souris inversée");
            if (N.DisplayOrientation(dev) != 0) { Check(false, "écran secondaire à l'endroit avant le contrôle", "orientation " + N.DisplayOrientation(dev)); return; }
            EngineProc e = null;
            try
            {
                e = Engine();
                if (e == null) return;
                var mons = J.Arr(e.Result("targets.list"), "monitors").Cast<Dictionary<string, object>>().ToList();
                Check(mons.Any(m => S(m, "device") == dev) && mons.Count == Screen.AllScreens.Length, "targets.list : les écrans sont proposés",
                    string.Join(" · ", mons.Select(m => S(m, "label"))));
                Check(S(J.Obj(e.Result("config.get"), "engine"), "default_mode") == "monitor", "cible par défaut : l'écran entier", "");

                // 1. Cycle complet avec transitions : rotation animée → Windows retourne l'écran → retour animé.
                var resp = ScreenRequest(e, "scr-1", dev, J.Map("duration_ms", 2500));
                var view = J.Obj(resp, "result");
                Check(S(J.Obj(view, "target"), "mode") == "C" && S(J.Obj(view, "target"), "input") == "invert_xy", "demande : écran entier, souris inversée déclarée", S(J.Obj(view, "target"), "title"));
                var started = e.Event("effect.started", 3000, x => S(x, "request_id") == "scr-1");
                long startedAt = started != null ? (long)J.Num(started, "_rx", 0) : 0;
                long rot = WaitOrientation(dev, 2, 3000);
                long rotAt = EngineProc.Clock.ElapsedMilliseconds;
                Thread.Sleep(250);
                var st = e.Result("status");
                var surf = J.Arr(st, "surfaces").FirstOrDefault() as Dictionary<string, object>;
                var held = J.Arr(J.Obj(st, "input"), "active").FirstOrDefault() as Dictionary<string, object>;
                Check(started != null && rot >= 0 && held != null && S(held, "device") == dev && surf != null && !J.Bool(surf, "visible", true) && J.Obj(surf, "capture") == null,
                    "après la rotation animée : Windows tient l'écran retourné, ni calque ni capture",
                    "retourné " + (rotAt - startedAt) + " ms après le départ (rotation 550 ms), Windows " + S(held, "apply_ms") + " ms");
                long backIn = WaitOrientation(dev, 0, 4000);
                long backAt = EngineProc.Clock.ElapsedMilliseconds;
                Thread.Sleep(150);
                st = e.Result("status");
                surf = J.Arr(st, "surfaces").FirstOrDefault() as Dictionary<string, object>;
                bool animatedBack = surf != null && J.Bool(surf, "visible", false) && J.Arr(st, "active").Any(a => S(a as Dictionary<string, object>, "state") == "exiting");
                var end = e.Event("effect.ended", 3000, x => S(x, "request_id") == "scr-1");
                long endAt = end != null ? (long)J.Num(end, "_rx", 0) : 0;
                Thread.Sleep(100);
                bool slowFlag = J.Bool(e.Result("status"), "degraded", false) || e.Events("engine.degraded").Count > 0;
                Check(backIn >= 0 && animatedBack && S(end, "reason") == "duration" && NoOverlayLeft() && Held(e) == 0 && !slowFlag,
                    "fin : écran rendu par Windows, puis retour animé, rien ne reste, aucun faux « moteur ralenti »",
                    "rendu " + (backAt - startedAt - 2500) + " ms après la fin prévue, retour animé " + (endAt - backAt) + " ms");

                // 2. Un calque arrive pendant l'effet (le retournement est confié à Windows), puis STOP ALL.
                ScreenRequest(e, "scr-2", dev, Cuts);
                WaitOrientation(dev, 2, 3000);
                Thread.Sleep(200);
                e.Call("effect.request", J.Map("request_id", "mk-2", "effect", "diag.marker", "source", J.Map("kind", "test"),
                    "target", J.Map("kind", "monitor", "device", dev), "transition", J.Map("in", J.Map("kind", "cut"))));
                var mk = e.Event("effect.started", 3000, x => S(x, "request_id") == "mk-2");
                Thread.Sleep(300);
                st = e.Result("status");
                Check(mk != null && N.DisplayOrientation(dev) == 2 && J.Arr(st, "active").Count == 2 && e.Events("effect.failed").Count == 0,
                    "calque ajouté pendant l'effet : le retournement continue (Windows), le calque s'affiche", "");
                e.Send("stop_all");
                long back = WaitOrientation(dev, 0, 2000);
                Thread.Sleep(100);
                // L'orientation revient pendant l'appel à Windows (~110 ms) ; la fenêtre (cachée) est détruite juste après.
                var waitGone = Stopwatch.StartNew();
                while (!NoOverlayLeft() && waitGone.ElapsedMilliseconds < 1000) Thread.Sleep(5);
                bool gone = NoOverlayLeft(); int still = Held(e);
                Check(back >= 0 && back < 400 && gone && still == 0, "STOP ALL pendant l'effet : écran rétabli, fenêtre détruite", back + " ms (fenêtre " + waitGone.ElapsedMilliseconds + " ms plus tard)" + (gone ? "" : ", calque restant") + (still == 0 ? "" : ", écran encore tenu"));

                // 3. Arrêt d'urgence (drapeau du gardien) pendant l'effet.
                ScreenRequest(e, "scr-3", dev, Cuts);
                WaitOrientation(dev, 2, 3000);
                Thread.Sleep(200);
                using (var mmf = MemoryMappedFile.OpenExisting("Local\\RaptoruChaos-" + e.P.Id))
                using (var v = mmf.CreateViewAccessor(0, 64)) v.Write(12, 1);
                back = WaitOrientation(dev, 0, 2000);
                Check(back >= 0 && back < 400 && e.Event("engine.emergency_stop", 1000) != null, "arrêt d'urgence pendant l'effet : écran rétabli", back + " ms");

                // 4. Écran rétabli hors de Chaos (Paramètres de Windows) : l'effet s'arrête de lui-même.
                ScreenRequest(e, "scr-4", dev, Cuts);
                WaitOrientation(dev, 2, 3000);
                Thread.Sleep(200);
                N.ResetDisplaySettings(dev, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero);
                var changed = e.Event("effect.ended", 2000, x => S(x, "request_id") == "scr-4");
                Thread.Sleep(100);
                Check(S(changed, "reason") == "display_changed" && N.DisplayOrientation(dev) == 0 && NoOverlayLeft(), "écran rétabli par Windows pendant l'effet : effet terminé", S(changed, "reason"));

                // 5. Moteur gelé pendant l'effet (aucun calque visible) : le gardien le tue, Windows rétablit l'écran.
                ScreenRequest(e, "scr-5", dev, Cuts);
                WaitOrientation(dev, 2, 3000);
                Thread.Sleep(300);
                NtSuspendProcess(e.P.Handle);
                back = WaitOrientation(dev, 0, 6000);
                // Tué par le gardien, le processus porte son code de sortie (9) tout de suite. Suspendu par le contrôle
                // alors qu'il tenait l'affichage, sa disparition complète peut traîner dans Windows : un vrai blocage ne
                // suspend pas le processus, et c'est l'écran rétabli qui compte.
                Thread.Sleep(200);
                uint code; GetExitCodeProcess(e.P.Handle, out code);
                NtResumeProcess(e.P.Handle);
                Check(code == 9 && back >= 0, "moteur gelé pendant l'effet : le gardien le tue, Windows rétablit l'écran",
                    "écran rétabli " + back + " ms après le gel" + (code == 9 ? "" : ", code de sortie " + code));
                e.Kill();

                // 6. Moteur tué brutalement pendant l'effet : Windows rétablit l'écran seul (mode temporaire du processus).
                e = Engine();
                if (e == null) return;
                ScreenRequest(e, "scr-6", dev, Cuts);
                WaitOrientation(dev, 2, 3000);
                Thread.Sleep(300);
                e.P.Kill();
                back = WaitOrientation(dev, 0, 3000);
                Check(back >= 0 && back < 1500 && e.P.WaitForExit(1000) && NoOverlayLeft(), "moteur tué pendant l'effet : Windows rétablit l'écran seul", back + " ms");
            }
            finally
            {
                if (e != null) e.Kill();
                if (N.DisplayOrientation(dev) != 0)
                {
                    N.ResetDisplaySettings(dev, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero);
                    Check(false, "écran secondaire rétabli par le contrôle lui-même (secours)", "orientation " + N.DisplayOrientation(dev));
                }
            }
        }
    }
}
