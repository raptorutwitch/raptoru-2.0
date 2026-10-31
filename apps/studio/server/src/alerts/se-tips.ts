import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import type { AlertEventInput } from '@raptoru/schemas';
import { join } from 'node:path';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Twitch alerts — real StreamElements donations (17/10/2026, Lab). Studio's server listens to the StreamElements Astro
// WebSocket gateway (docs.streamelements.com/websockets, read 17/10/2026): topics `channel.tips` (scope tips:read, a
// tip once completed) and `channel.tips.moderation` (tips:moderation, a held tip allowed / rejected later). A tip
// becomes ONE donation alert through the Lab Core's normal admission (dedup by the tip `_id`, variant drawn once,
// donation family), only when its documented status allows it: `status` = success and `approved` = allowed (a field
// SE does not send is not guessed). Nothing is fetched from the history: only what Astro pushes while connected.
// Modes (independent of the Twitch one), Studio storage, OFF by default:
// - off: no connection at all (a remembered token stays unused);
// - test: connected, every tip written to the diagnostic journal, never sent to Core;
// - active: allowed tips sent to the Lab Core (the OBS source connected to this Studio plays them).
// The token (SE JWT or Overlay Token) is handed by Electron main only (it keeps it encrypted by the OS) and lives in
// memory here: never written by this server, never returned by an API, never logged.

export const SE_MODES = ['off', 'test', 'active'] as const;
export type SeMode = (typeof SE_MODES)[number];
/** Tokens StreamElements documents for Astro that a streamer can get from the dashboard. */
export const SE_TOKEN_TYPES = ['jwt', 'apikey'] as const;
export type SeTokenType = (typeof SE_TOKEN_TYPES)[number];
export const ASTRO_URL = 'wss://astro.streamelements.com/';
export const SE_TOPICS = ['channel.tips', 'channel.tips.moderation'] as const;
/** Reconnection after an unexpected close (ms); reset by a welcome. */
export const SE_RECONNECT_MS = [2000, 5000, 15_000, 30_000, 60_000];
export const SE_CORE_RETRY_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];
export const SE_CORE_RETRY_TTL_MS = 90_000;
const JOURNAL_MAX = 200;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
/** At most `n` characters, never cutting a character in two (emoji, accents). */
const cut = (s: string, n: number) => [...s].slice(0, n).join('');

/** A number SE sent (4.2, 10, 0.5) as exact minor units: its decimal digits as written, no float rounding. */
export function exactAmount(v: unknown) {
  const raw =
    typeof v === 'number' && Number.isFinite(v) && v >= 0
      ? String(v).includes('e')
        ? v.toFixed(6).replace(/\.?0+$/, '')
        : String(v)
      : typeof v === 'string'
        ? v.trim()
        : '';
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(raw);
  if (!m) return null;
  const value = Number(m[1]! + (m[2] ?? ''));
  return Number.isSafeInteger(value)
    ? { value, decimal_place: (m[2] ?? '').length }
    : null;
}

export interface SeJournalEntry {
  at: string;
  topic: string;
  tip_id: string | null;
  /** The public name the donor typed on the StreamElements form, exactly. */
  name: string | null;
  amount: string | null;
  currency: string | null;
  message: string | null;
  status: string | null;
  approved: string | null;
  created_at: string | null;
  decision: 'test' | 'queued' | 'duplicate' | 'ignored' | 'error';
  detail: string;
}

/**
 * One Astro tip message → the journal line and, when the tip may make an alert, the normalized donation event
 * (`channel_id` added by the caller). Never throws: a malformed tip is a journal line « ignored ».
 */
