// Cibles : écrans (rangés de gauche à droite), fenêtres proposables, et résolution d'une cible demandée : écran du
// streamer (« screen » : tout l'écran, composé autour de la fenêtre qui l'occupe, sinon l'écran entier capturé),
// fenêtre, premier plan, écran entier.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

namespace Raptoru.Chaos
{
    static class Targets
    {
        static string ProcName(uint pid) { try { return Process.GetProcessById((int)pid).ProcessName + ".exe"; } catch (Exception) { return "?"; } }

        /// Fenêtres d'application visibles (ni outils, ni calques traversables, ni fenêtres du moteur).
        public static List<Dictionary<string, object>> Windows(int selfPid)
        {
            var list = new List<Dictionary<string, object>>();
            N.EnumWindows((h, l) =>
            {
                if (!N.IsWindowVisible(h) || N.IsCloaked(h) || N.GetWindow(h, N.GW_OWNER) != IntPtr.Zero) return true;
                if ((N.GetWindowLongW(h, N.GWL_EXSTYLE) & (N.WS_EX_TOOLWINDOW | N.WS_EX_TRANSPARENT)) != 0) return true;
                string title = N.WindowText(h);
                if (title.Length == 0) return true;
                uint pid; N.GetWindowThreadProcessId(h, out pid);
                if (pid == selfPid) return true;
                RECT r = N.FrameBounds(h);
                list.Add(J.Map("hwnd", h.ToInt64(), "title", title, "process", ProcName(pid), "width", r.Right - r.Left, "height", r.Bottom - r.Top,
                    "minimized", N.IsIconic(h), "foreground", N.GetForegroundWindow() == h));
                return true;
            }, IntPtr.Zero);
            return list;
        }

        /// Écrans réels, rangés de gauche à droite (Model/ScreenLayout).
        public static List<ScreenInfo> Screens()
        {
            var list = new List<ScreenInfo>();
            foreach (var m in N.Monitors())
            {
                RECT r = N.MonitorRectOf(m);
                list.Add(new ScreenInfo { Device = N.MonitorDevice(m), X = r.Left, Y = r.Top, Width = r.Right - r.Left, Height = r.Bottom - r.Top, Hz = N.RefreshHz(m), Primary = r.Left == 0 && r.Top == 0 });
            }
            return ScreenLayout.Ordered(list);
        }

        /// Écrans pour Studio : choix stable (key), nom lisible (label), nom Windows, taille et fréquence en information
        /// secondaire, orientation, écran du premier plan.
        public static List<Dictionary<string, object>> Monitors()
        {
            string fg = N.MonitorDevice(N.MonitorFromWindow(N.GetForegroundWindow(), 2));
            var s = Screens();
            return s.Select((x, i) => J.Map("device", x.Device, "key", ScreenLayout.Key(i, s.Count), "label", ScreenLayout.Label(i, s.Count), "order", i,
                "primary", x.Primary, "x", x.X, "y", x.Y, "width", x.Width, "height", x.Height, "hz", x.Hz,
                "orientation", Math.Max(0, N.DisplayOrientation(x.Device)) * 90, "foreground", x.Device == fg)).ToList();
        }

        static string ScreenTitle(string device)
        {
            var s = Screens();
            int i = s.FindIndex(x => x.Device == device);
            return i < 0 ? device : ScreenLayout.Label(i, s.Count) + " · " + s[i].Width + "×" + s[i].Height;
        }

        /// La fenêtre qui occupe un écran : la plus haute (ordre d'affichage) qui en couvre au moins 90 % (jeu en fenêtré
        /// sans bordure, fenêtre agrandie). Ni bureau, ni outils, ni calques traversables, ni fenêtres du moteur.
        static IntPtr WindowFilling(IntPtr hmon, int selfPid)
        {
            RECT m = N.MonitorRectOf(hmon);
            double area = (double)(m.Right - m.Left) * (m.Bottom - m.Top);
            IntPtr found = IntPtr.Zero;
            N.EnumWindows((h, l) =>
            {
                if (!N.IsWindowVisible(h) || N.IsCloaked(h) || N.IsIconic(h) || N.GetWindow(h, N.GW_OWNER) != IntPtr.Zero) return true;
                if ((N.GetWindowLongW(h, N.GWL_EXSTYLE) & (N.WS_EX_TOOLWINDOW | N.WS_EX_TRANSPARENT)) != 0) return true;
                string cls = N.ClassName(h);
                if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return true;
                uint pid; N.GetWindowThreadProcessId(h, out pid);
                if (pid == selfPid) return true;
                RECT r = N.FrameBounds(h);
                double w = Math.Min(r.Right, m.Right) - Math.Max(r.Left, m.Left), hh = Math.Min(r.Bottom, m.Bottom) - Math.Max(r.Top, m.Top);
                if (w <= 0 || hh <= 0 || w * hh < 0.9 * area) return true;
                found = h;
                return false;
            }, IntPtr.Zero);
            return found;
        }

