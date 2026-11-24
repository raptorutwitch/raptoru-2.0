// Moteur de capture : indépendant des effets. Une source par cible (fenêtre ou écran), partagée par tous les effets de
// cette cible (une seule capture, quels que soient leur nombre), comptée par références, gardée quelques secondes
// après le dernier effet (pas de recréation à chaque changement d'effet), arrêtée ensuite (zéro coût au repos).
// Sans copie quand c'est possible : l'image capturée est lue directement (la trame reste empruntée au pool jusqu'à la
// suivante) ; une copie persistante n'est faite que si un effet lit des mipmaps (flou) ou si la lecture directe est
// impossible (interrupteur performance.zero_copy).
// Ajouter une autre technique de capture : implémenter ICaptureSource et l'enregistrer dans CaptureManager.Open.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;

namespace Raptoru.Chaos
{
    interface ICaptureSource : IDisposable
    {
        string Key { get; }
        string Backend { get; }
        uint Width { get; }
        uint Height { get; }
        /// Image la plus récente : la trame capturée elle-même (sans copie) ou sa copie persistante (après EnsureMips).
        IntPtr Srv { get; }
        bool HasFrame { get; }
        bool Lost { get; }
        string LostReason { get; }
        bool Black { get; }
        long Frames { get; }
        long Dropped { get; }
        long LastArrivalQpc { get; }
        /// Instant (QPC) où Windows a composé l'image la plus récemment copiée (Direct3D11CaptureFrame.SystemRelativeTime).
        long LastFrameQpc { get; }
        Dictionary<string, object> Info();
        /// Prend l'image la plus récente (les plus anciennes sont comptées comme perdues). Vrai si nouvelle image.
        bool Acquire(long now);
        /// Copie persistante avec mipmaps (effets qui lisent une version floue de l'image).
        void EnsureMips();
        /// Lecture directe autorisée (performance.zero_copy).
        bool ZeroCopy { get; set; }
        /// Intervalle minimal entre deux images livrées par Windows (cadence plafonnée), en ms.
        void SetMinInterval(double ms);
        /// La capture voit l'écran entier, donc le calque posé dessus : il doit être exclu des captures tant qu'elle tourne.
        bool CapturesScreen { get; }
        /// Images composées avant cet instant (QPC) ignorées : elles peuvent contenir le calque, pas encore exclu.
        void NotBefore(long qpc);
        /// Capture réutilisée par un nouvel effet (image de l'écran à reprendre).
        void Refresh();
    }

    sealed class CaptureError : Exception
    {
        public readonly string Code;
        public CaptureError(string code, string message) : base(message) { Code = code; }
    }

    /// Windows.Graphics.Capture : fenêtre (curseur exclu à la source, sans bordure) ou écran.
    sealed class WgcCaptureSource : ICaptureSource
    {
        const int BlackSize = 16, PoolBuffers = 3; // une trame gardée pour le rendu + deux pour Windows
        static string cachedAccess;
        readonly Gpu gpu;
        readonly GpuTimer timer;
        readonly AutoResetEvent frameEvt;
        readonly GraphicsCaptureItem item;
        readonly Direct3D11CaptureFramePool pool;
        readonly GraphicsCaptureSession session;
        readonly string border, borderAccess;
        readonly bool screen;
        IntPtr tex, srv, staging, currentTex;
        long notBefore;
        // Lecture directe : trame empruntée (rendue jusqu'à la suivante) et vues sur les tampons du pool (≤ PoolBuffers).
        Direct3D11CaptureFrame held;
        IntPtr current;
        bool copyCurrent, zeroCopyOk = true;
        readonly Dictionary<long, IntPtr> frameSrvs = new Dictionary<long, IntPtr>();
        long copies, direct;
        double minIntervalMs = 1;
        uint w, h;
        bool mipsDirty, blackPending;
        long frames, dropped, lastArrival, nextBlackAt, lastFrameQpc;
        volatile bool closed;
        public string Key { get; private set; }
        public string Backend { get { return "wgc"; } }
        public uint Width { get { return w; } }
        public uint Height { get { return h; } }
        public IntPtr Srv { get { return current; } }
        /// Texture de l'image courante (trame du pool ou copie persistante), pour une copie vers une autre cible.
        internal IntPtr CurrentTexture { get { return currentTex; } }
        public bool CapturesScreen { get { return screen; } }
        public void NotBefore(long qpc) { notBefore = qpc; }
        public void Refresh() { }
        /// Copie persistante (outils de test : lecture des pixels après une capture avec ZeroCopy = false).
        internal IntPtr CopyTexture { get { return tex; } }
        public bool ZeroCopy { get; set; }
        /// Valeur relue de IsCursorCaptureEnabled (diagnostic du curseur).
        public bool CursorCaptureEnabled { get { try { return session.IsCursorCaptureEnabled; } catch (Exception) { return false; } } }
        public bool HasFrame { get; private set; }
        public bool Lost { get { return closed; } }
        public string LostReason { get; private set; }
        public bool Black { get; private set; }
        public long Frames { get { return Interlocked.Read(ref frames); } }
        public long Dropped { get { return dropped; } }
        public long LastArrivalQpc { get { return Interlocked.Read(ref lastArrival); } }
        public long LastFrameQpc { get { return lastFrameQpc; } }

