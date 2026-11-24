import { describe, expect, it } from 'vitest';
import {
  chooseSoundPreviewUrl,
  createSoundPreview,
  publishedPreviewUrl,
  soundPreviewUrls,
} from '../extension/shared/soundboard-preview.js';

// The Soundboard's local preview, alone (extracted from ui.js): one Audio at a time, muted by default (Twitch), never a
// purchase. A fake Audio and storage: no real sound.

function fakes({ saved = null } = {}) {
  const made = [];
  class FakeAudio {
    constructor() {
      this.paused = true;
      this.currentTime = 5;
      this.listeners = {};
      made.push(this);
    }
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    }
    async play() {
      this.paused = false;
    }
    pause() {
      this.paused = true;
    }
  }
  const store = new Map(
    saved === null
      ? []
      : [['raptoru-live:soundboard-preview-volume', String(saved)]],
  );
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const buttons = ['boop', 'hello'].map((id) => {
    const attrs = {};
    const classes = new Set();
    return {
      disabled: false,
      dataset: { soundId: id, soundLabel: id },
      classList: {
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
        has: (c) => classes.has(c),
        remove: (c) => classes.delete(c),
      },
      setAttribute: (k, v) => (attrs[k] = v),
      attrs,
      closest: () => null,
    };
  });
  const root = { querySelectorAll: () => buttons };
  return {
    FakeAudio,
    made,
    storage,
    buttons,
    root,
    document: { baseURI: 'http://lab/ext/' },
  };
}
const boop = { id: 'boop', preview_url: 'assets/sounds/boop.mp3' };
const hello = {
  id: 'hello',
  variants: [{ preview_url: 'a.mp3' }, { preview_url: 'b.mp3' }],
};

