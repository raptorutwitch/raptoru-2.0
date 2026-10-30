import type { ObsActions, ObsLike } from '../channel-points/obs-actions.js';

// Halloween Chaos (docs/HALLOWEEN.md § 4 bis) — what the VIEWERS see. The streamer's Chaos window is excluded from every
// screen capture (else it would capture itself), so OBS's own screen capture would show the normal screen: the same
// effect is applied there by OBS filters on that capture source, prepared once by Studio (« Préparer les filtres OBS »,
// created disabled) and enabled only while an effect plays — through Studio's ObsActions, whose temporary actions are
// undone at their end even after a Studio restart. Plugins used: obs-shaderfilter (flips) and obs-composite-blur.

export const CHAOS_FILTERS = {
  rotate: 'Raptoru Chaos · Retourné',
  mirror: 'Raptoru Chaos · Miroir',
  vertical: 'Raptoru Chaos · Inversé',
  low: 'Raptoru Chaos · Flou faible',
  medium: 'Raptoru Chaos · Flou moyen',
  high: 'Raptoru Chaos · Flou fort',
} as const;
export type ChaosFilterKey = keyof typeof CHAOS_FILTERS;

/**
 * Blur radius per level, in OBS pixels (canvas 1920 × 1080): a Gaussian « radius » spans ~2.5 × the CSS blur of the
 * streamer's own screen (4 / 10 / 22 px), so both look alike.
 */
const BLUR_RADIUS = { low: 10, medium: 25, high: 55 } as const;
/**
 * obs-composite-blur's own keys (checked on OBS 32.2.2): algorithm 1 = Gaussian, type 1 = Area. Absent from its
 * defaults, and 0 renders nothing at all (a white frame): always set them.
 */
const GAUSSIAN_AREA = { blur_algorithm: 1, blur_type: 1 } as const;

const flipShader = (uv: string) =>
  `// Raptoru Chaos (Studio) — do not edit: Studio enables it during an effect.
float4 mainImage(VertData v_in) : TARGET
{
    return image.Sample(textureSampler, ${uv});
}
`;
const SHADERS = {
  rotate: flipShader('float2(1.0 - v_in.uv.x, 1.0 - v_in.uv.y)'),
  mirror: flipShader('float2(1.0 - v_in.uv.x, v_in.uv.y)'),
  vertical: flipShader('float2(v_in.uv.x, 1.0 - v_in.uv.y)'),
} as const;

/** The filter for a play's params (flip mode / blur intensity). */
export function chaosFilterOf(
  effect: string | null,
  params: Record<string, unknown>,
): ChaosFilterKey | null {
  if (effect === 'flip') {
    const m = params.mode;
    return m === 'mirror' || m === 'vertical' ? m : 'rotate';
  }
  if (effect === 'blur') {
    const i = params.intensity;
    return i === 'low' || i === 'high' ? i : 'medium';
  }
  return null;
}

type Req = (type: string, data: object) => Promise<Record<string, unknown>>;

/** The OBS screen captures (« Capture d'écran ») the filters can go on. */
export async function screenSources(obs: ObsLike) {
  const r = await obs.request('GetInputList', { inputKind: 'monitor_capture' });
  return ((r.inputs ?? []) as { inputName: string }[]).map((i) => i.inputName);
}

/** Which Chaos filters the source holds now (name → enabled). */
export async function chaosFilterState(obs: ObsLike, source: string) {
  const r = await obs.request('GetSourceFilterList', { sourceName: source });
  const list = (r.filters ?? []) as {
    filterName: string;
    filterEnabled: boolean;
  }[];
  return Object.fromEntries(
    Object.entries(CHAOS_FILTERS).map(([k, name]) => {
      const f = list.find((x) => x.filterName === name);
      return [
        k,
        f
          ? { present: true, enabled: f.filterEnabled }
          : { present: false, enabled: false },
      ];
    }),
  ) as Record<ChaosFilterKey, { present: boolean; enabled: boolean }>;
}

/** Creates the missing Chaos filters on `source`, disabled (an existing one is left as it is: never overwritten). */
export async function prepareChaosFilters(obs: ObsLike, source: string) {
  const req: Req = (t, d) => obs.request(t, d);
  const have = await chaosFilterState(obs, source);
  const created: string[] = [];
  for (const [key, name] of Object.entries(CHAOS_FILTERS) as [
    ChaosFilterKey,
    string,
  ][]) {
    if (have[key].present) continue;
    let filterKind: string;
    let filterSettings: Record<string, unknown>;
    if (key === 'rotate' || key === 'mirror' || key === 'vertical') {
      filterKind = 'shader_filter';
      filterSettings = { from_file: false, shader_text: SHADERS[key] };
    } else {
      filterKind = 'obs_composite_blur';
      filterSettings = { ...GAUSSIAN_AREA, radius: BLUR_RADIUS[key] };
    }
    await req('CreateSourceFilter', {
      sourceName: source,
      filterName: name,
      filterKind,
      filterSettings,
    });
    // Created enabled by OBS: off at once (it only shows during an effect).
    await req('SetSourceFilterEnabled', {
      sourceName: source,
      filterName: name,
      filterEnabled: false,
    });
    created.push(name);
  }
  return { created, state: await chaosFilterState(obs, source) };
}

/** On for `ms` (undone at its end even after a Studio restart), or off now. */
export function setChaosFilter(
  actions: ObsActions,
  source: string,
  key: ChaosFilterKey,
  on: boolean,
  ms?: number,
) {
  return actions.run({
    type: 'obs_filter',
    source,
    filter: CHAOS_FILTERS[key],
    enabled: on,
    ...(on && ms ? { duration_ms: Math.min(600_000, Math.round(ms)) } : {}),
  });
}
