// chaos-obs-check.exe : vérifie dans le VRAI moteur d'OBS (libobs installée + obs-shaderfilter), sans ouvrir OBS, les
// filtres exportés par ChaosEngine.exe --obs-export. Aucune fenêtre, aucune scène ni réglage d'OBS touchés : libobs est
// chargée dans ce processus, avec un dossier de configuration jetable ; elle compose une scène de test (jeu = image de
// synthèse avec les filtres Chaos, « webcam » et « alerte » posées au-dessus) et rend des images hors écran.
// Vérifie : compilation des effets par OBS, image du jeu proche du rendu du moteur au même instant, webcam et alerte
// inchangées, effet qui démarre à l'activation et se termine seul. Rapport : report.json + planche PNG.
// Usage : chaos-obs-check.exe <dossier d'export> [<dossier d'export>…] --out <dossier> [--obs "C:\Program Files\obs-studio"]
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Raptoru.Chaos
{
    static class ObsHeadless
    {
        // ---------- libobs (API C, OBS 33) ----------
        const CallingConvention C = CallingConvention.Cdecl;
        [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern bool SetDllDirectory(string p);
        [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern IntPtr LoadLibrary(string p);
        [StructLayout(LayoutKind.Sequential)]
        struct VideoInfo { public IntPtr Module; public uint FpsNum, FpsDen, BaseW, BaseH, OutW, OutH; public int Format; public uint Adapter; [MarshalAs(UnmanagedType.U1)] public bool GpuConv; public int Cs, Range, Scale; }
        [StructLayout(LayoutKind.Sequential)] struct Vec2 { public float X, Y; }
        [UnmanagedFunctionPointer(C)] delegate void RawVideo(IntPtr param, IntPtr frame);
        [DllImport("obs.dll", CallingConvention = C)] [return: MarshalAs(UnmanagedType.U1)] static extern bool obs_startup(string locale, string cfg, IntPtr store);
        [DllImport("obs.dll", CallingConvention = C)] static extern int obs_reset_video(ref VideoInfo v);
        [DllImport("obs.dll", CallingConvention = C)] static extern int obs_open_module(out IntPtr m, string path, string data);
        [DllImport("obs.dll", CallingConvention = C)] [return: MarshalAs(UnmanagedType.U1)] static extern bool obs_init_module(IntPtr m);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_shutdown();
        [DllImport("obs.dll", CallingConvention = C)] static extern IntPtr obs_data_create();
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_data_release(IntPtr d);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_data_set_string(IntPtr d, string k, byte[] v);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_data_set_bool(IntPtr d, string k, [MarshalAs(UnmanagedType.U1)] bool v);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_data_set_double(IntPtr d, string k, double v);
        [DllImport("obs.dll", CallingConvention = C)] static extern IntPtr obs_data_get_string(IntPtr d, string k);
        [DllImport("obs.dll", CallingConvention = C)] static extern IntPtr obs_source_create(string id, byte[] name, IntPtr settings, IntPtr hotkeys);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_source_release(IntPtr s);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_source_update(IntPtr s, IntPtr settings);
        [DllImport("obs.dll", CallingConvention = C)] static extern IntPtr obs_source_get_settings(IntPtr s);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_source_filter_add(IntPtr s, IntPtr f);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_source_filter_remove(IntPtr s, IntPtr f);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_source_set_enabled(IntPtr s, [MarshalAs(UnmanagedType.U1)] bool on);
        [DllImport("obs.dll", CallingConvention = C)] static extern IntPtr obs_scene_create(string name);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_scene_release(IntPtr s);
        [DllImport("obs.dll", CallingConvention = C)] static extern IntPtr obs_scene_add(IntPtr scene, IntPtr source);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_sceneitem_set_pos(IntPtr item, ref Vec2 pos);
        [DllImport("obs.dll", CallingConvention = C)] static extern IntPtr obs_scene_get_source(IntPtr scene);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_set_output_source(uint channel, IntPtr source);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_add_raw_video_callback(IntPtr conversion, RawVideo cb, IntPtr param);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_remove_raw_video_callback(RawVideo cb, IntPtr param);

        static byte[] Utf8(string s) { return Encoding.UTF8.GetBytes(s + "\0"); }

        // ---------- Images reçues de la sortie vidéo (RGBA) ----------
        static readonly object gate = new object();
        static byte[] last;
        static long frames;
        static int W, H;
        static bool countOnly;
        static readonly RawVideo onFrame = (p, f) =>
        {
            if (countOnly) { lock (gate) frames++; return; }
            IntPtr data = Marshal.ReadIntPtr(f, 0);
            int pitch = Marshal.ReadInt32(f, 8 * IntPtr.Size);
            var b = new byte[W * H * 4];
            for (int y = 0; y < H; y++) Marshal.Copy(new IntPtr(data.ToInt64() + (long)y * pitch), b, y * W * 4, W * 4);
            // Sortie « RGBA » de libobs 33 lue ici : octets B, V, R, A (vérifié sur la webcam et l'alerte de test).
            for (int i = 0; i < b.Length; i += 4) { byte t = b[i]; b[i] = b[i + 2]; b[i + 2] = t; }
            long ts = Marshal.ReadInt64(f, 8 * IntPtr.Size + 32); // video_data.timestamp (ns, horloge os_gettime_ns)
            lock (gate) { last = b; frames++; if (recording != null) recording.Add(new KeyValuePair<long, byte[]>(ts, b)); }
        };
        static List<KeyValuePair<long, byte[]>> recording;
        /// Horloge d'OBS (os_gettime_ns : compteur de performances de Windows), en ns et en s.
        static long NowNs() { return (long)(System.Diagnostics.Stopwatch.GetTimestamp() * (1e9 / System.Diagnostics.Stopwatch.Frequency)); }
        /// Image rendue au moins `settleMs` après l'appel (les réglages d'un filtre s'appliquent au tic vidéo suivant).
        static byte[] Grab(int settleMs)
        {
            long n0; lock (gate) n0 = frames;
            Thread.Sleep(settleMs);
            for (int i = 0; i < 100; i++) { lock (gate) if (frames > n0 + 3) return (byte[])last.Clone(); Thread.Sleep(20); }
            throw new InvalidOperationException("aucune image de la sortie vidéo d'OBS");
        }

        static IntPtr Data(Dictionary<string, object> kv)
        {
            var d = obs_data_create();
            foreach (var e in kv)
            {
                if (e.Value is bool) obs_data_set_bool(d, e.Key, (bool)e.Value);
                else if (e.Value is string) obs_data_set_string(d, e.Key, Utf8((string)e.Value));
                else obs_data_set_double(d, e.Key, Convert.ToDouble(e.Value, CultureInfo.InvariantCulture));
            }
            return d;
        }
        static IntPtr Source(string id, string name, Dictionary<string, object> kv)
        {
            var d = Data(kv);
            var s = obs_source_create(id, Utf8(name), d, IntPtr.Zero);
            obs_data_release(d);
            if (s == IntPtr.Zero) throw new InvalidOperationException("obs_source_create " + id);
            return s;
        }
        static void Update(IntPtr s, Dictionary<string, object> kv) { var d = Data(kv); obs_source_update(s, d); obs_data_release(d); }
        static string Setting(IntPtr s, string k)
        {
            var d = obs_source_get_settings(s);
            var p = obs_data_get_string(d, k);
            string v = p == IntPtr.Zero ? "" : Utf8At(p);
            obs_data_release(d);
            return v;
        }
        static string Utf8At(IntPtr p)
        {
            var l = new List<byte>();
            for (int i = 0; ; i++) { byte b = Marshal.ReadByte(p, i); if (b == 0) break; l.Add(b); }
            return Encoding.UTF8.GetString(l.ToArray());
        }

        // ---------- Images ----------
        static byte[] LoadRgba(string file)
        {
            using (var bmp = new Bitmap(file))
            {
                var b = new byte[bmp.Width * bmp.Height * 4];
                var d = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                var row = new byte[bmp.Width * 4];
                for (int y = 0; y < bmp.Height; y++)
                {
                    Marshal.Copy(new IntPtr(d.Scan0.ToInt64() + (long)y * d.Stride), row, 0, row.Length);
                    for (int x = 0; x < bmp.Width; x++) { int i = (y * bmp.Width + x) * 4; b[i] = row[x * 4 + 2]; b[i + 1] = row[x * 4 + 1]; b[i + 2] = row[x * 4]; b[i + 3] = row[x * 4 + 3]; }
                }
                bmp.UnlockBits(d);
                return b;
            }
        }
        static Bitmap ToBitmap(byte[] rgba)
        {
            var bmp = new Bitmap(W, H, PixelFormat.Format32bppArgb);
            var d = bmp.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            var row = new byte[W * 4];
            for (int y = 0; y < H; y++)
            {
                for (int x = 0; x < W; x++) { int i = (y * W + x) * 4; row[x * 4] = rgba[i + 2]; row[x * 4 + 1] = rgba[i + 1]; row[x * 4 + 2] = rgba[i]; row[x * 4 + 3] = 255; }
                Marshal.Copy(row, 0, new IntPtr(d.Scan0.ToInt64() + (long)y * d.Stride), row.Length);
            }
            bmp.UnlockBits(d);
            return bmp;
        }
        /// Écarts RVB (0..255) entre deux images sur une zone, avec ou sans en exclure d'autres : moyenne, p99, max.
        static Dictionary<string, object> Diff(byte[] a, byte[] b, Rectangle area, params Rectangle[] skip)
        {
            var d = new List<int>();
            for (int y = area.Top; y < area.Bottom; y++)
                for (int x = area.Left; x < area.Right; x++)
                {
                    if (skip.Any(r => r.Contains(x, y))) continue;
                    int i = (y * W + x) * 4;
                    d.Add(Math.Max(Math.Abs(a[i] - b[i]), Math.Max(Math.Abs(a[i + 1] - b[i + 1]), Math.Abs(a[i + 2] - b[i + 2]))));
                }
            d.Sort();
            double mean = d.Count == 0 ? 0 : d.Average();
            return new Dictionary<string, object> { { "mean", Math.Round(mean, 2) }, { "p99", d.Count == 0 ? 0 : d[(int)(d.Count * 0.99)] }, { "max", d.Count == 0 ? 0 : d[d.Count - 1] } };
        }
        /// Écart moyen rapide (un pixel sur 6 en tous sens, zone du jeu hors webcam et alerte) : rapprochement d'images.
        static double Coarse(byte[] a, byte[] b)
        {
            long sum = 0; int n = 0;
            for (int y = H / 6; y < H * 5 / 6; y += 6)
                for (int x = 0; x < W * 2 / 3; x += 6)
                {
                    int i = (y * W + x) * 4;
                    sum += Math.Abs(a[i] - b[i]) + Math.Abs(a[i + 1] - b[i + 1]) + Math.Abs(a[i + 2] - b[i + 2]);
                    n += 3;
                }
            return n == 0 ? 0 : sum / (double)n;
        }
        static double Mean(Dictionary<string, object> d) { return Convert.ToDouble(d["mean"], CultureInfo.InvariantCulture); }
        static int Max(Dictionary<string, object> d) { return Convert.ToInt32(d["max"], CultureInfo.InvariantCulture); }

        /// « Webcam » et « alerte » de la scène de test : des images reconnaissables, qui ne doivent jamais changer.
        static void Props(string dir, out string cam, out string alert, int cw, int ch, int aw, int ah)
        {
            cam = Path.Combine(dir, "test-webcam.png");
            using (var b = new Bitmap(cw, ch))
            using (var g = Graphics.FromImage(b))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.FromArgb(30, 34, 44));
                g.FillEllipse(Brushes.PeachPuff, cw * 0.32f, ch * 0.18f, cw * 0.36f, ch * 0.46f);
                g.FillRectangle(Brushes.SteelBlue, cw * 0.2f, ch * 0.66f, cw * 0.6f, ch * 0.34f);
                g.DrawRectangle(new Pen(Color.Gold, 3), 1, 1, cw - 3, ch - 3);
                b.Save(cam, ImageFormat.Png);
            }
            alert = Path.Combine(dir, "test-alerte.png");
            using (var b = new Bitmap(aw, ah, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(b))
            {
                g.Clear(Color.Transparent);
                using (var br = new SolidBrush(Color.FromArgb(255, 120, 40, 160))) g.FillRectangle(br, 0, 0, aw, ah);
                using (var f = new Font("Segoe UI", ah * 0.32f, FontStyle.Bold)) g.DrawString("ALERTE : nouvel abonné !", f, Brushes.White, 8, ah * 0.2f);
                b.Save(alert, ImageFormat.Png);
            }
        }

        // ---------- --cursor-toggle : « Capturer le curseur » d'une capture d'écran, basculé pendant la capture ----------
        [DllImport("obs.dll", CallingConvention = C)] static extern IntPtr obs_source_properties(IntPtr s);
        [DllImport("obs.dll", CallingConvention = C)] static extern IntPtr obs_properties_get(IntPtr props, string name);
        [DllImport("obs.dll", CallingConvention = C)] static extern void obs_properties_destroy(IntPtr props);
        [DllImport("obs.dll", CallingConvention = C)] static extern UIntPtr obs_property_list_item_count(IntPtr p);
        [DllImport("obs.dll", CallingConvention = C)] static extern IntPtr obs_property_list_item_name(IntPtr p, UIntPtr i);
        [DllImport("obs.dll", CallingConvention = C)] static extern IntPtr obs_property_list_item_string(IntPtr p, UIntPtr i);
        [DllImport("obs.dll", CallingConvention = C)] static extern uint obs_source_get_width(IntPtr s);
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
        struct Sample { public long Ts; public double Mean, Zero; }
        static readonly List<Sample> samples = new List<Sample>();
        static readonly RawVideo onSample = (p, f) =>
        {
            // ~1 900 points répartis sur l'image : moyenne et part de pixels noirs (source vide = noir sur le canevas).
            IntPtr data = Marshal.ReadIntPtr(f, 0);
            int pitch = Marshal.ReadInt32(f, 8 * IntPtr.Size);
            long ts = Marshal.ReadInt64(f, 8 * IntPtr.Size + 32);
            double sum = 0; int zero = 0, n = 0;
            for (int y = H / 40; y < H; y += H / 40)
                for (int x = W / 50; x < W; x += W / 50)
                {
                    int v = Marshal.ReadInt32(new IntPtr(data.ToInt64() + (long)y * pitch + x * 4));
                    int lum = (v & 0xff) + ((v >> 8) & 0xff) + ((v >> 16) & 0xff);
                    sum += lum; if (lum <= 3) zero++; n++;
                }
            lock (gate) samples.Add(new Sample { Ts = ts, Mean = sum / n / 3, Zero = (double)zero / n });
        };

        /// chaos-obs-check.exe --cursor-toggle --out <dossier> [--method 1|2] [--monitor <texte du nom>] [--toggles 8]
        /// Capture d'écran (« monitor_capture », méthode DXGI = 1 comme « Écran », ou WGC = 2) dans libobs sans fenêtre ;
        /// « capture_cursor » basculé toutes les 1,2 s par obs_source_update (ce que fait SetInputSettings d'OBS
        /// WebSocket) ; compte les images vides ou noircies autour de chaque bascule et vérifie que la source reste la
        /// même. Lit l'écran en mémoire seulement (aucune image enregistrée), rien d'affiché, OBS réel non touché.
        static int CursorToggle(string[] args)
        {
            string obsDir = @"C:\Program Files\obs-studio", outDir = null, match = "@ 0,0";
            int method = 1, toggles = 8;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--out" && i + 1 < args.Length) outDir = args[++i];
                else if (args[i] == "--obs" && i + 1 < args.Length) obsDir = args[++i];
                else if (args[i] == "--method" && i + 1 < args.Length) method = int.Parse(args[++i]);
                else if (args[i] == "--monitor" && i + 1 < args.Length) match = args[++i];
                else if (args[i] == "--toggles" && i + 1 < args.Length) toggles = int.Parse(args[++i]);
            }
            if (outDir == null) { Console.Error.WriteLine("--out obligatoire"); return 2; }
            Directory.CreateDirectory(outDir);
            SetProcessDpiAwarenessContext(new IntPtr(-4)); // pixels physiques : sinon DuplicateOutput1 est refusé (887A0004)
            var scr = System.Windows.Forms.Screen.PrimaryScreen.Bounds;
            W = scr.Width; H = scr.Height;
            string bin = Path.Combine(obsDir, @"bin\64bit");
            SetDllDirectory(bin);
            Directory.SetCurrentDirectory(bin);
            if (LoadLibrary(Path.Combine(bin, "obs.dll")) == IntPtr.Zero) { Console.Error.WriteLine("obs.dll introuvable : " + bin); return 2; }
            string cfg = Path.Combine(Path.GetFullPath(outDir), "obs-config").Replace('\\', '/') + "/";
            Directory.CreateDirectory(cfg);
            if (!obs_startup("fr-FR", cfg, IntPtr.Zero)) { Console.Error.WriteLine("obs_startup"); return 1; }
            var report = new Dictionary<string, object>();
            int failures = 0;
            try
            {
                var vi = new VideoInfo { Module = Marshal.StringToHGlobalAnsi("libobs-d3d11"), FpsNum = 60, FpsDen = 1, BaseW = (uint)W, BaseH = (uint)H, OutW = (uint)W, OutH = (uint)H, Format = 6, GpuConv = true, Cs = 2, Range = 2, Scale = 3 };
                int rv = obs_reset_video(ref vi);
                if (rv != 0) throw new InvalidOperationException("obs_reset_video " + rv);
                string plugins = obsDir.Replace('\\', '/');
                IntPtr mod;
                int r = obs_open_module(out mod, plugins + "/core/win-capture/win-capture.dll", plugins + "/core/win-capture/data");
                if (r != 0 || !obs_init_module(mod)) throw new InvalidOperationException("win-capture non chargé (" + r + ")");
                report["obs"] = FileVersion(Path.Combine(bin, "obs64.exe"));
                var src = Source("monitor_capture", "Écran (test)", new Dictionary<string, object> { { "method", method }, { "capture_cursor", true } });
                // Écran : l'élément de la liste « monitor_id » dont le nom contient `match` (défaut : l'écran en 0,0).
                IntPtr props = obs_source_properties(src), prop = obs_properties_get(props, "monitor_id");
                string id = null, name = null;
                var names = new List<string>();
                for (uint i = 0; prop != IntPtr.Zero && i < (uint)obs_property_list_item_count(prop); i++)
                {
                    string nm = Utf8At(obs_property_list_item_name(prop, (UIntPtr)i)), v = Utf8At(obs_property_list_item_string(prop, (UIntPtr)i));
                    names.Add(nm);
                    if (id == null && nm.Contains(match)) { id = v; name = nm; }
                }
                obs_properties_destroy(props);
                report["monitors"] = names.ToArray();
                if (id == null) throw new InvalidOperationException("écran introuvable (« " + match + " ») parmi : " + string.Join(" | ", names));
                report["monitor"] = name; report["method"] = method == 1 ? "DXGI" : method == 2 ? "WGC" : "auto";
                Update(src, new Dictionary<string, object> { { "monitor_id", id } });
                obs_set_output_source(0, src);
                obs_add_raw_video_callback(IntPtr.Zero, onSample, IntPtr.Zero);
                Thread.Sleep(2500);
                IntPtr before = src;
                uint w0 = obs_source_get_width(src);
                long baseStart = NowNs();
                Thread.Sleep(3000);
                long baseEnd = NowNs();
                var marks = new List<KeyValuePair<long, bool>>();
                bool on = true;
                for (int k = 0; k < toggles; k++)
                {
                    on = !on;
                    marks.Add(new KeyValuePair<long, bool>(NowNs(), on));
                    Update(src, new Dictionary<string, object> { { "capture_cursor", on } });
                    Thread.Sleep(1200);
                }
                obs_remove_raw_video_callback(onSample, IntPtr.Zero);
                obs_set_output_source(0, IntPtr.Zero);
                List<Sample> all;
                lock (gate) all = samples.ToList();
                Func<Sample, bool> blank = s => s.Zero > 0.97;
                var baseline = all.Where(s => s.Ts >= baseStart && s.Ts < baseEnd).ToList();
                double baseMean = baseline.Count > 0 ? baseline.Average(s => s.Mean) : 0;
                // « noirci » : moyenne tombée sous 60 % de la référence (trou partiel) ; « vide » : ≥ 97 % de pixels noirs.
                Func<Sample, bool> dark = s => blank(s) || baseMean > 8 && s.Mean < 0.6 * baseMean;
                var per = new List<object>();
                int worst = 0;
                foreach (var m in marks)
                {
                    var win = all.Where(s => s.Ts >= m.Key && s.Ts < m.Key + 600000000L).ToList();
                    int nb = win.Count(blank), nd = win.Count(dark);
                    worst = Math.Max(worst, nd);
                    per.Add(J.Map("capture_cursor", m.Value, "frames_600ms", win.Count, "blank_frames", nb, "dark_frames", nd,
                        "first_dark_ms", nd > 0 ? (object)Math.Round((win.First(dark).Ts - m.Key) / 1e6, 1) : null));
                }
                report["baseline"] = J.Map("frames", baseline.Count, "blank_frames", baseline.Count(blank), "dark_frames", baseline.Count(dark), "mean", Math.Round(baseMean, 1));
                report["toggles"] = per.ToArray();
                report["same_source"] = before == src && obs_source_get_width(src) == w0;
                report["worst_dark_frames_per_toggle"] = worst;
                Console.WriteLine("Écran : " + name + " · méthode " + report["method"] + " · référence : " + baseline.Count + " images, " + baseline.Count(dark) + " noircies");
                foreach (Dictionary<string, object> t in per)
                    Console.WriteLine("  capture_cursor → " + t["capture_cursor"] + " : " + t["dark_frames"] + " image(s) vide(s) ou noircie(s) sur " + t["frames_600ms"] + " en 600 ms" + (t["first_dark_ms"] != null ? " (dès " + t["first_dark_ms"] + " ms)" : ""));
                obs_source_release(src);
            }
            catch (Exception e) { report["error"] = e.Message; failures++; Console.Error.WriteLine(e.Message); }
            File.WriteAllText(Path.Combine(outDir, "report.json"), J.Write(report), new UTF8Encoding(false));
            Console.Out.Flush();
            obs_shutdown();
            return failures == 0 ? 0 : 1;
        }

        public static int Main(string[] args)
        {
            if (args.Contains("--cursor-toggle")) return CursorToggle(args);
            string obsDir = @"C:\Program Files\obs-studio", outDir = null;
            uint fps = 0;
            var dirs = new List<string>();
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--out" && i + 1 < args.Length) outDir = args[++i];
                else if (args[i] == "--obs" && i + 1 < args.Length) obsDir = args[++i];
                else if (args[i] == "--perf") countOnly = true;
                else if (args[i] == "--fps" && i + 1 < args.Length) fps = uint.Parse(args[++i]);
                else dirs.Add(args[i]);
            }
            if (outDir == null || dirs.Count == 0) { Console.Error.WriteLine("usage : chaos-obs-check.exe <export>… --out <dossier>"); return 2; }
            Directory.CreateDirectory(outDir);
            var manifests = dirs.Select(d => new KeyValuePair<string, Dictionary<string, object>>(d, J.Parse(File.ReadAllText(Path.Combine(d, "manifest.json"))))).ToList();
            var size = J.Arr(manifests[0].Value, "size");
            W = Convert.ToInt32(size[0]); H = Convert.ToInt32(size[1]);

            string bin = Path.Combine(obsDir, @"bin\64bit");
            SetDllDirectory(bin);
            Directory.SetCurrentDirectory(bin); // libobs cherche ses effets dans ../../data/libobs
            if (LoadLibrary(Path.Combine(bin, "obs.dll")) == IntPtr.Zero) { Console.Error.WriteLine("obs.dll introuvable : " + bin); return 2; }
            string cfg = Path.Combine(Path.GetFullPath(outDir), "obs-config").Replace('\\', '/') + "/";
            Directory.CreateDirectory(cfg);
            if (!obs_startup("fr-FR", cfg, IntPtr.Zero)) { Console.Error.WriteLine("obs_startup"); return 1; }
            var report = new Dictionary<string, object>();
            int failures = 0;
            try
            {
                var vi = new VideoInfo { Module = Marshal.StringToHGlobalAnsi("libobs-d3d11"), FpsNum = fps > 0 ? fps : countOnly ? 60u : 30u, FpsDen = 1, BaseW = (uint)W, BaseH = (uint)H, OutW = (uint)W, OutH = (uint)H, Format = 6 /* RGBA */, GpuConv = true, Cs = 2, Range = 2, Scale = 3 };
                int rv = obs_reset_video(ref vi);
                if (rv != 0) throw new InvalidOperationException("obs_reset_video " + rv);
                string plugins = obsDir.Replace('\\', '/');
                foreach (var m in new[] { new[] { plugins + "/core/image-source/image-source.dll", plugins + "/core/image-source/data" },
                                          new[] { plugins + "/obs-plugins/64bit/obs-shaderfilter.dll", plugins + "/data/obs-plugins/obs-shaderfilter" } })
                {
                    IntPtr mod;
                    int r = obs_open_module(out mod, m[0], m[1]);
                    if (r != 0 || !obs_init_module(mod)) throw new InvalidOperationException("module OBS non chargé : " + m[0] + " (" + r + ")");
                }
                report["obs"] = FileVersion(Path.Combine(bin, "obs64.exe"));
                report["shaderfilter"] = FileVersion(Path.Combine(obsDir, @"obs-plugins\64bit\obs-shaderfilter.dll"));
                int cw = W / 4, ch = H * 3 / 10, aw = W / 2, ah = H / 9;
                string camFile, alertFile;
                Props(outDir, out camFile, out alertFile, cw, ch, aw, ah);
                var camRect = new Rectangle(W - cw - 8, H - ch - 8, cw, ch);
                var alertRect = new Rectangle(8, 8, aw, ah);
                obs_add_raw_video_callback(IntPtr.Zero, onFrame, IntPtr.Zero);
                var effects = new List<object>();
                var sheet = new List<KeyValuePair<string, List<KeyValuePair<string, Bitmap>>>>();
                foreach (var mf in manifests)
                {
                    var man = mf.Value;
                    string effect = J.Str(man, "effect", "?");
                    var res = new Dictionary<string, object> { { "effect", effect } };
                    effects.Add(res);
                    var game = Source("image_source", "Jeu (test)", new Dictionary<string, object> { { "file", Path.GetFullPath(Path.Combine(mf.Key, J.Str(man, "scene", "scene.png"))).Replace('\\', '/') } });
                    var cam = Source("image_source", "Webcam (test)", new Dictionary<string, object> { { "file", Path.GetFullPath(camFile).Replace('\\', '/') } });
                    var alert = Source("image_source", "Alerte (test)", new Dictionary<string, object> { { "file", Path.GetFullPath(alertFile).Replace('\\', '/') } });
                    var scene = obs_scene_create("Chaos (test) " + effect);
                    obs_scene_add(scene, game);
                    var p = new Vec2 { X = camRect.X, Y = camRect.Y }; obs_sceneitem_set_pos(obs_scene_add(scene, cam), ref p);
                    p = new Vec2 { X = alertRect.X, Y = alertRect.Y }; obs_sceneitem_set_pos(obs_scene_add(scene, alert), ref p);
                    var filters = new List<KeyValuePair<IntPtr, Dictionary<string, object>>>();
                    var retimes = new List<Dictionary<string, object>>();
                    var errors = new List<string>();
                    foreach (Dictionary<string, object> f in J.Arr(man, "filters"))
                    {
                        var fs = Source("shader_filter", J.Str(f, "name", "Chaos"), new Dictionary<string, object> {
                            { "from_file", true }, { "shader_file_name", J.Str(f, "effect_file", "") }, { "override_entire_effect", true } });
                        obs_source_set_enabled(fs, false);
                        obs_source_filter_add(game, fs);
                        filters.Add(new KeyValuePair<IntPtr, Dictionary<string, object>>(fs, J.Obj(f, "activation")));
                        retimes.Add(J.Obj(f, "retime"));
                    }
                    obs_set_output_source(0, obs_scene_get_source(scene));
                    if (countOnly)
                    {
                        // --perf : canevas à la taille de l'export, 60 images/s, sortie brute active (comme un live) ;
                        // phases : filtres coupés, filtres actifs hors de l'effet (coût fixe du filtre), effet en cours.
                        Thread.Sleep(1500);
                        foreach (var f in filters) { string err = Setting(f.Key, "last_error"); if (err.Length > 0) errors.Add(err); }
                        res["compile_errors"] = errors.ToArray();
                        var off = Phase(4);
                        foreach (var f in filters) { var a = new Dictionary<string, object>(f.Value); a["chaos_time"] = (J.Num(man, "frames", 0) + 10) / 60.0; Update(f.Key, a); obs_source_set_enabled(f.Key, true); }
                        var idle = Phase(4);
                        var refs = J.Arr(man, "refs");
                        double mid = refs.Count > 0 ? J.Num((Dictionary<string, object>)refs[0], "t", 1) : J.Num(man, "duration_ms", 2000) / 2000.0;
                        foreach (var f in filters) { var a = new Dictionary<string, object>(f.Value); a["chaos_time"] = mid; Update(f.Key, a); }
                        var on = Phase(4);
                        double? o = Ms(off), i = Ms(idle), e = Ms(on);
                        res["perf"] = new Dictionary<string, object> { { "taille", W + "x" + H }, { "filtres_coupes", off }, { "filtres_actifs_hors_effet", idle }, { "effet_a_" + mid.ToString("0.##", CultureInfo.InvariantCulture) + "_s", on },
                            { "surcout_filtre_ms", o.HasValue && i.HasValue ? (object)Math.Round(i.Value - o.Value, 3) : null },
                            { "surcout_effet_ms", o.HasValue && e.HasValue ? (object)Math.Round(e.Value - o.Value, 3) : null } };
                        if (errors.Count > 0 || !e.HasValue) failures++;
                        obs_set_output_source(0, IntPtr.Zero);
                        foreach (var f in filters) { obs_source_filter_remove(game, f.Key); obs_source_release(f.Key); }
                        obs_scene_release(scene);
                        obs_source_release(game); obs_source_release(cam); obs_source_release(alert);
                        continue;
                    }
                    var row = new List<KeyValuePair<string, Bitmap>>();
                    var baseFrame = Grab(600);
                    // Compilation par OBS (au tic vidéo qui suit la création du filtre) : erreur affichée par shaderfilter.
                    foreach (var f in filters) { string err = Setting(f.Key, "last_error"); if (err.Length > 0) errors.Add(err); }
                    res["compile_errors"] = errors.ToArray();
                    var gameArea = new Rectangle(0, 0, W, H);
                    var scenePx = LoadRgba(Path.Combine(mf.Key, J.Str(man, "scene", "scene.png")));
                    res["base_vs_scene"] = Diff(baseFrame, scenePx, gameArea, camRect, alertRect);
                    // Instants exacts (chaos_time) : image du jeu dans OBS contre le rendu du moteur au même instant.
                    // Arrêt anticipé (--stop-at à l'export) : à partir de l'arrêt, les réglages de recalage (« retime »).
                    // Plus de 20 images de référence : export de mesure du décalage (--refs all:…) → mesure, pas d'images.
                    double stopS = J.Has(man, "stop_ms") ? J.Num(man, "stop_ms", 0) / 1000.0 : double.MaxValue;
                    var allRefs = J.Arr(man, "refs").Cast<Dictionary<string, object>>().ToList();
                    bool syncRun = allRefs.Count > 20;
                    Func<int, double, Dictionary<string, object>> settingsAt = (fi, t) =>
                    {
                        var a = new Dictionary<string, object>(t >= stopS - 1e-6 && retimes[fi] != null ? retimes[fi] : filters[fi].Value);
                        a["chaos_time"] = t;
                        return a;
                    };
                    var shots = new List<object>();
                    foreach (var rf in syncRun ? new List<Dictionary<string, object>>() : allRefs)
                    {
                        double t = J.Num(rf, "t", 0);
                        for (int fi = 0; fi < filters.Count; fi++) { Update(filters[fi].Key, settingsAt(fi, t)); obs_source_set_enabled(filters[fi].Key, true); }
                        var img = Grab(400);
                        var refPx = LoadRgba(Path.Combine(mf.Key, J.Str(rf, "file", "")));
                        var vsRef = Diff(img, refPx, gameArea, camRect, alertRect);
                        var camD = Diff(img, baseFrame, camRect);
                        var alertD = Diff(img, baseFrame, alertRect);
                        var changed = Diff(img, baseFrame, gameArea, camRect, alertRect);
                        bool ok = errors.Count == 0 && Max(camD) <= 1 && Max(alertD) <= 1 && Mean(vsRef) <= 6;
                        if (!ok) failures++;
                        shots.Add(new Dictionary<string, object> { { "t", t }, { "jeu_vs_moteur", vsRef }, { "jeu_vs_avant", changed }, { "webcam_vs_avant", camD }, { "alerte_vs_avant", alertD }, { "ok", ok } });
                        string tag = t.ToString("0.00", CultureInfo.InvariantCulture) + " s";
                        row.Add(new KeyValuePair<string, Bitmap>("moteur " + tag, ToBitmap(refPx)));
                        row.Add(new KeyValuePair<string, Bitmap>("OBS " + tag, ToBitmap(img)));
                        ToBitmap(img).Save(Path.Combine(outDir, effect + "-obs-" + tag.Replace(" ", "").Replace(',', '.') + ".png"), ImageFormat.Png);
                    }
                    res["shots"] = shots.ToArray();
                    if (!syncRun && allRefs.Count > 0)
                    {
                        // Fenêtre de validité (horloge système, celle d'OBS) : hors fenêtre, le filtre rend l'image intacte
                        // (un filtre resté actif après un OBS relancé ne rejoue jamais un effet expiré).
                        double t0 = J.Num(allRefs[0], "t", 0), nowS = NowNs() / 1e9;
                        Func<double, double, byte[]> windowed = (since, expires) =>
                        {
                            for (int fi = 0; fi < filters.Count; fi++) { var a = settingsAt(fi, t0); a["chaos_since"] = since; a["chaos_expires"] = expires; Update(filters[fi].Key, a); }
                            return Grab(400);
                        };
                        var inside = Diff(windowed(nowS - 5, nowS + 600), baseFrame, gameArea, camRect, alertRect);
                        var expired = Diff(windowed(nowS - 100, nowS - 30), baseFrame, gameArea, camRect, alertRect);
                        var early = Diff(windowed(nowS + 60, nowS + 600), baseFrame, gameArea, camRect, alertRect);
                        bool guardOk = Mean(inside) > 0.5 && Max(expired) <= 1 && Max(early) <= 1;
                        if (!guardOk) failures++;
                        res["fenetre_de_validite"] = new Dictionary<string, object> { { "dans_la_fenetre_vs_avant", inside }, { "expiree_vs_avant", expired }, { "pas_encore_valide_vs_avant", early }, { "ok", guardOk } };
                    }
                    if (syncRun)
                    {
                        // Décalage de départ : à chaque essai, filtre coupé puis activé (comme Studio au départ de l'effet) ;
                        // chaque image d'OBS est rapprochée de l'image du moteur la plus proche (instant k/60 s) ; écart =
                        // (heure de l'image − heure de l'activation) − instant de l'effet montré.
                        var refPx = allRefs.Select(r => LoadRgba(Path.Combine(mf.Key, J.Str(r, "file", "")))).ToList();
                        // Seules comptent les images de l'effet nettement différentes de leurs voisines (animation en cours) :
                        // sur un plateau (effet installé), le rapprochement serait arbitraire.
                        var distinct = refPx.Select((r, k) => k > 0 && k < refPx.Count - 1 && Math.Min(Coarse(r, refPx[k - 1]), Coarse(r, refPx[k + 1])) > 0.8).ToList();
                        var offsets = new List<double>();
                        var firsts = new List<double>();
                        for (int trial = 0; trial < 8; trial++)
                        {
                            for (int fi = 0; fi < filters.Count; fi++) { obs_source_set_enabled(filters[fi].Key, false); var a = new Dictionary<string, object>(filters[fi].Value); a["chaos_time"] = -1.0; Update(filters[fi].Key, a); }
                            Grab(250 + 37 * trial);
                            lock (gate) recording = new List<KeyValuePair<long, byte[]>>();
                            long te = NowNs();
                            foreach (var f in filters) obs_source_set_enabled(f.Key, true);
                            Thread.Sleep((int)(allRefs.Count * 1000.0 / 60) + 300);
                            List<KeyValuePair<long, byte[]>> got;
                            lock (gate) { got = recording; recording = null; }
                            double first = double.NaN;
                            foreach (var fr in got)
                            {
                                double wall = (fr.Key - te) / 1e6;
                                if (wall < -40) continue;
                                int best = -1; double bestD = double.MaxValue;
                                for (int k = 0; k < refPx.Count; k++)
                                {
                                    double d = Coarse(fr.Value, refPx[k]);
                                    if (d < bestD) { bestD = d; best = k; }
                                }
                                bool moving = best >= 1 && distinct[best] && bestD < 3;
                                if (moving && double.IsNaN(first)) first = wall;
                                if (moving) offsets.Add(wall - best * 1000.0 / 60);
                            }
                            if (!double.IsNaN(first)) firsts.Add(first);
                        }
                        offsets.Sort();
                        Func<List<double>, Dictionary<string, object>> stats = l => l.Count == 0 ? null : new Dictionary<string, object> {
                            { "n", l.Count }, { "moyenne_ms", Math.Round(l.Average(), 1) }, { "min_ms", Math.Round(l.Min(), 1) }, { "max_ms", Math.Round(l.Max(), 1) },
                            { "p95_ms", Math.Round(l.OrderBy(x => x).ElementAt((int)(l.Count * 0.95)), 1) } };
                        res["synchronisation"] = new Dictionary<string, object> {
                            { "images_par_seconde", fps > 0 ? fps : 30 },
                            { "retard_d_affichage_de_l_effet", stats(offsets) },
                            { "premiere_image_en_mouvement_apres_activation", stats(firsts) } };
                        if (offsets.Count == 0) failures++;
                    }
                    // Temps réel : activation → l'effet joue sa partition (temps écoulé depuis l'activation) puis s'arrête seul.
                    foreach (var f in filters) { obs_source_set_enabled(f.Key, false); var a = new Dictionary<string, object>(f.Value); a["chaos_time"] = -1.0; a["chaos_since"] = 0.0; a["chaos_expires"] = 0.0; Update(f.Key, a); }
                    Grab(200);
                    foreach (var f in filters) obs_source_set_enabled(f.Key, true);
                    double total = J.Num(man, "total_ms", 0) / 1000.0;
                    var during = Grab((int)(Math.Min(1.5, total * 0.4) * 1000));
                    var after = Grab((int)(Math.Max(0.5, total - Math.Min(1.5, total * 0.4)) * 1000) + 600);
                    var dD = Diff(during, baseFrame, gameArea, camRect, alertRect);
                    var aD = Diff(after, baseFrame, gameArea, camRect, alertRect);
                    bool live = Mean(dD) > 0.5 && Max(aD) <= 1;
                    if (!live) failures++;
                    res["temps_reel"] = new Dictionary<string, object> { { "pendant_vs_avant", dD }, { "apres_fin_vs_avant", aD }, { "ok", live } };
                    row.Insert(0, new KeyValuePair<string, Bitmap>("OBS avant", ToBitmap(baseFrame)));
                    sheet.Add(new KeyValuePair<string, List<KeyValuePair<string, Bitmap>>>(J.Str(man, "label", effect), row));
                    obs_set_output_source(0, IntPtr.Zero);
                    foreach (var f in filters) { obs_source_filter_remove(game, f.Key); obs_source_release(f.Key); }
                    obs_scene_release(scene);
                    obs_source_release(game); obs_source_release(cam); obs_source_release(alert);
                    if (errors.Count > 0) failures++;
                }
                obs_remove_raw_video_callback(onFrame, IntPtr.Zero);
                report["effects"] = effects.ToArray();
                report["ok"] = failures == 0;
                Sheet(sheet, Path.Combine(outDir, "planche.png"));
            }
            catch (Exception e) { report["error"] = e.Message; failures++; }
            // Rapport écrit AVANT la fermeture de libobs (une fermeture qui échoue ne fait pas perdre les mesures).
            File.WriteAllText(Path.Combine(outDir, "report.json"), J.Write(report), new UTF8Encoding(false));
            Console.WriteLine(J.Write(report));
            Console.Out.Flush();
            obs_shutdown();
            return failures == 0 ? 0 : 1;
        }

        // ---------- Mesure (--perf) : temps GPU de ce processus (libobs) par image, compteurs Windows « GPU Engine » ----------
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhOpenQueryW(string src, IntPtr user, out IntPtr q);
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhAddEnglishCounterW(IntPtr q, string path, IntPtr user, out IntPtr c);
        [DllImport("pdh.dll")] static extern int PdhCollectQueryData(IntPtr q);
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhGetRawCounterArrayW(IntPtr c, ref uint size, out uint count, IntPtr buf);
        [DllImport("obs.dll", CallingConvention = C)] static extern uint obs_get_total_frames();
        [DllImport("obs.dll", CallingConvention = C)] static extern uint obs_get_lagged_frames();
        static IntPtr pdhQ, pdhC;
        /// Temps GPU cumulé (ms) du moteur 3D pour ce processus.
        static double GpuMs()
        {
            if (pdhQ == IntPtr.Zero && (PdhOpenQueryW(null, IntPtr.Zero, out pdhQ) != 0 || PdhAddEnglishCounterW(pdhQ, @"\GPU Engine(*engtype_3D)\Running Time", IntPtr.Zero, out pdhC) != 0)) return double.NaN;
            PdhCollectQueryData(pdhQ);
            uint size = 0, count;
            PdhGetRawCounterArrayW(pdhC, ref size, out count, IntPtr.Zero);
            if (size == 0) return double.NaN;
            IntPtr buf = Marshal.AllocHGlobal((int)size);
            try
            {
                if (PdhGetRawCounterArrayW(pdhC, ref size, out count, buf) != 0) return double.NaN;
                string me = "pid_" + System.Diagnostics.Process.GetCurrentProcess().Id + "_";
                double ms = 0;
                for (int i = 0; i < count; i++)
                {
                    IntPtr item = new IntPtr(buf.ToInt64() + i * 48L);
                    string name = Marshal.PtrToStringUni(Marshal.ReadIntPtr(item));
                    if (name != null && name.Contains(me)) ms += Marshal.ReadInt64(item, 24) / 10000.0;
                }
                return ms;
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
        /// Une phase de mesure : temps GPU et processeur de ce processus par image rendue par OBS.
        static Dictionary<string, object> Phase(int seconds)
        {
            Thread.Sleep(700);
            var proc = System.Diagnostics.Process.GetCurrentProcess();
            double g0 = GpuMs(), c0 = proc.TotalProcessorTime.TotalMilliseconds;
            uint f0 = obs_get_total_frames(), l0 = obs_get_lagged_frames();
            Thread.Sleep(seconds * 1000);
            double g1 = GpuMs(); proc.Refresh(); double c1 = proc.TotalProcessorTime.TotalMilliseconds;
            uint n = obs_get_total_frames() - f0;
            return new Dictionary<string, object> {
                { "images", n }, { "images_en_retard", obs_get_lagged_frames() - l0 },
                { "gpu_ms_par_image", n == 0 || double.IsNaN(g0) ? (object)null : Math.Round((g1 - g0) / n, 3) },
                { "cpu_ms_par_image", n == 0 ? (object)null : Math.Round((c1 - c0) / n, 3) } };
        }
        static double? Ms(Dictionary<string, object> p) { return p["gpu_ms_par_image"] == null ? (double?)null : Convert.ToDouble(p["gpu_ms_par_image"], CultureInfo.InvariantCulture); }

        static string FileVersion(string f) { try { return System.Diagnostics.FileVersionInfo.GetVersionInfo(f).ProductVersion; } catch (Exception) { return null; } }

        static void Sheet(List<KeyValuePair<string, List<KeyValuePair<string, Bitmap>>>> rows, string file)
        {
            if (rows.Count == 0) return;
            int tw = 320, th = tw * H / W, pad = 8, label = 18, cols = rows.Max(r => r.Value.Count);
            using (var sheet = new Bitmap(160 + cols * (tw + pad) + pad, rows.Count * (th + label + pad) + pad))
            using (var g = Graphics.FromImage(sheet))
            using (var f = new Font("Segoe UI", 9))
            {
                g.Clear(Color.FromArgb(24, 24, 28));
                for (int r = 0; r < rows.Count; r++)
                {
                    int y = pad + r * (th + label + pad);
                    g.DrawString(rows[r].Key, f, Brushes.Gold, pad, y + label + th / 2 - 8);
                    for (int c = 0; c < rows[r].Value.Count; c++)
                    {
                        int x = 160 + pad + c * (tw + pad);
                        g.DrawString(rows[r].Value[c].Key, f, Brushes.Gainsboro, x, y + 2);
                        g.DrawImage(rows[r].Value[c].Value, x, y + label, tw, th);
                    }
                }
                sheet.Save(file, ImageFormat.Png);
            }
        }
    }
}
