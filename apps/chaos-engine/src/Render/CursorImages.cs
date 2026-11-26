// Image du vrai curseur de Windows (retournement : docs/chaos/ETUDE_CURSEUR.md) : la forme courante
// (GetCursorInfo) est rendue par Windows lui-même (DrawIconEx) dans une texture BGRA prémultipliée, mise en cache par
// forme. Même principe que la capture du curseur d'OBS (cursor-capture.c). Lecture seule : aucune entrée touchée.
// Alpha : le curseur est rendu sur fond noir puis sur fond blanc ; alpha = 255 − (blanc − noir), couleur = rendu sur
// noir (déjà prémultiplié). Les pixels « inversés » des curseurs monochromes (barre de texte) deviennent blancs opaques.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Raptoru.Chaos
{
    sealed class CursorImages : IDisposable
    {
        [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr h, out ICONINFO ii);
        [DllImport("user32.dll")] static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr icon, int w, int h, uint step, IntPtr brush, uint flags);
        [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, out BITMAP bm);
        [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
        [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFOHEADER bi, uint usage, out IntPtr bits, IntPtr section, uint offset);
        [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
        [DllImport("gdi32.dll")] static extern bool GdiFlush();
        [StructLayout(LayoutKind.Sequential)] struct ICONINFO { public int fIcon, xHotspot, yHotspot; public IntPtr hbmMask, hbmColor; }
        [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public short bmPlanes, bmBitsPixel; public IntPtr bmBits; }
        [StructLayout(LayoutKind.Sequential)]
        struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }

        public sealed class Img { public TextureRef Tex; public int HotX, HotY; }
        readonly Gpu gpu;
        readonly Dictionary<IntPtr, Img> cache = new Dictionary<IntPtr, Img>();
        public int Built;

        public CursorImages(Gpu gpu) { this.gpu = gpu; }

        /// Texture de la forme hCursor (null si illisible).
        public Img Get(IntPtr hCursor)
        {
            Img img;
            if (cache.TryGetValue(hCursor, out img)) return img;
            img = Build(hCursor);
            if (cache.Count > 32) { foreach (var v in cache.Values) if (v != null) v.Tex.Release(); cache.Clear(); }
            cache[hCursor] = img;
            return img;
        }

        Img Build(IntPtr hCursor)
        {
            ICONINFO ii;
            if (!GetIconInfo(hCursor, out ii)) return null;
            try
            {
                BITMAP bm;
                bool color = ii.hbmColor != IntPtr.Zero;
                if (GetObject(color ? ii.hbmColor : ii.hbmMask, Marshal.SizeOf(typeof(BITMAP)), out bm) == 0) return null;
                int w = bm.bmWidth, h = color ? bm.bmHeight : bm.bmHeight / 2;
                if (w <= 0 || h <= 0 || w > 512 || h > 512) return null;
                byte[] onBlack = Render(hCursor, w, h, 0), onWhite = Render(hCursor, w, h, 255);
                if (onBlack == null || onWhite == null) return null;
                var px = new byte[w * h * 4];
                for (int i = 0; i < px.Length; i += 4)
                {
                    int d = ((onWhite[i] - onBlack[i]) + (onWhite[i + 1] - onBlack[i + 1]) + (onWhite[i + 2] - onBlack[i + 2])) / 3;
                    int a = Math.Max(0, Math.Min(255, 255 - d));
                    px[i] = (byte)Math.Min(a, (int)onBlack[i]); px[i + 1] = (byte)Math.Min(a, (int)onBlack[i + 1]); px[i + 2] = (byte)Math.Min(a, (int)onBlack[i + 2]);
                    px[i + 3] = (byte)a;
                }
                var tex = gpu.TextureWithData((uint)w, (uint)h, px);
                Built++;
                return new Img { Tex = new TextureRef { Tex = tex, Srv = gpu.Srv(tex), W = w, H = h }, HotX = ii.xHotspot, HotY = ii.yHotspot };
            }
            finally
            {
                if (ii.hbmMask != IntPtr.Zero) DeleteObject(ii.hbmMask);
                if (ii.hbmColor != IntPtr.Zero) DeleteObject(ii.hbmColor);
            }
        }

        /// Rendu du curseur par Windows sur un fond uni (0 noir, 255 blanc), pixels BGRA de haut en bas.
        static byte[] Render(IntPtr hCursor, int w, int h, byte background)
        {
            IntPtr dc = CreateCompatibleDC(IntPtr.Zero), bits, dib;
            var bi = new BITMAPINFOHEADER { biSize = Marshal.SizeOf(typeof(BITMAPINFOHEADER)), biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
            dib = CreateDIBSection(dc, ref bi, 0, out bits, IntPtr.Zero, 0);
            if (dib == IntPtr.Zero) { DeleteDC(dc); return null; }
            IntPtr old = SelectObject(dc, dib);
            try
            {
                var fill = new byte[w * h * 4];
                if (background != 0) for (int i = 0; i < fill.Length; i++) fill[i] = background;
                Marshal.Copy(fill, 0, bits, fill.Length);
                DrawIconEx(dc, 0, 0, hCursor, w, h, 0, IntPtr.Zero, 0x3 /* DI_NORMAL */);
                GdiFlush();
                var r = new byte[w * h * 4];
                Marshal.Copy(bits, r, 0, r.Length);
                return r;
            }
            finally { SelectObject(dc, old); DeleteObject(dib); DeleteDC(dc); }
        }

        public void Dispose() { foreach (var v in cache.Values) if (v != null) v.Tex.Release(); cache.Clear(); }
    }
}
