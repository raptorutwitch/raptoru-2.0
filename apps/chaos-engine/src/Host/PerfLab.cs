// Chaos Performance Lab (docs/chaos/PERFORMANCE_LAB.md) : ce que Studio pilote pour mesurer le coût des effets.
//   --sysinfo                     matériel utile (carte graphique, mémoire vidéo, processeur, mémoire, système, écrans)
//   --perf-offscreen [options]    MODE A, banc HORS ÉCRAN : aucune fenêtre, aucune capture, rien d'affiché ; chaque effet
//                                 (et des combinaisons) rendu sur une scène de jeu de synthèse qui bouge, à la résolution
//                                 de l'écran choisi ; temps GPU par image (horodatages), temps CPU de préparation,
//                                 allocations, mémoire vidéo ; référence sans effet. Progression en lignes JSON.
//                                 Refuse de démarrer, et s'arrête, si un jeu ou une application plein écran est actif
//                                 (sauf --smoke : quelques images en très petite taille, pour les tests automatiques).
//   --perf-monitor [options]      MODE B, télémétrie pendant un essai EN JEU déclenché à la main dans Studio : temps GPU
//                                 (moteur 3D) et processeur par processus (moteur Chaos, jeu au premier plan, compositeur
//                                 de Windows, OBS), mémoire ; un échantillon par intervalle. N'agit sur aucun processus.
// Les deux s'arrêtent seuls si le processus parent (Studio) disparaît, ou à leur échéance.
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
    /// Temps GPU cumulé (moteur 3D de l'adaptateur) et mémoire vidéo dédiée, par processus, lus dans les compteurs
    /// « GPU Engine » et « GPU Process Memory » de Windows (sans droits d'administrateur). Running Time : unités de 100 ns.
    sealed class GpuTimes : IDisposable
    {
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhOpenQueryW(string src, IntPtr user, out IntPtr q);
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhAddEnglishCounterW(IntPtr q, string path, IntPtr user, out IntPtr c);
        [DllImport("pdh.dll")] static extern int PdhCollectQueryData(IntPtr q);
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhGetRawCounterArrayW(IntPtr c, ref uint size, out uint count, IntPtr buf);
        [DllImport("pdh.dll")] static extern int PdhCloseQuery(IntPtr q);
        IntPtr q, c, mem;
        readonly string luid;
        public double LastCollectMs;
        public bool Ok { get { return c != IntPtr.Zero; } }

        public GpuTimes(string luid)
        {
            this.luid = luid.ToLowerInvariant();
            if (PdhOpenQueryW(null, IntPtr.Zero, out q) != 0) { q = IntPtr.Zero; return; }
            if (PdhAddEnglishCounterW(q, @"\GPU Engine(*engtype_3D)\Running Time", IntPtr.Zero, out c) != 0) c = IntPtr.Zero;
            if (PdhAddEnglishCounterW(q, @"\GPU Process Memory(*)\Dedicated Usage", IntPtr.Zero, out mem) != 0) mem = IntPtr.Zero;
        }

        public static string LuidOf(Gpu g)
        {
            var ad = g.AdapterDesc();
            return "luid_0x" + ad.LuidHigh.ToString("x8") + "_0x" + ad.LuidLow.ToString("x8");
        }

        /// pid → temps GPU cumulé (ms) sur l'adaptateur du moteur.
        public Dictionary<int, double> Sample()
        {
            var sw = Stopwatch.StartNew();
            if (Ok) PdhCollectQueryData(q);
            var r = Read(c, 10000.0);
            LastCollectMs = sw.Elapsed.TotalMilliseconds;
            return r;
        }

        /// pid → mémoire vidéo dédiée (Mo), relevée lors du dernier Sample.
        public Dictionary<int, double> DedicatedMB() { return Read(mem, 1048576.0); }

        Dictionary<int, double> Read(IntPtr counter, double div)
        {
            var r = new Dictionary<int, double>();
            if (counter == IntPtr.Zero) return r;
            uint size = 0, count;
            PdhGetRawCounterArrayW(counter, ref size, out count, IntPtr.Zero);
            if (size == 0) return r;
            IntPtr buf = Marshal.AllocHGlobal((int)size);
            try
            {
                if (PdhGetRawCounterArrayW(counter, ref size, out count, buf) != 0) return r;
                for (int i = 0; i < count; i++)
                {
                    // PDH_RAW_COUNTER_ITEM_W : nom (pointeur) + PDH_RAW_COUNTER (CStatus, TimeStamp, FirstValue à +16…) = 48 octets
                    IntPtr item = new IntPtr(buf.ToInt64() + i * 48L);
                    string name = Marshal.PtrToStringUni(Marshal.ReadIntPtr(item));
                    if (name == null || name.ToLowerInvariant().IndexOf(luid, StringComparison.Ordinal) < 0) continue;
                    int a = name.IndexOf("pid_", StringComparison.Ordinal), b = a < 0 ? -1 : name.IndexOf('_', a + 4);
                    int pid;
                    if (b < 0 || !int.TryParse(name.Substring(a + 4, b - a - 4), out pid)) continue;
                    double v = Marshal.ReadInt64(item, 8 + 16) / div;
                    double cur; r.TryGetValue(pid, out cur); r[pid] = cur + v;
                }
            }
            finally { Marshal.FreeHGlobal(buf); }
            return r;
        }

        public void Dispose() { if (q != IntPtr.Zero) { PdhCloseQuery(q); q = IntPtr.Zero; c = IntPtr.Zero; mem = IntPtr.Zero; } }
    }

    static class PerfLab
    {
        [StructLayout(LayoutKind.Sequential)]
        struct MEMORYSTATUSEX { public uint Length, MemoryLoad; public ulong TotalPhys, AvailPhys, TotalPageFile, AvailPageFile, TotalVirtual, AvailVirtual, AvailExtendedVirtual; }
        [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);

        static TextWriter outw;
        static void Emit(Dictionary<string, object> o) { outw.WriteLine(J.Write(o)); outw.Flush(); }
        static string Arg(string[] a, string k, string d) { int i = Array.IndexOf(a, k); return i >= 0 && i + 1 < a.Length ? a[i + 1] : d; }
        static int IntArg(string[] a, string k, int d) { int v; return int.TryParse(Arg(a, k, null), out v) ? v : d; }

        static string Reg(string key, string name)
        {
            try { using (var k = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(key)) return k == null ? null : Convert.ToString(k.GetValue(name), CultureInfo.InvariantCulture); }
            catch (Exception) { return null; }
        }

        /// Windows 11 garde « Windows 10 » dans ProductName : le numéro de version (22000 et plus) tranche.
        static string OsName(string product, string build)
        {
            int b;
            return product != null && int.TryParse(build, out b) && b >= 22000 ? product.Replace("Windows 10", "Windows 11") : product;
        }

        /// Matériel et système utiles pour lire un banc (aucune donnée personnelle : ni nom de machine, ni utilisateur).
        public static Dictionary<string, object> SysInfo(Gpu g)
        {
            var ad = g.AdapterDesc();
            var m = new MEMORYSTATUSEX { Length = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX)) };
            bool memOk = GlobalMemoryStatusEx(ref m);
            const string cv = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
            return J.Map(
                "gpu", J.Map("name", (ad.Description ?? "?").Trim(), "vendor_id", "0x" + ad.VendorId.ToString("x4"), "device_id", "0x" + ad.DeviceId.ToString("x4"),
                    "dedicated_vram_mb", Math.Round(ad.DedicatedVideoMemory.ToUInt64() / 1048576.0), "shared_memory_mb", Math.Round(ad.SharedSystemMemory.ToUInt64() / 1048576.0)),
                "cpu", J.Map("name", (Reg(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString") ?? "?").Trim(), "logical_cores", Environment.ProcessorCount),
                "memory_mb", memOk ? (object)Math.Round(m.TotalPhys / 1048576.0) : null,
                "os", J.Map("name", OsName(Reg(cv, "ProductName"), Reg(cv, "CurrentBuild")), "version", Reg(cv, "DisplayVersion"), "build", Reg(cv, "CurrentBuild")),
                "screens", Targets.Monitors().ToArray(),
                "engine", Program.Version);
        }

        public static int SysInfoMain()
        {
            var o = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
            var g = new Gpu();
            o.WriteLine(J.Write(SysInfo(g)));
            return 0;
        }

        /// Arrêt demandé : parent disparu (Studio fermé ou banc annulé) ou échéance dépassée.
        static string Abort(int parent, Stopwatch total, long deadlineMs)
        {
            if (parent > 0) { try { using (var p = Process.GetProcessById(parent)) if (p.HasExited) return "parent_gone"; } catch (Exception) { return "parent_gone"; } }
            if (total.ElapsedMilliseconds > deadlineMs) return "timeout";
            return null;
        }

        sealed class Case { public string Id, Label, Kind; public List<string> Effects = new List<string>(); public string Level; }

        // ---------- MODE A : banc hors écran ----------
        public static int Offscreen(string[] a)
        {
            outw = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = false };
            bool smoke = a.Contains("--smoke");
            int w = smoke ? 160 : IntArg(a, "--w", 2560), h = smoke ? 90 : IntArg(a, "--h", 1440);
            int frames = smoke ? Math.Max(2, Math.Min(2000, IntArg(a, "--frames", 6))) : Math.Max(30, Math.Min(2000, IntArg(a, "--frames", 240)));
            int warm = smoke ? 2 : Math.Max(5, Math.Min(500, IntArg(a, "--warmup", 30)));
            int parent = IntArg(a, "--parent", 0);
            long deadline = IntArg(a, "--deadline-ms", 900000);
            string only = Arg(a, "--effects", null);
            string profile = Arg(a, "--profile", "qualite");
            var total = Stopwatch.StartNew();
            string game = N.GameActivity();
            if (game != null && !smoke)
            {
                Emit(J.Map("type", "error", "code", "game_active", "message", "Un jeu ou une application plein écran est actif (" + game + ") : le banc hors écran chargerait la carte graphique pendant le jeu. Fermer le jeu, puis relancer."));
                return 3;
            }
            if (w < 64 || h < 64 || w > 7680 || h > 4320) { Emit(J.Map("type", "error", "code", "invalid_size", "message", "résolution hors bornes : " + w + "×" + h)); return 2; }
            AppDomain.MonitoringIsEnabled = true;
            var reg = Registry.Embedded();
            Gpu gpu;
            try { gpu = new Gpu(); }
            catch (Exception e) { Emit(J.Map("type", "error", "code", "gpu_init", "message", e.Message)); return 4; }
            var lib = new ShaderLibrary(gpu, null);
            lib.Warm();
            var pool = new TexturePool(gpu);
            var timer = new GpuTimer(gpu);
            var text = new TextRaster(gpu);
            var rig = new Bench3Rig(gpu, (uint)w, (uint)h);
            var perf = PerformanceConfig.For(profile);

            // Plan : référence, chaque effet public (niveau Marqué puis Extrême s'il en a), puis des combinaisons lourdes.
            var cases = new List<Case> { new Case { Id = "reference", Label = "Référence (image recopiée, sans effet)", Kind = "reference" } };
            var pub = reg.Effects.Values.Where(d => !d.Internal && (only == null || only.Split(',').Contains(d.Id))).ToList();
            foreach (var d in pub)
            {
                if (d.Levels.Count == 0) { cases.Add(new Case { Id = d.Id, Label = d.Label, Kind = "effect", Effects = { d.Id } }); continue; }
                foreach (var lv in new[] { "marque", "extreme" })
                    if (d.Level(lv) != null) cases.Add(new Case { Id = d.Id + "@" + lv, Label = d.Label, Kind = "effect", Effects = { d.Id }, Level = lv });
            }
            if (only == null && !smoke)
                foreach (var combo in new[] { "drunk+vhs", "fog+blur", "tunnel+color", "zoom+shake+pixelate", "blur+pixelate+vhs", "drunk+fog+color" })
                    cases.Add(new Case { Id = combo + "@extreme", Label = string.Join(" + ", combo.Split('+').Select(x => reg.Get(x).Label)), Kind = "combo", Effects = combo.Split('+').ToList(), Level = "extreme" });

            Emit(J.Map("type", "start", "mode", "offscreen", "resolution", w + "x" + h, "frames", frames, "warmup", warm, "profile", perf.Profile,
                "render_scale", perf.RenderScale, "cases", cases.Select(c => (object)J.Map("id", c.Id, "label", c.Label, "kind", c.Kind, "level", c.Level)).ToArray(),
                "system", SysInfo(gpu), "smoke", smoke));
            var results = new List<Dictionary<string, object>>();
            double refP50 = -1;
            for (int ci = 0; ci < cases.Count; ci++)
            {
                var cs = cases[ci];
                string why = Abort(parent, total, deadline) ?? (!smoke ? (N.GameActivity() != null ? "game_active" : null) : null);
                if (why != null)
                {
                    Emit(J.Map("type", "error", "code", why, "message", why == "game_active" ? "Un jeu ou une application plein écran vient de démarrer : banc arrêté." : why == "timeout" ? "Échéance du banc dépassée : arrêté." : "Studio ne suit plus le banc : arrêté."));
                    return 5;
                }
                Emit(J.Map("type", "progress", "done", ci, "total", cases.Count, "case", cs.Id, "label", cs.Label));
                Dictionary<string, object> res;
                try { res = RunCase(reg, gpu, lib, pool, timer, text, rig, cs, frames, warm, perf); }
                catch (Exception e) { res = J.Map("status", "failed", "error", e.GetType().Name + " : " + e.Message); }
                res["id"] = cs.Id; res["label"] = cs.Label; res["kind"] = cs.Kind; res["level"] = cs.Level; res["effects"] = cs.Effects.ToArray();
                if (cs.Kind == "reference" && res.ContainsKey("gpu_ms_p50") && res["gpu_ms_p50"] != null) refP50 = Convert.ToDouble(res["gpu_ms_p50"]);
                if (cs.Kind != "reference" && refP50 >= 0 && res.ContainsKey("gpu_ms_p50") && res["gpu_ms_p50"] != null)
                    res["gpu_ms_over_reference"] = Math.Round(Convert.ToDouble(res["gpu_ms_p50"]) - refP50, 3);
                results.Add(res);
                Emit(J.Map("type", "result", "result", res));
            }
            Emit(J.Map("type", "progress", "done", cases.Count, "total", cases.Count));
            Emit(J.Map("type", "end", "ok", true, "elapsed_ms", total.ElapsedMilliseconds, "summary", Summary(results, w, h)));
            return 0;
        }

        /// Une scène de jeu de synthèse qui bouge (panorama balayé), comme les aperçus : reproductible d'un banc à l'autre.
        sealed class Bench3Rig
        {
            public readonly IntPtr Src, SrcSrv, Out, OutRtv, Big;
            readonly Gpu g; readonly uint w, h;
            public Bench3Rig(Gpu gpu, uint w, uint h)
            {
                g = gpu; this.w = w; this.h = h;
                Src = g.Texture(w, h, 0, 0x8 | 0x20, 0x1, 0, 0); SrcSrv = g.Srv(Src);
                Big = g.TextureWithData(w * 3 / 2, h, EffectPreview.Scene((int)(w * 3 / 2), (int)h));
                Out = g.Texture(w, h, 1, 0x8 | 0x20, 0, 0, 0); OutRtv = g.Rtv(Out);
            }
            /// Nouvelle « capture » : la caméra avance (comme une image de jeu fraîche, mipmaps à refaire si lus).
            public void Pan(long t) { g.Copy(Src, Big, (uint)Math.Round((0.5 - 0.5 * Math.Cos(t / 8000.0 * 2 * Math.PI)) * (w / 2)), 0, w, h); }
        }

        static Dictionary<string, object> RunCase(Registry reg, Gpu gpu, ShaderLibrary lib, TexturePool pool, GpuTimer timer, TextRaster text, Bench3Rig rig,
            Case cs, int frames, int warm, PerformanceConfig perf)
        {
            var sims = new List<KeyValuePair<Effect, ResolvedParams>>();
            var limits = reg.Limits;
            var safety = new SafetyConfig { MaxDurationMs = limits.MaxDurationMs };
            foreach (var id in cs.Effects)
            {
                var def = reg.Get(id);
                string variant = null;
                object pv;
                var viewer = def.Raw.TryGetValue("viewer", out pv) ? pv as Dictionary<string, object> : null;
                if (viewer != null) variant = J.Str(viewer, "preview", null);
                var P = Params.Resolve(def, variant, null, null, null, null, limits, safety, true, cs.Level != null && def.Level(cs.Level) != null ? cs.Level : null);
                var fx = EffectCatalog.Create(id);
                fx.Prepare(new EffectContext { Gpu = gpu, Shaders = lib, Text = text, P = P, Seed = 777 });
                fx.Start();
                sims.Add(new KeyValuePair<Effect, ResolvedParams>(fx, P));
            }
            sims.Sort((x, y) => x.Value.Def.Order.CompareTo(y.Value.Def.Order));
            D3D11_TEXTURE2D_DESC od; Com.Fn<TexGetDesc>(rig.Out, 10)(rig.Out, out od);
            uint W = od.Width, H = od.Height;
            var fb = new FrameBuilder(W, H, true);
            var frame = new EffectFrame { Seed = 777, Width = W, Height = H, Presence = 1 };
            var gpuMs = new Samples(); var cpuMs = new Samples();
            Action<string, double> add = (l, ms) => gpuMs.Add(ms);
            double vram0 = gpu.VideoMemoryMB();
            long alloc0 = 0;
            long t0 = sims.Count > 0 ? Math.Max(1, sims.Max(s => (long)s.Value.DurationMs) / 2) : 1000;
            var sw = new Stopwatch();
            for (int i = 0; i < warm + frames; i++)
            {
                if (i == warm) { timer.Collect((l, ms) => { }); gpuMs.Clear(); cpuMs.Clear(); alloc0 = AppDomain.CurrentDomain.MonitoringTotalAllocatedMemorySize; }
                long t = t0 + i * 16;
                rig.Pan(t);
                sw.Restart();
                fb.Reset(W, H, true);
                fb.LowQuality = false;
                fb.Scale = perf.RenderScale;
                foreach (var s in sims)
                {
                    frame.P = s.Value; frame.NowMs = t; frame.ElapsedMs = Math.Min(t, s.Value.DurationMs - 1); frame.Exiting = false;
                    fb.CurrentLabel = s.Value.Def.Id;
                    s.Key.Update(frame);
                    s.Key.Render(fb, frame);
                }
                timer.Begin("frame");
                if (fb.NeedsInputMips) gpu.GenerateMips(rig.SrcSrv);
                fb.Execute(gpu, lib, pool, null, rig.SrcSrv, rig.OutRtv, t, t / 1000f);
                timer.End();
                gpu.Flush();
                sw.Stop();
                if (i >= warm) cpuMs.Add(sw.Elapsed.TotalMilliseconds);
                // Comme un vrai rendu (Present vide la file) : jamais plus de quelques images d'avance sur la carte, et
                // chaque image garde sa mesure (l'anneau de requêtes ne déborde pas).
                timer.Collect(add);
                for (int k = 0; timer.Pending > 6 && k < 2000; k++) { Thread.Sleep(1); timer.Collect(add); }
            }
            long alloc = AppDomain.CurrentDomain.MonitoringTotalAllocatedMemorySize - alloc0;
            for (int k = 0; k < 20 && gpuMs.Count < frames; k++) { Thread.Sleep(10); timer.Collect(add); }
            double vram1 = gpu.VideoMemoryMB();
            foreach (var s in sims) s.Key.Dispose();
            pool.Trim(long.MaxValue / 2, 0);
            bool gpuOk = gpuMs.Count >= frames / 2;
            return J.Map(
                "status", gpuOk ? "ok" : gpuMs.Count > 0 ? "partial" : "gpu_unmeasured",
                "resolution", W + "x" + H, "frames", frames, "gpu_samples", gpuMs.Count,
                "gpu_ms_p50", gpuOk || gpuMs.Count > 0 ? (object)gpuMs.P(50) : null, "gpu_ms_p95", gpuMs.Count > 0 ? (object)gpuMs.P(95) : null,
                "gpu_ms_p99", gpuMs.Count > 0 ? (object)gpuMs.P(99) : null, "gpu_ms_max", gpuMs.Count > 0 ? (object)gpuMs.P(100) : null,
                "cpu_ms_p50", cpuMs.P(50), "cpu_ms_p95", cpuMs.P(95),
                "alloc_bytes_per_frame", Math.Round(alloc / (double)frames),
                "vram_delta_mb", vram0 >= 0 && vram1 >= 0 ? (object)Math.Round(vram1 - vram0, 1) : null,
                "passes", fb.PassCount, "layers", fb.LayerCount,
                "variants", sims.Select(s => (object)J.Map("effect", s.Value.Def.Id, "level", s.Value.Level)).ToArray());
        }

        /// Synthèse : les moins et les plus coûteux, ceux à optimiser (seuils relatifs à la résolution testée), les
        /// combinaisons les plus lourdes. Rien n'est noté « sans impact » : seulement des mesures et leurs seuils.
        static Dictionary<string, object> Summary(List<Dictionary<string, object>> results, int w, int h)
        {
            Func<Dictionary<string, object>, double> p95 = r => r.ContainsKey("gpu_ms_p95") && r["gpu_ms_p95"] != null ? Convert.ToDouble(r["gpu_ms_p95"]) : -1;
            var eff = results.Where(r => (string)r["kind"] == "effect" && p95(r) >= 0).OrderBy(p95).ToList();
            var combos = results.Where(r => (string)r["kind"] == "combo" && p95(r) >= 0).OrderByDescending(p95).ToList();
            // Seuils à 1440p (mis à l'échelle des pixels) : au-delà de 1 ms, à surveiller ; au-delà de 2 ms, à optimiser.
            double scale = w * (double)h / (2560.0 * 1440.0), watch = 1.0 * scale, opt = 2.0 * scale;
            Func<Dictionary<string, object>, object> brief = r => J.Map("id", r["id"], "label", r["label"], "level", r["level"], "gpu_ms_p95", r["gpu_ms_p95"]);
            return J.Map(
                "cheapest", eff.Take(3).Select(brief).ToArray(),
                "costliest", eff.AsEnumerable().Reverse().Take(3).Select(brief).ToArray(),
                "to_watch", eff.Where(r => p95(r) > watch && p95(r) <= opt).Select(brief).ToArray(),
                "to_optimize", eff.Where(r => p95(r) > opt).Select(brief).ToArray(),
                "heaviest_combos", combos.Take(3).Select(brief).ToArray(),
                "unmeasured", results.Where(r => (string)r["status"] != "ok").Select(r => (object)J.Map("id", r["id"], "status", r["status"])).ToArray(),
                "thresholds_ms", J.Map("watch", Math.Round(watch, 3), "optimize", Math.Round(opt, 3)),
                "note", "Temps GPU du moteur Chaos seul, hors écran (pas de capture, pas de présentation, pas de jeu) : un coût relatif entre effets, pas les images/s d'un jeu.");
        }

        // ---------- MODE B : télémétrie pendant un essai en jeu ----------
        public static int Monitor(string[] a)
        {
            outw = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = false };
            int parent = IntArg(a, "--parent", 0), interval = Math.Max(200, Math.Min(5000, IntArg(a, "--interval-ms", 500)));
            long deadline = IntArg(a, "--deadline-ms", 1800000);
            var gpu = new Gpu();
            var times = new GpuTimes(GpuTimes.LuidOf(gpu));
            int self = Process.GetCurrentProcess().Id;
            Emit(J.Map("type", "start", "mode", "monitor", "interval_ms", interval, "gpu_counters", times.Ok, "system", SysInfo(gpu),
                "game_fps", "non mesuré : il faut PresentMon (traces Windows, droits d'administrateur) ; aucune injection dans le jeu."));
            gpu = null;
            var total = Stopwatch.StartNew();
            var stdin = new Thread(() => { try { while (Console.In.ReadLine() != null) { } } catch (Exception) { } Environment.Exit(0); }) { IsBackground = true };
            stdin.Start();
            while (true)
            {
                string why = Abort(parent, total, deadline);
                if (why != null) { Emit(J.Map("type", "end", "reason", why)); return 0; }
                long began = total.ElapsedMilliseconds;
                var gms = times.Sample();
                var vram = times.DedicatedMB();
                IntPtr fg = N.GetForegroundWindow();
                uint fgPid = 0; if (fg != IntPtr.Zero) N.GetWindowThreadProcessId(fg, out fgPid);
                var watch = new List<KeyValuePair<string, int>>();
                foreach (var p in Process.GetProcessesByName("ChaosEngine")) { if (p.Id != self) watch.Add(new KeyValuePair<string, int>("chaos", p.Id)); p.Dispose(); }
                foreach (var name in new[] { "dwm", "obs64" })
                    foreach (var p in Process.GetProcessesByName(name)) { watch.Add(new KeyValuePair<string, int>(name == "dwm" ? "dwm" : "obs", p.Id)); p.Dispose(); }
                if (fgPid != 0 && watch.All(x => x.Value != fgPid)) watch.Add(new KeyValuePair<string, int>("foreground", (int)fgPid));
                var procs = new List<object>();
                foreach (var kv in watch)
                {
                    double cpu = -1, ws = -1; string name = null;
                    try { using (var p = Process.GetProcessById(kv.Value)) { name = p.ProcessName; cpu = p.TotalProcessorTime.TotalMilliseconds; ws = Math.Round(p.WorkingSet64 / 1048576.0, 1); } }
                    catch (Exception) { }
                    double g, v;
                    procs.Add(J.Map("role", kv.Key, "pid", kv.Value, "name", name, "gpu_ms", gms.TryGetValue(kv.Value, out g) ? (object)Math.Round(g, 2) : null,
                        "cpu_ms", cpu >= 0 ? (object)Math.Round(cpu, 1) : null, "working_set_mb", ws >= 0 ? (object)ws : null,
                        "vram_mb", vram.TryGetValue(kv.Value, out v) ? (object)Math.Round(v, 1) : null, "foreground", kv.Value == fgPid));
                // vram_mb : compteur « GPU Process Memory\Dedicated Usage » de Windows tel quel (il compte aussi des
                // surfaces partagées : le compositeur peut y dépasser la mémoire de la carte) ; à lire en écart.
                }
                Emit(J.Map("type", "sample", "t_ms", total.ElapsedMilliseconds, "gpu_ms_all", Math.Round(gms.Values.Sum(), 2), "collect_ms", Math.Round(times.LastCollectMs, 2),
                    "game_active", N.GameActivity(), "processes", procs.ToArray()));
                Thread.Sleep((int)Math.Max(20, interval - (total.ElapsedMilliseconds - began)));
            }
        }
    }
}