describe('Soundboard local preview', () => {
  it('muted by default (Twitch): asks to raise the volume, plays nothing', async () => {
    const f = fakes();
    const p = createSoundPreview({
      document: f.document,
      root: () => f.root,
      storage: f.storage,
      AudioCtor: function () {},
    });
    const notices = [];
    await p.play(boop, null, { notice: (t) => notices.push(t) });
    expect(p.volume).toBe(0);
    expect(p.soundId).toBeNull();
    expect(notices[0]).toContain('Monte le volume');
  });

  it('one preview at a time: the next one stops and rewinds the previous; the ▶ buttons say which one is heard', async () => {
    const f = fakes({ saved: 40 });
    const p = createSoundPreview({
      document: f.document,
      root: () => f.root,
      storage: f.storage,
      AudioCtor: f.FakeAudio,
    });
    await p.play(boop);
    expect(p.soundId).toBe('boop');
    expect(f.buttons[0].attrs['aria-pressed']).toBe('true');
    expect(f.buttons[0].attrs['aria-label']).toBe('Arrêter l’aperçu de boop');
    await p.play(hello);
    expect(p.soundId).toBe('hello');
    expect(f.made).toHaveLength(2);
    expect(f.made[0].paused).toBe(true); // the first one stopped…
    expect(f.made[0].currentTime).toBe(0); // …and rewound
    expect(f.buttons[0].attrs['aria-pressed']).toBe('false');
    p.stop();
    expect(p.soundId).toBeNull();
    expect(f.buttons[1].attrs['aria-label']).toBe('Écouter hello');
  });

  it('volume kept locally and applied at once to the preview being heard; out-of-range clamped', async () => {
    const f = fakes({ saved: 30 });
    let audio = null;
    const p = createSoundPreview({
      document: f.document,
      root: () => f.root,
      storage: f.storage,
      AudioCtor: function () {
        audio = { addEventListener() {}, async play() {}, pause() {} };
        return audio;
      },
    });
    await p.play(boop);
    expect(audio.volume).toBeCloseTo(0.3);
    p.setVolume(80);
    expect(audio.volume).toBeCloseTo(0.8);
    expect(f.storage.getItem('raptoru-live:soundboard-preview-volume')).toBe(
      '80',
    );
    p.setVolume(250);
    expect(p.volume).toBe(100);
  });

  it('a preview the browser refuses: said in words, stopped, nothing sent', async () => {
    const f = fakes({ saved: 50 });
    const warnings = [];
    const p = createSoundPreview({
      document: f.document,
      root: () => f.root,
      storage: f.storage,
      log: { warn: (...a) => warnings.push(a) },
      AudioCtor: function () {
        return {
          addEventListener() {},
          async play() {
            throw Object.assign(new Error('blocked'), {
              name: 'NotAllowedError',
            });
          },
          pause() {},
        };
      },
    });
    const notices = [];
    await p.play(boop, null, { notice: (t) => notices.push(t) });
    expect(notices).toEqual([
      'Aperçu indisponible (NotAllowedError). Rien n’a été envoyé.',
    ]);
    expect(p.soundId).toBeNull();
    expect(warnings[0][0]).toBe('[Raptoru Live] sound_preview_failed');
  });

  it('urls: one per variant, or its own; a random one among them', () => {
    expect(soundPreviewUrls(boop)).toEqual(['assets/sounds/boop.mp3']);
    expect(soundPreviewUrls(hello)).toEqual(['a.mp3', 'b.mp3']);
    expect(chooseSoundPreviewUrl(hello, () => 0.99)).toBe('b.mp3');
    expect(chooseSoundPreviewUrl({ id: 'x' })).toBeNull();
  });

  it('a sound added in Studio: the Core file fetched once (connect-src), played as a blob: (media-src), kept for the next time', async () => {
    const f = fakes({ saved: 50 });
    const id = 'a'.repeat(64);
    const added = { id: 'ajout', preview_url: `sound-files/${id}.wav` };
    const fetched = [];
    const p = createSoundPreview({
      document: f.document,
      root: () => f.root,
      storage: f.storage,
      AudioCtor: f.FakeAudio,
      apiBase: '/ext-lab/api',
      fetchImpl: async (url, init) => {
        fetched.push([url, init.credentials]);
        return { ok: true, status: 200, blob: async () => 'BLOB' };
      },
      objectUrls: {
        createObjectURL: (b) => `blob:lab/${b}`,
        revokeObjectURL() {},
      },
    });
    await p.play(added);
    expect(fetched).toEqual([[`/ext-lab/api/sound-files/${id}.wav`, 'omit']]);
    expect(f.made[0].src).toBe('blob:lab/BLOB');
    expect(p.soundId).toBe('ajout');
    await p.play(boop);
    await p.play(added);
    expect(fetched).toHaveLength(1);
    expect(f.made[2].src).toBe('blob:lab/BLOB');
    // The bank's files still come with the extension.
    expect(f.made[1].src).toBe('http://lab/ext/assets/sounds/boop.mp3');
  });

  it('a Core file that cannot be read: said in words, nothing sent, tried again next time', async () => {
    const f = fakes({ saved: 50 });
    const added = {
      id: 'ajout',
      preview_url: `sound-files/${'b'.repeat(64)}.wav`,
    };
    let calls = 0;
    const p = createSoundPreview({
      document: f.document,
      root: () => f.root,
      storage: f.storage,
      log: { warn() {} },
      AudioCtor: f.FakeAudio,
      apiBase: 'https://core.raptoru.fr/v1/ext',
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 404 };
      },
    });
    const notices = [];
    await p.play(added, null, { notice: (t) => notices.push(t) });
    expect(notices).toEqual([
      'Aperçu indisponible (HTTP_404). Rien n’a été envoyé.',
    ]);
    expect(p.soundId).toBeNull();
    await p.play(added, null, { notice: () => {} });
    expect(calls).toBe(2);
  });

  it('only the EBS the extension may call, only the published shape', () => {
    const id = 'c'.repeat(64);
    expect(
      publishedPreviewUrl(
        `sound-files/${id}.wav`,
        'https://core.raptoru.fr/v1/ext',
      ),
    ).toBe(`https://core.raptoru.fr/v1/ext/sound-files/${id}.wav`);
    expect(
      publishedPreviewUrl(
        `sound-files/${id}.wav`,
        'https://evil.example/v1/ext',
      ),
    ).toBeNull();
    expect(publishedPreviewUrl(`sound-files/${id}.wav`, '')).toBeNull();
    expect(
      publishedPreviewUrl('assets/sounds/boop.mp3', '/ext-lab/api'),
    ).toBeNull();
    expect(
      publishedPreviewUrl('sound-files/../x.wav', '/ext-lab/api'),
    ).toBeNull();
  });
});
