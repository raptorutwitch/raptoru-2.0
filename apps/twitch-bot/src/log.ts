// Persistent logs of the production bot (plan post-live lot 2): every console line gets a UTC time and a level, and
// secrets never reach a log file — the configured secrets by value, OAuth tokens / client secrets by shape.

const SHAPES: [RegExp, string][] = [
  [/(Bearer|OAuth)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***'],
  [/oauth:[A-Za-z0-9]+/gi, 'oauth:***'],
  [
    /("?(?:access_token|refresh_token|client_secret|id_token)"?\s*[:=]\s*"?)[^"&\s,}]+/gi,
    '$1***',
  ],
];

/** Removes `secrets` (exact values, ≥ 8 characters) and anything shaped like a token from `text`. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets)
    if (s && s.length >= 8) out = out.split(s).join('***');
  for (const [re, by] of SHAPES) out = out.replace(re, by);
  return out;
}

type Level = 'info' | 'warn' | 'error';

function render(args: unknown[]): string {
  return args
    .map((a) =>
      a instanceof Error
        ? `${a.message}${a.stack ? `\n${a.stack}` : ''}`
        : typeof a === 'string'
          ? a
          : (() => {
              try {
                return JSON.stringify(a);
              } catch {
                return String(a);
              }
            })(),
    )
    .join(' ');
}

/**
 * Routes console.log / warn / error through the redaction, one prefixed line per call
 * (`2026-10-21T10:00:00.000Z INFO …`). `write` defaults to stdout (info) / stderr (warn, error).
 */
export function installConsole(
  secrets: readonly string[],
  write: (level: Level, line: string) => void = (level, line) =>
    (level === 'info' ? process.stdout : process.stderr).write(`${line}\n`),
  now: () => Date = () => new Date(),
): void {
  const emit =
    (level: Level) =>
    (...args: unknown[]) =>
      write(
        level,
        `${now().toISOString()} ${level.toUpperCase()} ${redact(render(args), secrets)}`,
      );
  console.log = emit('info');
  console.info = emit('info');
  console.warn = emit('warn');
  console.error = emit('error');
}
