// Module skeleton (docs/studio-refonte/architecture/GUIDE_MODULE.md): `npm run module:new -- <id> [admin|paid]`.
// Writes src/modules/<id>.ts and test/module-<id>.test.ts (kebab-case names), Lab only, OFF by default, then prints the
// one line to add: Studio's catalogue, page, palette and supervision follow from the Core's catalog.
// It never edits a central file and never overwrites a file. Profiles: admin (démonstration A), paid (démonstration B).
import console from 'node:console';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const [id, profile = 'admin'] = process.argv.slice(2);
if (!/^[a-z][a-z0-9_]{1,40}$/.test(id ?? '') || !['admin', 'paid'].includes(profile)) {
  console.error('usage: npm run module:new -- <id_en_snake_case> [admin|paid]');
  process.exit(1);
}
const name = id.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const file = id.replace(/_/g, '-');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  [`src/modules/${file}.ts`]: `import type { ModuleDefinition } from './kit.js';

// TODO: what this module does, for whom (GUIDE_MODULE.md). Lab only until Antoni validates it.

export const ${name}: ModuleDefinition = {
  id: '${id}',
  label: 'TODO libellé',
  description: 'TODO une phrase pour Studio${profile === 'paid' ? ' et l’extension' : ''}.',
  category: 'outils',
  labOnly: true,
  capabilities: [${profile === 'paid' ? "'settings', 'viewer', 'wallet', 'live', 'history', 'moderation', 'supervision'" : "'settings', 'admin', 'history', 'supervision'"}],
  settings: {
    ${profile === 'paid' ? "prix: { label: 'Prix', unit: 'Jetons', default: 100, min: 10, max: 10_000 }," : "valeur: { label: 'TODO réglage', unit: 'points', default: 10, min: 1, max: 1_000 },"}
  },
${
  profile === 'paid'
    ? `  // GUIDE_MODERATION.md: who sees it, can it be refunded (the original debit, once, by a moderator)?
  moderation: { visible: true, refund: 'moderator', note: 'TODO quand rembourser.' },
  viewer: {
    utiliser: {
      label: 'TODO action',
      price: (ctx, q, ch) => ctx.setting(q, ch, 'prix'),
      async run() {
        // Paid, journaled, idempotent already: only the module's own effect here.
        return { status: 'done', result: null };
      },
    },
  },`
    : `  admin: {
    faire: {
      label: 'TODO action Studio',
      async run() {
        return { result: null };
      },
    },
  },`
}
  async status(ctx, channelId) {
    // Never « ready » on the switch alone: say what really works.
    return { intention: 'on', observed: 'unknown', summary: 'TODO état réel', reasons: [] };
  },
};
`,
  [`test/module-${file}.test.ts`]: `import { describe, expect, it } from 'vitest';
import { checkModule } from '../src/modules/kit.js';
import { ${name} } from '../src/modules/${file}.js';

describe('${id}', () => {
  it('passes the module contract', () => {
    expect(checkModule(${name})).toEqual([]);
  });
  it.todo('its own rule (see modules-host.test.ts for the host fixture)');
});
`,
};
for (const f of Object.keys(files))
  if (existsSync(join(root, f))) {
    console.error(`${f} existe déjà : rien n’est écrit.`);
    process.exit(1);
  }
for (const [f, text] of Object.entries(files)) {
  writeFileSync(join(root, f), text);
  console.log(`écrit  apps/core-api/${f}`);
}
console.log(`
Reste à ajouter (1 ligne) :
  apps/core-api/src/modules/index.ts       ${name},  (et son import depuis './${file}.js')
Catalogue, page, recherche et supervision de Studio suivent seuls.${
  profile === 'paid'
    ? `
Vue viewer (optionnelle) : apps/twitch-extension/extension/shared/${file}.js avec registerViewerModule(...)
  + une ligne import dans shared/ui.js (voir coffre-mystere.js).`
    : ''
}`);