        /// spec : {kind:"screen", device} | {kind:"window", hwnd} | {kind:"foreground"} | {kind:"monitor", device? | hwnd?}.
        /// « screen » (fiche d'un effet) : TOUT l'écran (barre des tâches comprise). S'il est occupé par une fenêtre (jeu,
        /// fenêtre agrandie) : mode E, la fenêtre capturée en direct posée sur une image de l'écran prise au départ, calque
        /// jamais exclu des captures (visible dans la capture d'écran d'OBS), sans devoir être au premier plan. Sinon :
        /// mode C, l'écran capturé (calque exclu des captures tant qu'il la lit). Clé « screen:<écran> » dans les deux cas :
        /// les effets d'un même écran partagent une seule surface.
        /// « foreground » vise l'écran du jeu au premier plan (default_mode = monitor) ou sa fenêtre seule (window).
        public static TargetRef Resolve(Dictionary<string, object> spec, string defaultMode, int selfPid, EffectDef def, bool inputEffects)
        {
            string kind = J.Str(spec, "kind", "foreground");
            bool foreground = kind == "foreground";
            string screenDevice = null;
            IntPtr h, hmon = IntPtr.Zero;
            switch (kind)
            {
                case "screen":
                    screenDevice = J.Str(spec, "device", "");
                    IntPtr sm = N.MonitorByDevice(screenDevice);
                    if (sm == IntPtr.Zero) throw new ProtocolError("screen_missing", "écran introuvable : " + screenDevice + " (débranché ?)");
                    h = WindowFilling(sm, selfPid);
                    hmon = sm;
                    if (h == IntPtr.Zero) { kind = "monitor"; h = N.GetDesktopWindow(); }
                    else kind = "composed";
                    break;
                case "window":
                    h = new IntPtr((long)J.Num(spec, "hwnd", 0));
                    break;
                case "foreground":
                    h = N.GetAncestor(N.GetForegroundWindow(), N.GA_ROOTOWNER);
                    if (h == IntPtr.Zero) throw new ProtocolError("no_foreground", "aucune fenêtre au premier plan");
                    if (defaultMode == "monitor") kind = "monitor";
                    break;
                case "monitor":
                    if (J.Has(spec, "device"))
                    {
                        hmon = N.MonitorByDevice(J.Str(spec, "device", ""));
                        if (hmon == IntPtr.Zero) throw new ProtocolError("no_monitor", "écran introuvable : " + J.Str(spec, "device", ""));
                        h = N.GetDesktopWindow();
                    }
                    else h = J.Has(spec, "hwnd") ? new IntPtr((long)J.Num(spec, "hwnd", 0)) : N.GetDesktopWindow();
                    break;
                default: throw new ProtocolError("invalid_target", "cible inconnue : " + kind);
            }
            if (h == IntPtr.Zero || !N.IsWindow(h)) throw new ProtocolError("no_window", "fenêtre cible introuvable");
            uint pid; N.GetWindowThreadProcessId(h, out pid);
            bool monitor = kind == "monitor";
            if (!monitor && pid == selfPid) throw new ProtocolError("invalid_target", "une fenêtre du moteur ne peut pas être une cible");
            if (!monitor && N.IsIconic(h)) throw new ProtocolError("target_minimized", "la fenêtre cible est réduite");
            int quns;
            if (def.RequiresCapture && N.SHQueryUserNotificationState(out quns) == 0 && quns == N.QUNS_RUNNING_D3D_FULL_SCREEN)
                throw new ProtocolError("exclusive_fullscreen", "un jeu est en plein écran exclusif : rien ne peut s'afficher au-dessus et l'écran ne peut pas être retourné ; passer en fenêtré sans bordure");
            var t = new TargetRef { Kind = monitor ? "monitor" : kind == "composed" ? "screen" : "window", Hwnd = h };
            if (kind == "composed")
            {
                t.Hmon = hmon;
                t.Device = screenDevice;
                t.Key = "screen:" + screenDevice;
                t.Info = J.Map("kind", "screen", "mode", "E", "device", screenDevice, "hwnd", h.ToInt64(), "process", ProcName(pid), "title", N.WindowText(h),
                    "input", null, "follow_foreground", false, "screen", ScreenTitle(screenDevice));
            }
            else if (monitor)
            {
                if (hmon == IntPtr.Zero) hmon = N.MonitorFromWindow(h, 2);
                t.Hmon = hmon;
                t.Device = N.MonitorDevice(hmon);
                if (t.Device == null) throw new ProtocolError("no_monitor", "écran introuvable");
                t.Key = screenDevice != null ? "screen:" + screenDevice : "monitor:" + t.Device;
                t.Info = J.Map("kind", "monitor", "mode", "C", "device", t.Device, "title", ScreenTitle(t.Device),
                    "process", foreground ? ProcName(pid) : null, "input", inputEffects ? def.Input : null, "follow_foreground", false);
                if (screenDevice != null) t.Info["screen"] = ScreenTitle(screenDevice);
            }
            else
            {
                t.Key = "window:" + h.ToInt64().ToString("x");
                // Cible « écran » : l'effet reste visible même si la fenêtre n'est pas au premier plan (Studio l'est).
                t.Info = J.Map("kind", "window", "mode", "D", "hwnd", h.ToInt64(), "process", ProcName(pid), "title", N.WindowText(h),
                    "input", null, "follow_foreground", screenDevice == null && J.Bool(spec, "follow_foreground", true));
                if (screenDevice != null) { t.Info["screen"] = ScreenTitle(screenDevice); t.Info["device"] = screenDevice; }
            }
            return t;
        }
    }
}
