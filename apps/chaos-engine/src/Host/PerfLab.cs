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
            var gpuMs = new Samples(frames + 64); var cpuMs = new Samples(frames + 64);
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

        // ---------- Banc par phases (docs/chaos/BENCH_EFFETS.md) ----------
        /// --perf-phases [--w 2560 --h 1440] [--hz 60] [--repeats 3] [--effects a,b] [--all-variants] [--pace] [--raw <fichier>]
        /// Chaque effet, à chacun de ses paliers (niveaux ou variantes proposés aux viewers) et à son réglage par défaut,
        /// joué EN ENTIER (entrée, maintien, sortie) sur la scène de synthèse qui bouge, HORS ÉCRAN. La cadence du moteur est
        /// rejouée à « hz » (une nouvelle image du jeu à chaque rafraîchissement ; Cadence.Timed/Due et l'empreinte de
        /// l'image, comme Engine.cs) : une image n'est rendue que si le moteur la rendrait. Relevés par phase : images
        /// rendues, temps GPU (horodatages) p50/p95/p99/max, GPU par seconde, CPU de préparation des commandes. Activation
        /// (préparation, première image) et désactivation (libération, mémoire vidéo rendue) à part. --pace : temps réel
        /// (banc OBS : la charge arrive au rythme du vrai moteur) ; sinon au plus vite, GPU à pleine fréquence comme en jeu.
        /// Lignes JSON ; « phase » horodatée (QPC en ms, même horloge pour tous les processus). Garde de jeu au départ et
        /// entre deux mesures.
        sealed class PCase { public string Id, Effect, Variant, Level, Tier; public bool Extra; }
        sealed class PhaseAcc
        {
            public int Ticks, Renders, Static, Skipped, MaxPasses;
            public readonly Samples Gpu = new Samples(4096), Cpu = new Samples(4096);
            public Dictionary<string, object> ToJson(int hz)
            {
                double secs = Ticks / (double)hz, sum = 0;
                for (int i = 0; i < Gpu.Count; i++) sum += Gpu.At(i);
                // GPU par seconde : sur les images mesurées, rapporté à toutes les images rendues de la phase.
                double perS = Gpu.Count > 0 && secs > 0 ? sum / Gpu.Count * Renders / secs : 0;
                return J.Map("ticks", Ticks, "renders", Renders, "static_skips", Static, "not_due", Skipped,
                    "renders_per_s", secs > 0 ? (object)Math.Round(Renders / secs, 1) : null, "gpu_samples", Gpu.Count,
                    "gpu_ms_p50", Gpu.Count > 0 ? (object)Gpu.P(50) : null, "gpu_ms_p95", Gpu.Count > 0 ? (object)Gpu.P(95) : null,
                    "gpu_ms_p99", Gpu.Count > 0 ? (object)Gpu.P(99) : null, "gpu_ms_max", Gpu.Count > 0 ? (object)Gpu.P(100) : null,
                    "gpu_ms_per_s", Math.Round(perS, 2), "cpu_ms_p50", Cpu.Count > 0 ? (object)Cpu.P(50) : null,
                    "cpu_ms_p95", Cpu.Count > 0 ? (object)Cpu.P(95) : null, "cpu_ms_max", Cpu.Count > 0 ? (object)Cpu.P(100) : null,
                    "passes", MaxPasses);
            }
        }
        static double QpcMs() { return Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency; }

        public static int Phases(string[] a)
        {
            outw = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = false };
            int w = IntArg(a, "--w", 2560), h = IntArg(a, "--h", 1440), hz = Math.Max(30, Math.Min(240, IntArg(a, "--hz", 60)));
            int repeats = Math.Max(1, Math.Min(10, IntArg(a, "--repeats", 3)));
            bool pace = a.Contains("--pace"), allVariants = a.Contains("--all-variants"), smoke = a.Contains("--smoke");
            string only = Arg(a, "--effects", null), rawFile = Arg(a, "--raw", null), tierOnly = Arg(a, "--tiers", null);
            int parent = IntArg(a, "--parent", 0);
            long deadline = IntArg(a, "--deadline-ms", 3600000);
            if (smoke) { w = 160; h = 90; repeats = 1; }
            var total = Stopwatch.StartNew();
            string game = N.GameActivity();
            if (game != null && !smoke)
            {
                Emit(J.Map("type", "error", "code", "game_active", "message", "Un jeu ou une application plein écran est actif (" + game + ") : banc refusé."));
                return 3;
            }
            AppDomain.MonitoringIsEnabled = true;
            var reg = Registry.Embedded();
            var gpu = new Gpu();
            var lib = new ShaderLibrary(gpu, null);
            lib.Warm();
            var pool = new TexturePool(gpu);
            var timer = new GpuTimer(gpu);
            var text = new TextRaster(gpu);
            var rig = new Bench3Rig(gpu, (uint)w, (uint)h);
            var perf = PerformanceConfig.For("qualite");
            var safety = new SafetyConfig { MaxDurationMs = reg.Limits.MaxDurationMs };
            var raw = rawFile != null ? new StreamWriter(rawFile, false, new UTF8Encoding(false)) : null;

            // Plan : référence (copie seule), puis chaque effet : réglage par défaut, chaque palier ; --all-variants : les autres variantes.
            var cases = new List<PCase>();
            if (only == null || only.Split(',').Contains("reference")) cases.Add(new PCase { Id = "reference" });
            foreach (var d in reg.Effects.Values.Where(x => !x.Internal && (only == null || only.Split(',').Contains(x.Id))).OrderBy(x => x.Order))
            {
                object pv;
                var viewer = d.Raw.TryGetValue("viewer", out pv) ? pv as Dictionary<string, object> : null;
                bool byLevel = viewer != null && J.Str(viewer, "tier_kind", null) == "level";
                var tiers = viewer != null ? J.Arr(viewer, "tiers").Select(x => Convert.ToString(x, CultureInfo.InvariantCulture)).ToList() : new List<string>();
                if (tierOnly == null || tierOnly.Split(',').Contains("defaut")) cases.Add(new PCase { Id = d.Id + "@defaut", Effect = d.Id, Tier = "defaut" });
                foreach (var t in tiers)
                {
                    if (tierOnly != null && !tierOnly.Split(',').Contains(t)) continue;
                    if (byLevel && d.Level(t) == null || !byLevel && !d.Variants.ContainsKey(t)) continue;
                    cases.Add(new PCase { Id = d.Id + "@" + t, Effect = d.Id, Tier = t, Level = byLevel ? t : null, Variant = byLevel ? null : t });
                }
                if (allVariants)
                    foreach (var v in d.Variants.Keys)
                        if (byLevel || !tiers.Contains(v)) cases.Add(new PCase { Id = d.Id + "~" + v, Effect = d.Id, Tier = "variante " + v, Variant = v, Extra = true });
            }
            if (smoke) cases = cases.Take(3).ToList();
            Emit(J.Map("type", "start", "mode", "phases", "resolution", w + "x" + h, "hz", hz, "repeats", repeats, "pace", pace, "smoke", smoke,
                "cases", cases.Count, "system", SysInfo(gpu), "qpc_ms", Math.Round(QpcMs(), 1)));
            int caseNo = 0;
            foreach (var cs in cases)
            {
                caseNo++;
                int reps = cs.Extra ? 1 : repeats;
                for (int rep = 1; rep <= reps; rep++)
                {
                    string why = Abort(parent, total, deadline) ?? (!smoke && N.GameActivity() != null ? "game_active" : null);
                    if (why != null)
                    {
                        Emit(J.Map("type", "error", "code", why, "message", why == "game_active" ? "Un jeu ou une application plein écran vient de démarrer : banc arrêté." : "banc arrêté (" + why + ")"));
                        if (raw != null) raw.Dispose();
                        return 5;
                    }
                    Emit(J.Map("type", "progress", "case", cs.Id, "n", caseNo, "of", cases.Count, "rep", rep));
                    Dictionary<string, object> res;
                    try { res = PhaseRun(reg, gpu, lib, pool, timer, text, rig, perf, safety, cs, rep, hz, pace, raw); }
                    catch (Exception e) { res = J.Map("status", "failed", "error", e.GetType().Name + " : " + e.Message); }
                    res["case"] = cs.Id; res["effect"] = cs.Effect; res["tier"] = cs.Tier; res["variant"] = cs.Variant; res["level"] = cs.Level; res["rep"] = rep;
                    res["extra"] = cs.Extra;
                    Emit(J.Map("type", "result", "result", res));
                }
            }
            if (raw != null) raw.Dispose();
            Emit(J.Map("type", "end", "ok", true, "elapsed_ms", total.ElapsedMilliseconds));
            return 0;
        }

        static Dictionary<string, object> PhaseRun(Registry reg, Gpu gpu, ShaderLibrary lib, TexturePool pool, GpuTimer timer, TextRaster text, Bench3Rig rig,
            PerformanceConfig perf, SafetyConfig safety, PCase cs, int rep, int hz, bool pace, StreamWriter raw)
        {
            D3D11_TEXTURE2D_DESC od; Com.Fn<TexGetDesc>(rig.Out, 10)(rig.Out, out od);
            uint W = od.Width, H = od.Height;
            pool.Trim(long.MaxValue / 2, 0);
            double vram0 = gpu.VideoMemoryMB();
            var sw = Stopwatch.StartNew();
            EffectPreview.Sim sim = null;
            long inMs = 0, exitAt = 10000, end = 10000;
            if (cs.Effect != null)
            {
                var P = Params.Resolve(reg.Get(cs.Effect), cs.Variant, null, null, null, null, reg.Limits, safety, true, cs.Level);
                sim = new EffectPreview.Sim(P, 777 + rep, gpu, lib, text, W, H, -1);
                inMs = P.In.Instant ? 0 : P.In.DurationMs; exitAt = sim.ExitAt; end = sim.Total;
            }
            double actCpu = sw.Elapsed.TotalMilliseconds, vramAct = gpu.VideoMemoryMB(), vramPeak = vramAct;
            var acc = new Dictionary<string, PhaseAcc> { { "in", new PhaseAcc() }, { "hold", new PhaseAcc() }, { "out", new PhaseAcc() } };
            var first = new Samples(4);
            Action<string, double> add = (l, ms) => { if (l == "first") first.Add(ms); else acc[l].Gpu.Add(ms); };
            var fb = new FrameBuilder(W, H, true);
            bool shown = false, hasSig = false, clockDriven = false, anyClock = false;
            long lastSig = 0;
            string current = null;
            long alloc0 = AppDomain.CurrentDomain.MonitoringTotalAllocatedMemorySize;
            var proc = Process.GetCurrentProcess();
            double cpuProc0 = proc.TotalProcessorTime.TotalMilliseconds;
            var clock = Stopwatch.StartNew();
            var cpu = new Stopwatch();
            for (int n = 0; ; n++)
            {
                long t = (long)Math.Round(n * 1000.0 / hz);
                if (t > end) break;
                if (pace) { long wait = t - clock.ElapsedMilliseconds; if (wait > 1) Thread.Sleep((int)wait - 1); while (clock.ElapsedMilliseconds < t) Thread.SpinWait(50); }
                string phase = t < inMs ? "in" : t < exitAt ? "hold" : "out";
                if (phase != current) { current = phase; Emit(J.Map("type", "phase", "case", cs.Id, "rep", rep, "phase", phase, "t_ms", t, "qpc_ms", Math.Round(QpcMs(), 1))); }
                var A = acc[phase];
                A.Ticks++;
                rig.Pan(t); // nouvelle image du jeu à chaque rafraîchissement
                bool needsCapture = sim == null || sim.Fx.NeedsCapture;
                bool animating = false;
                if (sim != null) { if (t >= exitAt) sim.Anim.BeginExit(exitAt); animating = sim.Anim.Animating(t); }
                bool timed = Cadence.Timed(animating, needsCapture, false, false, clockDriven);
                if (!Cadence.Due(shown, timed, true, needsCapture)) { A.Skipped++; continue; }
                cpu.Restart();
                fb.Reset(W, H, needsCapture);
                fb.LowQuality = false;
                fb.Scale = perf.RenderScale;
                if (sim != null) { sim.F.ClockRead = false; sim.Render(fb, t); clockDriven = sim.F.ClockRead; anyClock |= clockDriven; }
                long sig = fb.Signature(lib, t / 1000f);
                if (!needsCapture && shown && hasSig && sig == lastSig) { A.Static++; continue; }
                timer.Begin(shown ? phase : "first");
                if (needsCapture && fb.NeedsInputMips) gpu.GenerateMips(rig.SrcSrv);
                fb.Execute(gpu, lib, pool, null, needsCapture ? rig.SrcSrv : IntPtr.Zero, rig.OutRtv, t, t / 1000f);
                timer.End();
                A.Cpu.Add(cpu.Elapsed.TotalMilliseconds);
                gpu.Flush();
                A.Renders++; A.MaxPasses = Math.Max(A.MaxPasses, fb.PassCount);
                shown = true; hasSig = true; lastSig = sig;
                timer.Collect(add);
                for (int k = 0; timer.Pending > 6 && k < 2000; k++) { Thread.Sleep(1); timer.Collect(add); }
                if ((n & 31) == 0) vramPeak = Math.Max(vramPeak, gpu.VideoMemoryMB());
            }
            for (int k = 0; k < 50 && timer.Pending > 0; k++) { Thread.Sleep(5); timer.Collect(add); }
            proc.Refresh();
            double cpuProc = proc.TotalProcessorTime.TotalMilliseconds - cpuProc0, wall = clock.Elapsed.TotalMilliseconds;
            long alloc = AppDomain.CurrentDomain.MonitoringTotalAllocatedMemorySize - alloc0;
            double vramEnd = gpu.VideoMemoryMB();
            sw.Restart();
            if (sim != null) { sim.Fx.Stop(); sim.Fx.Dispose(); }
            double disposeCpu = sw.Elapsed.TotalMilliseconds, vramDisposed = gpu.VideoMemoryMB();
            pool.Trim(long.MaxValue / 2, 0);
            double vramTrim = gpu.VideoMemoryMB();
            int renders = acc.Values.Sum(x => x.Renders);
            if (raw != null)
            {
                foreach (var kv in acc)
                    raw.WriteLine(J.Write(J.Map("case", cs.Id, "rep", rep, "phase", kv.Key, "gpu_ms", Enumerable.Range(0, kv.Value.Gpu.Count).Select(i => (object)Math.Round(kv.Value.Gpu.At(i), 4)).ToArray(),
                        "cpu_ms", Enumerable.Range(0, kv.Value.Cpu.Count).Select(i => (object)Math.Round(kv.Value.Cpu.At(i), 4)).ToArray())));
                raw.Flush();
            }
            return J.Map("status", "ok", "resolution", W + "x" + H, "hz", hz, "paced", pace,
                "duration_ms", exitAt, "in_ms", inMs, "out_ms", end - exitAt, "clock_driven", anyClock,
                "needs_capture", sim == null || sim.P.Def.RequiresCapture,
                "phases", J.Map("in", acc["in"].ToJson(hz), "hold", acc["hold"].ToJson(hz), "out", acc["out"].ToJson(hz)),
                "activation", J.Map("cpu_ms", Math.Round(actCpu, 3), "first_gpu_ms", first.Count > 0 ? (object)first.P(100) : null),
                "deactivation", J.Map("cpu_ms", Math.Round(disposeCpu, 3)),
                "vram_mb", J.Map("before", vram0, "after_prepare", vramAct, "peak", vramPeak, "end", vramEnd, "after_dispose", vramDisposed, "after_trim", vramTrim),
                "process_cpu_ms_per_s", wall > 0 ? (object)Math.Round(cpuProc / wall * 1000, 1) : null,
                "alloc_bytes_per_render", renders > 0 ? (object)Math.Round(alloc / (double)renders) : null);
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
