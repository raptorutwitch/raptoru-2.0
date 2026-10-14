// Bonk VNext lot 3 — Auto target from the OBS scene graph (no image analysis). Pure functions:
// - fetchTree: the program scene, recursively (nested scenes, groups), from GetSceneItemList /
//   GetGroupSceneItemList answers;
// - flatten: every visible input with its final polygon on the canvas (libobs transform model:
//   crop, then scale or bounds, alignment origin, rotation around it, position; parents composed as
//   2D affine matrices; each level clips its children: crop window, bounds when cropToBounds, nested
//   scene canvas), then the axis-aligned box in the Bonk overlay space (1920 × 1080);
// - scoreCandidates / chooseTarget: deterministic, explainable camera detection.

export const OVERLAY = { width: 1920, height: 1080 } as const;
/** Name of the Bonk overlay browser source (never a candidate; maps the canvas to the overlay). */
export const BONK_SOURCE_NAME = 'Raptoru Bonk Lab';
const MAX_DEPTH = 8;

export interface ObsTransform {
  positionX: number;
  positionY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  alignment: number;
  boundsType: string;
  boundsAlignment: number;
  boundsWidth: number;
  boundsHeight: number;
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;
  cropToBounds?: boolean;
  sourceWidth: number;
  sourceHeight: number;
}
/** One entry of GetSceneItemList / GetGroupSceneItemList (fields used here). */
export interface ObsSceneItem {
  sceneItemId: number;
  sourceName: string;
  sourceUuid?: string | null;
  sourceType: string;
  inputKind: string | null;
  isGroup: boolean | null;
  sceneItemEnabled: boolean;
  sceneItemTransform: ObsTransform;
}
export interface SceneTree {
  name: string;
  group: boolean;
  items: TreeItem[];
}
export interface TreeItem {
  scene: string;
  id: number;
  name: string;
  uuid: string | null;
  kind: 'input' | 'scene' | 'group';
  inputKind: string | null;
  enabled: boolean;
  transform: ObsTransform;
  child: SceneTree | null;
}

/** Reads the program scene and every nested scene / group it shows. */
export async function fetchTree(
  program: string,
  list: (scene: string, group: boolean) => Promise<ObsSceneItem[]>,
): Promise<SceneTree> {
  const read = async (
    name: string,
    group: boolean,
    path: string[],
  ): Promise<SceneTree> => {
    const items: TreeItem[] = [];
    for (const it of await list(name, group)) {
      const kind: TreeItem['kind'] = it.isGroup
        ? 'group'
        : it.sourceType === 'OBS_SOURCE_TYPE_SCENE'
          ? 'scene'
          : 'input';
      const nested =
        kind !== 'input' &&
        path.length < MAX_DEPTH &&
        !path.includes(it.sourceName);
      items.push({
        scene: name,
        id: it.sceneItemId,
        name: it.sourceName,
        uuid: it.sourceUuid ?? null,
        kind,
        inputKind: it.inputKind ?? null,
        enabled: it.sceneItemEnabled,
        transform: it.sceneItemTransform,
        child: nested
          ? await read(it.sourceName, kind === 'group', [...path, name])
          : null,
      });
    }
    return { name, group, items };
  };
  return read(program, false, []);
}

// --- 2D affine geometry ----------------------------------------------------------------------

/** [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];
export type Point = [number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** m1 ∘ m2 (m2 first). */
export const mul = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const scale = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0];
/** Clockwise on screen (y down), degrees — as OBS. */
const rotate = (deg: number): Matrix => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
};
export const apply = (m: Matrix, [x, y]: Point): Point => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];
export function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  const [a, b, c, d, e, f] = m;
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}
const rectPolygon = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Sutherland–Hodgman: `subject` clipped by the convex polygon `clip` (any winding). */
export function clipPolygon(subject: Point[], clip: Point[]): Point[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const orientation = Math.sign(signedArea(clip)) || 1;
  let output = subject;
  for (let i = 0; i < clip.length && output.length; i++) {
    const [ax, ay] = clip[i]!;
    const [bx, by] = clip[(i + 1) % clip.length]!;
    const inside = ([x, y]: Point) =>
      orientation * ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) >= -1e-9;
    const cross = ([px, py]: Point, [qx, qy]: Point): Point => {
      const dx = qx - px;
      const dy = qy - py;
      const den = (bx - ax) * dy - (by - ay) * dx;
      const t = den === 0 ? 0 : ((px - ax) * dy - (py - ay) * dx) / den;
      return [ax + t * (bx - ax), ay + t * (by - ay)];
    };
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j]!;
      const q = input[(j + 1) % input.length]!;
      if (inside(q)) {
        if (!inside(p)) output.push(cross(p, q));
        output.push(q);
      } else if (inside(p)) output.push(cross(p, q));
    }
  }
  return output;
}
export function signedArea(poly: Point[]) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Alignment bits of OBS: left 1, right 2, top 4, bottom 8; otherwise centred on that axis. */
const alignX = (a: number) => (a & 1 ? 0 : a & 2 ? 1 : 0.5);
const alignY = (a: number) => (a & 4 ? 0 : a & 8 ? 1 : 0.5);

