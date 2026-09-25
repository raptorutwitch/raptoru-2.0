import { describe, expect, it, vi } from 'vitest';
import {
  SnapshotAbortedError,
  takeChattersSnapshot,
  type GetChattersPage,
} from '../src/presence/chatters-snapshot.js';
import { HelixError, type ChattersPage } from '../src/twitch/helix.js';

const chatter = (id: string) => ({
  twitchUserId: id,
  login: `u${id}`,
  displayName: `U${id}`,
});
const page = (
  ids: string[],
  cursor: string | null,
  total: number | null = null,
): ChattersPage => ({
  chatters: ids.map(chatter),
  cursor,
  total,
});
const noSleep = async () => {};
const opts = () => ({ signal: new AbortController().signal, sleep: noSleep });

describe('Get Chatters snapshot', () => {
  it('follows every cursor and returns a complete, deduplicated snapshot', async () => {
    const pages: Record<string, ChattersPage> = {
      start: page(['1', '2'], 'c1', 4),
      c1: page(['3', '2'], 'c2', 4),
      c2: page(['4'], null, 4),
    };
    const getPage = vi.fn<GetChattersPage>(
      async (after) => pages[after ?? 'start']!,
    );

    const { snapshot } = await takeChattersSnapshot(getPage, opts());

    expect(snapshot).toEqual({
      status: 'ok',
      chatters: ['1', '2', '3', '4'].map(chatter),
      reportedTotal: 4,
      pages: 3,
    });
    expect(getPage.mock.calls.map((c) => c[0])).toEqual([null, 'c1', 'c2']);
  });

  it('fails the whole snapshot on a repeated cursor (never a partial success)', async () => {
    const getPage: GetChattersPage = async (after) =>
      after ? page(['2'], 'loop') : page(['1'], 'loop');
    const { snapshot } = await takeChattersSnapshot(getPage, opts());
    expect(snapshot).toMatchObject({
      status: 'error',
      errorKind: 'pagination',
      message: 'repeated pagination cursor',
    });
  });

  it('stops an endless pagination at the page limit', async () => {
    let n = 0;
    const getPage: GetChattersPage = async () => page([String(++n)], `c${n}`);
    const { snapshot } = await takeChattersSnapshot(getPage, {
      ...opts(),
      maxPages: 5,
    });
    expect(snapshot).toMatchObject({
      status: 'error',
      errorKind: 'pagination',
    });
    expect(n).toBe(5);
  });

  it('retries a transient page failure once, then gives up', async () => {
    const flaky = vi
      .fn<GetChattersPage>()
      .mockRejectedValueOnce(new HelixError(503, 'unavailable'))
      .mockResolvedValueOnce(page(['1'], null));
    expect((await takeChattersSnapshot(flaky, opts())).snapshot.status).toBe(
      'ok',
    );

    const down = vi
      .fn<GetChattersPage>()
      .mockRejectedValue(new HelixError(502, 'bad gateway'));
    const { snapshot } = await takeChattersSnapshot(down, opts());
    expect(snapshot).toMatchObject({
      status: 'error',
      errorKind: 'http_error',
      httpStatus: 502,
    });
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('a page failing mid-pagination fails the snapshot', async () => {
    const getPage = vi
      .fn<GetChattersPage>()
      .mockResolvedValueOnce(page(['1'], 'c1'))
      .mockRejectedValue(new TypeError('fetch failed'));
    const { snapshot } = await takeChattersSnapshot(getPage, opts());
    expect(snapshot).toMatchObject({ status: 'error', errorKind: 'network' });
  });

  it('times out as a whole when Twitch hangs', async () => {
    const hang: GetChattersPage = (_after, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      );
    const { snapshot } = await takeChattersSnapshot(hang, {
      ...opts(),
      deadlineMs: 50,
    });
    expect(snapshot).toMatchObject({ status: 'error', errorKind: 'timeout' });
  });

  it('reports 429 with the Twitch reset instant, and 401/403 as auth, without retrying', async () => {
    const limited = vi
      .fn<GetChattersPage>()
      .mockRejectedValue(new HelixError(429, 'too many', 1_900_000_000_000));
    expect(await takeChattersSnapshot(limited, opts())).toEqual({
      snapshot: {
        status: 'error',
        errorKind: 'rate_limited',
        httpStatus: 429,
        message: 'Twitch rate limit',
      },
      retryAtMs: 1_900_000_000_000,
    });
    expect(limited).toHaveBeenCalledTimes(1);

    const denied = vi
      .fn<GetChattersPage>()
      .mockRejectedValue(new HelixError(403, 'forbidden'));
    expect((await takeChattersSnapshot(denied, opts())).snapshot).toMatchObject(
      { errorKind: 'auth', httpStatus: 403 },
    );
    expect(denied).toHaveBeenCalledTimes(1);
  });

  it('throws when the worker aborts: an abandoned snapshot is never reported', async () => {
    const controller = new AbortController();
    const getPage: GetChattersPage = async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    };
    await expect(
      takeChattersSnapshot(getPage, {
        signal: controller.signal,
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(SnapshotAbortedError);
  });
});
