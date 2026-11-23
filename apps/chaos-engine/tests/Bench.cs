// Banc de performances du moteur Chaos (docs/chaos/PERFORMANCES_MOTEUR.md).
// Un « jeu témoin » (fenêtre Direct3D flip model, cadence visée, charge GPU réglable, chaque image horodatée) tourne
// sur un écran ; le banc enchaîne des scénarios et mesure, phase par phase (avant, entrée, pendant, sortie, après) :
//   - le jeu témoin : cadence, durée des images (médiane, p99, max), à-coups, pire fenêtre de 250 ms, temps GPU ;
//   - le temps GPU (moteur 3D de l'adaptateur) du moteur, du témoin et du compositeur de Windows (dwm.exe) ;
//   - le CPU du moteur et du témoin ; la télémétrie interne du moteur (capture, rendu, Present, latence estimée).
// Scénarios :
//   aucun        A. aucun moteur Chaos            repos        B. moteur lancé, aucun effet
//   flip-coupe   C. retournement sans animation   flip-anime   D. retournement animé (entrée et sortie lentes)
//   passes       E. retournement + 4 passes GPU   calque       F. calque simple sans capture (diag.marker)
//   flip-ecran   retournement de l'écran entier (calque, mode C)
//   flip-windows retournement par Windows (EXPÉRIMENTAL, bascule d'orientation : jamais dans la liste par défaut)
// VISIBLE : refuse de tourner si un jeu ou une application plein écran est actif, sauf --autorise-pendant-un-jeu
// (accord d'Antoni). Jamais lancé par les contrôles automatiques.
// Usage : chaos-bench.exe [--screen \\.\DISPLAY2] [--scenarios aucun,repos,flip-coupe,flip-anime,passes,calque]
//                         [--probe-screen same|other (témoin sur l'autre écran : scénario de l'incident du 22/11)]
//                         [--probe-size 1280x720|full] [--probe-fps 240 (0 = sans limite)] [--probe-load 0]
//                         [--hold-ms 8000] [--anim-ms 3000] [--label texte] [--out <fichier.json>]
//                         [--engine <ChaosEngine.exe>] (comparer deux versions avec le même banc)
//                         [--set performance.zero_copy=false,performance.profile=economie] (réglages du moteur)
//                         [--presentmon <PresentMon.exe> --process <jeu.exe>] [--autorise-pendant-un-jeu]
// Vrai jeu (procédure Overwatch, docs/chaos/PERFORMANCES_MOTEUR.md § 9) : --game Overwatch.exe --presentmon <exe>
//   --autorise-pendant-un-jeu → pas de témoin ; les effets visent la fenêtre du jeu ; cadence et mode de présentation
//   du jeu par phase, relevés par PresentMon (droits : administrateur ou groupe « Utilisateurs du journal de performances »).
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

    /// Temps GPU cumulé (moteur 3D de l'adaptateur) par processus, lu dans les compteurs « GPU Engine » de Windows
    /// (sans droits d'administrateur). Running Time : unités de 100 ns.
    sealed class GpuTimes : IDisposable
    {
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhOpenQueryW(string src, IntPtr user, out IntPtr q);
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhAddEnglishCounterW(IntPtr q, string path, IntPtr user, out IntPtr c);
        [DllImport("pdh.dll")] static extern int PdhCollectQueryData(IntPtr q);
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhGetRawCounterArrayW(IntPtr c, ref uint size, out uint count, IntPtr buf);
        [DllImport("pdh.dll")] static extern int PdhCloseQuery(IntPtr q);
        IntPtr q, c;
        readonly string luid;
        public double LastCollectMs;
        public bool Ok { get { return c != IntPtr.Zero; } }

        public GpuTimes(string luid)
        {
            this.luid = luid.ToLowerInvariant();
            if (PdhOpenQueryW(null, IntPtr.Zero, out q) != 0) { q = IntPtr.Zero; return; }
            if (PdhAddEnglishCounterW(q, @"\GPU Engine(*engtype_3D)\Running Time", IntPtr.Zero, out c) != 0) c = IntPtr.Zero;
        }

        /// pid → temps GPU cumulé (ms) sur l'adaptateur du moteur.
        public Dictionary<int, double> Sample()
        {
            var r = new Dictionary<int, double>();
            if (!Ok) return r;
            var sw = Stopwatch.StartNew();
            PdhCollectQueryData(q);
            uint size = 0, count;
            PdhGetRawCounterArrayW(c, ref size, out count, IntPtr.Zero);
            if (size == 0) return r;
            IntPtr buf = Marshal.AllocHGlobal((int)size);
            try
            {
                if (PdhGetRawCounterArrayW(c, ref size, out count, buf) != 0) return r;
                for (int i = 0; i < count; i++)
                {
                    // PDH_RAW_COUNTER_ITEM_W : nom (pointeur) + PDH_RAW_COUNTER (CStatus, TimeStamp, FirstValue à +16…) = 48 octets
                    IntPtr item = new IntPtr(buf.ToInt64() + i * 48L);
                    string name = Marshal.PtrToStringUni(Marshal.ReadIntPtr(item));
                    if (name == null || name.ToLowerInvariant().IndexOf(luid, StringComparison.Ordinal) < 0) continue;
                    int a = name.IndexOf("pid_", StringComparison.Ordinal), b = a < 0 ? -1 : name.IndexOf('_', a + 4);
                    int pid;
                    if (b < 0 || !int.TryParse(name.Substring(a + 4, b - a - 4), out pid)) continue;
                    double ms = Marshal.ReadInt64(item, 8 + 16) / 10000.0;
                    double cur; r.TryGetValue(pid, out cur); r[pid] = cur + ms;
                }
            }
            finally { Marshal.FreeHGlobal(buf); }
            LastCollectMs = sw.Elapsed.TotalMilliseconds;
            return r;
        }

        public void Dispose() { if (q != IntPtr.Zero) { PdhCloseQuery(q); q = IntPtr.Zero; c = IntPtr.Zero; } }
    }

    static class Bench
    {
        [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);
        static WndProc probeProc;
        static readonly long Freq = Stopwatch.Frequency;
        static string Arg(string[] a, string k, string d) { int i = Array.IndexOf(a, k); return i >= 0 && i + 1 < a.Length ? a[i + 1] : d; }
        static double Ms(long ticks) { return ticks * 1000.0 / Freq; }

        static int Main(string[] args)
        {
            N.SetProcessDpiAwarenessContext(new IntPtr(-4));
            Console.OutputEncoding = Encoding.UTF8;
            if (args.Length > 0 && args[0] == "--cursor-proto") return CursorProto.Run(args);
            if (args.Length > 0 && args[0] == "--cursor-demo") return CursorDemo.Run(args);
            if (args.Length > 0 && args[0] == "--cursor-selftest") return CursorDemo.SelfTest();
            if (args.Length > 0 && args[0] == "--cursor-guard") return CursorDemo.Guard(int.Parse(args[1]));
            if (args.Length > 0 && args[0] == "--cursor-hide-child") return CursorProto.Child();
            if (args.Length > 0 && args[0] == "--obs-compat")
                return CaptureCompat.Run(args, Path.GetFullPath(Arg(args, "--engine", Path.Combine(Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName), "ChaosEngine.exe"))));
            if (args.Length > 0 && args[0] == "--probe")
                return Probe(args[1], args[2], int.Parse(args[3]), int.Parse(args[4]), int.Parse(args[5]), int.Parse(args[6]));
            return Run(args);
        }

        // ---------- Jeu témoin ----------
        /// Fenêtre Direct3D (FLIP_DISCARD, Present(0) comme un jeu sans synchro verticale), pw×ph centrée (0 = écran
        /// entier), load passes de « charge » (24 échantillons par pixel) par image pour simuler un jeu limité par le GPU.
        static int Probe(string device, string prefix, int fps, int pw, int ph, int load)
        {
            timeBeginPeriod(1);
            IntPtr hmon = N.MonitorByDevice(device);
            RECT r = N.MonitorRectOf(hmon);
            int mw = r.Right - r.Left, mh = r.Bottom - r.Top;
            int w = pw > 0 ? Math.Min(pw, mw) : mw, h = ph > 0 ? Math.Min(ph, mh) : mh;
            int x = r.Left + (mw - w) / 2, y = r.Top + (mh - h) / 2;
            probeProc = (hh, m, wp, lp) => N.DefWindowProcW(hh, m, wp, lp);
            var wc = new WNDCLASSEX { cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX)), lpfnWndProc = Marshal.GetFunctionPointerForDelegate(probeProc), hInstance = N.GetModuleHandleW(IntPtr.Zero), lpszClassName = "RaptoruChaosProbe" };
            N.RegisterClassExW(ref wc);
            IntPtr hwnd = N.CreateWindowExW(0, "RaptoruChaosProbe", "Jeu témoin Chaos", N.WS_POPUP | 0x10000000 /* WS_VISIBLE */, x, y, w, h, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
            ShaderLibrary.Register("bench_load", @"
float4 ps(V i) : SV_Target {
  float3 acc = 0;
  [unroll] for (int k = 0; k < 24; k++) { float a = k * 0.2618 + misc.x; acc += src.SampleLevel(smp, i.uv + float2(cos(a), sin(a)) * 0.01 * (1 + k % 4), 0).rgb; }
  return float4(acc / 24, 1);
}");
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
            Console.WriteLine(J.Write(J.Map("probe", "ready", "hwnd", hwnd.ToInt64(), "width", w, "height", h, "pid", Process.GetCurrentProcess().Id)));
            var frames = new List<long>(1 << 20);
            var gpuSamples = new List<string>(1 << 18);
            long interval = fps > 0 ? Freq / fps : 0, next = Stopwatch.GetTimestamp();
            var clock = Stopwatch.StartNew();
            var noFilter = new float[0];
            while (!stop && clock.Elapsed.TotalMinutes < 15)
            {
                MSG m;
                while (N.PeekMessageW(out m, IntPtr.Zero, 0, 0, N.PM_REMOVE)) { N.TranslateMessage(ref m); N.DispatchMessageW(ref m); }
                var fb = new FrameBuilder((uint)w, (uint)h, true);
                fb.Transform(clock.Elapsed.TotalSeconds, 1.2, 1.2, 0, 0, "black");
                for (int i = 0; i < load; i++) fb.Filter("bench_load", noFilter);
                timer.Begin("frame");
                fb.Execute(gpu, lib, pool, null, srv, rtv, clock.ElapsedMilliseconds, (float)clock.Elapsed.TotalSeconds);
                timer.End();
                present(sc, 0, 0);
                long t = Stopwatch.GetTimestamp();
                frames.Add(t);
                timer.Collect((l, ms) => gpuSamples.Add(t.ToString(CultureInfo.InvariantCulture) + " " + ms.ToString("0.000", CultureInfo.InvariantCulture)));
                if (interval == 0) continue;
                // Limiteur de cadence, comme beaucoup de jeux : l'attente ne compte pas dans les à-coups.
                next += interval;
                long now = Stopwatch.GetTimestamp();
                if (next < now - interval) next = now;
                while ((now = Stopwatch.GetTimestamp()) < next) { if (next - now > Freq / 500) Thread.Sleep(1); else Thread.SpinWait(64); }
            }
            File.WriteAllLines(prefix + ".frames", frames.Select(f => f.ToString(CultureInfo.InvariantCulture)));
            File.WriteAllLines(prefix + ".gpu", gpuSamples);
            Console.WriteLine(J.Write(J.Map("probe", "done", "frames", frames.Count)));
            return 0;
        }

        // ---------- Banc ----------
        static readonly string[] PhaseNames = { "avant", "entrée", "pendant", "sortie", "après" };

        /// Un scénario : 6 bornes (QPC et horloge du banc) découpant 5 phases, relevés GPU et CPU à chaque borne.
        sealed class Mark
        {
            public string Scenario, Error;
            public EngineProc E;
            public int EnginePid;
            public readonly List<long> Qpc = new List<long>();
            public readonly List<long> ClockMs = new List<long>();
            public readonly List<Dictionary<int, double>> Gpu = new List<Dictionary<int, double>>();
            public readonly List<double> EngineCpu = new List<double>(), ProbeCpu = new List<double>();
            public long StartupMs = -1, ActivationMs = -1, StopMs = -1;
            public readonly List<string> Inputs = new List<string>();
        }

        sealed class Ctx
        {
            public string Dev, ProbeDev;
            public bool Game;
            public long ProbeHwnd;
            public int ProbePid, Hold, AnimMs, DwmPid;
            public Process ProbeProc;
            public EngineProc Engine;
            public string EngineExe, Dir;
            public List<KeyValuePair<string, object>> Sets = new List<KeyValuePair<string, object>>();
            public GpuTimes Gpu;
        }

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
            var x = new Ctx();
            x.Dev = Arg(a, "--screen", screens.FirstOrDefault(s => s != primary));
            if (x.Dev == null) { Console.WriteLine("Un seul écran : préciser --screen."); return 2; }
            x.ProbeDev = Arg(a, "--probe-screen", "same") == "other" ? screens.FirstOrDefault(s => s != x.Dev) ?? x.Dev : x.Dev;
            string gameExe = Arg(a, "--game", null);
            if (gameExe != null && !a.Contains("--autorise-pendant-un-jeu")) { Console.WriteLine("--game exige --autorise-pendant-un-jeu (accord d'Antoni : le banc applique des effets au jeu)."); return 2; }
            var scenarios = Arg(a, "--scenarios", gameExe != null ? "repos,flip-coupe,flip-anime,repos" : "aucun,repos,flip-coupe,flip-anime,passes,calque").Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
            x.Hold = int.Parse(Arg(a, "--hold-ms", "8000"));
            x.AnimMs = int.Parse(Arg(a, "--anim-ms", "3000"));
            int fps = int.Parse(Arg(a, "--probe-fps", "240")), load = int.Parse(Arg(a, "--probe-load", "0"));
            string size = Arg(a, "--probe-size", "1280x720");
            int pw = 0, ph = 0;
            if (size != "full") { var p = size.Split('x'); pw = int.Parse(p[0]); ph = int.Parse(p[1]); }
            x.Dir = Path.Combine(Path.GetTempPath(), "chaos-bench-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            Directory.CreateDirectory(x.Dir);
            string self = Process.GetCurrentProcess().MainModule.FileName;
            x.EngineExe = Path.GetFullPath(Arg(a, "--engine", Path.Combine(Path.GetDirectoryName(self), "ChaosEngine.exe")));
            foreach (var kv in Arg(a, "--set", "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var parts = kv.Split('=');
                double d; bool bo;
                object v = bool.TryParse(parts[1], out bo) ? (object)bo : double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out d) ? (object)d : parts[1];
                x.Sets.Add(new KeyValuePair<string, object>(parts[0], v));
            }
            int hz = N.RefreshHz(N.MonitorByDevice(x.Dev));
            Console.WriteLine("Banc Chaos : effets écran entier sur " + x.Dev + " (" + hz + " Hz), jeu témoin sur " + x.ProbeDev + ", " + size + " à " + (fps > 0 ? fps + " i/s visées" : "cadence libre") +
                ", charge " + load + " ; scénarios " + string.Join(", ", scenarios));

            var adapterGpu = new Gpu();
            DXGI_ADAPTER_DESC ad = AdapterDesc(adapterGpu);
            x.Gpu = new GpuTimes("luid_0x" + ad.LuidHigh.ToString("x8") + "_0x" + ad.LuidLow.ToString("x8"));
            x.DwmPid = Process.GetProcessesByName("dwm").Select(p => p.Id).FirstOrDefault();

            string prefix = Path.Combine(x.Dir, "probe");
            Dictionary<string, object> hello;
            string pmProc = Arg(a, "--process", null);
            if (gameExe != null)
            {
                // Vrai jeu : sa fenêtre principale devient la cible des effets « fenêtre » ; ses images viennent de PresentMon.
                var gp = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(gameExe)).FirstOrDefault(pr => pr.MainWindowHandle != IntPtr.Zero);
                if (gp == null) { Console.WriteLine("Jeu introuvable (fenêtre principale) : " + gameExe); return 2; }
                x.Game = true; x.ProbeProc = gp; x.ProbePid = gp.Id; x.ProbeHwnd = gp.MainWindowHandle.ToInt64();
                RECT gr = N.FrameBounds(gp.MainWindowHandle);
                hello = J.Map("width", gr.Right - gr.Left, "height", gr.Bottom - gr.Top);
                if (pmProc == null) pmProc = Path.GetFileName(gameExe);
            }
            else
            {
                x.ProbeProc = Process.Start(new ProcessStartInfo(self, "--probe " + x.ProbeDev + " \"" + prefix + "\" " + fps + " " + pw + " " + ph + " " + load)
                { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, CreateNoWindow = true });
                hello = J.Parse(x.ProbeProc.StandardOutput.ReadLine());
                x.ProbeHwnd = (long)J.Num(hello, "hwnd", 0);
                x.ProbePid = x.ProbeProc.Id;
            }
            Process pm = null;
            long pmStart = 0;
            string pmCsv = Path.Combine(x.Dir, "presentmon.csv");
            if (Arg(a, "--presentmon", null) != null && pmProc != null)
            {
                pmStart = Stopwatch.GetTimestamp();
                // Session nommée, et toute session restée ouverte par un banc précédent est arrêtée d'abord.
                pm = Process.Start(new ProcessStartInfo(Arg(a, "--presentmon", null), "--process_name " + pmProc + " --output_file \"" + pmCsv +
                    "\" --qpc_time --no_console_stats --session_name RaptoruChaos --stop_existing_session")
                { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true });
            }
            else if (x.Game) Console.WriteLine("Sans PresentMon (--presentmon), seuls le GPU et le CPU du jeu sont relevés.");
            var marks = new List<Mark>();
            try
            {
                Thread.Sleep(2500); // le témoin (ou PresentMon) se stabilise
                foreach (var s in scenarios)
                {
                    string g = N.GameActivity();
                    // Garde revérifiée avant chaque scénario : jeu ou plein écran apparu → le banc s'arrête là.
                    if (g != null && !a.Contains("--autorise-pendant-un-jeu")) { Console.WriteLine("Arrêt : " + g); break; }
                    Console.WriteLine("  … " + s);
                    marks.Add(RunScenario(x, s));
                }
            }
            finally
            {
                StopEngine(x);
                if (!x.Game) try { x.ProbeProc.StandardInput.WriteLine("stop"); x.ProbeProc.WaitForExit(8000); } catch (Exception) { }
                if (pm != null) try { pm.Kill(); pm.WaitForExit(3000); } catch (Exception) { }
                if (N.DisplayOrientation(x.Dev) != 0) N.ResetDisplaySettings(x.Dev, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero);
                x.Gpu.Dispose();
            }
            List<BenchStats.PresentRow> pmRows = null;
            List<long> pmFrames = null;
            bool isQpc = false;
            if (pm != null && File.Exists(pmCsv))
            {
                pmRows = BenchStats.ParsePresentMon(File.ReadAllText(pmCsv), pmProc, out isQpc);
                long start = pmStart;
                bool q = isQpc;
                pmFrames = pmRows.Select(r => q ? (long)r.Time : start + (long)(r.Time * Freq)).ToList();
            }
            var frames = x.Game ? (pmFrames ?? new List<long>()) : ReadLongs(prefix + ".frames");
            var gpuFrames = File.Exists(prefix + ".gpu") ? File.ReadAllLines(prefix + ".gpu").Select(l => l.Split(' ')).Where(p => p.Length == 2)
                .Select(p => new KeyValuePair<long, double>(long.Parse(p[0], CultureInfo.InvariantCulture), double.Parse(p[1], CultureInfo.InvariantCulture))).ToList()
                : new List<KeyValuePair<long, double>>();
            var refMark = marks.FirstOrDefault(m => m.Scenario == "aucun" && m.Error == null) ?? marks.FirstOrDefault(m => m.Error == null);
            double refMs = refMark != null ? BenchStats.Summarize("ref", frames, Freq, refMark.Qpc[0], refMark.Qpc[5], -1).MedianMs : -1;
            var sb = new StringBuilder();
            sb.AppendLine((x.Game ? "Jeu " + gameExe + " (PresentMon)" : "Jeu témoin") + " (" + frames.Count + " images, médiane de référence " + refMs.ToString("0.00", CultureInfo.InvariantCulture) + " ms)");
            sb.AppendLine("  phase       i/s   méd.    p99    max à-c. pire250 | GPU témoin p50  p99 | GPU % moteur   dwm  témoin | CPU % moteur");
            var report = marks.Select(m => (object)Describe(m, x, frames, gpuFrames, refMs, sb)).ToArray();
            Console.WriteLine(sb.ToString());
            if (pmRows != null)
            {
                var rows = pmRows;
                var psb = new StringBuilder("PresentMon " + pmProc + (isQpc ? "" : " (horloge approchée)") + "\n");
                foreach (var m in marks.Where(mm => mm.Error == null))
                {
                    psb.AppendLine("  " + m.Scenario);
                    for (int i = 0; i < 5; i++)
                    {
                        var p = BenchStats.Summarize(PhaseNames[i], pmFrames, Freq, m.Qpc[i], m.Qpc[i + 1], -1);
                        long from = m.Qpc[i], to = m.Qpc[i + 1];
                        var modes = rows.Where((r, k) => pmFrames[k] >= from && pmFrames[k] < to).GroupBy(r => r.Mode).Select(gm => gm.Key + " " + gm.Count());
                        psb.AppendLine(string.Format(CultureInfo.InvariantCulture, "    {0,-8} {1,6:0.0} i/s · {2,5:0.00} ms · p99 {3,6:0.00} ms · max {4,6:0.0} ms · {5} à-coups · {6}", p.Name, p.Fps, p.MedianMs, p.P99Ms, p.MaxMs, p.Hitches, string.Join(", ", modes)));
                    }
                }
                psb.AppendLine("  modes de présentation : " + string.Join(", ", rows.GroupBy(r => r.Mode).Select(gr => gr.Key + " " + gr.Count())));
                Console.WriteLine(psb.ToString());
            }
            string outFile = Arg(a, "--out", Path.Combine(x.Dir, "bench.json"));
            File.WriteAllText(outFile, J.Write(J.Map("label", Arg(a, "--label", ""), "date", DateTime.Now.ToString("s"), "engine_version", EngineVersion(x.EngineExe),
                "engine", x.EngineExe, "settings", x.Sets.Select(kv => kv.Key + "=" + kv.Value).ToArray(),
                "screen", x.Dev, "probe_screen", x.ProbeDev, "probe_refresh_hz", N.RefreshHz(N.MonitorByDevice(x.ProbeDev)), "refresh_hz", hz, "adapter", adapterGpu.Adapter, "gpu_counters", x.Gpu.Ok,
                "game", gameExe, "probe", J.Map("size", size, "fps", fps, "load", load, "width", J.Num(hello, "width", 0), "height", J.Num(hello, "height", 0)),
                "hold_ms", x.Hold, "anim_ms", x.AnimMs, "pdh_collect_ms", Math.Round(x.Gpu.LastCollectMs, 1), "scenarios", report)));
            Console.WriteLine("Résultats : " + outFile);
            return 0;
        }

        static string EngineVersion(string exe)
        {
            try
            {
                var p = Process.Start(new ProcessStartInfo(exe, "--version") { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true });
                string v = p.StandardOutput.ReadToEnd().Trim(); p.WaitForExit(3000); return v;
            }
            catch (Exception) { return "?"; }
        }

        static DXGI_ADAPTER_DESC AdapterDesc(Gpu g)
        {
            IntPtr adapter; DXGI_ADAPTER_DESC ad = new DXGI_ADAPTER_DESC();
            if (Com.Fn<DxgiDevGetAdapter>(g.DxgiDevice, 7)(g.DxgiDevice, out adapter) >= 0) { Com.Fn<AdapterGetDesc>(adapter, 8)(adapter, out ad); Marshal.Release(adapter); }
            return ad;
        }

        static List<long> ReadLongs(string f)
        {
            return File.Exists(f) ? File.ReadAllLines(f).Select(l => long.Parse(l, CultureInfo.InvariantCulture)).ToList() : new List<long>();
        }

        // ---------- Moteur ----------
        static void EnsureEngine(Ctx x)
        {
            if (x.Engine != null && !x.Engine.P.HasExited) return;
            x.Engine = EngineProc.Start(x.EngineExe, "--serve --state-dir \"" + Path.Combine(x.Dir, "engine") + "\" --heartbeat-ms 3000");
            if (x.Engine.Event("engine.ready", 10000) == null) throw new Exception("moteur non prêt");
            x.Engine.Pings(500);
            x.Engine.Call("config.set", J.Map("section", "engine", "values", J.Map("telemetry_interval_ms", 500, "input_effects", false)));
            foreach (var kv in x.Sets)
            {
                var sec = kv.Key.Split('.');
                var r = x.Engine.Call("config.set", J.Map("section", sec[0], "values", J.Map(sec[1], kv.Value)));
                if (r == null || J.Has(r, "error")) throw new Exception("réglage refusé : " + kv.Key + " (" + (r != null ? J.Write(r["error"]) : "pas de réponse") + ")");
            }
            Thread.Sleep(1500); // fin du démarrage (gardien, premières mesures)
        }

        static void StopEngine(Ctx x)
        {
            if (x.Engine == null) return;
            try { x.Engine.Call("stop_all"); x.Engine.Send("shutdown"); x.Engine.P.WaitForExit(3000); } catch (Exception) { }
            x.Engine.Kill();
            x.Engine = null;
        }

        static double CpuMs(Process p)
        {
            try { p.Refresh(); return p.HasExited ? -1 : p.TotalProcessorTime.TotalMilliseconds; } catch (Exception) { return -1; }
        }

        static void Boundary(Ctx x, Mark m)
        {
            m.Qpc.Add(Stopwatch.GetTimestamp());
            m.ClockMs.Add(EngineProc.Clock.ElapsedMilliseconds);
            m.Gpu.Add(x.Gpu.Sample());
            m.EngineCpu.Add(m.E != null ? CpuMs(m.E.P) : -1);
            m.ProbeCpu.Add(CpuMs(x.ProbeProc));
        }

        static void SleepUntil(long qpc) { long now; while ((now = Stopwatch.GetTimestamp()) < qpc) Thread.Sleep((int)Math.Max(1, Math.Min(50, Ms(qpc - now)))); }

        static Mark RunScenario(Ctx x, string s)
        {
            var m = new Mark { Scenario = s };
            try
            {
                if (s == "aucun") StopEngine(x); else EnsureEngine(x);
                m.E = x.Engine;
                m.EnginePid = m.E != null ? m.E.P.Id : 0;
                Dictionary<string, object> req = null;
                bool animated = s == "flip-anime" || s == "flip-windows";
                var cut = J.Map("in", J.Map("kind", "cut"), "out", J.Map("kind", "cut"));
                var anim = J.Map("in", J.Map("kind", "ramp", "duration_ms", x.AnimMs), "out", J.Map("kind", "ramp", "duration_ms", x.AnimMs));
                var window = J.Map("kind", "window", "hwnd", x.ProbeHwnd, "follow_foreground", false);
                var monitor = J.Map("kind", "monitor", "device", x.Dev);
                switch (s)
                {
                    case "flip-coupe": case "passes": req = J.Map("effect", "flip", "target", window, "transition", cut); break;
                    case "flip-anime": req = J.Map("effect", "flip", "target", window, "transition", anim); break;
                    case "calque": req = J.Map("effect", "diag.marker", "target", window, "transition", cut); break;
                    case "flip-ecran": req = J.Map("effect", "flip", "target", monitor, "transition", cut); break;
                    case "flip-windows": req = J.Map("effect", "flip", "target", monitor); break;
                    case "aucun": case "repos": break;
                    default: m.Error = "scénario inconnu"; return m;
                }
                string id = "bench-" + s;
                int holdMs = animated ? Math.Max(x.Hold, x.AnimMs + 5000) : x.Hold;
                int durMs = Math.Min(30000, holdMs + x.AnimMs + 8000); // l'arrêt vient du banc (mesure du temps d'arrêt)
                Boundary(x, m);                                   // b0 : avant
                Thread.Sleep(2000);
                Boundary(x, m);                                   // b1 : demande
                long reqAt = m.Qpc[1];
                if (req != null)
                {
                    if (s == "flip-windows") x.Engine.Call("config.set", J.Map("section", "engine", "values", J.Map("input_effects", true)));
                    req["request_id"] = id; req["source"] = J.Map("kind", "test"); req["duration_ms"] = durMs;
                    x.Engine.Call("effect.request", req);
                    if (s == "passes")
                        x.Engine.Call("effect.request", J.Map("request_id", id + "-p", "effect", "diag.passes", "source", J.Map("kind", "test"), "target", window,
                            "transition", cut, "duration_ms", durMs, "params", J.Map("passes", 4, "taps", 12)));
                    var started = x.Engine.Event("effect.started", 6000, e => J.Str(e, "request_id", "") == id);
                    if (started == null) { m.Error = "l'effet n'a pas démarré"; x.Engine.Call("stop_all"); return m; }
                    m.ActivationMs = (long)Ms(Stopwatch.GetTimestamp() - reqAt);
                    m.StartupMs = (long)J.Num(started, "startup_ms", -1);
                    SleepUntil(Stopwatch.GetTimestamp() + (long)((animated ? x.AnimMs : 0) + 300) * Freq / 1000);
                }
                else Thread.Sleep(1000);
                Boundary(x, m);                                   // b2 : fin de l'entrée
                SleepUntil(reqAt + (long)holdMs * Freq / 1000);
                Boundary(x, m);                                   // b3 : demande d'arrêt
                long stopAt = m.Qpc[3];
                if (req != null)
                {
                    x.Engine.Call("effect.cancel", J.Map("request_id", id, "immediate", !animated));
                    if (s == "passes") x.Engine.Call("effect.cancel", J.Map("request_id", id + "-p", "immediate", true));
                    var ended = x.Engine.Event("effect.ended", x.AnimMs + 8000, e => J.Str(e, "request_id", "") == id);
                    m.StopMs = ended != null ? (long)Ms(Stopwatch.GetTimestamp() - stopAt) : -1;
                    foreach (var ev in x.Engine.Events("engine.input").Where(e => J.Str(e, "request_id", "") == id))
                        m.Inputs.Add(J.Str(ev, "state", "") + " " + J.Num(ev, "call_ms", -1) + " ms");
                    if (s == "flip-windows") x.Engine.Call("config.set", J.Map("section", "engine", "values", J.Map("input_effects", false)));
                    Thread.Sleep(300);
                }
                else Thread.Sleep(1000);
                Boundary(x, m);                                   // b4 : fin de la sortie
                Thread.Sleep(2000);
                Boundary(x, m);                                   // b5 : fin
            }
            catch (Exception e) { m.Error = e.Message; }
            return m;
        }

        // ---------- Rapport ----------
        static double GpuPct(Mark m, int i, int pid)
        {
            double a, b;
            if (pid <= 0 || !m.Gpu[i].TryGetValue(pid, out a) || !m.Gpu[i + 1].TryGetValue(pid, out b)) return -1;
            return Math.Round((b - a) / Ms(m.Qpc[i + 1] - m.Qpc[i]) * 100, 2);
        }

        /// CPU d'un processus pendant la phase, en % d'un cœur.
        static double CpuPct(List<double> cpu, Mark m, int i)
        {
            if (cpu[i] < 0 || cpu[i + 1] < 0) return -1;
            return Math.Round((cpu[i + 1] - cpu[i]) / Ms(m.Qpc[i + 1] - m.Qpc[i]) * 100, 2);
        }

        static readonly string[] SurfaceFields =
        {
            "capture_fps", "present_fps", "processing_p50_ms", "processing_p95_ms", "capture_latency_p50_ms", "capture_latency_p95_ms",
            "present_call_p50_ms", "present_call_p95_ms", "added_latency_est_p50_ms", "added_latency_est_p95_ms", "refresh_hz"
        };

        /// Moyenne des relevés de télémétrie du moteur (intervalle de 500 ms) reçus pendant la phase.
        static Dictionary<string, object> EngineTelemetry(Mark m, int i)
        {
            if (m.E == null) return null;
            var evs = m.E.Events("engine.telemetry");
            long from = m.ClockMs[i] + 550, to = m.ClockMs[i + 1];
            var inPhase = evs.Where(d => J.Num(d, "_rx", 0) >= from && J.Num(d, "_rx", 0) <= to).ToList();
            if (inPhase.Count == 0) return null;
            var acc = new Dictionary<string, List<double>>();
            Action<string, double> add = (k, v) => { if (v < 0) return; List<double> l; if (!acc.TryGetValue(k, out l)) acc[k] = l = new List<double>(); l.Add(v); };
            foreach (var d in inPhase)
            {
                var surfaces = J.Arr(d, "surfaces");
                var s0 = surfaces.Count > 0 ? surfaces[0] as Dictionary<string, object> : null;
                if (s0 != null) foreach (var f in SurfaceFields) add(f, J.Num(s0, f, -1));
                var proc = J.Obj(d, "process");
                if (proc != null)
                {
                    add("cpu_ms_per_s", J.Num(proc, "cpu_ms_per_s", -1)); add("private_mb", J.Num(proc, "private_mb", -1)); add("managed_mb", J.Num(proc, "managed_mb", -1));
                    add("gc_gen0_per_s", J.Num(J.Obj(proc, "gc"), "gen0", -1) * 2);
                }
                add("vram_mb", J.Num(d, "vram_mb", -1));
                var passes = J.Obj(d, "passes");
                if (passes != null) foreach (var kv in passes) add("gpu:" + kv.Key + ":p50_ms", J.Num(kv.Value as Dictionary<string, object>, "p50_ms", -1));
            }
            return acc.ToDictionary(kv => kv.Key, kv => (object)Math.Round(kv.Value.Average(), 3));
        }

        static Dictionary<string, object> Describe(Mark m, Ctx x, List<long> frames, List<KeyValuePair<long, double>> gpuFrames, double refMs, StringBuilder sb)
        {
            sb.AppendLine("  " + m.Scenario + (m.Error != null ? " : ÉCHEC " + m.Error : "") +
                (m.ActivationMs >= 0 ? " · activation " + m.ActivationMs + " ms (moteur " + m.StartupMs + " ms)" : "") +
                (m.StopMs >= 0 ? " · arrêt " + m.StopMs + " ms" : "") + (m.Inputs.Count > 0 ? " · bascules " + string.Join(", ", m.Inputs) : ""));
            if (m.Error != null || m.Qpc.Count < 6) return J.Map("scenario", m.Scenario, "error", m.Error);
            var phases = new List<object>();
            for (int i = 0; i < 5; i++)
            {
                var p = BenchStats.Summarize(PhaseNames[i], frames, Freq, m.Qpc[i], m.Qpc[i + 1], refMs);
                var g = gpuFrames.Where(kv => kv.Key >= m.Qpc[i] && kv.Key < m.Qpc[i + 1]).Select(kv => kv.Value).OrderBy(v => v).ToList();
                double g50 = BenchStats.Percentile(g, 50), g99 = BenchStats.Percentile(g, 99);
                double ge = GpuPct(m, i, m.EnginePid), gd = GpuPct(m, i, x.DwmPid), gp = GpuPct(m, i, x.ProbePid), ce = CpuPct(m.EngineCpu, m, i);
                sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "    {0,-8} {1,6:0.0} {2,6:0.00} {3,6:0.00} {4,6:0.0} {5,3} {6,7:0.0} | {7,14:0.000} {8,6:0.000} | {9,10:0.00} {10,6:0.00} {11,6:0.00} | {12,6:0.00}",
                    p.Name, p.Fps, p.MedianMs, p.P99Ms, p.MaxMs, p.Hitches, p.WorstWindowFps, g50, g99, ge, gd, gp, ce));
                var j = p.ToJson();
                j["probe_gpu_p50_ms"] = Math.Round(g50, 3); j["probe_gpu_p99_ms"] = Math.Round(g99, 3);
                j["gpu_pct_engine"] = ge; j["gpu_pct_dwm"] = gd; j["gpu_pct_probe"] = gp;
                j["cpu_pct_core_engine"] = ce; j["cpu_pct_core_probe"] = CpuPct(m.ProbeCpu, m, i);
                j["engine"] = EngineTelemetry(m, i);
                phases.Add(j);
            }
            return J.Map("scenario", m.Scenario, "activation_ms", m.ActivationMs, "startup_ms", m.StartupMs, "stop_ms", m.StopMs, "inputs", m.Inputs.ToArray(), "phases", phases.ToArray());
        }
    }
}
