// Protocole v2 du moteur (JSON, une ligne par message, stdin/stdout). Contrat écrit : docs/chaos/CONTRATS_MOTEUR.md.
//   Commande : {"v":2,"id":"<corrélation>","cmd":"<nom>", ...corps}
//   Réponse  : {"v":2,"type":"response","id":…,"ok":true,"result":{…}} | {"ok":false,"error":{"code","message"}}
//   Événement: {"v":2,"type":"event","event":"<nom>","t_ms":…, …}
// Les demandes d'effet sont idempotentes par request_id (une même demande rejouée rend son état, sans doublon).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Raptoru.Chaos
{
    sealed class ProtocolError : Exception
    {
        public readonly string Code;
        public string Id; // identifiant de corrélation, quand il a pu être lu
        public ProtocolError(string code, string message) : base(message) { Code = code; }
    }

    sealed class Command
    {
        public string Id, Name;
        public Dictionary<string, object> Body;
    }

    /// Cible résolue par l'hôte (Win32) : clé stable et informations d'affichage.
    sealed class TargetRef
    {
        public string Key, Kind;
        public IntPtr Hwnd;
        public Dictionary<string, object> Info = new Dictionary<string, object>();
    }

    static class Protocol
    {
        public const int Version = 2;
        public static readonly string[] Commands =
        {
            "hello", "ping", "describe", "status", "diagnostics", "targets.list", "effect.request", "effect.cancel", "stop_all",
            "config.get", "config.set", "config.reset", "preset.set", "preset.delete", "shutdown"
        };
        public static readonly string[] Sources = { "studio", "core", "extension", "channel_points", "test" };
        public static readonly string[] Policies = { "queue", "replace", "reject", "extend" };
        static readonly Regex IdRe = new Regex("^[A-Za-z0-9_.:\\-]{1,80}$");

        public static Command ParseLine(string line)
        {
            Dictionary<string, object> d;
            try { d = J.Parse(line); } catch (Exception) { throw new ProtocolError("bad_json", "ligne JSON illisible"); }
            string id = J.Str(d, "id", null);
            if (id != null && !IdRe.IsMatch(id)) throw new ProtocolError("bad_id", "identifiant de corrélation invalide");
            int v = (int)J.Num(d, "v", 0);
            if (v != Version) throw new ProtocolError("unsupported_version", "protocole v" + Version + " attendu (reçu v" + v + ")") { Id = id };
            string name = J.Str(d, "cmd", null);
            if (name == null || !Commands.Contains(name)) throw new ProtocolError("unknown_command", "commande inconnue : " + (name ?? "?")) { Id = id };
            return new Command { Id = id, Name = name, Body = d };
        }

        /// Construit une demande validée. resolveTarget transforme la cible demandée en cible réelle (ou lève ProtocolError).
        public static EffectRequest BuildRequest(Dictionary<string, object> b, Registry reg, ConfigStore cfg, Func<Dictionary<string, object>, EffectDef, TargetRef> resolveTarget)
        {
            string rid = J.Str(b, "request_id", null);
            if (rid == null || !IdRe.IsMatch(rid)) throw new ProtocolError("bad_request_id", "request_id obligatoire (1 à 80 caractères A-Z a-z 0-9 _ . : -)");
            var def = reg.Get(J.Str(b, "effect", null));
            if (def == null) throw new ProtocolError("unknown_effect", "effet inconnu : " + J.Str(b, "effect", "?"));
            var src = J.Obj(b, "source");
            string kind = J.Str(src, "kind", "test");
            if (!Sources.Contains(kind)) throw new ProtocolError("invalid_source", "source inconnue : " + kind);
            if (def.Internal && kind != "test" && kind != "studio") throw new ProtocolError("internal_effect", def.Id + " est réservé aux tests");
            string policy = J.Str(b, "policy", null);
            if (policy != null && !Policies.Contains(policy)) throw new ProtocolError("invalid_policy", "politique inconnue : " + policy);
            double prio = J.Num(b, "priority", 0);
            if (prio < -100 || prio > 100 || prio != Math.Floor(prio)) throw new ProtocolError("invalid_priority", "priorité entière de -100 à 100");
            string presetName = J.Str(b, "preset", null);
            Preset preset = cfg.GetPreset(def.Id, presetName ?? "default");
            if (presetName != null && preset == null) throw new ProtocolError("unknown_preset", "préréglage inconnu : " + presetName);
            int? dur = J.Has(b, "duration_ms") ? (int?)(int)J.Num(b, "duration_ms", -1) : null;
            // Les sources externes (Core, extension, points de chaîne) ne règlent jamais un paramètre non exposé.
            bool trusted = kind == "studio" || kind == "test";
            var resolved = Params.Resolve(def, J.Str(b, "variant", null), preset, J.Obj(b, "params"), dur, J.Obj(b, "transition"), reg.Limits, cfg.Safety, trusted);
            var target = resolveTarget(J.Obj(b, "target") ?? J.Map("kind", "foreground"), def);
            return new EffectRequest
            {
                RequestId = rid, Def = def, Variant = J.Str(b, "variant", null), PresetName = presetName, Policy = policy, Priority = (int)prio,
                SourceKind = kind, SourceRef = J.Str(src, "ref", null), Resolved = resolved, TargetKey = target.Key, TargetInfo = target.Info,
                TargetHwnd = target.Hwnd, TargetMonitor = target.Kind == "monitor"
            };
        }

        public static Dictionary<string, object> Response(string id, object result)
        {
            return J.Map("v", Version, "type", "response", "id", id, "ok", true, "result", result);
        }
        public static Dictionary<string, object> Error(string id, string code, string message)
        {
            return J.Map("v", Version, "type", "response", "id", id, "ok", false, "error", J.Map("code", code, "message", message));
        }
        public static Dictionary<string, object> Event(string name, long t, Dictionary<string, object> data)
        {
            var d = J.Map("v", Version, "type", "event", "event", name, "t_ms", t);
            if (data != null) foreach (var kv in data) d[kv.Key] = kv.Value;
            return d;
        }

        /// Vue publique d'une activation (réponses, événements, status).
        public static Dictionary<string, object> View(Activation a, long now)
        {
            var r = a.Req;
            var d = J.Map(
                "request_id", r.RequestId, "effect", a.Def.Id, "effect_version", a.Def.Version, "state", a.State.ToString().ToLowerInvariant(),
                "source", J.Map("kind", r.SourceKind, "ref", r.SourceRef), "priority", r.Priority, "target", r.TargetInfo,
                "variant", r.Variant, "preset", r.PresetName, "resolved", r.Resolved.ToJson(), "started", a.StartedAt >= 0);
            if (a.StartedAt >= 0) d["running_ms"] = (a.FinishedAt >= 0 ? a.FinishedAt : now) - a.StartedAt;
            if (a.State == ActState.Active && a.EndAt != long.MaxValue) d["remaining_ms"] = Math.Max(0, a.EndAt - now);
            if (a.Outcome != null) { d["outcome"] = a.Outcome; d["reason"] = a.EndReason; }
            if (a.FinishedAt >= 0) d["visible_ms"] = a.VisibleMs;
            return d;
        }

        /// Événement public d'un changement d'état (nommé effect.<kind>).
        public static Dictionary<string, object> EffectEvent(SchedEvent e, long now)
        {
            var d = View(e.A, now);
            foreach (var kv in e.Data) d[kv.Key] = kv.Value;
            return Event("effect." + e.Kind, now, d);
        }
    }
}
