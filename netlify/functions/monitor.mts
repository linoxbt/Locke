// Scheduled risk sweep: every minute, advance waiting plans and check every live plan's margin
// health on Strike (see src/lib/server/monitor.ts). Runs only on the published deploy, and stands
// down while the long-running worker holds its lock. Scheduled functions get 30 s; the sweep stops at 24.
import { sweep } from "../../src/lib/server/monitor";

export default async function monitor() {
  const result = await sweep(24_000);
  console.log("[monitor]", JSON.stringify(result));
}

export const config = {
  schedule: "* * * * *", // every minute (UTC)
};
