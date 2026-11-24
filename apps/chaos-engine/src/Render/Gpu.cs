// Direct3D 11 : périphérique unique du moteur, ressources, dessin d'une passe et mesure GPU par passe.
// Aucune lecture GPU → CPU par image (seul le contrôle d'image noire lit 16×16 pixels, sans attente, toutes les 2 s).
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Windows.Graphics.DirectX.Direct3D11;

namespace Raptoru.Chaos
{
    sealed class Gpu
    {
        public const int Bgra = 87; // DXGI_FORMAT_B8G8R8A8_UNORM
        public const int CbFloats = 48; // constantes communes à toutes les passes (voir ShaderLibrary.Prelude)

        public IntPtr Device, Context, DxgiDevice, Factory, Adapter3;
        public IDirect3DDevice WinrtDevice;
        public string Adapter = "?";
        IntPtr sampler, cbuffer, cbData, blendOpaque, blendPremul;

        readonly DevCreateTexture2D createTex;
        readonly DevCreateView createSrv, createRtv;
        readonly DevCreateShader createVs, createPs;
        readonly CtxSetViews psSetSrv, psSetSampler, psSetCb, vsSetCb;
        readonly CtxSetShader psSet, vsSet;
        readonly CtxDraw draw;
        readonly CtxMap map;
        readonly CtxUnmap unmap;
        readonly CtxSetInputLayout setLayout;
        readonly CtxSetTopology setTopology;
        readonly CtxSetRenderTargets setRt;
        readonly CtxSetViewports setVp;
        readonly CtxSetBlendState setBlend;
        readonly CtxCopyRegion copyRegion;
        readonly CtxUpdateSubresource update;
        readonly CtxGenerateMips genMips;
        readonly CtxClearRtv clear;
        internal readonly CtxAsync Begin, End;
        internal readonly CtxGetData GetData;
        internal readonly DevCreateQuery CreateQuery;

        public Gpu()
        {
            IntPtr dev, ctx; int level;
            Com.Check(N.D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0x20 /* BGRA */, IntPtr.Zero, 0, 7, out dev, out level, out ctx), "D3D11CreateDevice");
            Device = dev; Context = ctx;
            createTex = Com.Fn<DevCreateTexture2D>(dev, 5); createSrv = Com.Fn<DevCreateView>(dev, 7); createRtv = Com.Fn<DevCreateView>(dev, 9);
            createVs = Com.Fn<DevCreateShader>(dev, 12); createPs = Com.Fn<DevCreateShader>(dev, 15); CreateQuery = Com.Fn<DevCreateQuery>(dev, 24);
            vsSetCb = Com.Fn<CtxSetViews>(ctx, 7); psSetSrv = Com.Fn<CtxSetViews>(ctx, 8); psSet = Com.Fn<CtxSetShader>(ctx, 9);
            psSetSampler = Com.Fn<CtxSetViews>(ctx, 10); vsSet = Com.Fn<CtxSetShader>(ctx, 11); draw = Com.Fn<CtxDraw>(ctx, 13);
            map = Com.Fn<CtxMap>(ctx, 14); unmap = Com.Fn<CtxUnmap>(ctx, 15); psSetCb = Com.Fn<CtxSetViews>(ctx, 16);
            setLayout = Com.Fn<CtxSetInputLayout>(ctx, 17); setTopology = Com.Fn<CtxSetTopology>(ctx, 24);
            Begin = Com.Fn<CtxAsync>(ctx, 27); End = Com.Fn<CtxAsync>(ctx, 28); GetData = Com.Fn<CtxGetData>(ctx, 29);
            setRt = Com.Fn<CtxSetRenderTargets>(ctx, 33); setBlend = Com.Fn<CtxSetBlendState>(ctx, 35); setVp = Com.Fn<CtxSetViewports>(ctx, 44);
            copyRegion = Com.Fn<CtxCopyRegion>(ctx, 46); update = Com.Fn<CtxUpdateSubresource>(ctx, 48); clear = Com.Fn<CtxClearRtv>(ctx, 50);
            genMips = Com.Fn<CtxGenerateMips>(ctx, 54);

