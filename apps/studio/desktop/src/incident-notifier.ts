// Windows notifications of the live incidents (incident 22/10, docs/PLAN_SUPERVISION_2026-10-23.md lot 2). The Studio
// server confirms an incident after 30 s of outage (supervision/supervisor.ts); this shell notifies it ONCE, and its
// end ONCE, even when Studio is in the foreground (decision 23/10). Pure: the Electron Notification is injected.

export interface NotifiedIncident {
  id: string;
  label: string;
  value: string;
  hint: string | null;
  action: 'auto' | 'manual' | null;
  startedAt: string;
  endedAt: string | null;
}

export interface Notice {
  title: string;
  body: string;
}

function lasted(fromIso: string, toIso: string) {
  const s = Math.max(
    0,
    Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000),
  );
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function createIncidentNotifier(d: {
  read(): Promise<{ incidents: NotifiedIncident[] } | null>;
  notify(n: Notice): void;
}) {
  const down = new Set<string>();
  const up = new Set<string>();
  let first = true;
  return {
    /** One poll. Incidents already over when the shell first sees them (Studio reopened) are never notified. */
    async poll() {
      const snap = await d.read().catch(() => null);
      if (!snap) return;
      for (const i of snap.incidents) {
        if (!i.endedAt && !down.has(i.id)) {
          down.add(i.id);
          d.notify({
            title: `Raptoru — ${i.label} indisponible`,
            body: `${i.value}. ${i.action === 'manual' ? `Action requise : ${i.hint ?? 'voir Studio.'}` : 'Récupération automatique en cours.'}`,
          });
        } else if (i.endedAt && !up.has(i.id)) {
          up.add(i.id);
          // Seen ongoing by this shell, or ended between two polls: its end is news. Already over at the first poll: not.
          if (down.has(i.id) || !first)
            d.notify({
              title: `Raptoru — ${i.label} rétabli`,
              body: `Indisponible pendant ${lasted(i.startedAt, i.endedAt)}.`,
            });
          down.add(i.id);
        }
      }
      first = false;
    },
  };
}
