// Direct3D 11 : périphérique, shaders du retournement, textures, chaîne d'échange DirectComposition, mesure GPU.
// Aucune lecture GPU → CPU par image : la capture est copiée de texture à texture, puis dessinée.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Windows.Graphics.DirectX.Direct3D11;

namespace Raptoru.Chaos
{
    sealed class Gpu
    {
        public const int Bgra = 87; // DXGI_FORMAT_B8G8R8A8_UNORM

        const string Hlsl = @"
cbuffer P : register(b0) { float angle; float dim; float lod; float pad0; float2 aspect; float2 pad1; };
Texture2D src : register(t0);
SamplerState smp : register(s0);
struct V { float4 pos : SV_Position; float2 uv : TEXCOORD0; };
V vs(uint id : SV_VertexID) {
  V o; float2 uv = float2((id << 1) & 2, id & 2);
  o.pos = float4(uv.x * 2 - 1, 1 - uv.y * 2, 0, 1); o.uv = uv; return o;
}
// 180 degres exacts : chaque pixel lit le centre exact du pixel oppose (aucun flou).
float4 flip(V i) : SV_Target { return float4(src.SampleLevel(smp, 1 - i.uv, 0).rgb, 1); }
// Bascule animee : image tournee au-dessus d'une copie floue et assombrie (jamais le vrai bureau).
float4 turn(V i) : SV_Target {
  float2 p = (i.uv - 0.5) * aspect;
  float c = cos(angle), s = sin(angle);
  float2 q = float2(c * p.x + s * p.y, -s * p.x + c * p.y) / aspect + 0.5;
  float3 bg = src.SampleLevel(smp, i.uv, lod).rgb * dim;
  float3 fg = src.SampleLevel(smp, q, 0).rgb;
  float inside = step(0, q.x) * step(q.x, 1) * step(0, q.y) * step(q.y, 1);
  return float4(lerp(bg, fg, inside), 1);
}";

        public IntPtr Device, Context, DxgiDevice, Factory;
        public IDirect3DDevice WinrtDevice;
        public string Adapter = "?";
        IntPtr vs, psFlip, psTurn, sampler, cbuffer, cbData;

        readonly DevCreateTexture2D createTex;
        readonly DevCreateView createSrv, createRtv;
        readonly CtxSetViews psSetSrv, psSetSampler, psSetCb;
        readonly CtxSetShader psSet, vsSet;
        readonly CtxDraw draw;
        readonly CtxMap map;
        readonly CtxUnmap unmap;
        readonly CtxSetInputLayout setLayout;
        readonly CtxSetTopology setTopology;
        readonly CtxAsync begin, end;
        readonly CtxGetData getData;
        readonly CtxSetRenderTargets setRt;
        readonly CtxSetViewports setVp;
        readonly CtxCopyRegion copyRegion;
        readonly CtxUpdateSubresource update;
        readonly CtxGenerateMips genMips;

        public Gpu()
        {
            IntPtr dev, ctx; int level;
            // BGRA obligatoire pour la capture Windows ; adaptateur par défaut (celui de l'écran principal).
            Com.Check(N.D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out dev, out level, out ctx), "D3D11CreateDevice");
            Device = dev; Context = ctx;
            createTex = Com.Fn<DevCreateTexture2D>(dev, 5);
            createSrv = Com.Fn<DevCreateView>(dev, 7);
            createRtv = Com.Fn<DevCreateView>(dev, 9);
            psSetSrv = Com.Fn<CtxSetViews>(ctx, 8); psSet = Com.Fn<CtxSetShader>(ctx, 9); psSetSampler = Com.Fn<CtxSetViews>(ctx, 10);
            vsSet = Com.Fn<CtxSetShader>(ctx, 11); draw = Com.Fn<CtxDraw>(ctx, 13); map = Com.Fn<CtxMap>(ctx, 14); unmap = Com.Fn<CtxUnmap>(ctx, 15);
            psSetCb = Com.Fn<CtxSetViews>(ctx, 16); setLayout = Com.Fn<CtxSetInputLayout>(ctx, 17); setTopology = Com.Fn<CtxSetTopology>(ctx, 24);
            begin = Com.Fn<CtxAsync>(ctx, 27); end = Com.Fn<CtxAsync>(ctx, 28); getData = Com.Fn<CtxGetData>(ctx, 29);
            setRt = Com.Fn<CtxSetRenderTargets>(ctx, 33); setVp = Com.Fn<CtxSetViewports>(ctx, 44);
            copyRegion = Com.Fn<CtxCopyRegion>(ctx, 46); update = Com.Fn<CtxUpdateSubresource>(ctx, 48); genMips = Com.Fn<CtxGenerateMips>(ctx, 54);

