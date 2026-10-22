import postgres from "postgres";
import { config } from "./config";

type Sql = ReturnType<typeof postgres>;

const g = globalThis as unknown as { __lockeSql?: Sql };

/** One pool per process (survives Next dev hot reloads). */
export function db(): Sql {
  if (!g.__lockeSql) {
    g.__lockeSql = postgres(config.databaseUrl, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: 20,
      // Supabase's transaction pooler doesn't support prepared statements.
      prepare: !/pooler\.supabase\.com:6543/.test(config.databaseUrl),
      types: { numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) } },
    });
  }
  return g.__lockeSql;
}
