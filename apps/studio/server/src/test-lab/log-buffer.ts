export type LogSource =
  'studio' | 'postgres' | 'core' | 'bot' | 'presence' | 'preflight';

export interface LogLine {
  seq: number;
  at: string;
  source: LogSource;
  level: 'info' | 'error';
  text: string;
}

/** Bounded in-memory log; every line is redacted before being stored. */
export class LogBuffer {
  private lines: LogLine[] = [];
  private seq = 0;

  constructor(
    private readonly redactor: (text: string) => string,
    private readonly max = 500,
  ) {}

  add(source: LogSource, text: string, level: LogLine['level'] = 'info'): void {
    for (const raw of text.split(/\r?\n/)) {
      // Strip ANSI colour codes from child output.
      // eslint-disable-next-line no-control-regex
      const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
      if (!line) continue;
      this.lines.push({
        seq: ++this.seq,
        at: new Date().toISOString(),
        source,
        level,
        text: this.redactor(line),
      });
    }
    if (this.lines.length > this.max)
      this.lines.splice(0, this.lines.length - this.max);
  }

  since(seq = 0): LogLine[] {
    return this.lines.filter((l) => l.seq > seq);
  }

  clear(): void {
    this.lines = [];
  }
}