            // La capture écrit dans les textures du même périphérique depuis un autre fil.
            try { IntPtr mt = Com.QI(ctx, Iid.D3D11Multithread); Com.Fn<MtSetProtected>(mt, 5)(mt, 1); Com.Release(ref mt); } catch (Exception) { }
            DxgiDevice = Com.QI(dev, Iid.DxgiDevice);
            try { IntPtr d1 = Com.QI(dev, Iid.DxgiDevice1); Com.Fn<DxgiDevSetMaxLatency>(d1, 12)(d1, 1); Com.Release(ref d1); } catch (Exception) { }
            IntPtr adapter;
            Com.Check(Com.Fn<DxgiDevGetAdapter>(DxgiDevice, 7)(DxgiDevice, out adapter), "GetAdapter");
            DXGI_ADAPTER_DESC ad;
            if (Com.Fn<AdapterGetDesc>(adapter, 8)(adapter, out ad) >= 0) Adapter = ad.Description;
            Guid fid = Iid.DxgiFactory2;
            Com.Check(Com.Fn<ObjGetParent>(adapter, 6)(adapter, ref fid, out Factory), "GetParent(IDXGIFactory2)");
            Com.Release(ref adapter);
            IntPtr insp;
            Com.Check(N.CreateDirect3D11DeviceFromDXGIDevice(DxgiDevice, out insp), "CreateDirect3D11DeviceFromDXGIDevice");
            WinrtDevice = (IDirect3DDevice)Marshal.GetObjectForIUnknown(insp);
            Marshal.Release(insp);

            vs = Shader("vs", "vs_5_0", 12);
            psFlip = Shader("flip", "ps_5_0", 15);
            psTurn = Shader("turn", "ps_5_0", 15);

            var sd = new D3D11_SAMPLER_DESC { Filter = 0x15, AddressU = 3, AddressV = 3, AddressW = 3, ComparisonFunc = 1, MaxLOD = float.MaxValue };
            Com.Check(Com.Fn<DevCreateSampler>(dev, 23)(dev, ref sd, out sampler), "CreateSamplerState");
            var bd = new D3D11_BUFFER_DESC { ByteWidth = 32, Usage = 0, BindFlags = 0x4 };
            Com.Check(Com.Fn<DevCreateBuffer>(dev, 3)(dev, ref bd, IntPtr.Zero, out cbuffer), "CreateBuffer");
            cbData = Marshal.AllocHGlobal(32);
            timer = new GpuTimer(this);
        }

        IntPtr Shader(string entry, string target, int slot)
        {
            IntPtr code, errors;
            int hr = N.D3DCompile(Hlsl, new IntPtr(Hlsl.Length), "chaos.hlsl", IntPtr.Zero, IntPtr.Zero, entry, target, 1u << 15 /* OPTIMIZATION_LEVEL3 */, 0, out code, out errors);
            if (hr < 0)
            {
                string msg = errors != IntPtr.Zero ? Marshal.PtrToStringAnsi(Com.Fn<BlobPtr>(errors, 3)(errors)) : "";
                throw new ComFail("D3DCompile " + entry + " " + msg, hr);
            }
            Com.Release(ref errors);
            IntPtr sh;
            IntPtr ptr = Com.Fn<BlobPtr>(code, 3)(code), len = Com.Fn<BlobPtr>(code, 4)(code);
            Com.Check(Com.Fn<DevCreateShader>(Device, slot)(Device, ptr, len, IntPtr.Zero, out sh), "CreateShader " + entry);
            Com.Release(ref code);
            return sh;
        }

        public IntPtr Texture(uint w, uint h, uint mips, uint bind, uint misc, int usage, uint cpu)
        {
            var d = new D3D11_TEXTURE2D_DESC { Width = w, Height = h, MipLevels = mips, ArraySize = 1, Format = Bgra, SampleCount = 1, Usage = usage, BindFlags = bind, CPUAccessFlags = cpu, MiscFlags = misc };
            IntPtr t;
            Com.Check(createTex(Device, ref d, IntPtr.Zero, out t), "CreateTexture2D");
            return t;
        }
        public IntPtr Srv(IntPtr res) { IntPtr v; Com.Check(createSrv(Device, res, IntPtr.Zero, out v), "CreateShaderResourceView"); return v; }
        public IntPtr Rtv(IntPtr res) { IntPtr v; Com.Check(createRtv(Device, res, IntPtr.Zero, out v), "CreateRenderTargetView"); return v; }

