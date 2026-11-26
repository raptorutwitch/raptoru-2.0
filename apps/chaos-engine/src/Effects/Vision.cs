// Effets de vision : clignement des paupières, flash aveuglant avec rémanence, brouillard. Le clignement et le
// brouillard sont des calques SANS capture (le jeu se voit directement sous la fenêtre transparente : aucune latence,
// aucun coût de capture) ; le flash ne capture qu'une image (l'instant du flash) puis rend sa capture.
// Recherche et choix : docs/chaos/ETUDE_EFFETS_V2.md.
using System;
using System.Collections.Generic;

namespace Raptoru.Chaos
{
    /// Une courbe par segments (temps en s → valeur), chaque segment avec son accélération.
    sealed class Keys
    {
        struct Seg { public double T0, T1, V0, V1; public int Ease; }
        public const int Linear = 0, In = 1, Out = 2, InOut = 3, Close = 4;
        readonly List<Seg> segs = new List<Seg>();
        double end, last;

        /// Ajoute un segment de la valeur actuelle à v en d secondes, à partir de t (ou de la fin du segment précédent).
        public double To(double t, double d, double v, int ease)
        {
            t = Math.Max(t, end);
            segs.Add(new Seg { T0 = t, T1 = t + Math.Max(1e-3, d), V0 = last, V1 = v, Ease = ease });
            end = t + Math.Max(1e-3, d); last = v;
            return end;
        }
        public double End { get { return end; } }

        public double At(double t)
        {
            double v = 0;
            foreach (var s in segs)
            {
                if (t < s.T0) return v;
                if (t >= s.T1) { v = s.V1; continue; }
                double u = (t - s.T0) / (s.T1 - s.T0);
                double e = s.Ease == In ? Fx.EaseIn(u, 2) : s.Ease == Out ? Fx.EaseOut(u, 2.4) : s.Ease == InOut ? Fx.EaseInOut(u)
                    : s.Ease == Close ? 0.55 * u * u + 0.45 * Fx.Smooth(0, 1, u) : u;
                return Fx.Lerp(s.V0, s.V1, e);
            }
            return v;
        }
    }

    /// Clignement des paupières (calque sans capture). Reprend ce que le clignement de Chaos V1 avait de bon (fermeture
    /// progressive qui accélère, ouverture plus rapide au départ, petits clignements rapides, durées variées) et remplace
    /// ses deux bandes droites par une ouverture d'œil en amande vue de l'intérieur (shader « eyelids »). Le motif
    /// (instants, vitesses, profondeur) est calculé une fois au départ, à partir de la graine : chaque déclenchement est
    /// un peu différent, toujours dans les bornes réglées.
    sealed class BlinkEffect : Effect
    {
        readonly Keys blink = new Keys(), droop = new Keys();
        readonly float[] u = new float[16];
        readonly float[] col = new float[4];
        int seed;