export function readTip(
  topic: string,
  data: unknown,
  at: Date,
): {
  entry: SeJournalEntry;
  event: Omit<AlertEventInput, 'channel_id'> | null;
} {
  const d = obj(data) ?? {};
  const donation = obj(d.donation) ?? {};
  const user = obj(donation.user) ?? {};
  const rawName = str(user.username);
  const name = rawName?.trim() ? cut(rawName.trim(), 64) : null;
  const amount = exactAmount(donation.amount);
  const currency = str(donation.currency)?.trim().toUpperCase() ?? null;
  const message = str(donation.message);
  const status = str(d.status);
  const approved = str(d.approved);
  const created = str(d.createdAt);
  const createdAt =
    created && !Number.isNaN(Date.parse(created))
      ? new Date(created).toISOString()
      : null;
  const id = str(d._id)?.trim() || null;
  const entry: SeJournalEntry = {
    at: at.toISOString(),
    topic,
    tip_id: id,
    name,
    amount:
      amount === null
        ? null
        : (amount.value / 10 ** amount.decimal_place).toFixed(
            amount.decimal_place,
          ),
    currency,
    message: message ? cut(message, 500) : null,
    status,
    approved,
    created_at: createdAt,
    decision: 'ignored',
    detail: '',
  };
  const refuse = (detail: string) => ({
    entry: { ...entry, detail },
    event: null,
  });
  if (!id) return refuse('identifiant du don absent');
  if (status !== null && status !== 'success')
    return refuse(`transaction non confirmée (status « ${status} »)`);
  if (approved !== null && approved !== 'allowed')
    return refuse(
      approved === 'pending'
        ? 'en attente de modération StreamElements'
        : `refusé par la modération (« ${approved} »)`,
    );
  if (!amount) return refuse('montant absent ou invalide');
  if (!currency || !/^[A-Z]{3}$/.test(currency))
    return refuse('devise absente ou invalide');
  return {
    entry,
    event: {
      source: 'external' as const,
      source_event_id: `streamelements-tip-${cut(id, 100)}`,
      type: 'donation' as const,
      // The name exactly as typed; only when it is really absent does the alert say « Anonyme ».
      ...(name ? { actor: { display_name: name } } : { anonymous: true }),
      amount: { ...amount, currency },
      provider: 'streamelements',
      ...(entry.message?.trim() ? { message: entry.message } : {}),
      ...(createdAt ? { occurred_at: createdAt } : {}),
    },
  };
}

/** The `channel` claim of a StreamElements JWT (read locally, never verified here: Astro verifies the token). */
export function jwtChannel(token: string) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as Obj;
    const ch = str(payload.channel);
    return ch && /^[a-f0-9]{24}$/.test(ch) ? ch : null;
  } catch {
    return null;
  }
}

/** What the WebSocket client needs (the global WebSocket of Node / Electron; a fake in tests). */
export interface SeSocket {
  send(data: string): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SeState =
  | 'off'
  | 'no_token'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'auth_failed';

export interface SeTipsDeps {
  /** Studio storage of this link (mode, journal; never the token). */
  dir: string;
  channelId: string;
  core: LabCoreCall;
  /** Only Electron main may hand a token over (x-raptoru-main). */
  fromMain: (req: IncomingMessage) => boolean;
  socket?: (url: string) => SeSocket;
  now?: () => Date;
  log?: (line: string) => void;
  /** Which Core receives the donations (§ 22): the Lab Core (default) or the paired production Core. */
  environment?: 'lab' | 'production';
}

const STATE_FR: Record<SeState, string> = {
  off: 'Déconnecté (mode OFF).',
  no_token: 'Aucun jeton StreamElements : connecte ton compte ci-dessous.',
  connecting: 'Connexion à StreamElements…',
  connected: 'Connecté à StreamElements.',
  reconnecting: 'Connexion perdue : nouvelle tentative…',
  auth_failed: 'Jeton refusé par StreamElements : reconnecte ton compte.',
};

export class SeTipsLink {
  private token: {
    type: SeTokenType;
    value: string;
    room: string | null;
  } | null = null;
  private ws: SeSocket | null = null;
  private stateValue: SeState;
  private error: string | null = null;
  private room: string | null = null;
  private subscribed = new Set<string>();
  private refused = new Map<string, string>();
  private pending = new Map<string, string>();
  private attempt = 0;
  private reconnectToken: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retries = new Set<ReturnType<typeof setTimeout>>();
  private closed = false;
  /** The files' writes, one after the other (31/10: concurrent writes shared one .tmp and lost journal lines). */
  private saving: Promise<void> = Promise.resolve();

