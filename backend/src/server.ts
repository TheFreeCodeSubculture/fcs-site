import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/index.js";

const app = createApp();

const server = app.listen(config.PORT, config.HOST, () => {
  console.log(
    `fcs-backend listening on http://${config.HOST}:${config.PORT} (${config.NODE_ENV})`,
  );
});

async function cleanupAnalytics() {
  await pool.query(`
    delete from analytics_pageviews where at < now() - interval '13 months';
    delete from analytics_events where at < now() - interval '13 months';
    delete from analytics_salts where day < current_date - 1;
  `);
}

// One process is deployed, so a simple timer is enough for retention.
const analyticsCleanupTimer = setInterval(() => {
  cleanupAnalytics().catch((error) => {
    console.error("Analytics cleanup failed", error);
  });
}, 6 * 60 * 60 * 1000);
analyticsCleanupTimer.unref();

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    try {
      await pool.end();
    } catch (error) {
      console.error("Error closing database pool", error);
    }
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