        /// cursor : curseur inclus dans l'image (prototype du curseur ; le moteur l'exclut toujours).
        public WgcCaptureSource(Gpu gpu, GpuTimer timer, AutoResetEvent frameEvt, string key, IntPtr hwnd, IntPtr hmon, bool cursor = false)
        {
            this.gpu = gpu; this.timer = timer; this.frameEvt = frameEvt; Key = key; screen = hmon != IntPtr.Zero;
            if (!GraphicsCaptureSession.IsSupported()) throw new CaptureError("capture_unsupported", "Windows.Graphics.Capture indisponible");
            var interop = (IGraphicsCaptureItemInterop)WindowsRuntimeMarshal.GetActivationFactory(typeof(GraphicsCaptureItem));
            Guid iid = Iid.GraphicsCaptureItem;
            IntPtr p;
            try { p = hmon != IntPtr.Zero ? interop.CreateForMonitor(hmon, ref iid) : interop.CreateForWindow(hwnd, ref iid); }
            catch (COMException e) { throw new CaptureError("capture_denied", "Windows refuse la capture : 0x" + e.ErrorCode.ToString("X8")); }
            item = (GraphicsCaptureItem)Marshal.GetObjectForIUnknown(p);
            Marshal.Release(p);
            item.Closed += (s, a) => { LostReason = "target_lost"; closed = true; frameEvt.Set(); };
            SizeInt32 size = item.Size;
            if (size.Width < 16 || size.Height < 16) throw new CaptureError("no_window", "cible trop petite : " + size.Width + "x" + size.Height);
            Allocate((uint)size.Width, (uint)size.Height);
            staging = gpu.Texture(BlackSize, BlackSize, 1, 0, 0, 3, 0x20000);
            pool = Direct3D11CaptureFramePool.CreateFreeThreaded(gpu.WinrtDevice, DirectXPixelFormat.B8G8R8A8UIntNormalized, PoolBuffers, size);
            pool.FrameArrived += (s, a) => { Interlocked.Exchange(ref lastArrival, N.QpcNow()); Interlocked.Increment(ref frames); frameEvt.Set(); };
            session = pool.CreateCaptureSession(item);
            try { session.IsCursorCaptureEnabled = cursor; }
            catch (Exception e) { throw new CaptureError("cursor_exclusion_unavailable", e.Message); }
            // Autorisation « sans bordure » : demandée une fois par processus (Windows la garde), pas à chaque capture.
            if (cachedAccess == null)
            {
                try
                {
                    var op = GraphicsCaptureAccess.RequestAccessAsync(GraphicsCaptureAccessKind.Borderless);
                    var wait = Stopwatch.StartNew();
                    while (op.Status == Windows.Foundation.AsyncStatus.Started && wait.ElapsedMilliseconds < 3000) Thread.Sleep(5);
                    if (op.Status == Windows.Foundation.AsyncStatus.Completed) cachedAccess = op.GetResults().ToString();
                    else borderAccess = "timeout";
                }
                catch (Exception e) { borderAccess = "error " + e.GetType().Name; }
            }
            if (cachedAccess != null) borderAccess = cachedAccess;
            try { session.IsBorderRequired = false; border = "removed"; } catch (Exception) { border = "required"; }
            try { session.MinUpdateInterval = TimeSpan.FromMilliseconds(1); } catch (Exception) { }
            session.StartCapture();
        }

        /// Nouvelle taille : la copie persistante sera recréée à la demande (rien d'alloué tant que la lecture directe suffit).
        void Allocate(uint nw, uint nh)
        {
            ReleaseHeld();
            ClearFrameViews();
            Com.Release(ref srv); Com.Release(ref tex);
            w = nw; h = nh;
            current = IntPtr.Zero; currentTex = IntPtr.Zero;
            HasFrame = false;
        }

