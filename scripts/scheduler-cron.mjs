// Standalone scheduler: pings the app's tick endpoint every minute so scheduled
// posts publish at their time even when no browser tab is open.
//
// Usage:  SCHEDULER_KEY=yourkey APP_URL=http://localhost:4321 node scripts/scheduler-cron.mjs
// The app must be running. The in-app tab also ticks while open, so this is
// only needed for unattended scheduling.

const APP_URL = process.env.APP_URL || "http://localhost:4321";
const KEY = process.env.SCHEDULER_KEY || "";
const INTERVAL_MS = 60_000;

async function tick() {
  const url = `${APP_URL}/api/scheduler/tick${KEY ? `?key=${encodeURIComponent(KEY)}` : ""}`;
  try {
    const res = await fetch(url, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[scheduler] ${res.status}`, data?.error || "");
      if (res.status === 401) {
        console.error("[scheduler] Unauthorized. Set SCHEDULER_KEY here and in the app's .env.local.");
      }
      return;
    }
    if (data.processed > 0) {
      console.log(`[scheduler] ${new Date().toISOString()} processed ${data.processed} post(s)`);
    }
  } catch (e) {
    console.error("[scheduler] error:", e.message);
  }
}

console.log(`[scheduler] watching ${APP_URL} every ${INTERVAL_MS / 1000}s`);
tick();
setInterval(tick, INTERVAL_MS);
