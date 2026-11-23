// Hôte du moteur : une boucle (fil de rendu) relie commandes → ordonnanceur → effets → captures → rendu → surfaces,
// et la couche Entrées (src/Input) pour les effets qui transforment aussi la souris (retournement de l'écran entier).
// Au repos (aucun effet) : aucune fenêtre, aucune capture, cibles intermédiaires libérées, aucun écran modifié.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

namespace Raptoru.Chaos
{
    sealed class EngineOptions
    {
        public int ParentPid, HeartbeatMs = 3000;
        public string ConfigPath = ConfigStore.DefaultPath(), StateDir;
        public bool Guardian = true;
    }

    /// Une cible en cours d'utilisation : sa surface, sa capture (si un effet en a besoin), ses effets.
    sealed class SurfaceEntry
    {
        public Surface S;
        public ICaptureSource Cap;
        public int CaptureUsers;
        public string Device; // écran entier : nom Windows (couche Entrées) ; null en mode fenêtre
        public readonly List<EffectInstance> Effects = new List<EffectInstance>();
        public readonly SurfaceStats Stats = new SurfaceStats();
        public long FirstWaitAt = -1;
    }

    sealed class EngineHost
    {
        const int NeverVisibleMs = 15000, FirstFrameMs = 3000;
        // Couche Entrées : le calque revient PrewarmMs avant la fin prévue (retour animé sans attente) ; si la capture
        // ne revient pas en ExitPrepMaxMs, l'écran est rétabli quand même (sécurité avant l'esthétique).
        const int PrewarmMs = 400, ExitPrepMaxMs = 1500;
        readonly EngineOptions opt;
        readonly Stopwatch clock = Stopwatch.StartNew();
        readonly Registry reg;
        readonly ConfigStore cfg;
        readonly Scheduler sched;
        readonly Telemetry tel = new Telemetry();
        readonly Server io;
        readonly InputLayer input;
        readonly int selfPid = Process.GetCurrentProcess().Id;
        readonly System.Threading.AutoResetEvent frameEvt = new System.Threading.AutoResetEvent(false);
        readonly Dictionary<string, SurfaceEntry> surfaces = new Dictionary<string, SurfaceEntry>();
        readonly Dictionary<string, EffectInstance> instances = new Dictionary<string, EffectInstance>();
        Gpu gpu;
        ShaderLibrary lib;
        TexturePool pool;
        GpuTimer timer;
        TextRaster text;
        CaptureManager caps;
        long nextTelemetry, nextHousekeeping;

        long Now { get { return clock.ElapsedMilliseconds; } }

        public EngineHost(EngineOptions opt)
        {
            this.opt = opt;
            reg = Registry.Embedded();
            var mismatch = EffectCatalog.Mismatches(reg);
            if (mismatch.Count > 0) throw new RegistryError(string.Join(" ; ", mismatch));
            cfg = new ConfigStore(reg, opt.ConfigPath);
            cfg.Load();
            sched = new Scheduler(reg, () => Now, () => cfg.Safety);
            io = new Server(clock, opt.HeartbeatMs, opt.ParentPid, opt.Guardian);
            input = new InputLayer(() => Now);
            io.BeforeQuit = reason => { sched.StopAll(reason); Publish(); input.RevertAll(); };
        }

        public int Run()
        {
            io.Start();
            var render = new System.Threading.Thread(Loop) { IsBackground = true, Name = "render" };
            render.Start();
            render.Join();
            io.Quit("render_exit", 0);
            return 0;
        }

