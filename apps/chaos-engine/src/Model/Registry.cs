// Registre des effets : lu depuis packages/schemas/src/chaos-registry.json (embarqué à la compilation).
// C'est la seule déclaration d'un effet (identité, famille, emplacement, paramètres, bornes, variantes, transitions,
// conditions d'arrêt). Le moteur, Studio (commande describe) et plus tard le Core lisent ce même fichier.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;

namespace Raptoru.Chaos
{
    enum ParamType { Number, Enum, Bool, Color, String }

    sealed class ParamDef
    {
        public string Id, Label, Help, Unit;
        public ParamType Type;
        public double Min = double.MinValue, Max = double.MaxValue;
        /// Plafond en mode sûr (registre safe_max) : mouvements trop agressifs bornés ; NaN = aucun.
        public double SafeMax = double.NaN;
        public object Default, Neutral;
        public bool Animatable, Exposed = true;
        public List<string> Values = new List<string>();
        public int MaxLength = 200;
    }

    sealed class TransitionDef
    {
        public string Kind = "cut", Curve = "linear";
        public int DurationMs;
        public List<string> Kinds = new List<string> { "cut" };
    }

    sealed class SlotDef
    {
        public string Id, Label;
        public int Order, MaxActive = 1;
        public bool RequiresCapture;
    }

    sealed class EffectDef
    {
        public string Id, Label, Description, Family, SlotId, OnConflict = "queue", Primitive;
        /// Transformation d'entrée liée (couche Entrées), appliquée quand la cible est un écran entier ; null = aucune.
        public string Input;
        public int Version, DefaultDurationMs = 10000;
        /// Passes GPU déclarées (registre gpu.passes) : refus à la demande si elles dépassent performance.max_passes.
        public int GpuPasses = 1;
        /// Curseur pendant l'effet : null = inchangé ; "follow" = le curseur visible suit l'image transformée (curseur
        /// matériel masqué au-dessus de la cible, image du vrai curseur dessinée au point transformé ; entrées intactes).
        public string Cursor;
        /// Capture propre à l'effet : null = celle de son emplacement ; "snapshot" = une image capturée au départ
        /// (flash : image retenue), puis la capture est rendue.
        public string CaptureMode;
        /// Ordre de la chaîne de rendu (défaut : celui de l'emplacement) : un tremblement passe après un zoom.
        public int Order;
        /// Délai minimal entre la fin d'une activation et le départ de la suivante, sur une même cible (0 = aucun).
        public int CooldownMs;
        /// Effet lumineux brusque (flash) : refusé en mode sûr.
        public bool Photosensitive;
        public bool Internal;
        public SlotDef Slot;
        public List<ParamDef> Params = new List<ParamDef>();
        /// Variantes (préréglages du registre) : paramètres, et facultativement durée et transitions.
        public Dictionary<string, Preset> Variants = new Dictionary<string, Preset>();
        /// Niveaux d'intensité (registre levels, dans l'ordre : Léger, Marqué, Extrême…) : valeurs des réglages
        /// principaux, appliquées par-dessus la variante (la variante dit le style, le niveau la force).
        public List<KeyValuePair<string, Preset>> Levels = new List<KeyValuePair<string, Preset>>();
        public Preset Level(string id) { foreach (var kv in Levels) if (kv.Key == id) return kv.Value; return null; }
        public TransitionDef In = new TransitionDef(), Out = new TransitionDef();
        public List<string> StopConditions = new List<string>();
        public Dictionary<string, object> Raw;
        public bool RequiresCapture { get { return Slot != null && Slot.RequiresCapture || CaptureMode == "snapshot"; } }
        /// Sans allocation (appelé à chaque image par les effets animés, comme le retournement).
        public ParamDef Param(string id) { foreach (var p in Params) if (p.Id == id) return p; return null; }
    }

    sealed class EngineLimits
    {
        public int MinDurationMs = 1000, MaxDurationMs = 60000, MaxActive = 8, MaxQueue = 16, QueueTtlMs = 180000, MaxTransitionMs = 3000;
        public double MaxRotationDegPerS = 520;
    }

    sealed class RegistryError : Exception { public RegistryError(string m) : base(m) { } }

    /// Identifiants de la couche Entrées connus de la logique pure (la couche elle-même est dans src/Input).
    static class InputLayerIds { public const string InvertXY = "invert_xy"; }

