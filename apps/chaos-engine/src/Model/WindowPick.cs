// Choix de la fenêtre « en direct » d'une cible écran (mode E, Host/Targets.cs) : la règle, sans appel à Windows,
// testée par chaos-unit. Targets.WindowOn relève les faits de chaque fenêtre (ordre d'affichage) et prend la première
// éligible.
namespace Raptoru.Chaos
{
    /// Ce que Targets.WindowOn lit d'une fenêtre.
    struct WindowFacts
    {
        public bool Visible, Cloaked, Iconic, Owned, Self;
        public int ExStyle;
        public string Class;
        /// GetWindowDisplayAffinity : 0 = capturable ; 1 = WDA_MONITOR (noire dans les captures) ; 0x11 =
        /// WDA_EXCLUDEFROMCAPTURE (absente des captures).
        public uint Affinity;
        /// Part de l'écran couverte (0 à 1).
        public double Share;
    }

    static class WindowPick
    {
        const int WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80;

        /// Ni cachée, ni réduite, ni possédée, ni outil, ni calque traversable, ni bureau ou barre des tâches, ni fenêtre
        /// du moteur ; couvre au moins minShare de l'écran ; et jamais protégée contre la capture : Windows Graphics
        /// Capture n'en livre aucune image (Discord, qui s'exclut des captures, choisi le 24/11 : « aucune image
        /// capturée » au bout de 3 s pour le miroir et le retournement).
        public static bool Eligible(WindowFacts f, double minShare)
        {
            if (!f.Visible || f.Cloaked || f.Iconic || f.Owned || f.Self) return false;
            if ((f.ExStyle & (WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT)) != 0) return false;
            if (f.Class == "Progman" || f.Class == "WorkerW" || f.Class == "Shell_TrayWnd" || f.Class == "Shell_SecondaryTrayWnd") return false;
            if (f.Affinity != 0) return false;
            return f.Share >= minShare;
        }
    }
}
