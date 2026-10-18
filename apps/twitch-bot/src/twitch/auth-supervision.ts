import { missingTwitchScopes } from '@raptoru/schemas';
import type { AuthStatus } from './auth.js';

export const TOKEN_VALIDATION_INTERVAL_MS = 60 * 60 * 1000;

/** Validate every user token, including tokens that only receive EventSub traffic. */
export function superviseTwitchAuth(
  auth: { validate(): Promise<void>; status(): AuthStatus },
  onUnavailable: (reason: string) => void,
  options: {
    intervalMs?: number;
    log?: (message: string) => void;
  } = {},
) {
  // Optional modules use these capabilities too. Losing one stops their consumers instead of
  // leaving the startup snapshot advertised as ready until a Twitch write happens to fail.
  const grantedAtStart = [...auth.status().scopes];
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    timer = setTimeout(async () => {
      try {
        await auth.validate();
        if (stopped) return;
        const missing = missingTwitchScopes(
          auth.status().scopes,
          grantedAtStart,
        );
        if (missing.length) {
          stop();
          onUnavailable(`missing_scopes: ${missing.join(', ')}`);
          return;
        }
      } catch {
        if (stopped) return;
        if (auth.status().state === 'failed') {
          stop();
          onUnavailable('Twitch authorization is no longer usable');
          return;
        }
        options.log?.('Twitch token validation unavailable; will retry');
      }
      if (!stopped) schedule();
    }, options.intervalMs ?? TOKEN_VALIDATION_INTERVAL_MS);
  };
  function stop() {
    stopped = true;
    clearTimeout(timer);
  }
  schedule();
  return { stop };
}
