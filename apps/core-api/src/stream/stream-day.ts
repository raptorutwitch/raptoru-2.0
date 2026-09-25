// Stream-day calendar: the nominal Daily window opens every day at 16:00 Europe/Paris.
// A stream-day is named after the Paris date on which its window opens ('YYYY-MM-DD').

export const STREAM_DAY_TIME_ZONE = 'Europe/Paris';
export const STREAM_DAY_RESET_HOUR = 16;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: STREAM_DAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function zonedParts(instant: Date): ZonedParts {
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

function formatDay(utcMidnight: number): string {
  return new Date(utcMidnight).toISOString().slice(0, 10);
}

function parseDay(day: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`invalid stream-day: ${day}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function addDays(day: string, delta: number): string {
  const d = parseDay(day);
  return formatDay(Date.UTC(d.year, d.month - 1, d.day + delta));
}

/** Nominal stream-day containing `instant` (before 16:00 Paris belongs to the previous day). */
export function nominalStreamDay(instant: Date): string {
  const p = zonedParts(instant);
  const shift = p.hour < STREAM_DAY_RESET_HOUR ? -1 : 0;
  return formatDay(Date.UTC(p.year, p.month - 1, p.day + shift));
}

/** UTC instant of a Paris wall-clock time (16:00 always exists, DST changes happen at night). */
export function parisWallTime(day: string, hour: number, minute = 0): Date {
  const d = parseDay(day);
  const asUtc = Date.UTC(d.year, d.month - 1, d.day, hour, minute);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess));
    const offset =
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess;
    guess = asUtc - offset;
  }
  return new Date(guess);
}

/** Nominal window [start, end) of a stream-day. */
export function streamDayWindow(day: string): { start: Date; end: Date } {
  return {
    start: parisWallTime(day, STREAM_DAY_RESET_HOUR),
    end: parisWallTime(addDays(day, 1), STREAM_DAY_RESET_HOUR),
  };
}