            // La capture écrit dans les textures de ce périphérique depuis un autre fil.
            try { IntPtr mt = Com.QI(ctx, Iid.D3D11Multithread); Com.Fn<MtSetProtected>(mt, 5)(mt, 1); Com.Release(ref mt); } catch (Exception) { }
            DxgiDevice = Com.QI(dev, Iid.DxgiDevice);
            try { IntPtr d1 = Com.QI(dev, Iid.DxgiDevice1); Com.Fn<DxgiDevSetMaxLatency>(d1, 12)(d1, 1); Com.Release(ref d1); } catch (Exception) { }
            IntPtr adapter;
            Com.Check(Com.Fn<DxgiDevGetAdapter>(DxgiDevice, 7)(DxgiDevice, out adapter), "GetAdapter");
            DXGI_ADAPTER_DESC ad;
            if (Com.Fn<AdapterGetDesc>(adapter, 8)(adapter, out ad) >= 0) Adapter = ad.Description;
            try { Adapter3 = Com.QI(adapter, Iid.DxgiAdapter3); } catch (Exception) { Adapter3 = IntPtr.Zero; }
            Guid fid = Iid.DxgiFactory2;
            Com.Check(Com.Fn<ObjGetParent>(adapter, 6)(adapter, ref fid, out Factory), "GetParent(IDXGIFactory2)");
            Com.Release(ref adapter);
            IntPtr insp;
            Com.Check(N.CreateDirect3D11DeviceFromDXGIDevice(DxgiDevice, out insp), "CreateDirect3D11DeviceFromDXGIDevice");
            WinrtDevice = (IDirect3DDevice)Marshal.GetObjectForIUnknown(insp);
            Marshal.Release(insp);

            var sd = new D3D11_SAMPLER_DESC { Filter = 0x15 /* MIN_MAG_MIP_LINEAR */, AddressU = 3, AddressV = 3, AddressW = 3, ComparisonFunc = 1, MaxLOD = float.MaxValue };
            Com.Check(Com.Fn<DevCreateSampler>(dev, 23)(dev, ref sd, out sampler), "CreateSamplerState");
            var bd = new D3D11_BUFFER_DESC { ByteWidth = CbFloats * 4, Usage = 0, BindFlags = 0x4 };
            Com.Check(Com.Fn<DevCreateBuffer>(dev, 3)(dev, ref bd, IntPtr.Zero, out cbuffer), "CreateBuffer");
            cbData = Marshal.AllocHGlobal(CbFloats * 4);
            blendOpaque = Blend(false);
            blendPremul = Blend(true);
        }

        IntPtr Blend(bool premultiplied)
        {
            var d = new D3D11_BLEND_DESC { RenderTarget = new D3D11_RENDER_TARGET_BLEND_DESC[8] };
            d.RenderTarget[0] = new D3D11_RENDER_TARGET_BLEND_DESC
            {
                BlendEnable = premultiplied ? 1 : 0, SrcBlend = 2 /* ONE */, DestBlend = 6 /* INV_SRC_ALPHA */, BlendOp = 1,
                SrcBlendAlpha = 2, DestBlendAlpha = 6, BlendOpAlpha = 1, RenderTargetWriteMask = 0xF
            };
            IntPtr s;
            Com.Check(Com.Fn<DevCreateBlendState>(Device, 20)(Device, ref d, out s), "CreateBlendState");
            return s;
        }

        public IntPtr VertexShader(byte[] code) { return Shader(createVs, code); }
        public IntPtr PixelShader(byte[] code) { return Shader(createPs, code); }
        IntPtr Shader(DevCreateShader create, byte[] code)
        {
            var h = GCHandle.Alloc(code, GCHandleType.Pinned);
            try { IntPtr s; Com.Check(create(Device, h.AddrOfPinnedObject(), new IntPtr(code.Length), IntPtr.Zero, out s), "CreateShader"); return s; }
            finally { h.Free(); }
        }

        public IntPtr Texture(uint w, uint h, uint mips, uint bind, uint misc, int usage, uint cpu)
        {
            var d = new D3D11_TEXTURE2D_DESC { Width = w, Height = h, MipLevels = mips, ArraySize = 1, Format = Bgra, SampleCount = 1, Usage = usage, BindFlags = bind, CPUAccessFlags = cpu, MiscFlags = misc };
            IntPtr t;
            Com.Check(createTex(Device, ref d, IntPtr.Zero, out t), "CreateTexture2D " + w + "x" + h);
            return t;
        }
        public IntPtr TextureWithData(uint w, uint h, byte[] bgra)
        {
            var t = Texture(w, h, 1, 0x8, 0, 0, 0);
            var g = GCHandle.Alloc(bgra, GCHandleType.Pinned);
            try { update(Context, t, 0, IntPtr.Zero, g.AddrOfPinnedObject(), w * 4, 0); } finally { g.Free(); }
            return t;
        }
        public IntPtr Srv(IntPtr res) { IntPtr v; Com.Check(createSrv(Device, res, IntPtr.Zero, out v), "CreateShaderResourceView"); return v; }
        public IntPtr Rtv(IntPtr res) { IntPtr v; Com.Check(createRtv(Device, res, IntPtr.Zero, out v), "CreateRenderTargetView"); return v; }

