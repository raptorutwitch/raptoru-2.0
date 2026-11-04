import {
  ChallengeId,
  ChallengeInput,
  ChallengeRevoke,
  ChallengeStatusChange,
} from '@raptoru/schemas';
import {
  ChallengeError,
  type ChallengeService,
} from '../challenges/service.js';
import { HttpError, parse, type Route } from './server.js';

// Défis et succès (raptoru.fr lot 5, docs/CHALLENGES.md):
// - Studio (the paired installation in production, the Lab secret in the Lab): definitions, preview, status, recount,
//   progress / awards / log, revocation of an item;
// - the site (its token): the catalogue and the signed-in viewer's progress — read only. No public route, nothing the
//   site or a viewer sends can move a progress or complete a challenge.

const mapped = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ChallengeError)
      throw new HttpError(e.status, { error: e.code, ...e.details });
    throw e;
  }
};

export function challengesRoutes(
  svc: ChallengeService,
  o: { channelId: string; production: boolean; site: boolean },
): Route[] {
  const ch = o.channelId;
  const auth = o.production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const admin = (path: string) =>
    new RegExp(
      `^\\/v1\\/${o.production ? 'studio' : 'lab'}\\/challenges${path}$`,
    );
  const actor = (installation?: string) =>
    installation ? 'Studio' : 'Studio (Lab)';
  const id = (raw: string) => parse(ChallengeId, raw);
  return [
    {
      method: 'GET',
      pattern: admin(''),
      auth,
      handle: () => mapped(() => svc.list(ch)),
    },
    {
      method: 'GET',
      pattern: admin('/meta'),
      auth,
      handle: () => mapped(() => svc.meta(ch)),
    },
    {
      method: 'GET',
      pattern: admin('/runs'),
      auth,
      handle: () => mapped(() => svc.runs(ch)),
    },
    {
      method: 'POST',
      pattern: admin('/run'),
      auth,
      handle: ({ installation }) =>
        mapped(() =>
          svc.run(ch, { trigger: 'manual', actor: actor(installation) }),
        ),
    },
    {
      method: 'POST',
      pattern: admin('/preview'),
      auth,
      handle: ({ body }) =>
        mapped(() => svc.preview(ch, parse(ChallengeInput, body))),
    },
    {
      method: 'POST',
      pattern: admin(''),
      auth,
      handle: ({ body, installation }) =>
        mapped(() =>
          svc.create(ch, parse(ChallengeInput, body), actor(installation)),
        ),
    },
    {
      method: 'GET',
      pattern: admin('/([a-z0-9][a-z0-9_-]{0,47})'),
      auth,
      handle: ({ params }) => mapped(() => svc.detail(ch, id(params[0]!))),
    },
    {
      method: 'POST',
      pattern: admin('/([a-z0-9][a-z0-9_-]{0,47})'),
      auth,
      handle: ({ params, body, installation }) =>
        mapped(async () => {
          const input = parse(ChallengeInput, body);
          if (input.challenge_id !== params[0])
            throw new HttpError(400, { error: 'id_mismatch' });
          return svc.update(ch, input, actor(installation));
        }),
    },
    {
      method: 'POST',
      pattern: admin('/([a-z0-9][a-z0-9_-]{0,47})/delete'),
      auth,
      handle: ({ params }) => mapped(() => svc.remove(ch, id(params[0]!))),
    },
    {
      method: 'POST',
      pattern: admin('/([a-z0-9][a-z0-9_-]{0,47})/status'),
      auth,
      handle: ({ params, body, installation }) =>
        mapped(() =>
          svc.setStatus(
            ch,
            id(params[0]!),
            parse(ChallengeStatusChange, body).status,
            actor(installation),
          ),
        ),
    },
    {
      method: 'POST',
      pattern: admin('/([a-z0-9][a-z0-9_-]{0,47})/revoke'),
      auth,
      handle: ({ params, body, installation }) =>
        mapped(() =>
          svc.revoke(
            ch,
            id(params[0]!),
            parse(ChallengeRevoke, body),
            actor(installation),
          ),
        ),
    },
    ...(o.site
      ? [
          {
            // The site: the catalogue alone, or with the signed-in viewer (the site's SESSION, never a choice of the page).
            method: 'GET' as const,
            pattern: /^\/v1\/site\/challenges$/,
            auth: 'site' as const,
            handle: ({ url }: { url: URL }) =>
              mapped(() => {
                const v = url.searchParams.get('viewer');
                if (v !== null && !/^\d{1,32}$/.test(v))
                  throw new HttpError(400, { error: 'invalid_viewer' });
                return svc.site(ch, v);
              }),
          },
        ]
      : []),
  ];
}
