import { describe, expect, it, vi } from 'vitest';
import {
  PAGES,
  VIEW_IDS,
  crumbsOf,
  hrefOf,
  moduleGroups,
  pageById,
  pageForLegacyTab,
  pageFromSearch,
  searchPages,
} from '../../web/src/shell/registry.ts';
import { MAX_FAVS, pushRecent, toggleFav } from '../../web/src/shell/shell.ts';
import {
  automationHtml,
  controlsHtml,
  CP_OFF_CONFIRM,
  decisions,
  healthHtml,
  liveCounts,
  LIVE_ACTIONS,
  liveHtml,
  REGIE_CONTROLS,
  steadyEnds,
} from '../../web/src/shell/regie.ts';

// Refonte Studio (lot 1) : le registre est la seule source de la navigation. Aucune vue ne doit disparaître et
// chaque ancien `?tab=` doit rester une adresse valide.
describe('shell registry', () => {
  it('ids are unique and every page points to a hub or a mounted view', () => {
    expect(new Set(PAGES.map((p) => p.id)).size).toBe(PAGES.length);
    for (const p of PAGES) expect(!!p.hub !== !!p.view, p.id).toBe(true);
    for (const p of PAGES) if (p.view) expect(VIEW_IDS).toContain(p.view);
  });

  it('every historical view is reachable, and every legacy ?tab= alias resolves to a page showing it', () => {
    for (const v of VIEW_IDS) {
      expect(
        PAGES.some((p) => p.view === v),
        v,
      ).toBe(true);
      expect(pageForLegacyTab(v)?.view, v).toBe(v);
      expect(pageFromSearch(`?tab=${v}`)?.view, v).toBe(v);
    }
    expect(pageForLegacyTab('nope')).toBeUndefined();
    expect(pageForLegacyTab(null)).toBeUndefined();
  });

  it('?p= wins over ?tab= and hrefOf round-trips, view params included', () => {
    expect(pageFromSearch('?p=challenges&tab=shop')?.id).toBe('challenges');
    for (const p of PAGES)
      expect(pageFromSearch(hrefOf(p).slice(1))?.id).toBe(p.id);
    expect(hrefOf(pageById('tts')!)).toBe('/?p=tts');
    expect(hrefOf(pageById('bonk')!)).toBe('/?p=bonk');
  });

  it('breadcrumbs are at most three levels and a section home is one level', () => {
    for (const p of PAGES) expect(crumbsOf(p).length).toBeLessThanOrEqual(3);
    expect(crumbsOf(pageById('centre')!)).toEqual(['Centre de contrôle']);
    expect(crumbsOf(pageById('spotify')!)).toEqual([
      'Modules',
      'Musique',
      'Spotify',
    ]);
  });

  it('search ignores accents and case, ranks label matches first', () => {
    expect(searchPages('defis')[0]?.id).toBe('challenges');
    expect(searchPages('POINTS DE CHAINE').map((p) => p.id)).toContain(
      'channel-points',
    );
    expect(searchPages('   ')).toEqual([]);
    expect(searchPages('zzzz-introuvable')).toEqual([]);
  });

  it('module catalogue lists every module page once', () => {
    const listed = moduleGroups().flatMap((g) => g.pages.map((p) => p.id));
    const modules = PAGES.filter((p) => p.section === 'modules' && !p.hub).map(
      (p) => p.id,
    );
    expect(listed.sort()).toEqual([...modules].sort());
  });
});

describe('favourites and recents', () => {
  it('toggleFav adds, removes and caps', () => {
    expect(toggleFav(['shop'], 'alerts')).toEqual(['shop', 'alerts']);
    expect(toggleFav(['shop', 'alerts'], 'shop')).toEqual(['alerts']);
    expect(toggleFav(['shop', 'gone', 'shop'], 'unknown-page')).toEqual([
      'shop',
    ]);
    const full = PAGES.slice(0, MAX_FAVS).map((p) => p.id);
    expect(toggleFav(full, PAGES[MAX_FAVS]!.id)).toHaveLength(MAX_FAVS);
  });

  it('pushRecent moves to front, dedupes and keeps six', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushRecent(['1', '2', '3', '4', '5', '6'], '7')).toEqual([
      '7',
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });
});

describe('Régie live', () => {
  const href = (id: string) => `/?p=${id}`;
  it('names each stop by module, never a global stop', () => {
    const html =
      automationHtml({ enabled: true, rules: 2 }) +
      healthHtml(null, true, href) +
      controlsHtml(href);
    expect(html).toContain('Couper les automatisations…');
    expect(html).toContain('2 récompenses');
    expect(html.toLowerCase()).not.toMatch(
      /<button[^>]*>[^<]*(tout arr|arrêter tout|stop all)/,
    );
    for (const c of REGIE_CONTROLS)
      expect(pageById(c.page), c.page).toBeTruthy();
  });

  it('an unknown state offers no action', () => {
    const html = automationHtml(null);
    expect(html).toContain('État inconnu');
    expect(html).not.toContain('data-regie="cp"');
  });

  it('the stop confirmation states its real scope', () => {
    expect(CP_OFF_CONFIRM).toContain('ne sont pas remboursés');
    expect(CP_OFF_CONFIRM).toContain('ne sont pas touchés');
  });
});

