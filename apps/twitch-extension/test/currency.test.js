import { describe, expect, it } from 'vitest';
import {
  currencyUnit,
  fmtAmount,
  moneyHtml,
} from '../extension/shared/currency.js';

const tokens = { id: 'tokens', label: 'Jetons', short_label: 'J' };
const soundboard = {
  id: 'credits_soundboard',
  label: 'Crédits Soundboard',
  short_label: 'cr Sons',
};
const tts = { id: 'credits_tts', label: 'Crédits TTS', short_label: 'cr TTS' };

describe('currencies in compact surfaces', () => {
  it('short canonical unit and colour: Jetons → Je, every Crédits → Cr', () => {
    expect(currencyUnit(tokens)).toMatchObject({ tone: 'tokens', short: 'Je' });
    expect(currencyUnit(soundboard)).toMatchObject({
      tone: 'credits',
      short: 'Cr',
    });
    expect(currencyUnit(tts)).toMatchObject({ tone: 'credits', short: 'Cr' });
    expect(currencyUnit(tokens).color).toContain('--jdm-token');
    expect(currencyUnit(soundboard).color).toContain('--jdm-credit');
    // A currency registered later: its own short label, never the long one.
    expect(
      currencyUnit({
        id: 'gems',
        label: 'Gemmes précieuses',
        short_label: 'Gm',
      }).short,
    ).toBe('Gm');
  });

  it('the amount never breaks: no-break separators, never the long name', () => {
    for (const n of [7000, 17000, 200000, 1234500])
      expect(fmtAmount(n)).not.toMatch(/[ \u202f]/);
    expect(fmtAmount(1234500)).toBe('1\u00a0234\u00a0500');
    const html = moneyHtml(17000, soundboard);
    expect(html).toContain('17\u00a0000&nbsp;');
    expect(html).toContain('>Cr</span>');
    expect(html).not.toMatch(/Soundboard|Sons/);
  });

  it('Jetons: the wallet coin, named « Jetons », never the abbreviation « Je »', () => {
    const html = moneyHtml(20000, tokens);
    expect(html).toContain('20 000&nbsp;');
    expect(html).toContain('<svg');
    expect(html).toContain('aria-label="Jetons"');
    expect(html).not.toMatch(/>Je</);
  });
});
