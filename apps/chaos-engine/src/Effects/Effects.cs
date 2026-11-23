// Les effets. Chacun ne contient que sa logique visuelle ; tout le reste (déclaration, bornes, préréglages, durée,
// transitions, ordonnancement, capture, présentation, arrêt) appartient au moteur. Guide : docs/chaos/GUIDE_EFFETS.md.
using System;

namespace Raptoru.Chaos
{
    /// Écran retourné : une transformation dont l'angle est animé par le moteur (0 → 180° à l'entrée, retour à la sortie).
    sealed class FlipEffect : Effect
    {
        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            fb.Transform(f.Animated("angle") * Math.PI / 180, 1, 1, 0, 0, f.P.Str("fill"));
        }
    }

    /// Diagnostic (interne) : un filtre plein écran enchaîné après une transformation, sur la même capture.
    sealed class DiagTintEffect : Effect
    {
        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var c = f.P.Color("color");
            fb.Filter("tint", new[] { c[0], c[1], c[2], (float)f.Animated("strength") });
        }
    }

    /// Diagnostic (interne) : charge GPU réglable (passes plein écran enchaînées, taps de flou par passe) pour mesurer
    /// le coût des futurs effets multipasses (banc de performances, scénario E).
    sealed class DiagPassesEffect : Effect
    {
        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            int n = (int)f.P.Num("passes");
            float taps = (float)f.P.Num("taps"), k = (float)f.Animated("strength");
            for (int i = 0; i < n; i++) fb.Filter("diag_load", new[] { taps, k });
        }
    }

    /// Diagnostic (interne) : lève une erreur à l'étape choisie, pour prouver qu'un effet en panne s'arrête seul.
    sealed class DiagFaultEffect : Effect
    {
        string phase;
        public override void Prepare(EffectContext c)
        {
            phase = c.P.Str("phase");
            if (phase == "prepare") throw new InvalidOperationException("panne simulée (prepare)");
        }
        public override void Start() { if (phase == "start") throw new InvalidOperationException("panne simulée (start)"); }
        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            if (phase == "render" && f.ElapsedMs >= f.P.Num("after_ms")) throw new InvalidOperationException("panne simulée (render)");
        }
    }

    /// Diagnostic (interne) : calques sans capture (anneau, cadre arrondi, texte), opacité animée.
    sealed class DiagMarkerEffect : Effect
    {
        EffectContext ctx;
        public override void Prepare(EffectContext c) { ctx = c; }

        public override void Render(FrameBuilder fb, EffectFrame f)
        {
            var c = f.P.Color("color");
            double op = f.Animated("opacity"), x = f.P.Num("x"), y = f.P.Num("y");
            double size = 0.18, aspect = fb.Width / (double)fb.Height;
            var ring = Layer.Centered(x, y, size / aspect, size);
            ring.Shape = LayerShape.Ring; ring.StrokePx = 6; ring.Opacity = op; ring.Color = new[] { c[0], c[1], c[2], 1f };
            ring.Rotation = f.ElapsedMs / 1000.0;
            fb.Add(ring);
            var frame = Layer.Centered(x, y, size * 1.6 / aspect, size * 1.6);
            frame.Shape = LayerShape.RoundedRect; frame.RadiusPx = 18; frame.StrokePx = 3; frame.Opacity = op * 0.8; frame.Color = new[] { 1f, 1f, 1f, 1f };
            fb.Add(frame);
            string text = f.P.Str("text");
            if (text.Length > 0)
            {
                var t = ctx.Text.Text(text, "Segoe UI", Math.Max(14, fb.Height / 18f), new[] { 1f, 1f, 1f }, true);
                double th = t.H / (double)fb.Height, tw = t.W / (double)fb.Width;
                var label = Layer.Centered(x, Math.Min(0.95, y + size * 0.9), tw, th);
                label.Texture = t; label.Opacity = op;
                fb.Add(label);
            }
        }
    }
}
