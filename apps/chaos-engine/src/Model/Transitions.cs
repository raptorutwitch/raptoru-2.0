// Moteur de transitions : courbes, et un animateur de « présence » (0 = effet absent, 1 = effet entier) partagé par
// tous les effets. Les paramètres animables (registre : animatable + neutral) sont interpolés entre leur valeur neutre
// et leur valeur cible selon cette présence : le retournement anime son angle, un flou animera son rayon, etc.
// Une sortie demandée pendant l'entrée repart de la présence courante (aucun saut), à vitesse comparable.
using System;

namespace Raptoru.Chaos
{
    static class Curves
    {
        public static bool Known(string name)
        {
            switch (name)
            {
                case "linear": case "ease_in_out_sine": case "ease_in_out_cubic": case "ease_in_cubic": case "ease_out_cubic": return true;
                default: return false;
            }
        }

        public static double Eval(string name, double t)
        {
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            switch (name)
            {
                case "ease_in_out_sine": return (1 - Math.Cos(Math.PI * t)) / 2;
                case "ease_in_out_cubic": return t < 0.5 ? 4 * t * t * t : 1 - Math.Pow(-2 * t + 2, 3) / 2;
                case "ease_in_cubic": return t * t * t;
                case "ease_out_cubic": return 1 - Math.Pow(1 - t, 3);
                default: return t;
            }
        }

        /// Pente maximale de la courbe (vitesse de pointe ÷ vitesse moyenne) : sert aux plafonds de vitesse.
        public static double PeakSlope(string name)
        {
            switch (name)
            {
                case "ease_in_out_sine": return Math.PI / 2;
                case "ease_in_out_cubic": return 3;
                case "ease_in_cubic": case "ease_out_cubic": return 3;
                default: return 1;
            }
        }
    }

    /// Une transition résolue (registre + préréglage + demande, après plafonds de sécurité).
    sealed class TransitionPlan
    {
        public string Kind = "cut", Curve = "linear";
        public int DurationMs;
        public bool Instant { get { return Kind == "cut" || DurationMs <= 0; } }
        public TransitionPlan Clone() { return new TransitionPlan { Kind = Kind, Curve = Curve, DurationMs = DurationMs }; }
    }

    enum AnimPhase { Idle, Entering, Steady, Exiting, Done }

    sealed class Animator
    {
        readonly TransitionPlan inPlan, outPlan;
        long phaseAt;
        double exitFrom = 1, exitMs;
        public AnimPhase Phase { get; private set; }

        public Animator(TransitionPlan inPlan, TransitionPlan outPlan) { this.inPlan = inPlan; this.outPlan = outPlan; Phase = AnimPhase.Idle; }

        public void Start(long now)
        {
            phaseAt = now;
            Phase = inPlan.Instant ? AnimPhase.Steady : AnimPhase.Entering;
        }

        /// Début de la sortie, depuis la présence actuelle (une entrée interrompue repart en arrière sans saut).
        public void BeginExit(long now)
        {
            if (Phase == AnimPhase.Exiting || Phase == AnimPhase.Done) return;
            exitFrom = Presence(now);
            if (outPlan.Instant || exitFrom <= 0) { Phase = AnimPhase.Done; return; }
            exitMs = Math.Max(1, outPlan.DurationMs * exitFrom);
            phaseAt = now;
            Phase = AnimPhase.Exiting;
        }

        public void Cut() { Phase = AnimPhase.Done; }

        /// Sortie demandée mais retenue (la couche Entrées rend l'écran avant le retour animé) : la présence reste où
        /// elle est, l'animation de sortie partira de là quand on cessera de la retenir.
        public void HoldExit(long now) { if (Phase == AnimPhase.Exiting) phaseAt = now; }

        public double Presence(long now)
        {
            switch (Phase)
            {
                case AnimPhase.Idle: return 0;
                case AnimPhase.Entering:
                    double t = (now - phaseAt) / (double)inPlan.DurationMs;
                    if (t >= 1) { Phase = AnimPhase.Steady; return 1; }
                    return Curves.Eval(inPlan.Curve, t);
                case AnimPhase.Steady: return 1;
                case AnimPhase.Exiting:
                    double s = (now - phaseAt) / exitMs;
                    if (s >= 1) { Phase = AnimPhase.Done; return 0; }
                    return exitFrom * (1 - Curves.Eval(outPlan.Curve, s));
                default: return 0;
            }
        }

        public bool Animating(long now)
        {
            Presence(now); // fait avancer la phase
            return Phase == AnimPhase.Entering || Phase == AnimPhase.Exiting;
        }

        public bool Done(long now) { Presence(now); return Phase == AnimPhase.Done; }

        /// Valeur d'un paramètre animable : neutre → cible selon la présence.
        public static double Lerp(double neutral, double target, double presence) { return neutral + (target - neutral) * presence; }
    }
}
