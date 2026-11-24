// Runtime des effets : cycle de vie standard prepare → start → update/render → stop → dispose, chaque appel isolé.
// Un effet en erreur est arrêté seul (état Failed, ressources libérées, événement effect.failed) ; les autres continuent.
// Un effet ne gère ni capture, ni fenêtre, ni durée, ni transition : il lit ses paramètres (déjà validés, animés par
// le moteur de transitions) et décrit son image avec les primitives du FrameBuilder.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Raptoru.Chaos
{
    /// Ce qu'un effet reçoit à chaque image.
    sealed class EffectFrame
    {
        public ResolvedParams P;
        public double Presence;   // 0 = absent, 1 = entier (entrée et sortie animées par le moteur)
        public long NowMs, ElapsedMs;
        public uint Width, Height;
        /// Graine de l'activation : variations « aléatoires » reproductibles, différentes d'un déclenchement à l'autre.
        public int Seed;
        /// Sortie en cours (fin de durée, arrêt) : Presence descend vers 0.
        public bool Exiting;

        /// Valeur d'un paramètre animable selon la présence (neutre → cible) ; sinon sa valeur.
        public double Animated(string id)
        {
            var d = P.Def.Param(id);
            double target = P.Num(id);
            if (d == null || !d.Animatable) return target;
            return Animator.Lerp(Convert.ToDouble(d.Neutral, CultureInfo.InvariantCulture), target, Presence);
        }
    }

    sealed class EffectContext
    {
        public Gpu Gpu;
        public ShaderLibrary Shaders;
        public TextRaster Text;
        public ResolvedParams P;
        public int Seed;
    }

    abstract class Effect
    {
        public virtual void Prepare(EffectContext c) { }
        /// Faux : l'effet n'a plus besoin de la capture (flash : image retenue) ; le moteur la rend.
        public virtual bool NeedsCapture { get { return true; } }
        public virtual void Start() { }
        public virtual void Update(EffectFrame f) { }
        public abstract void Render(FrameBuilder fb, EffectFrame f);
        public virtual void Stop() { }
        public virtual void Dispose() { }
    }

    enum InstanceState { Created, Prepared, Running, Stopped, Disposed, Failed }

    /// Couche Entrées d'une instance : aucune, à appliquer (après l'entrée animée), appliquée, rétablie.
    enum InputPhase { None, Pending, Applied, Released }

    sealed class EffectInstance
    {
        public readonly Activation A;
        public readonly Effect Impl;
        public InstanceState State = InstanceState.Created;
        public int Seed;
        public string Error;
        public long VisibleSince = -1;
        // Couche Entrées (écran entier) : pendant l'effet, Windows tient l'écran retourné et le calque se retire
        // (HandedOff : ni fenêtre ni capture) ; il revient juste avant la sortie pour le retour animé.
        public InputPhase Input;
        public string InputDevice;
        public bool HoldsCapture, HandedOff;
        public long ExitPrepAt = -1;
        /// Ce que l'effet reçoit à chaque image (réutilisé : aucune allocation par image).
        public readonly EffectFrame Frame = new EffectFrame();
        public EffectInstance(Activation a, Effect impl) { A = a; Impl = impl; }

        /// Arrêt immédiat de l'instance (erreur ou refus du moteur), ressources libérées.
        public void Fail(string error)
        {
            Error = error;
            State = InstanceState.Failed;
            try { Impl.Dispose(); } catch (Exception) { }
        }

        /// Exécute une étape du cycle de vie ; une exception rend l'instance Failed sans rien propager.
        public bool Guard(string phase, Action step)
        {
            if (State == InstanceState.Failed || State == InstanceState.Disposed) return false;
            try { step(); return true; }
            catch (Exception e)
            {
                Fail(phase + " : " + e.GetType().Name + " " + e.Message);
                return false;
            }
        }

        public void Finish()
        {
            if (State == InstanceState.Running || State == InstanceState.Prepared) Guard("stop", () => { Impl.Stop(); State = InstanceState.Stopped; });
            if (State != InstanceState.Disposed && State != InstanceState.Failed) Guard("dispose", () => { Impl.Dispose(); State = InstanceState.Disposed; });
        }
    }

    /// Implémentations disponibles, par identifiant du registre. Ajouter un effet = une ligne ici + son entrée dans
    /// packages/schemas/src/chaos-registry.json (le moteur refuse de démarrer si les deux divergent).
    static class EffectCatalog
    {
        static readonly Dictionary<string, Func<Effect>> Factories = new Dictionary<string, Func<Effect>>
        {
            { "flip", () => new FlipEffect() },
            { "mirror", () => new MirrorEffect() },
            { "shake", () => new ShakeEffect() },
            { "zoom", () => new ZoomEffect() },
            { "drunk", () => new DrunkEffect() },
            { "tunnel", () => new TunnelEffect() },
            { "blink", () => new BlinkEffect() },
            { "flash", () => new FlashEffect() },
            { "fog", () => new FogEffect() },
            { "blur", () => new BlurEffect() },
            { "pixelate", () => new PixelateEffect() },
            { "color", () => new ColorEffect() },
            { "vhs", () => new VhsEffect() },
            { "diag.tint", () => new DiagTintEffect() },
            { "diag.watermark", () => new DiagWatermarkEffect() },
            { "diag.passes", () => new DiagPassesEffect() },
            { "diag.marker", () => new DiagMarkerEffect() },
            { "diag.fault", () => new DiagFaultEffect() },
        };

        public static IEnumerable<string> Implemented { get { return Factories.Keys; } }
        public static Effect Create(string id) { return Factories[id](); }

        /// Graine stable d'une activation (FNV-1a de son identifiant) : même demande → même motif.
        public static int SeedOf(string requestId)
        {
            unchecked
            {
                uint h = 2166136261;
                foreach (char ch in requestId ?? "") { h ^= ch; h *= 16777619; }
                return (int)(h & 0x7FFFFFFF);
            }
        }

        /// Écarts entre registre et implémentations (vide = cohérent).
        public static List<string> Mismatches(Registry reg)
        {
            var l = reg.Effects.Keys.Where(k => !Factories.ContainsKey(k)).Select(k => "déclaré sans implémentation : " + k).ToList();
            l.AddRange(Factories.Keys.Where(k => reg.Get(k) == null).Select(k => "implémenté sans déclaration : " + k));
            return l;
        }
    }
}