        public override void Prepare(EffectContext c)
        {
            var p = c.P;
            seed = c.Seed;
            double dur = p.DurationMs / 1000.0;
            double close = p.Num("close_ms") / 1000, hold = p.Num("hold_ms") / 1000, open = p.Num("open_ms") / 1000;
            double depth = p.Num("intensity"), interval = p.Num("interval_ms") / 1000, irr = p.Num("irregularity");
            int count = Math.Max(1, (int)p.Num("count"));
            int i = 0;
            Func<double, double> vary = x => x * (1 + irr * 0.45 * (Fx.Hash(seed, i, 1) * 2 - 1));
            Action<double, double, double, double, double> one = (at, cl, ho, op, d) =>
            {
                blink.To(at, vary(cl), d, Keys.Close);
                blink.To(0, vary(ho), d, Keys.Linear);
                blink.To(0, vary(op), 0, Keys.Out);
                i++;
            };
            double tt;
            switch (p.Str("mode"))
            {
                case "ferme":
                    blink.To(0.02, close, depth, Keys.Close);
                    blink.To(0, Math.Max(0.05, dur - close - open - 0.05), depth, Keys.Linear);
                    blink.To(0, open, 0, Keys.Out);
                    break;
                case "serie":
                    tt = 0.12;
                    while (tt < dur - 0.3)
                    {
                        for (int k = 0; k < count && tt < dur - 0.3; k++)
                        {
                            one(tt, close, hold, open, Depth(depth, i));
                            // Entre deux clignements d'une série, l'œil se rouvre vraiment (mouvement des paupières
                            // visible, pas un simple noir qui clignote).
                            tt = blink.End + 0.12 + irr * 0.14 * Fx.Hash(seed, i, 3);
                        }
                        tt += vary(interval);
                    }
                    break;
                case "somnolence":
                    // Paupières lourdes qui tombent peu à peu ; clignements lents ; deux « micro-sommeils » (fermeture
                    // lente, maintien, réveil en sursaut) qui remettent les paupières en place un moment.
                    double heavy = Math.Min(0.55, depth * 0.6);
                    double nap1 = dur * 0.5, nap2 = dur * 0.82;
                    droop.To(0, nap1 - 0.3, heavy * 0.8, Keys.InOut);
                    droop.To(nap1 + 2.1, 0.15, 0.05, Keys.Out);
                    droop.To(0, Math.Max(0.5, nap2 - nap1 - 2.55), heavy, Keys.InOut);
                    droop.To(nap2 + 2.1, 0.15, 0.05, Keys.Out);
                    var naps = new[] { nap1, nap2 };
                    int ni = 0;
                    tt = 0.4;
                    while (tt < dur - 0.5)
                    {
                        if (ni < naps.Length && tt >= naps[ni] - 1.6)
                        {
                            if (naps[ni] < dur - 1)
                            {
                                blink.To(naps[ni] - 0.3, 1.0, 1, Keys.InOut);
                                blink.To(0, 1.4, 1, Keys.Linear);
                                blink.To(0, 0.12, 0, Keys.Out);
                            }
                            tt = blink.End + 0.8;
                            ni++;
                            continue;
                        }
                        one(tt, close * 1.8, hold * 2, open * 2.2, depth);
                        tt = blink.End + vary(interval * 0.7);
                    }
                    break;
                case "resistance":
                    // Yeux fermés qui essaient de se rouvrir : ouvertures partielles lentes, retombées, réussite à la fin.
                    blink.To(0.02, close, 1, Keys.Close);
                    tt = blink.End + 0.5;
                    while (tt < dur - 2.2)
                    {
                        double ajar = Fx.Range(seed, i, 4, 0.35, 0.7);
                        blink.To(tt, Fx.Range(seed, i, 5, 0.5, 0.9), 1 - ajar, Keys.InOut);
                        blink.To(0, Fx.Range(seed, i, 6, 0.15, 0.4), 1 - ajar, Keys.Linear);
                        blink.To(0, Fx.Range(seed, i, 7, 0.15, 0.3), 1, Keys.In);
                        i++;
                        tt = blink.End + Fx.Range(seed, i, 8, 0.4, 1.1);
                    }
                    blink.To(Math.Max(blink.End, dur - 1.6), 1.2, 0, Keys.InOut);
                    break;
                default: // naturel : clignements à intervalles organiques, parfois doublés
                    tt = Fx.Range(seed, 0, 9, 0.15, 0.45);
                    while (tt < dur - 0.2)
                    {
                        one(tt, close, hold, open, Depth(depth, i));
                        if (Fx.Hash(seed, i, 10) < 0.18 * irr && blink.End < dur - 0.6) one(blink.End + 0.05, close * 0.8, hold * 0.5, open * 0.9, depth);
                        tt = blink.End + vary(interval);
                    }
                    break;
            }
        }

