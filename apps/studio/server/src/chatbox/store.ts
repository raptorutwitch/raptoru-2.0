import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BUILTIN_PRESETS,
  type BuiltinPresetId,
  builtinSettings,
  DEFAULT_PLACEMENTS,
  INITIAL_PRESET,
  Placement,
  PROFILES,
  type ProfileId,
  ProfileSettings,
  SCENE_IDS,
  type SceneId,
} from './settings.js';
import { DEFAULT_RULES, familyInfo, Rules } from './visibility.js';

// Chatbox Raptoru — what Studio keeps (docs/CHATBOX.md § 5.3): each profile's settings and the preset they came from,
// the streamer's own presets, each scene's placement, the visibility rules, the Croupier families seen. One versioned
// JSON file in Studio's data folder (atomic write). A damaged file is kept aside; a damaged part is repaired from its
// preset, group by group (never a broken overlay, never a silent loss). Never any message content on disk.

const STORE_VERSION = 1;

export interface CustomPreset {
  id: string;
  name: string;
  settings: ProfileSettings;
}

export interface ChatboxState {
  profiles: Record<ProfileId, { base: string; settings: ProfileSettings }>;
  presets: Record<ProfileId, CustomPreset[]>;
  placements: Record<SceneId, Placement>;
  rules: Rules;
  /** Croupier families met at least once (id → first / last time): the catalogue lists them. */
  families: Record<string, { first: number; last: number }>;
}

export class ChatboxError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}

const isBuiltin = (id: string): id is BuiltinPresetId =>
  BUILTIN_PRESETS.some((p) => p.id === id);
const newId = () => `p-${randomBytes(4).toString('hex')}`;

/** Group by group: a group that does not validate takes the fallback's (the rest of the settings is kept). */
export function repairSettings(
  raw: unknown,
  fallback: ProfileSettings,
): { settings: ProfileSettings; repaired: boolean } {
  const whole = ProfileSettings.safeParse(raw);
  if (whole.success) return { settings: whole.data, repaired: false };
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(ProfileSettings.shape)) {
    const part = schema.safeParse(r[key]);
    out[key] = part.success
      ? part.data
      : structuredClone(fallback[key as keyof ProfileSettings]);
  }
  return { settings: ProfileSettings.parse(out), repaired: true };
}

export function defaultState(): ChatboxState {
  return {
    profiles: Object.fromEntries(
      PROFILES.map((p) => [
        p,
        { base: INITIAL_PRESET, settings: builtinSettings(INITIAL_PRESET, p) },
      ]),
    ) as ChatboxState['profiles'],
    presets: Object.fromEntries(
      PROFILES.map((p) => [p, []]),
    ) as unknown as ChatboxState['presets'],
    placements: structuredClone(DEFAULT_PLACEMENTS),
    rules: structuredClone(DEFAULT_RULES),
    families: {},
  };
}

export class ChatboxStore {
  repaired: string[] = [];
  private s: ChatboxState = defaultState();
  /** Bumped on every change (the pages and the editor follow it). */
  version = 0;

  private constructor(
    private readonly file: string,
    readonly token: string,
    private readonly now: () => number,
  ) {}

  static async open(dir: string, now: () => number = Date.now) {
    await mkdir(dir, { recursive: true });
    const tokenFile = join(dir, 'chatbox-token');
    let token = '';
    try {
      token = (await readFile(tokenFile, 'utf8')).trim();
    } catch {
      /* first start */
    }
    if (!/^[a-f0-9]{32}$/.test(token)) {
      token = randomBytes(16).toString('hex');
      await writeFile(tokenFile, token, { mode: 0o600 });
    }
    const store = new ChatboxStore(join(dir, 'chatbox.json'), token, now);
    await store.load();
    return store;
  }

  get state(): ChatboxState {
    return this.s;
  }

