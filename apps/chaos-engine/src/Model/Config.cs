// Configuration du moteur, séparée en sections qui ne se mélangent pas :
//   1. paramètres intrinsèques d'un effet → le registre (jamais ici) ;
//   2. préréglages utilisateur          → presets.<effet>.<nom> (« default » = valeurs utilisées sans préréglage nommé) ;
//   3. réglages globaux du moteur       → engine ;
//   4. limites de sécurité              → safety (toujours dans les bornes absolues du registre) ;
//   5. réglages commerciaux (prix, délais d'achat, remboursements) → AUCUN : ils appartiennent au Core.
// Fichier versionné (schema + version), migré à la lecture (sauvegarde de l'ancien), écrit de façon atomique.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace Raptoru.Chaos
{
    sealed class SafetyConfig
    {
        public int MaxDurationMs = 30000, MaxActiveEffects = 4;
        public bool SafeMode;
    }

    sealed class EngineSettings
    {
        public bool FollowForeground = true;
        public string DefaultMode = "window";
        public int CaptureLingerMs = 2000, TelemetryIntervalMs = 1000;
        public string Quality = "auto"; // auto : repli de qualité si le lecteur ralentit ; high : jamais de repli
    }

    sealed class ConfigError : Exception
    {
        public readonly string Code;
        public ConfigError(string code, string message) : base(message) { Code = code; }
    }

    sealed class ConfigStore
    {
        public const string Schema = "raptoru.chaos.config";
        public const int CurrentVersion = 2;
        readonly Registry reg;
        readonly string path;
        public EngineSettings Engine = new EngineSettings();
        public SafetyConfig Safety = new SafetyConfig();
        public Dictionary<string, Dictionary<string, Preset>> Presets = new Dictionary<string, Dictionary<string, Preset>>();
        public readonly List<string> LoadNotes = new List<string>();

        public ConfigStore(Registry reg, string path) { this.reg = reg; this.path = path; }

        public static string DefaultPath()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Raptoru", "Chaos", "config.json");
        }

        public Preset GetPreset(string effect, string name)
        {
            Dictionary<string, Preset> m; Preset p;
            return Presets.TryGetValue(effect, out m) && m.TryGetValue(name, out p) ? p : null;
        }

        // ---------- Lecture, migration, validation ----------
        public void Load()
        {
            if (path == null || !File.Exists(path)) { LoadNotes.Add("défauts (aucun fichier)"); return; }
            Dictionary<string, object> root;
            try { root = J.Parse(File.ReadAllText(path, Encoding.UTF8)); }
            catch (Exception e)
            {
                // Fichier illisible : on garde une copie et on repart des défauts (jamais de blocage du moteur).
                string bad = path + ".illisible-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
                try { File.Copy(path, bad, true); } catch (Exception) { }
                LoadNotes.Add("fichier illisible (" + e.Message + ") : défauts, copie " + Path.GetFileName(bad));
                return;
            }
            int version = (int)J.Num(root, "version", 1);
            if (version > CurrentVersion) throw new ConfigError("config_too_new", "configuration v" + version + " plus récente que le moteur (v" + CurrentVersion + ")");
            if (version < CurrentVersion)
            {
                try { File.Copy(path, path + ".v" + version + ".bak", true); } catch (Exception) { }
                root = Migrate(root, version);
                LoadNotes.Add("migrée de v" + version + " vers v" + CurrentVersion);
            }
            Apply(root, LoadNotes);
        }

        /// Migrations successives. v1 = premier format interne (plat : follow_foreground, safe_mode, max_duration_ms).
        public static Dictionary<string, object> Migrate(Dictionary<string, object> root, int from)
        {
            if (from <= 1)
            {
                root = J.Map(
                    "schema", Schema, "version", 2,
                    "engine", J.Map("follow_foreground", J.Bool(root, "follow_foreground", true)),
                    "safety", J.Map("safe_mode", J.Bool(root, "safe_mode", false), "max_duration_ms", J.Num(root, "max_duration_ms", 30000)),
                    "presets", new Dictionary<string, object>());
            }
            return root;
        }

        /// Applique un document ; une valeur invalide est ignorée et signalée (le reste du fichier reste valable).
        void Apply(Dictionary<string, object> root, List<string> notes)
        {
            var e = J.Obj(root, "engine");
            if (e != null) TrySet(notes, "engine", () => SetEngine(e));
            var s = J.Obj(root, "safety");
            if (s != null) TrySet(notes, "safety", () => SetSafety(s));
            var p = J.Obj(root, "presets");
            if (p != null)
                foreach (var eff in p)
                    foreach (var named in (eff.Value as Dictionary<string, object>) ?? new Dictionary<string, object>())
                    {
                        string effId = eff.Key, name = named.Key; var val = named.Value as Dictionary<string, object>;
                        TrySet(notes, "presets." + effId + "." + name, () => SetPreset(effId, name, val));
                    }
        }

        static void TrySet(List<string> notes, string what, Action a)
        {
            try { a(); } catch (Exception ex) { notes.Add(what + " ignoré : " + ex.Message); }
        }

        // ---------- Modifications (commandes config.*), toutes validées ----------
        public void SetEngine(Dictionary<string, object> v)
        {
            var n = new EngineSettings
            {
                FollowForeground = J.Bool(v, "follow_foreground", Engine.FollowForeground),
                DefaultMode = J.Str(v, "default_mode", Engine.DefaultMode),
                CaptureLingerMs = (int)J.Num(v, "capture_linger_ms", Engine.CaptureLingerMs),
                TelemetryIntervalMs = (int)J.Num(v, "telemetry_interval_ms", Engine.TelemetryIntervalMs),
                Quality = J.Str(v, "quality", Engine.Quality)
            };
            if (n.DefaultMode != "window" && n.DefaultMode != "monitor") throw new ConfigError("invalid_config", "default_mode : window ou monitor");
            if (n.CaptureLingerMs < 0 || n.CaptureLingerMs > 30000) throw new ConfigError("invalid_config", "capture_linger_ms : 0 à 30 000");
            if (n.TelemetryIntervalMs < 250 || n.TelemetryIntervalMs > 10000) throw new ConfigError("invalid_config", "telemetry_interval_ms : 250 à 10 000");
            if (n.Quality != "auto" && n.Quality != "high") throw new ConfigError("invalid_config", "quality : auto ou high");
            Engine = n;
        }

        public void SetSafety(Dictionary<string, object> v)
        {
            var n = new SafetyConfig
            {
                MaxDurationMs = (int)J.Num(v, "max_duration_ms", Safety.MaxDurationMs),
                MaxActiveEffects = (int)J.Num(v, "max_active_effects", Safety.MaxActiveEffects),
                SafeMode = J.Bool(v, "safe_mode", Safety.SafeMode)
            };
            if (n.MaxDurationMs < reg.Limits.MinDurationMs || n.MaxDurationMs > reg.Limits.MaxDurationMs)
                throw new ConfigError("invalid_config", "max_duration_ms : " + reg.Limits.MinDurationMs + " à " + reg.Limits.MaxDurationMs);
            if (n.MaxActiveEffects < 1 || n.MaxActiveEffects > reg.Limits.MaxActive)
                throw new ConfigError("invalid_config", "max_active_effects : 1 à " + reg.Limits.MaxActive);
            Safety = n;
        }

        public void SetPreset(string effect, string name, Dictionary<string, object> value)
        {
            var def = reg.Get(effect);
            if (def == null) throw new ConfigError("unknown_effect", "effet inconnu : " + effect);
            if (string.IsNullOrEmpty(name) || name.Length > 40) throw new ConfigError("invalid_config", "nom de préréglage invalide");
            var p = Preset.FromJson(value);
            try { Params.CheckPreset(def, p, reg.Limits, Safety); }
            catch (ParamError e) { throw new ConfigError(e.Code, e.Message); }
            Dictionary<string, Preset> m;
            if (!Presets.TryGetValue(effect, out m)) Presets[effect] = m = new Dictionary<string, Preset>();
            m[name] = p;
        }

        public bool DeletePreset(string effect, string name)
        {
            Dictionary<string, Preset> m;
            return Presets.TryGetValue(effect, out m) && m.Remove(name);
        }

        public void Reset(string section)
        {
            if (section == null || section == "engine") Engine = new EngineSettings();
            if (section == null || section == "safety") Safety = new SafetyConfig();
            if (section == null || section == "presets") Presets.Clear();
            if (section != null && section != "engine" && section != "safety" && section != "presets") throw new ConfigError("invalid_config", "section inconnue : " + section);
        }

        public Dictionary<string, object> ToJson()
        {
            var presets = new Dictionary<string, object>();
            foreach (var eff in Presets) presets[eff.Key] = eff.Value.ToDictionary(kv => kv.Key, kv => (object)kv.Value.ToJson());
            return J.Map("schema", Schema, "version", CurrentVersion,
                "engine", J.Map("follow_foreground", Engine.FollowForeground, "default_mode", Engine.DefaultMode, "capture_linger_ms", Engine.CaptureLingerMs,
                                "telemetry_interval_ms", Engine.TelemetryIntervalMs, "quality", Engine.Quality),
                "safety", J.Map("max_duration_ms", Safety.MaxDurationMs, "max_active_effects", Safety.MaxActiveEffects, "safe_mode", Safety.SafeMode),
                "presets", presets);
        }

        /// Écriture atomique : fichier temporaire puis remplacement (jamais de fichier à moitié écrit).
        public void Save()
        {
            if (path == null) return;
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, J.Write(ToJson()), new UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(tmp, path, null); else File.Move(tmp, path);
        }
    }
}
