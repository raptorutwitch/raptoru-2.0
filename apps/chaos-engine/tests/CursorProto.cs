// Prototype isolé (docs/chaos/ETUDE_CURSEUR.md) : vérifie les prérequis de la seule piste qui donnerait, avec le calque
// GPU, un curseur unique, retourné et juste : masquer le curseur matériel (MagShowSystemCursor, API Loupe de Windows) et
// laisser Windows dessiner le curseur dans l'image capturée (WGC IsCursorCaptureEnabled), retournée avec le reste.
// Il ne déplace jamais la souris, n'intercepte aucune entrée, ne touche à aucun jeu. Il masque le curseur au plus une
// seconde à la fois, le rétablit toujours, et ne tourne que sans jeu ni plein écran ET si personne n'a touché la
// souris ou le clavier depuis 2 minutes (--maintenant pour un essai voulu par Antoni).
// Questions :
//   Q1 la capture WGC contient-elle le curseur (mesure de référence) ?
//   Q2 MagShowSystemCursor(FALSE) le masque-t-il (état Windows, Desktop Duplication) ?
//   Q3 la capture WGC le contient-elle encore une fois masqué ?
//   Q4 si le processus qui l'a masqué est tué, le curseur revient-il seul ? sinon, un autre processus (le gardien)
//      peut-il le rétablir ?
// Usage : chaos-bench.exe --cursor-proto [--maintenant]
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

namespace Raptoru.Chaos
{
    static class CursorProto
    {
        [DllImport("Magnification.dll")] static extern bool MagInitialize();
        [DllImport("Magnification.dll")] static extern bool MagUninitialize();
        [DllImport("Magnification.dll")] static extern bool MagShowSystemCursor(bool show);
        [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO li);
        [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }
        [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public int cbSize; public uint dwTime; }
        static readonly Guid IidOutput1 = new Guid("00cddea8-939b-4b83-a340-a685226666cc");
        static Gpu gpu;

        static string Flags()
        {
            var ci = new CURSORINFO { cbSize = Marshal.SizeOf(typeof(CURSORINFO)) };
            if (!GetCursorInfo(ref ci)) return "?";
            return (ci.flags & 1) != 0 ? "affiché" : (ci.flags & 2) != 0 ? "supprimé" : "caché";
        }

        static double IdleSeconds()
        {
            var li = new LASTINPUTINFO { cbSize = Marshal.SizeOf(typeof(LASTINPUTINFO)) };
            return GetLastInputInfo(ref li) ? unchecked((uint)Environment.TickCount - li.dwTime) / 1000.0 : 0;
        }

        /// Visibilité du pointeur selon Desktop Duplication (nouvelle duplication : état initial du pointeur).
        static string DdPointer(IntPtr hmon)
        {
            IntPtr output = Pacer.FindOutput(gpu, hmon), o1 = IntPtr.Zero, dup = IntPtr.Zero;
            if (output == IntPtr.Zero) return "indisponible";
            try
            {
                o1 = Com.QI(output, IidOutput1);
                if (Com.Fn<OutDuplicate>(o1, 22)(o1, gpu.Device, out dup) < 0) return "indisponible";
                var acquire = Com.Fn<DupAcquire>(dup, 8); var release = Com.Fn<DupRelease>(dup, 14);
                var sw = Stopwatch.StartNew();
                while (sw.ElapsedMilliseconds < 800)
                {
                    DXGI_OUTDUPL_FRAME_INFO info; IntPtr res;
                    if (acquire(dup, 100, out info, out res) < 0) continue;
                    Com.Release(ref res); release(dup);
                    if (info.LastMouseUpdateTime != 0) return info.PointerVisible != 0 ? "visible" : "invisible";
                }
                return "inconnu";
            }
            catch (Exception) { return "indisponible"; }
            finally { Com.Release(ref dup); Com.Release(ref o1); Com.Release(ref output); }
        }

        /// Pixels autour de la pointe du curseur dans une capture WGC de l'écran, curseur inclus ou non.
        static byte[] Region(IntPtr hmon, RECT mon, POINT p, bool cursor, int half)
        {
            var evt = new AutoResetEvent(false);
            var src = new WgcCaptureSource(gpu, null, evt, "proto", IntPtr.Zero, hmon, cursor) { ZeroCopy = false };
            try
            {
                var sw = Stopwatch.StartNew(); bool got = false;
                while (sw.ElapsedMilliseconds < 1200 && !(got && sw.ElapsedMilliseconds > 250)) { evt.WaitOne(50); if (src.Acquire(sw.ElapsedMilliseconds)) got = true; }
                if (!got) return null;
                uint w = src.Width, h = src.Height;
                var staging = gpu.Texture(w, h, 1, 0, 0, 3, 0x20000);
                try
                {
                    gpu.Copy(staging, src.CopyTexture, 0, 0, w, h);
                    var px = gpu.ReadBack(staging, w, h);
                    var r = new byte[(2 * half) * (2 * half) * 3];
                    int k = 0;
                    for (int y = p.Y - mon.Top - half; y < p.Y - mon.Top + half; y++)
                        for (int x = p.X - mon.Left - half; x < p.X - mon.Left + half; x++)
                        {
                            int i = (int)((Math.Max(0, Math.Min(h - 1, y)) * w + Math.Max(0, Math.Min(w - 1, x))) * 4);
                            r[k++] = px[i]; r[k++] = px[i + 1]; r[k++] = px[i + 2];
                        }
                    return r;
                }
                finally { Com.Release(ref staging); }
            }
            finally { src.Dispose(); }
        }

