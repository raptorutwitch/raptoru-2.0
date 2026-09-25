import { describe, expect, it } from 'vitest';
import {
  addDays,
  nominalStreamDay,
  streamDayWindow,
} from '../src/stream/stream-day.js';
import { paris } from './helpers.js';

describe('stream-day calendar (reset 16:00 Europe/Paris)', () => {
  it('assigns instants before 16:00 to the previous stream-day', () => {
    expect(nominalStreamDay(paris('2026-09-24', 15, 59))).toBe('2026-09-23');
    expect(nominalStreamDay(paris('2026-09-24', 16, 0))).toBe('2026-09-24');
    expect(nominalStreamDay(paris('2026-09-25', 3, 0))).toBe('2026-09-24');
  });

  it('uses Paris time, not UTC, in summer and winter', () => {
    // 14:30 UTC is 16:30 in summer (CEST) but 15:30 in winter (CET).
    expect(nominalStreamDay(new Date('2026-07-10T14:30:00Z'))).toBe(
      '2026-07-10',
    );
    expect(nominalStreamDay(new Date('2026-01-10T14:30:00Z'))).toBe(
      '2026-01-09',
    );
  });

  it('computes windows across DST changes', () => {
    expect(streamDayWindow('2026-09-24').start.toISOString()).toBe(
      '2026-09-24T14:00:00.000Z',
    );
    // Night of 24→25 Oct 2026: clocks go back, the window lasts 25h.
    const w = streamDayWindow('2026-10-24');
    expect(w.start.toISOString()).toBe('2026-10-24T14:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-25T15:00:00.000Z');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