  private constructor(
    private readonly d: SeTipsDeps,
    private modeValue: SeMode,
    private journal: SeJournalEntry[],
    /** ACTIVE was saved but this start resumed in TEST (shown until a mode is chosen). */
    private resumedFromActive = false,
  ) {
    // Until Electron main hands the token over (each start), an ON mode waits for it.
    this.stateValue = modeValue === 'off' ? 'off' : 'no_token';
  }

  static async open(d: SeTipsDeps) {
    await mkdir(d.dir, { recursive: true });
    const read = async <T>(f: string, fallback: T): Promise<T> => {
      try {
        return JSON.parse(await readFile(join(d.dir, f), 'utf8')) as T;
      } catch {
        return fallback;
      }
    };
    const saved = (await read<{ mode?: unknown }>('se-mode.json', {})).mode;
    const journal = await read<SeJournalEntry[]>('se-journal.json', []);
    const mode = SE_MODES.includes(saved as SeMode) ? (saved as SeMode) : 'off';
    // Never an automatic start of the real alerts: a saved ACTIVE resumes as TEST (observation).
    return new SeTipsLink(
      d,
      mode === 'active' ? 'test' : mode,
      Array.isArray(journal) ? journal.slice(-JOURNAL_MAX) : [],
      mode === 'active',
    );
  }

  get mode() {
    return this.modeValue;
  }
  get state() {
    return this.stateValue;
  }

  private now = () => this.d.now?.() ?? new Date();
  private log = (line: string) =>
    (this.d.log ?? ((l: string) => console.log(l)))(`[se-tips] ${line}`);

  /** The page's view: never the token. */
  status() {
    return {
      mode: this.modeValue,
      environment: this.d.environment ?? 'lab',
      resumed_from_active: this.resumedFromActive,
      token: this.token
        ? { present: true, type: this.token.type }
        : { present: false, type: null },
      state: this.stateValue,
      state_label: STATE_FR[this.stateValue],
      room: this.room,
      topics: SE_TOPICS.map((t) => ({
        topic: t,
        subscribed: this.subscribed.has(t),
        error: this.refused.get(t) ?? null,
      })),
      error: this.error,
      last_event: this.journal.at(-1) ?? null,
      journal: this.journal.slice(-50).reverse(),
    };
  }

  /** A token from Electron main (restored at each start, or just typed): connects if the mode asks for it. */
  setToken(type: SeTokenType, value: string, room: string | null) {
    this.token = { type, value, room: room ?? jwtChannel(value) };
    this.error = null;
    this.reconnectToken = null;
    this.apply();
  }

  forgetToken() {
    this.token = null;
    this.apply();
  }

  async setMode(mode: SeMode) {
    if (mode === this.modeValue && !this.resumedFromActive) return;
    await this.write('se-mode.json', { mode });
    this.resumedFromActive = false;
    const was = this.modeValue;
    this.modeValue = mode;
    // TEST ↔ ACTIVE keeps the connection (each tip reads the mode when it arrives); OFF / from OFF (re)applies.
    if (was === 'off' || mode === 'off' || this.stateValue === 'auth_failed') {
      this.error = null;
      this.apply();
    }
  }

  close() {
    this.closed = true;
    this.disconnect();
    for (const t of this.retries) clearTimeout(t);
    this.retries.clear();
  }

  /** (Re)connects or disconnects to match the mode and the token. */
  private apply() {
    this.disconnect();
    this.attempt = 0;
    if (this.closed || this.modeValue === 'off') this.stateValue = 'off';
    else if (!this.token) this.stateValue = 'no_token';
    else this.connect();
  }

  private disconnect() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    this.subscribed.clear();
    this.pending.clear();
  }