/**
 * One scene item: the matrix from its source space (0..sourceWidth) to its parent scene space, and
 * the part of its source that is drawn (crop window, bounds when cropToBounds), as a rectangle of
 * its source space.
 */
export function itemGeometry(t: ObsTransform): {
  matrix: Matrix;
  visible: [number, number, number, number];
} {
  const cropL = Math.max(0, t.cropLeft);
  const cropT = Math.max(0, t.cropTop);
  const cx = Math.max(0, t.sourceWidth - cropL - Math.max(0, t.cropRight));
  const cy = Math.max(0, t.sourceHeight - cropT - Math.max(0, t.cropBottom));
  // Signed, as libobs: a negative scale (flip) extends the box on the other side of the alignment
  // point (« width » < 0 in OBS), it does not mirror in place.
  let sx = t.scaleX;
  let sy = t.scaleY;
  let boxW = cx * sx;
  let boxH = cy * sy;
  let offX = 0;
  let offY = 0;
  const bounded = t.boundsType && t.boundsType !== 'OBS_BOUNDS_NONE';
  if (bounded && cx > 0 && cy > 0) {
    const bw = t.boundsWidth;
    const bh = t.boundsHeight;
    const rw = bw / cx;
    const rh = bh / cy;
    switch (t.boundsType) {
      case 'OBS_BOUNDS_STRETCH':
        sx = rw;
        sy = rh;
        break;
      case 'OBS_BOUNDS_SCALE_OUTER':
        sx = sy = Math.max(rw, rh);
        break;
      case 'OBS_BOUNDS_SCALE_TO_WIDTH':
        sx = sy = rw;
        break;
      case 'OBS_BOUNDS_SCALE_TO_HEIGHT':
        sx = sy = rh;
        break;
      case 'OBS_BOUNDS_MAX_ONLY':
        sx = sy = Math.min(1, rw, rh);
        break;
      default: // OBS_BOUNDS_SCALE_INNER
        sx = sy = Math.min(rw, rh);
    }
    offX = alignX(t.boundsAlignment) * (bw - cx * sx);
    offY = alignY(t.boundsAlignment) * (bh - cy * sy);
    boxW = bw;
    boxH = bh;
  }
  const origin: Point = [
    alignX(t.alignment) * boxW,
    alignY(t.alignment) * boxH,
  ];
  const matrix = [
    translate(t.positionX, t.positionY),
    rotate(t.rotation),
    translate(-origin[0], -origin[1]),
    translate(offX, offY),
    scale(sx, sy),
    translate(-cropL, -cropT),
  ].reduce(mul, IDENTITY);
  let visible: [number, number, number, number] = [
    cropL,
    cropT,
    cropL + cx,
    cropT + cy,
  ];
  if (bounded && t.cropToBounds && sx > 0 && sy > 0) {
    // The bounds box, back in source coordinates.
    const bx0 = cropL + (0 - offX) / sx;
    const by0 = cropT + (0 - offY) / sy;
    const bx1 = cropL + (t.boundsWidth - offX) / sx;
    const by1 = cropT + (t.boundsHeight - offY) / sy;
    visible = [
      Math.max(visible[0], bx0),
      Math.max(visible[1], by0),
      Math.min(visible[2], bx1),
      Math.min(visible[3], by1),
    ];
  }
  return { matrix, visible };
}

