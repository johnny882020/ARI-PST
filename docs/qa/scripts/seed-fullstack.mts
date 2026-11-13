// Seeds synthetic users (with TOTP secrets), 2 centers and ~60 samples into the QA database. Writes /tmp/qa-seed.json.
// Run: DB_ADMIN_URL=... DB_RUNTIME_URL=... apps/api/node_modules/.bin/tsx docs/qa/scripts/seed-fullstack.ts
import { writeFileSync } from 'node:fs';
import { startHarness } from '../../../apps/api/test/support/harness.js';
import { buildFixture, sampleBody } from '../../../apps/api/test/support/fixture.js';
process.env.TEST_DATABASE_URL = process.env.DB_RUNTIME_URL!; process.env.TEST_ADMIN_DATABASE_URL = process.env.DB_ADMIN_URL!;
const h = await startHarness(); const f = await buildFixture(h);
const c = await h.session(f.coord);
const dx = ['mb_shh', 'mb_wnt', 'dmg_h3k27', 'ependymoma_posterior_fossa', 'pilocytic_astrocytoma'];
let ok = 0, fail: string[] = [];
for (let i = 0; i < 60; i++) {
  const center = i % 3 === 0 ? f.centerB : f.centerA;
  const r = await h.call(c, 'POST', '/api/v1/samples', { body: sampleBody(center, { diagnosisCode: dx[i % 5], sampleType: ['ffpe', 'frozen', 'csf'][i % 3], sex: i % 2 ? 'male' : 'female', collectionMonth: `202${3 + (i % 3)}-0${1 + (i % 9)}` }) });
  if (r.status === 201) ok++; else if (fail.length < 3) fail.push(r.status + ' ' + r.body.slice(0, 200));
}
writeFileSync('/tmp/qa-seed.json', JSON.stringify({ centerA: f.centerA, centerB: f.centerB, users: { coord: f.coord, clinA: f.clinA, c1: f.committee[0], c2: f.committee[1], c3: f.committee[2], admin1: f.admin1, admin2: f.admin2, resIl: f.resIl, resIntl: f.resIntl }, samplesCreated: ok, fail }, null, 1));
console.log('seeded', ok, fail);
await h.close(); process.exit(0);
