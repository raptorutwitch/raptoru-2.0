// Shared HTTP and HTML helpers of the Studio web (architecture socle, friction S3: 39 local `esc`, 37 header constants,
// ~11 fetch helpers). New code imports these; existing views keep theirs until they are reworked (no clean-up split).

export const STUDIO_HEADERS = {
  'content-type': 'application/json',
  'x-raptoru-studio': '1',
} as const;

/** HTML escape for text and attribute values. */
export const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** A refused call keeps the server's code (and details) for the view's own wording. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: STUDIO_HEADERS });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new ApiError(
      res.status,
      String(body.error ?? `HTTP ${res.status}`),
      body,
    );
  return body as T;
}

export const getJson = <T>(path: string) => call<T>(path);
export const postJson = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body) });

/** Same, but « not readable » becomes null (a view showing « inconnu », never an invented value). */
export const tryGetJson = <T>(path: string) =>
  call<T>(path).catch(() => null as T | null);

/** A service error said in the streamer's words (a card's status line); an unknown code stays readable as it is. */
export const statusError = (code: string) =>
  ({
    core_unavailable: 'Core injoignable : les demandes attendent son retour.',
    lab_core_unavailable:
      'Core injoignable : les demandes attendent son retour.',
  })[code] ?? code;

let mainLab: Promise<boolean> | null = null;
/** The Lab runs on the main Core (real chat, real bot and the Test Lab do not exist there). Read once. */
export const labOnMainCore = () =>
  (mainLab ??= tryGetJson<{ lab_core?: string }>('/api/runtime/status').then(
    (r) => r?.lab_core === 'main',
  ));
