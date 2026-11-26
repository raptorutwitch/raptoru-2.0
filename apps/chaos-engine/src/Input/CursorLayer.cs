// Curseur des effets qui transforment l'image (retournement 180°, décision d'Antoni du 23/11 : docs/chaos/ETUDE_CURSEUR.md).
// Le curseur de Windows garde ses coordonnées et les clics vont exactement aux coordonnées d'origine : AUCUNE entrée
// n'est touchée. Au-dessus de la cible seulement, le curseur matériel est masqué (MagShowSystemCursor, API Loupe de
// Windows, documentée, sans injection) et le moteur dessine l'image du vrai curseur (forme et position lues chaque
// image) au point transformé, dans l'image transformée (FrameBuilder.AddCursor). Un seul curseur visible, aligné avec
// ce que le clic touchera ; il se déplace donc à l'inverse des mouvements physiques.
// Windows retire le curseur de ses propres captures quand il est masqué (essai du 23/11) : d'où l'image redessinée.
//
// Restauration, de la plus courante à la plus rare :
//   1. le curseur sort de la cible, l'effet se termine, STOP ALL, arrêt d'urgence → rétabli à l'image suivante ;
//   2. arrêt du moteur (Quit, quelle qu'en soit la cause) → rétabli avant de terminer le processus ;
//   3. moteur tué, planté ou gelé → le gardien (processus séparé) le rétablit (indicateur [28] de la mémoire partagée) ;
//   4. secours manuel : ChaosEngine.exe --restore-display (écrans et curseur).
using System;
using System.Runtime.InteropServices;

namespace Raptoru.Chaos
{
    /// Le vrai curseur à un instant : position (pixels physiques), forme, affiché ou non par le programme visé.
    struct CursorSample
    {
        public bool Ok;
        public int X, Y, Flags;
        public IntPtr Shape;
        public long Qpc;
        /// Le programme montre un curseur (un jeu qui le cache, visée à la souris, n'en a pas : rien à dessiner).
        public bool Visible { get { return Ok && Shape != IntPtr.Zero && (Flags & 3) != 0; } }
    }

    sealed class CursorLayer
    {
        [DllImport("Magnification.dll")] static extern bool MagInitialize();
        [DllImport("Magnification.dll")] static extern bool MagUninitialize();
        [DllImport("Magnification.dll")] static extern bool MagShowSystemCursor(bool show);
        [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
        [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }

        readonly object gate = new object();
        bool ready, hidden;
        long hiddenSince = -1;
        public long Hides, HiddenMs, Failures;
        public string LastError;
        public bool Hidden { get { return hidden; } }

        public static CursorSample Read()
        {
            var ci = new CURSORINFO { cbSize = Marshal.SizeOf(typeof(CURSORINFO)) };
            var s = new CursorSample { Qpc = N.QpcNow() };
            if (!GetCursorInfo(ref ci)) return s;
            s.Ok = true; s.X = ci.pt.X; s.Y = ci.pt.Y; s.Flags = ci.flags; s.Shape = ci.hCursor;
            return s;
        }

        /// Masque (vrai) ou rétablit (faux) le curseur matériel. Sans effet si l'état est déjà le bon.
        public void SetHidden(bool on, long now)
        {
            lock (gate)
            {
                if (on == hidden) return;
                if (on && !ready)
                {
                    ready = MagInitialize();
                    if (!ready) { Failures++; LastError = "MagInitialize a échoué : curseur matériel laissé visible"; return; }
                }
                if (!MagShowSystemCursor(!on)) { Failures++; LastError = "MagShowSystemCursor(" + !on + ") a échoué"; if (on) return; }
                hidden = on;
                if (on) { Hides++; hiddenSince = now; }
                else if (hiddenSince >= 0) { HiddenMs += now - hiddenSince; hiddenSince = -1; }
            }
        }

        /// Rétablit le curseur quoi qu'il arrive (fin du moteur, arrêt d'urgence) ; appelable depuis n'importe quel fil.
        public void Restore()
        {
            lock (gate)
            {
                if (hidden || ready) { try { MagShowSystemCursor(true); } catch (Exception) { } }
                hidden = false;
                if (ready) { try { MagUninitialize(); } catch (Exception) { } ready = false; }
            }
        }

        /// Secours hors moteur (gardien, --restore-display) : rétablit le curseur masqué par un autre processus.
        public static bool RestoreSystem()
        {
            try { bool i = MagInitialize(); bool ok = MagShowSystemCursor(true); if (i) MagUninitialize(); return ok; }
            catch (Exception) { return false; }
        }

        public long HiddenTotalMs(long now) { lock (gate) return HiddenMs + (hidden && hiddenSince >= 0 ? now - hiddenSince : 0); }
    }
}