        void Loop()
        {
            try
            {
                long t0 = Now;
                gpu = new Gpu();
                tel.GpuInitMs = Now - t0;
                lib = new ShaderLibrary(gpu, Path.Combine(opt.StateDir ?? Path.GetDirectoryName(opt.ConfigPath) ?? ".", "shader-cache"));
                long t1 = Now;
                lib.Warm();
                tel.ShaderWarmMs = Now - t1;
                pool = new TexturePool(gpu);
                timer = new GpuTimer(gpu);
                text = new TextRaster(gpu);
                caps = new CaptureManager(gpu, timer, frameEvt);
            }
            catch (Exception e)
            {
                io.Send(Protocol.Event("engine.error", Now, J.Map("code", "gpu_init", "message", e.Message)));
                io.Quit("gpu_init", 2);
                return;
            }
            tel.ReadyMs = Now;
            io.Send(Protocol.Event("engine.ready", Now, Hello()));
            var handles = new[] { io.CommandEvt.SafeWaitHandle.DangerousGetHandle(), frameEvt.SafeWaitHandle.DangerousGetHandle() };
            while (true)
            {
                bool fast = surfaces.Values.Any(s => s.S.Shown && (Animating(s) || !s.Effects.Any(e => e.A.Def.RequiresCapture)));
                N.MsgWaitForMultipleObjectsEx(2, handles, fast ? 1u : 15u, N.QS_ALLINPUT, N.MWMO_INPUTAVAILABLE);
                long now = Now;
                tel.Loop(now);
                MSG m;
                while (N.PeekMessageW(out m, IntPtr.Zero, 0, 0, N.PM_REMOVE)) { N.TranslateMessage(ref m); N.DispatchMessageW(ref m); }
                string line;
                while (io.TryTake(out line)) Dispatch(line);
                if (io.TakeEmergencyStop())
                {
                    sched.StopAll("emergency_hotkey");
                    Publish();
                    input.RevertAll();
                    io.Send(Protocol.Event("engine.emergency_stop", now, null));
                }
                sched.Tick();
                Publish();
                RenderAll(now);
                Publish();
                if (now >= nextHousekeeping) Housekeeping(now);
                io.Beat(surfaces.Values.Count(s => s.S.Shown), input.Count);
            }
        }

        bool Animating(SurfaceEntry s)
        {
            long now = Now;
            return s.Effects.Any(e => e.A.Anim != null && (e.A.State == ActState.Active || e.A.State == ActState.Exiting) && e.A.Anim.Animating(now));
        }

        // ---------- Événements de l'ordonnanceur → cycle de vie des effets ----------
        void Publish()
        {
            foreach (var e in sched.Drain())
            {
                if (e.Kind == "accepted") StartInstance(e.A);
                if (e.A.State == ActState.Finished) FinishInstance(e.A);
                io.Send(Protocol.EffectEvent(e, Now));
            }
        }

        void StartInstance(Activation a)
        {
            var inst = new EffectInstance(a, EffectCatalog.Create(a.Def.Id));
            SurfaceEntry s;
            try { s = Attach(a); }
            catch (CaptureError e) { tel.Error(e.Code); sched.MarkFailed(a.Req.RequestId, e.Code, e.Message); return; }
            catch (Exception e) { tel.Error("surface_error"); sched.MarkFailed(a.Req.RequestId, "surface_error", e.Message); return; }
            instances[a.Req.RequestId] = inst;
            inst.HoldsCapture = a.Def.RequiresCapture;
            // Couche Entrées expérimentale : seulement si activée au moment de la demande (vue : target.input).
            if (a.Def.Input != null && a.Req.TargetDevice != null && J.Str(a.Req.TargetInfo, "input", null) != null)
            { inst.Input = InputPhase.Pending; inst.InputDevice = a.Req.TargetDevice; }
            s.Effects.Add(inst);
            var ctx = new EffectContext { Gpu = gpu, Shaders = lib, Text = text, P = a.Req.Resolved };
            if (!inst.Guard("prepare", () => { inst.Impl.Prepare(ctx); inst.State = InstanceState.Prepared; }) ||
                !inst.Guard("start", () => { inst.Impl.Start(); inst.State = InstanceState.Running; }))
            {
                tel.Error("effect_error");
                sched.MarkFailed(a.Req.RequestId, "effect_error", inst.Error);
            }
        }

