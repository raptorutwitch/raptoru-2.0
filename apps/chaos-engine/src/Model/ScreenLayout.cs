// Écrans vus par le streamer (Studio › Chaos, fiche d'un effet) : rangés de gauche à droite selon leur position réelle
// dans Windows (jamais selon leur numéro DISPLAYn), nommés « Écran gauche », « Écran droit », « Écran du milieu ».
// Un effet mémorise un CHOIX stable plutôt qu'un identifiant Windows : left, right, s:<rang> (milieu), primary, all.
// Écran débranché ou disposition changée : left et right désignent toujours l'écran le plus à gauche et le plus à
// droite ; un rang qui n'existe plus est refusé (screen_missing) avec un message clair, jamais remplacé en silence.
// Logique pure (testée par chaos-unit) : la liste des écrans vient de Windows (Host/Targets).
using System;
using System.Collections.Generic;
using System.Linq;

namespace Raptoru.Chaos
{
    sealed class ScreenInfo
    {
        public string Device;
        public int X, Y, Width, Height, Hz;
        public bool Primary;
    }

    static class ScreenLayout
    {
        /// De gauche à droite (puis de haut en bas pour des écrans empilés).
        public static List<ScreenInfo> Ordered(IEnumerable<ScreenInfo> screens)
        {
            return screens.OrderBy(s => s.X + s.Width / 2.0).ThenBy(s => s.Y).ToList();
        }

        /// Clé de choix d'un rang : left (le plus à gauche), right (le plus à droite), s:<rang> sinon.
        public static string Key(int index, int count)
        {
            if (index == 0) return "left";
            if (index == count - 1) return "right";
            return "s:" + index;
        }

        public static string Label(int index, int count)
        {
            if (count <= 1) return "Écran";
            if (index == 0) return "Écran gauche";
            if (index == count - 1) return "Écran droit";
            if (count == 3) return "Écran du milieu";
            return "Écran " + (index + 1) + " (depuis la gauche)";
        }

        public static bool Valid(string choice)
        {
            if (choice == "left" || choice == "right" || choice == "all" || choice == "primary") return true;
            int i;
            return choice != null && choice.StartsWith("s:") && int.TryParse(choice.Substring(2), out i) && i >= 0 && i < 16;
        }

        /// Les écrans d'un choix (dans l'ordre gauche → droite), ou une erreur lisible si le choix ne correspond plus.
        public static List<ScreenInfo> Resolve(string choice, List<ScreenInfo> ordered, out string error)
        {
            error = null;
            if (ordered.Count == 0) { error = "aucun écran détecté"; return new List<ScreenInfo>(); }
            switch (choice)
            {
                case "all": return new List<ScreenInfo>(ordered);
                case "left": return new List<ScreenInfo> { ordered[0] };
                case "right": return new List<ScreenInfo> { ordered[ordered.Count - 1] };
                case "primary": return new List<ScreenInfo> { ordered.FirstOrDefault(s => s.Primary) ?? ordered[0] };
            }
            int i;
            if (choice != null && choice.StartsWith("s:") && int.TryParse(choice.Substring(2), out i))
            {
                if (i > 0 && i < ordered.Count - 1) return new List<ScreenInfo> { ordered[i] };
                error = "l'écran enregistré (" + (i + 1) + "e depuis la gauche) n'existe plus : " + ordered.Count + " écran(s) détecté(s) ; choisir un écran dans la fiche de l'effet";
                return new List<ScreenInfo>();
            }
            error = "choix d'écran inconnu : " + choice;
            return new List<ScreenInfo>();
        }
    }
}
