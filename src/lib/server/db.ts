import postgres from "postgres";
import { config } from "./config";

type Sql = ReturnType<typeof postgres>;

const g = globalThis as unknown as { __lockeSql?: Sql };

/**
 * One pool per process (survives Next dev hot reloads). Transaction poolers (port 6543: Supabase's
 * Supavisor or PgBouncer) don't keep prepared statements, so they're off there or when
 * DATABASE_PREPARE=false. Statements time out so a hung database can't pile up work.
 */
export function db(): Sql {
  if (!g.__lockeSql) {
    const url = config.databaseUrl;
    const prepare = process.env.DATABASE_PREPARE ? process.env.DATABASE_PREPARE !== "false" : !/:6543(\/|\?|$)/.test(url);
    g.__lockeSql = postgres(url, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 3),
      idle_timeout: 20,
      prepare,
      connection: { statement_timeout: 15_000 },
      types: { numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) } },
    });
  }
  return g.__lockeSql;
}
