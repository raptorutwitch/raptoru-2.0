// Effets sur l'image capturée (emplacement filter, jusqu'à 3 à la fois) : flou, pixelisation, filtres de couleur,
// VHS / glitch. Une passe chacun ; le flou, la pixelisation et la VHS lisent les mipmaps de leur entrée (générés une
// fois par image, seulement si l'un d'eux le demande). Recherche et choix : docs/chaos/ETUDE_EFFETS_V2.md.
using System;

namespace Raptoru.Chaos
{
    /// Flou progressif : niveau de flou continu (0 = net → 9 ≈ image entièrement fondue), même coût quel que soit le
    /// rayon. Le réglage « intensité » (0..100) est un niveau de 1080p, corrigé pour la résolution réelle : le même
    /// réglage floute autant sur un écran 1440p que 1080p.
    sealed class BlurEffect : Effect
    {
        readonly float[] u = new float[16];

        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var p = f.P;
            double t = f.ElapsedMs / 1000.0, dur = Math.Max(1, p.DurationMs / 1000.0), period = Math.Max(0.3, p.Num("period_ms") / 1000.0);
            double res = Math.Log(fb.Height / 1080.0, 2);
            double L = p.Num("amount") / 100 * 8 + res, Lmin = p.Num("minimum") / 100 * 8 + res;
            double lod;
            switch (p.Str("mode"))
            {
                case "pulsation": lod = Fx.Lerp(Lmin, L, 0.5 - 0.5 * Math.Cos(2 * Math.PI * t / period)); break;
                case "vague": lod = Fx.Lerp(Lmin, L, Fx.Smooth(-0.6, 0.6, Fx.Noise(f.Seed, t / period))); break;
                case "progressif": lod = L * Fx.Smooth(0, dur, t); break;
                default: lod = L; break;
            }
            lod = Math.Max(0, lod) * f.Presence;
            if (lod < 0.01) return;
            u[0] = (float)Math.Min(9.5, lod);
            fb.Filter("blur", u, true);
        }
    }

    /// Pixelisation : blocs carrés (taille de référence en 1080p), couleur moyenne du bloc, tailles entières (pas de
    /// flou entre deux tailles) qui grandissent de façon géométrique depuis le centre ; grille et palette réduite
    /// facultatives. Modes : constante, progressive (les blocs grossissent pendant tout l'effet), intermittente.
    sealed class PixelateEffect : Effect
    {
        readonly float[] u = new float[16];

        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var p = f.P;
            double t = f.ElapsedMs / 1000.0, dur = Math.Max(1, p.DurationMs / 1000.0);
            double B = Math.Max(1, p.Num("block") * fb.Height / 1080.0), e;
            switch (p.Str("mode"))
            {
                case "progressif": e = Fx.Smooth(0, dur * 0.9, t); break;
                case "intermittent": e = Fx.Pulses(f.Seed, t, Math.Max(0.4, p.Num("interval_ms") / 1000.0), 0.04, 0.35, 0.06, 1); break;
                default: e = 1; break;
            }
            double b = Math.Round(Math.Exp(Math.Log(B) * e * f.Presence));
            if (b < 1.5) return;
            u[0] = (float)b; u[1] = (float)p.Num("grid"); u[2] = (float)p.Num("palette");
            fb.Filter("pixelate", u, true);
        }
    }

    /// Filtres de couleur, coût minimal (une passe, une lecture) : noir et blanc fidèle (luminance en lumière linéaire),
    /// sépia, inversion, désaturation partielle, sursaturation, monochrome teinté ; contraste réglable. La force est
    /// animée par les transitions (fondu d'entrée et de sortie).
    sealed class ColorEffect : Effect
    {
        readonly float[] u = new float[16];

        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var p = f.P;
            string m = p.Str("mode");
            int mode = m == "sepia" ? 1 : m == "inversion" ? 2 : m == "desature" || m == "sature" ? 3 : m == "teinte" ? 4 : 0;
            double amount = f.Animated("amount");
            if (amount < 0.002) return;
            var c = p.Color("tint");
            u[0] = mode; u[1] = (float)amount; u[2] = (float)p.Num("contrast"); u[3] = (float)p.Num("saturation");
            u[4] = c[0]; u[5] = c[1]; u[6] = c[2];
            fb.Filter("color", u);
        }
    }

    /// VHS / glitch : bande VHS (tracking qui roule, gigue de ligne, commutation des têtes, chroma qui bave, grain,
    /// pertes de bande, noirs relevés) et glitchs en rafales courtes. Les événements (rafales, glissements verticaux)
    /// sont tirés de la graine : imprévisibles d'un déclenchement à l'autre, mais à la fréquence et à la force réglées.
    sealed class VhsEffect : Effect
    {
        readonly float[] u = new float[16];

        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var p = f.P;
            int seed = f.Seed;
            double t = f.ElapsedMs / 1000.0, pr = f.Presence;
            double roll = p.Num("roll"), rate = p.Num("glitch_rate");
            double band = (0.15 + t * 0.06 * (0.3 + roll) + Fx.Hash(seed, 1)) % 1.0 * 1.3 - 0.15;
            double slip = roll * 0.05 * Fx.Pulses(seed + 9, t, Fx.Lerp(7, 2.5, roll), 0.02, 0.1, 0.18, 1);
            double g = p.Num("glitch") * Fx.Pulses(seed + 3, t, Fx.Lerp(5, 0.9, rate), 0.01, Fx.Range(seed, (int)(t / 0.9), 4, 0.06, 0.22), 0.05, 1);
            u[0] = (float)(p.Num("intensity") * pr);
            u[1] = (float)(p.Num("tracking") * pr * (0.6 + 0.4 * Fx.Noise(seed + 2, t * 0.5)));
            u[2] = (float)(p.Num("jitter") * pr); u[3] = (float)(p.Num("noise") * pr);
            u[4] = (float)(g * pr); u[5] = (float)(Math.Floor(t * 24) % 97); u[6] = (float)p.Num("chroma"); u[7] = (float)(slip * pr);
            u[8] = (float)band; u[9] = (float)(0.05 + 0.07 * p.Num("tracking")); u[10] = (float)(t % 600); u[11] = (float)(p.Num("dropouts") * pr);
            u[12] = (float)(p.Num("fade") * pr);
            fb.Filter("vhs", u, true);
        }
    }
}
