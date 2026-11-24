// Export d'un effet Chaos en filtres OBS (obs-shaderfilter 2.6.1, effet complet chargé depuis un fichier) posés sur la
// source gameplay : l'effet s'applique à cette source AVANT la composition, la webcam et les alertes restent intactes
// au-dessus. Le moteur reste le cerveau, OBS le pinceau :
// - chaque passe de l'effet devient un filtre dont le shader EST celui du moteur (même corps HLSL, réécrit
//   mécaniquement : les constantes arrivent en paramètre au lieu d'un cbuffer) ;
// - la logique image par image (C#, graine, entrée et sortie animées) est jouée d'avance à 60 images/s ; chaque constante
//   qui varie devient une ligne d'une « partition » (PNG sans perte : un flottant 32 bits sur deux pixels), les autres
//   sont des réglages fixes du filtre. OBS lit la partition au temps écoulé depuis l'activation du filtre.
// Étude, limites et mesures : docs/chaos/OBS_SOURCE_GAMEPLAY.md.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace Raptoru.Chaos
{
    static class ObsExport
    {
        public const int Rate = 60;
        // Constantes du moteur (cbuffer Frame, Gpu.CbFloats = 48) puis celles de l'export : ext.x = passe active.
        static readonly string[] Vecs = { "u0", "u1", "u2", "u3", "rect", "view", "misc", "color", "u4", "u5", "u6", "u7", "ext" };
        const int Slots = 52, On = 48;

        /// Une passe de l'effet : un filtre OBS (passe sur l'image, ou calque composé sur l'image). Clé stable : shader,
        /// nature et rang parmi les passes du même shader (« transform », « transform#2 », « fog@calque »).
        public sealed class Op
        {
            public string Shader, Key; public bool Overlay;
            public readonly List<float[]> Frames = new List<float[]>();
        }

        public sealed class Recording
        {
            public readonly List<Op> Ops = new List<Op>();
            public readonly List<string> Warnings = new List<string>();
            public string Refusal;
            public int Count;
        }

        static float[] Off() { return new float[Slots]; }

        /// Joue l'activation d'avance à 60 images/s, de fromMs (temps de l'effet) à la fin de la sortie, ou aux seuls
        /// instants donnés (plan), et relève les constantes de chaque passe. Une passe absente d'une image y est
        /// « éteinte » (le filtre rend l'image intacte) : la suite de passes peut varier pendant l'effet.
        public static Recording Record(EffectPreview.Sim sim, uint w, uint h, long fromMs = 0, IList<long> only = null)
        {
            var rec = new Recording();
            var fb = new FrameBuilder(w, h, true);
            int n = only != null ? only.Count : (int)Math.Ceiling(Math.Max(0, sim.Total - fromMs) * Rate / 1000.0) + 1;
            var seen = new HashSet<string>();
            var byKey = new Dictionary<string, Op>();
            var counts = new Dictionary<string, int>();
            var present = new HashSet<Op>();
            for (int k = 0; k < n && rec.Refusal == null; k++)
            {
                long t = only != null ? only[k] : fromMs + (long)Math.Round(k * 1000.0 / Rate);
                fb.Reset(w, h, true);
                sim.Render(fb, t);
                if (fb.RetainCount > 0) { rec.Refusal = "image retenue (flash) : pas d'image figée dans un filtre OBS sans état"; break; }
                counts.Clear(); present.Clear();
                Action<string, bool, float[]> add = (shader, overlay, v) =>
                {
                    string baseKey = shader + (overlay ? "@calque" : "");
                    int c; counts.TryGetValue(baseKey, out c); counts[baseKey] = ++c;
                    string key = c == 1 ? baseKey : baseKey + "#" + c;
                    Op op;
                    if (!byKey.TryGetValue(key, out op))
                    {
                        byKey[key] = op = new Op { Shader = shader, Overlay = overlay, Key = key };
                        rec.Ops.Add(op);
                        while (op.Frames.Count < k) op.Frames.Add(Off());
                    }
                    v[16] = 0; v[17] = 0; v[18] = 1; v[19] = 1; v[On] = 1;
                    op.Frames.Add(v);
                    present.Add(op);
                };
                for (int i = 0; i < fb.PassCount && rec.Refusal == null; i++)
                {
                    var p = fb.PassAt(i);
                    if (p.Aux != IntPtr.Zero) { rec.Refusal = "seconde texture (" + p.Shader + ")"; break; }
                    var v = new float[Slots];
                    Array.Copy(p.U, 0, v, 0, 16); Array.Copy(p.U, 16, v, 32, 16);
                    v[24] = t / 1000f; v[26] = 1; v[27] = p.Lod;
                    if (p.NeedsBlurredInput && seen.Add("mips:" + p.Shader))
                        rec.Warnings.Add(p.Shader + " lit des niveaux de flou (mips) : approchés dans OBS par 9 lectures");
                    add(p.Shader, false, v);
                }
                for (int i = 0; i < fb.LayerCount && rec.Refusal == null; i++)
                {
                    var l = fb.LayerAt(i);
                    if (l.Shader == null) { rec.Refusal = "calque forme ou image (curseur, texte) : non exporté"; break; }
                    if (l.Aux != IntPtr.Zero) { rec.Refusal = "seconde texture (" + l.Shader + ")"; break; }
                    var v = new float[Slots];
                    Array.Copy(l.U, 0, v, 0, 16); Array.Copy(l.U, 16, v, 32, 16);
                    for (int c = 0; c < 4; c++) v[28 + c] = c < l.Color.Length ? l.Color[c] : 1;
                    v[24] = t / 1000f; v[26] = (float)Math.Max(0, Math.Min(1, l.Opacity));
                    if (l.Scale < 0.999 && seen.Add("scale:" + l.Shader))
                        rec.Warnings.Add(l.Shader + " : calque rendu par le moteur à " + Math.Round(l.Scale * 100) + " % de la résolution, à 100 % dans OBS");
                    add(l.Shader, true, v);
                }
                if (rec.Refusal != null) break;
                foreach (var op in rec.Ops) if (!present.Contains(op)) op.Frames.Add(Off());
                rec.Count = k + 1;
            }
            // Ordre des filtres : passes sur l'image d'abord, calques ensuite (le moteur pose ses calques après ses passes).
            var sorted = rec.Ops.OrderBy(o => o.Overlay ? 1 : 0).ToList();
            rec.Ops.Clear(); rec.Ops.AddRange(sorted);
            if (rec.Refusal == null && rec.Ops.Count == 0 && only == null) rec.Refusal = "l'effet ne dessine rien";
            return rec;
        }

        // ---------- Réécriture du shader du moteur pour OBS ----------
        static readonly Regex FuncDef = new Regex(@"(?m)^[ \t]*(?!(?:else|return|if|for|while|switch|do)\b)([A-Za-z_]\w*)[ \t]+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(:\s*\w+\s*)?\{");
        static readonly Regex GlobalRef = new Regex(@"(?<![\w.])(u[0-7]|rect|view|misc|color)(?!\w)");
        static readonly Regex Shadow = new Regex(@"\b(?:float[234]?|int|uint|bool|half[234]?)\s+(u[0-7]|rect|view|misc|color|chaos_c)\b");

        sealed class Fn { public int Start, Open, End; public string Name; public bool NeedsC; }

        /// Helpers + corps du shader du moteur → code OBS : chaque fonction qui lit une constante (u0…u7, rect, view, misc,
        /// color), directement ou par une fonction appelée, reçoit « CC chaos_c » ; les textures et l'échantillonneur sont
        /// ceux d'OBS ; une lecture d'un niveau de flou (mips, absents dans OBS) passe par chaos_lod. Lève une exception si
        /// le corps déclare une variable du nom d'une constante (réécriture ambiguë).
        public static string Rewrite(string code, out HashSet<string> usedVecs)
        {
            code = code.Replace("\r\n", "\n");
            var fns = new List<Fn>();
            foreach (Match m in FuncDef.Matches(code))
            {
                int open = m.Index + m.Length - 1, depth = 0, i = open;
                for (; i < code.Length; i++) { if (code[i] == '{') depth++; else if (code[i] == '}' && --depth == 0) break; }
                fns.Add(new Fn { Start = m.Index, Open = open, End = i, Name = m.Groups[2].Value });
            }
            Func<Fn, string> bodyOf = f => code.Substring(f.Open, f.End - f.Open + 1);
            foreach (var f in fns)
            {
                var sh = Shadow.Match(code.Substring(f.Start, f.End - f.Start + 1));
                if (sh.Success) throw new InvalidOperationException("réécriture OBS : « " + sh.Groups[1].Value + " » déclarée dans " + f.Name);
                f.NeedsC = GlobalRef.IsMatch(bodyOf(f));
            }
            for (bool changed = true; changed;)
            {
                changed = false;
                foreach (var f in fns)
                    if (!f.NeedsC && fns.Any(g => g.NeedsC && g != f && Regex.IsMatch(bodyOf(f), @"\b" + g.Name + @"\s*\(")))
                    { f.NeedsC = true; changed = true; }
            }
            var calls = fns.Where(f => f.NeedsC).Select(f => f.Name).ToList();
            var callRe = calls.Count == 0 ? null : new Regex(@"\b(" + string.Join("|", calls) + @")\s*\(\s*(\))?");
            usedVecs = new HashSet<string>();
            var sb = new StringBuilder();
            int pos = 0;
            foreach (var f in fns)
            {
                sb.Append(code, pos, f.Start - pos);
                var head = FuncDef.Match(code, f.Start);
                string args = head.Groups[3].Value.Trim();
                if (f.NeedsC) args = args.Length == 0 ? "CC chaos_c" : "CC chaos_c, " + args;
                sb.Append(head.Groups[1].Value).Append(' ').Append(f.Name).Append('(').Append(args).Append(")\n");
                string body = bodyOf(f);
                var used = usedVecs;
                body = GlobalRef.Replace(body, m => { used.Add(m.Groups[1].Value); return "chaos_c." + m.Groups[1].Value; });
                if (callRe != null) body = callRe.Replace(body, m => m.Groups[1].Value + (m.Groups[2].Success ? "(chaos_c)" : "(chaos_c, "));
                sb.Append(body);
                pos = f.End + 1;
            }
            sb.Append(code, pos, code.Length - pos);
            string r = sb.ToString();
            r = Regex.Replace(r, @"\bsrc\.SampleLevel\(\s*smp\s*,", "chaos_lod(");
            r = Regex.Replace(r, @"(?<![\w.])src(?!\w)", "image");
            r = Regex.Replace(r, @"(?<![\w.])smp(?!\w)", "chaos_smp");
            return r;
        }

        static string F(double v) { return v.ToString("R", CultureInfo.InvariantCulture); }

        /// Fichier .effect complet d'une passe (obs-shaderfilter, « override_entire_effect ») : en-tête OBS, partition,
        /// code du moteur réécrit, sortie (passe opaque, ou calque prémultiplié composé sur l'image).
        public static string EffectText(string shader, bool overlay, string title, out HashSet<string> usedVecs)
        {
            string body = ShaderLibrary.Body(shader);
            if (body == null) throw new InvalidOperationException("shader inconnu : " + shader);
            string code = Rewrite(ShaderLibrary.Helpers + "\n" + body, out usedVecs);
            usedVecs.Add("ext");
            var s = new StringBuilder();
            s.Append("// Raptoru Chaos (Studio) — ").Append(title).Append(" : shader « ").Append(shader).Append(" » du moteur.\n");
            s.Append("// Généré par ChaosEngine.exe --obs-export ; Studio le règle pendant un effet. Ne pas modifier.\n");
            s.Append("uniform float4x4 ViewProj;\nuniform texture2d image;\nuniform float elapsed_time_enable;\nuniform float2 uv_size;\n");
            s.Append("uniform float local_time;\nuniform texture2d chaos_track;\nuniform float chaos_frames = 0.0;\nuniform float chaos_rate = 60.0;\nuniform float chaos_time = -1.0;\n");
            // Session : début de la partition (temps de l'effet, s) ; fenêtre de validité en horloge système (s depuis le
            // démarrage de Windows, l'horloge d'OBS) : un filtre resté actif ne rejoue jamais un effet expiré (OBS relancé,
            // Studio absent).
            s.Append("uniform float chaos_t_base = 0.0;\nuniform float chaos_since = 0.0;\nuniform float chaos_expires = 0.0;\n");
            for (int v = 0; v < Vecs.Length; v++)
            {
                if (!usedVecs.Contains(Vecs[v]) || Vecs[v] == "rect" || Vecs[v] == "view") continue;
                for (int c = 0; c < 4; c++) s.Append("uniform float chaos_k").Append(v * 4 + c).Append(";\nuniform float chaos_r").Append(v * 4 + c).Append(";\n");
            }
            s.Append(@"
sampler_state chaos_smp { Filter = Linear; AddressU = Clamp; AddressV = Clamp; };
sampler_state chaos_pt { Filter = Point; AddressU = Clamp; AddressV = Clamp; };
struct V { float4 pos : POSITION; float2 uv : TEXCOORD0; };
struct CC { float4 u0; float4 u1; float4 u2; float4 u3; float4 rect; float4 view; float4 misc; float4 color; float4 u4; float4 u5; float4 u6; float4 u7; float4 ext; };

V VSChaos(V v_in)
{
	V o;
	o.pos = mul(float4(v_in.pos.xyz, 1.0), ViewProj);
	o.uv = v_in.uv;
	return o;
}

// Partition : ligne r = pixels (x, 2r) et (x, 2r + 1), octets d'un flottant 32 bits (R, V, B puis R).
float chaos_load(float row, float x)
{
	int2 p = int2((int)x, (int)row * 2);
	float4 a = chaos_track.Load(int3(p, 0));
	float4 b = chaos_track.Load(int3(p.x, p.y + 1, 0));
	uint u = (uint)(a.r * 255.0 + 0.5) | ((uint)(a.g * 255.0 + 0.5) << 8) | ((uint)(a.b * 255.0 + 0.5) << 16) | ((uint)(b.r * 255.0 + 0.5) << 24);
	return asfloat(u);
}
float chaos_val(float k, float r, float x)
{
	[branch] if (r < 0.5)
		return k;
	return chaos_load(r - 1.0, x);
}
// Niveau de flou (mip) : OBS n'en a pas pour la source ; approché par 9 lectures sur un rayon de 2^niveau pixels.
float4 chaos_lod(float2 uv, float lod)
{
	[branch] if (lod < 0.05)
		return image.SampleLevel(chaos_smp, uv, 0);
	float2 d = exp2(lod) * 0.75 / uv_size;
	float4 s = 4.0 * image.SampleLevel(chaos_smp, uv, 0);
	s += 2.0 * (image.SampleLevel(chaos_smp, uv + float2(d.x, 0), 0) + image.SampleLevel(chaos_smp, uv - float2(d.x, 0), 0)
	          + image.SampleLevel(chaos_smp, uv + float2(0, d.y), 0) + image.SampleLevel(chaos_smp, uv - float2(0, d.y), 0));
	s += image.SampleLevel(chaos_smp, uv + d, 0) + image.SampleLevel(chaos_smp, uv - d, 0)
	   + image.SampleLevel(chaos_smp, uv + float2(d.x, -d.y), 0) + image.SampleLevel(chaos_smp, uv + float2(-d.x, d.y), 0);
	return s / 16.0;
}
CC chaos_constants(float x)
{
	CC c;
");
            for (int v = 0; v < Vecs.Length; v++)
            {
                string name = Vecs[v];
                s.Append("\tc.").Append(name).Append(" = ");
                if (name == "rect") s.Append("float4(0.0, 0.0, 1.0, 1.0)");
                else if (name == "view") s.Append("float4(uv_size, uv_size)");
                else if (!usedVecs.Contains(name)) s.Append("float4(0.0, 0.0, 0.0, 0.0)");
                else
                {
                    s.Append("float4(");
                    for (int c = 0; c < 4; c++) s.Append(c > 0 ? ", " : "").Append("chaos_val(chaos_k").Append(v * 4 + c).Append(", chaos_r").Append(v * 4 + c).Append(", x)");
                    s.Append(")");
                }
                s.Append(";\n");
            }
            s.Append("\treturn c;\n}\n\n").Append(code.Trim()).Append("\n\n");
            s.Append(@"float4 PSChaos(V v_in) : TARGET
{
	float4 base = image.Sample(chaos_smp, v_in.uv);
	if (chaos_expires > 0.0 && (local_time > chaos_expires || local_time < chaos_since))
		return base;
	float t = chaos_time >= 0.0 ? chaos_time : elapsed_time_enable;
	float x = floor(max(0.0, t - chaos_t_base) * chaos_rate + 0.5);
	if (x >= chaos_frames)
		return base;
	CC c = chaos_constants(x);
	if (c.ext.x < 0.5)
		return base;
	float4 o = ps(c, v_in);
");
            s.Append(overlay ? "\treturn float4(o.rgb + (1.0 - o.a) * base.rgb, base.a);\n" : "\treturn float4(o.rgb, base.a);\n");
            s.Append("}\n\ntechnique Draw\n{\n\tpass\n\t{\n\t\tvertex_shader = VSChaos(v_in);\n\t\tpixel_shader = PSChaos(v_in);\n\t}\n}\n");
            return s.ToString();
        }

        /// Partition d'une passe (PNG 24 bits sans perte) et réglages du filtre : constantes fixes (chaos_kN) et, pour
        /// celles qui varient, leur ligne dans la partition + 1 (chaos_rN ; 0 = fixe).
        static Dictionary<string, object> Track(Op op, HashSet<string> used, string file)
        {
            var settings = new Dictionary<string, object>();
            var rows = new List<int>();
            var on = op.Frames.Where(f => f[On] > 0.5).ToList();
            for (int v = 0; v < Vecs.Length; v++)
            {
                if (!used.Contains(Vecs[v]) || Vecs[v] == "rect" || Vecs[v] == "view") continue;
                for (int c = 0; c < 4; c++)
                {
                    int sl = v * 4 + c;
                    float first = on.Count > 0 ? on[0][sl] : 0;
                    bool varies = sl == On ? op.Frames.Any(f => f[On] != op.Frames[0][On]) : on.Any(f => f[sl] != first);
                    if (sl == On && !varies) first = op.Frames[0][On];
                    settings["chaos_k" + sl] = (double)first;
                    if (varies) { rows.Add(sl); settings["chaos_r" + sl] = (double)rows.Count; }
                    else settings["chaos_r" + sl] = 0.0;
                }
            }
            int w = op.Frames.Count, h = Math.Max(2, rows.Count * 2);
            using (var bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb))
            {
                var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
                var line = new byte[data.Stride];
                for (int y = 0; y < h; y++)
                {
                    Array.Clear(line, 0, line.Length);
                    int r = y / 2;
                    if (r < rows.Count)
                        for (int x = 0; x < w; x++)
                        {
                            var b = BitConverter.GetBytes(op.Frames[x][rows[r]]);
                            // Mémoire GDI+ : B, V, R.
                            if (y % 2 == 0) { line[x * 3 + 2] = b[0]; line[x * 3 + 1] = b[1]; line[x * 3] = b[2]; }
                            else line[x * 3 + 2] = b[3];
                        }
                    Marshal.Copy(line, 0, new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), line.Length);
                }
                bmp.UnlockBits(data);
                bmp.Save(file, ImageFormat.Png);
            }
            settings["chaos_track"] = Path.GetFullPath(file).Replace('\\', '/');
            settings["chaos_frames"] = (double)w;
            settings["chaos_rate"] = (double)Rate;
            settings["chaos_time"] = -1.0;
            return settings;
        }

        // ---------- Sessions (moteur en marche) : une activation, deux sorties ----------
        static string Safe(string s) { return Regex.Replace(s ?? "", @"[^A-Za-z0-9_.\-]", "_"); }
        static double QpcSeconds() { return N.QpcNow() / (double)N.QpcFreq(); }
        /// Marge de la fenêtre de validité d'une session : démarrage (attente de la première image, 20 s au plus), puis
        /// décalage OBS / moteur et arrêt par Studio.
        const double StartAllowanceS = 22, EndMarginS = 3;

        /// Sortie OBS d'une activation : la même réplique (paramètres résolus, graine, entrée et sortie) jouée de fromMs à
        /// la fin de sa sortie (qui commence à exitAtMs), une partition par passe, et les réglages à poser sur chaque filtre.
        /// refusal : effet impossible dans un filtre OBS (flash), sans fichier écrit.
        public static Dictionary<string, object> Session(ResolvedParams p, int seed, Gpu gpu, ShaderLibrary lib, TextRaster text,
            uint w, uint h, long fromMs, long exitAtMs, string dir, string requestId, bool starting, out string refusal)
        {
            var sim = new EffectPreview.Sim(p, seed, gpu, lib, text, w, h, exitAtMs);
            Recording rec;
            try { rec = Record(sim, w, h, fromMs); }
            finally { sim.Fx.Dispose(); }
            refusal = rec.Refusal;
            if (refusal != null) return null;
            Directory.CreateDirectory(dir);
            double now = QpcSeconds(), span = (sim.Total - fromMs) / 1000.0;
            var filters = new List<object>();
            foreach (var op in rec.Ops)
            {
                HashSet<string> used;
                EffectText(op.Shader, op.Overlay, op.Shader, out used);
                var act = Track(op, used, Path.Combine(dir, Safe(requestId) + "-" + (fromMs > 0 ? fromMs + "-" : "") + Safe(op.Key) + ".png"));
                act["chaos_t_base"] = fromMs / 1000.0;
                act["chaos_since"] = now - 2;
                act["chaos_expires"] = now + span + (starting ? StartAllowanceS : 0) + EndMarginS;
                filters.Add(J.Map("key", p.Def.Id + ":" + op.Key, "shader", op.Shader, "kind", op.Overlay ? "overlay" : "filter", "settings", act));
            }
            return J.Map("filters", filters.ToArray(), "frames", rec.Count, "from_ms", fromMs, "exit_at_ms", exitAtMs, "total_ms", sim.Total,
                "warnings", rec.Warnings.ToArray());
        }

        /// Partitions de plus d'une heure : supprimées (une session dure au plus quelques minutes).
        public static void Clean(string dir)
        {
            try
            {
                if (!Directory.Exists(dir)) return;
                foreach (var f in Directory.GetFiles(dir, "*.png"))
                    if (File.GetLastWriteTimeUtc(f) < DateTime.UtcNow.AddHours(-1)) File.Delete(f);
            }
            catch (Exception) { }
        }

        static readonly Dictionary<string, string> Roles = new Dictionary<string, string>
        {
            { "transform", "cadrage" }, { "drunk", "déformation" }, { "tunnel", "voile" }, { "eyelids", "paupières" }, { "fog", "brouillard" },
            { "blur", "flou" }, { "pixelate", "pixels" }, { "color", "couleur" }, { "vhs", "VHS" }
        };

        /// Plan des filtres OBS (préparation dans Studio) : pour chaque effet public, ses passes possibles (toutes
        /// variantes et tous niveaux, relevées à quelques instants), le nom de chaque filtre (espace « Raptoru Chaos V2 »,
        /// distinct des filtres V1), son fichier .effect (un par shader, nom = empreinte du contenu : un shader changé =
        /// un nouveau fichier, rechargé par shaderfilter) et sa place dans la chaîne. Effet impossible : sa raison.
        public static Dictionary<string, object> Plan(Registry reg, Gpu gpu, ShaderLibrary lib, TextRaster text, string dir)
        {
            Directory.CreateDirectory(dir);
            var safety = new SafetyConfig { MaxDurationMs = reg.Limits.MaxDurationMs };
            var effects = new Dictionary<string, object>();
            var passes = new List<object[]>();   // ordre de la chaîne : passes (par ordre des effets), puis calques
            var files = new Dictionary<string, string>();
            var hashes = new List<string>();
            foreach (var def in reg.Effects.Values.Where(d => !d.Internal).OrderBy(d => d.Order).ThenBy(d => d.Id))
            {
                var ops = new List<Op>();
                var warnings = new HashSet<string>();
                string refusal = null;
                var variants = new List<string> { null }; variants.AddRange(def.Variants.Keys);
                var levels = new List<string> { null }; levels.AddRange(def.Levels.Select(kv => kv.Key));
                foreach (var v in variants)
                    foreach (var l in levels)
                    {
                        if (refusal != null) break;
                        var p = Params.Resolve(def, v, null, null, null, null, reg.Limits, safety, true, l);
                        var sim = new EffectPreview.Sim(p, 4242, gpu, lib, text, 160, 90, -1);
                        Recording rec;
                        var at = new List<long> { 150, 400, 900, 1800, 3500, p.DurationMs / 2, Math.Max(0, p.DurationMs - 200), p.DurationMs + 100 };
                        try { rec = Record(sim, 160, 90, 0, at.Distinct().OrderBy(x => x).ToList()); }
                        finally { sim.Fx.Dispose(); }
                        if (rec.Refusal != null) { refusal = rec.Refusal; break; }
                        foreach (var w in rec.Warnings) warnings.Add(w);
                        foreach (var op in rec.Ops) if (!ops.Any(o => o.Key == op.Key)) ops.Add(op);
                    }
                var list = new List<object>();
                if (refusal == null)
                {
                    ops = ops.OrderBy(o => o.Overlay ? 1 : 0).ToList();
                    foreach (var op in ops)
                    {
                        string fk = op.Shader + (op.Overlay ? "-calque" : "");
                        string file;
                        if (!files.TryGetValue(fk, out file))
                        {
                            HashSet<string> used;
                            string textFx = EffectText(op.Shader, op.Overlay, op.Shader, out used);
                            string hash;
                            using (var sha = System.Security.Cryptography.SHA1.Create())
                                hash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(textFx))).Replace("-", "").Substring(0, 10).ToLowerInvariant();
                            file = Path.Combine(dir, fk + "-" + hash + ".effect");
                            if (!File.Exists(file)) File.WriteAllText(file, textFx, new UTF8Encoding(false));
                            files[fk] = file = Path.GetFullPath(file).Replace('\\', '/');
                            hashes.Add(hash);
                        }
                        string role;
                        if (!Roles.TryGetValue(op.Shader, out role)) role = op.Shader;
                        int hashIdx = op.Key.IndexOf('#');
                        string name = "Raptoru Chaos V2 · " + def.Label + (ops.Count > 1 ? " · " + role + (hashIdx > 0 ? " " + op.Key.Substring(hashIdx + 1) : "") : "");
                        var f = J.Map("key", def.Id + ":" + op.Key, "name", name, "shader", op.Shader, "kind", op.Overlay ? "overlay" : "filter", "effect_file", file);
                        list.Add(f);
                        passes.Add(new object[] { op.Overlay ? 1 : 0, f });
                    }
                }
                effects[def.Id] = J.Map("label", def.Label, "available", refusal == null, "reason", refusal, "warnings", warnings.ToArray(), "filters", list.ToArray());
            }
            int order = 0;
            foreach (var pf in passes.OrderBy(x => (int)x[0])) ((Dictionary<string, object>)pf[1])["order"] = order++;
            hashes.Sort(StringComparer.Ordinal);
            string version;
            using (var sha = System.Security.Cryptography.SHA1.Create())
                version = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(string.Join(",", hashes)))).Replace("-", "").Substring(0, 12).ToLowerInvariant();
            return J.Map("version", version, "dir", Path.GetFullPath(dir).Replace('\\', '/'), "effects", effects);
        }

        /// --obs-export <effet> <variante|-> --out <dossier> [--level --seed --duration-ms --params JSON --w --h
        /// --refs t1,t2,… (secondes : images du moteur sur la scène de jeu de synthèse, pour comparer avec OBS)].
        /// Écrit un .effect par passe, sa partition, et manifest.json (filtres, réglages d'activation, avertissements).
        public static int Run(string effect, string variant, string outDir, string level, int seed, int? durationMs, string paramsJson, uint w, uint h, string refs)
        {
            var reg = Registry.Embedded();
            EffectDef def;
            if (!reg.Effects.TryGetValue(effect, out def)) { Console.Error.WriteLine("effet inconnu : " + effect); return 2; }
            if (variant == "-") variant = null;
            Directory.CreateDirectory(outDir);
            var rig = new EffectPreview.Rig(w, h, refs != null);
            var overrides = string.IsNullOrEmpty(paramsJson) ? null : J.Parse(paramsJson);
            var sim = new EffectPreview.Sim(reg, rig, def, variant, seed, null, level ?? EffectPreview.DefaultLevel, overrides, durationMs);
            var rec = Record(sim, w, h);
            sim.Fx.Dispose();
            var filters = new List<object>();
            if (rec.Refusal == null)
                for (int i = 0; i < rec.Ops.Count; i++)
                {
                    var op = rec.Ops[i];
                    string title = def.Label + (rec.Ops.Count > 1 ? " (" + (i + 1) + "/" + rec.Ops.Count + ")" : "");
                    string stem = effect + (rec.Ops.Count > 1 ? "-" + (i + 1) : "") + "-" + op.Shader;
                    HashSet<string> used;
                    string text = EffectText(op.Shader, op.Overlay, title, out used);
                    string fx = Path.Combine(outDir, stem + ".effect");
                    File.WriteAllText(fx, text, new UTF8Encoding(false));
                    var act = Track(op, used, Path.Combine(outDir, stem + "-track.png"));
                    filters.Add(J.Map("name", "Raptoru Chaos · " + title, "shader", op.Shader, "kind", op.Overlay ? "overlay" : "filter",
                        "effect_file", Path.GetFullPath(fx).Replace('\\', '/'), "activation", act,
                        "track_rows", act.Count(kv => kv.Key.StartsWith("chaos_r") && (double)kv.Value > 0)));
                }
            var refList = new List<object>();
            if (refs != null && rec.Refusal == null)
            {
                // Scène fixe (première position de la caméra) : OBS la reçoit en image, le moteur la rend avec l'effet.
                SavePng(rig, rig.Src, Path.Combine(outDir, "scene.png"));
                var sim2 = new EffectPreview.Sim(reg, rig, def, variant, seed, null, level ?? EffectPreview.DefaultLevel, overrides, durationMs);
                var fb = new FrameBuilder(w, h, true);
                var want = refs.Split(',').Select(x => (int)Math.Round(double.Parse(x, CultureInfo.InvariantCulture) * Rate)).OrderBy(x => x).ToList();
                int wi = 0;
                for (int k = 0; k < rec.Count && wi < want.Count; k++)
                {
                    long t = (long)Math.Round(k * 1000.0 / Rate);
                    fb.Reset(w, h, true);
                    sim2.Render(fb, t);
                    if (k != want[wi]) continue;
                    fb.Execute(rig.Gpu, rig.Lib, rig.Pool, null, rig.SrcSrv, rig.OutRtv, t, t / 1000f);
                    string file = Path.Combine(outDir, "ref-" + k.ToString("0000") + ".png");
                    SavePng(rig, rig.Out, file);
                    refList.Add(J.Map("frame", k, "t", k / (double)Rate, "file", Path.GetFileName(file)));
                    wi++;
                }
                sim2.Fx.Dispose();
            }
            var manifest = J.Map("effect", effect, "label", def.Label, "variant", variant, "level", sim.P.Level, "seed", seed,
                "duration_ms", sim.P.DurationMs, "total_ms", sim.Total, "rate", Rate, "frames", rec.Count, "size", new[] { w, h },
                "refusal", rec.Refusal, "warnings", rec.Warnings.ToArray(), "filters", filters.ToArray(), "refs", refList.ToArray(),
                "scene", refs != null && rec.Refusal == null ? "scene.png" : null);
            File.WriteAllText(Path.Combine(outDir, "manifest.json"), J.Write(manifest), new UTF8Encoding(false));
            Console.WriteLine(J.Write(J.Map("effect", effect, "filters", filters.Count, "frames", rec.Count, "refusal", rec.Refusal, "warnings", rec.Warnings.ToArray())));
            return rec.Refusal == null ? 0 : 3;
        }

        static void SavePng(EffectPreview.Rig rig, IntPtr tex, string file)
        {
            var staging = rig.Gpu.Texture(rig.W, rig.H, 1, 0, 0, 3, 0x20000);
            rig.Gpu.Copy(staging, tex, 0, 0, rig.W, rig.H);
            var px = rig.Gpu.ReadBack(staging, rig.W, rig.H);
            Com.Release(ref staging);
            using (var bmp = new Bitmap((int)rig.W, (int)rig.H, PixelFormat.Format24bppRgb))
            {
                var data = bmp.LockBits(new Rectangle(0, 0, (int)rig.W, (int)rig.H), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
                var line = new byte[data.Stride];
                for (int y = 0; y < rig.H; y++)
                {
                    for (int x = 0; x < rig.W; x++) { int i = (int)(y * rig.W + x) * 4; line[x * 3] = px[i]; line[x * 3 + 1] = px[i + 1]; line[x * 3 + 2] = px[i + 2]; }
                    Marshal.Copy(line, 0, new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), line.Length);
                }
                bmp.UnlockBits(data);
                bmp.Save(file, ImageFormat.Png);
            }
        }
    }
}