        SurfaceEntry Attach(Activation a)
        {
            var r = a.Req;
            SurfaceEntry s;
            if (!surfaces.TryGetValue(r.TargetKey, out s))
            {
                ICaptureSource cap = null;
                uint w, h;
                if (a.Def.RequiresCapture) { cap = caps.Acquire(r.TargetKey, r.TargetHwnd, r.TargetHmon); w = cap.Width; h = cap.Height; }
                else
                {
                    RECT b = r.TargetMonitor ? N.MonitorRectOf(r.TargetHmon) : N.FrameBounds(r.TargetHwnd);
                    w = (uint)Math.Max(16, b.Right - b.Left); h = (uint)Math.Max(16, b.Bottom - b.Top);
                }
                Surface surf;
                try { surf = new Surface(gpu, r.TargetKey, r.TargetHwnd, r.TargetHmon, w, h); }
                catch (Exception) { if (cap != null) caps.Release(r.TargetKey, Now); throw; }
                s = new SurfaceEntry { S = surf, Cap = cap, CaptureUsers = cap != null ? 1 : 0, FirstWaitAt = Now, Device = r.TargetDevice };
                surfaces[r.TargetKey] = s;
                return s;
            }
            if (a.Def.RequiresCapture) TakeCapture(s, r);
            if (s.FirstWaitAt < 0) s.FirstWaitAt = Now;
            return s;
        }

        void TakeCapture(SurfaceEntry s, EffectRequest r)
        {
            if (s.Cap == null) { s.Cap = caps.Acquire(r.TargetKey, r.TargetHwnd, r.TargetHmon); s.S.Resize(s.Cap.Width, s.Cap.Height); }
            s.CaptureUsers++;
        }

        void DropCapture(SurfaceEntry s, string key)
        {
            if (--s.CaptureUsers <= 0 && s.Cap != null) { caps.Release(key, Now); s.Cap = null; s.CaptureUsers = 0; }
        }

        void FinishInstance(Activation a)
        {
            EffectInstance inst;
            if (!instances.TryGetValue(a.Req.RequestId, out inst)) return;
            instances.Remove(a.Req.RequestId);
            // L'écran d'abord : quelle que soit la fin (durée, arrêt, STOP ALL, urgence, panne), il redevient normal.
            if (inst.Input == InputPhase.Applied)
            {
                input.Revert(a.Req.RequestId);
                inst.Input = InputPhase.Released;
                InputEvent("restored", a, inst.InputDevice, input.LastRevertMs);
            }
            inst.Finish();
            SurfaceEntry s;
            if (!surfaces.TryGetValue(a.Req.TargetKey, out s)) return;
            if (inst.VisibleSince >= 0) a.VisibleMs = s.S.VisibleMs(Now) - inst.VisibleSince;
            s.Effects.Remove(inst);
            if (inst.HoldsCapture) DropCapture(s, a.Req.TargetKey);
            if (s.Effects.Count == 0)
            {
                // Plus aucun effet sur cette cible : la fenêtre disparaît tout de suite.
                s.S.SetShown(false, Now);
                s.S.Dispose();
                surfaces.Remove(a.Req.TargetKey);
            }
        }

        // ---------- Rendu ----------
        void RenderAll(long now)
        {
            foreach (var s in surfaces.Values.ToList()) RenderSurface(s, now);
        }