        /// Le curseur est-il dans la capture ? (pixels qui diffèrent entre capture avec et sans curseur, deux essais)
        static string CursorInCapture(IntPtr hmon, RECT mon, POINT p)
        {
            int best = 0;
            for (int t = 0; t < 2; t++)
            {
                var off = Region(hmon, mon, p, false, 24); var on = Region(hmon, mon, p, true, 24);
                if (off == null || on == null) return "capture impossible";
                int diff = 0;
                for (int i = 0; i < off.Length; i += 3) if (Math.Abs(off[i] - on[i]) + Math.Abs(off[i + 1] - on[i + 1]) + Math.Abs(off[i + 2] - on[i + 2]) > 60) diff++;
                best = Math.Max(best, diff);
            }
            return best >= 20 ? "oui (" + best + " pixels)" : "non (" + best + " pixels)";
        }

        /// Processus enfant : masque le curseur et attend d'être tué (test de plantage).
        public static int Child()
        {
            if (!MagInitialize()) { Console.WriteLine("mag_init_failed"); return 1; }
            bool ok = MagShowSystemCursor(false);
            Console.WriteLine(ok ? "hidden" : "hide_failed");
            Console.Out.Flush();
            Thread.Sleep(10000);
            MagShowSystemCursor(true); MagUninitialize();
            return 0;
        }

        public static int Run(string[] a)
        {
            string game = N.GameActivity();
            if (game != null && !a.Contains("--autorise-pendant-un-jeu")) { Console.WriteLine("Prototype NON lancé : " + game + "."); return 2; }
            double idle = IdleSeconds();
            if (idle < 120 && !a.Contains("--maintenant"))
            {
                Console.WriteLine("Prototype NON lancé : la souris ou le clavier ont servi il y a " + Math.Round(idle) + " s (il masque le curseur une seconde ; --maintenant pour un essai voulu).");
                return 2;
            }
            gpu = new Gpu();
            POINT p; GetCursorPos(out p);
            IntPtr hmon = N.MonitorFromWindow(N.WindowFromPoint(p), 2);
            RECT mon = N.MonitorRectOf(hmon);
            Console.WriteLine("Prototype curseur — pointe en (" + p.X + ", " + p.Y + ") sur " + N.MonitorDevice(hmon) + " ; la souris n'est jamais déplacée.");
            var report = new System.Collections.Generic.List<string>();
            Action<string> say = s => { Console.WriteLine("  " + s); report.Add(s); };
            say("Avant : état Windows « " + Flags() + " », Desktop Duplication « " + DdPointer(hmon) + " »");
            say("Q1 curseur dans la capture WGC (IsCursorCaptureEnabled) : " + CursorInCapture(hmon, mon, p));
            bool init = MagInitialize();
            say("MagInitialize sans droits particuliers : " + (init ? "ok" : "ÉCHEC"));
            if (init)
            {
                try
                {
                    bool hid = MagShowSystemCursor(false);
                    var sw = Stopwatch.StartNew();
                    Thread.Sleep(150);
                    say("Q2 MagShowSystemCursor(FALSE) : " + (hid ? "ok" : "ÉCHEC") + " — état Windows « " + Flags() + " », Desktop Duplication « " + DdPointer(hmon) + " »");
                    say("Q3 curseur dans la capture WGC une fois masqué : " + CursorInCapture(hmon, mon, p) + " (masqué " + sw.ElapsedMilliseconds + " ms)");
                }
                finally { MagShowSystemCursor(true); MagUninitialize(); }
                Thread.Sleep(150);
                say("Rétabli : état Windows « " + Flags() + " », Desktop Duplication « " + DdPointer(hmon) + " »");
            }
            // Q4 : plantage du processus qui a masqué le curseur.
            var self = Process.GetCurrentProcess().MainModule.FileName;
            var child = Process.Start(new ProcessStartInfo(self, "--cursor-hide-child") { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true });
            string line = child.StandardOutput.ReadLine();
            Thread.Sleep(150);
            string during = DdPointer(hmon);
            child.Kill(); child.WaitForExit(3000);
            Thread.Sleep(300);
            string after = DdPointer(hmon), afterFlags = Flags();
            say("Q4 processus masqueur (" + line + ", Desktop Duplication « " + during + " ») tué : curseur « " + after + " », état Windows « " + afterFlags + " »");
            if (after == "invisible")
            {
                // Filet : un autre processus rétablit le curseur (ce que ferait le gardien), plusieurs essais.
                string again = "invisible";
                for (int t = 0; t < 15 && again == "invisible"; t++)
                {
                    bool i2 = MagInitialize();
                    MagShowSystemCursor(true); if (i2) MagUninitialize();
                    Thread.Sleep(t == 0 ? 200 : 2000);
                    again = DdPointer(hmon);
                }
                say("    rétablissement par un autre processus (le gardien) : Desktop Duplication « " + again + " »" +
                    (again == "invisible" ? " — CURSEUR TOUJOURS MASQUÉ : fermer puis rouvrir la session Windows" : ""));
            }
            string outFile = Path.Combine(Path.GetTempPath(), "chaos-cursor-proto-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".txt");
            File.WriteAllLines(outFile, report);
            Console.WriteLine("Résultats : " + outFile);
            return 0;
        }
    }
}
