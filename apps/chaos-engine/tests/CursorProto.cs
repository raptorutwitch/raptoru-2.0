// Prototype isolé (docs/chaos/ETUDE_CURSEUR.md), diagnostic du curseur pour la piste validée par Antoni : masquer le
// curseur matériel (MagShowSystemCursor, API Loupe de Windows) et montrer le curseur dans l'image retournée.
// Essai d'Antoni du 23/11 (--cursor-demo, deux fois) : curseur masqué au-dessus de la zone retournée, mais AUCUN curseur
// dans l'image capturée. Ce diagnostic sépare les causes possibles :
//   A  état de départ : pointe, fenêtre sous la pointe, GetCursorInfo (drapeaux, poignée de forme) ;
//   B  curseur VISIBLE : IsCursorCaptureEnabled relu ; curseur présent dans la texture capturée (capture d'écran, capture
//      de la fenêtre sous la pointe) ; conservé par la chaîne GPU (retournement 180° hors écran, point retourné) ;
//   C  curseur MASQUÉ : GetCursorInfo (la forme reste-t-elle lisible ?), Desktop Duplication, curseur dans la texture
//      capturée (écran, fenêtre) ;
//   D  sécurité : processus masqueur tué (le curseur revient-il seul ?), gelé (le gardien le rétablit-il ?).
// Présence du curseur dans une texture : écart entre deux captures simultanées de la même cible, l'une avec le curseur
// (IsCursorCaptureEnabled = vrai), l'autre sans ; rien d'autre ne change entre les deux.
// Il ne déplace jamais la souris, n'intercepte aucune entrée, ne touche à aucun jeu. Il masque le curseur au plus
// quelques secondes à la fois (le temps de deux captures) et le rétablit toujours. Il ne tourne que sans jeu ni plein écran, et si personne n'a touché la souris
// ou le clavier depuis 2 minutes (--maintenant : essai voulu par Antoni ; garder la souris immobile pendant 10 s).
// Usage : chaos-bench.exe --cursor-proto [--maintenant]
using System;
using System.Collections.Generic;
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
        const int Half = 24;
        static Gpu gpu;
        static ShaderLibrary lib;
        static TexturePool pool;

        static string Info()
        {
            var ci = new CURSORINFO { cbSize = Marshal.SizeOf(typeof(CURSORINFO)) };
            if (!GetCursorInfo(ref ci)) return "GetCursorInfo échoue";
            string f = (ci.flags & 1) != 0 ? "affiché" : (ci.flags & 2) != 0 ? "supprimé" : "caché";
            return "drapeaux « " + f + " », forme " + (ci.hCursor != IntPtr.Zero ? "0x" + ci.hCursor.ToInt64().ToString("X") : "AUCUNE");
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

        /// Une image capturée (BGRA), éventuellement retournée de 180° par la vraie chaîne GPU du moteur (FrameBuilder).
        sealed class Grab { public byte[] Px; public uint W, H; public bool CursorFlag; public string Error; }

        static Grab Capture(IntPtr hwnd, IntPtr hmon, bool cursor, bool flip)
        {
            var g = new Grab();
            var evt = new AutoResetEvent(false);
            WgcCaptureSource src;
            try { src = new WgcCaptureSource(gpu, null, evt, "diag", hwnd, hmon, cursor) { ZeroCopy = false }; }
            catch (Exception e) { g.Error = e.Message; return g; }
            IntPtr staging = IntPtr.Zero, outTex = IntPtr.Zero, outRtv = IntPtr.Zero;
            try
            {
                g.CursorFlag = src.CursorCaptureEnabled;
                var sw = Stopwatch.StartNew(); bool got = false;
                while (sw.ElapsedMilliseconds < 1200 && !(got && sw.ElapsedMilliseconds > 250)) { evt.WaitOne(50); if (src.Acquire(sw.ElapsedMilliseconds)) got = true; }
                if (!got) { g.Error = "aucune image"; return g; }
                g.W = src.Width; g.H = src.Height;
                IntPtr from = src.CopyTexture;
                if (flip)
                {
                    outTex = gpu.Texture(g.W, g.H, 1, 0x8 | 0x20, 0, 0, 0);
                    outRtv = gpu.Rtv(outTex);
                    var fb = new FrameBuilder(g.W, g.H, true);
                    fb.Transform(Math.PI, 1, 1, 0, 0, "black");
                    fb.Execute(gpu, lib, pool, null, src.Srv, outRtv, 0, 0);
                    from = outTex;
                }
                staging = gpu.Texture(g.W, g.H, 1, 0, 0, 3, 0x20000);
                gpu.Copy(staging, from, 0, 0, g.W, g.H);
                g.Px = gpu.ReadBack(staging, g.W, g.H);
                return g;
            }
            catch (Exception e) { g.Error = e.Message; return g; }
            finally { Com.Release(ref staging); Com.Release(ref outRtv); Com.Release(ref outTex); src.Dispose(); }
        }

        /// Pixels qui diffèrent entre deux images autour de (x, y) : la trace du curseur.
        static int Diff(Grab a, Grab b, int x, int y)
        {
            if (a.Px == null || b.Px == null || a.W != b.W || a.H != b.H) return -1;
            int n = 0;
            for (int yy = y - Half; yy < y + Half; yy++)
                for (int xx = x - Half; xx < x + Half; xx++)
                {
                    if (xx < 0 || yy < 0 || xx >= a.W || yy >= a.H) continue;
                    int i = (int)((yy * a.W + xx) * 4);
                    if (Math.Abs(a.Px[i] - b.Px[i]) + Math.Abs(a.Px[i + 1] - b.Px[i + 1]) + Math.Abs(a.Px[i + 2] - b.Px[i + 2]) > 60) n++;
                }
            return n;
        }

        /// Curseur présent dans la capture ? Deux essais (avec / sans curseur), le plus net retenu ; flip : au point retourné.
        static string Present(IntPtr hwnd, IntPtr hmon, int x, int y, bool flip, out bool flag, int tries = 2)
        {
            int best = -1; flag = false; string err = null;
            for (int t = 0; t < tries; t++)
            {
                var on = Capture(hwnd, hmon, true, flip); var off = Capture(hwnd, hmon, false, flip);
                if (on.Error != null || off.Error != null) { err = on.Error ?? off.Error; continue; }
                flag = on.CursorFlag;
                int px = flip ? (int)on.W - 1 - x : x, py = flip ? (int)on.H - 1 - y : y;
                best = Math.Max(best, Diff(on, off, px, py));
            }
            if (best < 0) return "capture impossible (" + err + ")";
            return (best >= 20 ? "OUI" : "non") + " (" + best + " pixels de curseur)";
        }

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

        static void Restore() { bool i = MagInitialize(); MagShowSystemCursor(true); if (i) MagUninitialize(); }

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
            lib = new ShaderLibrary(gpu, Path.Combine(Path.GetTempPath(), "chaos-bench-shaders"));
            lib.Warm();
            pool = new TexturePool(gpu);
            POINT p; GetCursorPos(out p);
            IntPtr under = N.GetAncestor(N.WindowFromPoint(p), 2 /* GA_ROOT */);
            IntPtr hmon = N.MonitorFromWindow(under, 2);
            RECT mon = N.MonitorRectOf(hmon), wr = N.FrameBounds(under);
            uint wpid; N.GetWindowThreadProcessId(under, out wpid);
            string wname; try { wname = Process.GetProcessById((int)wpid).ProcessName; } catch (Exception) { wname = "?"; }
            int mx = p.X - mon.Left, my = p.Y - mon.Top, wx = p.X - wr.Left, wy = p.Y - wr.Top;
            var report = new List<string>();
            Action<string> say = s => { Console.WriteLine(s); report.Add(s); };
            say("Diagnostic du curseur — " + DateTime.Now.ToString("dd/MM HH:mm:ss") + ", Windows " + Environment.OSVersion.Version);
            say("A  pointe (" + p.X + ", " + p.Y + ") sur " + N.MonitorDevice(hmon) + ", au-dessus de « " + wname + ".exe » ; " + Info() + " ; Desktop Duplication « " + DdPointer(hmon) + " »");
            bool flag;
            say("B  curseur VISIBLE");
            say("   B1 capture d'écran : " + Present(IntPtr.Zero, hmon, mx, my, false, out flag) + " ; IsCursorCaptureEnabled relu : " + flag);
            say("   B2 capture de la fenêtre sous la pointe : " + Present(under, IntPtr.Zero, wx, wy, false, out flag) + " ; relu : " + flag);
            say("   B3 chaîne GPU (capture d'écran retournée à 180°, point retourné) : " + Present(IntPtr.Zero, hmon, mx, my, true, out flag));
            bool init = MagInitialize();
            say("C  curseur MASQUÉ (MagInitialize " + (init ? "ok" : "ÉCHEC") + ")");
            if (init)
            {
                try
                {
                    // Le temps de deux captures au plus par étape ; rétabli entre les étapes.
                    say("   C1 MagShowSystemCursor(FALSE) : " + (MagShowSystemCursor(false) ? "ok" : "ÉCHEC") + " ; " + Info() + " ; Desktop Duplication « " + DdPointer(hmon) + " »");
                    MagShowSystemCursor(true); Thread.Sleep(200);
                    MagShowSystemCursor(false);
                    string c2 = Present(IntPtr.Zero, hmon, mx, my, false, out flag, 1);
                    MagShowSystemCursor(true); Thread.Sleep(200);
                    say("   C2 capture d'écran : " + c2 + " ; relu : " + flag);
                    MagShowSystemCursor(false);
                    string c3 = Present(under, IntPtr.Zero, wx, wy, false, out flag, 1);
                    MagShowSystemCursor(true);
                    say("   C3 capture de la fenêtre : " + c3 + " ; relu : " + flag);
                }
                finally { MagShowSystemCursor(true); MagUninitialize(); }
                Thread.Sleep(200);
                say("   rétabli : " + Info() + " ; Desktop Duplication « " + DdPointer(hmon) + " »");
            }
            say("D  sécurité");
            var self = Process.GetCurrentProcess().MainModule.FileName;
            var child = Process.Start(new ProcessStartInfo(self, "--cursor-hide-child") { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true });
            string line = child.StandardOutput.ReadLine();
            Thread.Sleep(150);
            string during = DdPointer(hmon);
            child.Kill(); child.WaitForExit(3000);
            Thread.Sleep(300);
            string after = DdPointer(hmon);
            say("   D1 processus masqueur (" + line + ", Desktop Duplication « " + during + " ») tué : curseur « " + after + " » ; " + Info());
            if (after == "invisible")
            {
                string again = "invisible";
                for (int t = 0; t < 15 && again == "invisible"; t++) { Restore(); Thread.Sleep(t == 0 ? 200 : 2000); again = DdPointer(hmon); }
                say("      rétablissement par un autre processus : « " + again + " »" + (again == "invisible" ? " — CURSEUR TOUJOURS MASQUÉ : fermer puis rouvrir la session Windows" : ""));
            }
            var frozen = Process.Start(new ProcessStartInfo(self, "--cursor-hide-child") { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true });
            string fl = frozen.StandardOutput.ReadLine();
            var guard = Process.Start(new ProcessStartInfo(self, "--cursor-guard " + frozen.Id) { UseShellExecute = false, RedirectStandardInput = true, CreateNoWindow = true });
            var sw5 = Stopwatch.StartNew();
            string state5 = DdPointer(hmon);
            while (sw5.ElapsedMilliseconds < 4000 && state5 != "visible") { Thread.Sleep(100); state5 = DdPointer(hmon); }
            say("   D2 processus masqueur gelé (" + fl + "), gardien sans battement : curseur « " + state5 + " » après " + sw5.ElapsedMilliseconds + " ms, masqueur " +
                (frozen.WaitForExit(2000) ? "arrêté par le gardien" : "encore vivant"));
            try { if (!frozen.HasExited) frozen.Kill(); guard.StandardInput.Close(); guard.WaitForExit(2000); } catch (Exception) { }
            Restore();
            string outFile = Path.Combine(Path.GetTempPath(), "chaos-cursor-diag-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".txt");
            File.WriteAllLines(outFile, report);
            Console.WriteLine("Résultats : " + outFile);
            return 0;
        }
    }
}