    sealed class Registry
    {
        public const string Schema = "raptoru.chaos.registry";
        public int Version;
        public EngineLimits Limits = new EngineLimits();
        public Dictionary<string, SlotDef> Slots = new Dictionary<string, SlotDef>();
        public Dictionary<string, string> Families = new Dictionary<string, string>();
        /// Transformations d'entrée connues (couche Entrées) : identifiant → libellé.
        public Dictionary<string, string> InputEffects = new Dictionary<string, string>();
        public Dictionary<string, EffectDef> Effects = new Dictionary<string, EffectDef>();
        public string Json;

        public EffectDef Get(string id) { EffectDef e; return id != null && Effects.TryGetValue(id, out e) ? e : null; }

        public static Registry Embedded()
        {
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("chaos-registry.json"))
            {
                if (s == null) throw new RegistryError("registre absent de l'exécutable");
                using (var r = new StreamReader(s, Encoding.UTF8)) return Parse(r.ReadToEnd());
            }
        }

        /// Lit et valide le registre ; toute incohérence est une erreur (le moteur refuse de démarrer).
        public static Registry Parse(string json)
        {
            var root = J.Parse(json);
            if (J.Str(root, "schema", "") != Schema) throw new RegistryError("schéma inattendu");
            var reg = new Registry { Version = (int)J.Num(root, "version", 0), Json = json };
            if (reg.Version < 1) throw new RegistryError("version manquante");
            var lim = J.Obj(root, "engine_limits");
            if (lim != null)
            {
                var l = reg.Limits;
                l.MinDurationMs = (int)J.Num(lim, "min_duration_ms", l.MinDurationMs);
                l.MaxDurationMs = (int)J.Num(lim, "max_duration_ms", l.MaxDurationMs);
                l.MaxActive = (int)J.Num(lim, "max_active_effects", l.MaxActive);
                l.MaxQueue = (int)J.Num(lim, "max_queue", l.MaxQueue);
                l.QueueTtlMs = (int)J.Num(lim, "queue_ttl_ms", l.QueueTtlMs);
                l.MaxRotationDegPerS = J.Num(lim, "max_rotation_deg_per_s", l.MaxRotationDegPerS);
                l.MaxTransitionMs = (int)J.Num(lim, "max_transition_ms", l.MaxTransitionMs);
                if (l.MinDurationMs < 100 || l.MaxDurationMs < l.MinDurationMs) throw new RegistryError("bornes de durée incohérentes");
            }
            var fam = J.Obj(root, "families") ?? new Dictionary<string, object>();
            foreach (var kv in fam) reg.Families[kv.Key] = J.Str(kv.Value as Dictionary<string, object>, "label", kv.Key);
            foreach (var kv in J.Obj(root, "input_effects") ?? new Dictionary<string, object>())
            {
                if (kv.Key != InputLayerIds.InvertXY) throw new RegistryError("transformation d'entrée inconnue du moteur : " + kv.Key);
                reg.InputEffects[kv.Key] = J.Str(kv.Value as Dictionary<string, object>, "label", kv.Key);
            }
            var slots = J.Obj(root, "slots") ?? new Dictionary<string, object>();
            foreach (var kv in slots)
            {
                var s = kv.Value as Dictionary<string, object>;
                reg.Slots[kv.Key] = new SlotDef
                {
                    Id = kv.Key, Label = J.Str(s, "label", kv.Key), Order = (int)J.Num(s, "order", 50),
                    MaxActive = Math.Max(1, (int)J.Num(s, "max_active", 1)), RequiresCapture = J.Bool(s, "requires_capture", false)
                };
            }
            foreach (var o in J.Arr(root, "effects"))
            {
                var e = ParseEffect(o as Dictionary<string, object>, reg);
                if (reg.Effects.ContainsKey(e.Id)) throw new RegistryError("effet en double : " + e.Id);
                reg.Effects[e.Id] = e;
            }
            if (reg.Effects.Count == 0) throw new RegistryError("aucun effet");
            return reg;
        }

