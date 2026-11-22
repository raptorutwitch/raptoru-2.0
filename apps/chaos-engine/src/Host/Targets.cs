// Cibles : liste des fenêtres proposables et résolution d'une cible demandée (fenêtre, premier plan, écran).
using System;
using System.Collections.Generic;
using System.Diagnostics;

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

        /// spec : {kind:"window", hwnd} | {kind:"foreground"} | {kind:"monitor", hwnd?} ; mode par défaut pour « foreground ».
        public static TargetRef Resolve(Dictionary<string, object> spec, string defaultMode, int selfPid, bool needsCapture)
        {
            string kind = J.Str(spec, "kind", "foreground");
            IntPtr h;
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
                    h = J.Has(spec, "hwnd") ? new IntPtr((long)J.Num(spec, "hwnd", 0)) : N.GetDesktopWindow();
                    break;
                default: throw new ProtocolError("invalid_target", "cible inconnue : " + kind);
            }
            if (h == IntPtr.Zero || !N.IsWindow(h)) throw new ProtocolError("no_window", "fenêtre cible introuvable");
            uint pid; N.GetWindowThreadProcessId(h, out pid);
            if (pid == selfPid) throw new ProtocolError("invalid_target", "une fenêtre du moteur ne peut pas être une cible");
            bool monitor = kind == "monitor";
            if (!monitor && N.IsIconic(h)) throw new ProtocolError("target_minimized", "la fenêtre cible est réduite");
            int quns;
            if (needsCapture && N.SHQueryUserNotificationState(out quns) == 0 && quns == N.QUNS_RUNNING_D3D_FULL_SCREEN)
                throw new ProtocolError("exclusive_fullscreen", "un jeu est en plein écran exclusif : rien ne peut s'afficher au-dessus ; passer en fenêtré sans bordure");
            var t = new TargetRef { Kind = monitor ? "monitor" : "window", Hwnd = h };
            t.Key = monitor ? "monitor:" + N.MonitorFromWindow(h, 2).ToInt64().ToString("x") : "window:" + h.ToInt64().ToString("x");
            t.Info = J.Map("kind", t.Kind, "mode", monitor ? "C" : "D", "hwnd", h.ToInt64(), "process", ProcName(pid),
                "title", monitor ? "écran" : N.WindowText(h), "follow_foreground", J.Bool(spec, "follow_foreground", true));
            return t;
        }
    }
}