        void EnsureCopyTarget()
        {
            if (tex != IntPtr.Zero) return;
            tex = gpu.Texture(w, h, 0, 0x8 | 0x20, 0x1, 0, 0);
            srv = gpu.Srv(tex);
        }

        void ReleaseHeld() { if (held != null) { try { held.Dispose(); } catch (Exception) { } held = null; } }

        void ClearFrameViews()
        {
            foreach (var kv in frameSrvs) { IntPtr v = kv.Value, t = new IntPtr(kv.Key); Com.Release(ref v); Com.Release(ref t); }
            frameSrvs.Clear();
        }

        /// Vue sur un tampon du pool (créée une fois par tampon ; le tampon est gardé tant que la vue existe).
        IntPtr FrameSrv(IntPtr frameTex)
        {
            IntPtr v;
            if (frameSrvs.TryGetValue(frameTex.ToInt64(), out v)) return v;
            if (frameSrvs.Count >= PoolBuffers * 2) ClearFrameViews();
            D3D11_TEXTURE2D_DESC d;
            Com.Fn<TexGetDesc>(frameTex, 10)(frameTex, out d);
            if ((d.BindFlags & 0x8) == 0) { zeroCopyOk = false; return IntPtr.Zero; } // pas de SHADER_RESOURCE : copie obligatoire
            try { v = gpu.Srv(frameTex); } catch (Exception) { zeroCopyOk = false; return IntPtr.Zero; }
            Marshal.AddRef(frameTex);
            frameSrvs[frameTex.ToInt64()] = v;
            return v;
        }

        public bool Acquire(long now)
        {
            if (closed) return false;
            Direct3D11CaptureFrame latest = null, f;
            int n = 0;
            while ((f = pool.TryGetNextFrame()) != null) { if (latest != null) latest.Dispose(); latest = f; n++; }
            if (latest == null) return false;
            dropped += n - 1;
            bool keep = false;
            try
            {
                SizeInt32 size = latest.ContentSize;
                if (size.Width != w || size.Height != h)
                {
                    if (size.Width >= 16 && size.Height >= 16) { Allocate((uint)size.Width, (uint)size.Height); pool.Recreate(gpu.WinrtDevice, DirectXPixelFormat.B8G8R8A8UIntNormalized, PoolBuffers, size); }
                    return false;
                }
                var surface = latest.Surface;
                var access = (IDirect3DDxgiInterfaceAccess)(object)surface;
                Guid tid = Iid.Texture2D;
                IntPtr frameTex = access.GetInterface(ref tid);
                // SystemRelativeTime : instant QPC de la composition de l'image, exprimé en unités de 100 ns.
                long frameQpc = (long)(latest.SystemRelativeTime.Ticks * (N.QpcFreq() / 1e7));
                // Image composée avant l'exclusion du calque : gardée seulement s'il n'y a encore rien (secours d'une
                // image de l'écran qui ne viendrait pas), jamais signalée comme nouvelle.
                bool stale = frameQpc < notBefore;
                if (stale && HasFrame) { Marshal.Release(frameTex); Marshal.ReleaseComObject(surface); return false; }
                lastFrameQpc = frameQpc;
                IntPtr view = ZeroCopy && zeroCopyOk ? FrameSrv(frameTex) : IntPtr.Zero;
                if (view != IntPtr.Zero)
                {
                    // Lecture directe : la trame précédente retourne au pool, celle-ci reste empruntée jusqu'à la suivante.
                    ReleaseHeld();
                    held = latest; keep = true;
                    current = view; currentTex = frameTex; copyCurrent = false; direct++;
                }
                else
                {
                    ReleaseHeld();
                    CopyFrom(frameTex);
                }
                if (now >= nextBlackAt) CheckBlack(now, frameTex);
                Marshal.Release(frameTex);
                Marshal.ReleaseComObject(surface);
                mipsDirty = true;
                if (stale) return false;
                HasFrame = true;
                return true;
            }
            finally { if (!keep) latest.Dispose(); }
        }

        void CopyFrom(IntPtr frameTex)
        {
            EnsureCopyTarget();
            if (timer != null) timer.Begin("capture:copy");
            gpu.Copy(tex, frameTex, 0, 0, w, h);
            if (timer != null) timer.End();
            current = srv; currentTex = tex; copyCurrent = true; copies++;
        }

