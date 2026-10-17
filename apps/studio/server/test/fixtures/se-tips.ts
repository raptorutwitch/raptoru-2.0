// StreamElements Astro messages, from the official examples (docs.streamelements.com/websockets/topics/channel-tips
// and channel-tips-moderation, read 17/10/2026; values verbatim). `tip()` builds variants of the channel.tips example.

export const SE_TIP_EXAMPLE = {
  id: '01JMFBZF7KSRDDXXV0EH7G8X6G',
  ts: '2025-02-19T15:07:17Z',
  type: 'message',
  topic: 'channel.tips',
  room: '5ad23dcc18fff500d78c5348',
  data: {
    donation: {
      user: {
        username: 'Styler',
        geo: 'ZZ',
        email: 'styler@streamelements.com',
        channel: '5ad23dcc18fff500d78c5348',
      },
      message: '',
      amount: 4.2,
      currency: 'USD',
      paymentMethod: 'scheme',
    },
    _id: '67b5f39d07ecd4c594e60f73',
    channel: '5ad23dcc18fff500d78c5348',
    provider: 'paypal',
    approved: 'allowed',
    status: 'success',
    createdAt: '2025-02-19T15:07:09.302Z',
    updatedAt: '2025-02-19T15:07:17.099Z',
    transactionId: '2YH79902JR1691017',
  },
};

/** The moderation example (same tip): `approved` pending, then allowed (with approvedBy). */
export const SE_MODERATION = (
  approved: 'pending' | 'allowed' | 'rejected',
) => ({
  ...SE_TIP_EXAMPLE,
  id:
    approved === 'pending'
      ? '01JMFBZF7KSRDDXXV0EH7G8X6G'
      : '01JMFBZQVK8VCR34VDR5S29368',
  topic: 'channel.tips.moderation',
  data: {
    ...SE_TIP_EXAMPLE.data,
    approved,
    ...(approved === 'pending' ? {} : { approvedBy: 'styler' }),
  },
});

/** A channel.tips message changed in a few places (donation fields merged). */
export function tip(
  over: {
    _id?: unknown;
    username?: unknown;
    amount?: unknown;
    currency?: unknown;
    message?: unknown;
    status?: unknown;
    approved?: unknown;
  } = {},
) {
  const data: Record<string, unknown> = { ...SE_TIP_EXAMPLE.data };
  const donation: Record<string, unknown> = { ...SE_TIP_EXAMPLE.data.donation };
  const user: Record<string, unknown> = {
    ...SE_TIP_EXAMPLE.data.donation.user,
  };
  for (const [k, v] of Object.entries(over)) {
    if (k === 'username') user.username = v;
    else if (['amount', 'currency', 'message'].includes(k)) donation[k] = v;
    else data[k] = v;
  }
  for (const [k, v] of Object.entries(over))
    if (v === undefined) {
      delete data[k];
      delete donation[k];
      delete user[k === 'username' ? 'username' : ''];
    }
  donation.user = user;
  data.donation = donation;
  return { ...SE_TIP_EXAMPLE, data };
}

/** A fake JWT whose payload carries a StreamElements channel id (signature irrelevant: never verified locally). */
export const FAKE_JWT = [
  Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
  Buffer.from(
    JSON.stringify({ channel: '5ad23dcc18fff500d78c5348', role: 'owner' }),
  ).toString('base64url'),
  'c2lnbmF0dXJlLW5vdC1jaGVja2Vk',
].join('.');
