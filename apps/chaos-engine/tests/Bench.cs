// Banc de comparaison des méthodes de retournement (docs/chaos/ETUDE_PERFORMANCES_RETOURNEMENT.md).
// Un « jeu témoin » (fenêtre Direct3D plein écran, 240 images/s visées, chaque image horodatée) tourne sur un écran ; le
// banc déclenche les méthodes une à une et compare la cadence du témoin, phase par phase (avant, entrée, pendant, sortie,
// après) : base (aucun effet) · calque sur la fenêtre · calque sur l'écran entier · Windows (bascule d'orientation,
// expérimental). Facultatif : PresentMon sur un vrai jeu (--presentmon <exe> --process <nom.exe>).
// VISIBLE ET PERTURBANT : refuse de tourner si un jeu ou une application plein écran est actif, sauf
// --autorise-pendant-un-jeu (accord d'Antoni). Jamais lancé par les contrôles automatiques.
// Usage : chaos-bench.exe [--screen \\.\DISPLAY2] [--probe-screen same|other] [--methods base,calque,ecran,windows]
//                         [--hold-ms 4000] [--probe-fps 240] [--out <fichier.json>]
//                         [--presentmon <PresentMon.exe> --process <jeu.exe>] [--autorise-pendant-un-jeu]
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Raptoru.Chaos
{
    delegate int FactoryCreateForHwnd(IntPtr self, IntPtr device, IntPtr hwnd, ref DXGI_SWAP_CHAIN_DESC1 d, IntPtr fullscreen, IntPtr restrict, out IntPtr sc); // 15

    static class Bench
    {
        [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);
        static WndProc probeProc;
        static readonly long Freq = Stopwatch.Frequency;
        static string Arg(string[] a, string k, string d) { int i = Array.IndexOf(a, k); return i >= 0 && i + 1 < a.Length ? a[i + 1] : d; }

        static int Main(string[] args)
        {
            N.SetProcessDpiAwarenessContext(new IntPtr(-4));
            Console.OutputEncoding = Encoding.UTF8;
            if (args.Length > 0 && args[0] == "--probe") return Probe(args[1], args[2], int.Parse(args[3]));
            return Run(args);
        }

        // ---------- Jeu témoin ----------
        static int Probe(string device, string outFile, int fps)
        {
            timeBeginPeriod(1);
            IntPtr hmon = N.MonitorByDevice(device);
            RECT r = N.MonitorRectOf(hmon);
            int w = r.Right - r.Left, h = r.Bottom - r.Top;
            probeProc = (hh, m, wp, lp) => N.DefWindowProcW(hh, m, wp, lp);
            var wc = new WNDCLASSEX { cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX)), lpfnWndProc = Marshal.GetFunctionPointerForDelegate(probeProc), hInstance = N.GetModuleHandleW(IntPtr.Zero), lpszClassName = "RaptoruChaosProbe" };
            N.RegisterClassExW(ref wc);
            IntPtr hwnd = N.CreateWindowExW(0, "RaptoruChaosProbe", "Jeu témoin Chaos", N.WS_POPUP | 0x10000000 /* WS_VISIBLE */, r.Left, r.Top, w, h, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
            var gpu = new Gpu();
            var lib = new ShaderLibrary(gpu, Path.Combine(Path.GetTempPath(), "chaos-bench-shaders"));
            lib.Warm();
            var pool = new TexturePool(gpu);
            var timer = new GpuTimer(gpu);
            var d = new DXGI_SWAP_CHAIN_DESC1 { Width = (uint)w, Height = (uint)h, Format = Gpu.Bgra, SampleCount = 1, BufferUsage = 0x20, BufferCount = 2, SwapEffect = 4 /* FLIP_DISCARD */ };
            IntPtr sc;
            Com.Check(Com.Fn<FactoryCreateForHwnd>(gpu.Factory, 15)(gpu.Factory, gpu.Device, hwnd, ref d, IntPtr.Zero, IntPtr.Zero, out sc), "CreateSwapChainForHwnd");
            var present = Com.Fn<ScPresent>(sc, 8);
            Guid tid = Iid.Texture2D;
            IntPtr back;
            Com.Check(Com.Fn<ScGetBuffer>(sc, 9)(sc, 0, ref tid, out back), "GetBuffer");
            IntPtr rtv = gpu.Rtv(back);
            Marshal.Release(back);
            var px = new byte[256 * 256 * 4];
            for (int i = 0; i < 256 * 256; i++) { px[i * 4] = (byte)(i % 256); px[i * 4 + 1] = (byte)(i / 256); px[i * 4 + 2] = 128; px[i * 4 + 3] = 255; }
            IntPtr srv = gpu.Srv(gpu.TextureWithData(256, 256, px));
            bool stop = false;
            new Thread(() => { Console.In.ReadLine(); stop = true; }) { IsBackground = true }.Start();
            Console.WriteLine(J.Write(J.Map("probe", "ready", "hwnd", hwnd.ToInt64(), "width", w, "height", h)));
            var frames = new List<long>(1 << 20);
            long interval = Freq / Math.Max(1, fps), next = Stopwatch.GetTimestamp();
            var clock = Stopwatch.StartNew();
            while (!stop && clock.Elapsed.TotalMinutes < 10)
            {
                MSG m;
                while (N.PeekMessageW(out m, IntPtr.Zero, 0, 0, N.PM_REMOVE)) { N.TranslateMessage(ref m); N.DispatchMessageW(ref m); }
                var fb = new FrameBuilder((uint)w, (uint)h, true);
                fb.Transform(clock.Elapsed.TotalSeconds, 1.2, 1.2, 0, 0, "black");
                fb.Execute(gpu, lib, pool, timer, srv, rtv, clock.ElapsedMilliseconds, (float)clock.Elapsed.TotalSeconds);
                present(sc, 0, 0);
                frames.Add(Stopwatch.GetTimestamp());
                timer.Collect((l, ms) => { });
                // Limiteur de cadence, comme beaucoup de jeux : l'attente ne compte pas dans les à-coups.
                next += interval;
                long now = Stopwatch.GetTimestamp();
                if (next < now - interval) next = now;
                while ((now = Stopwatch.GetTimestamp()) < next) { if (next - now > Freq / 500) Thread.Sleep(1); else Thread.SpinWait(64); }
            }
            File.WriteAllLines(outFile, frames.Select(f => f.ToString(CultureInfo.InvariantCulture)));
            Console.WriteLine(J.Write(J.Map("probe", "done", "frames", frames.Count)));
            return 0;
        }

        // ---------- Banc ----------
        sealed class Mark { public string Method; public long Before, Req, Started = -1, ExitAt = -1, Ended = -1, After; public List<string> Inputs = new List<string>(); }

        static int Run(string[] a)
        {
            string game = N.GameActivity();
            if (game != null && !a.Contains("--autorise-pendant-un-jeu"))
            {
                Console.WriteLine("Banc NON lancé : " + game + ". Aucun essai visible pendant un jeu ; accord d'Antoni : --autorise-pendant-un-jeu.");
                return 2;
            }
            var screens = N.Monitors().Select(N.MonitorDevice).ToList();
            string primary = N.MonitorDevice(N.MonitorFromWindow(N.GetDesktopWindow(), 2));
            string dev = Arg(a, "--screen", screens.FirstOrDefault(s => s != primary));
            if (dev == null) { Console.WriteLine("Un seul écran : préciser --screen (le banc ne retourne jamais l'écran principal sans le demander)."); return 2; }
            string probeDev = Arg(a, "--probe-screen", "same") == "other" ? screens.FirstOrDefault(s => s != dev) ?? dev : dev;
            var methods = Arg(a, "--methods", "base,calque,ecran,windows").Split(',');
            int hold = int.Parse(Arg(a, "--hold-ms", "4000")), fps = int.Parse(Arg(a, "--probe-fps", "240"));
            string dir = Path.Combine(Path.GetTempPath(), "chaos-bench-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            Directory.CreateDirectory(dir);
            string self = Process.GetCurrentProcess().MainModule.FileName, engineExe = Path.Combine(Path.GetDirectoryName(self), "ChaosEngine.exe");
            Console.WriteLine("Banc Chaos : effet sur " + dev + ", jeu témoin sur " + probeDev + " (" + fps + " i/s visées), méthodes " + string.Join(", ", methods));

            var probe = Process.Start(new ProcessStartInfo(self, "--probe " + probeDev + " \"" + Path.Combine(dir, "probe.txt") + "\" " + fps)
            { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, CreateNoWindow = true });
            long probeHwnd = (long)J.Num(J.Parse(probe.StandardOutput.ReadLine()), "hwnd", 0);
            Process pm = null;
            long pmStart = 0;
            string pmCsv = Path.Combine(dir, "presentmon.csv"), pmProc = Arg(a, "--process", null);
            if (Arg(a, "--presentmon", null) != null && pmProc != null)
            {
                pmStart = Stopwatch.GetTimestamp();
                pm = Process.Start(new ProcessStartInfo(Arg(a, "--presentmon", null), "--process_name " + pmProc + " --output_file \"" + pmCsv + "\" --qpc_time --no_console_stats")
                { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true });
            }
            var e = EngineProc.Start(engineExe, "--serve --state-dir \"" + Path.Combine(dir, "engine") + "\" --heartbeat-ms 3000");
            var marks = new List<Mark>();
            try
            {
                if (e.Event("engine.ready", 10000) == null) { Console.WriteLine("moteur non prêt"); return 1; }
                e.Pings(500);
                Thread.Sleep(2000); // le témoin se stabilise
                foreach (var m in methods)
                {
                    string g = N.GameActivity();
                    if (g != null && g.StartsWith("jeu") && !a.Contains("--autorise-pendant-un-jeu")) { Console.WriteLine("Arrêt : " + g); break; }
                    marks.Add(RunMethod(e, m.Trim(), dev, probeHwnd, hold));
                }
            }
            finally
            {
                e.Call("stop_all");
                e.Kill();
                try { probe.StandardInput.WriteLine("stop"); probe.WaitForExit(5000); } catch (Exception) { }
                if (pm != null) try { pm.Kill(); pm.WaitForExit(3000); } catch (Exception) { }
                if (N.DisplayOrientation(dev) != 0) N.ResetDisplaySettings(dev, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero);
            }
            var frames = File.Exists(Path.Combine(dir, "probe.txt"))
                ? File.ReadAllLines(Path.Combine(dir, "probe.txt")).Select(l => long.Parse(l, CultureInfo.InvariantCulture)).ToList() : new List<long>();
            var report = new List<object>();
            Console.WriteLine(Report("Jeu témoin", frames, marks, report));
            if (pm != null && File.Exists(pmCsv))
            {
                bool isQpc;
                var rows = BenchStats.ParsePresentMon(File.ReadAllText(pmCsv), pmProc, out isQpc);
                var pmFrames = rows.Select(x => isQpc ? (long)x.Time : pmStart + (long)(x.Time * Freq)).ToList();
                Console.WriteLine(Report("PresentMon " + pmProc + (isQpc ? "" : " (horloge approchée)"), pmFrames, marks, report));
                var modes = rows.GroupBy(x => x.Mode).Select(gr => gr.Key + " " + gr.Count()).ToArray();
                Console.WriteLine("  modes de présentation : " + string.Join(", ", modes));
            }
            string outFile = Arg(a, "--out", Path.Combine(dir, "bench.json"));
            File.WriteAllText(outFile, J.Write(J.Map("screen", dev, "probe_screen", probeDev, "probe_fps", fps, "hold_ms", hold, "results", report.ToArray(),
                "marks", marks.Select(m => (object)J.Map("method", m.Method, "inputs", m.Inputs.ToArray())).ToArray())));
            Console.WriteLine("Résultats : " + outFile);
            return 0;
        }

        static Mark RunMethod(EngineProc e, string method, string dev, long probeHwnd, int hold)
        {
            var m = new Mark { Method = method, Before = Stopwatch.GetTimestamp() };
            Thread.Sleep(2000);
            m.Req = Stopwatch.GetTimestamp();
            if (method != "base")
            {
                e.Call("config.set", J.Map("section", "engine", "values", J.Map("input_effects", method == "windows")));
                var target = method == "calque" ? J.Map("kind", "window", "hwnd", probeHwnd, "follow_foreground", false) : J.Map("kind", "monitor", "device", dev);
                string id = "bench-" + method;
                e.Call("effect.request", J.Map("request_id", id, "effect", "flip", "source", J.Map("kind", "test"), "target", target, "duration_ms", hold));
                if (e.Event("effect.started", 5000, x => J.Str(x, "request_id", "") == id) != null) m.Started = Stopwatch.GetTimestamp();
                var ended = e.Event("effect.ended", hold + 8000, x => J.Str(x, "request_id", "") == id);
                m.Ended = Stopwatch.GetTimestamp();
                if (m.Started > 0) m.ExitAt = m.Started + (long)((hold - 500) / 1000.0 * Freq);
                foreach (var ev in e.Events("engine.input").Where(x => J.Str(x, "request_id", "") == id))
                    m.Inputs.Add(J.Str(ev, "state", "") + " " + J.Num(ev, "call_ms", -1) + " ms");
                if (ended == null) e.Call("stop_all");
                e.Call("config.set", J.Map("section", "engine", "values", J.Map("input_effects", false)));
            }
            else { Thread.Sleep(hold + 1000); m.Started = m.Req; m.ExitAt = m.Req + (long)((hold - 500) / 1000.0 * Freq); m.Ended = m.Req + (long)((hold + 1000) / 1000.0 * Freq); }
            Thread.Sleep(2000);
            m.After = Stopwatch.GetTimestamp();
            return m;
        }

        static string Report(string title, List<long> frames, List<Mark> marks, List<object> json)
        {
            var sb = new StringBuilder();
            sb.AppendLine(title + " (" + frames.Count + " images) — par phase : i/s · médiane · p99 · max · à-coups · pire 250 ms");
            var baseMark = marks.FirstOrDefault(x => x.Method == "base");
            double refMs = baseMark != null ? BenchStats.Summarize("ref", frames, Freq, baseMark.Req, baseMark.Ended, -1).MedianMs : -1;
            long entry = (long)(1.2 * Freq), tail = Freq / 4;
            foreach (var m in marks)
            {
                if (m.Started < 0) { sb.AppendLine("  " + m.Method + " : l'effet n'a pas démarré"); continue; }
                var phases = new[]
                {
                    BenchStats.Summarize("avant", frames, Freq, m.Before, m.Req, refMs),
                    BenchStats.Summarize("entrée", frames, Freq, m.Req, m.Started + entry, refMs),
                    BenchStats.Summarize("pendant", frames, Freq, m.Started + entry, Math.Max(m.Started + entry + 1, m.ExitAt), refMs),
                    BenchStats.Summarize("sortie", frames, Freq, m.ExitAt, m.Ended + tail, refMs),
                    BenchStats.Summarize("après", frames, Freq, m.Ended + tail, m.After, refMs),
                };
                sb.AppendLine("  " + m.Method + (m.Inputs.Count > 0 ? " (bascules : " + string.Join(", ", m.Inputs) + ")" : ""));
                foreach (var p in phases)
                    sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "    {0,-8} {1,6:0.0} i/s · {2,5:0.00} ms · {3,6:0.00} ms · {4,6:0.0} ms · {5,3} · {6,6:0.0} i/s",
                        p.Name, p.Fps, p.MedianMs, p.P99Ms, p.MaxMs, p.Hitches, p.WorstWindowFps));
                json.Add(J.Map("source", title, "method", m.Method, "phases", phases.Select(p => (object)p.ToJson()).ToArray()));
            }
            return sb.ToString();
        }
    }
}
