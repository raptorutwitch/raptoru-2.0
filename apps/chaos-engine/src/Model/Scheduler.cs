// Ordonnanceur des effets : logique pure et déterministe (horloge injectée), sans GPU ni interface.
// Règles :
//  - un emplacement du registre (transform, filter, overlay…) accepte au plus max_active effets par cible ;
//  - un même effet ne joue qu'une fois par cible ;
//  - plafond global : min(registre.max_active_effects, sécurité.max_active_effects) ;
//  - en cas de conflit, la politique (demande, sinon registre) décide : queue, replace, reject, extend ;
//  - la file est triée par remplacement en cours, priorité décroissante, puis ordre d'arrivée ; elle expire (TTL) ;
//  - un effet « démarré » l'est quand le moteur a affiché sa première image (MarkStarted) : la durée compte de là ;
//  - un effet qui sort occupe encore son emplacement (pas de chevauchement visuel avec son remplaçant) ;
//  - STOP ALL coupe tout, sans transition ; Cancel termine par la transition de sortie (ou coupe si immediate).
// Chaque changement produit un événement (accepted, queued, started, extended, ended, failed, canceled, expired,
// rejected, duplicate) : le protocole les publie tels quels (Studio aujourd'hui, le Core demain).
using System;
using System.Collections.Generic;
using System.Linq;

namespace Raptoru.Chaos
{
    enum ActState { Queued, Starting, Active, Exiting, Finished }

    sealed class EffectRequest
    {
        public string RequestId, Variant, PresetName, Policy, TargetKey;
        public string SourceKind = "test", SourceRef;
        public int Priority;
        public EffectDef Def;
        public ResolvedParams Resolved;
        public Dictionary<string, object> TargetInfo = new Dictionary<string, object>();
        public IntPtr TargetHwnd;
        public bool TargetMonitor;
    }

    sealed class Activation
    {
        public EffectRequest Req;
        public EffectDef Def { get { return Req.Def; } }
        public ActState State;
        public long CreatedAt, AcceptedAt = -1, StartedAt = -1, EndAt = long.MaxValue, FinishedAt = -1;
        public Animator Anim;
        public string EndReason, Outcome;
        public bool Replacing;
        public int PendingExtraMs, Extensions;
        public long VisibleMs;
    }

    sealed class SchedEvent
    {
        public string Kind;
        public Activation A;
        public Dictionary<string, object> Data = new Dictionary<string, object>();
    }

    sealed class Scheduler
    {
        public const int StartTimeoutMs = 20000, RecentIds = 512;
        readonly Registry reg;
        readonly Func<long> now;
        readonly Func<SafetyConfig> safety;
        readonly List<Activation> live = new List<Activation>();
        readonly Dictionary<string, Activation> byId = new Dictionary<string, Activation>();
        readonly Queue<string> recent = new Queue<string>();
        public readonly List<SchedEvent> Events = new List<SchedEvent>();

        public Scheduler(Registry reg, Func<long> now, Func<SafetyConfig> safety) { this.reg = reg; this.now = now; this.safety = safety; }

        public IEnumerable<Activation> Live { get { return live; } }
        public IEnumerable<Activation> Running { get { return live.Where(a => a.State == ActState.Starting || a.State == ActState.Active || a.State == ActState.Exiting); } }
        public IEnumerable<Activation> Queued { get { return Ordered(live.Where(a => a.State == ActState.Queued)); } }
        public Activation Find(string requestId) { Activation a; return requestId != null && byId.TryGetValue(requestId, out a) ? a : null; }

        SchedEvent Emit(string kind, Activation a, params object[] kv)
        {
            var e = new SchedEvent { Kind = kind, A = a };
            for (int i = 0; i + 1 < kv.Length; i += 2) e.Data[(string)kv[i]] = kv[i + 1];
            Events.Add(e);
            return e;
        }

        public List<SchedEvent> Drain() { var l = Events.ToList(); Events.Clear(); return l; }

        int Capacity { get { return Math.Min(reg.Limits.MaxActive, safety().MaxActiveEffects); } }

        static IEnumerable<Activation> Ordered(IEnumerable<Activation> q)
        {
            return q.OrderByDescending(a => a.Replacing).ThenByDescending(a => a.Req.Priority).ThenBy(a => a.CreatedAt);
        }

        /// Ce qui empêche « a » de démarrer maintenant (liste vide = peut démarrer).
        List<Activation> Blockers(Activation a, out string why)
        {
            why = null;
            var onTarget = Running.Where(x => x.Req.TargetKey == a.Req.TargetKey).ToList();
            var same = onTarget.Where(x => x.Def.Id == a.Def.Id).ToList();
            if (same.Count > 0) { why = "same_effect_active"; return same; }
            var slot = onTarget.Where(x => x.Def.SlotId == a.Def.SlotId).ToList();
            if (slot.Count >= a.Def.Slot.MaxActive) { why = "slot_busy"; return slot; }
            if (Running.Count() >= Capacity) { why = "capacity"; return Running.ToList(); }
            return new List<Activation>();
        }

