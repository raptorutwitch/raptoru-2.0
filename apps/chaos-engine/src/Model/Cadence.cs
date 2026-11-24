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

        /// Une image est due : la première (calque pas encore affiché), puis une par rafraîchissement si elle est
        /// cadencée, sinon une par nouvelle capture.
        public static bool Due(bool shown, bool timed, bool tick, bool pendingFresh)
        {
            return !shown || (timed ? tick : pendingFresh);
        }
    }
}