        public void EnsureMips()
        {
            if (!HasFrame) return;
            if (!copyCurrent && held != null)
            {
                // Lecture directe en cours : les mipmaps exigent la copie persistante (une copie, puis le flou).
                var surface = held.Surface;
                var access = (IDirect3DDxgiInterfaceAccess)(object)surface;
                Guid tid = Iid.Texture2D;
                IntPtr t = access.GetInterface(ref tid);
                CopyFrom(t);
                Marshal.Release(t);
                Marshal.ReleaseComObject(surface);
                mipsDirty = true;
            }
            if (mipsDirty && copyCurrent)
            {
                if (timer != null) timer.Begin("capture:mips");
                gpu.GenerateMips(srv);
                if (timer != null) timer.End();
                mipsDirty = false;
            }
        }

        public void SetMinInterval(double ms)
        {
            if (Math.Abs(ms - minIntervalMs) < 0.01) return;
            minIntervalMs = ms;
            try { session.MinUpdateInterval = TimeSpan.FromMilliseconds(Math.Max(1, ms)); } catch (Exception) { }
        }

        /// Capture noire (jeu protégé, anti-triche) : 16×16 pixels au centre, lus sans attente toutes les 2 s.
        void CheckBlack(long now, IntPtr source)
        {
            if (!blackPending) { gpu.Copy(staging, source, w / 2 - BlackSize / 2, h / 2 - BlackSize / 2, BlackSize, BlackSize); blackPending = true; return; }
            int max = gpu.MaxChannel(staging, BlackSize);
            if (max < 0) return;
            blackPending = false; nextBlackAt = now + 2000;
            Black = max < 8;
        }

        public Dictionary<string, object> Info()
        {
            return J.Map("key", Key, "backend", Backend, "size", w + "x" + h, "border", border, "border_access", borderAccess,
                "frames", Frames, "dropped", dropped, "black", Black, "lost", closed, "zero_copy", ZeroCopy && zeroCopyOk, "direct", direct, "copies", copies,
                "min_interval_ms", minIntervalMs, "pool_buffers", PoolBuffers);
        }

        public void Dispose()
        {
            closed = true;
            try { session.Dispose(); } catch (Exception) { }
            ReleaseHeld();
            try { pool.Dispose(); } catch (Exception) { }
            ClearFrameViews();
            Com.Release(ref staging); Com.Release(ref srv); Com.Release(ref tex);
        }
    }

    /// Cible « écran » occupée par une fenêtre (jeu, fenêtre agrandie) : l'écran entier, fait de la fenêtre capturée en
    /// direct, posée à sa place, sur une image de l'écran prise une fois au départ (barre des tâches, bords, bureau).
    /// Le calque couvre ainsi tout l'écran SANS être exclu des captures (la capture d'écran d'OBS le voit) : la capture de
    /// la fenêtre ne le contient jamais, et l'image de l'écran est prise avant qu'il s'affiche (ou calque exclu le temps de
    /// la prendre, CapturesScreen). Limite : le reste de l'écran est figé pendant l'effet (horloge, survol de la barre).
    /// Fenêtre qui couvre tout l'écran (jeu en fenêtré sans bordure) : sa capture est lue directement, sans composition.
    /// Sans fenêtre (hwnd = 0, écran vide) : l'image de l'écran seule, figée pendant l'effet.
    sealed class ComposedScreenSource : ICaptureSource
    {
        const int SnapTimeoutMs = 500;
        readonly Gpu gpu;
        readonly GpuTimer timer;
        readonly AutoResetEvent frameEvt;
        readonly WgcCaptureSource win;   // null : aucune fenêtre (image de l'écran seule)
        readonly string key;
        readonly IntPtr hwnd, hmon;
        readonly RECT mon;
        readonly uint w, h;
        WgcCaptureSource snap;
        IntPtr tex, srv;
        long snapStart = -1, notBefore, snapMs = -1, composes, snapQpc;
        bool snapped, direct, mipsDirty, composed;

        public ComposedScreenSource(Gpu gpu, GpuTimer timer, AutoResetEvent frameEvt, string key, IntPtr hwnd, IntPtr hmon)
        {
            this.gpu = gpu; this.timer = timer; this.frameEvt = frameEvt; this.key = key; this.hwnd = hwnd; this.hmon = hmon;
            mon = N.MonitorRectOf(hmon);
            w = (uint)Math.Max(16, mon.Right - mon.Left); h = (uint)Math.Max(16, mon.Bottom - mon.Top);
            if (hwnd != IntPtr.Zero) win = new WgcCaptureSource(gpu, timer, frameEvt, key, hwnd, IntPtr.Zero) { ZeroCopy = true };
            direct = Covers();
        }

