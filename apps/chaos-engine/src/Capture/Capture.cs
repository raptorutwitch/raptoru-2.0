// Moteur de capture : indépendant des effets. Une source par cible (fenêtre ou écran), partagée par tous les effets de
// cette cible (une seule capture, quels que soient leur nombre), comptée par références, gardée quelques secondes
// après le dernier effet (pas de recréation à chaque changement d'effet), arrêtée ensuite (zéro coût au repos).
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
        /// Copie persistante de la dernière image (mipmaps disponibles pour les flous).
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
        /// Copie l'image la plus récente (les plus anciennes sont comptées comme perdues). Vrai si nouvelle image.
        bool Acquire(long now);
        void EnsureMips();
    }

    sealed class CaptureError : Exception
    {
        public readonly string Code;
        public CaptureError(string code, string message) : base(message) { Code = code; }
    }

    /// Windows.Graphics.Capture : fenêtre (curseur exclu à la source, sans bordure) ou écran.
    sealed class WgcCaptureSource : ICaptureSource
    {
        const int BlackSize = 16;
        static string cachedAccess;
        readonly Gpu gpu;
        readonly GpuTimer timer;
        readonly AutoResetEvent frameEvt;
        readonly GraphicsCaptureItem item;
        readonly Direct3D11CaptureFramePool pool;
        readonly GraphicsCaptureSession session;
        readonly string border, borderAccess;
        IntPtr tex, srv, staging;
        uint w, h;
        bool mipsDirty, blackPending;
        long frames, dropped, lastArrival, nextBlackAt, lastFrameQpc;
        volatile bool closed;
        public string Key { get; private set; }
        public string Backend { get { return "wgc"; } }
        public uint Width { get { return w; } }
        public uint Height { get { return h; } }
        public IntPtr Srv { get { return srv; } }
        public bool HasFrame { get; private set; }
        public bool Lost { get { return closed; } }
        public string LostReason { get; private set; }
        public bool Black { get; private set; }
        public long Frames { get { return Interlocked.Read(ref frames); } }
        public long Dropped { get { return dropped; } }
        public long LastArrivalQpc { get { return Interlocked.Read(ref lastArrival); } }
        public long LastFrameQpc { get { return lastFrameQpc; } }

        public WgcCaptureSource(Gpu gpu, GpuTimer timer, AutoResetEvent frameEvt, string key, IntPtr hwnd, IntPtr hmon)
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
            pool = Direct3D11CaptureFramePool.CreateFreeThreaded(gpu.WinrtDevice, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, size);
            pool.FrameArrived += (s, a) => { Interlocked.Exchange(ref lastArrival, N.QpcNow()); Interlocked.Increment(ref frames); frameEvt.Set(); };
            session = pool.CreateCaptureSession(item);
            try { session.IsCursorCaptureEnabled = false; }
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

        void Allocate(uint nw, uint nh)
        {
            Com.Release(ref srv); Com.Release(ref tex);
            w = nw; h = nh;
            tex = gpu.Texture(w, h, 0, 0x8 | 0x20, 0x1, 0, 0);
            srv = gpu.Srv(tex);
            HasFrame = false;
        }

        public bool Acquire(long now)
        {
            if (closed) return false;
            Direct3D11CaptureFrame latest = null, f;
            int n = 0;
            while ((f = pool.TryGetNextFrame()) != null) { if (latest != null) latest.Dispose(); latest = f; n++; }
            if (latest == null) return false;
            dropped += n - 1;
            try
            {
                SizeInt32 size = latest.ContentSize;
                if (size.Width != w || size.Height != h)
                {
                    if (size.Width >= 16 && size.Height >= 16) { pool.Recreate(gpu.WinrtDevice, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, size); Allocate((uint)size.Width, (uint)size.Height); }
                    return false;
                }
                var surface = latest.Surface;
                var access = (IDirect3DDxgiInterfaceAccess)(object)surface;
                Guid tid = Iid.Texture2D;
                IntPtr frameTex = access.GetInterface(ref tid);
                // SystemRelativeTime : horloge QPC exprimée en unités de 100 ns.
                lastFrameQpc = (long)(latest.SystemRelativeTime.Ticks * (N.QpcFreq() / 1e7));
                if (timer != null) timer.Begin("capture:copy");
                gpu.Copy(tex, frameTex, 0, 0, w, h);
                if (timer != null) timer.End();
                Marshal.Release(frameTex);
                Marshal.ReleaseComObject(surface);
                HasFrame = true;
                mipsDirty = true;
                if (now >= nextBlackAt) CheckBlack(now);
                return true;
            }
            finally { latest.Dispose(); }
        }

        public void EnsureMips() { if (mipsDirty && HasFrame) { gpu.GenerateMips(srv); mipsDirty = false; } }

        /// Capture noire (jeu protégé, anti-triche) : 16×16 pixels au centre, lus sans attente toutes les 2 s.
        void CheckBlack(long now)
        {
            if (!blackPending) { gpu.Copy(staging, tex, w / 2 - BlackSize / 2, h / 2 - BlackSize / 2, BlackSize, BlackSize); blackPending = true; return; }
            int max = gpu.MaxChannel(staging, BlackSize);
            if (max < 0) return;
            blackPending = false; nextBlackAt = now + 2000;
            Black = max < 8;
        }

        public Dictionary<string, object> Info()
        {
            return J.Map("key", Key, "backend", Backend, "size", w + "x" + h, "border", border, "border_access", borderAccess,
                "frames", Frames, "dropped", dropped, "black", Black, "lost", closed);
        }

        public void Dispose()
        {
            closed = true;
            try { session.Dispose(); } catch (Exception) { }
            try { pool.Dispose(); } catch (Exception) { }
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
