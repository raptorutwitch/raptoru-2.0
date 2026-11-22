// Lecteur Chaos (mode --serve) : un processus = un effet. Piloté en JSON ligne par ligne sur stdin/stdout.
//   Commandes : play {id, effect:"flip", variant:"rotate180", max_ms, params:{hwnd, mode:"window"|"monitor", transition_ms, follow_foreground}},
//               stop {id}, stop_all, ping.
//   Événements : ready, started, stats, warning, ended, failed, error, exit.
// Restauration par construction : la seule chose qui modifie l'écran est la fenêtre de ce processus, et il se termine
// (TerminateProcess) à la fin de l'effet, sans battement du parent pendant 2 s, si stdin se ferme, si le parent meurt,
// ou si le délai maximal absolu est dépassé. Windows détruit alors ses fenêtres : rien à restaurer.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;

namespace Raptoru.Chaos
{
    sealed class PlayFailed : Exception
    {
        public readonly string Reason;
        public PlayFailed(string reason, string detail) : base(detail) { Reason = reason; }
    }

    sealed class Presenter
    {
        public const int HeartbeatMs = 2000, MaxEffectMs = 60000, StopForceMs = 500;
        public readonly Stopwatch Clock = Stopwatch.StartNew();
        public readonly AutoResetEvent FrameEvt = new AutoResetEvent(false);
        readonly AutoResetEvent cmdEvt = new AutoResetEvent(false);
        readonly ConcurrentQueue<Dictionary<string, object>> cmds = new ConcurrentQueue<Dictionary<string, object>>();
        readonly JavaScriptSerializer json = new JavaScriptSerializer();
        readonly object outLock = new object(), quitLock = new object();
        StreamWriter stdout;
        long lastCmdMs, hardDeadlineMs = long.MaxValue, stopRequestedMs = -1;
        bool quitting;
        Gpu gpu;
        volatile Effect eff;

        public long Now { get { return Clock.ElapsedMilliseconds; } }

        public void Emit(string ev, params object[] kv)
        {
            var d = new Dictionary<string, object>();
            d["ev"] = ev; d["t_ms"] = Now;
            for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
            string line = json.Serialize(d);
            // Jamais bloquant au-delà de 250 ms : un parent qui ne lit plus ne doit pas empêcher l'arrêt (la ligne est perdue).
            if (!Monitor.TryEnter(outLock, 250)) return;
            try { stdout.WriteLine(line); } catch (Exception) { } finally { Monitor.Exit(outLock); }
        }

        public int Run(int parentPid)
        {
            stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = true;
            AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            {
                Emit("failed", "reason", "fatal", "detail", Trunc(e.ExceptionObject.ToString(), 600));
                Quit("fatal", 3);
            };
            Start(ReadStdin, "stdin");
            Start(Watchdog, "watchdog");
            if (parentPid > 0) Start(() => WatchParent(parentPid), "parent");
            var render = new Thread(RenderLoop) { IsBackground = true, Name = "render" };
            render.Start();
            render.Join();
            Quit("render_exit", 0);
            return 0;
        }

        static void Start(ThreadStart f, string name) { new Thread(f) { IsBackground = true, Name = name }.Start(); }

        public void SetHardDeadline(long ms) { Interlocked.Exchange(ref hardDeadlineMs, ms); }

        /// Seule sortie du processus. Immédiate : Windows détruit la fenêtre de l'effet avec le processus.
        public void Quit(string reason, int code)
        {
            lock (quitLock) { if (quitting) return; quitting = true; }
            try { var e = eff; if (e != null) e.EmitEnded(reason); } catch (Exception) { }
            Emit("exit", "reason", reason, "code", code);
            N.TerminateProcess(N.GetCurrentProcess(), (uint)code);
        }

        public void FailAndQuit(string reason, string detail)
        {
            var e = eff;
            Emit("failed", "id", e != null ? e.Id : null, "reason", reason, "detail", detail);
            if (e != null) e.MarkEnded();
            Quit("failed", 1);
        }

