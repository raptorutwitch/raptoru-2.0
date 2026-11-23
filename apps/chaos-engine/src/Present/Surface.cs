// Surface de présentation : une fenêtre DirectComposition traversable posée sur une cible (la fenêtre du jeu en mode D,
// tout l'écran en mode C, exclu des captures). Elle n'existe que tant qu'un effet l'utilise : au repos, aucune fenêtre.
// Jamais activée, jamais de clic ni de clavier, absente de la barre des tâches. Montrée seulement avec une image prête.
using System;
using System.Runtime.InteropServices;

namespace Raptoru.Chaos
{
    sealed class Surface : IDisposable
    {
        static WndProc proc;
        static bool registered;

        public readonly string Key;
        public readonly bool MonitorMode;
        public readonly IntPtr Target, TargetRoot;
        public IntPtr Hwnd { get { return hwnd; } }
        readonly Gpu gpu;
        IntPtr hwnd, swapchain, rtv, dcomp, dcTarget, visual;
        readonly ScPresent present;
        readonly ScGetBuffer getBuffer;
        readonly ScResizeBuffers resizeBuffers;
        readonly DcGetFrameStatistics compStats;
        RECT bounds;
        uint w, h;
        bool shown;
        long shownSince, visibleMs;
        public long Presented;
        /// Fréquence de l'écran qui porte la cible (Hz).
        public readonly int RefreshHz;
        /// Écran qui porte la cible (rythmeur d'affichage).
        public readonly IntPtr Hmon;
        public bool Shown { get { return shown; } }
        public uint Width { get { return w; } }
        public uint Height { get { return h; } }
        public IntPtr BackBuffer { get { return rtv; } }
        /// Rectangle de la cible à l'écran (fenêtre suivie, ou écran entier) : le curseur est « au-dessus » s'il y est.
        public RECT Bounds { get { return bounds; } }

        /// hmon ≠ 0 : l'écran entier (mode C) ; sinon la fenêtre target (mode D).
        public Surface(Gpu gpu, string key, IntPtr target, IntPtr hmon, uint width, uint height)
        {
            this.gpu = gpu; Key = key; Target = target; MonitorMode = hmon != IntPtr.Zero;
            bool monitorMode = MonitorMode;
            TargetRoot = N.GetAncestor(target, N.GA_ROOTOWNER);
            if (TargetRoot == IntPtr.Zero) TargetRoot = target;
            bounds = monitorMode ? N.MonitorRectOf(hmon) : N.FrameBounds(target);
            Hmon = monitorMode ? hmon : N.MonitorFromWindow(target, 2);
            RefreshHz = N.RefreshHz(Hmon);
            w = width; h = height;
            hwnd = CreateWindow(bounds.Left, bounds.Top, (int)w, (int)h);
            if (monitorMode && !N.SetWindowDisplayAffinity(hwnd, N.WDA_EXCLUDEFROMCAPTURE))
            {
                N.DestroyWindow(hwnd);
                throw new CaptureError("exclusion_failed", "impossible d'exclure la fenêtre des captures (mode C)");
            }
            swapchain = gpu.CompositionSwapChain(w, h);
            present = Com.Fn<ScPresent>(swapchain, 8);
            getBuffer = Com.Fn<ScGetBuffer>(swapchain, 9);
            resizeBuffers = Com.Fn<ScResizeBuffers>(swapchain, 13);
            CreateRtv();
            Guid dcid = Iid.DCompDevice;
            Com.Check(N.DCompositionCreateDevice(gpu.DxgiDevice, ref dcid, out dcomp), "DCompositionCreateDevice");
            Com.Check(Com.Fn<DcCreateTarget>(dcomp, 6)(dcomp, hwnd, 1, out dcTarget), "CreateTargetForHwnd");
            Com.Check(Com.Fn<DcCreateVisual>(dcomp, 7)(dcomp, out visual), "CreateVisual");
            Com.Check(Com.Fn<DcSetPtr>(visual, 15)(visual, swapchain), "SetContent");
            Com.Check(Com.Fn<DcSetPtr>(dcTarget, 3)(dcTarget, visual), "SetRoot");
            Com.Check(Com.Fn<DcCommit>(dcomp, 3)(dcomp), "Commit");
            compStats = Com.Fn<DcGetFrameStatistics>(dcomp, 5);
        }

