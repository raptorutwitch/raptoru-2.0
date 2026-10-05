import { describe, expect, it } from 'vitest';
import { errorLabel } from '../extension/shared/api.js';
import {
  bonkTwitchLockedForRole,
  isBonkEmoteSelectable,
  normalizeBonkEmote,
} from '../extension/shared/ui.js';

// Lab: only the viewer role is the connected Twitch account. In the moderator / broadcaster roles
// the identity is fictitious, so its Twitch emotes would be refused by Core (viewer_not_linked).
const emote = (source) =>
  normalizeBonkEmote(
    { id: `g-${source}`, source },
    { id: `${source}:1`, label: 'x', source },
  );
const selectable = (state, source) =>
  isBonkEmoteSelectable(emote(source), {
    demoMode: state.demo_mode === true,
    twitchLocked: bonkTwitchLockedForRole(state),
  });
const lab = (role) => ({ environment: 'lab', role, demo_mode: true });

describe('Bonk Lab: Twitch emotes follow the role identity', () => {
  it('linked viewer: Twitch emotes stay usable', () => {
    expect(selectable(lab('viewer'), 'twitch')).toBe(true);
  });

  it.each(['broadcaster', 'moderator'])(
    '%s: Twitch emotes are not selectable',
    (role) => {
      expect(selectable(lab(role), 'twitch')).toBe(false);
    },
  );

  it.each(['viewer', 'moderator', 'broadcaster'])(
    '%s: Unicode, 7TV, BTTV and FFZ unchanged',
    (role) => {
      for (const source of ['unicode', '7tv', 'bttv', 'ffz'])
        expect(selectable(lab(role), source)).toBe(true);
    },
  );

  it('outside the Lab, a real broadcaster / moderator keeps its Twitch emotes', () => {
    expect(
      bonkTwitchLockedForRole({ environment: null, role: 'broadcaster' }),
    ).toBe(false);
    expect(
      bonkTwitchLockedForRole({ environment: null, role: 'moderator' }),
    ).toBe(false);
  });

  it('a refused Twitch emote shows an explicit message, never the generic one', () => {
    for (const code of [
      'viewer_not_linked',
      'emote_not_in_catalog',
      'catalog_unavailable',
    ])
      expect(errorLabel(code)).not.toBe('Une erreur est survenue.');
  });
});
