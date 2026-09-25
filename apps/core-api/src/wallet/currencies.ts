import type { Currency } from '@raptoru/schemas';
import type { Db, Queryable } from '../db/db.js';

interface CurrencyRow {
  id: string;
  singular: string;
  plural: string;
  icon: string | null;
  active: boolean;
  is_primary: boolean;
  transferable: boolean;
  allow_negative_admin: boolean;
}

const toCurrency = (r: CurrencyRow): Currency => ({
  id: r.id,
  singular: r.singular,
  plural: r.plural,
  icon: r.icon,
  active: r.active,
  isPrimary: r.is_primary,
  transferable: r.transferable,
  allowNegativeAdmin: r.allow_negative_admin,
});

/** `currencyId` or, when omitted, the primary currency. */
export async function findCurrency(
  q: Queryable,
  currencyId?: string,
): Promise<Currency | null> {
  const rows = currencyId
    ? await q.query<CurrencyRow>('select * from currencies where id = $1', [
        currencyId,
      ])
    : await q.query<CurrencyRow>('select * from currencies where is_primary');
  return rows[0] ? toCurrency(rows[0]) : null;
}

export class CurrencyService {
  constructor(private readonly db: Db) {}

  async list(): Promise<Currency[]> {
    return (
      await this.db.query<CurrencyRow>(
        'select * from currencies order by is_primary desc, id',
      )
    ).map(toCurrency);
  }

  get(currencyId?: string): Promise<Currency | null> {
    return findCurrency(this.db, currencyId);
  }

  create(c: Currency): Promise<Currency> {
    return this.db.tx(async (q) => {
      if (c.isPrimary)
        await q.query(
          'update currencies set is_primary = false, updated_at = now() where is_primary',
        );
      await q.query(
        `insert into currencies (id, singular, plural, icon, active, is_primary, transferable, allow_negative_admin)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          c.id,
          c.singular,
          c.plural,
          c.icon,
          c.active,
          c.isPrimary,
          c.transferable,
          c.allowNegativeAdmin,
        ],
      );
      return (await findCurrency(q, c.id))!;
    });
  }

  /** The id is immutable; names, icon and flags can change (a global rename is one update). */
  update(
    id: string,
    patch: Partial<Omit<Currency, 'id'>>,
  ): Promise<Currency | null> {
    return this.db.tx(async (q) => {
      const current = await findCurrency(q, id);
      if (!current) return null;
      const next = { ...current, ...patch };
      if (next.isPrimary && !current.isPrimary) {
        await q.query(
          'update currencies set is_primary = false, updated_at = now() where is_primary',
        );
      }
      await q.query(
        `update currencies set singular = $2, plural = $3, icon = $4, active = $5, is_primary = $6,
           transferable = $7, allow_negative_admin = $8, updated_at = now() where id = $1`,
        [
          id,
          next.singular,
          next.plural,
          next.icon,
          next.active,
          next.isPrimary,
          next.transferable,
          next.allowNegativeAdmin,
        ],
      );
      return findCurrency(q, id);
    });
  }
}
