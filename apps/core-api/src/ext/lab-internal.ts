import { HttpError, type Route } from '../http/server.js';

// In-process access to the Lab route table (Bonk / Soundboard / TTS / Moderation V2 / Tombola /
// test wallet) for the public viewer frontier and the Studio cockpit. These routes are NEVER mounted
// on the public HTTP server: only code that already authenticated its caller (Twitch JWT, Studio
// installation) reaches them through this call, with the same validation and refusals as the Lab.

export interface LabCallError extends Error {
  status: number;
  body: Record<string, unknown>;
}

/** GET when `body` is undefined, POST otherwise (same convention as the Studio's Lab client). */
export type LabCall = <T>(path: string, body?: unknown) => Promise<T>;

export function internalLabCall(routes: Route[]): LabCall {
  return async <T>(path: string, body?: unknown): Promise<T> => {
    const url = new URL(path, 'http://core');
    const method = body === undefined ? 'GET' : 'POST';
    const route = routes.find(
      (r) => r.method === method && r.pattern.test(url.pathname),
    );
    try {
      if (!route) throw new HttpError(404, { error: 'not_found' });
      const params = route.pattern.exec(url.pathname)!.slice(1);
      return (await route.handle({ params, body, url })) as T;
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      const payload = (
        error.body && typeof error.body === 'object' ? error.body : {}
      ) as Record<string, unknown>;
      throw Object.assign(new Error(String(payload.error ?? 'core_error')), {
        status: error.status,
        body: payload,
      }) as LabCallError;
    }
  };
}