export interface VisibleInput {
  name: string;
  uuid: string | null;
  inputKind: string | null;
  /** Scene names then the source: « Just Chatting > Groupe Cam > Webcam ». */
  path: string[];
  /** (scene, item id) of every level, program scene first: the chain events are checked against. */
  chain: { scene: string; id: number }[];
  /** Final polygon on the OBS canvas. */
  polygon: Point[];
  /** Axis-aligned box in the overlay space (1920 × 1080), clipped to it. */
  rect: { x: number; y: number; w: number; h: number };
  /** Visible fraction of the canvas. */
  area: number;
}

/**
 * Every visible input of the program tree. `canvas`: OBS base resolution. The Bonk overlay source,
 * when found, maps the canvas to the overlay space; otherwise a plain rescale to 1920 × 1080.
 */
export function flatten(
  tree: SceneTree,
  canvas: { width: number; height: number },
): VisibleInput[] {
  const out: Omit<VisibleInput, 'rect' | 'area'>[] = [];
  let overlay: Matrix | null = null;
  const walk = (
    scene: SceneTree,
    parent: Matrix,
    clips: Point[][],
    path: string[],
    chain: { scene: string; id: number }[],
  ) => {
    for (const item of scene.items) {
      if (!item.enabled) continue; // hides the whole subtree
      const { matrix, visible } = itemGeometry(item.transform);
      const world = mul(parent, matrix);
      const [x0, y0, x1, y1] = visible;
      if (x1 <= x0 || y1 <= y0) continue;
      const region = rectPolygon(x0, y0, x1, y1).map((p) => apply(world, p));
      const here = [...chain, { scene: scene.name, id: item.id }];
      if (item.kind === 'input') {
        if (
          item.name === BONK_SOURCE_NAME &&
          item.inputKind === 'browser_source'
        ) {
          overlay = world;
          continue;
        }
        let poly = region;
        for (const clip of clips) poly = clipPolygon(poly, clip);
        if (poly.length >= 3)
          out.push({
            name: item.name,
            uuid: item.uuid,
            inputKind: item.inputKind,
            path: [...path, item.name],
            chain: here,
            polygon: poly,
          });
      } else if (item.child) {
        // A nested scene draws nothing outside its canvas (its source size), nor outside its crop;
        // a group only clips when it is cropped.
        const clipsHere =
          item.kind === 'group' &&
          !item.transform.cropLeft &&
          !item.transform.cropRight &&
          !item.transform.cropTop &&
          !item.transform.cropBottom
            ? clips
            : [...clips, region];
        walk(item.child, world, clipsHere, [...path, item.name], here);
      }
    }
  };
  walk(
    tree,
    IDENTITY,
    [rectPolygon(0, 0, canvas.width, canvas.height)],
    [tree.name],
    [],
  );
  const toOverlay: Matrix =
    (overlay && invert(overlay)) ??
    scale(OVERLAY.width / canvas.width, OVERLAY.height / canvas.height);
  const canvasArea = canvas.width * canvas.height;
  return out.map(({ polygon, ...rest }) => {
    const mapped = clipPolygon(
      polygon.map((p) => apply(toOverlay, p)),
      rectPolygon(0, 0, OVERLAY.width, OVERLAY.height),
    );
    const xs = mapped.map((p) => p[0]);
    const ys = mapped.map((p) => p[1]);
    const rect = mapped.length
      ? {
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        }
      : { x: 0, y: 0, w: 0, h: 0 };
    return {
      ...rest,
      polygon,
      rect,
      area: Math.abs(signedArea(polygon)) / canvasArea,
    };
  });
}

// --- candidates ------------------------------------------------------------------------------

export const CAMERA_KINDS = new Set([
  'dshow_input',
  'av_capture_input',
  'av_capture_input_v2',
  'macos-avcapture',
  'v4l2_input',
  'pipewire-camera-source',
]);
export const MAYBE_CAMERA_KINDS = new Set([
  'ndi_source',
  'decklink-input',
  'droidcam_obs',
  'ffmpeg_source',
  'vlc_source',
]);
const EXCLUDED = [
  /^browser_source$/,
  /^game_capture$/,
  /^monitor_capture$/,
  /^display_capture$/,
  /^window_capture$/,
  /^xcomposite_input$/,
  /^screen_capture$/,
  /^image_source$/,
  /^slideshow/,
  /^color_source/,
  /^text_/,
  /^wasapi_/,
  /^coreaudio_/,
  /^pulse_/,
  /^alsa_/,
  /^jack_/,
  /^sck_audio/,
];
const CAMERA_NAME =
  /cam|caméra|camera|facecam|brio|\bc9\d\d|kiyo|obsbot|insta360|iriun|droidcam|epoccam/i;
