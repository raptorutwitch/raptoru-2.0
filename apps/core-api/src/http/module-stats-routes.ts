import type { ModuleStatsService } from '../module-stats/service.js';
import type { Route } from './server.js';

// Statistiques des modules (raptoru.fr lot 4): the site token only — the site shows a viewer their OWN totals. No
// public route until Antoni decides which totals are public (ROADMAP_SITE.md § 4.1).
export function moduleStatsRoutes(
  svc: ModuleStatsService,
  o: { channelId: string },
): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/v1\/site\/modules\/viewers\/([0-9]{1,32})$/,
      auth: 'site',
      handle: ({ params }) => svc.viewer(o.channelId, params[0]!),
    },
  ];
}
