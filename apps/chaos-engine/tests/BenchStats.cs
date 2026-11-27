// Statistiques du banc de comparaison (logique pure, testée par chaos-unit) : cadence d'un jeu (instants de ses images,
// en ticks QPC) découpée en phases, et lecture d'un relevé PresentMon.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Raptoru.Chaos
{
    sealed class PhaseStats
    {
        public string Name;
        public int Frames, Hitches;
        public double Fps, MedianMs, P99Ms, MaxMs, WorstWindowFps;

        public Dictionary<string, object> ToJson()
        {
            return J.Map("phase", Name, "frames", Frames, "fps", Math.Round(Fps, 1), "median_ms", Math.Round(MedianMs, 2), "p99_ms", Math.Round(P99Ms, 2),
                "max_ms", Math.Round(MaxMs, 1), "hitches", Hitches, "worst_250ms_fps", Math.Round(WorstWindowFps, 1));
        }
    }

    static class BenchStats
    {
        public const double WindowSec = 0.25;

        public static double Percentile(IList<double> sorted, double p)
        {
            if (sorted.Count == 0) return -1;
            int i = (int)Math.Ceiling(p / 100.0 * sorted.Count) - 1;
            return sorted[Math.Max(0, Math.Min(sorted.Count - 1, i))];
        }

        /// Phase [from, to[ : images, cadence, durée médiane / p99 / max d'une image, à-coups (image plus longue que
        /// 3 × la médiane de référence et que 20 ms) et pire cadence sur une fenêtre glissante de 250 ms.
        public static PhaseStats Summarize(string name, IList<long> frames, long freq, long from, long to, double refMedianMs)
        {
            var iv = new List<double>();
            var inPhase = new List<long>();
            for (int i = 0; i < frames.Count; i++)
            {
                if (frames[i] < from || frames[i] >= to) continue;
                inPhase.Add(frames[i]);
                if (i > 0) iv.Add((frames[i] - frames[i - 1]) * 1000.0 / freq);
            }
            var sorted = iv.OrderBy(x => x).ToList();
            double secs = Math.Max(1e-9, (to - from) / (double)freq);
            double limit = Math.Max(20, 3 * (refMedianMs > 0 ? refMedianMs : Percentile(sorted, 50)));
            long win = (long)(WindowSec * freq), step = Math.Max(1, freq / 20);
            double worst = -1;
            if (to - from >= win)
            {
                int lo = 0, hi = 0;
                for (long start = from; start + win <= to; start += step)
                {
                    while (lo < inPhase.Count && inPhase[lo] < start) lo++;
                    if (hi < lo) hi = lo;
                    while (hi < inPhase.Count && inPhase[hi] < start + win) hi++;
                    double fps = (hi - lo) / WindowSec;
                    if (worst < 0 || fps < worst) worst = fps;
                }
            }
            return new PhaseStats
            {
                Name = name, Frames = inPhase.Count, Fps = inPhase.Count / secs, MedianMs = Percentile(sorted, 50), P99Ms = Percentile(sorted, 99),
                MaxMs = sorted.Count > 0 ? sorted[sorted.Count - 1] : -1, Hitches = iv.Count(x => x > limit), WorstWindowFps = worst
            };
        }

        /// Relevé CSV de PresentMon (versions 1 et 2) pour un processus : instant de chaque image (ticks QPC si le relevé
        /// a été pris avec --qpc_time, sinon secondes depuis le début du relevé) et mode de présentation.
        public sealed class PresentRow { public double Time; public string Mode; }

        public static List<PresentRow> ParsePresentMon(string csv, string process, out bool timeIsQpc)
        {
            timeIsQpc = false;
            var rows = new List<PresentRow>();
            var lines = csv.Replace("\r", "").Split('\n').Where(l => l.Length > 0).ToList();
            if (lines.Count == 0) return rows;
            var head = lines[0].Split(',').Select(x => x.Trim()).ToList();
            Func<string[], int> col = names => names.Select(n => head.FindIndex(h => string.Equals(h, n, StringComparison.OrdinalIgnoreCase))).Where(i => i >= 0).DefaultIfEmpty(-1).First();
            int app = col(new[] { "Application" }), mode = col(new[] { "PresentMode" });
            int qpc = head.FindIndex(h => string.Equals(h, "CPUStartQPC", StringComparison.OrdinalIgnoreCase));
            int ms = head.FindIndex(h => string.Equals(h, "CPUStartTime", StringComparison.OrdinalIgnoreCase));
            int sec = head.FindIndex(h => string.Equals(h, "TimeInSeconds", StringComparison.OrdinalIgnoreCase));
            timeIsQpc = qpc >= 0;
            int t = qpc >= 0 ? qpc : ms >= 0 ? ms : sec;
            if (t < 0) return rows;
            double scale = qpc >= 0 ? 1 : ms >= 0 ? 0.001 : 1;
            foreach (var line in lines.Skip(1))
            {
                var c = line.Split(',');
                if (c.Length <= t) continue;
                if (process != null && app >= 0 && app < c.Length && !string.Equals(c[app], process, StringComparison.OrdinalIgnoreCase)) continue;
                double v;
                if (!double.TryParse(c[t], NumberStyles.Float, CultureInfo.InvariantCulture, out v)) continue;
                rows.Add(new PresentRow { Time = v * scale, Mode = mode >= 0 && mode < c.Length ? c[mode] : null });
            }
            return rows;
        }
    }
}
