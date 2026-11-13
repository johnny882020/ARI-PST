// Hourly: refresh the privacy snapshot that the aggregate search reads (agg.refresh_snapshot, QA-002).
// Counts change only when a new snapshot epoch is published, so this interval is the freshness of search counts.
import { runJob } from './run.js';
void runJob('snapshot', 'DATABASE_URL_BG', async (c) => ({ snapshotEpoch: (await c.query('SELECT agg.refresh_snapshot() AS e')).rows[0].e }));
