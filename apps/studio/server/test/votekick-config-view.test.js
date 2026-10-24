import { describe, expect, it } from 'vitest';
import { votekickConfigView } from '../../web/src/votekick-config-view.ts';

// Votekick — Studio settings section, pure view: the length and its limits, an older Core shown as such (60 s, read
// only), no sound by default, the imported sound named and escaped, the player's state said plainly.

const base = {
  available: true,
  vote_seconds: 45,
  limits: { min: 15, max: 300, default: 60 },
  launch_sound: { enabled: false, sound: null, sound_name: null, volume: 80 },
  sounds: [
    { id: 'eren-scream', label: 'Eren Scream', available: true },
    { id: 'glory-holes', label: 'Absent', available: false },
  ],
  player: { connected: true, audio: true, current: true },
};
const ui = { error: null, notice: null, busy: false };

describe('Votekick settings section', () => {
  it('the length, its limits, and that an open vote keeps its own', () => {
    const html = votekickConfigView(base, ui);
    expect(html).toContain('name="vote_seconds" min="15" max="300"');
    expect(html).toContain('value="45"');
    expect(html).toContain('un vote déjà ouvert garde sa durée');
  });

  it('no sound by default; only the sounds present are offered', () => {
    const html = votekickConfigView(base, ui);
    expect(html).not.toMatch(/name="enabled" checked/);
    expect(html).toContain('<option value="">— aucun son —</option>');
    expect(html).toContain('Eren Scream');
    expect(html).not.toContain('Absent');
    expect(html).toMatch(/data-act="vk-preview" disabled/);
    expect(html).toContain('Lecteur d’effets prêt');
  });

  it('an older Core: the fixed 60 s, the field locked and why', () => {
    const html = votekickConfigView(
      { ...base, available: false, vote_seconds: 60, error: 'core_outdated' },
      ui,
    );
    expect(html).toMatch(/value="60" disabled/);
    expect(html).toContain('Le Core ne connaît pas encore ce réglage');
  });

  it('an imported sound: selected, its name escaped; the player offline is said', () => {
    const html = votekickConfigView(
      { ...base, player: { connected: false, audio: false, current: false } },
      ui,
      {
        enabled: true,
        sound: `upload:${'a'.repeat(64)}.mp3`,
        sound_name: '<img src=x onerror=alert(1)>.mp3',
        volume: 30,
      },
    );
    expect(html).toContain('Importé : &lt;img src=x onerror=alert(1)&gt;.mp3');
    expect(html).not.toContain('<img');
    expect(html).toMatch(/name="enabled" checked/);
    expect(html).toContain('value="30"');
    expect(html).toContain('non connecté dans OBS');
  });

  it('errors and notices shown; busy locks the form', () => {
    const html = votekickConfigView(base, {
      error: 'Fichier trop lourd',
      notice: null,
      busy: true,
    });
    expect(html).toContain('<p class="cp-error">Fichier trop lourd</p>');
    expect(html).toMatch(/<fieldset class="cp-action" disabled>/);
    expect(votekickConfigView(null, { ...ui, error: 'x' })).toContain(
      'cp-error',
    );
  });
});
