// Cibles : liste des fenêtres proposables et résolution d'une cible demandée (fenêtre, premier plan, écran).
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

        /// Écrans (cible par défaut du retournement) : nom Windows, position, taille, orientation, écran du premier plan.
        public static List<Dictionary<string, object>> Monitors()
        {
            var list = new List<Dictionary<string, object>>();
            IntPtr fgMon = N.MonitorFromWindow(N.GetForegroundWindow(), 2);
            RECT primary = N.MonitorRect(N.GetDesktopWindow());
            foreach (var m in N.Monitors())
            {
                RECT r = N.MonitorRectOf(m);
                string dev = N.MonitorDevice(m);
                bool isPrimary = r.Left == 0 && r.Top == 0;
                list.Add(J.Map("device", dev, "label", MonitorLabel(r, primary, isPrimary), "primary", isPrimary, "x", r.Left, "y", r.Top,
                    "width", r.Right - r.Left, "height", r.Bottom - r.Top, "orientation", Math.Max(0, N.DisplayOrientation(dev)) * 90,
                    "foreground", m == fgMon));
            }
            return list.OrderByDescending(d => (bool)d["primary"]).ThenBy(d => (int)d["x"]).ToList();
        }

        static string MonitorLabel(RECT r, RECT primary, bool isPrimary)
        {
            string where = isPrimary ? "principal" : r.Right <= primary.Left ? "à gauche" : r.Left >= primary.Right ? "à droite" : r.Bottom <= primary.Top ? "au-dessus" : "en dessous";
            return "Écran " + where + " · " + (r.Right - r.Left) + "×" + (r.Bottom - r.Top);
        }

        /// spec : {kind:"window", hwnd} | {kind:"foreground"} | {kind:"monitor", device? | hwnd?}.
        /// « foreground » vise l'écran du jeu au premier plan (default_mode = monitor) ou sa fenêtre seule (window).
        public static TargetRef Resolve(Dictionary<string, object> spec, string defaultMode, int selfPid, EffectDef def)
        {
            string kind = J.Str(spec, "kind", "foreground");
            bool foreground = kind == "foreground";
            IntPtr h, hmon = IntPtr.Zero;
            switch (kind)
            {
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
            var t = new TargetRef { Kind = monitor ? "monitor" : "window", Hwnd = h };
            if (monitor)
            {
                if (hmon == IntPtr.Zero) hmon = N.MonitorFromWindow(h, 2);
                t.Hmon = hmon;
                t.Device = N.MonitorDevice(hmon);
                if (t.Device == null) throw new ProtocolError("no_monitor", "écran introuvable");
                RECT r = N.MonitorRectOf(hmon);
                t.Key = "monitor:" + t.Device;
                t.Info = J.Map("kind", "monitor", "mode", "C", "device", t.Device, "title", MonitorLabel(r, N.MonitorRect(N.GetDesktopWindow()), r.Left == 0 && r.Top == 0),
                    "process", foreground ? ProcName(pid) : null, "input", def.Input, "follow_foreground", false);
            }
            else
            {
                t.Key = "window:" + h.ToInt64().ToString("x");
                t.Info = J.Map("kind", "window", "mode", "D", "hwnd", h.ToInt64(), "process", ProcName(pid), "title", N.WindowText(h),
                    "input", null, "follow_foreground", J.Bool(spec, "follow_foreground", true));
            }
            return t;
        }
    }
}
