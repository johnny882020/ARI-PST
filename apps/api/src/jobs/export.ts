// Full export of the index (portal.samples without donor_ref, centers). Break-glass only: needs two approvers (portal.breakglass_*),
// runs as app_break_glass (DATABASE_URL_BREAKGLASS). The window start is audited by the database. Output: NDJSON in the object store.
import { createObjectStore } from '../adapters/objectstore/index.js';
import { loadConfig } from '../config.js';
import { runJob } from './run.js';
void runJob('export', 'DATABASE_URL_BREAKGLASS', async (c) => {
  const until = (await c.query('SELECT portal.breakglass_begin() AS t')).rows[0].t;
  const cfg = loadConfig(); const store = createObjectStore(cfg);
  const lines: string[] = [];
  for (const r of (await c.query('SELECT * FROM portal.centers ORDER BY code')).rows) lines.push(JSON.stringify({ t: 'center', ...r }));
  for (const r of (await c.query(`SELECT id, source_center_id, diagnosis_code, age_band_at_diagnosis::text, sex::text, sample_type::text, availability::text, quantity_class::text, clinical_timepoint::text,
        collection_month, attached_data::text[], consent_status::text, ethics_approval_id, contact_ref, source_system, created_at, updated_at, last_verified_at, deleted_at FROM portal.samples ORDER BY id`)).rows) lines.push(JSON.stringify({ t: 'sample', ...r }));
  const key = `exports/index-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`;
  await store.put(key, Buffer.from(lines.join('\n') + '\n'), 'application/x-ndjson');
  return { key, rows: lines.length, windowEnds: until };
});