  private connect() {
    const resume = this.reconnectToken;
    this.reconnectToken = null;
    this.stateValue = this.attempt ? 'reconnecting' : 'connecting';
    const url = resume
      ? `${ASTRO_URL}?reconnect_token=${encodeURIComponent(resume)}`
      : ASTRO_URL;
    let ws: SeSocket;
    try {
      ws = (this.d.socket ?? ((u) => new WebSocket(u) as unknown as SeSocket))(
        url,
      );
    } catch (e) {
      this.error = `Connexion impossible : ${(e as Error).message}`;
      return this.retry();
    }
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(String(ev.data), Boolean(resume));
    ws.onerror = () => {
      /* followed by onclose */
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.subscribed.clear();
      if (this.stateValue === 'auth_failed') return;
      if (!this.reconnectToken)
        this.error = `Connexion StreamElements fermée${ev.code ? ` (code ${ev.code})` : ''}.`;
      this.retry();
    };
  }

  private retry() {
    if (this.closed || this.modeValue === 'off' || !this.token) return;
    // A graceful reconnect (server shutting down) goes at once; anything else waits, longer each time.
    const delay = this.reconnectToken
      ? 0
      : SE_RECONNECT_MS[Math.min(this.attempt, SE_RECONNECT_MS.length - 1)]!;
    this.attempt++;
    this.stateValue = 'reconnecting';
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  private subscribe() {
    for (const topic of SE_TOPICS) {
      const nonce = randomUUID();
      this.pending.set(nonce, topic);
      this.ws?.send(
        JSON.stringify({
          type: 'subscribe',
          nonce,
          data: {
            topic,
            ...(this.token!.room ? { room: this.token!.room } : {}),
            token: this.token!.value,
            token_type: this.token!.type,
          },
        }),
      );
    }
  }

  private onMessage(raw: string, resumed: boolean) {
    let m: Obj;
    try {
      m = obj(JSON.parse(raw)) ?? {};
    } catch {
      return; // not JSON: ignored
    }
    const data = obj(m.data) ?? {};
    switch (m.type) {
      case 'welcome':
        this.attempt = 0;
        this.error = null;
        this.stateValue = 'connected';
        // A resumed session keeps its subscriptions (Astro restores them).
        if (resumed) for (const t of SE_TOPICS) this.subscribed.add(t);
        else this.subscribe();
        return;
      case 'reconnect': {
        const token = str(data.reconnect_token);
        if (token) this.reconnectToken = token;
        this.log('graceful reconnect requested by StreamElements');
        return; // the server closes the socket: onclose reconnects with the token
      }
      case 'response': {
        const topic = this.pending.get(String(m.nonce ?? ''));
        if (topic) this.pending.delete(String(m.nonce));
        const error = str(m.error);
        if (!error) {
          if (topic) this.subscribed.add(topic);
          this.refused.delete(topic ?? '');
          if (str(m.room) || str(data.room))
            this.room = str(m.room) ?? str(data.room);
          return;
        }
        const reason = `${error}${str(data.message) ? ` : ${str(data.message)}` : ''}`;
        if (topic) this.refused.set(topic, reason);
        this.log(`subscription ${topic ?? '?'} refused: ${error}`);
        // The tips topic itself refused for the token: stop, no reconnection loop with a bad token.
        if (
          topic === 'channel.tips' &&
          ['err_unauthorized', 'err_bad_request'].includes(error)
        ) {
          this.stateValue = 'auth_failed';
          this.error = `StreamElements refuse l’abonnement aux dons (${reason}). Vérifie le jeton (JWT ou Overlay Token du bon compte) et reconnecte-le.`;
          this.disconnect();
          this.stateValue = 'auth_failed';
        }
        return;
      }
      case 'message': {
        const topic = str(m.topic);
        if (topic === 'channel.tips' || topic === 'channel.tips.moderation')
          void this.onTip(topic, m.data);
        return;
      }
    }
  }

  private async onTip(topic: string, data: unknown) {
    const { entry, event } = readTip(topic, data, this.now());
    if (!event) return this.record(entry);
    if (this.modeValue === 'test')
      return this.record({
        ...entry,
        decision: 'test',
        detail: 'mode TEST : non mis en file',
      });
    if (this.modeValue !== 'active') return;
    const body = { channel_id: this.d.channelId, ...event };
    const received = Date.now();
    let attempt = 0;
    const send = async (): Promise<void> => {
      try {
        const out = await this.d.core<{ outcome?: string }>(
          this.d.environment === 'production'
            ? '/v1/studio/alerts/events'
            : '/v1/lab/alerts/events',
          body,
        );
        const outcome = out.outcome === 'duplicate' ? 'duplicate' : 'queued';
        await this.record({
          ...entry,
          decision: outcome,
          detail:
            outcome === 'duplicate'
              ? 'déjà reçu : aucune nouvelle alerte'
              : 'mis en file (famille don)',
        });
      } catch (e) {
        const status = (e as { status?: number }).status;
        const delay = SE_CORE_RETRY_MS[attempt];
        if (
          (status && status < 500 && status !== 408 && status !== 429) ||
          delay === undefined ||
          Date.now() + delay - received > SE_CORE_RETRY_TTL_MS
        )
          return this.record({
            ...entry,
            decision: 'error',
            detail: `Core Lab n’a pas accepté le don (${(e as Error).message})`,
          });
        attempt++;
        const t = setTimeout(() => {
          this.retries.delete(t);
          void send();
        }, delay);
        this.retries.add(t);
      }
    };
    await send();
  }

  private async record(entry: SeJournalEntry) {
    this.journal = [...this.journal, entry].slice(-JOURNAL_MAX);
    this.log(
      `${entry.topic} ${entry.tip_id ?? '?'} ${entry.amount ?? '?'} ${entry.currency ?? ''} → ${entry.decision}${entry.detail ? ` (${entry.detail})` : ''}`,
    );
    await this.write('se-journal.json', this.journal).catch((e: Error) =>
      this.log(`journal not saved: ${e.message}`),
    );
  }

  /** Queued after the previous write (each one renames its own complete .tmp); its failure never blocks the next. */
  private write(file: string, value: unknown) {
    const path = join(this.d.dir, file);
    const json = JSON.stringify(value);
    const job = this.saving.then(async () => {
      await writeFile(`${path}.tmp`, json, { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    });
    this.saving = job.catch(() => undefined);
    return job;
  }

  /** Resolves once every write asked so far is on disk (tests; a clean stop). */
  flush() {
    return this.saving;
  }

  /** Studio tab API under /api/alerts/se (the alerts runtime checked the Studio header and origin). */
  async api(
    req: IncomingMessage,
    p: string,
    body: () => Promise<Obj>,
    reply: (s: number, b: unknown) => void,
  ) {
    if (req.method === 'GET' && p === '') return reply(200, this.status());
    if (req.method !== 'POST') return reply(404, { error: 'not_found' });
    if (p === '/mode') {
      const mode = (await body()).mode as SeMode;
      if (!SE_MODES.includes(mode))
        return reply(400, { error: 'invalid_mode' });
      await this.setMode(mode);
      return reply(200, this.status());
    }
    if (p === '/connect' || p === '/forget') {
      if (!this.d.fromMain(req)) return reply(403, { error: 'main_only' });
      if (p === '/forget') {
        this.forgetToken();
        return reply(200, { ok: true, ...this.status() });
      }
      const b = await body();
      const type = b.token_type as SeTokenType;
      const token = typeof b.token === 'string' ? b.token.trim() : '';
      const room = typeof b.room === 'string' ? b.room.trim() : '';
      if (!SE_TOKEN_TYPES.includes(type))
        return reply(400, { ok: false, error: 'invalid_token_type' });
      if (token.length < 16 || token.length > 4096 || /\s/.test(token))
        return reply(400, { ok: false, error: 'invalid_token' });
      if (room && !/^[a-f0-9]{24}$/.test(room))
        return reply(400, { ok: false, error: 'invalid_room' });
      this.setToken(type, token, room || null);
      return reply(200, { ok: true, ...this.status() });
    }
    reply(404, { error: 'not_found' });
  }
}