        public IntPtr CompositionSwapChain(uint w, uint h)
        {
            var d = new DXGI_SWAP_CHAIN_DESC1
            {
                Width = w, Height = h, Format = Bgra, SampleCount = 1, BufferUsage = 0x20, BufferCount = 3,
                Scaling = 0, SwapEffect = 3 /* FLIP_SEQUENTIAL */, AlphaMode = 1 /* PREMULTIPLIED */
            };
            IntPtr sc;
            Com.Check(Com.Fn<FactoryCreateForComposition>(Factory, 24)(Factory, Device, ref d, IntPtr.Zero, out sc), "CreateSwapChainForComposition");
            return sc;
        }

        public void Copy(IntPtr dst, IntPtr src, uint x, uint y, uint w, uint h)
        {
            var box = new D3D11_BOX { Left = x, Top = y, Front = 0, Right = x + w, Bottom = y + h, Back = 1 };
            copyRegion(Context, dst, 0, 0, 0, 0, src, 0, ref box);
        }
        /// Copie la région (x, y, w, h) de src en (dx, dy) dans dst (niveau 0).
        public void CopyAt(IntPtr dst, uint dx, uint dy, IntPtr src, uint x, uint y, uint w, uint h)
        {
            var box = new D3D11_BOX { Left = x, Top = y, Front = 0, Right = x + w, Bottom = y + h, Back = 1 };
            copyRegion(Context, dst, 0, dx, dy, 0, src, 0, ref box);
        }
        public void GenerateMips(IntPtr srv) { genMips(Context, srv); }
        static readonly float[] Transparent = new float[4];
        public void Clear(IntPtr rtv, float r, float g, float b, float a)
        {
            clear(Context, rtv, r == 0 && g == 0 && b == 0 && a == 0 ? Transparent : new[] { r, g, b, a });
        }

        /// Prépare une passe : cible, fenêtre d'affichage, mélange (opaque ou alpha prémultiplié).
        public void Target(IntPtr rtv, uint w, uint h, bool blend)
        {
            IntPtr r = rtv; setRt(Context, 1, ref r, IntPtr.Zero);
            var vp = new D3D11_VIEWPORT { Width = w, Height = h, MaxDepth = 1 };
            setVp(Context, 1, ref vp);
            setBlend(Context, blend ? blendPremul : blendOpaque, null, 0xFFFFFFFF);
            setLayout(Context, IntPtr.Zero);
        }

        /// Un dessin : constantes communes, shaders, texture source (facultative), sommets (3 = plein écran, 4 = calque),
        /// seconde texture facultative (aux, register t1 : image retenue).
        public void Draw(IntPtr vs, IntPtr ps, IntPtr srv, float[] cb, uint vertices, IntPtr aux = default(IntPtr))
        {
            Marshal.Copy(cb, 0, cbData, CbFloats);
            update(Context, cbuffer, 0, IntPtr.Zero, cbData, 0, 0);
            setTopology(Context, vertices == 4 ? 5 /* TRIANGLESTRIP */ : 4 /* TRIANGLELIST */);
            vsSet(Context, vs, IntPtr.Zero, 0);
            psSet(Context, ps, IntPtr.Zero, 0);
            IntPtr s = srv; psSetSrv(Context, 0, 1, ref s);
            if (aux != IntPtr.Zero) { IntPtr a = aux; psSetSrv(Context, 1, 1, ref a); }
            IntPtr smp = sampler; psSetSampler(Context, 0, 1, ref smp);
            IntPtr c = cbuffer; psSetCb(Context, 0, 1, ref c); vsSetCb(Context, 0, 1, ref c);
            draw(Context, vertices, 0);
            IntPtr none = IntPtr.Zero; psSetSrv(Context, 0, 1, ref none);
            if (aux != IntPtr.Zero) psSetSrv(Context, 1, 1, ref none);
        }

