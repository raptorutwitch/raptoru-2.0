// Cadence de rendu d'une surface (moteur Chaos) : quand redessiner le calque. Logique pure, testée (chaos-unit) et
// rejouée hors écran (ChaosEngine.exe --check-hold) avec la même règle que le moteur.
namespace Raptoru.Chaos
{
    static class Cadence
    {
        /// Images cadencées (une par rafraîchissement de l'écran) plutôt qu'une par nouvelle image capturée :
        /// - transition : entrée ou sortie animée ;
        /// - !needsCapture : calque sans capture (brouillard, clignement…) ;
        /// - cappedFresh : cadence plafonnée avec une capture en attente ;
        /// - followsCursor : le curseur dessiné suit la souris ;
        /// - clockDriven : la dernière image lisait l'horloge de l'effet (VHS, flou pulsé, pixelisation progressive…).
        ///   Sans ce dernier cas, un filtre qui lit la capture ET s'anime seul n'était redessiné qu'à chaque nouvelle
        ///   capture : fenêtre immobile, image figée du mode E ou bureau, et son maintien restait gelé jusqu'à la sortie
        ///   (bug VHS du 24/11).
        public static bool Timed(bool transition, bool needsCapture, bool cappedFresh, bool followsCursor, bool clockDriven)
        {
            return transition || !needsCapture || cappedFresh || followsCursor || clockDriven;
        }

        /// Une image est due :
        /// - la première (calque pas encore affiché) ;
        /// - sans cadence : une par nouvelle capture ;
        /// - cadencée et plafonnée (cadence max sous la fréquence de l'écran) : une par rafraîchissement ;
        /// - cadencée sans plafond : CHAQUE nouvelle capture tout de suite, et un rafraîchissement seulement s'il n'a vu
        ///   aucune capture depuis le précédent (animation, curseur, image figée).
        /// Avant le 25/11, une image cadencée n'était rendue qu'au rafraîchissement : quand deux captures du jeu (~58 i/s,
        /// légèrement décalé de l'écran) arrivaient entre deux retours de balayage, la première n'était jamais montrée.
        /// Mesuré en jeu : Miroir présentait 50,7 à 52,5 images/s pour 58,5 à 59,1 captures/s, avec ~16 ms d'attente
        /// (p95) entre l'arrivée de la capture et son rendu ; le calque neutre, rendu à chaque capture, n'en perdait aucune.
        public static bool Due(bool shown, bool timed, bool tick, bool pendingFresh, bool capped, bool freshSinceTick)
        {
            if (!shown) return true;
            if (!timed) return pendingFresh;
            if (capped) return tick;
            return pendingFresh || (tick && !freshSinceTick);
        }
    }
}