        public Activation Submit(EffectRequest r)
        {
            var existing = Find(r.RequestId);
            if (existing != null) { Emit("duplicate", existing); return existing; }
            var a = new Activation { Req = r, State = ActState.Queued, CreatedAt = now() };
            Remember(a);
            string why;
            var blockers = Blockers(a, out why);
            if (blockers.Count == 0) { Activate(a); return a; }
            string policy = r.Policy ?? a.Def.OnConflict;
            switch (policy)
            {
                case "reject":
                    Finish(a, "rejected", why);
                    return a;
                case "extend":
                    var same = Running.FirstOrDefault(x => x.Req.TargetKey == r.TargetKey && x.Def.Id == r.Def.Id && x.State != ActState.Exiting);
                    if (same != null)
                    {
                        Extend(same, r.Resolved.DurationMs, a);
                        return a;
                    }
                    break;
                case "replace":
                    if (why != "capacity" && blockers.All(b => b.Req.Priority <= r.Priority))
                    {
                        foreach (var b in blockers) BeginExit(b, "replaced");
                        a.Replacing = true;
                    }
                    break;
            }
            if (live.Count(x => x.State == ActState.Queued) >= reg.Limits.MaxQueue) { Finish(a, "rejected", "queue_full"); return a; }
            live.Add(a);
            Emit("queued", a, "position", Ordered(live.Where(x => x.State == ActState.Queued)).ToList().IndexOf(a) + 1, "blocked_by", why);
            TryDequeue();
            return a;
        }

        void Remember(Activation a)
        {
            byId[a.Req.RequestId] = a;
            recent.Enqueue(a.Req.RequestId);
            while (recent.Count > RecentIds)
            {
                string old = recent.Dequeue();
                Activation o;
                if (byId.TryGetValue(old, out o) && o.State == ActState.Finished) byId.Remove(old);
            }
        }

        void Activate(Activation a)
        {
            if (!live.Contains(a)) live.Add(a);
            a.State = ActState.Starting;
            a.AcceptedAt = now();
            a.Anim = new Animator(a.Req.Resolved.In, a.Req.Resolved.Out);
            Emit("accepted", a);
        }

        void Extend(Activation target, int ms, Activation by)
        {
            int max = Math.Min(reg.Limits.MaxDurationMs, safety().MaxDurationMs);
            if (target.State == ActState.Active)
            {
                long cap = target.StartedAt + max;
                target.EndAt = Math.Min(target.EndAt + ms, cap);
            }
            else target.PendingExtraMs = Math.Min(target.PendingExtraMs + ms, max - target.Req.Resolved.DurationMs);
            target.Extensions++;
            Finish(by, "merged", "extended " + target.Req.RequestId);
            Emit("extended", target, "by", by.Req.RequestId, "end_in_ms", target.State == ActState.Active ? target.EndAt - now() : -1);
        }

        /// Le moteur a affiché la première image de l'effet : la durée commence.
        public void MarkStarted(string requestId)
        {
            var a = Find(requestId);
            if (a == null || a.State != ActState.Starting) return;
            long t = now();
            a.State = ActState.Active;
            a.StartedAt = t;
            a.EndAt = t + a.Req.Resolved.DurationMs + a.PendingExtraMs;
            a.Anim.Start(t);
            Emit("started", a);
        }

        public void MarkFailed(string requestId, string reason, string detail)
        {
            var a = Find(requestId);
            if (a == null || a.State == ActState.Finished) return;
            if (a.Anim != null) a.Anim.Cut();
            Finish(a, "failed", reason, detail);
        }

        public bool Cancel(string requestId, bool immediate, string reason)
        {
            var a = Find(requestId);
            if (a == null || a.State == ActState.Finished) return false;
            if (a.State == ActState.Queued || a.State == ActState.Starting || immediate)
            {
                if (a.Anim != null) a.Anim.Cut();
                Finish(a, a.State == ActState.Queued ? "canceled" : "ended", reason ?? "canceled");
            }
            else BeginExit(a, reason ?? "canceled");
            TryDequeue();
            return true;
        }

        /// Arrêt général : la file est vidée, tout ce qui joue est coupé sans transition.
        public int StopAll(string reason)
        {
            var all = live.ToList();
            foreach (var a in all)
            {
                if (a.Anim != null) a.Anim.Cut();
                Finish(a, a.State == ActState.Queued ? "canceled" : "ended", reason);
            }
            return all.Count;
        }

        void BeginExit(Activation a, string reason)
        {
            if (a.State == ActState.Exiting || a.State == ActState.Finished) return;
            if (a.State != ActState.Active) { if (a.Anim != null) a.Anim.Cut(); Finish(a, "ended", reason); return; }
            a.State = ActState.Exiting;
            a.EndReason = reason;
            a.Anim.BeginExit(now());
            if (a.Anim.Done(now())) Finish(a, "ended", reason);
        }

        void Finish(Activation a, string outcome, string reason, string detail = null)
        {
            if (a.State == ActState.Finished) return;
            a.State = ActState.Finished;
            a.FinishedAt = now();
            a.Outcome = outcome;
            a.EndReason = reason;
            live.Remove(a);
            var e = Emit(outcome, a, "reason", reason);
            if (detail != null) e.Data["detail"] = detail;
        }

        /// Avance le temps : fins de durée, sorties terminées, démarrages trop longs, file expirée, puis départs.
        public void Tick()
        {
            long t = now();
            foreach (var a in live.ToList())
            {
                switch (a.State)
                {
                    case ActState.Queued:
                        if (t - a.CreatedAt > reg.Limits.QueueTtlMs) Finish(a, "expired", "queue_ttl");
                        break;
                    case ActState.Starting:
                        if (t - a.AcceptedAt > StartTimeoutMs) Finish(a, "failed", "start_timeout");
                        break;
                    case ActState.Active:
                        if (t >= a.EndAt) BeginExit(a, "duration");
                        break;
                    case ActState.Exiting:
                        if (a.Anim.Done(t)) Finish(a, "ended", a.EndReason);
                        break;
                }
            }
            TryDequeue();
        }

        void TryDequeue()
        {
            foreach (var q in Ordered(live.Where(x => x.State == ActState.Queued)).ToList())
            {
                string why;
                if (Blockers(q, out why).Count == 0) Activate(q);
            }
        }
    }
}