        void RenderSurface(SurfaceEntry s, long now)
        {
            var live = s.Effects.Where(e => e.State == InstanceState.Running && e.A.State != ActState.Finished && e.A.State != ActState.Queued)
                .OrderBy(e => e.A.Def.Slot.Order).ThenBy(e => e.A.AcceptedAt).ToList();
            if (live.Count == 0) return;
            if (!s.S.TargetAlive || (s.Cap != null && s.Cap.Lost))
            {
                string why = s.Cap != null && s.Cap.Lost ? (s.Cap.LostReason ?? "capture_lost") : "target_lost";
                foreach (var e in live) sched.Cancel(e.A.Req.RequestId, true, why);
                return;
            }
            if (StepInput(s, live, now)) { s.S.SetShown(false, now); return; }
            bool needsCapture = s.Cap != null;
            bool fresh = needsCapture && s.Cap.Acquire(now);
            if (fresh) s.Stats.CaptureLatency.Add((N.QpcNow() - s.Cap.LastFrameQpc) * 1000.0 / N.QpcFreq());
            if (needsCapture && !s.Cap.HasFrame)
            {
                if (now - s.FirstWaitAt > FirstFrameMs)
                    foreach (var e in live) sched.MarkFailed(e.A.Req.RequestId, "no_frame", "aucune image capturée en 3 s (fenêtre protégée, invisible ou capture refusée)");
                return;
            }
            s.S.Track();
            bool follow = live.All(e => J.Bool(e.A.Req.TargetInfo, "follow_foreground", true)) && cfg.Engine.FollowForeground;
            bool want = !s.S.TargetMinimized && (!follow || s.S.TargetForeground());
            bool animating = Animating(s);
            bool overlayOnly = !needsCapture;
            if (fresh || animating || overlayOnly || (want && !s.S.Shown))
            {
                var fb = new FrameBuilder(s.S.Width, s.S.Height, needsCapture);
                if (tel.Degraded) fb.LowQuality = true;
                if (s.Device != null) fb.DisplayRotationRad = input.RotationDeg(s.Device) * Math.PI / 180;
                foreach (var e in live)
                {
                    // Effet confié à Windows (écran retourné) : il n'a rien à dessiner, le calque sert aux autres effets.
                    if (e.HandedOff) continue;
                    var a = e.A;
                    var f = new EffectFrame
                    {
                        P = a.Req.Resolved, Presence = a.Anim != null ? a.Anim.Presence(now) : 0, NowMs = now,
                        ElapsedMs = a.StartedAt >= 0 ? now - a.StartedAt : 0, Width = s.S.Width, Height = s.S.Height
                    };
                    fb.CurrentLabel = a.Def.Id;
                    if (!e.Guard("update", () => e.Impl.Update(f)) || !e.Guard("render", () => e.Impl.Render(fb, f)))
                    {
                        tel.Error("effect_error");
                        sched.MarkFailed(a.Req.RequestId, "effect_error", e.Error);
                    }
                }
                if (needsCapture && fb.NeedsInputMips) { timer.Begin("capture:mips"); s.Cap.EnsureMips(); timer.End(); }
                fb.Execute(gpu, lib, pool, timer, needsCapture ? s.Cap.Srv : IntPtr.Zero, s.S.BackBuffer, now, now / 1000f);
                // Traitement = de l'arrivée de l'image à l'envoi du rendu ; l'attente du rafraîchissement (Present) n'en
                // fait pas partie (sinon le repli de qualité se déclencherait à tort pendant les rotations).
                long beforePresent = N.QpcNow();
                if (fresh) s.Stats.Processing.Add((beforePresent - s.Cap.LastArrivalQpc) * 1000.0 / N.QpcFreq());
                int hr = s.S.Present(animating || overlayOnly);
                s.Stats.PresentCall.Add((N.QpcNow() - beforePresent) * 1000.0 / N.QpcFreq());
                // Latence ajoutée (estimation, une image sur 4) : l'image du jeu aurait été affichée à sa composition ;
                // sa version transformée l'est à la composition suivant notre Present.
                if (fresh && (++s.Stats.Fresh & 3) == 0)
                {
                    long next = s.S.NextCompositionQpc();
                    if (next > s.Cap.LastFrameQpc) s.Stats.AddedLatency.Add((next - s.Cap.LastFrameQpc) * 1000.0 / N.QpcFreq());
                }
                if (hr < 0)
                {
                    tel.Error("present_failed");
                    io.Send(Protocol.Event("engine.error", now, J.Map("code", "gpu_error", "message", "Present 0x" + hr.ToString("X8") + " : le moteur s'arrête (Studio le relance)")));
                    io.Quit("gpu_error", 4);
                }
            }
            s.S.SetShown(want, now);
            foreach (var e in live)
            {
                var a = e.A;
                if (a.State == ActState.Starting)
                {
                    if (s.S.Shown) { e.VisibleSince = s.S.VisibleMs(now); sched.MarkStarted(a.Req.RequestId); }
                    else if (now - a.AcceptedAt > NeverVisibleMs) sched.Cancel(a.Req.RequestId, true, "never_visible");
                }
            }
        }

