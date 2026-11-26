// Outils de mouvement partagés par les effets : hasard reproductible (graine de l'activation), bruit continu, courbes,
// cadrage d'un zoom. Tout est déterministe pour une graine et un temps donnés : l'aperçu, les tests et l'écran rendent
// la même chose, et une variation « aléatoire » reste dans les bornes réglées.
using System;

namespace Raptoru.Chaos
{
    static class Fx
    {
        /// Valeur pseudo-aléatoire stable dans [0, 1) pour (graine, i, j) : même graine → mêmes tirages.
        public static double Hash(int seed, int i, int j = 0)
        {
            unchecked
            {
                uint h = (uint)seed * 0x9E3779B1u ^ (uint)i * 0x85EBCA77u ^ (uint)j * 0xC2B2AE3Du;
                h ^= h >> 15; h *= 0x2C1B3C6Du; h ^= h >> 12; h *= 0x297A2D39u; h ^= h >> 15;
                return (h & 0xFFFFFF) / 16777216.0;
            }
        }

        /// Tirage dans [a, b) (graine, i, j).
        public static double Range(int seed, int i, int j, double a, double b) { return a + (b - a) * Hash(seed, i, j); }

        /// Bruit de gradient 1D (Perlin, interpolation quintique) : continu, sans à-coup, dans [-1, 1], environ une
        /// oscillation par unité. Un tremblement le lit au temps × fréquence : jamais un tirage par image.
        public static double Noise(int seed, double x)
        {
            double fl = Math.Floor(x), f = x - fl;
            int i = (int)fl;
            double g0 = Hash(seed, i) * 2 - 1, g1 = Hash(seed, i + 1) * 2 - 1;
            double u = f * f * f * (f * (f * 6 - 15) + 10);
            double n0 = g0 * f, n1 = g1 * (f - 1);
            return Math.Max(-1, Math.Min(1, 2 * (n0 + u * (n1 - n0))));
        }

        public static double Clamp01(double x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
        public static double Lerp(double a, double b, double t) { return a + (b - a) * t; }
        public static double Smooth(double e0, double e1, double x) { double t = Clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
        public static double EaseOut(double t, double p = 3) { t = Clamp01(t); return 1 - Math.Pow(1 - t, p); }
        public static double EaseIn(double t, double p = 3) { t = Clamp01(t); return Math.Pow(t, p); }
        public static double EaseInOut(double t) { t = Clamp01(t); return (1 - Math.Cos(Math.PI * t)) / 2; }

        /// Cadrage d'un zoom (facteur ≥ 1) vers un point (fx, fy) normalisé : translation du shader « transform » et
        /// position du point à l'écran. recenter : 0 = le point reste où il est (zoom « sur place »), 1 = il vient au
        /// centre ; la fenêtre de lecture reste toujours dans l'image (jamais de bord découvert).
        public static void ZoomFrame(double zoom, double fx, double fy, double recenter, double ax,
            out double tx, out double ty, out double sx, out double sy)
        {
            zoom = Math.Max(1, zoom);
            double half = 0.5 / zoom;
            double cx = Lerp(fx + (0.5 - fx) / zoom, fx, recenter), cy = Lerp(fy + (0.5 - fy) / zoom, fy, recenter);
            cx = Math.Max(half, Math.Min(1 - half, cx)); cy = Math.Max(half, Math.Min(1 - half, cy));
            tx = -(cx - 0.5) * ax * zoom; ty = -(cy - 0.5) * zoom;
            sx = (fx - cx) * zoom + 0.5; sy = (fy - cy) * zoom + 0.5;
        }

        /// Salve d'impulsions : n-ième impulsion à un instant tiré dans sa période ; chaque impulsion monte en attack
        /// (s), tient hold (s), retombe en release (s). Rend la force (0..1) de l'impulsion en cours au temps t.
        public static double Pulses(int seed, double t, double period, double attack, double hold, double release, double jitter, double startAt = 0)
        {
            if (t < startAt || period <= 0) return 0;
            double best = 0;
            int n = (int)Math.Floor((t - startAt) / period);
            for (int k = Math.Max(0, n - 1); k <= n; k++)
            {
                double start = startAt + k * period + Hash(seed, k, 11) * jitter * Math.Max(0, period - attack - hold - release);
                double amp = 1 - jitter * 0.45 * Hash(seed, k, 12);
                double u = t - start;
                if (u < 0) continue;
                double v = u < attack ? EaseOut(u / Math.Max(1e-3, attack), 2)
                    : u < attack + hold ? 1
                    : u < attack + hold + release ? 1 - EaseInOut((u - attack - hold) / Math.Max(1e-3, release)) : 0;
                best = Math.Max(best, v * amp);
            }
            return best;
        }
    }
}