        static IntPtr CreateWindow(int x, int y, int cw, int ch)
        {
            IntPtr inst = N.GetModuleHandleW(IntPtr.Zero);
            if (!registered)
            {
                proc = WindowProc;
                var wc = new WNDCLASSEX { cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX)), lpfnWndProc = Marshal.GetFunctionPointerForDelegate(proc), hInstance = inst, lpszClassName = N.OverlayClass };
                if (N.RegisterClassExW(ref wc) == 0) throw new CaptureError("window_error", "RegisterClassEx " + Marshal.GetLastWin32Error());
                registered = true;
            }
            int ex = N.WS_EX_TOPMOST | N.WS_EX_TRANSPARENT | N.WS_EX_LAYERED | N.WS_EX_NOACTIVATE | N.WS_EX_TOOLWINDOW | N.WS_EX_NOREDIRECTIONBITMAP;
            IntPtr hwnd = N.CreateWindowExW(ex, N.OverlayClass, "Raptoru Chaos", N.WS_POPUP, x, y, cw, ch, IntPtr.Zero, IntPtr.Zero, inst, IntPtr.Zero);
            if (hwnd == IntPtr.Zero) throw new CaptureError("window_error", "CreateWindowEx " + Marshal.GetLastWin32Error());
            N.SetLayeredWindowAttributes(hwnd, 0, 255, N.LWA_ALPHA);
            return hwnd;
        }

        static IntPtr WindowProc(IntPtr h, uint m, IntPtr wp, IntPtr lp)
        {
            if (m == N.WM_NCHITTEST) return new IntPtr(-1);  // HTTRANSPARENT
            if (m == N.WM_MOUSEACTIVATE) return new IntPtr(3); // MA_NOACTIVATE
            if (m == N.WM_ERASEBKGND) return new IntPtr(1);
            return N.DefWindowProcW(h, m, wp, lp);
        }

        void CreateRtv()
        {
            Guid tid = Iid.Texture2D;
            IntPtr back;
            Com.Check(getBuffer(swapchain, 0, ref tid, out back), "GetBuffer");
            rtv = gpu.Rtv(back);
            Com.Release(ref back);
        }

        public void Resize(uint nw, uint nh)
        {
            if (nw == w && nh == h) return;
            w = nw; h = nh;
            Com.Release(ref rtv);
            Com.Check(resizeBuffers(swapchain, 0, w, h, 0, 0), "ResizeBuffers");
            CreateRtv();
            N.SetWindowPos(hwnd, N.HWND_TOPMOST, bounds.Left, bounds.Top, (int)w, (int)h, N.SWP_NOACTIVATE);
        }

        /// Suit la position de la fenêtre cible (mode D).
        public void Track()
        {
            if (MonitorMode) return;
            RECT r = N.FrameBounds(Target);
            if (r.Left == bounds.Left && r.Top == bounds.Top) return;
            bounds = r;
            N.SetWindowPos(hwnd, N.HWND_TOPMOST, r.Left, r.Top, (int)w, (int)h, N.SWP_NOACTIVATE);
        }

        public bool TargetAlive { get { return MonitorMode || N.IsWindow(Target); } }
        public bool TargetMinimized { get { return !MonitorMode && N.IsIconic(Target); } }

        public bool TargetForeground()
        {
            if (MonitorMode) return true;
            IntPtr fg = N.GetForegroundWindow();
            if (fg == IntPtr.Zero) return shown;
            return fg == Target || N.GetAncestor(fg, N.GA_ROOTOWNER) == TargetRoot;
        }

        public void SetShown(bool on, long now)
        {
            if (on == shown) return;
            if (on) { N.SetWindowPos(hwnd, N.HWND_TOPMOST, bounds.Left, bounds.Top, (int)w, (int)h, N.SWP_NOACTIVATE | N.SWP_SHOWWINDOW); shownSince = now; }
            else { N.ShowWindow(hwnd, N.SW_HIDE); visibleMs += now - shownSince; }
            shown = on;
        }

        public long VisibleMs(long now) { return visibleMs + (shown ? now - shownSince : 0); }

        public void KeepOnTop()
        {
            if (shown) N.SetWindowPos(hwnd, N.HWND_TOPMOST, 0, 0, 0, 0, N.SWP_NOMOVE | N.SWP_NOSIZE | N.SWP_NOACTIVATE | N.SWP_NOOWNERZORDER);
        }

        /// Présente. Toujours sans attente (vsync = false) : Windows affiche l'image la plus récente à la composition de
        /// l'écran ; la cadence vient des captures et du rythmeur de l'écran (Present(1) suivrait l'écran principal).
        public int Present(bool vsync)
        {
            int hr = present(swapchain, vsync ? 1u : 0u, 0);
            if (hr >= 0) Presented++;
            return hr;
        }

        public double CompositionHz()
        {
            DCOMPOSITION_FRAME_STATISTICS s;
            return compStats(dcomp, out s) >= 0 && s.RateDenominator > 0 ? Math.Round(s.RateNumerator / (double)s.RateDenominator, 1) : 0;
        }

        /// Prochaine composition prévue par Windows (QPC), 0 si inconnue.
        public long NextCompositionQpc()
        {
            DCOMPOSITION_FRAME_STATISTICS s;
            if (compStats(dcomp, out s) < 0 || s.TimeFrequency <= 0) return 0;
            long f = N.QpcFreq();
            return s.TimeFrequency == f ? s.NextEstimatedFrameTime : (long)(s.NextEstimatedFrameTime * (f / (double)s.TimeFrequency));
        }

        public void Dispose()
        {
            if (hwnd != IntPtr.Zero) { N.ShowWindow(hwnd, N.SW_HIDE); N.DestroyWindow(hwnd); hwnd = IntPtr.Zero; }
            Com.Release(ref rtv); Com.Release(ref visual); Com.Release(ref dcTarget); Com.Release(ref dcomp); Com.Release(ref swapchain);
        }
    }
}