        // ---------- Couche Entrées ----------
        /// Écran entier avec transformation d'entrée (retournement) :
        ///   1. l'entrée visuelle tourne l'image (calque + capture, Windows inchangé) ;
        ///   2. à sa fin, Windows retourne l'écran (vrai curseur, souris inversée, clic juste) et, si l'effet est seul sur
        ///      l'écran, le calque se retire : ni fenêtre ni capture pendant l'effet ;
        ///   3. avant la sortie, le calque revient (même image, compensée de la rotation de Windows), Windows rétablit
        ///      l'écran, puis le retour est animé.
        /// Le rendu compense toujours la rotation de Windows (FrameBuilder.DisplayRotationRad) : l'image ne saute pas.
        /// Vrai si tous les effets de la surface ont passé la main à Windows (rien à dessiner).
        bool StepInput(SurfaceEntry s, List<EffectInstance> live, long now)
        {
            foreach (var e in live)
            {
                var a = e.A;
                if (e.Input == InputPhase.Pending && a.State == ActState.Active && a.Anim.Phase == AnimPhase.Steady)
                {
                    try
                    {
                        input.Apply(a.Req.RequestId, a.Def.Input, e.InputDevice);
                        e.Input = InputPhase.Applied;
                        InputEvent("applied", a, e.InputDevice, input.LastApplyMs);
                    }
                    catch (InputError x)
                    {
                        e.Input = InputPhase.None;
                        tel.Error(x.Code);
                        io.Send(Protocol.Event("engine.error", now, J.Map("code", x.Code, "message", x.Message, "request_id", a.Req.RequestId)));
                        sched.Cancel(a.Req.RequestId, false, x.Code);
                        continue;
                    }
                }
                if (e.Input != InputPhase.Applied) continue;
                bool leaving = a.State == ActState.Exiting || a.EndAt - now <= PrewarmMs;
                if (!e.HandedOff && !leaving && live.Count == 1)
                {
                    e.HandedOff = true;
                    if (e.HoldsCapture) { e.HoldsCapture = false; DropCapture(s, a.Req.TargetKey); }
                }
                else if (e.HandedOff && leaving)
                {
                    e.HandedOff = false;
                    e.ExitPrepAt = now;
                    s.FirstWaitAt = now;
                    if (!e.HoldsCapture)
                    {
                        try { TakeCapture(s, a.Req); e.HoldsCapture = true; }
                        catch (Exception x)
                        {
                            tel.Error("capture_error");
                            input.Revert(a.Req.RequestId);
                            e.Input = InputPhase.Released;
                            io.Send(Protocol.Event("engine.error", now, J.Map("code", "capture_error", "message", x.Message)));
                            sched.Cancel(a.Req.RequestId, true, "capture_lost");
                            continue;
                        }
                    }
                }
                if (a.State == ActState.Exiting && !e.HandedOff)
                {
                    if (e.ExitPrepAt < 0) e.ExitPrepAt = now;
                    // Le calque affiche la même image que Windows : on peut rendre l'écran, le retour animé suit.
                    bool ready = s.S.Shown && s.Cap != null && s.Cap.HasFrame;
                    // Le retour animé part d'ici, une fois l'écran rendu (la remise en état prend ~110 ms) : aucun saut d'angle.
                    if (ready || now - e.ExitPrepAt > ExitPrepMaxMs)
                    {
                        input.Revert(a.Req.RequestId);
                        e.Input = InputPhase.Released;
                        a.Anim.HoldExit(Now);
                        InputEvent("restored", a, e.InputDevice, input.LastRevertMs);
                    }
                    else a.Anim.HoldExit(now);
                }
            }
            return live.All(e => e.HandedOff);
        }

        /// Bascule d'affichage (couche Entrées) : horodatée pour les bancs de mesure et le journal de Studio.
        void InputEvent(string state, Activation a, string device, long ms)
        {
            io.Send(Protocol.Event("engine.input", Now, J.Map("state", state, "request_id", a.Req.RequestId, "device", device, "call_ms", ms,
                "qpc", N.QpcNow(), "qpc_freq", N.QpcFreq())));
        }

