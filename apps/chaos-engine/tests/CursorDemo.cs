// Prototype isolé, piste C validée par Antoni le 23/11 (docs/chaos/ETUDE_CURSEUR.md) : retournement GPU d'une fenêtre
// avec UN seul curseur visible, celui que Windows dessine dans l'image capturée, retourné avec elle.
//   - le curseur Windows garde ses coordonnées et les clics tombent exactement aux coordonnées d'origine ;
//   - le curseur matériel est masqué (MagShowSystemCursor) seulement quand il survole la cible, rétabli dès qu'il en sort ;
//   - un gardien (processus séparé) rétablit le curseur si la démo plante, gèle ou est tuée ;
//   - aucune entrée interceptée, aucune injection, aucun jeu touché.
// Hors du moteur principal tant que les tests ne sont pas concluants.
// Usage : chaos-bench.exe --cursor-demo [--seconds 30] [--window premier-plan] [--curseur dessine|capture] [--autorise-pendant-un-jeu]
//   --curseur dessine (défaut depuis le 23/11) : image du vrai curseur (forme et position lues chaque image) dessinée
//   retournée au point miroir ; --curseur capture : curseur dans l'image capturée (absent dès qu'il est masqué).
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
        [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
        [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }
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

        // ---------- Auto-test hors écran (aucune fenêtre, curseur jamais masqué) ----------
        [DllImport("user32.dll")] static extern IntPtr LoadCursorW(IntPtr inst, IntPtr id);

        /// Vérifie l'image du curseur (forme lue, pointe, alpha) et sa pose par le moteur (FrameBuilder.AddCursor) : la pointe
        /// tombe sur le point transformé de la vraie position, à tous les angles. Texture hors écran relue.
        public static int SelfTest()
        {
            var gpu = new Gpu();
            var lib = new ShaderLibrary(gpu, Path.Combine(Path.GetTempPath(), "chaos-bench-shaders"));
            var pool = new TexturePool(gpu);
            var images = new CursorImages(gpu);
            int ok = 0, ko = 0;
            Action<bool, string> check = (c, what) => { if (c) ok++; else ko++; Console.WriteLine((c ? "  ok  " : "  KO  ") + what); };
            foreach (var kv in new[] { new KeyValuePair<string, int>("flèche", 32512), new KeyValuePair<string, int>("barre de texte", 32513), new KeyValuePair<string, int>("main", 32649) })
            {
                IntPtr h = LoadCursorW(IntPtr.Zero, new IntPtr(kv.Value));
                var img = images.Get(h);
                if (img == null) { check(false, kv.Key + " : forme illisible"); continue; }
                var st = gpu.Texture((uint)img.Tex.W, (uint)img.Tex.H, 1, 0, 0, 3, 0x20000);
                gpu.Copy(st, img.Tex.Tex, 0, 0, (uint)img.Tex.W, (uint)img.Tex.H);
                var px = gpu.ReadBack(st, (uint)img.Tex.W, (uint)img.Tex.H);
                Com.Release(ref st);
                int opaque = 0; for (int i = 3; i < px.Length; i += 4) if (px[i] > 128) opaque++;
                check(opaque > 20 && opaque < img.Tex.W * img.Tex.H / 2, kv.Key + " : " + img.Tex.W + "×" + img.Tex.H + ", pointe (" + img.HotX + ", " + img.HotY + "), " + opaque + " pixels opaques");
            }
            // Pose par le moteur (FrameBuilder.AddCursor) : une image source 400×300 porte un repère rouge à la vraie
            // position du curseur (100, 50) ; après la transformation de l'image, la pointe dessinée doit tomber sur le
            // repère transformé, à tous les angles (rotation animée comprise), le corps de la flèche tourné d'autant.
            uint W = 400, H = 300;
            var arrow = images.Get(LoadCursorW(IntPtr.Zero, new IntPtr(32512)));
            var src = new byte[W * H * 4];
            for (int i = 3; i < src.Length; i += 4) src[i] = 255;
            for (int y = 48; y <= 52; y++) for (int x = 98; x <= 102; x++) { int i = (int)((y * W + x) * 4); src[i + 2] = 255; }
            var srcTex = gpu.TextureWithData(W, H, src);
            var srcSrv = gpu.Srv(srcTex);
            var outTex = gpu.Texture(W, H, 1, 0x8 | 0x20, 0, 0, 0);
            var outRtv = gpu.Rtv(outTex);
            var stg = gpu.Texture(W, H, 1, 0, 0, 3, 0x20000);
            Func<double, bool, byte[]> render = (angle, withCursor) =>
            {
                var fb = new FrameBuilder(W, H, true);
                fb.Transform(angle, 1, 1, 0, 0, "black");
                if (withCursor) fb.AddCursor(arrow.Tex, arrow.HotX, arrow.HotY, 100, 50);
                fb.Execute(gpu, lib, pool, null, srcSrv, outRtv, 0, 0);
                gpu.Copy(stg, outTex, 0, 0, W, H);
                return gpu.ReadBack(stg, W, H);
            };
            foreach (var deg in new[] { 0.0, 37.0, 90.0, 143.0, 180.0 })
            {
                double th = deg * Math.PI / 180;
                var plain = render(th, false); var drawn = render(th, true);
                double mx = 0, my = 0; int mn = 0;
                for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) { int i = (int)((y * W + x) * 4); if (plain[i + 2] > 150 && plain[i + 1] < 80) { mx += x; my += y; mn++; } }
                if (mn == 0) { check(false, deg + "° : repère hors de l'image"); continue; }
                mx /= mn; my /= mn;
                double best = 1e9, bx = 0, by = 0; int cn = 0;
                for (int y = 0; y < H; y++) for (int x = 0; x < W; x++)
                {
                    int i = (int)((y * W + x) * 4);
                    if (Math.Abs(drawn[i] - plain[i]) + Math.Abs(drawn[i + 1] - plain[i + 1]) + Math.Abs(drawn[i + 2] - plain[i + 2]) < 60) continue;
                    cn++; bx += x; by += y;
                    double dd = Math.Sqrt((x - mx) * (x - mx) + (y - my) * (y - my));
                    if (dd < best) best = dd;
                }
                bx /= Math.Max(1, cn); by /= Math.Max(1, cn);
                // Corps de la flèche : en bas à droite de la pointe sans rotation, tourné de l'angle de l'image.
                double ex = Math.Cos(th) - Math.Sin(th), ey = Math.Sin(th) + Math.Cos(th);
                bool oriented = (bx - mx) * ex + (by - my) * ey > 0;
                check(cn > 40 && best <= 2.5 && oriented, deg + "° : pointe du curseur sur le repère transformé (écart " + Math.Round(best, 1) + " px), corps orienté avec l'image, " + cn + " pixels");
            }
            Com.Release(ref stg); Com.Release(ref outRtv); Com.Release(ref outTex); Com.Release(ref srcSrv); Com.Release(ref srcTex); images.Dispose();
            Console.WriteLine("Total : " + ok + " ok, " + ko + " KO");
            return ko == 0 ? 0 : 1;
        }

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
            // capture : curseur dans l'image capturée (Windows le retire quand il est masqué : essai du 23/11) ;
            // dessine : image du vrai curseur (forme et position courantes) dessinée retournée au point miroir.
            bool drawn = Arg(a, "--curseur", "dessine") != "capture";
            var cap = new WgcCaptureSource(gpu, null, evt, "demo", target, IntPtr.Zero, !drawn) { ZeroCopy = true };
            var surf = new Surface(gpu, "demo", target, IntPtr.Zero, cap.Width, cap.Height);
            var fb = new FrameBuilder(cap.Width, cap.Height, true);
            var pacer = new Pacer(gpu, surf.Hmon, surf.RefreshHz, evt);
            pacer.Need(drawn);
            var images = new CursorImages(gpu);
            bool init = MagInitialize(), hidden = false;
            int toggles = 0, presents = 0, frames = 0, cursorFrames = 0;
            long hiddenMs = 0, hiddenSince = 0, seenTicks = 0, lastKey = 0;
            var added = new Samples();
            var cursorLatency = new Samples();
            var hiddenStates = new HashSet<string>();
            var clock = Stopwatch.StartNew();
            Console.WriteLine("Démo : « " + N.WindowText(target) + " » retournée pendant " + seconds + " s, curseur " + (drawn ? "dessiné (image du vrai curseur)" : "dans la capture") +
                " ; MagInitialize " + (init ? "ok" : "ÉCHEC") + " ; écran " + surf.RefreshHz + " Hz, rythme " + pacer.Mode + ".");
            try
            {
                while (clock.Elapsed.TotalSeconds < seconds && N.IsWindow(target))
                {
                    evt.WaitOne(4);
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
                    bool fresh = cap.Acquire(now);
                    if (!cap.HasFrame) continue;
                    // Le vrai curseur : forme et position lues à l'instant du rendu (lecture seule).
                    var ci = new CURSORINFO { cbSize = Marshal.SizeOf(typeof(CURSORINFO)) };
                    long sampleQpc = N.QpcNow();
                    bool ciOk = GetCursorInfo(ref ci);
                    if (hidden) hiddenStates.Add(!ciOk ? "GetCursorInfo échoue" : ((ci.flags & 1) != 0 ? "affiché" : (ci.flags & 2) != 0 ? "supprimé" : "caché") + (ci.hCursor != IntPtr.Zero ? ", forme lisible" : ", AUCUNE forme"));
                    // Dessiné seulement quand le curseur matériel est masqué par la démo et que le programme visé montre un
                    // curseur (un jeu qui le cache, visée à la souris, n'en a pas).
                    bool drawCursor = drawn && hidden && ciOk && ci.hCursor != IntPtr.Zero && (ci.flags & 3) != 0;
                    long key = drawCursor ? ((long)ci.pt.X << 40) ^ ((long)ci.pt.Y << 20) ^ ci.hCursor.ToInt64() : 0;
                    bool tick = pacer.Ticks != seenTicks;
                    if (tick) seenTicks = pacer.Ticks;
                    if (!fresh && surf.Shown && !(tick && key != lastKey)) continue;
                    lastKey = key;
                    if (fresh) frames++;
                    fb.Reset(cap.Width, cap.Height, true);
                    fb.Transform(Math.PI, 1, 1, 0, 0, "black");
                    if (drawCursor)
                    {
                        var img = images.Get(ci.hCursor);
                        if (img != null) { fb.AddCursor(img.Tex, img.HotX, img.HotY, ci.pt.X - tr.Left, ci.pt.Y - tr.Top); cursorFrames++; }
                    }
                    fb.Execute(gpu, lib, pool, null, cap.Srv, surf.BackBuffer, now, now / 1000f);
                    surf.Present(false);
                    presents++;
                    long next = surf.NextCompositionQpc();
                    if (fresh && next > cap.LastFrameQpc && (presents & 3) == 0) added.Add((next - cap.LastFrameQpc) * 1000.0 / N.QpcFreq());
                    if (drawCursor && next > sampleQpc) cursorLatency.Add((next - sampleQpc) * 1000.0 / N.QpcFreq());
                    surf.SetShown(true, now);
                }
            }
            finally
            {
                if (hidden) hiddenMs += clock.ElapsedMilliseconds - hiddenSince;
                MagShowSystemCursor(true);
                if (init) MagUninitialize();
                pacer.Need(false);
                surf.SetShown(false, clock.ElapsedMilliseconds);
                surf.Dispose(); cap.Dispose(); images.Dispose();
                beat.Dispose();
                try { guard.StandardInput.Close(); guard.WaitForExit(2000); } catch (Exception) { }
                if (form != null) try { form.Invoke((Action)(() => form.Close())); } catch (Exception) { }
            }
            double secs = Math.Max(0.001, clock.Elapsed.TotalSeconds);
            Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "Fin : {0:0.0} images capturées/s, {1:0.0} présentées/s ; latence ajoutée de l'image p50 {2} ms (p95 {3}) ; curseur matériel masqué {4:0.0} s, {5} bascules.",
                frames / secs, presents / secs, added.P(50), added.P(95), hiddenMs / 1000.0, toggles));
            if (drawn) Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "Curseur dessiné : {0} images, {1} forme(s) lue(s) ; position lue → composition prévue p50 {2} ms (p95 {3}).",
                cursorFrames, images.Built, cursorLatency.P(50), cursorLatency.P(95)));
            Console.WriteLine("Pendant le masquage, GetCursorInfo : " + (hiddenStates.Count > 0 ? string.Join(" | ", hiddenStates) : "jamais masqué (souris jamais au-dessus de la cible)") + ".");
            return 0;
        }
    }
}
