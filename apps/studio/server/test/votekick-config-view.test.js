import { describe, expect, it } from 'vitest';
import {
  votekickForm as votekickConfigView,
  voteLocks,
  voteRow,
} from '../../web/src/pages/sanctions-model.ts';

// Votekick — Studio page, pure parts: the length and its limits, an older Core shown as such (60 s, read
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
    expect(html).toContain('<option value="">Aucun son</option>');
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
    expect(html).toContain('Réglage pas encore disponible');
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
    expect(html).toContain('<p class="d-note bad">Fichier trop lourd</p>');
    expect(html).toMatch(/<fieldset disabled>/);
    expect(votekickConfigView(null, { ...ui, error: 'x' })).toContain(
      'd-note bad',
    );
  });
});

describe('Votekick follow-up', () => {
  const live = (core, x = {}) => ({
    core,
    overlay: { action: 'clear' },
    obs_mute: null,
    last_restore: null,
    error: null,
    ...x,
  });
  const vote = {
    vote_id: 'v',
    mode: 'real',
    status: 'done',
    initiator: '<b>a</b>',
    target: 'cible',
    kick: 7,
    save: 2,
    outcome: 'target_timeout',
    punished: 'cible',
    minutes: 12,
    sanction: 'twitch_timeout',
    applied: 'uncertain',
    reason: null,
    error: null,
    created_at: '2026-11-06T20:00:00Z',
  };
  it('the executor and the mute task: absent, silent or failed is never ready', () => {
    expect(voteLocks(live({ executor: null }))).toContain(
      'Bot Twitch : absent',
    );
    expect(
      voteLocks(
        live({
          executor: {
            login: 'lecroupier_',
            ready: false,
            can_read: true,
            can_timeout: true,
            missing: [],
          },
        }),
      ),
    ).toContain('aucun signal récent');
    expect(
      voteLocks(
        live({
          executor: null,
          mute: {
            mute_id: 'm',
            status: 'failed',
            seconds: 60,
            ends_at: null,
            end_reason: null,
          },
        }),
      ),
    ).toContain('Tâche de mute : échec');
    expect(
      voteLocks(
        live(
          { executor: null },
          { last_restore: { id: 'm', ok: false, mismatches: ['Micro'] } },
        ),
      ),
    ).toContain('OBS non rétabli');
  });
  it('a vote: names escaped, verdict and what was really applied', () => {
    const html = voteRow(vote);
    expect(html).toContain('&lt;b&gt;a&lt;/b&gt;');
    expect(html).toContain('7 KICK, 2 SAVE');
    expect(html).toContain('Cible exclue');
    expect(html).toContain('résultat incertain : vérifier sur Twitch');
    expect(voteRow({ ...vote, mode: 'dry_run' })).toContain(
      'sx-test">Test</i>',
    );
  });
});
