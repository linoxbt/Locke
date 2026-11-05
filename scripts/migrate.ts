import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const schema = readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  // A change that has to wait for a table lock gives up after 5 s (the deploy fails, and is retried)
  // rather than queue behind a long query and hold up every read of that table meanwhile. Sent in
  // the same message as the schema, so a transaction pooler runs both on one connection.
  await sql.unsafe(`set lock_timeout = '5s';\n${schema}`);
  await sql.end();
  console.log("Schema applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
