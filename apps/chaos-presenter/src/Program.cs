// Point d'entrée : sans argument = panneau de test ; --serve = lecteur ; --test-target = fenêtre-mire des contrôles.
using System;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Raptoru.Chaos
{
    static class Program
    {
        public const string Version = "0.1.0-lot1";

        [STAThread]
        static int Main(string[] args)
        {
            string mode = args.Length > 0 ? args[0] : "";
            if (mode == "--serve")
            {
                N.SetProcessDpiAwarenessContext(new IntPtr(-4)); // pixels physiques
                return new Presenter().Run(IntArg(args, "--parent", 0));
            }
            if (mode == "--test-target")
            {
                N.SetProcessDpiAwarenessContext(new IntPtr(-4));
                Application.Run(new TestTarget(IntArg(args, "--x", 100), IntArg(args, "--y", 100), IntArg(args, "--w", 400), IntArg(args, "--h", 240)));
                return 0;
            }
            if (mode == "--version") { Console.WriteLine(Version); return 0; }
            N.SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (mode == "--panel-snapshot" && args.Length > 1)
            {
                // Contrôle de mise en page : le panneau est dessiné dans une image, sans jamais apparaître à l'écran.
                var shot = new Panel { Opacity = 0, ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Location = new Point(-30000, -30000) };
                shot.Shown += (s, e) =>
                {
                    using (var bmp = new Bitmap(shot.Width, shot.Height)) { shot.DrawToBitmap(bmp, new Rectangle(Point.Empty, shot.Size)); bmp.Save(args[1]); }
                    shot.Close();
                };
                Application.Run(shot);
                return 0;
            }
            if (mode == "--panel-selftest" && args.Length > 2)
            {
                var p = new Panel();
                p.SelfTest(new IntPtr(long.Parse(args[1])), args[2]);
                Application.Run(p);
                return 0;
            }
            Application.Run(new Panel());
            return 0;
        }

        static int IntArg(string[] a, string name, int def)
        {
            for (int i = 0; i + 1 < a.Length; i++) if (a[i] == name) { int v; if (int.TryParse(a[i + 1], out v)) return v; }
            return def;
        }
    }

    /// Mire des contrôles automatiques : 4 quadrants de couleurs connues (rouge, vert / bleu, jaune) et une bande
    /// centrale animée (pour que Windows envoie des images). Jamais activée, au premier plan. Se ferme avec son stdin.
    sealed class TestTarget : Form
    {
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 15 };
        int tick;

        public TestTarget(int x, int y, int w, int h)
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Bounds = new Rectangle(x, y, w, h);
            Text = "Chaos test target";
            TopMost = true;
            ShowInTaskbar = false;
            DoubleBuffered = true;
            BackColor = Color.Black;
            timer.Tick += (s, e) => { tick++; Invalidate(); };
            timer.Start();
        }

        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= N.WS_EX_NOACTIVATE | N.WS_EX_TOOLWINDOW | N.WS_EX_TOPMOST; return cp; }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            var o = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
            o.WriteLine("{\"ev\":\"target\",\"hwnd\":" + Handle.ToInt64() + ",\"pid\":" + System.Diagnostics.Process.GetCurrentProcess().Id + "}");
            if (!Console.IsInputRedirected) return;
            new Thread(() =>
            {
                try { var r = new StreamReader(Console.OpenStandardInput()); while (r.ReadLine() != null) { } } catch (Exception) { }
                Environment.Exit(0);
            }) { IsBackground = true }.Start();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            int w = ClientSize.Width, h = ClientSize.Height, hw = w / 2, hh = h / 2;
            var g = e.Graphics;
            g.FillRectangle(Brushes.Red, 0, 0, hw, hh);
            g.FillRectangle(Brushes.Lime, hw, 0, w - hw, hh);
            g.FillRectangle(Brushes.Blue, 0, hh, hw, h - hh);
            g.FillRectangle(Brushes.Yellow, hw, hh, w - hw, h - hh);
            int band = h / 5;
            g.FillRectangle(Brushes.Gray, 0, hh - band / 2, w, band);
            g.FillRectangle(Brushes.White, (tick * 6) % w, hh - band / 2 + 4, band - 8, band - 8);
            g.DrawString("HAUT " + tick, SystemFonts.DefaultFont, Brushes.Black, 6, 6);
        }
    }
}
