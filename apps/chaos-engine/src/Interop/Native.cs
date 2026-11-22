// Liaisons Windows (Win32, Direct3D 11, DXGI, DirectComposition) appelées par la table virtuelle COM.
// Partagé par le lecteur et par chaos-checks.exe. Aucune dépendance au reste du lecteur.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Raptoru.Chaos
{
    sealed class ComFail : Exception
    {
        public readonly int HResult32;
        public ComFail(string what, int hr) : base(what + " 0x" + hr.ToString("X8")) { HResult32 = hr; }
    }

    static class Com
    {
        public static T Fn<T>(IntPtr obj, int slot) where T : class
        {
            IntPtr vtbl = Marshal.ReadIntPtr(obj);
            return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(vtbl, slot * IntPtr.Size), typeof(T));
        }
        public static void Check(int hr, string what) { if (hr < 0) throw new ComFail(what, hr); }
        public static IntPtr QI(IntPtr obj, Guid iid)
        {
            IntPtr r; Check(Marshal.QueryInterface(obj, ref iid, out r), "QueryInterface"); return r;
        }
        public static void Release(ref IntPtr p) { if (p != IntPtr.Zero) { Marshal.Release(p); p = IntPtr.Zero; } }
    }

    static class Iid
    {
        public static readonly Guid Texture2D = new Guid("6f15aaf2-d208-4e89-9ab4-489535d34f9c");
        public static readonly Guid DxgiDevice = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
        public static readonly Guid DxgiDevice1 = new Guid("77db970f-6276-48ba-ba28-070143b4392c");
        public static readonly Guid DxgiFactory2 = new Guid("50c83a1c-e072-4c48-87b0-3630fa36a6d0");
        public static readonly Guid DCompDevice = new Guid("C37EA93A-E7AA-450D-B16F-9746CB0407F3");
        public static readonly Guid D3D11Multithread = new Guid("9B7E4E00-342C-4106-A19F-4F2704F689F0");
        public static readonly Guid GraphicsCaptureItem = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");
        public static readonly Guid DxgiAdapter3 = new Guid("645967A4-1392-4310-A798-8053CE3E93FD");
    }

    [ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IGraphicsCaptureItemInterop
    {
        IntPtr CreateForWindow(IntPtr window, ref Guid iid);
        IntPtr CreateForMonitor(IntPtr monitor, ref Guid iid);
    }

    [ComImport, Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDirect3DDxgiInterfaceAccess
    {
        IntPtr GetInterface(ref Guid iid);
    }

    // ---- Structures ----
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; public uint lPrivate; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WNDCLASSEX
    {
        public uint cbSize, style; public IntPtr lpfnWndProc; public int cbClsExtra, cbWndExtra;
        public IntPtr hInstance, hIcon, hCursor, hbrBackground; public string lpszMenuName, lpszClassName; public IntPtr hIconSm;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct MONITORINFO { public uint cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MONITORINFOEX { public uint cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
    /// DEVMODEW, variante affichage (220 octets).
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra; public int dmFields;
        public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels; public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct D3D11_TEXTURE2D_DESC
    {
        public uint Width, Height, MipLevels, ArraySize; public int Format; public uint SampleCount, SampleQuality;
        public int Usage; public uint BindFlags, CPUAccessFlags, MiscFlags;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct D3D11_BUFFER_DESC { public uint ByteWidth; public int Usage; public uint BindFlags, CPUAccessFlags, MiscFlags, StructureByteStride; }
    [StructLayout(LayoutKind.Sequential)]
    struct D3D11_SAMPLER_DESC
    {
        public int Filter, AddressU, AddressV, AddressW; public float MipLODBias; public uint MaxAnisotropy; public int ComparisonFunc;
        public float B0, B1, B2, B3, MinLOD, MaxLOD;
    }
    [StructLayout(LayoutKind.Sequential)] struct D3D11_VIEWPORT { public float X, Y, Width, Height, MinDepth, MaxDepth; }
    [StructLayout(LayoutKind.Sequential)] struct D3D11_BOX { public uint Left, Top, Front, Right, Bottom, Back; }
    [StructLayout(LayoutKind.Sequential)] struct D3D11_QUERY_DESC { public int Query; public uint MiscFlags; }
    [StructLayout(LayoutKind.Sequential)] struct D3D11_MAPPED_SUBRESOURCE { public IntPtr pData; public uint RowPitch, DepthPitch; }
    [StructLayout(LayoutKind.Sequential)]
    struct DXGI_SWAP_CHAIN_DESC1
    {
        public uint Width, Height; public int Format, Stereo; public uint SampleCount, SampleQuality, BufferUsage, BufferCount;
        public int Scaling, SwapEffect, AlphaMode; public uint Flags;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DXGI_ADAPTER_DESC
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
        public uint VendorId, DeviceId, SubSysId, Revision; public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
        public uint LuidLow; public int LuidHigh;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct DCOMPOSITION_FRAME_STATISTICS
    {
        public long LastFrameTime; public uint RateNumerator, RateDenominator; public long CurrentTime, TimeFrequency, NextEstimatedFrameTime;
    }

    // ---- Délégués des méthodes COM utilisées (premier paramètre = this) ----
    delegate int DevCreateTexture2D(IntPtr self, ref D3D11_TEXTURE2D_DESC d, IntPtr init, out IntPtr tex);              // 5
    delegate int DevCreateBuffer(IntPtr self, ref D3D11_BUFFER_DESC d, IntPtr init, out IntPtr buf);                    // 3
    delegate int DevCreateView(IntPtr self, IntPtr res, IntPtr desc, out IntPtr view);                                // 7 SRV, 9 RTV
    delegate int DevCreateShader(IntPtr self, IntPtr code, IntPtr len, IntPtr linkage, out IntPtr shader);           // 12 VS, 15 PS
    delegate int DevCreateSampler(IntPtr self, ref D3D11_SAMPLER_DESC d, out IntPtr s);                               // 23
    delegate int DevCreateQuery(IntPtr self, ref D3D11_QUERY_DESC d, out IntPtr q);                                   // 24
    delegate void DevGetImmediateContext(IntPtr self, out IntPtr ctx);                                                // 40
    delegate void CtxSetViews(IntPtr self, uint start, uint n, ref IntPtr item);                                      // 8 PSSetShaderResources, 10 PSSetSamplers, 16 PSSetConstantBuffers
    delegate void CtxSetShader(IntPtr self, IntPtr shader, IntPtr classInstances, uint n);                           // 9 PS, 11 VS
    delegate void CtxDraw(IntPtr self, uint count, uint start);                                                       // 13
    delegate int CtxMap(IntPtr self, IntPtr res, uint sub, int type, uint flags, out D3D11_MAPPED_SUBRESOURCE m);       // 14
    delegate void CtxUnmap(IntPtr self, IntPtr res, uint sub);                                                        // 15
    delegate void CtxSetInputLayout(IntPtr self, IntPtr layout);                                                      // 17
    delegate void CtxSetTopology(IntPtr self, int topology);                                                          // 24
    delegate void CtxAsync(IntPtr self, IntPtr async);                                                                // 27 Begin, 28 End
    delegate int CtxGetData(IntPtr self, IntPtr async, IntPtr data, uint size, uint flags);                           // 29
    delegate void CtxSetRenderTargets(IntPtr self, uint n, ref IntPtr rtv, IntPtr dsv);                               // 33
    delegate void CtxSetViewports(IntPtr self, uint n, ref D3D11_VIEWPORT vp);                                        // 44
    delegate void CtxCopyRegion(IntPtr self, IntPtr dst, uint dstSub, uint x, uint y, uint z, IntPtr src, uint srcSub, ref D3D11_BOX box); // 46
    delegate void CtxUpdateSubresource(IntPtr self, IntPtr res, uint sub, IntPtr box, IntPtr data, uint rowPitch, uint depthPitch); // 48
    delegate void CtxGenerateMips(IntPtr self, IntPtr srv);                                                           // 54
    delegate int ScPresent(IntPtr self, uint sync, uint flags);                                                       // 8
    delegate int ScGetBuffer(IntPtr self, uint index, ref Guid iid, out IntPtr surface);                              // 9
    delegate int ScResizeBuffers(IntPtr self, uint count, uint w, uint h, int format, uint flags);                    // 13
    delegate int FactoryCreateForComposition(IntPtr self, IntPtr device, ref DXGI_SWAP_CHAIN_DESC1 d, IntPtr restrict, out IntPtr sc); // 24
    delegate int ObjGetParent(IntPtr self, ref Guid iid, out IntPtr parent);                                          // 6
    delegate int DxgiDevGetAdapter(IntPtr self, out IntPtr adapter);                                                  // 7
    delegate int DxgiDevSetMaxLatency(IntPtr self, uint n);                                                           // 12 (IDXGIDevice1)
    delegate int AdapterGetDesc(IntPtr self, out DXGI_ADAPTER_DESC d);                                                // 8
    delegate int MtSetProtected(IntPtr self, int on);                                                                 // 5 (ID3D11Multithread)
    delegate int DcCommit(IntPtr self);                                                                               // 3
    delegate int DcGetFrameStatistics(IntPtr self, out DCOMPOSITION_FRAME_STATISTICS s);                              // 5
    delegate int DcCreateTarget(IntPtr self, IntPtr hwnd, int topmost, out IntPtr target);                            // 6
    delegate int DcCreateVisual(IntPtr self, out IntPtr visual);                                                      // 7
    delegate int DcSetPtr(IntPtr self, IntPtr p);                                                                     // 3 Target.SetRoot, 15 Visual.SetContent
    delegate IntPtr BlobPtr(IntPtr self);                                                                             // 3 GetBufferPointer, 4 GetBufferSize
    delegate IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr l);
    delegate bool MonitorEnumProc(IntPtr hmon, IntPtr hdc, ref RECT r, IntPtr data);
    delegate int DevCreateBlendState(IntPtr self, ref D3D11_BLEND_DESC d, out IntPtr state);                          // 20
    delegate void CtxSetBlendState(IntPtr self, IntPtr state, float[] factor, uint mask);                              // 35
    delegate void CtxClearRtv(IntPtr self, IntPtr rtv, float[] rgba);                                                 // 50
    delegate int Adapter3QueryVideoMemory(IntPtr self, uint node, int group, out DXGI_QUERY_VIDEO_MEMORY_INFO info);   // 14 (IDXGIAdapter3)

    [StructLayout(LayoutKind.Sequential)]
    struct D3D11_RENDER_TARGET_BLEND_DESC
    {
        public int BlendEnable, SrcBlend, DestBlend, BlendOp, SrcBlendAlpha, DestBlendAlpha, BlendOpAlpha;
        public byte RenderTargetWriteMask;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct D3D11_BLEND_DESC
    {
        public int AlphaToCoverageEnable, IndependentBlendEnable;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 8)] public D3D11_RENDER_TARGET_BLEND_DESC[] RenderTarget;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct DXGI_QUERY_VIDEO_MEMORY_INFO { public ulong Budget, CurrentUsage, AvailableForReservation, CurrentReservation; }

    static class N
    {
        public const string OverlayClass = "RaptoruChaosPresenter";
        // Win32
        public const uint WS_POPUP = 0x80000000;
        public const int WS_EX_TOPMOST = 0x8, WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_LAYERED = 0x80000,
            WS_EX_NOREDIRECTIONBITMAP = 0x200000, WS_EX_NOACTIVATE = 0x8000000, GWL_EXSTYLE = -20;
        public const uint SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40, SWP_HIDEWINDOW = 0x80, SWP_NOOWNERZORDER = 0x200;
        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        public const int SW_HIDE = 0, SW_SHOWNOACTIVATE = 4;
        public const uint WM_DESTROY = 2, WM_PAINT = 0xF, WM_ERASEBKGND = 0x14, WM_MOUSEACTIVATE = 0x21, WM_NCHITTEST = 0x84, WM_HOTKEY = 0x312;
        public const uint QS_ALLINPUT = 0x4FF, MWMO_INPUTAVAILABLE = 4, PM_REMOVE = 1, GA_ROOTOWNER = 3, GW_OWNER = 4;
        public const uint WDA_EXCLUDEFROMCAPTURE = 0x11, LWA_ALPHA = 2;
        public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;
        public const int QUNS_RUNNING_D3D_FULL_SCREEN = 3;

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern ushort RegisterClassExW(ref WNDCLASSEX c);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr CreateWindowExW(int ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
        [DllImport("user32.dll")] public static extern IntPtr DefWindowProcW(IntPtr h, uint m, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int cy, uint flags);
        [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
        [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr h, uint affinity);
        [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr h, out uint affinity);
        [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr h, int index);
        [DllImport("user32.dll")] public static extern bool PeekMessageW(out MSG m, IntPtr h, uint min, uint max, uint remove);
        [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG m);
        [DllImport("user32.dll")] public static extern IntPtr DispatchMessageW(ref MSG m);
        [DllImport("user32.dll")] public static extern uint MsgWaitForMultipleObjectsEx(uint n, IntPtr[] handles, uint ms, uint wake, uint flags);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
        [DllImport("user32.dll")] public static extern bool GetMonitorInfoW(IntPtr mon, ref MONITORINFO mi);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfoW(IntPtr mon, ref MONITORINFOEX mi);
        [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplaySettingsExW(string dev, int mode, ref DEVMODE dm, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int ChangeDisplaySettingsExW(string dev, ref DEVMODE dm, IntPtr hwnd, uint flags, IntPtr param);
        /// lpDevMode NULL + flags 0 : l'écran (ou tous si dev = null) revient aux réglages enregistrés de Windows.
        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "ChangeDisplaySettingsExW")] public static extern int ResetDisplaySettings(string dev, IntPtr dm, IntPtr hwnd, uint flags, IntPtr param);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string name);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
        [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
        [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
        [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandleW(IntPtr name);
        [DllImport("kernel32.dll")] public static extern ulong GetTickCount64();
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
        [DllImport("user32.dll")] public static extern int GetMessageW(out MSG m, IntPtr h, uint min, uint max);
        [DllImport("user32.dll")] public static extern bool PostThreadMessageW(uint thread, uint msg, IntPtr w, IntPtr l);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll")] public static extern bool QueryPerformanceCounter(out long v);
        [DllImport("kernel32.dll")] public static extern bool QueryPerformanceFrequency(out long v);
        [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll")] public static extern bool TerminateProcess(IntPtr p, uint code);
        [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr CreateJobObjectW(IntPtr attrs, string name);
        [DllImport("kernel32.dll")] public static extern bool SetInformationJobObject(IntPtr job, int cls, IntPtr info, uint len);
        [DllImport("kernel32.dll")] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        // Direct3D, DXGI, DirectComposition
        [DllImport("d3d11.dll")]
        public static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, uint flags, IntPtr levels, uint nLevels, uint sdk, out IntPtr device, out int level, out IntPtr context);
        [DllImport("d3d11.dll")] public static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr inspectable);
        [DllImport("dcomp.dll")] public static extern int DCompositionCreateDevice(IntPtr dxgiDevice, ref Guid iid, out IntPtr device);
        [DllImport("d3dcompiler_47.dll", CharSet = CharSet.Ansi)]
        public static extern int D3DCompile(string src, IntPtr len, string name, IntPtr defines, IntPtr include, string entry, string target, uint f1, uint f2, out IntPtr code, out IntPtr errors);

        public static long QpcNow() { long v; QueryPerformanceCounter(out v); return v; }
        public static long QpcFreq() { long v; QueryPerformanceFrequency(out v); return v; }

        public static RECT FrameBounds(IntPtr hwnd)
        {
            RECT r;
            if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(hwnd, out r);
            return r;
        }
        public static RECT MonitorRect(IntPtr hwnd)
        {
            var mi = new MONITORINFO(); mi.cbSize = (uint)Marshal.SizeOf(typeof(MONITORINFO));
            GetMonitorInfoW(MonitorFromWindow(hwnd, 2), ref mi);
            return mi.rcMonitor;
        }
        public static RECT MonitorRectOf(IntPtr hmon)
        {
            var mi = new MONITORINFO(); mi.cbSize = (uint)Marshal.SizeOf(typeof(MONITORINFO));
            GetMonitorInfoW(hmon, ref mi);
            return mi.rcMonitor;
        }
        /// Nom Windows de l'écran (\\.\DISPLAYn), null si l'écran n'existe plus.
        public static string MonitorDevice(IntPtr hmon)
        {
            var mi = new MONITORINFOEX(); mi.cbSize = (uint)Marshal.SizeOf(typeof(MONITORINFOEX));
            return GetMonitorInfoW(hmon, ref mi) ? mi.szDevice : null;
        }
        public static List<IntPtr> Monitors()
        {
            var l = new List<IntPtr>();
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr m, IntPtr dc, ref RECT r, IntPtr d) => { l.Add(m); return true; }, IntPtr.Zero);
            return l;
        }
        public static IntPtr MonitorByDevice(string device)
        {
            foreach (var m in Monitors()) if (string.Equals(MonitorDevice(m), device, StringComparison.OrdinalIgnoreCase)) return m;
            return IntPtr.Zero;
        }
        public const int ENUM_CURRENT_SETTINGS = -1, ENUM_REGISTRY_SETTINGS = -2, DM_DISPLAYORIENTATION = 0x80;
        public const uint CDS_FULLSCREEN = 0x4;
        /// Mode d'affichage courant (ou enregistré) ; dmSize = 0 si l'écran est inconnu.
        public static DEVMODE DisplayMode(string device, int which = ENUM_CURRENT_SETTINGS)
        {
            var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
            if (!EnumDisplaySettingsExW(device, which, ref dm, 0)) dm.dmSize = 0;
            return dm;
        }
        /// Orientation (0 normale, 1 = 90°, 2 = 180°, 3 = 270°), -1 si l'écran est inconnu.
        public static int DisplayOrientation(string device, int which = ENUM_CURRENT_SETTINGS)
        {
            var dm = DisplayMode(device, which);
            return dm.dmSize == 0 ? -1 : dm.dmDisplayOrientation;
        }
        public static string WindowText(IntPtr h) { var sb = new StringBuilder(256); GetWindowTextW(h, sb, 256); return sb.ToString(); }
        public static string ClassName(IntPtr h) { var sb = new StringBuilder(256); GetClassNameW(h, sb, 256); return sb.ToString(); }
        public static bool IsCloaked(IntPtr h) { int v; return DwmGetWindowAttribute(h, DWMWA_CLOAKED, out v, 4) == 0 && v != 0; }

        /// Le processus enfant meurt avec ce processus (Windows ferme la tâche à notre sortie, même brutale).
        public static IntPtr KillOnCloseJob()
        {
            IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
            // JOBOBJECT_EXTENDED_LIMIT_INFORMATION (x64) : 144 octets ; LimitFlags à l'offset 16.
            IntPtr info = Marshal.AllocHGlobal(144);
            for (int i = 0; i < 144; i++) Marshal.WriteByte(info, i, 0);
            Marshal.WriteInt32(info, 16, 0x2000); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            SetInformationJobObject(job, 9, info, 144); // JobObjectExtendedLimitInformation
            Marshal.FreeHGlobal(info);
            return job;
        }
    }
}
