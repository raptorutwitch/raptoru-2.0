import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountTwitchConnections } from '../../web/src/twitch-connections.ts';

const { Response } = globalThis;

afterEach(() => vi.unstubAllGlobals());

const status = (flow = null) => ({
  configured: true,
  authorization_allowed: true,
  authorization_blocked_reason: null,
  busy: flow?.state === 'waiting' ? 'authorize' : null,
  flow,
  accounts: [
    {
      role: 'bot',
      expected: { login: 'lecroupier_', user_id: '1239040922' },
      stored: {
        login: 'lecroupier_',
        user_id: '1239040922',
        expires_at: null,
        refresh_available: true,
      },
      validated: null,
      client_id: 'fake-client',
      token_file: 'fake-source.json',
      state: 'unverified',
      stored_expired: false,
      scopes: ['user:read:chat'],
      required_scopes: ['user:read:chat', 'user:write:chat'],
      missing_scopes: ['user:write:chat'],
      checked_at: null,
      validated_at: null,
      features: [
        {
          label: 'Écriture chat',
          scope: 'user:write:chat',
          scope_present: false,
        },
      ],
    },
  ],
});

function root() {
  let click;
  const element = {
    innerHTML: '',
    querySelectorAll: () => [],
    addEventListener: (_name, callback) => {
      click = callback;
    },
  };
  const view = mountTwitchConnections(element);
  return {
    element,
    view,
    click: (action, role) =>
      click({
        target: {
          closest: () => ({
            dataset: { twitchAction: action, role },
            disabled: false,
          }),
        },
      }),
  };
}

describe('Comptes Twitch view: consent only after a deliberate click', () => {
  it('does not contact the backend while hidden and only reads metadata on visibility', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(status())));
    vi.stubGlobal('fetch', fetch);
    const f = root();
    expect(fetch).not.toHaveBeenCalled();
    f.view.setVisible(true);
    await vi.waitFor(() =>
      expect(f.element.innerHTML).toContain('NON VÉRIFIÉ'),
    );
    f.view.setVisible(false);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/twitch-connections',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(f.element.innerHTML).toContain(
      'Les rôles Twitch et les abonnements EventSub ne sont pas vérifiés',
    );
    expect(f.element.innerHTML).not.toContain('href="https://id.twitch.tv');
  });

  it('starts a selected account only on click, offers a Twitch link and rejects a hostile navigation URL', async () => {
    const url =
      'https://id.twitch.tv/oauth2/authorize?client_id=fake-client&state=test';
    const fetch = vi.fn(async () => new Response(JSON.stringify(status())));
    vi.stubGlobal('fetch', fetch);
    const f = root();
    f.view.setVisible(true);
    await vi.waitFor(() =>
      expect(f.element.innerHTML).toContain('NON VÉRIFIÉ'),
    );
    f.view.setVisible(false);
    fetch.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            status({ role: 'bot', state: 'waiting', authorization_url: url }),
          ),
        ),
    );
    await f.click('authorize', 'bot');
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/twitch-connections/authorize',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ role: 'bot' }),
      }),
    );
    expect(f.element.innerHTML).toContain('Ouvrir Twitch pour LeCroupier_');
    expect(f.element.innerHTML).toContain(
      'target="_blank" rel="noopener noreferrer"',
    );
    fetch.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            status({
              role: 'bot',
              state: 'waiting',
              authorization_url: 'https://evil.example/',
            }),
          ),
        ),
    );
    await f.click('cancel');
    expect(f.element.innerHTML).not.toContain('href="https://evil.example');
  });
});
