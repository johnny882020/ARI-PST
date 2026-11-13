// Hourly: verify every audit lane and print the anchor material. Exit 3 on a broken chain (Sev-1).
import { runJob } from './run.js';
void runJob('audit-verify', 'DATABASE_URL_BG', async (c) => {
  const broken = (await c.query('SELECT lane, broken_seq, reason FROM audit.verify_chain()')).rows;
  const anchor = (await c.query('SELECT lane, last_seq, last_hash, anchor_hmac FROM audit.anchor()')).rows;
  if (broken.length) { console.error(JSON.stringify({ job: 'audit-verify', ok: false, broken })); process.exit(3); }
  return { lanes: anchor.length, anchor: anchor.map((a) => ({ lane: a.lane, seq: a.last_seq, hmac: a.anchor_hmac })) };
});
