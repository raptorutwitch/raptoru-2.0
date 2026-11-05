import type { BrowserContext, Page } from '@playwright/test';

// Network isolation of an E2E page or context (with playwright.config's host-resolver rule, which already makes every
// host name unresolvable): the stack is 127.0.0.1; the emote CDNs the fictional catalogs point to (Twitch, 7TV, BTTV,
// FFZ) are served locally; Twitch's authorize page is the FICTIONAL consent (it sends the browser back to the Studio's
// callback with a code, or with a refusal); anything else is aborted and recorded in `outside` (tests assert it empty).

const IMAGE_HOSTS =
  /^(static-cdn\.jtvnw\.net|cdn\.7tv\.app|cdn\.betterttv\.net|cdn\.frankerfacez\.com)$/;
const IMAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#7c3aed"/></svg>';

export interface Isolation {
  outside: string[];
  /** What the fictional viewer answers on Twitch's authorize page. */
  twitchConsent: 'grant' | 'deny';
}

export async function isolate(
  target: Page | BrowserContext,
): Promise<Isolation> {
  const iso: Isolation = { outside: [], twitchConsent: 'grant' };
  await target.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => {
    const url = new URL(route.request().url());
    if (IMAGE_HOSTS.test(url.host))
      return route.fulfill({ body: IMAGE, contentType: 'image/svg+xml' });
    if (url.host === 'id.twitch.tv' && url.pathname === '/oauth2/authorize') {
      const back = new URL(String(url.searchParams.get('redirect_uri')));
      if (back.hostname !== '127.0.0.1') {
        iso.outside.push(url.href); // only the stack's own callback, never a real one
        return route.abort();
      }
      if (iso.twitchConsent === 'grant')
        back.searchParams.set('code', 'e2e-code');
      else back.searchParams.set('error', 'access_denied');
      back.searchParams.set('state', String(url.searchParams.get('state')));
      return route.fulfill({ status: 302, headers: { location: back.href } });
    }
    iso.outside.push(url.href);
    return route.abort();
  });
  return iso;
}
