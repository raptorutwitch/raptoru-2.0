import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';

// End guard of the local players (ASTRA-P2-028), on the REAL player pages (tts-player/player.js,
// sound-player/player.js) in Chromium. Studio's player endpoints are answered here; Web Speech and
// Audio are controllable fakes (no sound); time is Playwright's clock. The P1-017 stop protocol
// (stop proposed until `stopped`) is exercised alongside, never changed.

const here = dirname(fileURLToPath(import.meta.url));
// The production cast catalogue (plain JS module of the extension, no type declarations).
const CHARACTERS_MODULE =
  '../../../twitch-extension/extension/shared/tts-characters.js';
const { CHARACTERS } = (await import(CHARACTERS_MODULE)) as {
  CHARACTERS: {
    id: string;
    voicePool: { voiceProfileId: string; category: string }[];
  }[];
};
type Ack = { id: string; event: string };

/** Studio side of a player page: hands out commands, records ACKs and « accept » flags. */
async function studio(page: Page, kind: 'tts' | 'sound') {
  const dir = join(here, '..', kind === 'tts' ? 'tts-player' : 'sound-player');
  const prefix = kind === 'tts' ? '/tts-lab/' : '/sound-lab/';
  const queue: unknown[] = [];
  const stops: unknown[] = [];
  const acks: Ack[] = [];
  const beats: { audio: unknown; off: unknown }[] = [];
  let nextCalls = 0;
  let accepting = 0;
  await page.route(`**${prefix}**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const file = url.pathname.slice(prefix.length);
    if (route.request().method() === 'GET') {
      const type = file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : 'text/html';
      return route.fulfill({
        contentType: type,
        body: await readFile(join(dir, file)),
      });
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const json = (b: unknown) => route.fulfill({ json: b });
    if (file === 'player/heartbeat') {
      beats.push({ audio: body.audio, off: body.off });
      return json({
        ok: true,
        transition_gap_ms: 0,
        module_state: 'active',
        settings: { volume_protection: 'light' },
      });
    }
    if (file === 'player/ack') {
      acks.push({ id: String(body.interaction_id), event: String(body.event) });
      return json({ ok: true });
    }
    if (file === 'player/next') {
      nextCalls += 1;
      if (kind === 'tts') {
        if (body.accept !== false) accepting += 1;
        if (stops.length) return json({ command: stops.shift() });
        return json({
          command:
            body.accept !== false && queue.length
              ? { play: queue.shift() }
              : null,
        });
      }
      return json({
        stop: stops.splice(0),
        interaction: queue.shift() ?? null,
      });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  return {
    queue,
    stops,
    acks,
    events: (id: string) => acks.filter((a) => a.id === id).map((a) => a.event),
    accepting: () => accepting,
    nextCalls: () => nextCalls,
    /** Last heartbeat the page sent (what Studio reports to Core: audio on, or cut on purpose). */
    lastBeat: () => beats.at(-1),
  };
}

/** Fake time, stepped so the page's network round trips can complete between timers. */
async function advance(page: Page, ms: number, step = 250) {
  for (let t = 0; t < ms; t += step) {
    await page.clock.runFor(step);
    await page.waitForTimeout(2);
  }
}

// --- TTS ------------------------------------------------------------------------------------------

const character = CHARACTERS.find((c) =>
  c.voicePool.some((v) => v.category !== 'variant'),
)!;
const voiceEntry = character.voicePool.find((v) => v.category !== 'variant')!;
const tts = (id: string, message: string, estimated: number) => ({
  interaction_id: id,
  delivery: { attempt_id: `att-${id}` },
  cast: {
    character_id: character.id,
    voice_profile_id: voiceEntry.voiceProfileId,
  },
  test_mode: true,
  payment_mode: 'simulated',
  viewer_display_name: 'Viewer',
  message,
  estimated_duration_ms: estimated,
});

/** Web Speech fake: « … a dit. » (narrator) ends at once; STUCK never ends; LONG ends after 100 s. */
async function fakeSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const voice = {
      name: 'Microsoft Julie',
      lang: 'fr-FR',
      voiceURI: 'julie',
      default: true,
      localService: true,
    };
    class Utterance {
      text: string;
      onstart?: () => void;
      onend?: () => void;
      onerror?: (e: unknown) => void;
      onboundary?: () => void;
      constructor(text: string) {
        this.text = text;
      }
    }
    const spoken: Utterance[] = [];
    w.__spoken = spoken;
    w.SpeechSynthesisUtterance = Utterance;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [voice],
        addEventListener: () => {},
        cancel: () => {},
        speak(u: Utterance) {
          spoken.push(u);
          setTimeout(() => u.onstart?.(), 10);
          if (u.text.includes('STUCK')) return;
          setTimeout(() => u.onend?.(), u.text.includes('LONG') ? 100_000 : 50);
        },
      },
    });
  });
}

test.describe('TTS player end guard', () => {
  test('started, no end ever: released at its bound without ACK; the next TTS plays; a late end changes nothing', async ({
    page,
  }) => {
    await page.clock.install();
    await fakeSpeech(page);
    const s = await studio(page, 'tts');
    s.queue.push(tts('t1', 'STUCK bonjour', 4_000));
    await page.goto('/tts-lab/player.html?mute=1#tok');
    await advance(page, 3_000);
    expect(s.events('t1')).toEqual(['started']);
    const busy = s.accepting();
    await advance(page, 20_000); // long before the bound (4 s × 2 + 30 s): still busy, nothing sent
    expect(s.accepting()).toBe(busy);
    expect(s.events('t1')).toEqual(['started']);
    await advance(page, 20_000); // past the bound: released, the page accepts a TTS again
    expect(s.accepting()).toBeGreaterThan(busy);
    expect(s.events('t1')).toEqual(['started']); // no completed / failed: Core's lease decides (unknown)
    s.queue.push(tts('t2', 'bonsoir', 1_000));
    await advance(page, 5_000);
    expect(s.events('t2')).toEqual(['started', 'completed']); // the queue moves on
    // The stuck utterance finally ends: ignored.
    await page.evaluate(() =>
      (
        window as unknown as {
          __spoken: { text: string; onend?: () => void }[];
        }
      ).__spoken
        .find((u) => u.text.includes('STUCK'))
        ?.onend?.(),
    );
    await advance(page, 2_000);
    expect(s.events('t1')).toEqual(['started']);
  });

  test('legitimately long reading (within its bound) completes normally', async ({
    page,
  }) => {
    await page.clock.install();
    await fakeSpeech(page);
    const s = await studio(page, 'tts');
    s.queue.push(tts('t3', 'LONG histoire', 60_000)); // bound 150 s, ends at 100 s
    await page.goto('/tts-lab/player.html?mute=1#tok');
    await advance(page, 110_000, 1_000);
    expect(s.events('t3')).toEqual(['started', 'completed']);
    await expect(page.locator('#status')).not.toContainText('fin non signalée');
  });

  test('moderation stop during a stuck reading: proven once (P1-017); the guard adds nothing', async ({
    page,
  }) => {
    await page.clock.install();
    await fakeSpeech(page);
    const s = await studio(page, 'tts');
    s.queue.push(tts('t4', 'STUCK encore', 4_000));
    await page.goto('/tts-lab/player.html?mute=1#tok');
    await advance(page, 3_000);
    s.stops.push({ stop: 't4', attempt_id: 'att-t4' });
    await advance(page, 60_000);
    expect(s.events('t4')).toEqual(['started', 'stopped']);
  });
});

// --- Soundboard -----------------------------------------------------------------------------------

const sound = (id: string, label: string, duration: number) => ({
  interaction_id: id,
  delivery: { attempt_id: `att-${id}` },
  sound_url: 'assets/sounds/boop.mp3',
  sound_label: label,
  duration_ms: duration,
  volume: 100,
  test_mode: true,
  payment_mode: 'simulated',
});

/** Audio fake: plays at once; STUCK never ends, otherwise ends after the sound's duration label. */
async function fakeAudio(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__stuck = new Set<string>();
    w.__durations = {} as Record<string, number>;
    class FakeAudio extends EventTarget {
      volume = 1;
      constructor(public src: string) {
        super();
      }
      play() {
        const id = (w.__nextId as string[]).shift()!;
        setTimeout(() => this.dispatchEvent(new Event('playing')), 10);
        if (!(w.__stuck as Set<string>).has(id))
          setTimeout(
            () => this.dispatchEvent(new Event('ended')),
            (w.__durations as Record<string, number>)[id],
          );
        return Promise.resolve();
      }
      pause() {}
      load() {}
      removeAttribute() {}
    }
    w.__nextId = [];
    w.Audio = FakeAudio;
  });
}
const prime = (page: Page, id: string, duration: number, stuck = false) =>
  page.evaluate(
    ([i, d, st]) => {
      const w = window as unknown as Record<string, unknown>;
      (w.__nextId as string[]).push(i as string);
      (w.__durations as Record<string, number>)[i as string] = d as number;
      if (st) (w.__stuck as Set<string>).add(i as string);
    },
    [id, duration, stuck] as const,
  );

test.describe('Soundboard player end guard', () => {
  test('started, no end ever: released after duration + margin without ACK; other sounds still play', async ({
    page,
  }) => {
    await page.clock.install();
    await fakeAudio(page);
    const s = await studio(page, 'sound');
    await page.goto('/sound-lab/player.html#tok');
    await prime(page, 's1', 2_000, true);
    s.queue.push(sound('s1', 'Bloqué', 2_000));
    await advance(page, 3_000);
    expect(s.events('s1')).toEqual(['started']);
    await prime(page, 's2', 1_000);
    s.queue.push(sound('s2', 'Boop', 1_000));
    await advance(page, 3_000);
    expect(s.events('s2')).toEqual(['started', 'completed']); // overlapping sounds unaffected
    await advance(page, 10_000); // 16 s since s1 started: under its bound (2 s + 15 s)
    expect(s.events('s1')).toEqual(['started']);
    await advance(page, 3_000);
    await expect(page.locator('#status')).toContainText(
      'Fin non signalée : Bloqué',
    );
    expect(s.events('s1')).toEqual(['started']); // no completed / failed: Core's lease decides
    expect(await page.evaluate(() => document.body.dataset.playing)).toBe('0'); // released
  });

  test('moderation stop of a stuck sound: proven once (P1-017), before the guard', async ({
    page,
  }) => {
    await page.clock.install();
    await fakeAudio(page);
    const s = await studio(page, 'sound');
    await page.goto('/sound-lab/player.html#tok');
    await prime(page, 's3', 2_000, true);
    s.queue.push(sound('s3', 'Bloqué', 2_000));
    await advance(page, 3_000);
    s.stops.push({ interaction_id: 's3', attempt_id: 'att-s3' });
    await advance(page, 30_000);
    expect(s.events('s3')).toEqual(['started', 'stopped']);
  });
});

// --- Soundboard: Ctrl+R in Studio (bug 23/10) -----------------------------------------------------

/** AudioContext fake: `__allowAudio` decides whether resume() reaches 'running' (Electron allows it by default). */
async function fakeAudioContext(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.__allowAudio === undefined)
      w.__allowAudio = sessionStorage.getItem('__allowAudio') !== 'no';
    class FakeContext {
      state = 'suspended';
      resume() {
        if (w.__allowAudio) this.state = 'running';
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }
    w.AudioContext = FakeContext;
  });
}
const beat = async (
  s: Awaited<ReturnType<typeof studio>>,
  audio: boolean,
  off: boolean,
) => expect.poll(() => s.lastBeat()).toEqual({ audio, off });

test.describe('Soundboard player: the audio choice survives a reload (Ctrl+R)', () => {
  test('enabled, then reloaded: back on without a click', async ({ page }) => {
    await fakeAudioContext(page);
    const s = await studio(page, 'sound');
    await page.goto('/sound-lab/player.html#tok');
    await beat(s, false, false);
    await page.click('#enable');
    await beat(s, true, false);
    await page.reload();
    await beat(s, true, false);
    await expect(page.locator('#enable')).toBeHidden();
    await expect(page.locator('#disable')).toBeVisible();
  });

  test('cut on purpose, then reloaded: stays off (never re-enabled by a reload)', async ({
    page,
  }) => {
    await fakeAudioContext(page);
    const s = await studio(page, 'sound');
    await page.goto('/sound-lab/player.html#tok');
    await page.click('#enable');
    await beat(s, true, false);
    await page.click('#disable');
    await beat(s, false, true);
    await page.reload();
    await beat(s, false, true);
    await expect(page.locator('#enable')).toBeVisible();
    await expect(page.locator('#status')).toContainText('coupé volontairement');
    // Re-enabling is a click away, and is remembered again.
    await page.click('#enable');
    await page.reload();
    await beat(s, true, false);
  });

  test('never enabled: a reload changes nothing (waits for the first click)', async ({
    page,
  }) => {
    await fakeAudioContext(page);
    const s = await studio(page, 'sound');
    await page.goto('/sound-lab/player.html#tok');
    await page.reload();
    await beat(s, false, false);
    await expect(page.locator('#enable')).toBeVisible();
  });

  test('enabled, but the browser refuses audio after the reload: asks for a click, not counted as a cut', async ({
    page,
  }) => {
    await fakeAudioContext(page);
    const s = await studio(page, 'sound');
    await page.goto('/sound-lab/player.html#tok');
    await page.click('#enable');
    await beat(s, true, false);
    await page.evaluate(() => sessionStorage.setItem('__allowAudio', 'no'));
    await page.reload();
    await beat(s, false, false);
    await expect(page.locator('#status')).toContainText('exige un clic');
  });
});