        static EffectDef ParseEffect(Dictionary<string, object> o, Registry reg)
        {
            if (o == null) throw new RegistryError("effet illisible");
            var e = new EffectDef
            {
                Id = J.Str(o, "id", null), Version = (int)J.Num(o, "version", 0), Label = J.Str(o, "label", ""),
                Description = J.Str(o, "description", ""), Family = J.Str(o, "family", ""), SlotId = J.Str(o, "slot", ""),
                Internal = J.Bool(o, "internal", false), OnConflict = J.Str(o, "on_conflict", "queue"), Raw = o
            };
            string where = "effet " + (e.Id ?? "?") + " : ";
            if (string.IsNullOrEmpty(e.Id) || !System.Text.RegularExpressions.Regex.IsMatch(e.Id, "^[a-z][a-z0-9_.]{0,40}$")) throw new RegistryError(where + "identifiant invalide");
            if (e.Version < 1) throw new RegistryError(where + "version manquante");
            if (!reg.Families.ContainsKey(e.Family)) throw new RegistryError(where + "famille inconnue " + e.Family);
            if (!reg.Slots.TryGetValue(e.SlotId, out e.Slot)) throw new RegistryError(where + "emplacement inconnu " + e.SlotId);
            if (!new[] { "queue", "replace", "reject", "extend" }.Contains(e.OnConflict)) throw new RegistryError(where + "on_conflict invalide");
            e.Primitive = J.Str(J.Obj(o, "gpu"), "primitive", "");
            e.GpuPasses = (int)J.Num(J.Obj(o, "gpu"), "passes", 1);
            e.Order = (int)J.Num(o, "order", e.Slot.Order);
            e.CaptureMode = J.Str(o, "capture", null);
            if (e.CaptureMode != null && e.CaptureMode != "snapshot") throw new RegistryError(where + "capture inconnue " + e.CaptureMode + " (snapshot)");
            e.CooldownMs = (int)J.Num(o, "cooldown_ms", 0);
            if (e.CooldownMs < 0 || e.CooldownMs > 600000) throw new RegistryError(where + "cooldown_ms hors bornes");
            e.Photosensitive = J.Bool(o, "photosensitive", false);
            e.Cursor = J.Str(o, "cursor", null);
            if (e.Cursor != null && e.Cursor != "follow") throw new RegistryError(where + "cursor inconnu " + e.Cursor + " (follow)");
            if (e.Cursor != null && !e.RequiresCapture) throw new RegistryError(where + "cursor exige un effet qui transforme l'image capturée");
            e.Input = J.Str(o, "input", null);
            if (e.Input != null && !reg.InputEffects.ContainsKey(e.Input)) throw new RegistryError(where + "transformation d'entrée inconnue " + e.Input);
            e.DefaultDurationMs = (int)J.Num(J.Obj(o, "duration"), "default_ms", 10000);
            if (e.DefaultDurationMs < reg.Limits.MinDurationMs || e.DefaultDurationMs > reg.Limits.MaxDurationMs) throw new RegistryError(where + "durée par défaut hors bornes");
            foreach (var po in J.Arr(o, "params")) e.Params.Add(ParseParam(po as Dictionary<string, object>, where));
            if (e.Params.Select(p => p.Id).Distinct().Count() != e.Params.Count) throw new RegistryError(where + "paramètre en double");
            var tr = J.Obj(o, "transitions");
            e.In = ParseTransition(J.Obj(tr, "in"), where, reg);
            e.Out = ParseTransition(J.Obj(tr, "out"), where, reg);
            foreach (var vo in J.Arr(o, "variants"))
            {
                var v = vo as Dictionary<string, object>;
                string vid = J.Str(v, "id", "");
                if (string.IsNullOrEmpty(vid) || e.Variants.ContainsKey(vid)) throw new RegistryError(where + "variante sans identifiant ou en double : " + vid);
                var vp = Preset.FromJson(v);
                // Une variante obéit aux mêmes règles qu'une demande (bornes, durée, transitions) : vérifiée ici, une fois.
                try { Params.CheckPreset(e, vp, reg.Limits, new SafetyConfig { MaxDurationMs = reg.Limits.MaxDurationMs }); }
                catch (ParamError pe) { throw new RegistryError(where + "variante " + vid + " : " + pe.Message); }
                e.Variants[vid] = vp;
            }
            foreach (var lo in J.Arr(o, "levels"))
            {
                var l = lo as Dictionary<string, object>;
                string lid = J.Str(l, "id", "");
                if (string.IsNullOrEmpty(lid) || e.Level(lid) != null) throw new RegistryError(where + "niveau sans identifiant ou en double : " + lid);
                var lp = Preset.FromJson(l);
                if (lp.DurationMs.HasValue || lp.InKind != null || lp.OutKind != null) throw new RegistryError(where + "niveau " + lid + " : réglages seulement (ni durée, ni transition)");
                try { Params.CheckPreset(e, lp, reg.Limits, new SafetyConfig { MaxDurationMs = reg.Limits.MaxDurationMs }); }
                catch (ParamError pe) { throw new RegistryError(where + "niveau " + lid + " : " + pe.Message); }
                e.Levels.Add(new KeyValuePair<string, Preset>(lid, lp));
            }
            e.StopConditions = J.Strs(o, "stop_conditions");
            if (!e.StopConditions.Contains("stop_all")) throw new RegistryError(where + "stop_all doit toujours arrêter l'effet");
            return e;
        }

