// node --test scripts/delivery/authorize.test.mjs — who may run a Production deployment from GitHub.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { authorize } from './authorize.mjs';

const SHA = 'a'.repeat(40);
const roles = { raptorutwitch: 'admin', helper: 'write' };
let base;
const server = createServer((req, res) => {
  const who = /collaborators\/([^/]+)\/permission$/.exec(req.url)?.[1];
  res.writeHead(
    req.headers.authorization === 'Bearer gh' && roles[who] ? 200 : 404,
    {
      'content-type': 'application/json',
    },
  );
  res.end(JSON.stringify({ permission: roles[who] }));
});
before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const env = (over = {}) => ({
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'raptorutwitch',
  GITHUB_TRIGGERING_ACTOR: 'raptorutwitch',
  GITHUB_REPOSITORY: 'raptorutwitch/raptoru-2.0',
  GITHUB_API_URL: base,
  GITHUB_TOKEN: 'gh',
  DEPLOY_ACTORS: 'raptorutwitch',
  INPUT_SHA: SHA,
  INPUT_COMPONENT: 'core',
  INPUT_MODE: 'deploy',
  INPUT_CONFIRM: `DEPLOY core ${SHA.slice(0, 7)}`,
  ...over,
});
const onMain = { isOnMain: (s) => s === SHA };

describe('deployment authorisation', () => {
  it('the administrator, from main, an exact SHA of main, the confirmation: authorised', async () => {
    assert.deepEqual(await authorize(env(), onMain), []);
    assert.deepEqual(
      await authorize(env({ INPUT_MODE: 'plan', INPUT_CONFIRM: '' }), onMain),
      [],
    );
  });

  it('refusals: another branch, another trigger, an actor not listed or not admin, a re-run by someone else', async () => {
    const reasons = async (over) =>
      (await authorize(env(over), onMain)).join(' | ');
    assert.match(
      await reasons({ GITHUB_REF: 'refs/heads/feature' }),
      /seulement depuis main/,
    );
    assert.match(
      await reasons({ GITHUB_EVENT_NAME: 'push' }),
      /seul un lancement manuel/,
    );
    assert.match(
      await reasons({
        GITHUB_ACTOR: 'helper',
        GITHUB_TRIGGERING_ACTOR: 'helper',
      }),
      /helper n’est pas dans DEPLOY_ACTORS/,
    );
    assert.match(
      await reasons({
        GITHUB_ACTOR: 'helper',
        GITHUB_TRIGGERING_ACTOR: 'helper',
        DEPLOY_ACTORS: 'raptorutwitch,helper',
      }),
      /helper : rôle GitHub write \(administrateur requis\)/,
    );
    assert.match(
      await reasons({ GITHUB_TRIGGERING_ACTOR: 'helper' }),
      /helper n’est pas dans DEPLOY_ACTORS/,
    );
    assert.match(
      await reasons({ DEPLOY_ACTORS: '' }),
      /personne n’est autorisé/,
    );
  });

  it('refusals: a short or foreign SHA, an unknown component, a missing or wrong confirmation', async () => {
    const reasons = async (over) =>
      (await authorize(env(over), onMain)).join(' | ');
    assert.match(
      await reasons({ INPUT_SHA: SHA.slice(0, 12) }),
      /40 caractères/,
    );
    assert.match(
      await reasons({
        INPUT_SHA: 'b'.repeat(40),
        INPUT_CONFIRM: 'DEPLOY core bbbbbbb',
      }),
      /n’est pas sur origin\/main/,
    );
    assert.match(
      await reasons({ INPUT_COMPONENT: 'database' }),
      /composant inconnu/,
    );
    assert.match(
      await reasons({ INPUT_CONFIRM: 'oui' }),
      /confirmation attendue .*DEPLOY core aaaaaaa/,
    );
    assert.match(
      await reasons({ INPUT_COMPONENT: 'bot' }),
      /DEPLOY bot aaaaaaa/,
    );
  });
});