  private async load() {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(await readFile(this.file, 'utf8')) ?? {};
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      await rename(this.file, `${this.file}.unreadable-${this.now()}`).catch(
        () => {},
      );
      this.repaired.push('fichier illisible (mis de côté)');
      await this.save();
      return;
    }
    const s = defaultState();
    const profiles = (raw.profiles ?? {}) as Record<string, unknown>;
    const presets = (raw.presets ?? {}) as Record<string, unknown>;
    for (const p of PROFILES) {
      const saved = (profiles[p] ?? {}) as {
        base?: unknown;
        settings?: unknown;
      };
      const customs: CustomPreset[] = [];
      for (const x of Array.isArray(presets[p])
        ? (presets[p] as unknown[])
        : []) {
        const v = (x ?? {}) as Record<string, unknown>;
        if (typeof v.id !== 'string' || !/^p-[a-f0-9]{8}$/.test(v.id)) continue;
        const name =
          typeof v.name === 'string' && v.name.trim()
            ? v.name.trim().slice(0, 40)
            : 'Préset';
        const r = repairSettings(
          v.settings,
          builtinSettings(INITIAL_PRESET, p),
        );
        if (r.repaired) this.repaired.push(`préset ${name}`);
        customs.push({ id: v.id, name, settings: r.settings });
      }
      s.presets[p] = customs;
      const base =
        typeof saved.base === 'string' &&
        (isBuiltin(saved.base) || customs.some((c) => c.id === saved.base))
          ? saved.base
          : INITIAL_PRESET;
      if (saved.settings !== undefined) {
        const fallback = isBuiltin(base)
          ? builtinSettings(base, p)
          : structuredClone(customs.find((c) => c.id === base)!.settings);
        const r = repairSettings(saved.settings, fallback);
        if (r.repaired) this.repaired.push(`profil ${p}`);
        s.profiles[p] = { base, settings: r.settings };
      }
    }
    const placements = (raw.placements ?? {}) as Record<string, unknown>;
    for (const scene of SCENE_IDS) {
      if (placements[scene] === undefined) continue;
      const r = Placement.safeParse(placements[scene]);
      if (r.success) s.placements[scene] = r.data;
      else this.repaired.push(`emplacement ${scene}`);
    }
    if (raw.rules !== undefined) {
      const r = Rules.safeParse(raw.rules);
      if (r.success) s.rules = r.data;
      else this.repaired.push('règles de visibilité');
    }
    const families = (raw.families ?? {}) as Record<string, unknown>;
    for (const [id, v] of Object.entries(families)) {
      const f = (v ?? {}) as { first?: unknown; last?: unknown };
      if (
        /^[\w:.-]{1,80}$/.test(id) &&
        typeof f.first === 'number' &&
        typeof f.last === 'number'
      )
        s.families[id] = { first: f.first, last: f.last };
    }
    this.s = s;
    if (this.repaired.length || raw.v !== STORE_VERSION) await this.save();
  }

  private async save() {
    await mkdir(join(this.file, '..'), { recursive: true });
    await writeFile(
      `${this.file}.tmp`,
      JSON.stringify({ v: STORE_VERSION, ...this.s }, null, 1),
      { mode: 0o600 },
    );
    await rename(`${this.file}.tmp`, this.file);
    this.version++;
  }

  private profile(id: string): ProfileId {
    if (!(PROFILES as readonly string[]).includes(id))
      throw new ChatboxError('unknown_profile', 404);
    return id as ProfileId;
  }

  /** A preset's settings (built-in or the profile's own), never the live object. */
  presetSettings(profile: string, presetId: string): ProfileSettings {
    const p = this.profile(profile);
    if (isBuiltin(presetId)) return builtinSettings(presetId, p);
    const c = this.s.presets[p].find((x) => x.id === presetId);
    if (!c) throw new ChatboxError('unknown_preset', 404);
    return structuredClone(c.settings);
  }

  /** Saves ONE profile's settings (the two others are never touched). */
  async saveProfile(profile: string, settings: unknown) {
    const p = this.profile(profile);
    const r = ProfileSettings.safeParse(settings);
    if (!r.success) throw new ChatboxError('invalid_settings');
    this.s.profiles[p] = { base: this.s.profiles[p].base, settings: r.data };
    await this.save();
  }

  async applyPreset(profile: string, presetId: string) {
    const p = this.profile(profile);
    this.s.profiles[p] = {
      base: presetId,
      settings: this.presetSettings(p, presetId),
    };
    await this.save();
  }

  async savePreset(profile: string, name: string, settings: unknown) {
    const p = this.profile(profile);
    const r = ProfileSettings.safeParse(settings);
    if (!r.success) throw new ChatboxError('invalid_settings');
    const clean = name.trim().slice(0, 40);
    if (!clean) throw new ChatboxError('name_required');
    if (this.s.presets[p].length >= 30)
      throw new ChatboxError('too_many_presets');
    const preset = { id: newId(), name: clean, settings: r.data };
    this.s.presets[p].push(preset);
    this.s.profiles[p] = { base: preset.id, settings: structuredClone(r.data) };
    await this.save();
    return preset;
  }

  async renamePreset(profile: string, id: string, name: string) {
    const p = this.profile(profile);
    const c = this.s.presets[p].find((x) => x.id === id);
    if (!c) throw new ChatboxError('unknown_preset', 404);
    const clean = name.trim().slice(0, 40);
    if (!clean) throw new ChatboxError('name_required');
    c.name = clean;
    await this.save();
  }

  async deletePreset(profile: string, id: string) {
    const p = this.profile(profile);
    const before = this.s.presets[p].length;
    this.s.presets[p] = this.s.presets[p].filter((x) => x.id !== id);
    if (this.s.presets[p].length === before)
      throw new ChatboxError('unknown_preset', 404);
    // The profile keeps its settings; it now comes from the initial preset (the deleted one is gone).
    if (this.s.profiles[p].base === id)
      this.s.profiles[p].base = INITIAL_PRESET;
    await this.save();
  }

  async setPlacement(scene: string, placement: unknown) {
    if (!(SCENE_IDS as string[]).includes(scene))
      throw new ChatboxError('unknown_scene', 404);
    const r = Placement.safeParse(placement);
    if (!r.success) throw new ChatboxError('invalid_placement');
    this.s.placements[scene as SceneId] = r.data;
    await this.save();
  }

  async resetPlacement(scene: string) {
    if (!(SCENE_IDS as string[]).includes(scene))
      throw new ChatboxError('unknown_scene', 404);
    this.s.placements[scene as SceneId] = structuredClone(
      DEFAULT_PLACEMENTS[scene as SceneId],
    );
    await this.save();
  }

  async setRules(rules: unknown) {
    const r = Rules.safeParse(rules);
    if (!r.success) throw new ChatboxError('invalid_rules');
    // One rule per account: the last one written wins.
    const seen = new Map<string, Rules['accounts'][number]>();
    for (const a of r.data.accounts) seen.set(a.id ?? `login:${a.login}`, a);
    this.s.rules = { ...r.data, accounts: [...seen.values()] };
    await this.save();
  }

  /**
   * A message from an account whose rule only knows the login: the rule now holds its stable id (a later change of
   * login keeps the rule). Returns true when something was written.
   */
  async bindAccount(login: string, id: string) {
    const rule = this.s.rules.accounts.find(
      (a) => !a.id && a.login === login.toLowerCase(),
    );
    if (!rule || !/^\d{1,20}$/.test(id)) return false;
    rule.id = id;
    await this.save();
    return true;
  }

  /** A Croupier family met (its catalogue entry); written at most once a minute per family. */
  async noteFamily(family: string) {
    if (!/^[\w:.-]{1,80}$/.test(family)) return;
    const now = this.now();
    const f = this.s.families[family];
    if (f && now - f.last < 60_000) return;
    this.s.families[family] = { first: f?.first ?? now, last: now };
    await this.save();
  }

  /** The catalogue Studio shows: every family met, with its category and label. */
  catalogue() {
    return Object.entries(this.s.families).map(([id, f]) => ({
      id,
      ...familyInfo(id),
      first: f.first,
      last: f.last,
    }));
  }
}
