import { describe, expect, it } from 'vitest';
import { isTrustedPage, windowOpenDecision } from '../src/ipc-guard.js';

// ASTRA-P2-027: the Electron bridge answers only the Studio page or the local status page.
const policy = {
  studioOrigin: 'http://127.0.0.1:4100',
  statusPageUrl:
    'file:///C:/Program%20Files/Raptoru%20Studio/resources/app/apps/studio/desktop/static/status.html',
};

describe('Electron trust boundary', () => {
  it('trusts the Studio origin (any path / query) and the status page only', () => {
    for (const url of [
      'http://127.0.0.1:4100/',
      'http://127.0.0.1:4100/?tab=extension-lab&surface=video',
      `${policy.statusPageUrl}#retry`,
    ])
      expect(isTrustedPage(url, policy), url).toBe(true);
    for (const url of [
      'http://127.0.0.1:4101/', // another local server
      'http://localhost:4100/', // another origin for the browser
      'https://raptoru.fr/',
      'https://evil.example/?u=http://127.0.0.1:4100',
      'file:///C:/Users/x/Downloads/status.html', // another local file
      'data:text/html,<script>raptoruStudio.server.relaunchApp()</script>',
      '',
      'not a url',
    ])
      expect(isTrustedPage(url, policy), url).toBe(false);
  });

  it('new windows: Studio pages stay in the app, web links go to the browser, the rest is denied', () => {
    expect(
      windowOpenDecision(
        'http://127.0.0.1:4100/ext/video_component.html',
        policy,
      ),
    ).toBe('allow');
    expect(windowOpenDecision('https://dev.twitch.tv/console', policy)).toBe(
      'external',
    );
    expect(
      windowOpenDecision('file:///C:/Windows/system32/calc.exe', policy),
    ).toBe('deny');
    expect(windowOpenDecision('javascript:alert(1)', policy)).toBe('deny');
  });
});
