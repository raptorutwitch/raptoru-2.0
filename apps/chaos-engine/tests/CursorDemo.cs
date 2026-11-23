// Prototype isolé, piste C validée par Antoni le 23/11 (docs/chaos/ETUDE_CURSEUR.md) : retournement GPU d'une fenêtre
// avec UN seul curseur visible, celui que Windows dessine dans l'image capturée, retourné avec elle.
//   - le curseur Windows garde ses coordonnées et les clics tombent exactement aux coordonnées d'origine ;
//   - le curseur matériel est masqué (MagShowSystemCursor) seulement quand il survole la cible, rétabli dès qu'il en sort ;
//   - un gardien (processus séparé) rétablit le curseur si la démo plante, gèle ou est tuée ;
//   - aucune entrée interceptée, aucune injection, aucun jeu touché.
// Hors du moteur principal tant que les tests ne sont pas concluants.
// Usage : chaos-bench.exe --cursor-demo [--seconds 30] [--window premier-plan] [--autorise-pendant-un-jeu]
//   sans --window : une fenêtre de tuiles cliquables sur l'écran secondaire (cliquer une tuile l'allume) ;
//   --window premier-plan : la fenêtre au premier plan 3 s après le lancement (ex. Dofus, avec l'accord d'Antoni).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Raptoru.Chaos
{
    static class CursorDemo
    {
        [DllImport("Magnification.dll")] static extern bool MagInitialize();
        [DllImport("Magnification.dll")] static extern bool MagUninitialize();
        [DllImport("Magnification.dll")] static extern bool MagShowSystemCursor(bool show);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
        static string Arg(string[] a, string k, string d) { int i = Array.IndexOf(a, k); return i >= 0 && i + 1 < a.Length ? a[i + 1] : d; }

        // ---------- Gardien : rétablit le curseur si la démo meurt ou ne bat plus ----------
        public static int Guard(int pid)
        {
            Process parent;
            try { parent = Process.GetProcessById(pid); } catch (Exception) { Restore(); return 0; }
            long last = Environment.TickCount;
            var reader = new Thread(() =>
            {
                try { while (Console.In.Read() >= 0) Interlocked.Exchange(ref last, Environment.TickCount); } catch (Exception) { }
            }) { IsBackground = true };
            reader.Start();
            while (true)
            {
                if (parent.WaitForExit(100)) { Restore(); return 0; }                         // démo terminée ou tuée
                if (Environment.TickCount - Interlocked.Read(ref last) > 1000)                 // démo gelée : plus de battement
                {
                    Restore();
                    try { parent.Kill(); parent.WaitForExit(2000); } catch (Exception) { }
                    Restore();
                    return 0;
                }
            }
        }

        static void Restore() { bool i = MagInitialize(); MagShowSystemCursor(true); if (i) MagUninitialize(); }

        // ---------- Cible cliquable ----------
        sealed class ClickTarget : Form
        {
            const int Cols = 4, Rows = 3;
            readonly bool[] lit = new bool[Cols * Rows];
            public ClickTarget(Rectangle r)
            {
                FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual; Bounds = r;
                Text = "Chaos — cible cliquable"; ShowInTaskbar = false; DoubleBuffered = true; BackColor = Color.Black; TopMost = true;
            }
            protected override void OnMouseDown(MouseEventArgs e)
            {
                int c = e.X * Cols / ClientSize.Width, r = e.Y * Rows / ClientSize.Height;
                int i = r * Cols + c;
                if (i >= 0 && i < lit.Length) { lit[i] = !lit[i]; Console.WriteLine(J.Write(J.Map("click", i + 1, "x", e.X, "y", e.Y))); Invalidate(); }
            }
            protected override void OnPaint(PaintEventArgs e)
            {
                var g = e.Graphics;
                int w = ClientSize.Width, h = ClientSize.Height;
                Color[] palette = { Color.Firebrick, Color.SeaGreen, Color.RoyalBlue, Color.Goldenrod, Color.MediumPurple, Color.Teal };
                using (var f = new Font("Segoe UI", h / 10f, FontStyle.Bold))
                    for (int r = 0; r < Rows; r++)
                        for (int c = 0; c < Cols; c++)
                        {
                            int i = r * Cols + c;
                            var cell = new Rectangle(c * w / Cols + 4, r * h / Rows + 4, w / Cols - 8, h / Rows - 8);
                            using (var b = new SolidBrush(lit[i] ? Color.White : palette[i % palette.Length])) g.FillRectangle(b, cell);
                            g.DrawString((i + 1).ToString(), f, lit[i] ? Brushes.Black : Brushes.White, cell.X + 8, cell.Y + 4);
                        }
                using (var f = new Font("Segoe UI", h / 16f, FontStyle.Bold)) g.DrawString("HAUT ↑", f, Brushes.White, w / 2 - h / 6, 6);
            }
        }

        // ---------- Démo ----------
        public static int Run(string[] a)
        {
            string game = N.GameActivity();
            if (game != null && !a.Contains("--autorise-pendant-un-jeu")) { Console.WriteLine("Démo NON lancée : " + game + " (accord d'Antoni : --autorise-pendant-un-jeu)."); return 2; }
            int seconds = int.Parse(Arg(a, "--seconds", "30"));
            IntPtr target;
            Thread ui = null;
            ClickTarget form = null;
            if (Arg(a, "--window", null) == "premier-plan")
            {
                Console.WriteLine("Passer dans la fenêtre à retourner : départ dans 3 s.");
                Thread.Sleep(3000);
                target = N.GetAncestor(N.GetForegroundWindow(), N.GA_ROOTOWNER);
            }
            else
            {
                string primary = N.MonitorDevice(N.MonitorFromWindow(N.GetDesktopWindow(), 2));
                IntPtr hmon = N.Monitors().FirstOrDefault(m => N.MonitorDevice(m) != primary);
                if (hmon == IntPtr.Zero) hmon = N.MonitorFromWindow(N.GetDesktopWindow(), 2);
                RECT mr = N.MonitorRectOf(hmon);
                var r = new Rectangle(mr.Left + (mr.Right - mr.Left - 960) / 2, mr.Top + (mr.Bottom - mr.Top - 540) / 2, 960, 540);
                var ready = new ManualResetEvent(false);
                ui = new Thread(() => { form = new ClickTarget(r); form.Shown += (s, e) => ready.Set(); Application.Run(form); }) { IsBackground = true };
                ui.SetApartmentState(ApartmentState.STA);
                ui.Start();
                ready.WaitOne(5000);
                target = form.Handle;
                Thread.Sleep(300);
            }
            if (target == IntPtr.Zero || !N.IsWindow(target)) { Console.WriteLine("aucune fenêtre cible"); return 1; }

            // Gardien d'abord : quoi qu'il arrive ensuite, le curseur sera rétabli.
            var self = Process.GetCurrentProcess();
            var guard = Process.Start(new ProcessStartInfo(self.MainModule.FileName, "--cursor-guard " + self.Id) { UseShellExecute = false, RedirectStandardInput = true, CreateNoWindow = true });
            var beat = new System.Threading.Timer(_ => { try { guard.StandardInput.Write('.'); guard.StandardInput.Flush(); } catch (Exception) { } }, null, 0, 200);

            var gpu = new Gpu();
            var lib = new ShaderLibrary(gpu, Path.Combine(Path.GetTempPath(), "chaos-bench-shaders"));
            lib.Warm();
            var pool = new TexturePool(gpu);
            var evt = new AutoResetEvent(false);
            var cap = new WgcCaptureSource(gpu, null, evt, "demo", target, IntPtr.Zero, true) { ZeroCopy = true };
            var surf = new Surface(gpu, "demo", target, IntPtr.Zero, cap.Width, cap.Height);
            var fb = new FrameBuilder(cap.Width, cap.Height, true);
            bool init = MagInitialize(), hidden = false;
            int toggles = 0, presents = 0, frames = 0;
            long hiddenMs = 0, hiddenSince = 0;
            var added = new Samples();
            var clock = Stopwatch.StartNew();
            Console.WriteLine("Démo : " + N.WindowText(target) + " retournée pendant " + seconds + " s (MagInitialize " + (init ? "ok" : "ÉCHEC") + ").");
            try
            {
                while (clock.Elapsed.TotalSeconds < seconds && N.IsWindow(target))
                {
                    evt.WaitOne(2);
                    long now = clock.ElapsedMilliseconds;
                    // Curseur matériel masqué seulement au-dessus de la cible : jamais deux curseurs, jamais aucun ailleurs.
                    POINT p; GetCursorPos(out p);
                    RECT tr = N.FrameBounds(target);
                    bool over = p.X >= tr.Left && p.X < tr.Right && p.Y >= tr.Top && p.Y < tr.Bottom && surf.Shown;
                    if (init && over != hidden)
                    {
                        MagShowSystemCursor(!over);
                        if (over) hiddenSince = now; else hiddenMs += now - hiddenSince;
                        hidden = over; toggles++;
                    }
                    surf.Track();
                    if (!cap.Acquire(now) && surf.Shown) continue;
                    if (!cap.HasFrame) continue;
                    frames++;
                    fb.Reset(cap.Width, cap.Height, true);
                    fb.Transform(Math.PI, 1, 1, 0, 0, "black");
                    fb.Execute(gpu, lib, pool, null, cap.Srv, surf.BackBuffer, now, now / 1000f);
                    surf.Present(false);
                    presents++;
                    long next = surf.NextCompositionQpc();
                    if (next > cap.LastFrameQpc && (presents & 3) == 0) added.Add((next - cap.LastFrameQpc) * 1000.0 / N.QpcFreq());
                    surf.SetShown(true, now);
                }
            }
            finally
            {
                if (hidden) hiddenMs += clock.ElapsedMilliseconds - hiddenSince;
                MagShowSystemCursor(true);
                if (init) MagUninitialize();
                surf.SetShown(false, clock.ElapsedMilliseconds);
                surf.Dispose(); cap.Dispose();
                beat.Dispose();
                try { guard.StandardInput.Close(); guard.WaitForExit(2000); } catch (Exception) { }
                if (form != null) try { form.Invoke((Action)(() => form.Close())); } catch (Exception) { }
            }
            double secs = Math.Max(0.001, clock.Elapsed.TotalSeconds);
            Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "Fin : {0:0.0} images capturées/s, {1:0.0} présentées/s ; latence ajoutée estimée (image et curseur) p50 {2} ms, p95 {3} ms ; curseur matériel masqué {4:0.0} s, {5} bascules.",
                frames / secs, presents / secs, added.P(50), added.P(95), hiddenMs / 1000.0, toggles));
            return 0;
        }
    }
}