        void ReadStdin()
        {
            var r = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            while (true)
            {
                string line;
                try { line = r.ReadLine(); } catch (Exception) { line = null; }
                if (line == null) { Quit("stdin_closed", 0); return; }
                Interlocked.Exchange(ref lastCmdMs, Now);
                line = line.Trim().TrimStart('﻿');
                if (line.Length == 0) continue;
                Dictionary<string, object> cmd = null;
                try { cmd = json.Deserialize<Dictionary<string, object>>(line); } catch (Exception) { }
                string c = cmd != null && cmd.ContainsKey("cmd") ? cmd["cmd"] as string : null;
                if (c == null) { Emit("error", "reason", "bad_json", "line", Trunc(line, 200)); continue; }
                if (c == "ping") continue;
                if (c == "stop" || c == "stop_all") Interlocked.CompareExchange(ref stopRequestedMs, Now, -1);
                cmds.Enqueue(cmd);
                cmdEvt.Set();
            }
        }

        void Watchdog()
        {
            while (true)
            {
                Thread.Sleep(50);
                long now = Now;
                if (now - Interlocked.Read(ref lastCmdMs) > HeartbeatMs) Quit("heartbeat", 0);
                if (now > Interlocked.Read(ref hardDeadlineMs)) Quit("hard_deadline", 0);
                long stop = Interlocked.Read(ref stopRequestedMs);
                if (stop >= 0 && now - stop > StopForceMs) Quit("stop_forced", 0);
            }
        }

        void WatchParent(int pid)
        {
            IntPtr h = N.OpenProcess(0x00100000 /* SYNCHRONIZE */, false, (uint)pid);
            if (h == IntPtr.Zero) { Quit("parent_missing", 0); return; }
            N.WaitForSingleObject(h, 0xFFFFFFFF);
            Quit("parent_exit", 0);
        }

        void RenderLoop()
        {
            try { gpu = new Gpu(); }
            catch (Exception e) { Emit("failed", "reason", "gpu", "detail", e.Message); Quit("gpu", 2); return; }
            Emit("ready", "pid", Process.GetCurrentProcess().Id, "version", Program.Version, "adapter", gpu.Adapter, "ready_ms", Now);
            var handles = new[] { cmdEvt.SafeWaitHandle.DangerousGetHandle(), FrameEvt.SafeWaitHandle.DangerousGetHandle() };
            while (true)
            {
                var e = eff;
                N.MsgWaitForMultipleObjectsEx(2, handles, e != null && e.FastTick ? 1u : 10u, N.QS_ALLINPUT, N.MWMO_INPUTAVAILABLE);
                MSG m;
                while (N.PeekMessageW(out m, IntPtr.Zero, 0, 0, N.PM_REMOVE)) { N.TranslateMessage(ref m); N.DispatchMessageW(ref m); }
                Dictionary<string, object> cmd;
                while (cmds.TryDequeue(out cmd)) Handle(cmd);
                e = eff;
                if (e != null)
                {
                    try { e.Tick(); }
                    catch (Exception ex) { FailAndQuit("render_error", Trunc(ex.Message, 400)); }
                }
            }
        }

        void Handle(Dictionary<string, object> cmd)
        {
            string c = (string)cmd["cmd"];
            if (c == "stop" || c == "stop_all")
            {
                var e = eff;
                if (e != null) e.End("stopped"); else Quit("stopped", 0);
                return;
            }
            if (c != "play") { Emit("error", "reason", "unknown_cmd", "cmd", c); return; }
            string id = cmd.ContainsKey("id") ? Convert.ToString(cmd["id"]) : "";
            if (eff != null) { Emit("failed", "id", id, "reason", "busy", "detail", "un effet joue déjà dans ce lecteur"); return; }
            try
            {
                eff = new Effect(this, gpu, id, cmd);
            }
            catch (PlayFailed f) { Emit("failed", "id", id, "reason", f.Reason, "detail", f.Message); Quit("failed", 1); }
            catch (ComFail f) { Emit("failed", "id", id, "reason", "capture_error", "detail", f.Message); Quit("failed", 1); }
            catch (COMException f) { Emit("failed", "id", id, "reason", "capture_denied", "detail", "0x" + f.ErrorCode.ToString("X8") + " " + f.Message); Quit("failed", 1); }
            catch (Exception f) { Emit("failed", "id", id, "reason", "capture_error", "detail", f.GetType().Name + " " + Trunc(f.Message, 300)); Quit("failed", 1); }
        }

