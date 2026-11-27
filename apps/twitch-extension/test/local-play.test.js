// « Jouer sur mon PC » (lab-modules/interactions/local-play.js) : visible et actif seulement quand la page est servie par
// Studio Lab sur ce PC ; coupé par défaut ; la demande part telle que la fiche la construit, avec l'en-tête Studio, en
// même origine ; erreurs lisibles, jamais d'exception.
import { describe, expect, it, vi } from 'vitest';
import { createLocalPlay } from '../extension/lab-modules/interactions/local-play.js';

const page = (pathname) => ({ location: { pathname } });
const reply = (status, body) =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  });

describe('Jouer sur mon PC (Lab)', () => {
  it('hors de Studio (autre chemin que /ext/) : indisponible, aucun appel', async () => {
    const fetchImpl = vi.fn();
    const lp = createLocalPlay({
      win: page('/demo-v2/video_component.html'),
      fetchImpl,
    });
    expect(await lp.probe()).toBe(false);
    expect(lp.setOn(true)).toBe(false);
    expect(await lp.play({ effect: 'mirror' })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('servie par Studio : coupé par défaut, puis la demande exacte part avec l’en-tête Studio, en chemin relatif (même origine)', async () => {
    const fetchImpl = vi.fn((path) =>
      path === '/api/chaos/state'
        ? reply(200, {})
        : reply(200, { ok: true, request_id: 'lab-1', state: 'starting' }),
    );
    const lp = createLocalPlay({
      win: page('/ext/video_component.html'),
      fetchImpl,
    });
    expect(await lp.probe()).toBe(true);
    expect(lp.isOn()).toBe(false);
    expect(await lp.play({ effect: 'mirror' })).toBeNull();
    lp.setOn(true);
    const req = { effect: 'mirror', variant: 'horizontal', duration_ms: 5000 };
    expect(await lp.play(req)).toMatchObject({
      ok: true,
      requestId: 'lab-1',
      state: 'starting',
    });
    const [path, init] = fetchImpl.mock.calls.at(-1);
    expect(path).toBe('/api/chaos/lab/play');
    expect(init.headers['x-raptoru-studio']).toBe('1');
    expect(JSON.parse(init.body)).toEqual(req);
  });

  it('refus du moteur, Studio injoignable : un résultat lisible', async () => {
    let fail = 'refuse';
    const fetchImpl = vi.fn((path) => {
      if (path === '/api/chaos/state') return reply(200, {});
      if (fail === 'refuse')
        return reply(409, {
          ok: false,
          code: 'duration_out_of_range',
          message: 'durée hors bornes [1000, 30000] ms',
        });
      return Promise.reject(new Error('offline'));
    });
    const lp = createLocalPlay({ win: page('/ext/mobile.html'), fetchImpl });
    await lp.probe();
    lp.setOn(true);
    expect(await lp.play({ effect: 'blur', duration_ms: 45000 })).toMatchObject(
      { ok: false, code: 'duration_out_of_range' },
    );
    fail = 'network';
    expect(await lp.play({ effect: 'blur' })).toMatchObject({
      ok: false,
      code: 'studio_unreachable',
    });
  });
});
