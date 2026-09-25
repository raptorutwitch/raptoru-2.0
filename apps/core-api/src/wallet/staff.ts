import type { Viewer } from '@raptoru/schemas';
import type { Db } from '../db/db.js';
import { ensureViewers } from './wallet-service.js';

// Internal economy permissions, independent from the Twitch moderator badge.

export type StaffRole = 'owner' | 'supermod';

export class StaffService {
  constructor(private readonly db: Db) {}

  async roleOf(twitchUserId: string): Promise<StaffRole | null> {
    const row = (
      await this.db.query<{ role: StaffRole }>(
        'select role from staff_roles where twitch_user_id = $1',
        [twitchUserId],
      )
    )[0];
    return row?.role ?? null;
  }

  async canAdministerEconomy(twitchUserId: string): Promise<boolean> {
    return (await this.roleOf(twitchUserId)) !== null;
  }

  async grant(viewer: Viewer, role: StaffRole, actor: string): Promise<void> {
    await ensureViewers(this.db, [viewer]);
    await this.db.query(
      `insert into staff_roles (twitch_user_id, role, granted_by) values ($1, $2, $3)
       on conflict (twitch_user_id) do update set role = excluded.role, granted_by = excluded.granted_by`,
      [viewer.twitchUserId, role, actor],
    );
  }

  async revoke(twitchUserId: string): Promise<void> {
    await this.db.query('delete from staff_roles where twitch_user_id = $1', [
      twitchUserId,
    ]);
  }

  list() {
    return this.db.query<{
      twitch_user_id: string;
      login: string;
      role: StaffRole;
      granted_by: string;
    }>(
      `select s.twitch_user_id, v.login, s.role, s.granted_by from staff_roles s join viewers v using (twitch_user_id)
       order by s.role, v.login`,
    );
  }
}
