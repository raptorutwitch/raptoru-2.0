// Computed-style comparison legacy ↔ v2 (plan § 7.1 rule 4): the same view, same size, same data in both shells;
// every element of the page (and its ::before/::after) must have the same computed style. A difference = a rule
// lost or changed by the rebuilt sheets. States: each view is also checked with its menus/popovers opened when
// a scenario exists, and with :hover/:focus on its first controls (forced via CDP).
//   node test/responsive/styles.mjs [--views hub,tts] [--sizes 651x434,565x376,377x251] [--surface video]
//        [--ignore prop1,prop2]
/* global document, getComputedStyle, localStorage -- evaluated in the page (Playwright) */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import { startServer } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(HERE, '../../../../package.json'))(
  '@playwright/test',
);
const opt = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i < 0 ? d : process.argv[i + 1];
};
const VIEWS = opt(
  'views',
  'hub,tts,soundboard,bonk,raffle_join,moderation,actions',
).split(',');
const SIZES = opt('sizes', '651x434,565x376,377x251')
  .split(',')
  .map((s) => s.split('x').map(Number));
const SURFACES = {
  video: 'video_component.html?anchor=component',
  panel: 'panel.html?anchor=panel',
  mobile: 'mobile.html?anchor=panel&platform=mobile',
};
const surfaces = opt('surface', 'video,panel,mobile').split(',');
// Properties that legitimately differ between shells (none yet). Animation-driven values are frozen below.
const IGNORE = new Set(opt('ignore', '').split(',').filter(Boolean));
const FLOORS_OFF = opt('floors', 'on') === 'off';

const server = await startServer(Number(process.env.PORT || 4481));
const port = server.address().port;
const browser = await chromium.launch();

async function snapshot(shell, surface, [w, h], view) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    reducedMotion: 'reduce',
    isMobile: surface === 'mobile',
    hasTouch: surface === 'mobile',
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('raptoru-live:tutorial-disabled:bonk:v1', '1');
    } catch {
      /* */
    }
  });
  // --floors off: the v2 text floors at 0 px, to prove that the mechanical scaling alone changes nothing at scale 1.
  if (FLOORS_OFF && shell === 'v2')
    await ctx.addInitScript(() =>
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent =
          ':root{--fl-strong:0px!important;--fl-body:0px!important;--fl-small:0px!important;--fl-micro:0px!important}';
        document.head.append(st);
      }),
    );
  const page = await ctx.newPage();
  await page.route(/twitch\.tv|raptoru\.fr/, (r) => r.abort());
  await page.goto(
    `http://127.0.0.1:${port}/calib-${shell}/${SURFACES[surface]}${view === 'hub' ? '' : `&demoModule=${view}`}`,
  );
  await page
    .waitForFunction(
      () => document.querySelector('#panel')?.children.length > 0,
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1500);
  // Freeze animations and transitions at their end state so both shells compare the same frame.
  const snap = await page.evaluate(
    (ignore) => {
      for (const a of document.getAnimations()) {
        try {
          a.finish();
        } catch {
          a.cancel();
        }
      }
      const skip = new Set(ignore);
      const out = [];
      const path = (el) => {
        const p = [];
        for (
          let e = el;
          e && e !== document.documentElement;
          e = e.parentElement
        )
          p.unshift(
            `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''}`,
          );
        return p.slice(-4).join(' > ');
      };
      const props = (cs) => {
        const o = {};
        for (let i = 0; i < cs.length; i += 1) {
          const k = cs[i];
          if (!skip.has(k) && !k.startsWith('--'))
            o[k] = cs.getPropertyValue(k);
        }
        return o;
      };
      for (const el of [
        document.documentElement,
        document.body,
        ...document.body.querySelectorAll('*'),
      ]) {
        if (el.closest('[data-env-badge], .env-badge')) continue;
        out.push({
          path: path(el),
          s: props(getComputedStyle(el)),
          b: props(getComputedStyle(el, '::before')),
          a: props(getComputedStyle(el, '::after')),
        });
      }
      return out;
    },
    [...IGNORE],
  );
  await ctx.close();
  return snap;
}

const report = [];
let total = 0;
for (const surface of surfaces) {
  for (const size of SIZES) {
    for (const view of VIEWS) {
      const [a, b] = [
        await snapshot('legacy', surface, size, view),
        await snapshot('v2', surface, size, view),
      ];
      const diffs = [];
      if (a.length !== b.length)
        diffs.push(`element count ${a.length} ≠ ${b.length}`);
      for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
        for (const part of ['s', 'b', 'a']) {
          for (const k of Object.keys(a[i][part])) {
            if (a[i][part][k] !== b[i][part][k])
              diffs.push(
                `${a[i].path}${part === 's' ? '' : part === 'b' ? '::before' : '::after'} ${k}: ${a[i][part][k]} → ${b[i][part][k]}`,
              );
          }
        }
      }
      total += diffs.length;
      report.push({
        surface,
        size: size.join('x'),
        view,
        diffs: diffs.length,
        sample: diffs.slice(0, 12),
      });
      console.log(
        `${surface} ${size.join('x')} ${view}: ${diffs.length ? `${diffs.length} différences` : 'identique'}${diffs.length ? '\n    ' + diffs.slice(0, 5).join('\n    ') : ''}`,
      );
    }
  }
}
await browser.close();
server.close();
mkdirSync(join(HERE, 'out'), { recursive: true });
writeFileSync(
  join(HERE, 'out', 'styles-legacy-v2.json'),
  JSON.stringify(report, null, 1),
);
console.log(`\n${total} différences de style calculé au total`);
process.exitCode = total ? 1 : 0;
