import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { C, admin, as, baseFixtures, closeAll, q, refreshSnapshot, resetSamples } from './helpers.mjs';

// C-12: aggregate search p95 <= 800 ms at 50k records (design for 100k). Runs the real functions as a real runtime session.
const N = Number(process.env.PERF_SAMPLES ?? 50000);
beforeAll(async () => {
  await baseFixtures();
  await resetSamples();
  const dx = ['dmg_h3k27', 'dhg_h3g34', 'pilocytic_astrocytoma', 'ped_diffuse_lgg_family', 'mb_wnt', 'mb_shh', 'mb_non_wnt_non_shh', 'ependymoma_posterior_fossa', 'ependymoma_supratentorial', 'cns_tumour_nos'];
  await admin().query(`
    INSERT INTO portal.samples (id, donor_ref, source_center_id, diagnosis_code, age_band_at_diagnosis, sex, sample_type, availability, clinical_timepoint, collection_month, contact_ref)
    SELECT 'smp_' || lpad(g::text, 26, '0'), lpad(to_hex(g / 1), 32, 'f'),
           (ARRAY[$1,$2,$3])[1 + (g * 7) % 3], (ARRAY[${dx.map((d) => `'${d}'`).join(',')}])[1 + (g * 13) % 10],
           (ARRAY['0_lt1','1_lt3','3_lt6','6_lt10','10_lt15','15_lt18'])[1 + (g * 5) % 6]::portal.age_band,
           (ARRAY['female','male'])[1 + (g * 11) % 2]::portal.sex, (ARRAY['ffpe','frozen','csf','plasma_or_liquid_biopsy','isolated_dna_rna'])[1 + (g * 3) % 5]::portal.sample_type,
           'available', (ARRAY['diagnosis','during_treatment','relapse'])[1 + (g * 17) % 3]::portal.clinical_timepoint, '2024-05', 'Center research coordinator'
    FROM generate_series(1, ${N}) g`, [C.A, C.B, C.C]);
  await refreshSnapshot();
}, 300000);
afterAll(async () => { await resetSamples(); await closeAll(); });

describe(`performance at ${N} samples`, () => {
  it('facet and total calls meet p95 <= 800 ms', async () => {
    const cases = [['{}', 'diagnosis'], ['{"sex":["female"]}', 'ageBand'], ['{"diagnosis":["glioma_group"],"sampleType":["ffpe","frozen"]}', 'center'],
      ['{"centerId":["' + C.A + '"],"ageBand":["3_lt6","6_lt10"]}', 'diagnosis'], ['{"timepoint":["relapse"]}', 'sampleType']];
    const times = [];
    await as('resA', async (c) => {
      for (let rep = 0; rep < 4; rep++) for (const [f, facet] of cases) {
        const t0 = performance.now();
        await q(c, 'SELECT * FROM agg.facet_counts($1::jsonb,$2)', [f, facet]);
        times.push(performance.now() - t0);
      }
      for (const [f] of cases) { const t0 = performance.now(); await q(c, 'SELECT * FROM agg.total_count($1::jsonb)', [f]); times.push(performance.now() - t0); }
    });
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    console.log(`perf: n=${times.length} median=${times[Math.floor(times.length / 2)].toFixed(0)}ms p95=${p95.toFixed(0)}ms max=${times.at(-1).toFixed(0)}ms`);
    expect(p95).toBeLessThan(800);
  });
});
