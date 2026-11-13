// Daily: create staleness reminders per center (portal.staleness_run). Digest e-mails follow the outbox.
import { runJob } from './run.js';
void runJob('staleness', 'DATABASE_URL_BG', async (c) => ({ reminders: (await c.query('SELECT portal.staleness_run() AS n')).rows[0].n }));