        public static string Trunc(string s, int n) { return s == null || s.Length <= n ? s : s.Substring(0, n); }
    }

    /// Un retournement en cours : capture → copie GPU → shader → fenêtre traversable au premier plan.
    sealed class Effect
    {
        const int StartTimeoutMs = 15000, FirstFrameTimeoutMs = 3000, BlackSize = 16;
        static WndProc proc; // gardé vivant pour Windows
        static bool classRegistered;

        readonly Presenter host;
        readonly Gpu gpu;
        public readonly string Id;
        readonly IntPtr target, targetRoot;
        readonly bool monitorMode, follow, hidden;
        readonly int durationMs, transitionMs;
        readonly string border, borderAccess;
        readonly GraphicsCaptureItem item;
        readonly Direct3D11CaptureFramePool pool;
        readonly GraphicsCaptureSession session;
        readonly IntPtr hwnd, swapchain, dcomp, dcTarget, visual, staging;
        readonly ScPresent present;
        readonly ScGetBuffer getBuffer;
        readonly ScResizeBuffers resizeBuffers;
        readonly DcGetFrameStatistics compStats;
        IntPtr rtv, srcTex, srcSrv;
        uint w, h; float lod;
        RECT bounds;
        volatile bool targetLost;
        bool shown, mipsDirty, ended, blackPending, blackWarned, black;
        int endedEmitted, capCount;
        long setupMs, playAt, firstFrameAt = -1, startedAt = -1, endAt = long.MaxValue, exitAt = -1, shownSince, visibleMs, lastArrivalQpc;
        long nextStatsAt, nextBlackAt, statsCap, statsPres, statsCpuTicks, statsAt, totalPresented;
        readonly List<double> lat = new List<double>(), gpuMs = new List<double>(), allLat = new List<double>(), allGpu = new List<double>();
        readonly long qpcFreq = N.QpcFreq();

        public bool FastTick { get { return startedAt >= 0 && Animating(host.Now); } }

