// Panneau de test du lot 1 : choisir une fenêtre, lancer / arrêter un retournement, lire le mode, les erreurs et les mesures.
// Chaque effet tourne dans un processus lecteur séparé (--serve), rattaché à une tâche Windows « tuer à la fermeture » :
// si le panneau se ferme ou plante, Windows tue le lecteur et sa fenêtre disparaît.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Raptoru.Chaos
{
    sealed class Panel : Form
    {
        const int HotStart = 1, HotStop = 2;
        readonly ListBox list = new ListBox();
        readonly RadioButton modeD = new RadioButton(), modeC = new RadioButton();
        readonly NumericUpDown duration = new NumericUpDown();
        readonly CheckBox animated = new CheckBox(), follow = new CheckBox();
        readonly Button refresh = new Button(), start = new Button(), stop = new Button();
        readonly Label state = new Label(), stats = new Label(), hint = new Label();
        readonly TextBox log = new TextBox();
        readonly Timer ping = new Timer { Interval = 500 };
        readonly JavaScriptSerializer json = new JavaScriptSerializer();
        readonly IntPtr job = N.KillOnCloseJob();
        readonly string journalPath = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "chaos-journal.txt");
        Process child;
        int seq;

        static readonly Dictionary<string, string> Reasons = new Dictionary<string, string>
        {
            { "duration", "durée écoulée" }, { "stopped", "arrêt demandé" }, { "target_lost", "fenêtre cible fermée" },
            { "never_visible", "la fenêtre cible n'est pas passée au premier plan en 15 s" },
            { "heartbeat", "le panneau ne répondait plus : arrêt de sécurité" }, { "stdin_closed", "panneau fermé" },
            { "parent_exit", "panneau fermé" }, { "hard_deadline", "délai maximal dépassé : arrêt de sécurité" },
            { "stop_forced", "arrêt forcé" }, { "exclusive_fullscreen", "jeu en plein écran exclusif : passe-le en « fenêtré sans bordure »" },
            { "capture_denied", "Windows refuse la capture de cette fenêtre" }, { "capture_unsupported", "capture Windows indisponible" },
            { "no_window", "fenêtre introuvable" }, { "target_minimized", "fenêtre réduite" },
            { "no_frame", "aucune image reçue (fenêtre protégée, noire ou réduite ?)" }, { "busy", "un effet est déjà en cours" },
            { "capture_black", "le centre de l'image capturée est noir : le jeu bloque peut-être la capture" },
            { "gpu", "erreur graphique" }, { "present_failed", "erreur d'affichage" }, { "render_error", "erreur de rendu" },
            { "fatal", "erreur interne" }, { "capture_error", "erreur de capture" }, { "exclusion_failed", "exclusion de capture impossible" },
        };

        public Panel()
        {
            Text = "Raptoru Chaos — prototype lot 1 · retournement 180°";
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(620, 640);
            MinimumSize = new Size(560, 600);
            Font = new Font("Segoe UI", 9f);

            var title = new Label { Text = "1. Fenêtre à retourner", Location = new Point(12, 10), AutoSize = true, Font = new Font(Font, FontStyle.Bold) };
            list.SetBounds(12, 32, 500, 150);
            list.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            list.HorizontalScrollbar = true;
            refresh.Text = "Actualiser"; refresh.SetBounds(520, 32, 88, 28); refresh.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            refresh.Click += (s, e) => RefreshWindows();

            var t2 = new Label { Text = "2. Réglages", Location = new Point(12, 192), AutoSize = true, Font = title.Font };
            modeD.Text = "Fenêtre du jeu (mode D) : vu aussi par la capture d'écran d'OBS"; modeD.SetBounds(12, 214, 590, 22); modeD.Checked = true;
            modeC.Text = "Écran entier (mode C, secours) : exclu des captures, local seulement"; modeC.SetBounds(12, 236, 590, 22);
            var dl = new Label { Text = "Durée (s) :", Location = new Point(12, 266), AutoSize = true };
            duration.SetBounds(90, 263, 60, 24); duration.Minimum = 1; duration.Maximum = 60; duration.Value = 10;
            animated.Text = "Bascule animée (0,55 s)"; animated.SetBounds(170, 264, 200, 22); animated.Checked = true;
            follow.Text = "Seulement quand la fenêtre est au premier plan"; follow.SetBounds(12, 290, 590, 22); follow.Checked = true;

            start.Text = "Démarrer"; start.SetBounds(12, 322, 140, 36);
            start.Click += (s, e) => { var it = list.SelectedItem as Item; StartOn(it != null ? it.Hwnd : IntPtr.Zero); };
            stop.Text = "ARRÊTER"; stop.SetBounds(160, 322, 140, 36); stop.BackColor = Color.FromArgb(200, 40, 40); stop.ForeColor = Color.White;
            stop.FlatStyle = FlatStyle.Flat; stop.Click += (s, e) => StopNow();
            hint.Text = "Raccourcis partout, même en jeu :\nCtrl+Maj+F10 = retourner la fenêtre au premier plan · Ctrl+Maj+F11 = arrêter";
            hint.SetBounds(12, 364, 596, 44); hint.ForeColor = Color.DimGray;

            state.SetBounds(12, 412, 596, 40); state.Font = new Font(Font, FontStyle.Bold); state.Text = "Aucun effet en cours.";
            stats.SetBounds(12, 454, 596, 40); stats.ForeColor = Color.FromArgb(40, 60, 90);
            log.SetBounds(12, 498, 596, 130); log.Multiline = true; log.ReadOnly = true; log.ScrollBars = ScrollBars.Vertical;
            log.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            foreach (var c in new Control[] { state, stats, hint }) c.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

            Controls.AddRange(new Control[] { title, list, refresh, t2, modeD, modeC, dl, duration, animated, follow, start, stop, hint, state, stats, log });
            ping.Tick += (s, e) => Send(new Dictionary<string, object> { { "cmd", "ping" } });
            Load += (s, e) => { RefreshWindows(); Log("Journal : " + journalPath); };
            FormClosing += (s, e) => KillChild();
        }

        sealed class Item { public IntPtr Hwnd; public string Label; public override string ToString() { return Label; } }

        /// Auto-test (chaos-checks) : le panneau, invisible, lance un vrai retournement de 2 s par son propre chemin,
        /// puis enregistre son état dans une image et se ferme.
        public void SelfTest(IntPtr target, string png)
        {
            Opacity = 0; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual; Location = new Point(-30000, -30000);
            follow.Checked = false; animated.Checked = false; duration.Value = 2;
            Shown += (s, e) =>
            {
                StartOn(target);
                var t = new Timer { Interval = 4000 };
                t.Tick += (s2, e2) =>
                {
                    t.Stop();
                    using (var bmp = new Bitmap(Width, Height)) { DrawToBitmap(bmp, new Rectangle(Point.Empty, Size)); bmp.Save(png); }
                    Close();
                };
                t.Start();
            };
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            const uint ctrlShiftNoRepeat = 0x2 | 0x4 | 0x4000;
            if (!N.RegisterHotKey(Handle, HotStart, ctrlShiftNoRepeat, 0x79)) Log("Raccourci Ctrl+Maj+F10 déjà pris par une autre application.");
            if (!N.RegisterHotKey(Handle, HotStop, ctrlShiftNoRepeat, 0x7A)) Log("Raccourci Ctrl+Maj+F11 déjà pris par une autre application : utiliser le bouton ARRÊTER.");
        }

        protected override void OnHandleDestroyed(EventArgs e)
        {
            N.UnregisterHotKey(Handle, HotStart); N.UnregisterHotKey(Handle, HotStop);
            base.OnHandleDestroyed(e);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == (int)N.WM_HOTKEY)
            {
                int id = m.WParam.ToInt32();
                if (id == HotStop) StopNow();
                if (id == HotStart)
                {
                    IntPtr fg = N.GetAncestor(N.GetForegroundWindow(), N.GA_ROOTOWNER);
                    if (fg == Handle) Log("Ctrl+Maj+F10 : passe d'abord sur la fenêtre du jeu.");
                    else StartOn(fg);
                }
            }
            base.WndProc(ref m);
        }

        void RefreshWindows()
        {
            var keep = list.SelectedItem as Item;
            list.Items.Clear();
            IntPtr self = Handle;
            int me = Process.GetCurrentProcess().Id;
            var items = new List<Item>();
            N.EnumWindows((h, l) =>
            {
                if (h == self || !N.IsWindowVisible(h) || N.IsCloaked(h) || N.GetWindow(h, N.GW_OWNER) != IntPtr.Zero) return true;
                // Ni fenêtres outils ni calques traversables (overlays) : ce ne sont jamais des jeux.
                if ((N.GetWindowLongW(h, N.GWL_EXSTYLE) & (N.WS_EX_TOOLWINDOW | N.WS_EX_TRANSPARENT)) != 0) return true;
                string t = N.WindowText(h);
                if (t.Length == 0) return true;
                uint pid; N.GetWindowThreadProcessId(h, out pid);
                if (pid == me) return true;
                RECT r = N.FrameBounds(h);
                items.Add(new Item { Hwnd = h, Label = t + "   —   " + ProcName(pid) + "  (" + (r.Right - r.Left) + "×" + (r.Bottom - r.Top) + (N.IsIconic(h) ? ", réduite" : "") + ")" });
                return true;
            }, IntPtr.Zero);
            foreach (var it in items) { list.Items.Add(it); if (keep != null && it.Hwnd == keep.Hwnd) list.SelectedItem = it; }
        }

        static string ProcName(uint pid) { try { return Process.GetProcessById((int)pid).ProcessName + ".exe"; } catch (Exception) { return "?"; } }

        void StartOn(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero || !N.IsWindow(hwnd)) { SetState("Choisis d'abord une fenêtre dans la liste.", Color.DarkOrange); return; }
            KillChild();
            string id = "panel-" + (++seq);
            uint pid; N.GetWindowThreadProcessId(hwnd, out pid);
            Journal("PANEL play " + id + " " + ProcName(pid) + " mode=" + (modeC.Checked ? "C" : "D") + " duree=" + duration.Value + "s anim=" + animated.Checked + " premier_plan=" + follow.Checked);
            var psi = new ProcessStartInfo(Application.ExecutablePath, "--serve --parent " + Process.GetCurrentProcess().Id)
            {
                UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8
            };
            Process c;
            try { c = Process.Start(psi); }
            catch (Exception e) { SetState("Impossible de lancer le lecteur : " + e.Message, Color.Firebrick); return; }
            N.AssignProcessToJobObject(job, c.Handle);
            child = c;
            c.OutputDataReceived += (s, e) => { if (e.Data != null) Ui(() => OnLine(e.Data)); };
            c.EnableRaisingEvents = true;
            c.Exited += (s, e) => Ui(() => OnExit(c));
            c.BeginOutputReadLine();
            var p = new Dictionary<string, object>
            {
                { "hwnd", hwnd.ToInt64() }, { "mode", modeC.Checked ? "monitor" : "window" },
                { "transition_ms", animated.Checked ? 550 : 0 }, { "follow_foreground", follow.Checked }
            };
            Send(new Dictionary<string, object>
            {
                { "cmd", "play" }, { "id", id }, { "effect", "flip" }, { "variant", "rotate180" }, { "max_ms", (int)duration.Value * 1000 }, { "params", p }
            });
            ping.Start();
            SetState("Démarrage… " + (follow.Checked && N.GetForegroundWindow() != hwnd ? "passe sur la fenêtre choisie pour voir l'effet." : ""), Color.Black);
        }

        void Send(Dictionary<string, object> d)
        {
            var c = child;
            if (c == null) return;
            try { if (c.HasExited) return; c.StandardInput.WriteLine(json.Serialize(d)); c.StandardInput.Flush(); } catch (Exception) { }
        }

        void StopNow()
        {
            var c = child;
            if (c == null) { SetState("Aucun effet en cours.", Color.Black); return; }
            Journal("PANEL stop_all");
            Send(new Dictionary<string, object> { { "cmd", "stop_all" } });
            var t = new Timer { Interval = 400 };
            t.Tick += (s, e) =>
            {
                t.Stop(); t.Dispose();
                try { if (!c.HasExited) { c.Kill(); Log("Lecteur arrêté de force (aucune réponse en 400 ms)."); } } catch (Exception) { }
            };
            t.Start();
        }

        void KillChild()
        {
            var c = child;
            child = null;
            ping.Stop();
            if (c == null) return;
            try { if (!c.HasExited) c.Kill(); } catch (Exception) { }
        }

        void OnExit(Process c)
        {
            if (child == c) { child = null; ping.Stop(); }
        }

        void OnLine(string line)
        {
            Journal(line);
            Dictionary<string, object> e;
            try { e = json.Deserialize<Dictionary<string, object>>(line); } catch (Exception) { Log(line); return; }
            string ev = S(e, "ev");
            switch (ev)
            {
                case "ready": Log("Lecteur prêt en " + S(e, "ready_ms") + " ms · GPU : " + S(e, "adapter")); break;
                case "started":
                    SetState("En cours · mode " + S(e, "mode") + (S(e, "mode") == "D" ? " (fenêtre, visible dans OBS)" : " (écran entier, local)") +
                        " · " + (Convert.ToInt32(e["duration_ms"]) / 1000) + " s", Color.DarkGreen);
                    Log("Démarré en " + S(e, "started_ms") + " ms (1re image " + S(e, "first_frame_ms") + " ms) · " + S(e, "size") + " · bordure de capture : " +
                        (S(e, "border") == "removed" ? "retirée" : "imposée par Windows") + " · " + S(e, "adapter"));
                    break;
                case "stats":
                    stats.Text = "Capture " + S(e, "capture_fps") + " i/s · Affichage " + S(e, "present_fps") + " i/s · Composition " + S(e, "comp_hz") + " Hz\n" +
                        "Traitement " + Ms(e, "lat_p50_ms") + " (p95 " + Ms(e, "lat_p95_ms") + ") · GPU " + Ms(e, "gpu_ms") + " · CPU " + S(e, "cpu_pct") + " %" +
                        (S(e, "visible") == "True" ? "" : " · masqué (fenêtre pas au premier plan)");
                    break;
                case "warning": Log("Attention : " + Fr(S(e, "reason"))); break;
                case "ended":
                    SetState("Terminé : " + Fr(S(e, "reason")) + " · visible " + Math.Round(Convert.ToDouble(e["visible_ms"]) / 1000, 1) + " s", Color.Black);
                    Log("Fin : " + Fr(S(e, "reason")) + " · images capturées " + S(e, "frames_captured") + ", affichées " + S(e, "frames_presented") +
                        " · traitement médian " + Ms(e, "lat_p50_ms") + " · GPU " + Ms(e, "gpu_ms"));
                    break;
                case "failed": SetState("Échec : " + Fr(S(e, "reason")), Color.Firebrick); Log("Échec : " + Fr(S(e, "reason")) + " — " + S(e, "detail")); break;
                case "error": Log("Erreur de protocole : " + S(e, "reason")); break;
                case "exit": break;
                default: Log(line); break;
            }
        }

        static string S(Dictionary<string, object> e, string k) { return e.ContainsKey(k) && e[k] != null ? Convert.ToString(e[k], System.Globalization.CultureInfo.GetCultureInfo("fr-FR")) : ""; }
        static string Ms(Dictionary<string, object> e, string k) { string v = S(e, k); return v.StartsWith("-") || v == "" ? "—" : v + " ms"; }
        static string Fr(string reason) { string v; return Reasons.TryGetValue(reason, out v) ? v : reason; }

        void SetState(string text, Color color) { state.Text = text; state.ForeColor = color; }
        void Log(string text) { log.AppendText(DateTime.Now.ToString("HH:mm:ss") + "  " + text + Environment.NewLine); }
        void Journal(string line)
        {
            try { File.AppendAllText(journalPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + line + Environment.NewLine); } catch (Exception) { }
        }
        void Ui(Action a) { try { if (!IsDisposed) BeginInvoke(a); } catch (Exception) { } }
    }
}
