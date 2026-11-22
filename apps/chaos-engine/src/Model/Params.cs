// Résolution d'une demande : défauts du registre → variante → préréglage → valeurs de la demande, puis validation
// stricte (type, bornes, paramètre non exposé) et plafonds de sécurité (durée, vitesse de rotation des transitions).
// Une valeur invalide est refusée, jamais corrigée en silence ; seules les durées de transition trop rapides sont
// rallongées, et l'ajustement est signalé.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace Raptoru.Chaos
{
    sealed class ParamError : Exception
    {
        public readonly string Code;
        public ParamError(string code, string message) : base(message) { Code = code; }
    }

    /// Un préréglage : valeurs de paramètres, durée et transitions (tout est facultatif).
    sealed class Preset
    {
        public Dictionary<string, object> Params = new Dictionary<string, object>();
        public int? DurationMs;
        public string InKind, OutKind;
        public int? InMs, OutMs;

        public Dictionary<string, object> ToJson()
        {
            var d = J.Map("params", J.Copy(Params));
            if (DurationMs.HasValue) d["duration_ms"] = DurationMs.Value;
            var tr = new Dictionary<string, object>();
            if (InKind != null || InMs.HasValue) tr["in"] = Side(InKind, InMs);
            if (OutKind != null || OutMs.HasValue) tr["out"] = Side(OutKind, OutMs);
            if (tr.Count > 0) d["transition"] = tr;
            return d;
        }
        static Dictionary<string, object> Side(string kind, int? ms)
        {
            var d = new Dictionary<string, object>();
            if (kind != null) d["kind"] = kind;
            if (ms.HasValue) d["duration_ms"] = ms.Value;
            return d;
        }
        public static Preset FromJson(Dictionary<string, object> o)
        {
            var p = new Preset();
            if (o == null) return p;
            p.Params = J.Copy(J.Obj(o, "params"));
            if (J.Has(o, "duration_ms")) p.DurationMs = (int)J.Num(o, "duration_ms", 0);
            var tr = J.Obj(o, "transition");
            var i = J.Obj(tr, "in"); var x = J.Obj(tr, "out");
            if (i != null) { p.InKind = J.Str(i, "kind", null); if (J.Has(i, "duration_ms")) p.InMs = (int)J.Num(i, "duration_ms", 0); }
            if (x != null) { p.OutKind = J.Str(x, "kind", null); if (J.Has(x, "duration_ms")) p.OutMs = (int)J.Num(x, "duration_ms", 0); }
            return p;
        }
    }

    /// Ce qu'un effet reçoit : des valeurs validées, typées, et ses transitions finales.
    sealed class ResolvedParams
    {
        public EffectDef Def;
        public readonly Dictionary<string, object> Values = new Dictionary<string, object>();
        public int DurationMs;
        public TransitionPlan In, Out;
        public readonly List<string> Adjusted = new List<string>();

        public double Num(string id) { return Convert.ToDouble(Values[id], CultureInfo.InvariantCulture); }
        public string Str(string id) { return Convert.ToString(Values[id], CultureInfo.InvariantCulture); }
        public bool Bool(string id) { return (bool)Values[id]; }
        public float[] Color(string id) { return Params.ParseColor(Str(id)); }

        public Dictionary<string, object> ToJson()
        {
            return J.Map("params", J.Copy(Values), "duration_ms", DurationMs,
                "transition", J.Map("in", J.Map("kind", In.Kind, "duration_ms", In.DurationMs, "curve", In.Curve),
                                    "out", J.Map("kind", Out.Kind, "duration_ms", Out.DurationMs, "curve", Out.Curve)),
                "adjusted", Adjusted.ToArray());
        }
    }

    static class Params
    {
        static readonly Regex ColorRe = new Regex("^#[0-9a-fA-F]{6}$");
        public static bool IsColor(string s) { return s != null && ColorRe.IsMatch(s); }
        public static float[] ParseColor(string s)
        {
            int v = int.Parse(s.Substring(1), NumberStyles.HexNumber);
            return new[] { ((v >> 16) & 255) / 255f, ((v >> 8) & 255) / 255f, (v & 255) / 255f };
        }

        /// Valide une valeur pour un paramètre ; rend la valeur typée (double, string, bool).
        public static object Check(ParamDef p, object v)
        {
            switch (p.Type)
            {
                case ParamType.Number:
                    double d;
                    if (!J.IsNumber(v, out d)) throw new ParamError("invalid_param", p.Id + " : nombre attendu");
                    if (d < p.Min || d > p.Max) throw new ParamError("param_out_of_range", p.Id + " : hors bornes [" + p.Min.ToString(CultureInfo.InvariantCulture) + ", " + p.Max.ToString(CultureInfo.InvariantCulture) + "]");
                    return d;
                case ParamType.Enum:
                    string e = v as string;
                    if (e == null || !p.Values.Contains(e)) throw new ParamError("invalid_param", p.Id + " : valeur attendue parmi " + string.Join(", ", p.Values));
                    return e;
                case ParamType.Bool:
                    if (!(v is bool)) throw new ParamError("invalid_param", p.Id + " : booléen attendu");
                    return v;
                case ParamType.Color:
                    string c = v as string;
                    if (!IsColor(c)) throw new ParamError("invalid_param", p.Id + " : couleur #rrggbb attendue");
                    return c.ToLowerInvariant();
                default:
                    string s = v as string;
                    if (s == null) throw new ParamError("invalid_param", p.Id + " : texte attendu");
                    s = new string(s.Where(ch => !char.IsControl(ch)).ToArray());
                    if (s.Length > p.MaxLength) throw new ParamError("param_out_of_range", p.Id + " : " + p.MaxLength + " caractères au plus");
                    return s;
            }
        }

        /// Valide un préréglage (enregistrement depuis Studio) : mêmes règles qu'une demande.
        public static void CheckPreset(EffectDef def, Preset p, EngineLimits lim, SafetyConfig safety)
        {
            Resolve(def, null, p, null, null, null, lim, safety, true);
        }

        public static ResolvedParams Resolve(EffectDef def, string variant, Preset preset, Dictionary<string, object> overrides,
            int? durationMs, Dictionary<string, object> transition, EngineLimits lim, SafetyConfig safety, bool trusted)
        {
            var r = new ResolvedParams { Def = def };
            foreach (var p in def.Params) r.Values[p.Id] = p.Default;
            if (!string.IsNullOrEmpty(variant))
            {
                Dictionary<string, object> vp;
                if (!def.Variants.TryGetValue(variant, out vp)) throw new ParamError("unknown_variant", "variante inconnue : " + variant);
                Apply(def, r, vp, true);
            }
            if (preset != null) Apply(def, r, preset.Params, true);
            if (overrides != null) Apply(def, r, overrides, trusted);

            int maxDuration = Math.Min(lim.MaxDurationMs, safety.MaxDurationMs);
            int dur = durationMs ?? (preset != null && preset.DurationMs.HasValue ? preset.DurationMs.Value : def.DefaultDurationMs);
            if (dur < lim.MinDurationMs || dur > maxDuration)
                throw new ParamError("duration_out_of_range", "durée hors bornes [" + lim.MinDurationMs + ", " + maxDuration + "] ms");
            r.DurationMs = dur;

            r.In = Plan(def, def.In, preset != null ? preset.InKind : null, preset != null ? preset.InMs : null, J.Obj(transition, "in"), lim, safety);
            r.Out = Plan(def, def.Out, preset != null ? preset.OutKind : null, preset != null ? preset.OutMs : null, J.Obj(transition, "out"), lim, safety);
            ClampRotationSpeed(r, r.In, "transition.in.duration_ms", lim);
            ClampRotationSpeed(r, r.Out, "transition.out.duration_ms", lim);
            return r;
        }

        static void Apply(EffectDef def, ResolvedParams r, Dictionary<string, object> values, bool trusted)
        {
            if (values == null) return;
            foreach (var kv in values)
            {
                var p = def.Param(kv.Key);
                if (p == null) throw new ParamError("unknown_param", "paramètre inconnu : " + kv.Key);
                if (!trusted && !p.Exposed) throw new ParamError("param_not_overridable", kv.Key + " : réglé par les variantes seulement");
                r.Values[p.Id] = Check(p, kv.Value);
            }
        }

        static TransitionPlan Plan(EffectDef def, TransitionDef d, string presetKind, int? presetMs, Dictionary<string, object> req, EngineLimits lim, SafetyConfig safety)
        {
            var t = new TransitionPlan { Kind = d.Kind, Curve = d.Curve, DurationMs = d.DurationMs };
            if (presetKind != null) t.Kind = presetKind;
            if (presetMs.HasValue) t.DurationMs = presetMs.Value;
            if (req != null)
            {
                if (J.Has(req, "kind")) t.Kind = J.Str(req, "kind", t.Kind);
                if (J.Has(req, "duration_ms")) t.DurationMs = (int)J.Num(req, "duration_ms", -1);
            }
            if (!d.Kinds.Contains(t.Kind)) throw new ParamError("invalid_transition", "transition " + t.Kind + " non permise pour " + def.Id);
            if (t.DurationMs < 0 || t.DurationMs > lim.MaxTransitionMs) throw new ParamError("invalid_transition", "durée de transition hors bornes [0, " + lim.MaxTransitionMs + "] ms");
            if (safety.SafeMode && t.Kind == "ramp" && def.Params.Any(p => p.Animatable && p.Unit == "deg")) t.Kind = "cut"; // mode sûr : pas de rotation animée
            if (t.Kind == "cut") t.DurationMs = 0;
            return t;
        }

        /// Plafond de vitesse angulaire (registre : max_rotation_deg_per_s) : rallonge la transition au besoin.
        static void ClampRotationSpeed(ResolvedParams r, TransitionPlan t, string what, EngineLimits lim)
        {
            if (t.Instant) return;
            double deg = r.Def.Params.Where(p => p.Animatable && p.Unit == "deg")
                .Select(p => Math.Abs(Convert.ToDouble(r.Values[p.Id], CultureInfo.InvariantCulture) - Convert.ToDouble(p.Neutral, CultureInfo.InvariantCulture)))
                .DefaultIfEmpty(0).Max();
            if (deg <= 0) return;
            int min = (int)Math.Ceiling(deg * Curves.PeakSlope(t.Curve) / lim.MaxRotationDegPerS * 1000);
            if (t.DurationMs < min) { t.DurationMs = min; r.Adjusted.Add(what); }
        }
    }
}