        /// Profondeur d'un clignement : à l'intensité maximale, toujours une fermeture complète (≥ 97 % : le shader
        /// referme alors tout l'écran) ; en dessous, une légère variation organique.
        double Depth(double depth, int i) { return depth >= 0.97 ? Fx.Range(seed, i, 2, 0.98, 1) : depth * Fx.Range(seed, i, 2, 0.9, 1); }

        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var p = f.P;
            double t = f.ElapsedMs / 1000.0;
            double c = Math.Max(blink.At(t), droop.At(t));
            if (p.Str("mode") == "resistance" && c > 0.3 && c < 0.98) c -= 0.025 * Fx.Noise(seed + 8, t * 7); // effort : la paupière tremble
            c = Fx.Clamp01(c * f.Presence);
            if (c < 0.002) return;
            double asym = p.Num("asymmetry");
            u[0] = (float)c; u[1] = (float)Math.Pow(c, 1.8);
            u[2] = (float)p.Num("curvature"); u[3] = (float)p.Num("softness");
            u[4] = (float)(0.2 + 0.02 * Fx.Noise(seed + 3, t * 0.3)); u[5] = (float)(asym * 0.09 * Fx.Noise(seed + 7, t * 0.45));
            u[6] = (float)p.Num("lashes"); u[7] = (float)p.Num("glow");
            u[8] = 0.6f; u[9] = seed % 97;
            var cc = p.Color("tint");
            col[0] = cc[0]; col[1] = cc[1]; col[2] = cc[2]; col[3] = 1;
            fb.Overlay("eyelids", u, fb.LowQuality ? 0.5 : 1, IntPtr.Zero, 1, col);
        }
    }

    /// Flash aveuglant avec rémanence. L'image de l'instant est retenue (une seule image capturée, puis la capture est
    /// rendue : le jeu se voit ensuite directement) ; le blanc monte vite, tient (aveuglement), puis se retire en
    /// découvrant l'image fantôme imprimée par-dessus le jeu, qui se délave, se floute et s'efface plus lentement.
    /// Sécurité visuelle : une seule montée de luminance par flash, plafond d'intensité, délai minimal entre deux flashs
    /// (registre cooldown_ms) et refus en mode sûr (photosensitive).
    sealed class FlashEffect : Effect
    {
        readonly RetainedImage snap = new RetainedImage();
        readonly float[] u = new float[16];
        readonly float[] col = new float[4];

        public override bool NeedsCapture { get { return !snap.Ready; } }

        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var p = f.P;
            if (!snap.Ready && fb.HasCapture) fb.Retain(snap);
            double t = f.ElapsedMs / 1000.0;
            double rise = p.Num("rise_ms") / 1000, blind = p.Num("blind_ms") / 1000, rec = p.Num("recovery_ms") / 1000, ghostS = p.Num("ghost_ms") / 1000;
            double w = t < rise ? Fx.EaseOut(t / rise, 2) : t < rise + blind ? 1 : Math.Pow(1 - Fx.Clamp01((t - rise - blind) / rec), 2.2);
            // Rémanence : l'image figée tient presque opaque une part de sa durée (persistance), puis se dissout, zones
            // sombres d'abord ; elle se floute, se délave et dérive peu à peu (dégradation pendant le retour).
            double after = Fx.Clamp01((t - rise - blind) / ghostS);
            double hold = 0.08 + 0.5 * p.Num("persistence");
            double g = snap.Ready ? p.Num("ghost") * (1 - Fx.Smooth(hold, 1, after)) : 0;
            double pr = f.Presence;
            u[0] = (float)(w * p.Num("intensity") * pr); u[1] = (float)(g * pr);
            u[2] = (float)(1 + p.Num("blur") * 3 + 1.8 * after); u[3] = (float)(1 + 0.035 * p.Num("drift") * after);
            u[4] = (float)(p.Num("desat") * (0.35 + 0.65 * after)); u[5] = (float)Fx.Smooth(hold * 0.5, Math.Min(1, hold + 0.45), after);
            u[6] = (float)(0.55 * (1 - after)); u[7] = (float)(0.9 * (1 - 0.5 * after));
            var c = p.Color("tint");
            col[0] = c[0]; col[1] = c[1]; col[2] = c[2]; col[3] = 1;
            if (u[0] < 0.002 && u[1] < 0.002) return;
            fb.Overlay("flash", u, 1, snap.Ready ? snap.Srv : IntPtr.Zero, 1, col);
        }

        public override void Dispose() { snap.Release(); }
    }

    /// Brouillard dynamique (calque sans capture, rendu en résolution réduite : ses formes sont douces). Le shader « fog »
    /// fait les nappes ; ici, le temps : dérive du vent par nappe (parallaxe), évolution des déformations, arrivée par
    /// un front, densification, intermittence, dissipation en filaments. Le brouillard V1 (quelques ellipses fixes dont
    /// seule l'opacité changeait) donnait des « taches » : ici, aucune forme n'est fixe ni ne se répète.
    sealed class FogEffect : Effect
    {
        readonly float[] u = new float[32];
        readonly float[] col = new float[4];

        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var p = f.P;
            int seed = f.Seed;
            double t = f.ElapsedMs / 1000.0, dur = Math.Max(1, p.DurationMs / 1000.0), pr = f.Presence;
            double D = p.Num("density"), dissolve = 0, front = 1;
            switch (p.Str("mode"))
            {
                case "montee": D *= 0.15 + 0.85 * Fx.Smooth(0, dur * 0.8, t); break;
                case "intermittent": D *= 0.2 + 0.8 * Fx.Smooth(-0.25, 0.45, Fx.Noise(seed + 11, t / 6.5)); break;
                case "dissipation": dissolve = 0.8 * Fx.Smooth(dur * 0.25, dur, t); break;
            }
            if (f.Exiting) dissolve = Math.Max(dissolve, 1 - pr); else front = pr;
            double ang = p.Num("direction") * Math.PI / 180, sp = p.Num("speed") * 0.16;
            double wx = Math.Cos(ang) * sp, wy = Math.Sin(ang) * sp;
            double evo = 0.025 + 0.06 * p.Num("turbulence");
            u[0] = (float)D; u[1] = (float)p.Num("opacity"); u[2] = (float)p.Num("size"); u[3] = (float)p.Num("turbulence");
            u[4] = (float)p.Num("contrast"); u[5] = (float)p.Num("depth"); u[6] = (float)p.Num("ground"); u[7] = (float)p.Num("banks");
            u[8] = (float)front; u[9] = (float)dissolve; u[10] = (float)(Math.Cos(ang) + 1e-4); u[11] = (float)Math.Sin(ang);
            u[12] = (float)(-wx * t % 500); u[13] = (float)(-wy * t % 500); u[14] = (float)(-wx * 0.45 * t % 500); u[15] = (float)(-wy * 0.45 * t % 500);
            u[16] = (float)(evo * t % 500); u[17] = (float)(-evo * 0.7 * t % 500); u[18] = (float)(-evo * 0.6 * t % 500); u[19] = (float)(evo * 0.8 * t % 500);
            u[20] = (float)(Fx.Hash(seed, 1) * 100); u[21] = (float)(Fx.Hash(seed, 2) * 100); u[22] = (float)p.Num("relief"); u[23] = (float)p.Num("haze");
            // Masses : traversent l'écran avec le vent (environ 2,2 × la dérive des nappes proches) en se déformant.
            u[24] = (float)p.Num("masses"); u[25] = (float)p.Num("thickness");
            u[26] = (float)(-wx * 2.2 * t % 500); u[27] = (float)(-wy * 2.2 * t % 500);
            u[28] = (float)(evo * 0.6 * t % 500); u[29] = (float)(-evo * 0.45 * t % 500);
            var c = p.Color("color");
            col[0] = c[0]; col[1] = c[1]; col[2] = c[2]; col[3] = 1;
            double scale = p.Str("quality") == "haute" ? 0.75 : p.Str("quality") == "economie" ? 0.33 : 0.5;
            if (fb.LowQuality) scale = Math.Min(scale, 0.33);
            fb.Overlay("fog", u, scale, IntPtr.Zero, 1, col);
        }
    }
}