        public Effect(Presenter host, Gpu gpu, string id, Dictionary<string, object> cmd)
        {
            this.host = host; this.gpu = gpu; Id = id;
            playAt = host.Now;
            var p = cmd.ContainsKey("params") ? cmd["params"] as Dictionary<string, object> : null;
            if (p == null) p = new Dictionary<string, object>();
            string effect = Str(cmd, "effect", "flip"), variant = Str(cmd, "variant", "rotate180");
            if (effect != "flip" || variant != "rotate180") throw new PlayFailed("unsupported_effect", effect + "/" + variant + " : seul flip/rotate180 existe au lot 1");
            durationMs = (int)Math.Max(1000, Math.Min(Presenter.MaxEffectMs, Num(cmd, "max_ms", 10000)));
            int t = (int)Num(p, "transition_ms", 0);
            // ≤ 520°/s avec accélération douce (pic = π/2 × vitesse moyenne) : 180° en au moins 545 ms.
            transitionMs = t <= 0 ? 0 : Math.Max(545, Math.Min(1500, t));
            monitorMode = Str(p, "mode", "window") == "monitor";
            follow = !p.ContainsKey("follow_foreground") || Convert.ToBoolean(p["follow_foreground"]);
            // Mesure seulement : tout le rendu a lieu, mais la fenêtre n'est jamais montrée.
            hidden = p.ContainsKey("hidden") && Convert.ToBoolean(p["hidden"]);
            target = new IntPtr(Num(p, "hwnd", 0));

            if (target == IntPtr.Zero || !N.IsWindow(target)) throw new PlayFailed("no_window", "fenêtre cible introuvable");
            if (!monitorMode && N.IsIconic(target)) throw new PlayFailed("target_minimized", "la fenêtre cible est réduite");
            int quns;
            if (N.SHQueryUserNotificationState(out quns) == 0 && quns == N.QUNS_RUNNING_D3D_FULL_SCREEN)
                throw new PlayFailed("exclusive_fullscreen", "un jeu est en plein écran exclusif : rien ne peut s'afficher au-dessus ; passer en fenêtré sans bordure");
            if (!GraphicsCaptureSession.IsSupported()) throw new PlayFailed("capture_unsupported", "Windows.Graphics.Capture indisponible");
            targetRoot = N.GetAncestor(target, N.GA_ROOTOWNER);
            if (targetRoot == IntPtr.Zero) targetRoot = target;

            // 1. L'élément capturé : la fenêtre du jeu (mode D) ou tout son écran (mode C).
            var interop = (IGraphicsCaptureItemInterop)WindowsRuntimeMarshal.GetActivationFactory(typeof(GraphicsCaptureItem));
            Guid iid = Iid.GraphicsCaptureItem;
            IntPtr pItem;
            try
            {
                pItem = monitorMode ? interop.CreateForMonitor(N.MonitorFromWindow(target, 2), ref iid) : interop.CreateForWindow(target, ref iid);
            }
            catch (COMException e) { throw new PlayFailed("capture_denied", "Windows refuse la capture : 0x" + e.ErrorCode.ToString("X8")); }
            item = (GraphicsCaptureItem)Marshal.GetObjectForIUnknown(pItem);
            Marshal.Release(pItem);
            item.Closed += (s, a) => { targetLost = true; host.FrameEvt.Set(); };
            SizeInt32 size = item.Size;
            if (size.Width < 16 || size.Height < 16) throw new PlayFailed("no_window", "fenêtre trop petite : " + size.Width + "x" + size.Height);
            w = (uint)size.Width; h = (uint)size.Height;
            bounds = monitorMode ? N.MonitorRect(target) : N.FrameBounds(target);

            // 2. La fenêtre de présentation : traversable, jamais activée, au premier plan, cachée jusqu'à la première image.
            hwnd = CreateOverlay(bounds.Left, bounds.Top, (int)w, (int)h);
            if (monitorMode && !N.SetWindowDisplayAffinity(hwnd, N.WDA_EXCLUDEFROMCAPTURE))
                throw new PlayFailed("exclusion_failed", "impossible d'exclure la fenêtre des captures (mode C)");

            // 3. Chaîne d'échange DirectComposition (modèle flip) attachée à la fenêtre.
            swapchain = gpu.CompositionSwapChain(w, h);
            present = Com.Fn<ScPresent>(swapchain, 8);
            getBuffer = Com.Fn<ScGetBuffer>(swapchain, 9);
            resizeBuffers = Com.Fn<ScResizeBuffers>(swapchain, 13);
            CreateTargets();
            Guid dcid = Iid.DCompDevice;
            Com.Check(N.DCompositionCreateDevice(gpu.DxgiDevice, ref dcid, out dcomp), "DCompositionCreateDevice");
            Com.Check(Com.Fn<DcCreateTarget>(dcomp, 6)(dcomp, hwnd, 1, out dcTarget), "CreateTargetForHwnd");
            Com.Check(Com.Fn<DcCreateVisual>(dcomp, 7)(dcomp, out visual), "CreateVisual");
            Com.Check(Com.Fn<DcSetPtr>(visual, 15)(visual, swapchain), "SetContent");
            Com.Check(Com.Fn<DcSetPtr>(dcTarget, 3)(dcTarget, visual), "SetRoot");
            Com.Check(Com.Fn<DcCommit>(dcomp, 3)(dcomp), "Commit");
            compStats = Com.Fn<DcGetFrameStatistics>(dcomp, 5);
            staging = gpu.Texture(BlackSize, BlackSize, 1, 0, 0, 3 /* STAGING */, 0x20000 /* CPU_READ */);

            // 4. La capture : sans curseur (exclu à la source par Windows), sans bordure, images signalées au fil de rendu.
            pool = Direct3D11CaptureFramePool.CreateFreeThreaded(gpu.WinrtDevice, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, size);
            pool.FrameArrived += (s, a) => { Interlocked.Exchange(ref lastArrivalQpc, N.QpcNow()); Interlocked.Increment(ref capCount); host.FrameEvt.Set(); };
            session = pool.CreateCaptureSession(item);
            try { session.IsCursorCaptureEnabled = false; }
            catch (Exception e) { throw new PlayFailed("cursor_exclusion_unavailable", "IsCursorCaptureEnabled indisponible : " + e.Message); }
            borderAccess = "?";
            try
            {
                var op = GraphicsCaptureAccess.RequestAccessAsync(GraphicsCaptureAccessKind.Borderless);
                var wait = Stopwatch.StartNew();
                while (op.Status == Windows.Foundation.AsyncStatus.Started && wait.ElapsedMilliseconds < 3000) Thread.Sleep(5);
                borderAccess = op.Status == Windows.Foundation.AsyncStatus.Completed ? op.GetResults().ToString() : "timeout";
            }
            catch (Exception e) { borderAccess = "error " + e.GetType().Name; }
            try { session.IsBorderRequired = false; border = "removed"; } catch (Exception) { border = "required"; }
            try { session.MinUpdateInterval = TimeSpan.FromMilliseconds(1); } catch (Exception) { }
            setupMs = host.Now - playAt;
            statsAt = host.Now; nextStatsAt = playAt + 1000; nextBlackAt = playAt + 300;
            statsCpuTicks = Process.GetCurrentProcess().TotalProcessorTime.Ticks;
            // Garde-fou absolu tant que l'effet n'a pas démarré (le vrai délai est fixé au démarrage).
            host.SetHardDeadline(playAt + StartTimeoutMs + 3000);
            session.StartCapture();
        }

