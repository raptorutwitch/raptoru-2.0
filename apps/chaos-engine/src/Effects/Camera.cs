// Effets qui déplacent l'image (emplacements transform et camera) : miroir, tremblement, zoom, écran ivre, vision tunnel.
// Tous passent par fb.Transform : le curseur dessiné suit leur composition (registre "cursor": "follow"), les entrées de
// la souris ne sont jamais touchées. Recherche et choix : docs/chaos/ETUDE_EFFETS_V2.md.
using System;

namespace Raptoru.Chaos
{
    /// Miroir horizontal ou vertical, ou alternance des deux axes. L'entrée et la sortie retournent l'image comme une
    /// carte (l'échelle passe par zéro sur fond sombre) ; l'alternance passe d'un miroir à l'autre par un demi-tour
    /// (miroir horizontal = demi-tour du miroir vertical), sans jamais écraser l'image.
    sealed class MirrorEffect : Effect
    {
        const double SwitchS = 0.6;

        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            string axis = f.P.Str("axis");
            double c = Math.Cos(Math.PI * f.Presence);
            double card = Math.Sign(c) * Math.Max(0.015, Math.Abs(c));
            double t = f.ElapsedMs / 1000.0, inS = f.P.In.DurationMs / 1000.0;
            if (axis != "alterne")
            {
                if (axis == "vertical") fb.Transform(0, 1, card, 0, 0, "black");
                else fb.Transform(0, card, 1, 0, 0, "black");
                return;
            }
            // Alternance : état = R(θ) × miroir vertical ; θ = π (miroir horizontal) ou 0 (miroir vertical).
            double period = Math.Max(SwitchS + 0.4, f.P.Num("interval_ms") / 1000.0);
            double u = Math.Max(0, t - inS);
            int n = (int)Math.Floor(u / period);
            double phase = u - n * period;
            bool horizontal = n % 2 == 0;
            if (f.Presence < 0.999 && (t < inS || f.Exiting))
            {
                // Entrée (toujours vers le miroir horizontal) ou sortie depuis l'axe en cours : retournement de carte.
                bool h = !f.Exiting || horizontal;
                if (h) fb.Transform(0, card, 1, 0, 0, "black"); else fb.Transform(0, 1, card, 0, 0, "black");
                return;
            }
            double theta = horizontal ? Math.PI : 0;
            if (n > 0 && phase < SwitchS)
            {
                double from = horizontal ? 0 : Math.PI;
                theta = Fx.Lerp(from, theta, Fx.EaseInOut(phase / SwitchS));
            }
            fb.Transform(theta, 1, -1, 0, 0, "mirror");
        }
    }

    /// Tremblement d'écran. Modèle « trauma » (S. Eiserloh, « Math for Game Programmers: Juicing Your Cameras With
    /// Math », GDC 2016) : une force 0..1 dont le carré donne l'amplitude (la fin d'une secousse s'éteint en douceur),
    /// et un bruit de gradient continu lu au temps × fréquence pour x, y et le roulis (jamais un tirage par image : pas
    /// de clignotement spatial). Régularité : du sinus pur (vibration mécanique) au bruit (secousse). Les bords ne se
    /// découvrent jamais : léger surcadrage proportionnel à l'amplitude en cours (cover), ou prolongement flou.
    sealed class ShakeEffect : Effect
    {
        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var p = f.P;
            int seed = f.Seed;
            double t = f.ElapsedMs / 1000.0, dur = p.DurationMs / 1000.0;
            double inten = p.Num("intensity"), freq = p.Num("frequency"), decay = Math.Max(0.05, p.Num("decay_ms") / 1000.0);
            double irr = p.Num("irregularity");
            double env;
            switch (p.Str("mode"))
            {
                case "impact": env = Math.Exp(-t / decay); break;
                case "rafales": env = Fx.Pulses(seed, t, Math.Max(0.3, p.Num("interval_ms") / 1000.0), 0.03, 0.05, decay, 0.9); break;
                case "seisme": env = Fx.Smooth(0, Math.Max(0.5, dur * 0.25), t) * (0.7 + 0.3 * Fx.Noise(seed + 5, t * 0.6)); break;
                default: env = 1; break;
            }
            // Un impact frappe tout de suite (pas de montée) ; la sortie garde sa transition.
            double pres = p.Str("mode") == "impact" && !f.Exiting ? 1 : f.Presence;
            double k = inten * Math.Pow(Fx.Clamp01(env * pres), 2);
            if (k < 1e-4) { fb.Transform(0, 1, 1, 0, 0, "clamp"); return; }
            double w = 2 * Math.PI * freq;
            double nx = Fx.Lerp(Math.Sin(w * t + seed % 7), Fx.Noise(seed + 1, t * freq), irr) * 0.8 + 0.2 * Fx.Noise(seed + 4, t * freq * 0.31);
            double ny = Fx.Lerp(Math.Sin(w * 1.13 * t + seed % 5 + 1.7), Fx.Noise(seed + 2, t * freq * 1.13), irr) * 0.8 + 0.2 * Fx.Noise(seed + 6, t * freq * 0.27);
            double nr = Fx.Lerp(Math.Sin(w * 0.71 * t + 0.4), Fx.Noise(seed + 3, t * freq * 0.7), irr);
            double ax = fb.Width / (double)fb.Height;
            double axA = p.Num("amp_x") / 100 * k, ayA = p.Num("amp_y") / 100 * k, arA = p.Num("rotation") * Math.PI / 180 * k;
            double dx = axA * nx, dy = ayA * ny, rot = arA * nr;
            string fill = p.Str("fill");
            if (fill == "cover")
            {
                double r = Math.Max(ax, 1 / ax);
                double s = (Math.Cos(arA) + r * Math.Sin(arA)) * (1 + 2 * Math.Max(axA / ax, ayA));
                fb.Transform(rot, s, s, dx, dy, "clamp");
            }
            else fb.Transform(rot, 1, 1, dx, dy, fill);
        }
    }

    /// Zoom : facteur interpolé en échelle logarithmique (une vitesse perçue constante, de ×1 à ×8), vers un point choisi
    /// (fenêtre de lecture toujours dans l'image : jamais de bord découvert). Modes : progressif (entrée et retour aux
    /// vitesses des transitions), brutal (coup de zoom avec léger rebond), pulsations (impulsions réglables, variation
    /// contrôlée de leur moment et de leur force).
    sealed class ZoomEffect : Effect
    {
        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var p = f.P;
            double t = f.ElapsedMs / 1000.0, dur = p.DurationMs / 1000.0;
            double z = p.Num("factor"), pres = f.Presence, env;
            switch (p.Str("mode"))
            {
                case "brutal":
                    // Coup de zoom en 90 ms puis rebond amorti ; la sortie garde la transition réglée.
                    env = Fx.EaseOut(t / 0.09, 3) * (1 + 0.16 * Math.Exp(-t / 0.18) * Math.Cos(2 * Math.PI * 2.6 * t));
                    if (!f.Exiting) pres = 1;
                    break;
                case "pulsations":
                    int n = Math.Max(1, (int)p.Num("pulses"));
                    env = Fx.Pulses(f.Seed, t, dur / n, p.Num("attack_ms") / 1000.0, p.Num("hold_ms") / 1000.0, p.Num("release_ms") / 1000.0, p.Num("jitter"));
                    break;
                default: env = 1; break;
            }
            double s = Math.Exp(Math.Log(z) * env * pres);
            double tx, ty, sx, sy;
            Fx.ZoomFrame(s, p.Num("focus_x"), p.Num("focus_y"), p.Num("recenter"), fb.Width / (double)fb.Height, out tx, out ty, out sx, out sy);
            fb.Transform(0, s, s, tx, ty, "clamp");
        }
    }

    /// Écran ivre : pas un tremblement (aucune fréquence au-delà de 0,6 Hz) mais une perte d'équilibre. Une
    /// transformation lente (balancement, dérive, respiration du zoom, surcadrage) puis une déformation continue
    /// (ondulation, double vision qui converge et diverge, léger flou, bords assombris). La progression fait monter
    /// l'ivresse au fil de l'effet.
    sealed class DrunkEffect : Effect
    {
        readonly float[] u = new float[16];

        /// Titubation k (cible tirée de la graine), atteinte depuis la précédente selon e ; sans allocation.
        static double Lurch(int seed, int k, double e, int j) { return Fx.Lerp(Fx.Hash(seed + 31, k - 1, j) * 2 - 1, Fx.Hash(seed + 31, k, j) * 2 - 1, e); }

        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var p = f.P;
            int seed = f.Seed;
            double t = f.ElapsedMs / 1000.0, dur = Math.Max(1, p.DurationMs / 1000.0), sp = p.Num("speed");
            double prog = p.Num("progression");
            double I = p.Num("intensity") * f.Presence * (1 - prog + prog * Fx.Smooth(0, dur * 0.85, t));
            double ax = fb.Width / (double)fb.Height;
            double swayA = p.Num("sway") * Math.PI / 180 * I, driftA = p.Num("drift") / 100 * I;
            double rot = swayA * (0.65 * Math.Sin(2 * Math.PI * 0.11 * sp * t + seed % 6) + 0.35 * Fx.Noise(seed, t * 0.21 * sp));
            double dx = driftA * Fx.Noise(seed + 1, t * 0.09 * sp), dy = driftA * 0.6 * Fx.Noise(seed + 2, t * 0.08 * sp);
            double breath = 1 + p.Num("breathing") / 100 * I * (0.5 + 0.5 * Math.Sin(2 * Math.PI * 0.17 * sp * t));
            // Titubations : l'image part d'un côté, s'y attarde, repart ailleurs (cibles tirées de la graine, trajets
            // amortis) : des changements de direction francs mais jamais secs.
            double st = p.Num("stagger") * I, stRot = 0;
            if (st > 0)
            {
                double L = 1.9 / Math.Max(0.2, sp), q = t / L;
                int k = (int)Math.Floor(q);
                double e = Fx.EaseInOut(Fx.Clamp01((q - k) / 0.55));
                stRot = st * 7 * Math.PI / 180;
                rot += stRot * Lurch(seed, k, e, 1);
                dx += st * 0.035 * Lurch(seed, k, e, 2); dy += st * 0.02 * Lurch(seed, k, e, 3);
                breath *= 1 + st * 0.05 * Math.Abs(Lurch(seed, k, e, 4));
            }
            double r = Math.Max(ax, 1 / ax), rotMax = swayA + stRot, driftMax = driftA + st * 0.035;
            double cover = (Math.Cos(rotMax) + r * Math.Sin(rotMax)) * (1 + 2 * Math.Max(driftMax / ax, driftMax * 0.6));
            fb.Transform(rot, cover * breath, cover * breath, dx, dy, "clamp");
            double dbl = p.Num("double") * I;
            u[0] = (float)(p.Num("warp") * I); u[1] = 1.6f; u[2] = (float)dbl;
            u[3] = (float)(0.014 * dbl * Math.Cos(0.37 * sp * t + seed % 3)); u[4] = (float)(0.007 * dbl * Math.Sin(0.29 * sp * t));
            u[5] = (float)(p.Num("blur") * I * 2.5); u[6] = (float)(p.Num("vignette") * I);
            u[7] = (float)(t * 0.21 * sp % 1000); u[8] = (float)(t * 0.17 * sp % 1000);
            fb.Filter("drunk", u, true);
        }
    }

    /// Vision tunnel / focus cinématique : zoom vers le point focal (même cadrage que le zoom) et voile à distance
    /// signée autour de ce point (cercle, ellipse ou rectangle arrondi), contour très doux, ombre intérieure. Entrée :
    /// le champ se referme depuis l'extérieur de l'écran pendant que le zoom avance ; modes : fixe, qui se rétrécit,
    /// point focal qui dérive lentement.
    sealed class TunnelEffect : Effect
    {
        readonly float[] u = new float[16];
        readonly float[] col = new float[4];

        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var p = f.P;
            double t = f.ElapsedMs / 1000.0, dur = Math.Max(1, p.DurationMs / 1000.0), pr = f.Presence;
            double fx = p.Num("focus_x"), fy = p.Num("focus_y");
            string mode = p.Str("mode");
            double radius = p.Num("radius");
            if (mode == "retrecit") radius *= Fx.Lerp(1, p.Num("shrink"), Fx.Smooth(0, dur, t));
            if (mode == "derive")
            {
                double d = p.Num("drift") * 0.18;
                fx = Math.Max(0.05, Math.Min(0.95, fx + d * Fx.Noise(f.Seed, t * 0.12)));
                fy = Math.Max(0.05, Math.Min(0.95, fy + d * 0.7 * Fx.Noise(f.Seed + 1, t * 0.1)));
            }
            double zoom = Math.Exp(Math.Log(p.Num("zoom")) * pr);
            double tx, ty, sx, sy;
            Fx.ZoomFrame(zoom, fx, fy, p.Num("recenter"), fb.Width / (double)fb.Height, out tx, out ty, out sx, out sy);
            fb.Transform(0, zoom, zoom, tx, ty, "clamp");
            int shape = p.Str("shape") == "ellipse" ? 1 : p.Str("shape") == "rectangle" ? 2 : 0;
            u[0] = (float)sx; u[1] = (float)sy;
            u[2] = (float)Fx.Lerp(1.6, radius, pr);
            u[3] = (float)(0.005 + p.Num("feather") * 0.15);
            u[4] = (float)(p.Num("darkness") * Fx.Smooth(0, 0.55, pr)); u[5] = shape; u[6] = (float)p.Num("stretch"); u[7] = 0.45f;
            u[8] = (float)p.Num("inner"); u[9] = (float)(0.03 + p.Num("gradient") * 0.6); u[10] = 1.25f;
            var c = p.Color("color");
            col[0] = c[0]; col[1] = c[1]; col[2] = c[2]; col[3] = 1;
            fb.Overlay("tunnel", u, 1, IntPtr.Zero, 1, col);
        }
    }
}
