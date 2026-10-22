import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const schema = readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  await sql.unsafe(schema);
  await sql.end();
  console.log("Schema applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
