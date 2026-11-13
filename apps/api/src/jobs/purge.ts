// Nightly: request timers (expiry), privacy snapshot refresh, retention purge (C-07, values need legal review).
import { runJob } from './run.js';
void runJob('purge', 'DATABASE_URL_BG', async (c) => {
  const expired = (await c.query('SELECT portal.request_expire_overdue() AS n')).rows[0].n;
  const epoch = (await c.query('SELECT agg.refresh_snapshot() AS e')).rows[0].e;
  const retention = (await c.query('SELECT portal.retention_run() AS r')).rows[0].r;
  return { expiredRequests: expired, snapshotEpoch: epoch, retention };
});