        public IntPtr CompositionSwapChain(uint w, uint h)
        {
            var d = new DXGI_SWAP_CHAIN_DESC1
            {
                Width = w, Height = h, Format = Bgra, SampleCount = 1, BufferUsage = 0x20 /* RENDER_TARGET_OUTPUT */, BufferCount = 3,
                Scaling = 0 /* STRETCH */, SwapEffect = 3 /* FLIP_SEQUENTIAL */, AlphaMode = 1 /* PREMULTIPLIED */
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
        public void GenerateMips(IntPtr srv) { genMips(Context, srv); }

        /// Dessine la capture tournée de « angle » radians (π = retournement exact) dans la cible.
        public void DrawRotated(IntPtr rtv, uint w, uint h, IntPtr srv, double angle, float lod)
        {
            bool exact = Math.Abs(angle - Math.PI) < 1e-4;
            if (!exact)
            {
                var cb = new float[] { (float)angle, 0.35f, lod, 0, (float)w / h, 1, 0, 0 };
                Marshal.Copy(cb, 0, cbData, 8);
                update(Context, cbuffer, 0, IntPtr.Zero, cbData, 0, 0);
            }
            IntPtr r = rtv; setRt(Context, 1, ref r, IntPtr.Zero);
            var vp = new D3D11_VIEWPORT { Width = w, Height = h, MaxDepth = 1 };
            setVp(Context, 1, ref vp);
            setLayout(Context, IntPtr.Zero);
            setTopology(Context, 4); // TRIANGLELIST
            vsSet(Context, vs, IntPtr.Zero, 0);
            psSet(Context, exact ? psFlip : psTurn, IntPtr.Zero, 0);
            IntPtr s = srv; psSetSrv(Context, 0, 1, ref s);
            IntPtr smp = sampler; psSetSampler(Context, 0, 1, ref smp);
            IntPtr cbp = cbuffer; psSetCb(Context, 0, 1, ref cbp);
            draw(Context, 3, 0);
            IntPtr none = IntPtr.Zero; psSetSrv(Context, 0, 1, ref none);
        }

        /// Lecture non bloquante d'une petite texture de contrôle (16×16) : max des canaux, ou -1 si pas encore prête.
        public int MaxChannel(IntPtr staging, int size)
        {
            D3D11_MAPPED_SUBRESOURCE m;
            int hr = map(Context, staging, 0, 1 /* READ */, 0x100000 /* DO_NOT_WAIT */, out m);
            if (hr < 0) return -1;
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

        // ---- Mesure du temps GPU (requêtes d'horodatage, lues plusieurs images plus tard, sans attente) ----
        readonly GpuTimer timer;
        public void TimingBegin() { timer.Begin(); }
        public void TimingEnd() { timer.End(); }
        public void TimingCollect(List<double> into) { timer.Collect(into); }

        sealed class GpuTimer
        {
            const int Slots = 8;
            readonly Gpu g; readonly IntPtr[] dis = new IntPtr[Slots], t0 = new IntPtr[Slots], t1 = new IntPtr[Slots];
            readonly bool[] pending = new bool[Slots]; readonly IntPtr buf = Marshal.AllocHGlobal(16);
            int slot; bool open;
            public GpuTimer(Gpu gpu)
            {
                g = gpu;
                var create = Com.Fn<DevCreateQuery>(g.Device, 24);
                for (int i = 0; i < Slots; i++)
                {
                    var d = new D3D11_QUERY_DESC { Query = 3 }; Com.Check(create(g.Device, ref d, out dis[i]), "CreateQuery");
                    d.Query = 2; Com.Check(create(g.Device, ref d, out t0[i]), "CreateQuery"); Com.Check(create(g.Device, ref d, out t1[i]), "CreateQuery");
                }
            }
            public void Begin()
            {
                if (open || pending[slot]) return;
                g.begin(g.Context, dis[slot]); g.end(g.Context, t0[slot]); open = true;
            }
            public void End()
            {
                if (!open) return;
                g.end(g.Context, t1[slot]); g.end(g.Context, dis[slot]);
                pending[slot] = true; slot = (slot + 1) % Slots; open = false;
            }
            public void Collect(List<double> into)
            {
                for (int i = 0; i < Slots; i++)
                {
                    if (!pending[i]) continue;
                    if (g.getData(g.Context, dis[i], buf, 16, 1) != 0) continue;
                    long freq = Marshal.ReadInt64(buf); int disjoint = Marshal.ReadInt32(buf, 8);
                    if (g.getData(g.Context, t0[i], buf, 8, 1) != 0) continue;
                    long a = Marshal.ReadInt64(buf);
                    if (g.getData(g.Context, t1[i], buf, 8, 1) != 0) continue;
                    long b = Marshal.ReadInt64(buf);
                    pending[i] = false;
                    if (disjoint == 0 && freq > 0 && b >= a) into.Add((b - a) * 1000.0 / freq);
                }
            }
        }
    }
}
