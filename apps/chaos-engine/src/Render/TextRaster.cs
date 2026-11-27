// Textes et images des calques : rasterisés une fois (GDI+, alpha prémultiplié), envoyés au GPU, mis en cache.
// Un texte identique (contenu, police, taille, couleur) n'est jamais rasterisé deux fois ; rien n'est alloué par image.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Linq;
using System.Runtime.InteropServices;

namespace Raptoru.Chaos
{
    sealed class TextRaster
    {
        const int MaxEntries = 64;
        readonly Gpu gpu;
        readonly Dictionary<string, TextureRef> cache = new Dictionary<string, TextureRef>();
        readonly LinkedList<string> order = new LinkedList<string>();
        public TextRaster(Gpu gpu) { this.gpu = gpu; }
        public int Count { get { return cache.Count; } }

        public TextureRef Text(string text, string font, float sizePx, float[] rgb, bool bold)
        {
            string key = "t|" + text + "|" + font + "|" + sizePx + "|" + string.Join(",", rgb) + "|" + bold;
            TextureRef t;
            if (cache.TryGetValue(key, out t)) { Touch(key); return t; }
            using (var f = new Font(font, sizePx, bold ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Pixel))
            {
                SizeF size;
                using (var probe = new Bitmap(1, 1)) using (var g = Graphics.FromImage(probe)) size = g.MeasureString(text, f);
                int w = Math.Max(1, (int)Math.Ceiling(size.Width) + 4), h = Math.Max(1, (int)Math.Ceiling(size.Height) + 4);
                using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb))
                {
                    using (var g = Graphics.FromImage(bmp))
                    using (var b = new SolidBrush(Color.FromArgb(255, (int)(rgb[0] * 255), (int)(rgb[1] * 255), (int)(rgb[2] * 255))))
                    {
                        g.Clear(Color.Transparent);
                        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.DrawString(text, f, b, 2, 2);
                    }
                    t = Upload(bmp);
                }
            }
            Put(key, t);
            return t;
        }

        public TextureRef Image(string path)
        {
            string key = "i|" + path;
            TextureRef t;
            if (cache.TryGetValue(key, out t)) { Touch(key); return t; }
            using (var src = new Bitmap(path))
            using (var bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppPArgb))
            {
                using (var g = Graphics.FromImage(bmp)) g.DrawImage(src, 0, 0, src.Width, src.Height);
                t = Upload(bmp);
            }
            Put(key, t);
            return t;
        }

        TextureRef Upload(Bitmap bmp)
        {
            var data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
            var bytes = new byte[bmp.Width * bmp.Height * 4];
            for (int y = 0; y < bmp.Height; y++) Marshal.Copy(new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), bytes, y * bmp.Width * 4, bmp.Width * 4);
            bmp.UnlockBits(data);
            var t = new TextureRef { W = bmp.Width, H = bmp.Height, Tex = gpu.TextureWithData((uint)bmp.Width, (uint)bmp.Height, bytes) };
            t.Srv = gpu.Srv(t.Tex);
            return t;
        }

        void Touch(string key) { order.Remove(key); order.AddLast(key); }
        void Put(string key, TextureRef t)
        {
            cache[key] = t; order.AddLast(key);
            while (cache.Count > MaxEntries) { string old = order.First.Value; order.RemoveFirst(); cache[old].Release(); cache.Remove(old); }
        }

        public void Clear() { foreach (var t in cache.Values) t.Release(); cache.Clear(); order.Clear(); }
    }
}