        // ---------- Entretien, télémétrie ----------
        void Housekeeping(long now)
        {
            nextHousekeeping = now + 250;
            caps.Trim(now, surfaces.Count == 0 ? cfg.Engine.CaptureLingerMs : cfg.Engine.CaptureLingerMs);
            pool.Trim(now, 3000);
            foreach (var s in surfaces.Values) s.S.KeepOnTop();
            // Écran rétabli hors de Chaos (Paramètres de Windows, pilote, autre logiciel) : l'effet perd sa raison d'être.
            foreach (var owner in input.TakeLost())
            {
                EffectInstance lost;
                if (instances.TryGetValue(owner, out lost))
                {
                    lost.Input = InputPhase.Released;
                    InputEvent("lost", lost.A, lost.InputDevice, -1);
                }
                sched.Cancel(owner, true, "display_changed");
            }
            timer.Collect((label, ms) => tel.Pass(label, ms));
            if (now >= nextTelemetry)
            {
                bool idle = surfaces.Count == 0;
                nextTelemetry = now + (idle ? 5000 : cfg.Engine.TelemetryIntervalMs);
                var snap = TelemetrySnapshot(now);
                UpdateDegraded(now, snap);
                if (!idle || tel.Errors.Count > 0) io.Send(Protocol.Event("engine.telemetry", now, snap));
                tel.ResetInterval(now);
                foreach (var s in surfaces.Values) s.Stats.Clear();
            }
        }

        Dictionary<string, object> TelemetrySnapshot(long now)
        {
            double secs = Math.Max(0.001, (now - tel.LastAt) / 1000.0);
            var list = new List<object>();
            foreach (var s in surfaces.Values)
            {
                long frames = s.Cap != null ? s.Cap.Frames : 0, dropped = s.Cap != null ? s.Cap.Dropped : 0;
                list.Add(J.Map("key", s.S.Key, "mode", s.S.MonitorMode ? "C" : "D", "visible", s.S.Shown, "size", s.S.Width + "x" + s.S.Height,
                    "effects", s.Effects.Select(e => e.A.Def.Id).ToArray(),
                    "capture_fps", tel.LastAt == 0 ? 0 : Math.Round((frames - s.Stats.CapFramesAt) / secs, 1),
                    "present_fps", tel.LastAt == 0 ? 0 : Math.Round((s.S.Presented - s.Stats.PresentedAt) / secs, 1),
                    "dropped", dropped - s.Stats.DroppedAt,
                    "processing_p50_ms", s.Stats.Processing.P(50), "processing_p95_ms", s.Stats.Processing.P(95),
                    "capture_latency_p50_ms", s.Stats.CaptureLatency.P(50), "capture_latency_p95_ms", s.Stats.CaptureLatency.P(95),
                    "present_call_p50_ms", s.Stats.PresentCall.P(50), "present_call_p95_ms", s.Stats.PresentCall.P(95),
                    "added_latency_est_p50_ms", s.Stats.AddedLatency.P(50), "added_latency_est_p95_ms", s.Stats.AddedLatency.P(95),
                    "refresh_hz", s.S.RefreshHz,
                    "black", s.Cap != null && s.Cap.Black, "composition_hz", s.S.CompositionHz(),
                    "capture", s.Cap != null ? s.Cap.Info() : null));
                s.Stats.CapFramesAt = frames; s.Stats.DroppedAt = dropped; s.Stats.PresentedAt = s.S.Presented;
            }
            var proc = tel.Process(now);
            return J.Map("surfaces", list.ToArray(), "passes", tel.PassView(), "process", proc, "vram_mb", gpu.VideoMemoryMB(),
                "loop_max_gap_ms", tel.MaxLoopGapMs, "active", sched.Running.Count(), "queued", sched.Queued.Count(),
                "captures_open", caps.Count, "surfaces_open", surfaces.Count, "pool_targets", pool.Live, "text_textures", text.Count,
                "degraded", tel.Degraded, "degraded_reason", tel.DegradedReason, "errors", tel.Errors.ToDictionary(kv => kv.Key, kv => (object)kv.Value));
        }

