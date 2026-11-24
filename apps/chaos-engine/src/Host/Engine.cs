// Hôte du moteur : une boucle (fil de rendu) relie commandes → ordonnanceur → effets → captures → rendu → surfaces,
// et la couche Entrées (src/Input) pour les effets qui transforment aussi la souris (retournement de l'écran entier).
// Au repos (aucun effet) : aucune fenêtre, aucune capture, cibles intermédiaires libérées, aucun écran modifié, un
// réveil toutes les 250 ms. Rendu (docs/chaos/PERFORMANCES_MOTEUR.md) : une image par nouvelle capture, ou par retour
// de balayage de l'écran de la cible (Pacer) quand l'image change sans capture (animation, calque) ; jamais d'image
// identique redessinée, rien quand la cible est masquée ; Present sans attente.
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
        public string CapKey;
        public int CaptureUsers;
        public string Device; // écran entier : nom Windows (couche Entrées) ; null en mode fenêtre
        public readonly List<EffectInstance> Effects = new List<EffectInstance>();
        public readonly SurfaceStats Stats = new SurfaceStats();
        public long FirstWaitAt = -1;
        // Rendu : constructeur d'image réutilisé, effets vivants (tampon), dernière empreinte présentée, rythmeur.
        public FrameBuilder Fb;
        public readonly List<EffectInstance> Live = new List<EffectInstance>();
        public readonly List<string> FrameLabels = new List<string>();
        public long LastSig, LastRenderQpc, PacerSeen;
        public bool HasSig, PendingFresh, WantsTicks;
        public Pacer Pacer;
        public double GpuFrameEstMs = -1;
        /// Curseur : un effet de la surface le fait suivre l'image, et le vrai curseur est au-dessus de la cible.
        public bool FollowsCursor, CursorOver;
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
        readonly CursorLayer cursor = new CursorLayer();
        CursorImages cursorImages;
        CursorSample cursorNow;
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
        readonly Dictionary<IntPtr, Pacer> pacers = new Dictionary<IntPtr, Pacer>();
        Action<string, double> passSink;

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
            // Le curseur d'abord : quelle que soit la raison de l'arrêt, il redevient visible avant tout le reste.
            io.BeforeQuit = reason => { cursor.Restore(); sched.StopAll(reason); Publish(); input.RevertAll(); };
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
                cursorImages = new CursorImages(gpu);
                caps = new CaptureManager(gpu, timer, frameEvt);
                passSink = tel.Pass;
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
                // Réveils : commande, nouvelle capture ou retour de balayage (rythmeur) ; sinon 15 ms pendant un effet
                // (fin d'effet, transition sans nouvelle image), 250 ms au repos (entretien, battement).
                bool active = surfaces.Count > 0 || instances.Count > 0;
                N.MsgWaitForMultipleObjectsEx(2, handles, active ? 15u : 250u, N.QS_ALLINPUT, N.MWMO_INPUTAVAILABLE);
                long now = Now;
                tel.Loop(now);
                MSG m;
                while (N.PeekMessageW(out m, IntPtr.Zero, 0, 0, N.PM_REMOVE)) { N.TranslateMessage(ref m); N.DispatchMessageW(ref m); }
                string line;
                while (io.TryTake(out line)) Dispatch(line);
                if (io.TakeEmergencyStop())
                {
                    cursor.SetHidden(false, now);
                    sched.StopAll("emergency_hotkey");
                    Publish();
                    input.RevertAll();
                    io.Send(Protocol.Event("engine.emergency_stop", now, null));
                }
                sched.Tick();
                Publish();
                RenderAll(now);
                Publish();
                if (active) timer.Collect(passSink);
                if (now >= nextHousekeeping) Housekeeping(now);
                int shown = 0;
                foreach (var sf in surfaces.Values) if (sf.S.Shown) shown++;
                io.Beat(shown, input.Count, cursor.Hidden);
            }
        }

        bool Animating(SurfaceEntry s)
        {
            long now = Now;
            foreach (var e in s.Effects)
                if (e.A.Anim != null && (e.A.State == ActState.Active || e.A.State == ActState.Exiting) && e.A.Anim.Animating(now)) return true;
            return false;
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
            var inst = new EffectInstance(a, EffectCatalog.Create(a.Def.Id)) { Seed = EffectCatalog.SeedOf(a.Req.RequestId) };
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
            var ctx = new EffectContext { Gpu = gpu, Shaders = lib, Text = text, P = a.Req.Resolved, Seed = inst.Seed };
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
                string capKey = CaptureManager.KeyOf(r.TargetKey, r.TargetHmon, r.TargetComposed);
                uint w, h;
                if (a.Def.RequiresCapture) { cap = caps.Acquire(capKey, r.TargetHwnd, r.TargetHmon, r.TargetComposed); w = cap.Width; h = cap.Height; }
                else
                {
                    // Calque sans capture : la surface couvre la cible (l'écran entier pour une cible « écran »).
                    RECT b = r.TargetHmon != IntPtr.Zero ? N.MonitorRectOf(r.TargetHmon) : N.FrameBounds(r.TargetHwnd);
                    w = (uint)Math.Max(16, b.Right - b.Left); h = (uint)Math.Max(16, b.Bottom - b.Top);
                }
                Surface surf;
                // Exclue des captures dès sa création seulement si elle lit la capture de son propre écran (mode C).
                try { surf = new Surface(gpu, r.TargetKey, r.TargetHwnd, r.TargetHmon, w, h, r.TargetComposed, cap != null && cap.CapturesScreen && !r.TargetComposed); }
                catch (Exception) { if (cap != null) caps.Release(capKey, Now); throw; }
                s = new SurfaceEntry { S = surf, Cap = cap, CapKey = cap != null ? capKey : null, CaptureUsers = cap != null ? 1 : 0, FirstWaitAt = Now, Device = r.TargetDevice, Fb = new FrameBuilder(w, h, cap != null) };
                surfaces[r.TargetKey] = s;
                return s;
            }
            if (a.Def.RequiresCapture) TakeCapture(s, r);
            if (s.FirstWaitAt < 0) s.FirstWaitAt = Now;
            return s;
        }

        void TakeCapture(SurfaceEntry s, EffectRequest r)
        {
            if (s.Cap == null)
            {
                s.CapKey = CaptureManager.KeyOf(r.TargetKey, r.TargetHmon, r.TargetComposed);
                s.Cap = caps.Acquire(s.CapKey, r.TargetHwnd, r.TargetHmon, r.TargetComposed);
                s.S.Resize(s.Cap.Width, s.Cap.Height);
            }
            s.CaptureUsers++;
        }

        void DropCapture(SurfaceEntry s, string key)
        {
            if (--s.CaptureUsers <= 0 && s.Cap != null) { caps.Release(s.CapKey, Now); s.Cap = null; s.CapKey = null; s.CaptureUsers = 0; }
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
                // Plus aucun effet sur cette cible : la fenêtre disparaît tout de suite, le curseur revient avec elle.
                if (s.CursorOver) cursor.SetHidden(false, Now);
                s.S.SetShown(false, Now);
                s.S.Dispose();
                surfaces.Remove(a.Req.TargetKey);
            }
        }

        // ---------- Rendu ----------
        readonly List<SurfaceEntry> renderList = new List<SurfaceEntry>();
        static readonly Comparison<EffectInstance> ByOrder = (x, y) =>
        {
            int c = x.A.Def.Order.CompareTo(y.A.Def.Order);
            return c != 0 ? c : x.A.AcceptedAt.CompareTo(y.A.AcceptedAt);
        };

        void RenderAll(long now)
        {
            renderList.Clear();
            renderList.AddRange(surfaces.Values);
            // Curseur (docs/chaos/ETUDE_CURSEUR.md) : masqué seulement s'il est au-dessus d'une cible affichée dont un
            // effet le fait suivre l'image ; décidé AVANT le rendu, pour que l'image de cette passe porte déjà le curseur.
            cursorNow = CursorLayer.Read();
            bool hide = false;
            foreach (var s in renderList)
            {
                s.FollowsCursor = FollowsCursor(s);
                RECT b = s.S.Bounds;
                s.CursorOver = s.FollowsCursor && s.S.Shown && cursorNow.Ok && cursorNow.X >= b.Left && cursorNow.X < b.Right && cursorNow.Y >= b.Top && cursorNow.Y < b.Bottom;
                hide |= s.CursorOver;
            }
            cursor.SetHidden(hide, now);
            foreach (var s in renderList) RenderSurface(s, now);
            // Un rythmeur par écran, réveillé seulement si une surface de cet écran attend des images cadencées.
            foreach (var p in pacers.Values)
            {
                bool need = false;
                foreach (var s in renderList) if (s.Pacer == p && s.WantsTicks) need = true;
                p.Need(need);
            }
        }

        /// Un effet en cours de la surface fait suivre l'image au curseur (registre "cursor": "follow"), sauf si Windows
        /// retourne lui-même l'écran (couche Entrées expérimentale : son curseur est déjà le bon).
        bool FollowsCursor(SurfaceEntry s)
        {
            if (!cfg.Engine.CursorFollow || (s.Device != null && input.RotationDeg(s.Device) != 0)) return false;
            foreach (var e in s.Effects)
                if (e.A.Def.Cursor == "follow" && cfg.Effect(e.A.Def.Id).Cursor && e.State == InstanceState.Running && !e.HandedOff &&
                    (e.A.State == ActState.Active || e.A.State == ActState.Exiting || e.A.State == ActState.Starting)) return true;
            return false;
        }

        Pacer PacerFor(Surface surf)
        {
            Pacer p;
            if (!pacers.TryGetValue(surf.Hmon, out p)) pacers[surf.Hmon] = p = new Pacer(gpu, surf.Hmon, surf.RefreshHz, frameEvt);
            return p;
        }

        /// Cadence de traitement d'une surface : fréquence de son écran, plafonnée par performance.max_fps, divisée par
        /// deux au palier 3 de surcharge.
        double RateHz(SurfaceEntry s)
        {
            double hz = s.S.RefreshHz, cap = cfg.Performance.MaxFps > 0 ? Math.Min(hz, cfg.Performance.MaxFps) : hz;
            return tel.Level >= 3 ? cap / 2 : cap;
        }

        void RenderSurface(SurfaceEntry s, long now)
        {
            var live = s.Live;
            live.Clear();
            s.WantsTicks = false;
            foreach (var e in s.Effects) if (e.State == InstanceState.Running && e.A.State != ActState.Finished && e.A.State != ActState.Queued) live.Add(e);
            if (live.Count == 0) return;
            if (live.Count > 1) live.Sort(ByOrder);
            if (!s.S.TargetAlive || (s.Cap != null && s.Cap.Lost))
            {
                string why = s.Cap != null && s.Cap.Lost ? (s.Cap.LostReason ?? "capture_lost") : "target_lost";
                foreach (var e in live) sched.Cancel(e.A.Req.RequestId, true, why);
                return;
            }
            if (StepInput(s, live, now)) { s.S.SetShown(false, now); return; }
            bool needsCapture = s.Cap != null;
            // Exclusion des captures (docs/chaos/ECRAN_ENTIER.md) : seulement tant que la surface lit une capture de son
            // propre écran ; sinon la capture d'écran d'OBS la voit. Images composées avant l'exclusion ignorées.
            bool excl = needsCapture && s.Cap.CapturesScreen;
            if (excl != s.S.Excluded)
            {
                if (!s.S.SetExcluded(excl))
                {
                    foreach (var e in live) sched.MarkFailed(e.A.Req.RequestId, "exclusion_failed", "impossible d'exclure le calque des captures : il se capturerait lui-même");
                    return;
                }
                if (excl && s.S.Shown) s.Cap.NotBefore(N.QpcNow());
            }
            double rate = RateHz(s);
            bool capped = rate < s.S.RefreshHz - 0.5;
            if (needsCapture) { s.Cap.ZeroCopy = cfg.Performance.ZeroCopy; s.Cap.SetMinInterval(capped ? 1000.0 / rate : 1); }
            bool fresh = needsCapture && s.Cap.Acquire(now);
            if (fresh) { s.Stats.CaptureLatency.Add((N.QpcNow() - s.Cap.LastFrameQpc) * 1000.0 / N.QpcFreq()); s.PendingFresh = true; }
            if (needsCapture && !s.Cap.HasFrame)
            {
                if (now - s.FirstWaitAt > FirstFrameMs)
                    foreach (var e in live) sched.MarkFailed(e.A.Req.RequestId, "no_frame", "aucune image capturée en 3 s (fenêtre protégée, invisible ou capture refusée)");
                return;
            }
            s.S.Track();
            bool follow = cfg.Engine.FollowForeground;
            foreach (var e in live) if (!J.Bool(e.A.Req.TargetInfo, "follow_foreground", true)) follow = false;
            bool want = !s.S.TargetMinimized && (!follow || s.S.TargetForeground());
            if (!want)
            {
                // Cible masquée (autre fenêtre au premier plan, fenêtre réduite) : ni rendu ni présentation. La capture
                // continue : l'image est à jour dès le retour au premier plan.
                s.S.SetShown(false, now);
                if (fresh) s.Stats.SkippedHidden++;
                UpdateStarting(s, live, now);
                return;
            }
            // Images cadencées (rythmeur de l'écran) : animation, calque sans capture, ou cadence plafonnée.
            // (curseur suivi : une image par rafraîchissement au plus, dès qu'il bouge ou change de forme)
            bool timed = Animating(s) || !needsCapture || (capped && s.PendingFresh) || s.FollowsCursor;
            if (timed && s.Pacer == null) s.Pacer = PacerFor(s.S);
            s.WantsTicks = timed;
            bool tick = s.Pacer != null && s.Pacer.Ticks != s.PacerSeen;
            if (tick) s.PacerSeen = s.Pacer.Ticks;
            // Images cadencées : une par retour de balayage (avec la capture la plus récente), jamais deux par période ;
            // sinon une par nouvelle capture.
            bool due = !s.S.Shown || (timed ? tick : s.PendingFresh);
            // Cadence plafonnée : au plus une image (la plus récente) par période.
            if (due && capped && s.S.Shown && N.QpcNow() - s.LastRenderQpc < (long)(N.QpcFreq() / rate * 0.9)) due = false;
            if (!due) { UpdateStarting(s, live, now); return; }

            var fb = s.Fb;
            fb.Reset(s.S.Width, s.S.Height, needsCapture);
            fb.LowQuality = tel.Level >= 1;
            fb.Scale = tel.Level >= 2 ? Math.Min(cfg.Performance.RenderScale, 0.5) : cfg.Performance.RenderScale;
            if (s.Device != null) fb.DisplayRotationRad = input.RotationDeg(s.Device) * Math.PI / 180;
            int maxPasses = cfg.Performance.MaxPasses;
            foreach (var e in live)
            {
                // Effet confié à Windows (écran retourné) : il n'a rien à dessiner, le calque sert aux autres effets.
                if (e.HandedOff) continue;
                var a = e.A;
                var f = e.Frame;
                f.P = a.Req.Resolved; f.Presence = a.Anim != null ? a.Anim.Presence(now) : 0; f.NowMs = now;
                f.ElapsedMs = a.StartedAt >= 0 ? now - a.StartedAt : 0; f.Width = s.S.Width; f.Height = s.S.Height;
                f.Seed = e.Seed; f.Exiting = a.State == ActState.Exiting;
                fb.CurrentLabel = a.Def.Id;
                int passesBefore = fb.PassCount, layersBefore = fb.LayerCount;
                if (!e.Guard("update", () => e.Impl.Update(f)) || !e.Guard("render", () => e.Impl.Render(fb, f)))
                {
                    fb.Truncate(passesBefore, layersBefore);
                    tel.Error("effect_error");
                    sched.MarkFailed(a.Req.RequestId, "effect_error", e.Error);
                }
                else if (fb.PassCount > maxPasses)
                {
                    // Budget de passes dépassé : cet effet seul est retiré (les autres continuent), refus explicite.
                    fb.Truncate(passesBefore, layersBefore);
                    e.Fail("trop coûteux : plus de " + maxPasses + " passes GPU par image (performance.max_passes)");
                    tel.Error("too_costly");
                    sched.MarkFailed(a.Req.RequestId, "too_costly", e.Error);
                }
            }
            // Image du vrai curseur, posée par la transformation de l'image (dernier calque, par-dessus tout).
            bool drawCursor = s.CursorOver && cursor.Hidden && cursorNow.Visible;
            if (drawCursor)
            {
                var img = cursorImages.Get(cursorNow.Shape);
                RECT b = s.S.Bounds;
                if (img != null) fb.AddCursor(img.Tex, img.HotX, img.HotY, cursorNow.X - b.Left, cursorNow.Y - b.Top);
                else drawCursor = false;
            }
            long sig = fb.Signature(lib, now / 1000f);
            if (!s.PendingFresh && s.S.Shown && s.HasSig && sig == s.LastSig)
            {
                // Rien n'a changé (calque immobile, même image du jeu) : ni rendu ni présentation.
                s.Stats.SkippedStatic++;
                UpdateStarting(s, live, now);
                return;
            }
            if (needsCapture && fb.NeedsInputMips) s.Cap.EnsureMips();
            fb.Execute(gpu, lib, pool, timer, needsCapture ? s.Cap.Srv : IntPtr.Zero, s.S.BackBuffer, now, now / 1000f);
            long beforePresent = N.QpcNow();
            // Traitement = de l'arrivée de l'image à l'envoi du rendu (attente volontaire d'une cadence plafonnée comprise).
            if (s.PendingFresh && needsCapture) s.Stats.Processing.Add((beforePresent - s.Cap.LastArrivalQpc) * 1000.0 / N.QpcFreq());
            int hr = s.S.Present(false);
            s.Stats.PresentCall.Add((N.QpcNow() - beforePresent) * 1000.0 / N.QpcFreq());
            // Retard du curseur dessiné (estimation) : position lue → composition prévue de cette image. Le curseur
            // matériel, lui, est placé par Windows à chaque composition.
            if (drawCursor)
            {
                long nextComp = s.S.NextCompositionQpc();
                if (nextComp > cursorNow.Qpc) s.Stats.CursorLatency.Add((nextComp - cursorNow.Qpc) * 1000.0 / N.QpcFreq());
            }
            // Latence ajoutée (estimation, une image sur 4) : l'image du jeu aurait été affichée à sa composition ;
            // sa version transformée l'est à la composition suivant notre Present.
            if (s.PendingFresh && needsCapture && (++s.Stats.Fresh & 3) == 0)
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
            s.LastSig = sig; s.HasSig = true; s.LastRenderQpc = N.QpcNow(); s.PendingFresh = false;
            s.FrameLabels.Clear();
            fb.Labels(s.FrameLabels);
            s.S.SetShown(true, now);
            // Capture rendue par un effet qui n'en a plus besoin (flash : image retenue à cette image) : si plus aucun
            // effet de la cible ne la lit, la fenêtre redevient transparente et le jeu se voit directement.
            foreach (var e in live)
                if (e.HoldsCapture && e.State == InstanceState.Running && !e.Impl.NeedsCapture) { e.HoldsCapture = false; DropCapture(s, e.A.Req.TargetKey); }
            UpdateStarting(s, live, now);
        }

        /// Une demande devient « démarrée » à sa première image visible (jamais visible en 15 s : annulée).
        void UpdateStarting(SurfaceEntry s, List<EffectInstance> live, long now)
        {
            foreach (var e in live)
            {
                var a = e.A;
                if (a.State != ActState.Starting) continue;
                if (s.S.Shown) { e.VisibleSince = s.S.VisibleMs(now); sched.MarkStarted(a.Req.RequestId); }
                else if (now - a.AcceptedAt > NeverVisibleMs) sched.Cancel(a.Req.RequestId, true, "never_visible");
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
            foreach (var s in surfaces.Values) { s.S.KeepOnTop(); s.GpuFrameEstMs = FrameGpuEstimate(s); }
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
            if (now >= nextTelemetry)
            {
                bool idle = surfaces.Count == 0;
                nextTelemetry = now + (idle ? 5000 : cfg.Engine.TelemetryIntervalMs);
                var snap = TelemetrySnapshot(now);
                UpdateOverload(now);
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
                list.Add(J.Map("key", s.S.Key, "mode", s.S.Mode, "visible", s.S.Shown, "excluded", s.S.Excluded, "size", s.S.Width + "x" + s.S.Height,
                    "effects", s.Effects.Select(e => e.A.Def.Id).ToArray(),
                    "capture_fps", tel.LastAt == 0 ? 0 : Math.Round((frames - s.Stats.CapFramesAt) / secs, 1),
                    "present_fps", tel.LastAt == 0 ? 0 : Math.Round((s.S.Presented - s.Stats.PresentedAt) / secs, 1),
                    "dropped", dropped - s.Stats.DroppedAt,
                    "processing_p50_ms", s.Stats.Processing.P(50), "processing_p95_ms", s.Stats.Processing.P(95),
                    "capture_latency_p50_ms", s.Stats.CaptureLatency.P(50), "capture_latency_p95_ms", s.Stats.CaptureLatency.P(95),
                    "present_call_p50_ms", s.Stats.PresentCall.P(50), "present_call_p95_ms", s.Stats.PresentCall.P(95),
                    "added_latency_est_p50_ms", s.Stats.AddedLatency.P(50), "added_latency_est_p95_ms", s.Stats.AddedLatency.P(95),
                    "refresh_hz", s.S.RefreshHz, "rate_hz", Math.Round(RateHz(s), 1), "pacer", s.Pacer != null ? s.Pacer.Mode : null,
                    "skipped_static", s.Stats.SkippedStatic - s.Stats.SkippedStaticAt, "skipped_hidden", s.Stats.SkippedHidden - s.Stats.SkippedHiddenAt,
                    "frame_gpu_est_ms", Math.Round(s.GpuFrameEstMs, 3),
                    "cursor_follow", s.FollowsCursor, "cursor_over", s.CursorOver,
                    "cursor_latency_est_p50_ms", s.Stats.CursorLatency.P(50), "cursor_latency_est_p95_ms", s.Stats.CursorLatency.P(95),
                    "black", s.Cap != null && s.Cap.Black, "composition_hz", s.S.CompositionHz(),
                    "capture", s.Cap != null ? s.Cap.Info() : null));
                s.Stats.CapFramesAt = frames; s.Stats.DroppedAt = dropped; s.Stats.PresentedAt = s.S.Presented;
                s.Stats.SkippedStaticAt = s.Stats.SkippedStatic; s.Stats.SkippedHiddenAt = s.Stats.SkippedHidden;
            }
            var proc = tel.Process(now);
            return J.Map("surfaces", list.ToArray(), "passes", tel.PassView(), "process", proc, "vram_mb", gpu.VideoMemoryMB(),
                "loop_max_gap_ms", tel.MaxLoopGapMs, "active", sched.Running.Count(), "queued", sched.Queued.Count(),
                "captures_open", caps.Count, "surfaces_open", surfaces.Count, "pool_targets", pool.Live, "text_textures", text.Count,
                "degraded", tel.Degraded, "degraded_reason", tel.DegradedReason,
                "performance", J.Map("profile", cfg.Performance.Profile, "level", tel.Level, "over_budget", tel.OverBudget, "gpu_budget_ms", cfg.Performance.GpuBudgetMs),
                "cursor", CursorView(now),
                "errors", tel.Errors.ToDictionary(kv => kv.Key, kv => (object)kv.Value));
        }

        /// Temps GPU estimé d'une image de la surface : médiane de chaque passe de la dernière image, plus la copie et les
        /// mipmaps de la capture s'il y en a eu dans l'intervalle.
        double FrameGpuEstimate(SurfaceEntry s)
        {
            if (s.FrameLabels.Count == 0) return -1;
            double t = 0;
            Samples x;
            foreach (var l in s.FrameLabels) if (tel.Passes.TryGetValue(l, out x) && x.Count > 0) t += x.P(50);
            if (s.Cap != null)
                foreach (var l in new[] { "capture:copy", "capture:mips" }) if (tel.Passes.TryGetValue(l, out x) && x.Count > 0) t += x.P(50);
            return t;
        }

        /// Surcharge (docs/chaos/PERFORMANCES_MOTEUR.md) : temps GPU estimé par image au-delà de performance.gpu_budget_ms,
        /// ou traitement p95 au-delà d'une période d'image, deux intervalles de suite.
        ///   on_overload = reduire  : un palier de plus, annoncé (engine.degraded) — 1 coins noirs au lieu du flou,
        ///                            2 passes intermédiaires à demi-résolution, 3 cadence divisée par deux ;
        ///                            retour d'un palier après 5 s saines (engine.recovered).
        ///   on_overload = signaler : un événement engine.over_budget, aucune modification.
        void UpdateOverload(long now)
        {
            var pf = cfg.Performance;
            double gpuMs = -1, lateMs = 0;
            foreach (var s in surfaces.Values)
            {
                gpuMs = Math.Max(gpuMs, s.GpuFrameEstMs);
                double rate = RateHz(s), period = 1000.0 / Math.Max(1, rate) * (rate < s.S.RefreshHz - 0.5 ? 2 : 1);
                double p95 = s.Stats.Processing.P(95);
                if (p95 > period) lateMs = Math.Max(lateMs, p95 - period);
            }
            bool overGpu = gpuMs > pf.GpuBudgetMs, late = lateMs > 0;
            bool slow = overGpu || late;
            if (pf.OnOverload == "signaler" && tel.Level > 0)
            {
                // Passage en « signaler » : la qualité revient tout de suite.
                tel.Level = 0; tel.Degraded = false; tel.DegradedReason = null;
                io.Send(Protocol.Event("engine.recovered", now, J.Map("level", 0, "reason", "on_overload_signaler")));
            }
            tel.SlowIntervals = slow ? tel.SlowIntervals + 1 : 0;
            if (tel.SlowIntervals >= 2)
            {
                tel.SlowIntervals = 0; tel.HealthySince = -1;
                string reason = (overGpu ? "GPU " + Math.Round(gpuMs, 2) + " ms par image (budget " + pf.GpuBudgetMs + " ms)" : "") + (overGpu && late ? ", " : "") +
                    (late ? "traitement en retard de " + Math.Round(lateMs, 1) + " ms" : "");
                if (pf.OnOverload == "reduire" && tel.Level < 3)
                {
                    tel.Level++; tel.Degraded = true; tel.DegradedReason = reason;
                    string action = tel.Level == 1 ? "coins noirs au lieu du flou" : tel.Level == 2 ? "passes intermédiaires à demi-résolution" : "cadence divisée par deux";
                    io.Send(Protocol.Event("engine.degraded", now, J.Map("reason", reason, "level", tel.Level, "action", action)));
                }
                else if (!tel.OverBudget)
                {
                    tel.OverBudget = true;
                    io.Send(Protocol.Event("engine.over_budget", now, J.Map("reason", reason, "level", tel.Level)));
                }
            }
            else if (!slow && (tel.Level > 0 || tel.OverBudget))
            {
                if (tel.HealthySince < 0) tel.HealthySince = now;
                else if (now - tel.HealthySince >= 5000)
                {
                    tel.HealthySince = now;
                    if (tel.Level > 0) tel.Level--;
                    tel.OverBudget = false;
                    tel.Degraded = tel.Level > 0;
                    if (!tel.Degraded) tel.DegradedReason = null;
                    io.Send(Protocol.Event("engine.recovered", now, J.Map("level", tel.Level)));
                }
            }
        }

        // ---------- Commandes ----------
        Dictionary<string, object> Hello()
        {
            return J.Map("engine", "raptoru-chaos-engine", "version", Program.Version, "protocol", Protocol.Version, "registry_version", reg.Version,
                "implemented", EffectCatalog.Implemented.ToArray(), "adapter", gpu != null ? gpu.Adapter : null, "pid", selfPid,
                "config_path", opt.ConfigPath, "config_notes", cfg.LoadNotes.ToArray(), "ready_ms", tel.ReadyMs, "gpu_init_ms", tel.GpuInitMs,
                "shader_warm_ms", tel.ShaderWarmMs, "emergency_hotkey", "Ctrl+Maj+F11", "input_effects", reg.InputEffects.Keys.ToArray(),
                "input_effects_enabled", cfg.Engine.InputEffects, "cursor_follow", cfg.Engine.CursorFollow,
                "commands", Protocol.Commands);
        }

        Dictionary<string, object> CursorView(long now)
        {
            return J.Map("enabled", cfg.Engine.CursorFollow, "hidden", cursor.Hidden, "hides", cursor.Hides, "hidden_ms", cursor.HiddenTotalMs(now),
                "shapes", cursorImages != null ? cursorImages.Built : 0, "failures", cursor.Failures, "last_error", cursor.LastError);
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
                    d["cursor"] = CursorView(now);
                    d["pacers"] = pacers.Values.Select(p => (object)J.Map("hz", p.Hz, "mode", p.Mode, "ticks", p.Ticks)).ToArray();
                    d["startup"] = J.Map("ready_ms", tel.ReadyMs, "gpu_init_ms", tel.GpuInitMs, "shader_warm_ms", tel.ShaderWarmMs);
                    return d;
                case "targets.list":
                    // windows = false : les écrans seulement (relevé régulier de la page Chaos, sans parcourir les fenêtres).
                    return J.Map("monitors", Targets.Monitors().ToArray(), "windows", J.Bool(b, "windows", true) ? Targets.Windows(selfPid).ToArray() : new object[0]);
                case "effect.request":
                    var req = Protocol.BuildRequest(b, reg, cfg, (spec, def) => Targets.Resolve(spec, cfg.Engine.DefaultMode, selfPid, def, cfg.Engine.InputEffects));
                    CheckAllowed(req);
                    var a = sched.Submit(req);
                    return Protocol.View(a, Now);
                case "effect.cancel":
                    string rid = J.Str(b, "request_id", null);
                    if (sched.Find(rid) == null) throw new ProtocolError("unknown_request", "demande inconnue : " + rid);
                    return J.Map("canceled", sched.Cancel(rid, J.Bool(b, "immediate", false), J.Str(b, "reason", "canceled")));
                case "effect.activate": return Activate(b);
                case "effect.stop":
                    string eid = J.Str(b, "effect", null);
                    if (reg.Get(eid) == null) throw new ProtocolError("unknown_effect", "effet inconnu : " + eid);
                    int stopped = 0;
                    foreach (var act in sched.Running.Concat(sched.Queued).Where(x => x.Def.Id == eid).ToList())
                        if (sched.Cancel(act.Req.RequestId, J.Bool(b, "immediate", false), "stopped")) stopped++;
                    return J.Map("effect", eid, "stopped", stopped);
                case "stop_all": return J.Map("stopped", sched.StopAll(J.Str(b, "reason", "stop_all")));
                case "config.get": return cfg.ToJson();
                case "config.set":
                    string section = J.Str(b, "section", "");
                    var values = J.Obj(b, "values") ?? new Dictionary<string, object>();
                    if (section == "engine") cfg.SetEngine(values);
                    else if (section == "safety") cfg.SetSafety(values);
                    else if (section == "performance") cfg.SetPerformance(values);
                    else if (section == "effects") cfg.SetEffects(values);
                    else throw new ConfigError("invalid_config", "section modifiable : engine, safety, performance ou effects");
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

        /// Durée d'un essai depuis la fiche (Tester) : assez pour voir l'entrée, l'effet et la sortie.
        const int TestMs = 5000;

        /// Refus communs à toute demande : coût déclaré au-delà du profil ; effet désactivé pour une source communautaire.
        void CheckAllowed(EffectRequest req)
        {
            if (req.Def.Photosensitive && cfg.Safety.SafeMode)
                throw new ProtocolError("safe_mode", req.Def.Label + " : effet lumineux brusque, refusé en mode sûr");
            if (req.Def.GpuPasses > cfg.Performance.MaxPasses)
                throw new ProtocolError("too_costly", req.Def.Id + " : " + req.Def.GpuPasses + " passes GPU déclarées, " + cfg.Performance.MaxPasses + " permises (profil " + cfg.Performance.Profile + ")");
            if (!cfg.Effect(req.Def.Id).Enabled && req.SourceKind != "studio" && req.SourceKind != "test")
                throw new ProtocolError("effect_disabled", req.Def.Label + " est désactivé (fiche de l'effet dans Studio)");
        }

        /// Déclenche un effet avec SES réglages (fiche de l'effet) : écran(s) enregistré(s), préréglage « default ».
        /// kind = test : 5 s au plus ; manual : durée réglée. « Tous les écrans » : une activation par écran (id:rang),
        /// toutes validées avant la première soumise.
        object Activate(Dictionary<string, object> b)
        {
            string id = J.Str(b, "effect", null);
            var def = reg.Get(id);
            if (def == null) throw new ProtocolError("unknown_effect", "effet inconnu : " + (id ?? "?"));
            string rid = J.Str(b, "request_id", null), kind = J.Str(b, "kind", "manual");
            if (kind != "manual" && kind != "test") throw new ProtocolError("invalid_request", "kind : manual ou test");
            var es = cfg.Effect(id);
            string err;
            var screens = ScreenLayout.Resolve(es.Screen, Targets.Screens(), out err);
            if (err != null) throw new ProtocolError("screen_missing", err);
            var reqs = new List<EffectRequest>();
            for (int i = 0; i < screens.Count; i++)
            {
                var body = J.Map("request_id", screens.Count > 1 && rid != null ? rid + ":" + (i + 1) : rid, "effect", id, "source", J.Obj(b, "source"),
                    "target", J.Map("kind", "screen", "device", screens[i].Device));
                if (kind == "test")
                {
                    var preset = cfg.GetPreset(id, "default");
                    body["duration_ms"] = Math.Min(TestMs, preset != null && preset.DurationMs.HasValue ? preset.DurationMs.Value : def.DefaultDurationMs);
                }
                var req = Protocol.BuildRequest(body, reg, cfg, (spec, d) => Targets.Resolve(spec, cfg.Engine.DefaultMode, selfPid, d, cfg.Engine.InputEffects));
                CheckAllowed(req);
                reqs.Add(req);
            }
            var views = reqs.Select(r => (object)Protocol.View(sched.Submit(r), Now)).ToArray();
            return J.Map("effect", id, "kind", kind, "screen", es.Screen, "activations", views);
        }

        Dictionary<string, object> Status(long now)
        {
            return J.Map(
                "engine", Hello(),
                "active", sched.Running.Select(a => (object)Protocol.View(a, now)).ToArray(),
                "queued", sched.Queued.Select(a => (object)Protocol.View(a, now)).ToArray(),
                "surfaces", surfaces.Values.Select(s => (object)J.Map("key", s.S.Key, "mode", s.S.Mode, "visible", s.S.Shown, "excluded", s.S.Excluded,
                    "size", s.S.Width + "x" + s.S.Height, "capture", s.Cap != null ? s.Cap.Info() : null, "effects", s.Effects.Select(e => e.A.Req.RequestId).ToArray())).ToArray(),
                "captures_open", caps.Count, "degraded", tel.Degraded,
                "guardian", J.Map("pid", io.GuardianPid, "hotkey", io.HotkeyState),
                "input", input.Describe(),
                "cursor", CursorView(now),
                "config", cfg.ToJson());
        }
    }
}
