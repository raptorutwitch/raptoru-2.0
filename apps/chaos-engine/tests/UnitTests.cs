// Tests unitaires de la logique pure du moteur (aucun GPU, aucune fenêtre) : registre, paramètres, transitions,
// configuration, ordonnanceur, protocole. Réutilisables pour chaque futur effet. Sortie : ok / KO par cas, puis total.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace Raptoru.Chaos
{
    static class UnitTests
    {
        static int ok, ko;
        static string current;

        static void Case(string name, Action body)
        {
            current = name;
            try { body(); ok++; Console.WriteLine("  ok  " + name); }
            catch (Exception e) { ko++; Console.WriteLine("  KO  " + name + " — " + e.Message); }
        }
        static void True(bool c, string what) { if (!c) throw new Exception("attendu : " + what); }
        static void Eq<T>(T expected, T actual, string what)
        {
            if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception(what + " : attendu " + expected + ", obtenu " + actual);
        }
        static void Near(double expected, double actual, double tol, string what)
        {
            if (Math.Abs(expected - actual) > tol) throw new Exception(what + " : attendu " + expected + " ± " + tol + ", obtenu " + actual);
        }
        static string Throws<TEx>(Action a) where TEx : Exception
        {
            try { a(); }
            catch (TEx e)
            {
                var f = e.GetType().GetField("Code");
                return f != null ? (string)f.GetValue(e) : e.Message;
            }
            throw new Exception("exception " + typeof(TEx).Name + " attendue");
        }

        static Registry Reg() { return Registry.Embedded(); }

        // Registre synthétique : deux transformations pour éprouver remplacement et priorités sans effet réel.
        const string Fake = @"{""schema"":""raptoru.chaos.registry"",""version"":1,
 ""engine_limits"":{""min_duration_ms"":1000,""max_duration_ms"":60000,""max_active_effects"":8,""max_queue"":3,""queue_ttl_ms"":5000,""max_rotation_deg_per_s"":520,""max_transition_ms"":3000},
 ""families"":{""test"":{""label"":""t""}},
 ""slots"":{""transform"":{""order"":10,""max_active"":1,""requires_capture"":true},""filter"":{""order"":20,""max_active"":2,""requires_capture"":true},""overlay"":{""order"":90,""max_active"":4}},
 ""effects"":[
  {""id"":""a"",""version"":1,""family"":""test"",""slot"":""transform"",""on_conflict"":""queue"",""duration"":{""default_ms"":2000},""params"":[],""transitions"":{""in"":{""kind"":""ramp"",""duration_ms"":100,""kinds"":[""ramp"",""cut""]},""out"":{""kind"":""ramp"",""duration_ms"":100,""kinds"":[""ramp"",""cut""]}},""stop_conditions"":[""stop_all""]},
  {""id"":""b"",""version"":1,""family"":""test"",""slot"":""transform"",""on_conflict"":""replace"",""duration"":{""default_ms"":2000},""params"":[],""transitions"":{""in"":{""kind"":""cut""},""out"":{""kind"":""ramp"",""duration_ms"":100,""kinds"":[""ramp"",""cut""]}},""stop_conditions"":[""stop_all""]},
  {""id"":""f1"",""version"":1,""family"":""test"",""slot"":""filter"",""on_conflict"":""reject"",""duration"":{""default_ms"":2000},""params"":[],""stop_conditions"":[""stop_all""]},
  {""id"":""f2"",""version"":1,""family"":""test"",""slot"":""filter"",""on_conflict"":""queue"",""duration"":{""default_ms"":2000},""params"":[],""stop_conditions"":[""stop_all""]},
  {""id"":""f3"",""version"":1,""family"":""test"",""slot"":""filter"",""on_conflict"":""queue"",""duration"":{""default_ms"":2000},""params"":[],""stop_conditions"":[""stop_all""]}
 ]}";

        sealed class World
        {
            public long T;
            public Registry R;
            public ConfigStore C;
            public Scheduler S;
            public World(Registry r)
            {
                R = r; C = new ConfigStore(r, null);
                C.Safety.MaxDurationMs = r.Limits.MaxDurationMs;
                S = new Scheduler(r, () => T, () => C.Safety);
            }
            public Activation Req(string id, string effect, string target = "w:1", string policy = null, int prio = 0, int? dur = null)
            {
                var def = R.Get(effect);
                var res = Params.Resolve(def, null, null, null, dur, null, R.Limits, C.Safety, true);
                return S.Submit(new EffectRequest { RequestId = id, Def = def, Resolved = res, TargetKey = target, Policy = policy, Priority = prio });
            }
            public List<string> Kinds() { return S.Drain().Select(e => e.Kind + ":" + e.A.Req.RequestId).ToList(); }
            public void Run(long ms) { for (long i = 0; i < ms; i += 10) { T += 10; S.Tick(); } }
        }

        public static int Run()
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine("Tests unitaires du moteur Chaos");

            // ---------- Registre ----------
            Case("registre embarqué lisible et cohérent", () =>
            {
                var r = Reg();
                var f = r.Get("flip");
                True(f != null && f.Slot.RequiresCapture && !f.Internal, "flip présent, capture requise, public");
                Eq(180.0, (double)f.Param("angle").Default, "angle par défaut");
                True(f.Param("angle").Animatable && !f.Param("angle").Exposed, "angle animable non exposé");
                True(r.Get("diag.marker").Internal && !r.Get("diag.marker").RequiresCapture, "repère interne sans capture");
                Eq("invert_xy", f.Input, "le retournement inverse aussi la souris (couche Entrées)");
                True(r.InputEffects.ContainsKey("invert_xy") && r.Get("diag.tint").Input == null, "transformation d'entrée déclarée, absente des diagnostics");
            });
            Case("registre invalide refusé (doublon, emplacement, défaut hors bornes, stop_all absent, schéma)", () =>
            {
                // Chaque cas modifie l'objet lu (jamais le texte : le fichier peut être reformaté sans casser le test).
                Func<Action<Dictionary<string, object>, List<Dictionary<string, object>>>, string> mutate = change =>
                {
                    var root = J.Parse(Reg().Json);
                    var effects = J.Arr(root, "effects").Cast<Dictionary<string, object>>().ToList();
                    change(root, effects);
                    return J.Write(root);
                };
                Func<List<Dictionary<string, object>>, string, Dictionary<string, object>> fx = (l, id) => l.First(e => (string)e["id"] == id);
                Throws<RegistryError>(() => Registry.Parse(mutate((r, l) => fx(l, "diag.tint")["id"] = "flip")));
                Throws<RegistryError>(() => Registry.Parse(mutate((r, l) => fx(l, "flip")["slot"] = "nulle-part")));
                Throws<RegistryError>(() => Registry.Parse(mutate((r, l) =>
                    J.Arr(fx(l, "flip"), "params").Cast<Dictionary<string, object>>().First(p => (string)p["id"] == "angle")["default"] = 999)));
                Throws<RegistryError>(() => Registry.Parse(mutate((r, l) => fx(l, "flip")["stop_conditions"] = new object[] { "duration" })));
                Throws<RegistryError>(() => Registry.Parse(mutate((r, l) => r["schema"] = "autre")));
                Throws<RegistryError>(() => Registry.Parse(mutate((r, l) => fx(l, "flip")["input"] = "clavier_inverse")));
                Throws<RegistryError>(() => Registry.Parse(mutate((r, l) => J.Obj(r, "input_effects")["souris_folle"] = J.Map("label", "x"))));
                Registry.Parse(mutate((r, l) => { })); // le document non modifié reste valide
            });

            // ---------- Paramètres ----------
            var reg = Reg();
            var lim = reg.Limits;
            var safety = new SafetyConfig { MaxDurationMs = 30000 };
            var flip = reg.Get("flip");
            Case("paramètres : défauts du registre, transitions incluses", () =>
            {
                var r = Params.Resolve(flip, null, null, null, null, null, lim, safety, true);
                Eq(180.0, r.Num("angle"), "angle"); Eq("mirror", r.Str("fill"), "fill"); Eq(10000, r.DurationMs, "durée");
                Eq("ramp", r.In.Kind, "entrée"); Eq(550, r.In.DurationMs, "durée d'entrée"); Eq("ease_in_out_sine", r.In.Curve, "courbe");
            });
            Case("paramètres : variante, valeurs valides et invalides", () =>
            {
                Eq(180.0, Params.Resolve(flip, "rotate180", null, null, null, null, lim, safety, true).Num("angle"), "variante");
                Eq("unknown_variant", Throws<ParamError>(() => Params.Resolve(flip, "x", null, null, null, null, lim, safety, true)), "variante inconnue");
                Eq("black", Params.Resolve(flip, null, null, J.Map("fill", "black"), null, null, lim, safety, false).Str("fill"), "fill");
                Eq("invalid_param", Throws<ParamError>(() => Params.Resolve(flip, null, null, J.Map("fill", "rose"), null, null, lim, safety, false)), "énumération");
                Eq("unknown_param", Throws<ParamError>(() => Params.Resolve(flip, null, null, J.Map("vitesse", 2), null, null, lim, safety, true)), "inconnu");
                Eq("param_not_overridable", Throws<ParamError>(() => Params.Resolve(flip, null, null, J.Map("angle", 90), null, null, lim, safety, false)), "non exposé, source externe");
                Eq(90.0, Params.Resolve(flip, null, null, J.Map("angle", 90), null, null, lim, safety, true).Num("angle"), "non exposé, source de confiance");
                Eq("param_out_of_range", Throws<ParamError>(() => Params.Resolve(flip, null, null, J.Map("angle", 999), null, null, lim, safety, true)), "bornes");
                Eq("invalid_param", Throws<ParamError>(() => Params.Resolve(flip, null, null, J.Map("angle", "180"), null, null, lim, safety, true)), "type");
            });
            Case("paramètres : durées et plafond de sécurité", () =>
            {
                Eq("duration_out_of_range", Throws<ParamError>(() => Params.Resolve(flip, null, null, null, 500, null, lim, safety, true)), "trop court");
                Eq("duration_out_of_range", Throws<ParamError>(() => Params.Resolve(flip, null, null, null, 31000, null, lim, safety, true)), "au-delà de la sécurité");
                Eq(30000, Params.Resolve(flip, null, null, null, 30000, null, lim, safety, true).DurationMs, "à la limite");
            });
            Case("transitions : coupure, plafond de vitesse angulaire, mode sûr", () =>
            {
                var cut = Params.Resolve(flip, null, null, null, null, J.Map("in", J.Map("kind", "cut")), lim, safety, true);
                True(cut.In.Instant && cut.In.DurationMs == 0, "coupure instantanée");
                var fast = Params.Resolve(flip, null, null, null, null, J.Map("in", J.Map("duration_ms", 100)), lim, safety, true);
                True(fast.In.DurationMs >= 544 && fast.Adjusted.Contains("transition.in.duration_ms"), "rallongée à ≥ 544 ms et signalée (" + fast.In.DurationMs + ")");
                Eq("invalid_transition", Throws<ParamError>(() => Params.Resolve(flip, null, null, null, null, J.Map("in", J.Map("kind", "spirale")), lim, safety, true)), "type inconnu");
                Eq("invalid_transition", Throws<ParamError>(() => Params.Resolve(flip, null, null, null, null, J.Map("out", J.Map("duration_ms", 9000)), lim, safety, true)), "trop longue");
                var safe = Params.Resolve(flip, null, null, null, null, null, lim, new SafetyConfig { MaxDurationMs = 30000, SafeMode = true }, true);
                True(safe.In.Instant && safe.Out.Instant, "mode sûr : pas de rotation animée");
            });
            Case("paramètres : texte nettoyé et borné, couleur", () =>
            {
                var m = reg.Get("diag.marker");
                Eq("AB", Params.Resolve(m, null, null, J.Map("text", "A\u0007B"), null, null, lim, safety, true).Str("text"), "caractères de contrôle retirés");
                Eq("param_out_of_range", Throws<ParamError>(() => Params.Resolve(m, null, null, J.Map("text", new string('x', 41)), null, null, lim, safety, true)), "longueur");
                Eq("invalid_param", Throws<ParamError>(() => Params.Resolve(m, null, null, J.Map("color", "rouge"), null, null, lim, safety, true)), "couleur");
                Eq("#00ff00", Params.Resolve(m, null, null, J.Map("color", "#00FF00"), null, null, lim, safety, true).Str("color"), "couleur normalisée");
            });

            // ---------- Transitions ----------
            Case("courbes : bornes, monotonie, pentes", () =>
            {
                foreach (var c in new[] { "linear", "ease_in_out_sine", "ease_in_out_cubic", "ease_in_cubic", "ease_out_cubic" })
                {
                    Near(0, Curves.Eval(c, 0), 1e-9, c + "(0)"); Near(1, Curves.Eval(c, 1), 1e-9, c + "(1)");
                    double prev = 0;
                    for (int i = 1; i <= 100; i++) { double v = Curves.Eval(c, i / 100.0); True(v >= prev - 1e-12, c + " croissante"); prev = v; }
                }
                Near(Math.PI / 2, Curves.PeakSlope("ease_in_out_sine"), 1e-9, "pente du sinus");
            });
            Case("animateur : entrée, palier, sortie complète", () =>
            {
                var a = new Animator(new TransitionPlan { Kind = "ramp", DurationMs = 500, Curve = "linear" }, new TransitionPlan { Kind = "ramp", DurationMs = 400, Curve = "linear" });
                a.Start(1000);
                Near(0.5, a.Presence(1250), 1e-9, "mi-entrée"); True(a.Animating(1250), "anime");
                Near(1, a.Presence(1600), 1e-9, "palier"); Eq(AnimPhase.Steady, a.Phase, "phase");
                a.BeginExit(2000);
                Near(0.5, a.Presence(2200), 1e-9, "mi-sortie"); True(a.Done(2401), "fini");
            });
            Case("animateur : sortie pendant l'entrée, sans saut, à vitesse comparable", () =>
            {
                var a = new Animator(new TransitionPlan { Kind = "ramp", DurationMs = 400, Curve = "linear" }, new TransitionPlan { Kind = "ramp", DurationMs = 400, Curve = "linear" });
                a.Start(0);
                double p = a.Presence(100);
                a.BeginExit(100);
                Near(p, a.Presence(100), 1e-9, "continuité");
                True(!a.Done(150) && a.Done(201), "sortie de 100 ms (400 × 0,25)");
                var c = new Animator(new TransitionPlan { Kind = "cut" }, new TransitionPlan { Kind = "cut" });
                c.Start(0); Near(1, c.Presence(0), 1e-9, "coupure : entier tout de suite"); c.BeginExit(5); True(c.Done(5), "coupure : fini tout de suite");
            });
            Case("banc : cadence par phase, à-coups, pire fenêtre de 250 ms ; relevés PresentMon v1 et v2", () =>
            {
                long f = 1000000, t = 0;
                var frames = new List<long>();
                for (int i = 0; i < 1000; i++) { t += f / 250; frames.Add(t); }
                t += f * 60 / 1000; frames.Add(t); // une image de 60 ms (chute à 17 i/s)
                for (int i = 0; i < 250; i++) { t += f / 250; frames.Add(t); }
                var all = BenchStats.Summarize("x", frames, f, 0, t + 1, -1);
                Near(4, all.MedianMs, 0.01, "médiane"); Near(60, all.MaxMs, 0.01, "pire image"); Eq(1, all.Hitches, "un à-coup");
                True(all.WorstWindowFps < 240 && all.WorstWindowFps > 150, "le creux se voit sur 250 ms (" + all.WorstWindowFps + ")");
                var calm = BenchStats.Summarize("y", frames, f, 0, f * 3, 4);
                True(calm.Hitches == 0 && Math.Abs(calm.Fps - 250) < 2, "phase calme : 250 i/s, aucun à-coup");
                bool qpc;
                var v2 = BenchStats.ParsePresentMon("Application,ProcessID,PresentMode,CPUStartQPC,MsBetweenPresents\nOverwatch.exe,1,Hardware: Independent Flip,1000,4.1\nobs64.exe,2,Composed: Flip,1100,16\nOverwatch.exe,1,Composed: Flip,2000,60\n", "Overwatch.exe", out qpc);
                True(qpc && v2.Count == 2 && v2[1].Mode == "Composed: Flip" && v2[0].Time == 1000, "PresentMon v2 (QPC, filtré par processus)");
                var v1 = BenchStats.ParsePresentMon("Application,ProcessID,TimeInSeconds,msBetweenPresents\nx.exe,1,0.5,4\n", null, out qpc);
                True(!qpc && v1.Count == 1 && v1[0].Time == 0.5, "PresentMon v1 (secondes)");
            });
            Case("animateur : sortie retenue (écran rendu par Windows d'abord), puis retour complet sans saut", () =>
            {
                var a = new Animator(new TransitionPlan { Kind = "ramp", DurationMs = 400, Curve = "linear" }, new TransitionPlan { Kind = "ramp", DurationMs = 400, Curve = "linear" });
                a.Start(0);
                a.BeginExit(1000);
                for (long t = 1000; t <= 1300; t += 50) a.HoldExit(t);
                Near(1, a.Presence(1300), 1e-9, "retenue : présence entière");
                True(!a.Done(1350), "pas fini pendant la retenue");
                Near(0.5, a.Presence(1500), 1e-9, "retour animé depuis la fin de la retenue");
                True(a.Done(1701), "retour complet");
            });

            // ---------- Configuration ----------
            Case("configuration : validation des sections et préréglages", () =>
            {
                var c = new ConfigStore(reg, null);
                Eq("invalid_config", Throws<ConfigError>(() => c.SetSafety(J.Map("max_duration_ms", 999999))), "sécurité hors bornes absolues");
                Eq("invalid_config", Throws<ConfigError>(() => c.SetEngine(J.Map("default_mode", "fenetre"))), "mode inconnu");
                c.SetPreset("flip", "doux", J.Map("params", J.Map("fill", "black"), "duration_ms", 5000, "transition", J.Map("in", J.Map("duration_ms", 900))));
                Eq("black", (string)c.GetPreset("flip", "doux").Params["fill"], "préréglage enregistré");
                Eq("invalid_param", Throws<ConfigError>(() => c.SetPreset("flip", "faux", J.Map("params", J.Map("fill", "vert")))), "préréglage invalide refusé");
                Eq("unknown_effect", Throws<ConfigError>(() => c.SetPreset("inconnu", "x", J.Map())), "effet inconnu");
                c.Reset("presets"); True(c.GetPreset("flip", "doux") == null, "réinitialisation");
            });
            Case("configuration : écriture atomique, relecture, migration v1, fichier illisible, trop récent", () =>
            {
                string dir = Path.Combine(Path.GetTempPath(), "chaos-unit-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(dir);
                try
                {
                    string p = Path.Combine(dir, "config.json");
                    var c = new ConfigStore(reg, p);
                    c.SetSafety(J.Map("max_duration_ms", 20000, "safe_mode", true));
                    c.SetPreset("flip", "default", J.Map("params", J.Map("fill", "cover")));
                    c.Save();
                    var c2 = new ConfigStore(reg, p); c2.Load();
                    True(c2.Safety.SafeMode && c2.Safety.MaxDurationMs == 20000 && (string)c2.GetPreset("flip", "default").Params["fill"] == "cover", "relu à l'identique");
                    File.WriteAllText(p, "{\"version\":1,\"follow_foreground\":false,\"safe_mode\":true,\"max_duration_ms\":15000}");
                    var c3 = new ConfigStore(reg, p); c3.Load();
                    True(!c3.Engine.FollowForeground && c3.Safety.SafeMode && c3.Safety.MaxDurationMs == 15000, "migration v1 → v5");
                    True(c3.Engine.DefaultMode == "window" && !c3.Engine.InputEffects, "migration : calque sur la fenêtre, bascule Windows coupée");
                    var fresh = new ConfigStore(reg, null).Engine;
                    True(fresh.DefaultMode == "window" && !fresh.InputEffects, "défauts : calque sur la fenêtre, bascule Windows (expérimentale) coupée");
                    File.WriteAllText(p, "{\"schema\":\"raptoru.chaos.config\",\"version\":3,\"engine\":{\"default_mode\":\"monitor\",\"capture_linger_ms\":4000}}");
                    var c6 = new ConfigStore(reg, p); c6.Load();
                    True(c6.Engine.DefaultMode == "window" && !c6.Engine.InputEffects && c6.Engine.CaptureLingerMs == 4000 && File.Exists(p + ".v3.bak"),
                        "migration v3 → v4 : retour au calque, le reste conservé");
                    c6.SetEngine(J.Map("input_effects", true, "default_mode", "monitor"));
                    c6.Save();
                    var c7 = new ConfigStore(reg, p); c7.Load();
                    True(c7.Engine.InputEffects && c7.Engine.DefaultMode == "monitor", "bascule Windows activable explicitement (enregistrée)");
                    True(File.Exists(p + ".v1.bak"), "sauvegarde de l'ancienne version");
                    File.WriteAllText(p, "{ pas du json");
                    var c4 = new ConfigStore(reg, p); c4.Load();
                    True(c4.Safety.MaxDurationMs == 30000 && c4.LoadNotes.Any(n => n.Contains("illisible")), "illisible : défauts et copie");
                    File.WriteAllText(p, "{\"schema\":\"raptoru.chaos.config\",\"version\":99}");
                    Eq("config_too_new", Throws<ConfigError>(() => new ConfigStore(reg, p).Load()), "version trop récente refusée");
                    File.WriteAllText(p, "{\"schema\":\"raptoru.chaos.config\",\"version\":2,\"safety\":{\"max_duration_ms\":5},\"presets\":{\"flip\":{\"x\":{\"params\":{\"fill\":\"vert\"}},\"ok\":{\"params\":{\"fill\":\"black\"}}}}}");
                    var c5 = new ConfigStore(reg, p); c5.Load();
                    True(c5.Safety.MaxDurationMs == 30000 && c5.GetPreset("flip", "ok") != null && c5.GetPreset("flip", "x") == null && c5.LoadNotes.Count >= 2, "valeurs invalides ignorées une par une");
                }
                finally { try { Directory.Delete(dir, true); } catch (Exception) { } }
            });

            Case("écrans : ordre réel gauche → droite, noms, choix stables, écran débranché", () =>
            {
                // Le PC d'Antoni : DISPLAY1 principal à droite (0,0), DISPLAY2 à gauche (-1920).
                var pc = new List<ScreenInfo>
                {
                    new ScreenInfo { Device = @"\\.\DISPLAY1", X = 0, Y = 0, Width = 2560, Height = 1440, Primary = true },
                    new ScreenInfo { Device = @"\\.\DISPLAY2", X = -1920, Y = 165, Width = 1920, Height = 1080 },
                };
                var o = ScreenLayout.Ordered(pc);
                True(o[0].Device.EndsWith("DISPLAY2") && o[1].Device.EndsWith("DISPLAY1"), "ordre selon la position, pas le numéro");
                True(ScreenLayout.Label(0, 2) == "Écran gauche" && ScreenLayout.Label(1, 2) == "Écran droit" && ScreenLayout.Key(0, 2) == "left" && ScreenLayout.Key(1, 2) == "right", "noms et clés à deux écrans");
                True(ScreenLayout.Label(1, 3) == "Écran du milieu" && ScreenLayout.Key(1, 3) == "s:1", "écran du milieu");
                string err;
                True(ScreenLayout.Resolve("left", o, out err)[0].Device.EndsWith("DISPLAY2") && err == null, "gauche");
                True(ScreenLayout.Resolve("right", o, out err)[0].Device.EndsWith("DISPLAY1"), "droite");
                True(ScreenLayout.Resolve("primary", o, out err)[0].Primary, "principal");
                True(ScreenLayout.Resolve("all", o, out err).Count == 2, "tous les écrans, de gauche à droite");
                var three = ScreenLayout.Ordered(pc.Concat(new[] { new ScreenInfo { Device = "C", X = 2560, Y = 0, Width = 1920, Height = 1080 } }));
                True(ScreenLayout.Resolve("s:1", three, out err)[0].Device.EndsWith("DISPLAY1") && err == null, "milieu à trois écrans");
                True(ScreenLayout.Resolve("s:1", o, out err).Count == 0 && err != null && err.Contains("n'existe plus"), "écran du milieu débranché : refus lisible, pas de remplacement silencieux");
                True(ScreenLayout.Resolve("left", o.Take(1).ToList(), out err)[0].Device.EndsWith("DISPLAY2") && ScreenLayout.Resolve("right", o.Take(1).ToList(), out err).Count == 1,
                    "un seul écran : gauche et droite le désignent");
                True(!ScreenLayout.Valid("DISPLAY2") && !ScreenLayout.Valid("s:x") && ScreenLayout.Valid("s:2"), "choix invalides refusés");
            });

            Case("réglages d'un effet : défauts, persistance, validation", () =>
            {
                string dir = Path.Combine(Path.GetTempPath(), "chaos-unit-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(dir);
                try
                {
                    string path = Path.Combine(dir, "config.json");
                    var c = new ConfigStore(reg, path);
                    var d = c.Effect("flip");
                    True(d.Enabled && d.Screen == "primary" && d.Cursor, "défauts : disponible, écran principal, curseur retourné");
                    c.SetEffects(J.Map("flip", J.Map("screen", "right", "cursor", false)));
                    c.SetEffects(J.Map("flip", J.Map("enabled", false)));
                    c.Save();
                    var c2 = new ConfigStore(reg, path); c2.Load();
                    var f = c2.Effect("flip");
                    True(f.Screen == "right" && !f.Cursor && !f.Enabled, "relus à l'identique (chaque valeur gardée)");
                    True(J.Obj(J.Obj(c2.ToJson(), "effects"), "flip") != null && J.Obj(J.Obj(c2.ToJson(), "effects"), "diag.tint") != null, "chaque effet du registre exposé");
                    Eq("unknown_effect", Throws<ConfigError>(() => c2.SetEffects(J.Map("nope", J.Map("screen", "left")))), "effet inconnu");
                    Eq("invalid_config", Throws<ConfigError>(() => c2.SetEffects(J.Map("flip", J.Map("screen", "DISPLAY2")))), "écran invalide");
                    True(c2.Effect("flip").Screen == "right", "un réglage refusé ne change rien");
                    c2.Reset("effects");
                    True(c2.Effect("flip").Screen == "primary", "réinitialisation de la section");
                }
                finally { try { Directory.Delete(dir, true); } catch (Exception) { } }
            });

            Case("curseur : le retournement fait suivre l'image au curseur ; déclaration validée ; réglage moteur", () =>
            {
                True(reg.Get("flip").Cursor == "follow" && reg.Get("diag.tint").Cursor == null && reg.Get("diag.marker").Cursor == null, "flip : curseur suivi, diagnostics inchangés");
                Func<Action<Dictionary<string, object>, List<Dictionary<string, object>>>, string> mutate = change =>
                {
                    var root = J.Parse(Reg().Json);
                    var effects = J.Arr(root, "effects").Cast<Dictionary<string, object>>().ToList();
                    change(root, effects);
                    return J.Write(root);
                };
                Func<List<Dictionary<string, object>>, string, Dictionary<string, object>> fx = (l, id) => l.First(e => (string)e["id"] == id);
                Throws<RegistryError>(() => Registry.Parse(mutate((r, l) => fx(l, "flip")["cursor"] = "invert")));
                Throws<RegistryError>(() => Registry.Parse(mutate((r, l) => fx(l, "diag.marker")["cursor"] = "follow")));
                var c = new ConfigStore(reg, null);
                True(c.Engine.CursorFollow, "défaut : curseur retourné avec l'image");
                c.SetEngine(J.Map("cursor_follow", false));
                True(!c.Engine.CursorFollow && J.Bool(J.Obj(c.ToJson(), "engine"), "cursor_follow", true) == false, "coupé à la demande (secours), enregistré");
            });

            Case("performances : profils, valeur personnalisée, bornes, migration de quality, passes déclarées", () =>
            {
                var c = new ConfigStore(reg, null);
                var d = c.Performance;
                True(d.Profile == "equilibre" && d.MaxFps == 0 && d.MaxPasses == 6 && d.OnOverload == "reduire" && d.ZeroCopy, "défaut : équilibré, cadence de l'écran, réduction annoncée");
                c.SetPerformance(J.Map("profile", "economie"));
                True(c.Performance.MaxFps == 60 && c.Performance.MaxPasses == 3 && c.Performance.RenderScale == 0.5 && c.Performance.GpuBudgetMs == 1, "profil économie appliqué en entier");
                c.SetPerformance(J.Map("max_fps", 90));
                True(c.Performance.Profile == "personnalise" && c.Performance.MaxFps == 90 && c.Performance.MaxPasses == 3, "valeur à la main : profil personnalisé, le reste gardé");
                c.SetPerformance(J.Map("profile", "qualite"));
                True(c.Performance.OnOverload == "signaler" && c.Performance.MaxFps == 0 && c.Performance.MaxPasses == 8, "profil qualité : jamais de réduction automatique");
                Eq("invalid_config", Throws<ConfigError>(() => c.SetPerformance(J.Map("max_fps", 10))), "cadence trop basse refusée");
                Eq("invalid_config", Throws<ConfigError>(() => c.SetPerformance(J.Map("render_scale", 2))), "échelle hors bornes refusée");
                Eq("invalid_config", Throws<ConfigError>(() => c.SetPerformance(J.Map("on_overload", "ignorer"))), "réaction inconnue refusée");
                Eq("invalid_config", Throws<ConfigError>(() => c.SetPerformance(J.Map("profile", "turbo"))), "profil inconnu refusé");
                True(c.Performance.Profile == "qualite", "un réglage refusé ne change rien");
                var m = ConfigStore.Migrate(J.Map("schema", ConfigStore.Schema, "version", 4, "engine", J.Map("quality", "high", "capture_linger_ms", 3000)), 4);
                True((int)J.Num(m, "version", 0) == 5 && J.Str(J.Obj(m, "performance"), "profile", "") == "qualite" && !J.Obj(m, "engine").ContainsKey("quality")
                    && (int)J.Num(J.Obj(m, "engine"), "capture_linger_ms", 0) == 3000, "migration v4 → v5 : quality high → profil qualité, le reste gardé");
                var m2 = ConfigStore.Migrate(J.Map("schema", ConfigStore.Schema, "version", 4, "engine", J.Map("quality", "auto")), 4);
                True(J.Str(J.Obj(m2, "performance"), "profile", "") == "equilibre", "quality auto → profil équilibré");
                True(reg.Get("diag.passes").GpuPasses == 6 && reg.Get("flip").GpuPasses == 1, "passes GPU déclarées par le registre (refus too_costly)");
                c.Reset("performance");
                True(c.Performance.Profile == "equilibre", "réinitialisation de la section");
            });

            // ---------- Ordonnanceur ----------
            var fake = Registry.Parse(Fake);
            Case("ordonnanceur : cycle complet accepté → démarré → sortie → terminé", () =>
            {
                var w = new World(fake);
                var a = w.Req("r1", "a");
                Eq(ActState.Starting, a.State, "en démarrage");
                w.S.MarkStarted("r1"); Eq(ActState.Active, a.State, "actif");
                w.Run(2000); Eq(ActState.Exiting, a.State, "sortie à la durée");
                w.Run(100); Eq(ActState.Finished, a.State, "terminé après la transition");
                Eq("accepted:r1,started:r1,ended:r1", string.Join(",", w.Kinds()), "événements");
                Eq("duration", a.EndReason, "raison");
            });
            Case("ordonnanceur : même effet → file, puis départ quand la place se libère", () =>
            {
                var w = new World(fake);
                w.Req("r1", "a"); w.S.MarkStarted("r1");
                var q = w.Req("r2", "a");
                Eq(ActState.Queued, q.State, "en file");
                w.Run(2110);
                Eq(ActState.Starting, q.State, "parti après la fin du premier");
            });
            Case("ordonnanceur : rejet, prolongation plafonnée, cibles indépendantes", () =>
            {
                var w = new World(fake);
                w.Req("r1", "a"); w.S.MarkStarted("r1");
                Eq("rejected", w.Req("r2", "a", policy: "reject").Outcome, "rejet");
                var first = w.S.Find("r1"); long end = first.EndAt;
                w.Req("r3", "a", policy: "extend");
                Eq(end + 2000, first.EndAt, "prolongé de la durée demandée");
                for (int i = 0; i < 40; i++) w.Req("x" + i, "a", policy: "extend");
                True(first.EndAt - first.StartedAt <= 60000, "plafond de durée totale");
                Eq(ActState.Starting, w.Req("r4", "a", target: "w:2").State, "autre cible : démarre");
            });
            Case("ordonnanceur : remplacement selon la priorité, sans chevauchement", () =>
            {
                var w = new World(fake);
                w.Req("r1", "a", prio: 0); w.S.MarkStarted("r1"); w.Run(200);
                var b = w.Req("r2", "b", prio: 5);
                Eq(ActState.Exiting, w.S.Find("r1").State, "remplacé : sort");
                Eq(ActState.Queued, b.State, "attend la fin de la sortie");
                w.Run(110); Eq(ActState.Starting, b.State, "démarre ensuite");
                var w2 = new World(fake);
                w2.Req("h", "a", prio: 9); w2.S.MarkStarted("h");
                var low = w2.Req("l", "b", prio: 1);
                True(w2.S.Find("h").State == ActState.Active && low.State == ActState.Queued, "priorité plus haute : jamais remplacée");
            });
            Case("ordonnanceur : emplacement à plusieurs effets, capacité de sécurité, file pleine", () =>
            {
                var w = new World(fake);
                Eq(ActState.Starting, w.Req("f1", "f1").State, "filtre 1");
                Eq(ActState.Starting, w.Req("f2", "f2").State, "filtre 2 (2 par emplacement)");
                Eq(ActState.Queued, w.Req("f3", "f3").State, "filtre 3 en file");
                var w2 = new World(fake); w2.C.Safety.MaxActiveEffects = 1;
                w2.Req("a", "a");
                Eq(ActState.Queued, w2.Req("f", "f2").State, "capacité globale de sécurité");
                for (int i = 0; i < 2; i++) w2.Req("q" + i, "f3");
                Eq("queue_full", w2.Req("trop", "f3").EndReason, "file pleine (max_queue 3)");
            });
            Case("ordonnanceur : file expirée, démarrage trop long, annulations, STOP ALL", () =>
            {
                var w = new World(fake);
                w.Req("r1", "a"); w.S.MarkStarted("r1");
                var q = w.Req("r2", "a");
                w.Run(1000); w.S.Find("r1").EndAt = long.MaxValue; w.Run(4100);
                Eq("expired", q.Outcome, "file expirée (TTL 5 s)");
                var w2 = new World(fake);
                var s = w2.Req("s", "a"); w2.Run(Scheduler.StartTimeoutMs + 20);
                Eq("start_timeout", s.EndReason, "démarrage jamais confirmé");
                var w3 = new World(fake);
                w3.Req("x", "a"); w3.S.MarkStarted("x"); w3.Run(200);
                w3.S.Cancel("x", false, "canceled"); Eq(ActState.Exiting, w3.S.Find("x").State, "annulation douce : transition de sortie");
                w3.Req("y", "f1"); w3.S.MarkStarted("y"); w3.S.Cancel("y", true, "canceled");
                Eq(ActState.Finished, w3.S.Find("y").State, "annulation immédiate");
                var w4 = new World(fake);
                w4.Req("p", "a"); w4.S.MarkStarted("p"); w4.Req("q", "a"); w4.Req("f", "f1");
                Eq(3, w4.S.StopAll("stop_all"), "STOP ALL touche tout");
                True(!w4.S.Live.Any(), "plus rien en file ni en cours");
            });
            Case("ordonnanceur : idempotence par request_id et ordre déterministe", () =>
            {
                var w = new World(fake);
                var a1 = w.Req("same", "a"); var a2 = w.Req("same", "a");
                True(ReferenceEquals(a1, a2) && w.Kinds().Contains("duplicate:same"), "rejouée = même activation");
                var w2 = new World(fake);
                w2.Req("busy", "a"); w2.S.MarkStarted("busy");
                w2.T = 1; w2.Req("low", "a", prio: 0); w2.T = 2; w2.Req("high", "a", prio: 7); w2.T = 3; w2.Req("low2", "a", prio: 0);
                Eq("high,low,low2", string.Join(",", w2.S.Queued.Select(a => a.Req.RequestId)), "priorité puis arrivée");
            });

            // ---------- Protocole ----------
            Case("protocole : enveloppe (JSON, version, commande, identifiant)", () =>
            {
                Eq("bad_json", Throws<ProtocolError>(() => Protocol.ParseLine("{x")), "JSON");
                Eq("unsupported_version", Throws<ProtocolError>(() => Protocol.ParseLine("{\"v\":1,\"cmd\":\"ping\"}")), "version");
                Eq("unknown_command", Throws<ProtocolError>(() => Protocol.ParseLine("{\"v\":2,\"cmd\":\"format_c\"}")), "commande");
                Eq("bad_id", Throws<ProtocolError>(() => Protocol.ParseLine("{\"v\":2,\"cmd\":\"ping\",\"id\":\"a b\"}")), "identifiant");
                Eq("ping", Protocol.ParseLine("{\"v\":2,\"cmd\":\"ping\",\"id\":\"c-1\"}").Name, "valide");
                // Toute commande servie par le moteur doit être dans la liste du protocole (sinon « commande inconnue »).
                foreach (var cmd in new[] { "effect.activate", "effect.stop", "targets.list", "config.set" })
                    Eq(cmd, Protocol.ParseLine("{\"v\":2,\"cmd\":\"" + cmd + "\",\"id\":\"c-2\"}").Name, cmd + " acceptée");
            });
            Case("protocole : demande d'effet validée (identifiant, effet, source, interne, priorité, préréglage, cible)", () =>
            {
                var cfg = new ConfigStore(reg, null);
                Func<Dictionary<string, object>, EffectDef, TargetRef> target = (t, d) => new TargetRef { Key = "window:1", Kind = "window" };
                Func<Dictionary<string, object>, string> code = b => Throws<ProtocolError>(() => Protocol.BuildRequest(b, reg, cfg, target));
                Eq("bad_request_id", code(J.Map("effect", "flip")), "request_id");
                Eq("unknown_effect", code(J.Map("request_id", "r", "effect", "nope")), "effet");
                Eq("invalid_source", code(J.Map("request_id", "r", "effect", "flip", "source", J.Map("kind", "pirate"))), "source");
                Eq("internal_effect", code(J.Map("request_id", "r", "effect", "diag.tint", "source", J.Map("kind", "core"))), "effet interne depuis le Core");
                Eq("invalid_priority", code(J.Map("request_id", "r", "effect", "flip", "priority", 1.5)), "priorité");
                Eq("unknown_preset", code(J.Map("request_id", "r", "effect", "flip", "preset", "absent")), "préréglage");
                // Couche Entrées (expérimentale) : jamais pour une activation communautaire, même activée.
                Func<Dictionary<string, object>, EffectDef, TargetRef> screen = (t, d) => new TargetRef { Key = "monitor:x", Kind = "monitor", Info = J.Map("kind", "monitor", "input", "invert_xy") };
                var fromCore = Protocol.BuildRequest(J.Map("request_id", "c", "effect", "flip", "source", J.Map("kind", "core")), reg, cfg, screen);
                var fromStudio = Protocol.BuildRequest(J.Map("request_id", "s", "effect", "flip", "source", J.Map("kind", "studio")), reg, cfg, screen);
                True(J.Str(fromCore.TargetInfo, "input", null) == null && J.Str(fromCore.TargetInfo, "input_blocked", "") == "source_core" && J.Str(fromStudio.TargetInfo, "input", null) == "invert_xy",
                    "retournement par Windows refusé aux sources communautaires (calque GPU à la place), permis à Studio");
                var req = Protocol.BuildRequest(J.Map("request_id", "r", "effect", "flip", "source", J.Map("kind", "core", "ref", "achat-42"), "priority", 3), reg, cfg, target);
                True(req.SourceKind == "core" && req.SourceRef == "achat-42" && req.Priority == 3 && req.TargetKey == "window:1", "demande complète");
                var ev = Protocol.Event("effect.started", 5, J.Map("request_id", "r"));
                True((int)ev["v"] == 2 && (string)ev["type"] == "event" && (string)ev["event"] == "effect.started", "événement normalisé");
            });

            Console.WriteLine("Total : " + ok + " ok, " + ko + " KO");
            return ko == 0 ? 0 : 1;
        }
    }
}