        /// Repli de qualité (quality = auto) : si le traitement ralentit, le remplissage flou des coins devient noir
        /// (pas de mipmaps) jusqu'au retour à la normale pendant 5 s.
        void UpdateDegraded(long now, Dictionary<string, object> snap)
        {
            if (cfg.Engine.Quality != "auto") { tel.Degraded = false; tel.SlowIntervals = 0; return; }
            // Médianes et p95 sur l'intervalle, jamais un maximum isolé (le démarrage d'une capture coûte une image) ;
            // deux intervalles lents d'affilée avant de réduire la qualité.
            double worst = surfaces.Values.Select(s => s.Stats.Processing.P(95)).DefaultIfEmpty(-1).Max();
            double passP50 = tel.Passes.Values.Where(p => p.Count > 0).Select(p => p.P(50)).DefaultIfEmpty(-1).Max();
            bool slow = worst > 8 || passP50 > 4;
            tel.SlowIntervals = slow ? tel.SlowIntervals + 1 : 0;
            if (tel.SlowIntervals >= 2 && !tel.Degraded)
            {
                tel.Degraded = true; tel.HealthySince = -1;
                tel.DegradedReason = (worst > 8 ? "traitement p95 " + worst + " ms" : "") + (worst > 8 && passP50 > 4 ? ", " : "") + (passP50 > 4 ? "passe GPU médiane " + passP50 + " ms" : "");
                io.Send(Protocol.Event("engine.degraded", now, J.Map("reason", tel.DegradedReason)));
            }
            else if (!slow && tel.Degraded)
            {
                if (tel.HealthySince < 0) tel.HealthySince = now;
                else if (now - tel.HealthySince > 5000) { tel.Degraded = false; tel.DegradedReason = null; io.Send(Protocol.Event("engine.recovered", now, null)); }
            }
        }

        // ---------- Commandes ----------
        Dictionary<string, object> Hello()
        {
            return J.Map("engine", "raptoru-chaos-engine", "version", Program.Version, "protocol", Protocol.Version, "registry_version", reg.Version,
                "implemented", EffectCatalog.Implemented.ToArray(), "adapter", gpu != null ? gpu.Adapter : null, "pid", selfPid,
                "config_path", opt.ConfigPath, "config_notes", cfg.LoadNotes.ToArray(), "ready_ms", tel.ReadyMs, "gpu_init_ms", tel.GpuInitMs,
                "shader_warm_ms", tel.ShaderWarmMs, "emergency_hotkey", "Ctrl+Maj+F11", "input_effects", reg.InputEffects.Keys.ToArray(),
                "input_effects_enabled", cfg.Engine.InputEffects);
        }

        void Dispatch(string line)
        {
            Command c;
            try { c = Protocol.ParseLine(line); }
            catch (ProtocolError e) { io.Send(Protocol.Error(e.Id, e.Code, e.Message)); return; }
            try { io.Send(Protocol.Response(c.Id, Execute(c))); }
            catch (ProtocolError e) { io.Send(Protocol.Error(c.Id, e.Code, e.Message)); }
            catch (ParamError e) { io.Send(Protocol.Error(c.Id, e.Code, e.Message)); }
            catch (ConfigError e) { io.Send(Protocol.Error(c.Id, e.Code, e.Message)); }
            catch (Exception e) { tel.Error("internal"); io.Send(Protocol.Error(c.Id, "internal", e.GetType().Name + " " + e.Message)); }
            Publish();
        }