        public string Key { get { return key; } }
        public string Backend { get { return "wgc-screen"; } }
        public uint Width { get { return w; } }
        public uint Height { get { return h; } }
        public IntPtr Srv { get { return direct ? win.Srv : srv; } }
        public bool HasFrame { get { return win != null ? win.HasFrame && (direct || composed) : composed; } }
        public bool Lost { get { return win != null && win.Lost; } }
        public string LostReason { get { return win != null ? win.LostReason : null; } }
        public bool Black { get { return win != null && win.Black; } }
        public long Frames { get { return win != null ? win.Frames : composes; } }
        public long Dropped { get { return win != null ? win.Dropped : 0; } }
        public long LastArrivalQpc { get { return win != null ? win.LastArrivalQpc : snapQpc; } }
        public long LastFrameQpc { get { return win != null ? win.LastFrameQpc : snapQpc; } }
        /// Lecture directe de la fenêtre toujours (la composition est déjà une copie).
        public bool ZeroCopy { get; set; }
        public bool CapturesScreen { get { return !direct && !snapped; } }
        public void NotBefore(long qpc) { notBefore = qpc; if (snap != null) snap.NotBefore(qpc); }
        public void Refresh() { snapped = false; composed = false; DisposeSnap(); }
        public void SetMinInterval(double ms) { if (win != null) win.SetMinInterval(ms); }
        /// Diagnostic : image de l'écran prise, composition directe.
        internal bool Snapped { get { return snapped; } }
        internal bool Direct { get { return direct; } }
        internal IntPtr ComposedTexture { get { return direct ? win.CurrentTexture : tex; } }

        /// La fenêtre couvre tout l'écran, à la taille de l'écran : rien d'autre à montrer.
        bool Covers()
        {
            if (win == null) return false;
            RECT r = N.FrameBounds(hwnd);
            return r.Left <= mon.Left && r.Top <= mon.Top && r.Right >= mon.Right && r.Bottom >= mon.Bottom && win.Width == w && win.Height == h;
        }

        void EnsureTex()
        {
            if (tex != IntPtr.Zero) return;
            tex = gpu.Texture(w, h, 0, 0x8 | 0x20, 0x1, 0, 0);
            srv = gpu.Srv(tex);
        }

        public bool Acquire(long now)
        {
            bool fresh = win != null && win.Acquire(now);
            bool covers = win != null && win.HasFrame && Covers();
            if (covers != direct) { direct = covers; mipsDirty = true; if (!direct) { snapped = false; composed = false; } }
            if (direct) return fresh;
            bool justSnapped = false;
            if (!snapped)
            {
                if (!Snap(now)) return false;
                justSnapped = true;
            }
            if (win == null)
            {
                if (justSnapped) { composed = true; mipsDirty = true; composes++; }
                return justSnapped;
            }
            if (!win.HasFrame || (!fresh && !justSnapped)) return false;
            Compose();
            return true;
        }

        /// Image de l'écran (sans curseur) : la première composée après l'exclusion du calque ; à défaut, après
        /// SnapTimeoutMs, la plus récente reçue.
        bool Snap(long now)
        {
            if (snap == null)
            {
                snap = new WgcCaptureSource(gpu, null, frameEvt, Key + "#screen", IntPtr.Zero, hmon) { ZeroCopy = true };
                snap.NotBefore(notBefore);
                snapStart = now;
            }
            bool got = snap.Acquire(now) || snap.HasFrame;
            if (!got && now - snapStart >= SnapTimeoutMs && snap.CurrentTexture != IntPtr.Zero) got = true;
            if (!got || snap.CurrentTexture == IntPtr.Zero) return false;
            EnsureTex();
            if (timer != null) timer.Begin("capture:screen");
            gpu.CopyAt(tex, 0, 0, snap.CurrentTexture, 0, 0, Math.Min(snap.Width, w), Math.Min(snap.Height, h));
            if (timer != null) timer.End();
            snapMs = now - snapStart;
            snapQpc = N.QpcNow();
            snapped = true;
            DisposeSnap();
            return true;
        }

