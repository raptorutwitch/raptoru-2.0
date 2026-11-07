import { tryGetJson } from './http.js';

/** The profile, once known (retried while Studio's server starts). */
export async function whenProfile(): Promise<'production' | 'lab'> {
  for (;;) {
    const p = await tryGetJson<{ effective?: string }>('/api/profile');
    if (p?.effective === 'production') return 'production';
    if (p?.effective) return 'lab';
    await new Promise((r) => setTimeout(r, 5000));
  }
}
