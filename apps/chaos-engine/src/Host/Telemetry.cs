// Télémétrie interne du moteur. Ce sont des mesures INTERNES (temps du lecteur, GPU par passe, cadences) : elles ne
// disent rien de la latence ressentie par le joueur, qui se mesure avec PresentMon (docs/chaos/PROCEDURE_TESTS.md).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

namespace Raptoru.Chaos
{
    sealed class Samples
    {
        readonly List<double> v = new List<double>();
        public int Count { get { return v.Count; } }
        public void Add(double x) { if (v.Count < 10000) v.Add(x); }
        public void Clear() { v.Clear(); }
        public double P(int pct)
        {
            if (v.Count == 0) return -1;
            var s = v.OrderBy(x => x).ToList();
            int i = pct >= 100 ? s.Count - 1 : Math.Max(0, (int)Math.Ceiling(pct / 100.0 * s.Count) - 1);
            return Math.Round(s[i], 3);
        }
    }

    /// Compteurs d'une surface sur l'intervalle en cours.
    sealed class SurfaceStats
    {
        public long CapFramesAt, DroppedAt, PresentedAt;
        public readonly Samples Processing = new Samples();
    }

    sealed class Telemetry
    {
        public readonly Dictionary<string, Samples> Passes = new Dictionary<string, Samples>();
        public readonly Dictionary<string, int> Errors = new Dictionary<string, int>();
        public long ReadyMs, GpuInitMs, ShaderWarmMs, LastAt, MaxLoopGapMs, LastLoopAt = -1;
        public double LastCpuMs;
        public bool Degraded;
        public string DegradedReason;
        public long DegradedSince = -1, HealthySince = -1;

        public void Pass(string label, double ms)
        {
            Samples s;
            if (!Passes.TryGetValue(label, out s)) Passes[label] = s = new Samples();
            s.Add(ms);
        }

        public void Error(string code) { int n; Errors.TryGetValue(code, out n); Errors[code] = n + 1; }

        public void Loop(long now)
        {
            if (LastLoopAt >= 0) MaxLoopGapMs = Math.Max(MaxLoopGapMs, now - LastLoopAt);
            LastLoopAt = now;
        }

        public Dictionary<string, object> PassView()
        {
            return Passes.Where(kv => kv.Value.Count > 0).ToDictionary(kv => kv.Key, kv => (object)J.Map("p50_ms", kv.Value.P(50), "max_ms", kv.Value.P(100), "count", kv.Value.Count));
        }

        /// Processus : CPU (% de la machine et ms par seconde), mémoire privée.
        public Dictionary<string, object> Process(long now)
        {
            var p = System.Diagnostics.Process.GetCurrentProcess();
            double cpu = p.TotalProcessorTime.TotalMilliseconds;
            double secs = Math.Max(0.001, (now - LastAt) / 1000.0);
            double perS = LastAt == 0 ? 0 : (cpu - LastCpuMs) / secs;
            LastCpuMs = cpu;
            return J.Map("cpu_ms_per_s", Math.Round(perS, 1), "cpu_pct", Math.Round(perS / 10.0 / Environment.ProcessorCount, 2),
                "private_mb", Math.Round(p.PrivateMemorySize64 / 1048576.0, 1));
        }

        public void ResetInterval(long now)
        {
            foreach (var s in Passes.Values) s.Clear();
            MaxLoopGapMs = 0;
            LastAt = now;
        }
    }
}
