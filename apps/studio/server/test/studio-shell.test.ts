import { describe, expect, it } from 'vitest';
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
  CP_OFF_CONFIRM,
  REGIE_CONTROLS,
  regieHtml,
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
    expect(hrefOf(pageById('tts')!)).toBe('/?p=tts&surface=panel');
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
    const html = regieHtml({
      sup: null,
      supOk: true,
      cp: { enabled: true, rules: 2 },
      message: '',
      href,
    });
    expect(html).toContain('Couper les automatisations…');
    expect(html).toContain('2 récompense(s)');
    expect(html.toLowerCase()).not.toMatch(
      /<button[^>]*>[^<]*(tout arr|arrêter tout|stop all)/,
    );
    for (const c of REGIE_CONTROLS)
      expect(pageById(c.page), c.page).toBeTruthy();
  });

  it('an unknown state offers no action', () => {
    const html = regieHtml({
      sup: null,
      supOk: false,
      cp: null,
      message: '',
      href,
    });
    expect(html).toContain('État inconnu');
    expect(html).not.toContain('data-regie="cp"');
  });

  it('the stop confirmation states its real scope', () => {
    expect(CP_OFF_CONFIRM).toContain('ne sont pas remboursées');
    expect(CP_OFF_CONFIRM).toContain('ne sont pas touchés');
  });
});
