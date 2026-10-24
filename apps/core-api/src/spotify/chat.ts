import type { LabChatMessage } from '@raptoru/schemas';
import { MSG } from './messages.js';
import type { SpotifyService } from './service.js';

// Spotify V2 chat commands (docs/SPOTIFY_V2.md § 3) — the historical SAMMI triggers, answered by LeCroupier_ with the
// historical texts. Strict syntax (docs/CHAT_COMMANDS.md): the command alone, `!songremove` with its one argument.
// `!songremove` / `!songskip`: moderators and the broadcaster (decks of 07/09 and 15/09); anyone else: nothing, as the
// SAMMI trigger never fired for them.

const SIMPLE = /^!(song|songqueue|mysong|songcancel|songskip)$/i;
const REMOVE = /^!songremove(?:\s+(.+))?$/i;

export class SpotifyChat {
  constructor(private readonly spotify: SpotifyService) {}

  async chat(msg: LabChatMessage): Promise<{ outcome: string }> {
    const text = msg.text.trim();
    const viewer = { id: msg.chatter.id, name: msg.chatter.display_name };
    const mod =
      msg.chatter.role === 'moderator' || msg.chatter.role === 'broadcaster';
    const key = `spotify:msg:${msg.message_id}`;
    const remove = text.match(REMOVE);
    if (remove) {
      if (!mod) return { outcome: 'ignored' };
      const arg = (remove[1] ?? '').trim();
      if (/^\d+$/.test(arg))
        return {
          outcome: await this.spotify.remove(
            msg.channel_id,
            key,
            { position: Number(arg) },
            msg.chatter.login,
          ),
        };
      if (/^@?[a-z0-9_]{1,30}$/i.test(arg))
        return {
          outcome: await this.spotify.remove(
            msg.channel_id,
            key,
            { login: arg },
            msg.chatter.login,
          ),
        };
      await this.spotify.sayOnce(msg.channel_id, key, MSG.removeUsage);
      return { outcome: 'songremove_usage' };
    }
    const m = text.match(SIMPLE);
    if (!m) return { outcome: 'ignored' };
    switch (m[1]!.toLowerCase()) {
      case 'song':
        return {
          outcome: await this.spotify.askNowPlaying(
            msg.channel_id,
            msg.message_id,
            viewer.name,
          ),
        };
      case 'songqueue':
        return {
          outcome: await this.spotify.songQueue(msg.channel_id, msg.message_id),
        };
      case 'mysong':
        return {
          outcome: await this.spotify.mySong(
            msg.channel_id,
            msg.message_id,
            viewer,
          ),
        };
      case 'songcancel':
        return {
          outcome: await this.spotify.cancel(
            msg.channel_id,
            msg.message_id,
            viewer,
          ),
        };
      default:
        if (!mod) return { outcome: 'ignored' };
        return {
          outcome: await this.spotify.skip(
            msg.channel_id,
            key,
            msg.chatter.display_name,
          ),
        };
    }
  }
}