        object Execute(Command c)
        {
            var b = c.Body;
            long now = Now;
            switch (c.Name)
            {
                case "hello": return Hello();
                case "ping": return J.Map("t_ms", now, "loop_gap_ms", tel.MaxLoopGapMs);
                case "describe":
                    return J.Map("registry", J.Parse(reg.Json), "implemented", EffectCatalog.Implemented.ToArray(),
                        "primitives", new[] { "transform", "filter", "layer" }, "curves", new[] { "linear", "ease_in_out_sine", "ease_in_out_cubic", "ease_in_cubic", "ease_out_cubic" });
                case "status": return Status(now);
                case "diagnostics":
                    var d = TelemetrySnapshot(now);
                    d["shaders"] = J.Map("compiled", lib.Compiled, "from_disk", lib.FromDisk, "compile_ms", Math.Round(lib.CompileMs, 1));
                    d["pool_created"] = pool.Created; d["captures_opened"] = caps.Opened; d["captures_reused"] = caps.Reused;
                    d["guardian"] = J.Map("pid", io.GuardianPid, "restarts", io.GuardianRestarts, "hotkey", io.HotkeyState);
                    d["input"] = input.Describe();
                    d["startup"] = J.Map("ready_ms", tel.ReadyMs, "gpu_init_ms", tel.GpuInitMs, "shader_warm_ms", tel.ShaderWarmMs);
                    return d;
                case "targets.list": return J.Map("monitors", Targets.Monitors().ToArray(), "windows", Targets.Windows(selfPid).ToArray());
                case "effect.request":
                    var req = Protocol.BuildRequest(b, reg, cfg, (spec, def) => Targets.Resolve(spec, cfg.Engine.DefaultMode, selfPid, def, cfg.Engine.InputEffects));
                    var a = sched.Submit(req);
                    return Protocol.View(a, Now);
                case "effect.cancel":
                    string rid = J.Str(b, "request_id", null);
                    if (sched.Find(rid) == null) throw new ProtocolError("unknown_request", "demande inconnue : " + rid);
                    return J.Map("canceled", sched.Cancel(rid, J.Bool(b, "immediate", false), J.Str(b, "reason", "canceled")));
                case "stop_all": return J.Map("stopped", sched.StopAll(J.Str(b, "reason", "stop_all")));
                case "config.get": return cfg.ToJson();
                case "config.set":
                    string section = J.Str(b, "section", "");
                    var values = J.Obj(b, "values") ?? new Dictionary<string, object>();
                    if (section == "engine") cfg.SetEngine(values);
                    else if (section == "safety") cfg.SetSafety(values);
                    else throw new ConfigError("invalid_config", "section modifiable : engine ou safety");
                    cfg.Save();
                    return cfg.ToJson();
                case "config.reset": cfg.Reset(J.Str(b, "section", null)); cfg.Save(); return cfg.ToJson();
                case "preset.set": cfg.SetPreset(J.Str(b, "effect", ""), J.Str(b, "name", ""), J.Obj(b, "value")); cfg.Save(); return cfg.ToJson();
                case "preset.delete": cfg.DeletePreset(J.Str(b, "effect", ""), J.Str(b, "name", "")); cfg.Save(); return cfg.ToJson();
                case "shutdown":
                    sched.StopAll("shutdown"); Publish();
                    io.Send(Protocol.Response(c.Id, J.Map("bye", true)));
                    io.Quit("shutdown", 0);
                    return null;
            }
            throw new ProtocolError("unknown_command", c.Name);
        }

        Dictionary<string, object> Status(long now)
        {
            return J.Map(
                "engine", Hello(),
                "active", sched.Running.Select(a => (object)Protocol.View(a, now)).ToArray(),
                "queued", sched.Queued.Select(a => (object)Protocol.View(a, now)).ToArray(),
                "surfaces", surfaces.Values.Select(s => (object)J.Map("key", s.S.Key, "mode", s.S.MonitorMode ? "C" : "D", "visible", s.S.Shown,
                    "size", s.S.Width + "x" + s.S.Height, "capture", s.Cap != null ? s.Cap.Info() : null, "effects", s.Effects.Select(e => e.A.Req.RequestId).ToArray())).ToArray(),
                "captures_open", caps.Count, "degraded", tel.Degraded,
                "guardian", J.Map("pid", io.GuardianPid, "hotkey", io.HotkeyState),
                "input", input.Describe(),
                "config", cfg.ToJson());
        }
    }
}