        static string Str(Dictionary<string, object> d, string k, string def) { return d.ContainsKey(k) && d[k] != null ? Convert.ToString(d[k]) : def; }
        static long Num(Dictionary<string, object> d, string k, long def) { try { return d.ContainsKey(k) && d[k] != null ? Convert.ToInt64(d[k]) : def; } catch (Exception) { return def; } }

        IntPtr CreateOverlay(int x, int y, int cw, int ch)
        {
            IntPtr inst = N.GetModuleHandleW(IntPtr.Zero);
            if (!classRegistered)
            {
                proc = OverlayProc;
                var wc = new WNDCLASSEX
                {
                    cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX)), lpfnWndProc = Marshal.GetFunctionPointerForDelegate(proc),
                    hInstance = inst, lpszClassName = N.OverlayClass
                };
                if (N.RegisterClassExW(ref wc) == 0) throw new PlayFailed("window_error", "RegisterClassEx " + Marshal.GetLastWin32Error());
                classRegistered = true;
            }
            int ex = N.WS_EX_TOPMOST | N.WS_EX_TRANSPARENT | N.WS_EX_LAYERED | N.WS_EX_NOACTIVATE | N.WS_EX_TOOLWINDOW | N.WS_EX_NOREDIRECTIONBITMAP;
            IntPtr h = N.CreateWindowExW(ex, N.OverlayClass, "Raptoru Chaos", N.WS_POPUP, x, y, cw, ch, IntPtr.Zero, IntPtr.Zero, inst, IntPtr.Zero);
            if (h == IntPtr.Zero) throw new PlayFailed("window_error", "CreateWindowEx " + Marshal.GetLastWin32Error());
            N.SetLayeredWindowAttributes(h, 0, 255, N.LWA_ALPHA);
            return h;
        }

        static IntPtr OverlayProc(IntPtr h, uint m, IntPtr wp, IntPtr lp)
        {
            if (m == N.WM_NCHITTEST) return new IntPtr(-1);  // HTTRANSPARENT : les clics vont à la fenêtre dessous
            if (m == N.WM_MOUSEACTIVATE) return new IntPtr(3); // MA_NOACTIVATE : jamais de focus
            if (m == N.WM_ERASEBKGND) return new IntPtr(1);
            return N.DefWindowProcW(h, m, wp, lp);
        }

        void CreateTargets()
        {
            Guid tid = Iid.Texture2D;
            IntPtr back;
            Com.Check(getBuffer(swapchain, 0, ref tid, out back), "GetBuffer");
            rtv = gpu.Rtv(back);
            Com.Release(ref back);
            // Mipmaps seulement pour le fond flou de la bascule animée.
            srcTex = gpu.Texture(w, h, 0, 0x8 | 0x20 /* SRV | RTV */, 0x1 /* GENERATE_MIPS */, 0, 0);
            srcSrv = gpu.Srv(srcTex);
            uint levels = 1; for (uint m = Math.Max(w, h); m > 1; m >>= 1) levels++;
            lod = Math.Min(5f, levels - 1);
        }

        void Resize(SizeInt32 size)
        {
            pool.Recreate(gpu.WinrtDevice, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, size);
            w = (uint)size.Width; h = (uint)size.Height;
            Com.Release(ref rtv); Com.Release(ref srcSrv); Com.Release(ref srcTex);
            Com.Check(resizeBuffers(swapchain, 0, w, h, 0, 0), "ResizeBuffers");
            CreateTargets();
            N.SetWindowPos(hwnd, N.HWND_TOPMOST, bounds.Left, bounds.Top, (int)w, (int)h, N.SWP_NOACTIVATE);
        }

        bool Animating(long now)
        {
            if (transitionMs == 0 || startedAt < 0) return false;
            return now - startedAt < transitionMs || exitAt >= 0;
        }

        /// 0 → π à l'entrée, π → 2π à la sortie (même sens), accélération et décélération douces.
        double AngleAt(long now)
        {
            if (transitionMs == 0) return Math.PI;
            if (startedAt < 0) return 0;
            if (exitAt >= 0) return Math.PI + Math.PI * Ease((now - exitAt) / (double)transitionMs);
            return Math.PI * Ease((now - startedAt) / (double)transitionMs);
        }
        static double Ease(double t) { t = Math.Max(0, Math.Min(1, t)); return (1 - Math.Cos(Math.PI * t)) / 2; }

        bool TargetForeground()
        {
            IntPtr fg = N.GetForegroundWindow();
            if (fg == IntPtr.Zero) return shown;
            IntPtr root = N.GetAncestor(fg, N.GA_ROOTOWNER);
            return root == targetRoot || fg == target;
        }

        public void Tick()
        {
            if (ended) return;
            long now = host.Now;
            if (targetLost || (!monitorMode && !N.IsWindow(target))) { End("target_lost"); return; }
            if (firstFrameAt < 0 && now - playAt > FirstFrameTimeoutMs)
            {
                host.FailAndQuit("no_frame", "aucune image capturée en 3 s (fenêtre protégée, invisible ou capture refusée)");
                return;
            }
            if (startedAt < 0 && firstFrameAt >= 0 && now - playAt > StartTimeoutMs) { End("never_visible"); return; }

            bool fresh = TakeLatestFrame(now);
            if (!monitorMode) TrackBounds();
            bool want = !hidden && firstFrameAt >= 0 && (monitorMode || ((!follow || TargetForeground()) && !N.IsIconic(target)));
            bool animating = Animating(now);
            if (fresh || animating || (want && !shown))
            {
                gpu.TimingBegin();
                gpu.DrawRotated(rtv, w, h, srcSrv, AngleAt(now), lod);
                gpu.TimingEnd();
                // Hors animation : présenté tout de suite, DWM prend l'image la plus récente (pas d'attente de vsync).
                int hr = present(swapchain, animating ? 1u : 0u, 0);
                if (hr < 0) { host.FailAndQuit("present_failed", "Present 0x" + hr.ToString("X8")); return; }
                totalPresented++;
                // Temps de traitement du lecteur : arrivée de l'image capturée → image remise à l'affichage.
                if (fresh) { double l = (N.QpcNow() - Interlocked.Read(ref lastArrivalQpc)) * 1000.0 / qpcFreq; if (l >= 0 && l < 1000) lat.Add(l); }
            }
            if (want != shown) SetShown(want, now);
            if (shown && startedAt < 0)
            {
                startedAt = now; endAt = now + durationMs;
                host.SetHardDeadline(endAt + transitionMs + 3000);
                host.Emit("started", "id", Id, "mode", monitorMode ? "C" : "D", "first_frame_ms", firstFrameAt - playAt,
                    "started_ms", startedAt - playAt, "size", w + "x" + h, "border", border, "border_access", borderAccess,
                    "adapter", gpu.Adapter, "duration_ms", durationMs, "transition_ms", transitionMs, "follow_foreground", follow,
                    "overlay_hwnd", hwnd.ToInt64(), "setup_ms", setupMs);
            }
            if (exitAt < 0 && now >= endAt)
            {
                if (transitionMs > 0 && shown) exitAt = now; else { End("duration"); return; }
            }
            if (exitAt >= 0 && now - exitAt >= transitionMs) { End("duration"); return; }
            if (now >= nextBlackAt) CheckBlack(now);
            if (now >= nextStatsAt) Stats(now);
        }

        bool TakeLatestFrame(long now)
        {
            Direct3D11CaptureFrame latest = null, f;
            while ((f = pool.TryGetNextFrame()) != null) { if (latest != null) latest.Dispose(); latest = f; }
            if (latest == null) return false;
            try
            {
                SizeInt32 size = latest.ContentSize;
                if (size.Width != w || size.Height != h)
                {
                    if (size.Width >= 16 && size.Height >= 16) Resize(size);
                    return false;
                }
                var surface = latest.Surface;
                var access = (IDirect3DDxgiInterfaceAccess)(object)surface;
                Guid tid = Iid.Texture2D;
                IntPtr tex = access.GetInterface(ref tid);
                gpu.TimingBegin();
                gpu.Copy(srcTex, tex, 0, 0, w, h);
                Marshal.Release(tex);
                Marshal.ReleaseComObject(surface);
                if (Animating(now)) { gpu.GenerateMips(srcSrv); mipsDirty = false; } else mipsDirty = true;
                if (firstFrameAt < 0) firstFrameAt = now;
                return true;
            }
            finally { latest.Dispose(); }
        }

        void TrackBounds()
        {
            RECT r = N.FrameBounds(target);
            if (r.Left == bounds.Left && r.Top == bounds.Top) return;
            bounds = r;
            N.SetWindowPos(hwnd, N.HWND_TOPMOST, r.Left, r.Top, (int)w, (int)h, N.SWP_NOACTIVATE);
        }

        void SetShown(bool on, long now)
        {
            if (on)
            {
                if (mipsDirty && transitionMs > 0) { gpu.GenerateMips(srcSrv); mipsDirty = false; }
                N.SetWindowPos(hwnd, N.HWND_TOPMOST, bounds.Left, bounds.Top, (int)w, (int)h, N.SWP_NOACTIVATE | N.SWP_SHOWWINDOW);
                shownSince = now;
            }
            else
            {
                N.ShowWindow(hwnd, N.SW_HIDE);
                visibleMs += now - shownSince;
            }
            shown = on;
        }

        void CheckBlack(long now)
        {
            if (!blackPending)
            {
                if (firstFrameAt < 0) return;
                gpu.Copy(staging, srcTex, w / 2 - BlackSize / 2, h / 2 - BlackSize / 2, BlackSize, BlackSize);
                blackPending = true;
                return;
            }
            int max = gpu.MaxChannel(staging, BlackSize);
            if (max < 0) return;
            blackPending = false; nextBlackAt = now + 2000;
            black = max < 8;
            if (black && !blackWarned)
            {
                blackWarned = true;
                host.Emit("warning", "id", Id, "reason", "capture_black", "detail", "le centre de l'image capturée est noir : le jeu bloque peut-être la capture");
            }
        }

        void Stats(long now)
        {
            gpu.TimingCollect(gpuMs);
            double secs = Math.Max(0.001, (now - statsAt) / 1000.0);
            int cap = Interlocked.CompareExchange(ref capCount, 0, 0);
            long cpu = Process.GetCurrentProcess().TotalProcessorTime.Ticks;
            DCOMPOSITION_FRAME_STATISTICS cs;
            double compHz = compStats(dcomp, out cs) >= 0 && cs.RateDenominator > 0 ? Math.Round(cs.RateNumerator / (double)cs.RateDenominator, 1) : 0;
            host.Emit("stats", "id", Id, "capture_fps", Math.Round((cap - statsCap) / secs, 1),
                "present_fps", Math.Round((totalPresented - statsPres) / secs, 1),
                "lat_p50_ms", Pct(lat, 50), "lat_p95_ms", Pct(lat, 95), "gpu_ms", Pct(gpuMs, 50), "gpu_ms_max", Pct(gpuMs, 100),
                "cpu_pct", Math.Round((cpu - statsCpuTicks) / 1e7 / secs / Environment.ProcessorCount * 100, 2),
                "cpu_ms_per_s", Math.Round((cpu - statsCpuTicks) / 1e4 / secs, 1),
                "comp_hz", compHz, "visible", shown, "size", w + "x" + h, "black", black);
            allLat.AddRange(lat); allGpu.AddRange(gpuMs); lat.Clear(); gpuMs.Clear();
            statsCap = cap; statsPres = totalPresented; statsCpuTicks = cpu; statsAt = now; nextStatsAt = now + 1000;
            if (shown) N.SetWindowPos(hwnd, N.HWND_TOPMOST, 0, 0, 0, 0, N.SWP_NOMOVE | N.SWP_NOSIZE | N.SWP_NOACTIVATE | N.SWP_NOOWNERZORDER);
        }

        static double Pct(List<double> v, int p)
        {
            if (v.Count == 0) return -1;
            var s = v.OrderBy(x => x).ToList();
            return Math.Round(s[Math.Min(s.Count - 1, (int)Math.Ceiling(p / 100.0 * s.Count) - (p == 0 ? 0 : 1))], 3);
        }

        public void End(string reason)
        {
            if (ended) return;
            ended = true;
            long now = host.Now;
            if (shown) { N.ShowWindow(hwnd, N.SW_HIDE); visibleMs += now - shownSince; shown = false; }
            EmitEnded(reason);
            host.Quit("ended", 0);
        }

        public void MarkEnded() { Interlocked.Exchange(ref endedEmitted, 1); }

        public void EmitEnded(string reason)
        {
            if (Interlocked.Exchange(ref endedEmitted, 1) != 0) return;
            long now = host.Now;
            allLat.AddRange(lat); allGpu.AddRange(gpuMs);
            host.Emit("ended", "id", Id, "reason", reason, "started", startedAt >= 0,
                "visible_ms", visibleMs + (shown ? now - shownSince : 0), "after_ms", now - playAt,
                "frames_captured", Interlocked.CompareExchange(ref capCount, 0, 0), "frames_presented", totalPresented,
                "lat_p50_ms", Pct(allLat, 50), "lat_p95_ms", Pct(allLat, 95), "gpu_ms", Pct(allGpu, 50), "black", black);
        }
    }
}
