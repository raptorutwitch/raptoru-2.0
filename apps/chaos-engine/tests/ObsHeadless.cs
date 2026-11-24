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
            lock (gate) { last = b; frames++; }
        };
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

        public static int Main(string[] args)
        {
            string obsDir = @"C:\Program Files\obs-studio", outDir = null;
            var dirs = new List<string>();
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--out" && i + 1 < args.Length) outDir = args[++i];
                else if (args[i] == "--obs" && i + 1 < args.Length) obsDir = args[++i];
                else if (args[i] == "--perf") countOnly = true;
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
                var vi = new VideoInfo { Module = Marshal.StringToHGlobalAnsi("libobs-d3d11"), FpsNum = countOnly ? 60u : 30u, FpsDen = 1, BaseW = (uint)W, BaseH = (uint)H, OutW = (uint)W, OutH = (uint)H, Format = 6 /* RGBA */, GpuConv = true, Cs = 2, Range = 2, Scale = 3 };
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
                    var errors = new List<string>();
                    foreach (Dictionary<string, object> f in J.Arr(man, "filters"))
                    {
                        var fs = Source("shader_filter", J.Str(f, "name", "Chaos"), new Dictionary<string, object> {
                            { "from_file", true }, { "shader_file_name", J.Str(f, "effect_file", "") }, { "override_entire_effect", true } });
                        obs_source_set_enabled(fs, false);
                        obs_source_filter_add(game, fs);
                        filters.Add(new KeyValuePair<IntPtr, Dictionary<string, object>>(fs, J.Obj(f, "activation")));
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
                    var shots = new List<object>();
                    foreach (Dictionary<string, object> rf in J.Arr(man, "refs"))
                    {
                        double t = J.Num(rf, "t", 0);
                        foreach (var f in filters) { var a = new Dictionary<string, object>(f.Value); a["chaos_time"] = t; Update(f.Key, a); obs_source_set_enabled(f.Key, true); }
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
                    // Temps réel : activation → l'effet joue sa partition (temps écoulé depuis l'activation) puis s'arrête seul.
                    foreach (var f in filters) { obs_source_set_enabled(f.Key, false); var a = new Dictionary<string, object>(f.Value); a["chaos_time"] = -1.0; Update(f.Key, a); }
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
            finally { obs_shutdown(); }
            File.WriteAllText(Path.Combine(outDir, "report.json"), J.Write(report), new UTF8Encoding(false));
            Console.WriteLine(J.Write(report));
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
