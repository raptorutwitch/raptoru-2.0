// Configuration du moteur, séparée en sections qui ne se mélangent pas :
//   1. paramètres intrinsèques d'un effet → le registre (jamais ici) ;
//   2. préréglages utilisateur          → presets.<effet>.<nom> (« default » = valeurs utilisées sans préréglage nommé) ;
//   3. réglages globaux du moteur       → engine ;
//   4. limites de sécurité              → safety (toujours dans les bornes absolues du registre) ;
//   5. performances                     → performance (profil + réglages explicites, docs/chaos/PERFORMANCES_MOTEUR.md) ;
//   6. réglages commerciaux (prix, délais d'achat, remboursements) → AUCUN : ils appartiennent au Core.
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
        /// Cible d'une demande « premier plan » : window = la fenêtre du jeu (calque, vu par la capture d'écran d'OBS),
        /// monitor = l'écran entier.
        public string DefaultMode = "window";
        /// Couche Entrées (EXPÉRIMENTAL, docs/chaos/COUCHE_ENTREES.md) : sur un écran entier, Windows retourne
        /// l'affichage (vrai curseur, souris inversée). Coupée par défaut depuis l'incident du 22/11 : chaque bascule
        /// d'orientation reconfigure l'affichage de tout le PC (Overwatch à 17 images/s sur l'autre écran).
        public bool InputEffects;
        /// Curseur retourné avec l'image (effets du registre avec "cursor": "follow", ex. flip) : un seul curseur visible,
        /// aligné avec ce que le clic touchera. Faux : curseur de Windows inchangé (diagnostic, secours).
        public bool CursorFollow = true;
        public int CaptureLingerMs = 2000, TelemetryIntervalMs = 1000;
    }

    /// Performances : un profil fixe toutes les valeurs ; changer une valeur à la main donne le profil « personnalise ».
    /// Déterministe : aucune réduction de qualité sans on_overload = reduire ; chaque palier est annoncé
    /// (engine.degraded / engine.recovered) et visible dans la télémétrie.
    sealed class PerformanceConfig
    {
        public static readonly string[] Profiles = { "qualite", "equilibre", "economie" };
        public string Profile = "equilibre";
        /// Cadence de traitement maximale par cible (images/s) ; 0 = fréquence de l'écran de la cible.
        public int MaxFps;
        /// Passes GPU par image et par cible : au-delà, l'effet est refusé (too_costly).
        public int MaxPasses = 6;
        /// Résolution des passes intermédiaires (la dernière passe est toujours à pleine résolution).
        public double RenderScale = 1;
        /// Temps GPU du moteur toléré par image (ms) : au-delà, surcharge.
        public double GpuBudgetMs = 2;
        /// Surcharge : signaler (événement seulement) ou reduire (paliers annoncés, retour automatique).
        public string OnOverload = "reduire";
        /// Lecture directe de l'image capturée quand aucune copie n'est nécessaire (interrupteur de secours).
        public bool ZeroCopy = true;

        public static PerformanceConfig For(string profile)
        {
            switch (profile)
            {
                case "qualite": return new PerformanceConfig { Profile = profile, MaxFps = 0, MaxPasses = 8, RenderScale = 1, GpuBudgetMs = 4, OnOverload = "signaler" };
                case "equilibre": return new PerformanceConfig();
                case "economie": return new PerformanceConfig { Profile = profile, MaxFps = 60, MaxPasses = 3, RenderScale = 0.5, GpuBudgetMs = 1, OnOverload = "reduire" };
            }
            throw new ConfigError("invalid_config", "profil : qualite, equilibre ou economie");
        }

        public PerformanceConfig Clone() { return (PerformanceConfig)MemberwiseClone(); }

        public Dictionary<string, object> ToJson()
        {
            return J.Map("profile", Profile, "max_fps", MaxFps, "max_passes", MaxPasses, "render_scale", RenderScale, "gpu_budget_ms", GpuBudgetMs,
                "on_overload", OnOverload, "zero_copy", ZeroCopy);
        }
    }

    sealed class ConfigError : Exception
    {
        public readonly string Code;
        public ConfigError(string code, string message) : base(message) { Code = code; }
    }

    sealed class ConfigStore
    {
        public const string Schema = "raptoru.chaos.config";
        public const int CurrentVersion = 5;
        readonly Registry reg;
        readonly string path;
        public EngineSettings Engine = new EngineSettings();
        public SafetyConfig Safety = new SafetyConfig();
        public PerformanceConfig Performance = new PerformanceConfig();
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
        /// v2 → v3 (22/11) : la cible par défaut devient l'écran entier (spécification du retournement).
        /// v3 → v4 (22/11, incident de performances) : retour au calque sur la fenêtre par défaut ; la bascule
        /// d'orientation par Windows devient une option expérimentale (input_effects), coupée.
        /// v4 → v5 (23/11) : section performance ; engine.quality (auto / high) devient le profil equilibre / qualite.
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
            if (from <= 2)
            {
                var engine = J.Obj(root, "engine") ?? new Dictionary<string, object>();
                engine["default_mode"] = "monitor";
                root["engine"] = engine;
                root["version"] = 3;
            }
            if (from <= 3)
            {
                var engine = J.Obj(root, "engine") ?? new Dictionary<string, object>();
                engine["default_mode"] = "window";
                engine["input_effects"] = false;
                root["engine"] = engine;
                root["version"] = 4;
            }
            if (from <= 4)
            {
                var engine = J.Obj(root, "engine") ?? new Dictionary<string, object>();
                string q = J.Str(engine, "quality", "auto");
                engine.Remove("quality");
                root["engine"] = engine;
                root["performance"] = PerformanceConfig.For(q == "high" ? "qualite" : "equilibre").ToJson();
                root["version"] = 5;
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
            var pf = J.Obj(root, "performance");
            if (pf != null) TrySet(notes, "performance", () => SetPerformance(pf));
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
                InputEffects = J.Bool(v, "input_effects", Engine.InputEffects),
                CursorFollow = J.Bool(v, "cursor_follow", Engine.CursorFollow),
                CaptureLingerMs = (int)J.Num(v, "capture_linger_ms", Engine.CaptureLingerMs),
                TelemetryIntervalMs = (int)J.Num(v, "telemetry_interval_ms", Engine.TelemetryIntervalMs)
            };
            if (n.DefaultMode != "window" && n.DefaultMode != "monitor") throw new ConfigError("invalid_config", "default_mode : window ou monitor");
            if (n.CaptureLingerMs < 0 || n.CaptureLingerMs > 30000) throw new ConfigError("invalid_config", "capture_linger_ms : 0 à 30 000");
            if (n.TelemetryIntervalMs < 250 || n.TelemetryIntervalMs > 10000) throw new ConfigError("invalid_config", "telemetry_interval_ms : 250 à 10 000");
            Engine = n;
        }

        /// Un profil applique toutes ses valeurs ; une valeur fournie à la main donne le profil « personnalise ».
        public void SetPerformance(Dictionary<string, object> v)
        {
            string profile = J.Str(v, "profile", null);
            var n = profile != null && profile != "personnalise" ? PerformanceConfig.For(profile) : Performance.Clone();
            bool custom = false;
            if (J.Has(v, "max_fps")) { n.MaxFps = (int)J.Num(v, "max_fps", -1); custom = true; }
            if (J.Has(v, "max_passes")) { n.MaxPasses = (int)J.Num(v, "max_passes", -1); custom = true; }
            if (J.Has(v, "render_scale")) { n.RenderScale = J.Num(v, "render_scale", -1); custom = true; }
            if (J.Has(v, "gpu_budget_ms")) { n.GpuBudgetMs = J.Num(v, "gpu_budget_ms", -1); custom = true; }
            if (J.Has(v, "on_overload")) { n.OnOverload = J.Str(v, "on_overload", ""); custom = true; }
            if (J.Has(v, "zero_copy")) n.ZeroCopy = J.Bool(v, "zero_copy", true);
            if (custom || profile == "personnalise") n.Profile = "personnalise";
            if (n.MaxFps != 0 && (n.MaxFps < 30 || n.MaxFps > 360)) throw new ConfigError("invalid_config", "max_fps : 0 (fréquence de l'écran) ou 30 à 360");
            if (n.MaxPasses < 1 || n.MaxPasses > 8) throw new ConfigError("invalid_config", "max_passes : 1 à 8");
            if (n.RenderScale < 0.25 || n.RenderScale > 1) throw new ConfigError("invalid_config", "render_scale : 0,25 à 1");
            if (n.GpuBudgetMs < 0.25 || n.GpuBudgetMs > 16) throw new ConfigError("invalid_config", "gpu_budget_ms : 0,25 à 16");
            if (n.OnOverload != "signaler" && n.OnOverload != "reduire") throw new ConfigError("invalid_config", "on_overload : signaler ou reduire");
            Performance = n;
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
            if (section == null || section == "performance") Performance = new PerformanceConfig();
            if (section == null || section == "presets") Presets.Clear();
            if (section != null && section != "engine" && section != "safety" && section != "performance" && section != "presets") throw new ConfigError("invalid_config", "section inconnue : " + section);
        }

        public Dictionary<string, object> ToJson()
        {
            var presets = new Dictionary<string, object>();
            foreach (var eff in Presets) presets[eff.Key] = eff.Value.ToDictionary(kv => kv.Key, kv => (object)kv.Value.ToJson());
            return J.Map("schema", Schema, "version", CurrentVersion,
                "engine", J.Map("follow_foreground", Engine.FollowForeground, "default_mode", Engine.DefaultMode, "input_effects", Engine.InputEffects, "cursor_follow", Engine.CursorFollow, "capture_linger_ms", Engine.CaptureLingerMs,
                                "telemetry_interval_ms", Engine.TelemetryIntervalMs),
                "safety", J.Map("max_duration_ms", Safety.MaxDurationMs, "max_active_effects", Safety.MaxActiveEffects, "safe_mode", Safety.SafeMode),
                "performance", Performance.ToJson(),
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
