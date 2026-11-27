// Couche Entrées (docs/chaos/COUCHE_ENTREES.md) : les transformations des entrées, séparées du moteur visuel.
// Une primitive aujourd'hui, invert_xy : souris inversée en X et en Y, cohérente avec l'écran retourné. Le vrai
// curseur Windows reste le seul curseur, le clic tombe sous lui.
//
// Mise en œuvre : l'orientation du moniteur passe à +180° (ChangeDisplaySettingsEx, mode temporaire CDS_FULLSCREEN,
// jamais enregistré). Windows dessine alors le curseur et place les clics dans le repère retourné : monter la souris
// fait descendre le curseur à l'écran, le clic atterrit sous la pointe. Aucun crochet, aucune injection d'entrée,
// aucun faux curseur, rien dans les processus des jeux.
// (Inverser la souris sous une image retournée par un calque ne suffit pas : Windows dessine le curseur à sa position
// réelle, le clic tomberait toujours au point symétrique de ce qu'on voit sous le curseur.)
//
// Restauration, de la plus courante à la plus rare :
//   1. fin ou arrêt de l'effet, STOP ALL, arrêt d'urgence → l'écran revient aux réglages enregistrés de Windows ;
//   2. moteur terminé pour n'importe quelle raison (plantage, tué, gelé puis tué par le gardien) → Windows rétablit
//      lui-même l'affichage : le mode temporaire appartient au processus qui l'a demandé (vérifié le 22/11) ;
//   3. redémarrage ou fermeture de session → rien n'a été enregistré ;
//   4. secours manuel : ChaosEngine.exe --restore-display.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

namespace Raptoru.Chaos
{
    sealed class InputError : Exception
    {
        public readonly string Code;
        public InputError(string code, string message) : base(message) { Code = code; }
    }

    sealed class InputLayer
    {
        public const string InvertXY = InputLayerIds.InvertXY;

        sealed class Hold
        {
            public string Owner, Effect, Device;
            public int From, To;
            public long Since, ApplyMs;
        }

        readonly Func<long> now;
        readonly List<Hold> holds = new List<Hold>();
        public long LastApplyMs = -1, LastRevertMs = -1;

        public InputLayer(Func<long> now) { this.now = now; }

        public int Count { get { return holds.Count; } }
        public bool Holds(string owner) { return holds.Any(h => h.Owner == owner); }

        /// Rotation (degrés) que Windows applique à cet écran pour Chaos : le rendu des calques la compense.
        public int RotationDeg(string device)
        {
            var h = holds.FirstOrDefault(x => x.Device == device);
            return h == null ? 0 : ((h.To - h.From + 4) % 4) * 90;
        }

        /// Applique la transformation (bloquant, ~120 ms sur une RTX 3070). Lève InputError si Windows refuse.
        public void Apply(string owner, string effect, string device)
        {
            if (effect != InvertXY) throw new InputError("input_unknown", "transformation d'entrée inconnue : " + effect);
            if (string.IsNullOrEmpty(device)) throw new InputError("input_unavailable", "la souris inversée exige l'écran entier comme cible");
            if (holds.Any(h => h.Device == device)) throw new InputError("input_busy", "cet écran est déjà retourné par un autre effet");
            var dm = N.DisplayMode(device);
            if (dm.dmSize == 0) throw new InputError("input_unavailable", "écran introuvable : " + device);
            int from = dm.dmDisplayOrientation, to = (from + 2) % 4;
            dm.dmDisplayOrientation = to;
            dm.dmFields |= N.DM_DISPLAYORIENTATION;
            dm.dmDriverExtra = 0;
            var sw = Stopwatch.StartNew();
            int r = N.ChangeDisplaySettingsExW(device, ref dm, IntPtr.Zero, N.CDS_FULLSCREEN, IntPtr.Zero);
            if (r != 0) throw new InputError("input_unavailable", "Windows refuse de retourner l'écran (code " + r + ")");
            LastApplyMs = sw.ElapsedMilliseconds;
            holds.Add(new Hold { Owner = owner, Effect = effect, Device = device, From = from, To = to, Since = now(), ApplyMs = LastApplyMs });
        }

        /// Rétablit l'écran tenu par cet effet (bloquant). Sans effet si rien n'est tenu.
        public void Revert(string owner)
        {
            var h = holds.FirstOrDefault(x => x.Owner == owner);
            if (h == null) return;
            holds.Remove(h);
            var sw = Stopwatch.StartNew();
            N.ResetDisplaySettings(h.Device, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero);
            LastRevertMs = sw.ElapsedMilliseconds;
        }

        public void RevertAll() { foreach (var h in holds.ToList()) Revert(h.Owner); }

        /// Effets dont l'écran a changé d'orientation hors de Chaos (Paramètres de Windows, pilote, autre logiciel) :
        /// la transformation est perdue (rien à rétablir), l'effet doit s'arrêter.
        public List<string> TakeLost()
        {
            var lost = holds.Where(h => N.DisplayOrientation(h.Device) != h.To).ToList();
            foreach (var h in lost) holds.Remove(h);
            return lost.Select(h => h.Owner).ToList();
        }

        public Dictionary<string, object> Describe()
        {
            long t = now();
            return J.Map("primitive", "display_orientation", "effects", new[] { InvertXY },
                "active", holds.Select(h => (object)J.Map("owner", h.Owner, "effect", h.Effect, "device", h.Device, "orientation", h.To * 90,
                    "since_ms", t - h.Since, "apply_ms", h.ApplyMs)).ToArray(),
                "last_apply_ms", LastApplyMs, "last_revert_ms", LastRevertMs);
        }

        /// Secours manuel (--restore-display) : tous les écrans reviennent aux réglages enregistrés de Windows.
        public static int RestoreAllDisplays()
        {
            return N.ResetDisplaySettings(null, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero);
        }
    }
}