describe('Régie live queues', () => {
  const href = (id: string) => `/?p=${id}`;
  const live = {
    tombola: {
      status: 'open',
      kind: 'normal',
      participants: 3,
      remaining_ms: 41_000,
      label: '500 Jetons',
    },
    alerts: { playing: 1, queued: 2, source: true },
    tts: { state: 'active', current: 'Fictif', waiting: 4 },
    spotify: { admission: 'MODULE_DISABLED', current: null, queue: 0 },
  };
  it('shows real queue states and named actions only where they apply', () => {
    const lab = liveHtml(live, 'lab', href);
    expect(lab).toContain('3 participants');
    expect(lab).toContain('0:41');
    expect(lab).toContain('data-live="tombola-pause"');
    expect(lab).toContain('data-live="tombola-cancel"');
    expect(lab).toContain('1 en lecture · 2 en attente');
    expect(lab).toContain('data-live="tts-stop"');
    expect(lab).toContain('Demandes fermées');
  });
  it('Production: TTS actions go through the moderation door, as in the Modération page', async () => {
    const prod = liveHtml(live, 'production', href);
    expect(prod).toContain('data-live="tts-stop"');
    const seen: unknown[] = [];
    vi.stubGlobal('fetch', async (_: string, init: { body: string }) => {
      seen.push(JSON.parse(init.body));
      return new Response('{}');
    });
    await LIVE_ACTIONS['tts-stop']!.run();
    await LIVE_ACTIONS['tts-pause']!.run();
    vi.unstubAllGlobals();
    expect(seen).toEqual([
      { command: { action: 'stop_current', module: 'tts', refund: true } },
      {
        command: {
          action: 'module_state',
          module: 'tts',
          state: 'paused',
          waiting: 'keep',
        },
      },
    ]);
  });
  it('an unreadable module offers no action; a paused Tombola offers Reprendre', () => {
    const html = liveHtml(
      {
        tombola: { ...live.tombola, status: 'paused' },
        alerts: null,
        tts: null,
        spotify: null,
      },
      'lab',
      href,
    );
    expect(html).toContain('data-live="tombola-resume"');
    expect(html).not.toContain('data-live="tts-');
    expect(html.match(/Indisponible sur ce profil/g)).toHaveLength(3);
  });
  it('the sidebar counters come from the same reading, and only say what is there', () => {
    const now = 1_000_000;
    expect(liveCounts(live, now)).toEqual({
      tts: '4',
      alerts: '3',
      tombola: '0:41',
    });
    expect(
      liveCounts(
        { ...live, tombola: { ...live.tombola, ends_at: now + 5000 } },
        now,
      ).tombola,
    ).toBe('0:05');
    expect(
      liveCounts(
        { ...live, tombola: { ...live.tombola, status: 'paused' } },
        now,
      ).tombola,
    ).toBe('Pause');
    const quiet = {
      tombola: 'none',
      alerts: null,
      tts: null,
      spotify: null,
    } as const;
    expect(liveCounts(quiet, now)).toEqual({
      tts: null,
      alerts: null,
      tombola: null,
    });
    expect(liveCounts(undefined, now).tts).toBeNull();
  });
  it('the Tombola deadline holds between two readings unless it really drifts', () => {
    const at = (ends_at: number) => ({
      ...live,
      tombola: { ...live.tombola, raffle_id: 'r', ends_at },
    });
    const t = (l: ReturnType<typeof at>) => l.tombola.ends_at;
    expect(t(steadyEnds(at(1000), at(1800)) as ReturnType<typeof at>)).toBe(
      1000,
    );
    expect(t(steadyEnds(at(1000), at(9000)) as ReturnType<typeof at>)).toBe(
      9000,
    );
  });
  it('what needs a decision: a message to check has its verbs, a recovered incident its « Vu »', () => {
    const list = decisions(
      {
        ...live,
        tts: {
          state: 'active',
          current: null,
          waiting: 1,
          queue: [
            {
              interaction_id: 'i1',
              viewer_id: '1',
              viewer_display_name: 'Nina',
              message: 'à lire',
              status: 'queued',
              created_at: '',
              review_status: 'pending',
            },
          ],
        },
      },
      {
        now: '',
        history: [],
        incidents: [
          {
            id: 'x',
            signal: 'tts',
            label: 'TTS',
            cause: null,
            value: 'Lecteur absent',
            hint: null,
            action: 'manual',
            startedAt: '',
            confirmedAt: '',
            endedAt: null,
            acknowledged: false,
          },
          {
            id: 'y',
            signal: 'bonk',
            label: 'Bonk',
            cause: null,
            value: '',
            hint: null,
            action: 'auto',
            startedAt: '',
            confirmedAt: '',
            endedAt: 'fin',
            acknowledged: false,
          },
        ],
      },
      href,
    );
    expect(list.map((d) => d.key)).toEqual(['inc:x', 'tts:i1', 'up:y']);
    expect(list[0]!.html).toContain('Action requise');
    expect(list[1]!.html).toContain('data-allow="i1"');
    expect(list[1]!.html).toContain('data-more="i1"');
    expect(list[2]!.html).toContain('data-sup-ack="y"');
  });
  it('destructive live actions confirm their consequences', () => {
    expect(LIVE_ACTIONS['tombola-cancel']!.confirm).toContain(
      'personne n’est payé',
    );
    expect(LIVE_ACTIONS['tts-stop']!.confirm).toContain('remboursé');
    expect(CP_OFF_CONFIRM).toContain('jamais rejoués');
  });
});