        public void Unbind() { IntPtr none = IntPtr.Zero; setRt(Context, 1, ref none, IntPtr.Zero); }

        /// Lecture non bloquante d'une petite texture de contrôle : max des canaux RVB, ou -1 si pas encore prête.
        public int MaxChannel(IntPtr staging, int size)
        {
            D3D11_MAPPED_SUBRESOURCE m;
            if (map(Context, staging, 0, 1, 0x100000 /* DO_NOT_WAIT */, out m) < 0) return -1;
            int max = 0;
            var row = new byte[size * 4];
            for (int y = 0; y < size; y++)
            {
                Marshal.Copy(new IntPtr(m.pData.ToInt64() + (long)y * m.RowPitch), row, 0, row.Length);
                for (int i = 0; i < row.Length; i++) if ((i & 3) != 3 && row[i] > max) max = row[i];
            }
            unmap(Context, staging, 0);
            return max;
        }

        /// Lecture bloquante complète (outil d'aperçu hors ligne seulement, jamais pendant un effet).
        public byte[] ReadBack(IntPtr staging, uint w, uint h)
        {
            D3D11_MAPPED_SUBRESOURCE m;
            Com.Check(map(Context, staging, 0, 1, 0, out m), "Map");
            var all = new byte[w * h * 4];
            for (int y = 0; y < h; y++) Marshal.Copy(new IntPtr(m.pData.ToInt64() + (long)y * m.RowPitch), all, (int)(y * w * 4), (int)(w * 4));
            unmap(Context, staging, 0);
            return all;
        }

        /// Mémoire vidéo locale utilisée par ce processus (Mo), -1 si indisponible.
        public double VideoMemoryMB()
        {
            if (Adapter3 == IntPtr.Zero) return -1;
            DXGI_QUERY_VIDEO_MEMORY_INFO info;
            return Com.Fn<Adapter3QueryVideoMemory>(Adapter3, 14)(Adapter3, 0, 0, out info) >= 0 ? Math.Round(info.CurrentUsage / 1048576.0, 1) : -1;
        }
    }

    /// Mesure GPU par passe : requêtes d'horodatage, relues plusieurs images plus tard, sans jamais attendre.
    sealed class GpuTimer
    {
        const int Slots = 64;
        readonly Gpu g;
        readonly IntPtr[] dis = new IntPtr[Slots], t0 = new IntPtr[Slots], t1 = new IntPtr[Slots];
        readonly string[] label = new string[Slots];
        readonly bool[] pending = new bool[Slots];
        readonly IntPtr buf = Marshal.AllocHGlobal(16);
        int slot = -1, next;

        public GpuTimer(Gpu gpu)
        {
            g = gpu;
            for (int i = 0; i < Slots; i++)
            {
                var d = new D3D11_QUERY_DESC { Query = 3 /* TIMESTAMP_DISJOINT */ }; Com.Check(g.CreateQuery(g.Device, ref d, out dis[i]), "CreateQuery");
                d.Query = 2; Com.Check(g.CreateQuery(g.Device, ref d, out t0[i]), "CreateQuery"); Com.Check(g.CreateQuery(g.Device, ref d, out t1[i]), "CreateQuery");
            }
        }

        public void Begin(string name)
        {
            if (slot >= 0 || pending[next]) return; // une mesure à la fois ; anneau plein = mesure sautée
            slot = next; next = (next + 1) % Slots;
            label[slot] = name;
            g.Begin(g.Context, dis[slot]); g.End(g.Context, t0[slot]);
        }

        public void End()
        {
            if (slot < 0) return;
            g.End(g.Context, t1[slot]); g.End(g.Context, dis[slot]);
            pending[slot] = true; slot = -1;
        }

        public void Collect(Action<string, double> into)
        {
            for (int i = 0; i < Slots; i++)
            {
                if (!pending[i] || g.GetData(g.Context, dis[i], buf, 16, 1) != 0) continue;
                long freq = Marshal.ReadInt64(buf); int disjoint = Marshal.ReadInt32(buf, 8);
                if (g.GetData(g.Context, t0[i], buf, 8, 1) != 0) continue;
                long a = Marshal.ReadInt64(buf);
                if (g.GetData(g.Context, t1[i], buf, 8, 1) != 0) continue;
                long b = Marshal.ReadInt64(buf);
                pending[i] = false;
                if (disjoint == 0 && freq > 0 && b >= a) into(label[i], (b - a) * 1000.0 / freq);
            }
        }
    }
}
