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
        IntPtr tex, srv, staging;
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
        /// Copie persistante (outils de test : lecture des pixels après une capture avec ZeroCopy = false).
        internal IntPtr CopyTexture { get { return tex; } }
        public bool ZeroCopy { get; set; }
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
            this.gpu = gpu; this.timer = timer; this.frameEvt = frameEvt; Key = key;
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
            current = IntPtr.Zero;
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
                lastFrameQpc = (long)(latest.SystemRelativeTime.Ticks * (N.QpcFreq() / 1e7));
                IntPtr view = ZeroCopy && zeroCopyOk ? FrameSrv(frameTex) : IntPtr.Zero;
                if (view != IntPtr.Zero)
                {
                    // Lecture directe : la trame précédente retourne au pool, celle-ci reste empruntée jusqu'à la suivante.
                    ReleaseHeld();
                    held = latest; keep = true;
                    current = view; copyCurrent = false; direct++;
                }
                else
                {
                    ReleaseHeld();
                    CopyFrom(frameTex);
                }
                if (now >= nextBlackAt) CheckBlack(now, frameTex);
                Marshal.Release(frameTex);
                Marshal.ReleaseComObject(surface);
                HasFrame = true;
                mipsDirty = true;
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
            current = srv; copyCurrent = true; copies++;
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

        /// Ouvre (ou réutilise) la capture d'une cible : la fenêtre hwnd (mode D) ou l'écran hmon (mode C, hmon ≠ 0).
        public ICaptureSource Acquire(string key, IntPtr hwnd, IntPtr hmon)
        {
            Entry e;
            if (entries.TryGetValue(key, out e) && !e.Source.Lost) { e.Refs++; Reused++; return e.Source; }
            if (e != null) { e.Source.Dispose(); entries.Remove(key); }
            e = new Entry { Source = new WgcCaptureSource(gpu, timer, frameEvt, key, hwnd, hmon), Refs = 1 };
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
