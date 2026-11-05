// Every five minutes, from outside the keeper: if the keeper has stopped checking in, alert
// whoever runs Locke (Telegram, email). The keeper can't report its own outage.

import { sendAlertMessage, syncAlerts, type Alert } from "../../src/lib/server/alerts";
import { db } from "../../src/lib/server/db";

/** A round takes seconds; this long without one means the keeper is down or stuck. */
const SILENT_AFTER_S = 5 * 60;

export default async () => {
  const active: Alert[] = [];
  try {
    const [beat] = (await db()`select extract(epoch from now() - at)::float8 as age from monitor_heartbeat where id = 2`) as unknown as { age: number }[];
    if (!beat) {
      active.push({ key: "keeper-silent", level: "urgent", title: "Keeper has never checked in", detail: "No heartbeat from the Base keeper on Railway. Check that it is deployed and running." });
    } else if (beat.age > SILENT_AFTER_S) {
      const min = Math.round(beat.age / 60);
      active.push({ key: "keeper-silent", level: "urgent", title: "Keeper is down", detail: `The Base keeper last checked in ${min} min ago. Plans aren't being watched or topped up. Check Railway.` });
    }
  } catch (e) {
    // Alert state lives in the database too, so this one is sent directly, at most once an hour.
    if (new Date().getUTCMinutes() < 5) await sendAlertMessage("🔴 Locke: database can't be read", `The watchdog couldn't read Locke's database: ${(e as Error).message.slice(0, 200)}`);
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
  await syncAlerts("watch", active);
  return new Response(JSON.stringify({ ok: active.length === 0 }), { headers: { "Content-Type": "application/json" } });
};

export const config = { schedule: "*/5 * * * *" };