        static ParamDef ParseParam(Dictionary<string, object> o, string where)
        {
            var p = new ParamDef
            {
                Id = J.Str(o, "id", null), Label = J.Str(o, "label", null), Help = J.Str(o, "help", null), Unit = J.Str(o, "unit", null),
                Animatable = J.Bool(o, "animatable", false), Exposed = J.Bool(o, "exposed", true)
            };
            if (string.IsNullOrEmpty(p.Id)) throw new RegistryError(where + "paramètre sans identifiant");
            string t = J.Str(o, "type", "");
            switch (t)
            {
                case "number":
                    p.Type = ParamType.Number;
                    p.Min = J.Num(o, "min", double.NaN); p.Max = J.Num(o, "max", double.NaN);
                    if (double.IsNaN(p.Min) || double.IsNaN(p.Max) || p.Min > p.Max) throw new RegistryError(where + p.Id + " : bornes manquantes");
                    p.Default = J.Num(o, "default", double.NaN);
                    if ((double)p.Default < p.Min || (double)p.Default > p.Max) throw new RegistryError(where + p.Id + " : défaut hors bornes");
                    p.SafeMax = J.Num(o, "safe_max", double.NaN);
                    if (!double.IsNaN(p.SafeMax) && (p.SafeMax < p.Min || p.SafeMax > p.Max)) throw new RegistryError(where + p.Id + " : safe_max hors bornes");
                    if (p.Animatable)
                    {
                        p.Neutral = J.Num(o, "neutral", double.NaN);
                        if (double.IsNaN((double)p.Neutral)) throw new RegistryError(where + p.Id + " : animable sans valeur neutre");
                    }
                    break;
                case "enum":
                    p.Type = ParamType.Enum; p.Values = J.Strs(o, "values"); p.Default = J.Str(o, "default", null);
                    if (p.Values.Count == 0 || !p.Values.Contains((string)p.Default)) throw new RegistryError(where + p.Id + " : énumération invalide");
                    break;
                case "bool": p.Type = ParamType.Bool; p.Default = J.Bool(o, "default", false); break;
                case "color":
                    p.Type = ParamType.Color; p.Default = J.Str(o, "default", "#ffffff");
                    if (!Params.IsColor((string)p.Default)) throw new RegistryError(where + p.Id + " : couleur par défaut invalide");
                    break;
                case "string":
                    p.Type = ParamType.String; p.Default = J.Str(o, "default", ""); p.MaxLength = (int)J.Num(o, "max_length", 200);
                    break;
                default: throw new RegistryError(where + p.Id + " : type inconnu " + t);
            }
            if (p.Animatable && p.Type != ParamType.Number) throw new RegistryError(where + p.Id + " : seul un nombre est animable");
            return p;
        }

        static TransitionDef ParseTransition(Dictionary<string, object> o, string where, Registry reg)
        {
            var t = new TransitionDef();
            if (o == null) return t;
            t.Kind = J.Str(o, "kind", "cut"); t.Curve = J.Str(o, "curve", "linear"); t.DurationMs = (int)J.Num(o, "duration_ms", 0);
            t.Kinds = J.Strs(o, "kinds");
            if (t.Kinds.Count == 0) t.Kinds.Add(t.Kind);
            if (!t.Kinds.Contains(t.Kind)) throw new RegistryError(where + "transition " + t.Kind + " absente de ses propres choix");
            foreach (var k in t.Kinds) if (k != "cut" && k != "ramp") throw new RegistryError(where + "transition inconnue " + k);
            if (!Curves.Known(t.Curve)) throw new RegistryError(where + "courbe inconnue " + t.Curve);
            if (t.DurationMs < 0 || t.DurationMs > reg.Limits.MaxTransitionMs) throw new RegistryError(where + "durée de transition hors bornes");
            return t;
        }
    }
}
