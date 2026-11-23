// Cadence d'affichage de l'écran d'une cible. Present(1) suivrait l'écran PRINCIPAL (« the DXGI swapchain API always uses
// the cadence of the primary monitor », documentation de l'horloge du compositeur) : 60 Hz ici, même pour un effet sur
// l'écran à 144 Hz, et l'appel bloque le fil de rendu. Le moteur présente donc toujours sans attendre (Present(0)) et
// cale les images qui ne dépendent pas d'une nouvelle capture (animations, calques, cadence plafonnée) sur un fil qui
// attend le retour de balayage de CET écran (IDXGIOutput::WaitForVBlank). Repli : minuteur haute résolution à la
// fréquence de l'écran. Le fil dort tant qu'aucune surface n'en a besoin (zéro réveil au repos).
using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace Raptoru.Chaos
{
    sealed class Pacer : IDisposable
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWaitableTimerExW(IntPtr attrs, string name, uint flags, uint access);
        [DllImport("kernel32.dll")] static extern bool SetWaitableTimer(IntPtr h, ref long due, int period, IntPtr cb, IntPtr arg, bool resume);
        const uint HighResolution = 0x2, TimerAllAccess = 0x1F0003;

        public readonly IntPtr Monitor;
        public readonly int Hz;
        public readonly string Mode;
        readonly AutoResetEvent wake;
        readonly ManualResetEvent needed = new ManualResetEvent(false);
        IntPtr output, timer;
        readonly OutWaitForVBlank waitVBlank;
        volatile bool disposed;
        long ticks, lastQpc;
        public long Ticks { get { return Interlocked.Read(ref ticks); } }
        public long LastTickQpc { get { return Interlocked.Read(ref lastQpc); } }

        public Pacer(Gpu gpu, IntPtr hmon, int hz, AutoResetEvent wake)
        {
            Monitor = hmon; Hz = Math.Max(24, hz); this.wake = wake;
            output = FindOutput(gpu, hmon);
            if (output != IntPtr.Zero) { waitVBlank = Com.Fn<OutWaitForVBlank>(output, 10); Mode = "vblank"; }
            else
            {
                timer = CreateWaitableTimerExW(IntPtr.Zero, null, HighResolution, TimerAllAccess);
                Mode = timer != IntPtr.Zero ? "timer" : "sleep";
            }
            new Thread(Run) { IsBackground = true, Name = "pacer", Priority = ThreadPriority.AboveNormal }.Start();
        }

        /// Sortie DXGI (écran) de l'adaptateur du moteur qui affiche hmon ; 0 si l'écran est branché ailleurs.
        static IntPtr FindOutput(Gpu gpu, IntPtr hmon)
        {
            IntPtr adapter;
            if (Com.Fn<DxgiDevGetAdapter>(gpu.DxgiDevice, 7)(gpu.DxgiDevice, out adapter) < 0) return IntPtr.Zero;
            try
            {
                var enumOutputs = Com.Fn<AdapterEnumOutputs>(adapter, 7);
                for (uint i = 0; i < 16; i++)
                {
                    IntPtr o;
                    if (enumOutputs(adapter, i, out o) < 0) break;
                    DXGI_OUTPUT_DESC d;
                    if (Com.Fn<OutGetDesc>(o, 7)(o, out d) >= 0 && d.Monitor == hmon) return o;
                    Marshal.Release(o);
                }
            }
            finally { Marshal.Release(adapter); }
            return IntPtr.Zero;
        }

        /// Une surface a besoin (ou plus besoin) d'images cadencées.
        public void Need(bool on) { if (on) needed.Set(); else needed.Reset(); }

        void Run()
        {
            long period100ns = 10000000L / Hz;
            while (!disposed)
            {
                needed.WaitOne();
                if (disposed) break;
                bool ok = false;
                if (output != IntPtr.Zero) ok = waitVBlank(output) >= 0;
                if (!ok && timer != IntPtr.Zero)
                {
                    long due = -period100ns;
                    ok = SetWaitableTimer(timer, ref due, 0, IntPtr.Zero, IntPtr.Zero, false) && N.WaitForSingleObject(timer, 1000) == 0;
                }
                if (!ok) Thread.Sleep(Math.Max(1, 1000 / Hz));
                Interlocked.Exchange(ref lastQpc, N.QpcNow());
                Interlocked.Increment(ref ticks);
                wake.Set();
            }
        }

        /// Un rythmeur par écran, gardé toute la vie du moteur (le fil dort sans surface) : jamais de sortie DXGI libérée
        /// pendant une attente.
        public void Dispose() { disposed = true; needed.Set(); }
    }
}