const NOT_CAMERA_NAME =
  /overlay|alerte|alert|chat|game|jeu|écran|ecran|screen|display|fond|background|\bbg\b/i;
/** Score from which a candidate is reliable on its own. */
export const RELIABLE_SCORE = 60;
/** Second camera at least this share of the first one's area: Auto hesitates. */
export const AMBIGUITY = 0.85;
/** Smallest reliable box (px, overlay space): the lot 2 minimum zone (5 % of each side). */
export const MIN_RECT = { w: 96, h: 54 };

export interface Candidate extends VisibleInput {
  score: number;
  reliable: boolean;
  reasons: string[];
}

const percent = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
const sourceKey = (v: { uuid: string | null; name: string }) =>
  v.uuid ?? `name:${v.name}`;

export function scoreCandidates(visible: VisibleInput[]): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const v of visible) {
    const kind = v.inputKind ?? '';
    if (EXCLUDED.some((r) => r.test(kind))) continue;
    if (v.area < 0.01) continue;
    const reasons: string[] = [];
    let score = 0;
    const camera = CAMERA_KINDS.has(kind);
    const maybe = MAYBE_CAMERA_KINDS.has(kind);
    if (camera) {
      score += 100;
      reasons.push(`type caméra (${kind}) +100`);
    } else if (maybe) {
      score += 40;
      reasons.push(`type vidéo possible (${kind}) +40`);
    } else reasons.push(`type inconnu (${kind || '?'}) +0`);
    if (CAMERA_NAME.test(v.name)) {
      score += 30;
      reasons.push(`nom « ${v.name} » +30`);
    }
    if (NOT_CAMERA_NAME.test(v.name)) {
      score -= 40;
      reasons.push(`nom « ${v.name} » −40`);
    }
    let reliable = score >= RELIABLE_SCORE;
    if (maybe && v.area > 0.8) {
      reliable = false;
      reasons.push('vidéo plein écran (sans doute pas une caméra)');
    }
    if (v.rect.w < MIN_RECT.w || v.rect.h < MIN_RECT.h) {
      reliable = false;
      reasons.push('trop petite à l’écran');
    }
    reasons.push(`surface ${percent(v.area)}`);
    const candidate: Candidate = { ...v, score, reliable, reasons };
    const key = sourceKey(v);
    const previous = best.get(key);
    if (!previous || previous.area < candidate.area) best.set(key, candidate);
  }
  return [...best.values()].sort(
    (a, b) => b.score - a.score || b.area - a.area,
  );
}

export interface Pinned {
  name: string;
  uuid: string | null;
}
export type AutoStatus =
  'ready' | 'pinned_absent' | 'no_candidate' | 'ambiguous';

export const matchesPinned = (
  c: { name: string; uuid: string | null },
  p: Pinned,
) => (c.uuid && p.uuid ? c.uuid === p.uuid : c.name === p.name);

/** Which candidate Auto aims at, and why (null: none reliable → fallback). */
export function chooseTarget(
  candidates: Candidate[],
  pinned: Pinned | null,
): { status: AutoStatus; chosen: Candidate | null; reason: string } {
  if (pinned) {
    const visible = candidates.find((c) => matchesPinned(c, pinned));
    if (visible && visible.rect.w >= MIN_RECT.w && visible.rect.h >= MIN_RECT.h)
      return { status: 'ready', chosen: visible, reason: 'source épinglée' };
  }
  const reliable = candidates
    .filter((c) => c.reliable)
    .sort((a, b) => b.area - a.area);
  const absent = pinned !== null;
  if (!reliable.length)
    return {
      status: absent ? 'pinned_absent' : 'no_candidate',
      chosen: null,
      reason: 'aucun candidat fiable',
    };
  if (reliable.length > 1 && reliable[1]!.area >= AMBIGUITY * reliable[0]!.area)
    return {
      status: absent ? 'pinned_absent' : 'ambiguous',
      chosen: null,
      reason: `plusieurs caméras de taille proche (${reliable[0]!.name}, ${reliable[1]!.name})`,
    };
  return {
    status: absent ? 'pinned_absent' : 'ready',
    chosen: reliable[0]!,
    reason:
      reliable.length === 1
        ? 'seule caméra fiable'
        : 'la plus grande caméra fiable',
  };
}
