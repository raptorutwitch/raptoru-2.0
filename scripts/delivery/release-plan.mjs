// « À livrer » (scripts/delivery/status.mjs, docs/CICD.md « Procédure standard ») : ce que main apporte à chaque
// composant par rapport à ce qui tourne ou est publié, et l'étape à suivre. Pur (aucun réseau, aucun git) : status.mjs
// lui passe les fichiers changés et l'état de l'inventaire de l'extension. Règles du README « Does a change need a
// Studio release? » : Studio embarque son serveur, son web, le moteur Chaos, les paquets et la copie Lab de l'extension.

export const PATHS = Object.freeze({
  core: ['apps/core-api/', 'packages/', 'supabase/migrations/'],
  bot: ['apps/twitch-bot/', 'packages/'],
  studio: [
    'apps/studio/',
    'apps/chaos-engine/',
    'packages/',
    'apps/twitch-extension/extension/',
  ],
});

/** Les fichiers qui changent vraiment le composant : ni documentation, ni tests. */
export function relevant(files, prefixes) {
  return files.filter(
    (f) =>
      prefixes.some((p) => f.startsWith(p)) &&
      !/\.md$/i.test(f) &&
      !/(^|\/)(test|tests|e2e)\//.test(f) &&
      !/\.test\.[cm]?[jt]s$/.test(f),
  );
}

/**
 * Une ligne par composant : `todo` (une action reste à faire) et le texte. `extension` : commits de l'extension depuis
 * PUBLISHED et l'état de leur inventaire (package.mjs productionGate) ; null si inconnu.
 */
export function releasePlan({
  coreFiles = null,
  migrations = [],
  botFiles = null,
  studioFiles = null,
  studioTag = null,
  extension = null,
}) {
  const out = [];
  const core = coreFiles === null ? null : relevant(coreFiles, PATHS.core);
  out.push(
    core === null
      ? {
          component: 'Core',
          todo: false,
          text: 'état inconnu (Coolify illisible)',
        }
      : core.length
        ? {
            component: 'Core',
            todo: true,
            text: `${core.length} fichier(s) à déployer${migrations.length ? ` avec la migration ${migrations.join(', ')} (sauvegarde fraîche : --backup-now)` : ''} — Actions › « Déployer Core / bot » : plan, puis deploy`,
          }
        : { component: 'Core', todo: false, text: 'à jour' },
  );
  // The bot: its own files decide; shared schemas alone (Chaos, Soundboard…) seldom change it — its plan says.
  const botOwn =
    botFiles === null ? null : relevant(botFiles, ['apps/twitch-bot/']);
  const botShared = botFiles === null ? [] : relevant(botFiles, ['packages/']);
  out.push(
    botOwn === null
      ? { component: 'Bot', todo: false, text: 'état inconnu' }
      : botOwn.length
        ? {
            component: 'Bot',
            todo: true,
            text: `${botOwn.length} fichier(s) du bot à déployer, après le Core (jamais en même temps)`,
          }
        : {
            component: 'Bot',
            todo: false,
            text: botShared.length
              ? `à jour (seuls ${botShared.length} fichier(s) de schémas partagés ont changé : « plan bot » dit s'il faut le redéployer)`
              : 'à jour (rien de changé pour lui)',
          },
  );
  const studio =
    studioFiles === null ? null : relevant(studioFiles, PATHS.studio);
  out.push(
    studio === null
      ? {
          component: 'Studio',
          todo: false,
          text: 'état inconnu (aucune release trouvée)',
        }
      : studio.length
        ? {
            component: 'Studio',
            todo: true,
            text: `${studio.length} fichier(s) depuis ${studioTag ?? 'la dernière release'} — Actions › « Studio — construire / publier » (public) ; le Studio installé le propose, le streamer clique « Mettre à jour »`,
          }
        : {
            component: 'Studio',
            todo: false,
            text: `à jour (${studioTag ?? 'dernière release'})`,
          },
  );
  if (!extension)
    out.push({ component: 'Extension', todo: false, text: 'état inconnu' });
  else if (!extension.commits)
    out.push({
      component: 'Extension',
      todo: false,
      text: 'rien de nouveau pour Twitch (prix, réglages et contenus viennent du Core : aucun ZIP)',
    });
  else if (!extension.ok)
    out.push({
      component: 'Extension',
      todo: true,
      text: `${extension.commits} commit(s) depuis la version publiée — ${extension.inventoryName} : ${extension.problems.join(' ; ')} ; puis ZIP, Hosted Test et revue Twitch (publication manuelle)`,
    });
  else
    out.push({
      component: 'Extension',
      todo: true,
      text: `${extension.commits} commit(s) depuis la version publiée, inventaire validé — ZIP construit par la CI de main (artefact « extension-production-… », avec son SHA-256) : Hosted Test, revue Twitch, puis Release (publication manuelle)`,
    });
  return out;
}