        /// La fenêtre, à sa place sur l'écran (découpée aux bords de l'écran).
        void Compose()
        {
            IntPtr src = win.CurrentTexture;
            if (src == IntPtr.Zero) return;
            RECT r = N.FrameBounds(hwnd);
            int ox = r.Left - mon.Left, oy = r.Top - mon.Top;
            int sx = Math.Max(0, -ox), sy = Math.Max(0, -oy), dx = Math.Max(0, ox), dy = Math.Max(0, oy);
            int cw = Math.Min((int)win.Width - sx, (int)w - dx), ch = Math.Min((int)win.Height - sy, (int)h - dy);
            if (cw <= 0 || ch <= 0) return;
            EnsureTex();
            if (timer != null) timer.Begin("capture:compose");
            gpu.CopyAt(tex, (uint)dx, (uint)dy, src, (uint)sx, (uint)sy, (uint)cw, (uint)ch);
            if (timer != null) timer.End();
            composed = true; mipsDirty = true; composes++;
        }

        public void EnsureMips()
        {
            if (direct) { win.EnsureMips(); return; }
            if (!composed || !mipsDirty) return;
            if (timer != null) timer.Begin("capture:mips");
            gpu.GenerateMips(srv);
            if (timer != null) timer.End();
            mipsDirty = false;
        }

        public Dictionary<string, object> Info()
        {
            var d = win != null ? win.Info() : new Dictionary<string, object> { { "key", key } };
            d["backend"] = Backend;
            d["screen"] = J.Map("size", w + "x" + h, "direct", direct, "snapshot_ms", snapMs, "composes", composes, "window", win != null);
            return d;
        }

        void DisposeSnap() { if (snap != null) { snap.Dispose(); snap = null; } }

        public void Dispose()
        {
            if (win != null) win.Dispose();
            DisposeSnap();
            Com.Release(ref srv); Com.Release(ref tex);
        }
    }

    sealed class CaptureManager
    {
        sealed class Entry { public ICaptureSource Source; public int Refs; public long ReleasedAt; }
        readonly Gpu gpu;
        readonly GpuTimer timer;
        readonly AutoResetEvent frameEvt;
        readonly Dictionary<string, Entry> entries = new Dictionary<string, Entry>();
        public int Opened, Reused;

        public CaptureManager(Gpu gpu, GpuTimer timer, AutoResetEvent frameEvt) { this.gpu = gpu; this.timer = timer; this.frameEvt = frameEvt; }
        public int Count { get { return entries.Count; } }
        public IEnumerable<ICaptureSource> Sources { get { return entries.Values.Select(e => e.Source); } }

        /// Clé de capture d'une cible : la même cible « écran » peut changer de technique (composé ou écran entier).
        public static string KeyOf(string target, IntPtr hmon, bool composed) { return target + (composed ? "#e" : hmon != IntPtr.Zero ? "#c" : ""); }

        /// Ouvre (ou réutilise) la capture d'une cible : la fenêtre hwnd (mode D), l'écran hmon (mode C, hmon ≠ 0) ou
        /// l'écran composé autour de la fenêtre hwnd (mode E, composed).
        public ICaptureSource Acquire(string key, IntPtr hwnd, IntPtr hmon, bool composed)
        {
            Entry e;
            if (entries.TryGetValue(key, out e) && !e.Source.Lost) { e.Refs++; Reused++; e.Source.Refresh(); return e.Source; }
            if (e != null) { e.Source.Dispose(); entries.Remove(key); }
            ICaptureSource src = composed ? (ICaptureSource)new ComposedScreenSource(gpu, timer, frameEvt, key, hwnd, hmon) : new WgcCaptureSource(gpu, timer, frameEvt, key, hwnd, hmon);
            e = new Entry { Source = src, Refs = 1 };
            entries[key] = e;
            Opened++;
            return e.Source;
        }

        public void Release(string key, long now)
        {
            Entry e;
            if (!entries.TryGetValue(key, out e)) return;
            e.Refs = Math.Max(0, e.Refs - 1);
            if (e.Refs == 0) e.ReleasedAt = now;
        }

        /// Arrête les captures sans utilisateur depuis lingerMs (0 = tout de suite) et celles perdues.
        public void Trim(long now, long lingerMs)
        {
            foreach (var kv in entries.ToList())
            {
                var e = kv.Value;
                if ((e.Refs == 0 && now - e.ReleasedAt >= lingerMs) || (e.Refs == 0 && e.Source.Lost))
                {
                    e.Source.Dispose();
                    entries.Remove(kv.Key);
                }
            }
        }

        public void CloseAll() { foreach (var e in entries.Values) e.Source.Dispose(); entries.Clear(); }
    }
}
