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

        /// Une passe de l'effet : un filtre OBS (passe sur l'image, ou calque composé sur l'image).
        public sealed class Op
        {
            public string Shader; public bool Overlay;
            public readonly List<float[]> Frames = new List<float[]>();
        }

        public sealed class Recording
        {
            public readonly List<Op> Ops = new List<Op>();
            public readonly List<string> Warnings = new List<string>();
            public string Refusal;
            public int Count;
        }

        /// Joue l'activation d'avance (60 images/s, de 0 à la fin de la sortie) et relève les constantes de chaque passe.
        public static Recording Record(EffectPreview.Sim sim, uint w, uint h)
        {
            var rec = new Recording();
            var fb = new FrameBuilder(w, h, true);
            int n = (int)Math.Ceiling(sim.Total * Rate / 1000.0) + 1;
            var seen = new HashSet<string>();
            for (int k = 0; k < n && rec.Refusal == null; k++)
            {
                long t = (long)Math.Round(k * 1000.0 / Rate);
                fb.Reset(w, h, true);
                sim.Render(fb, t);
                if (fb.RetainCount > 0) { rec.Refusal = "image retenue (flash) : pas encore exportée"; break; }
                var frame = new List<KeyValuePair<Op, float[]>>();
                for (int i = 0; i < fb.PassCount; i++)
                {
                    var p = fb.PassAt(i);
                    if (p.Aux != IntPtr.Zero) { rec.Refusal = "seconde texture (" + p.Shader + ")"; break; }
                    var v = new float[Slots];
                    Array.Copy(p.U, 0, v, 0, 16); Array.Copy(p.U, 16, v, 32, 16);
                    v[24] = t / 1000f; v[26] = 1; v[27] = p.Lod;
                    if (p.NeedsBlurredInput && seen.Add("mips:" + p.Shader))
                        rec.Warnings.Add(p.Shader + " lit des niveaux de flou (mips) : approchés dans OBS par 9 lectures");
                    frame.Add(new KeyValuePair<Op, float[]>(new Op { Shader = p.Shader }, v));
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
                    frame.Add(new KeyValuePair<Op, float[]>(new Op { Shader = l.Shader, Overlay = true }, v));
                }
                if (rec.Refusal != null) break;
                // Même suite de passes à chaque image (ou aucune : image intacte) : sinon, pas de filtres fixes possibles.
                if (frame.Count > 0)
                {
                    if (rec.Ops.Count == 0) foreach (var kv in frame) rec.Ops.Add(kv.Key);
                    else if (frame.Count != rec.Ops.Count || frame.Where((kv, i) => kv.Key.Shader != rec.Ops[i].Shader || kv.Key.Overlay != rec.Ops[i].Overlay).Any())
                    { rec.Refusal = "suite de passes variable à " + t + " ms"; break; }
                }
                // Les passes déjà connues reçoivent leur image (ou une image « éteinte » quand l'effet ne dessine rien).
                while (rec.Ops.Count > 0 && rec.Ops[0].Frames.Count < k) foreach (var op in rec.Ops) op.Frames.Add(new float[Slots]);
                for (int i = 0; i < rec.Ops.Count; i++)
                {
                    float[] v = frame.Count > 0 ? frame[i].Value : new float[Slots];
                    v[16] = 0; v[17] = 0; v[18] = 1; v[19] = 1;
                    v[On] = frame.Count > 0 ? 1 : 0;
                    rec.Ops[i].Frames.Add(v);
                }
                rec.Count = k + 1;
            }
            if (rec.Refusal == null && rec.Ops.Count == 0) rec.Refusal = "l'effet ne dessine rien";
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
            s.Append("uniform texture2d chaos_track;\nuniform float chaos_frames = 0.0;\nuniform float chaos_rate = 60.0;\nuniform float chaos_time = -1.0;\n");
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
	float t = chaos_time >= 0.0 ? chaos_time : elapsed_time_enable;
	float x = floor(t * chaos_rate + 0.5);
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
