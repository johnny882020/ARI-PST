import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { C, addSamples, admin, as, baseFixtures, closeAll, fails, q, refreshSnapshot, resetSamples } from './helpers.mjs';

let donorNo = 0; let newDonor;
const donor = () => (++donorNo).toString(16).padStart(32, 'e');
/** n donors at (center, dx); `female` of them female; each donor gets `per` samples of different types */
async function cell(center, dx, n, { female = Math.ceil(n / 2), per = 1, age } = {}) {
  const types = ['ffpe', 'frozen', 'csf', 'plasma_or_liquid_biopsy', 'isolated_dna_rna'];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const d = donor();
    for (let s = 0; s < per; s++) rows.push({ donor: d, center, dx, sex: i < female ? 'female' : 'male', age: age ?? ['1_lt3', '3_lt6', '6_lt10'][i % 3], type: types[s % 5] });
  }
  await addSamples(rows);
}
const total = (who, f = {}) => as(who, async (c) => (await q(c, 'SELECT * FROM agg.total_count($1::jsonb)', [JSON.stringify(f)]))[0]);
const facet = (who, f, name) => as(who, (c) => q(c, 'SELECT * FROM agg.facet_counts($1::jsonb,$2)', [JSON.stringify(f), name]));

beforeAll(async () => {
  await baseFixtures();
  await resetSamples();
  await cell(C.A, 'dmg_h3k27', 14, { female: 9 });
  await cell(C.A, 'cns_tumour_pending_dx', 1, { per: 6 });   // one donor, six samples
  await cell(C.A, 'cns_tumour_nos', 3);
  await cell(C.B, 'pilocytic_astrocytoma', 12, { female: 8 });
  await cell(C.A, 'ped_diffuse_lgg_family', 7);
  await cell(C.B, 'mb_wnt', 2); await cell(C.B, 'mb_shh', 2);
  await cell(C.B, 'ependymoma_supratentorial', 3);
  await cell(C.C, 'ependymoma_posterior_fossa', 4);
  await refreshSnapshot();
});
afterAll(closeAll);

describe('distinct donors, not samples (RT-02)', () => {
  it('one donor with six samples is a count of 1 and stays hidden', async () => {
    const t = await total('resA', { diagnosis: ['cns_tumour_pending_dx'] });
    expect(t).toEqual({ n: null, band: null, masked: true });
    const ssum = (await q(admin(), `SELECT count(*)::int n FROM portal.samples WHERE diagnosis_code='cns_tumour_pending_dx'`))[0].n;
    expect(ssum).toBe(6);
  });
  it('sample-type facet counts donors: the six-sample donor adds 1 per type, not 6', async () => {
    const rows = await facet('resA', { diagnosis: ['cns_tumour_pending_dx'] }, 'sampleType');
    expect(rows).toEqual([{ bucket: 'all', bucket_level: 'other', n: null, band: null, masked: true, merged: false }]);
  });
});

describe('cell rule: banding and masking', () => {
  it('counts >= 10 are exact; 5..9 are banded without a number; small ones are masked with no number', async () => {
    expect(await total('resA', { diagnosis: ['dmg_h3k27'] })).toEqual({ n: 14, band: null, masked: false });
    expect(await total('resA', { diagnosis: ['ped_diffuse_lgg_family'] })).toEqual({ n: null, band: 'lt10', masked: false });
    expect(await total('resA', { centerId: [C.C] })).toEqual({ n: null, band: null, masked: true });
  });
  it('diagnosis facet: leaves, family roll-up, other; exact expected output', async () => {
    const rows = await facet('resA', {}, 'diagnosis');
    const byLabel = Object.fromEntries(rows.map((r) => [r.bucket, r]));
    expect(byLabel.dmg_h3k27).toMatchObject({ n: 14, band: null, masked: false, merged: false, bucket_level: 'value' });
    expect(byLabel.pilocytic_astrocytoma).toMatchObject({ n: 12 });
    expect(byLabel.ped_diffuse_lgg_family).toMatchObject({ n: null, band: 'lt10', bucket_level: 'value' });
    expect(byLabel.ependymoma_family).toMatchObject({ bucket_level: 'family_other', band: 'lt10', merged: true });
    expect(byLabel.other).toMatchObject({ bucket_level: 'other', band: 'lt10', merged: true });
    for (const small of ['cns_tumour_pending_dx', 'cns_tumour_nos', 'mb_wnt', 'mb_shh', 'ependymoma_supratentorial', 'ependymoma_posterior_fossa']) expect(byLabel[small]).toBeUndefined();
  });
  it('no response ever carries an exact number below 10, a threshold, donor refs or sample codes (P-01, P-15, C-09)', async () => {
    const outs = [];
    for (const f of ['diagnosis', 'sampleType', 'ageBand', 'sex', 'center', 'timepoint', 'availability', 'attachedData']) {
      outs.push(await facet('resA', {}, f), await facet('resA', { diagnosis: ['dmg_h3k27'] }, f), await facet('intl', { centerId: [C.B] }, f));
    }
    outs.push(await total('resA', {}), await total('resA', { sex: ['female'] }));
    for (const rows of outs.flat()) {
      for (const r of Object.values(rows)) { if (typeof r === 'number') expect(r).toBeGreaterThanOrEqual(10); }
      expect(Object.keys(rows)).not.toContain('k');
    }
    const text = JSON.stringify(outs);
    expect(text).not.toMatch(/[0-9a-f]{32}/);
    expect(text).not.toMatch(/smp_|"k"|threshold/);
  });
  it('masked results for 0 donors and for 3 donors are byte-identical (P-17)', async () => {
    const zero = await total('resA', { diagnosis: ['dmg_h3k27'], centerId: [C.C] });
    const three = await total('resA', { diagnosis: ['ependymoma_supratentorial'] });
    expect(JSON.stringify(zero)).toBe(JSON.stringify(three));
    expect(zero).toEqual({ n: null, band: null, masked: true });
  });
});

describe('differencing (RT-01)', () => {
  it('total(dmg) minus total(dmg, female) cannot reveal a group below k', async () => {
    const all = await total('resA', { diagnosis: ['pilocytic_astrocytoma'] });
    const f = await total('resA', { diagnosis: ['pilocytic_astrocytoma'], sex: ['female'] });
    const m = await total('resA', { diagnosis: ['pilocytic_astrocytoma'], sex: ['male'] });
    expect(all.n).toBe(12);
    expect(f.masked).toBe(true);                                      // 8 shown would give 12 - 8 = 4 males
    expect(m.masked).toBe(true);
  });
  it('rest = 0 is not a leak: a filter that excludes nobody stays visible', async () => {
    const t = await total('resA', { diagnosis: ['pilocytic_astrocytoma'], centerId: [C.B] });
    expect(t.n).toBe(12);
  });
  it('facet sex under a diagnosis filter merges the small cell instead of exposing it', async () => {
    const rows = await facet('resA', { diagnosis: ['pilocytic_astrocytoma'] }, 'sex');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bucket: 'other', n: 12, merged: true });
  });
  it('attack simulation: no pair of exact answers differs by 1..k-1 donors over a large query universe (P-04, P-14)', async () => {
    const snap = await q(admin(), 'SELECT * FROM agg.snapshot');
    const parent = Object.fromEntries((await q(admin(), 'SELECT diagnosis_code, parent_code FROM portal.diagnosis_terms')).map((r) => [r.diagnosis_code, r.parent_code]));
    const matches = (row, f) => Object.entries(f).every(([k, vals]) => {
      const v = { diagnosis: [row.diagnosis_code, row.family_code, row.group_code], sampleType: [row.sample_type], ageBand: [row.age_band], sex: [row.sex],
        centerId: [row.center_id], timepoint: [row.timepoint], availability: [row.availability] }[k];
      return vals.some((x) => v.includes(x));
    });
    const donorsOf = (f) => new Set(snap.filter((r) => matches(r, f)).map((r) => r.donor_ref));
    const dxs = ['dmg_h3k27', 'pilocytic_astrocytoma', 'ped_diffuse_lgg_family', 'mb_wnt', 'mb_shh', 'medulloblastoma_family', 'embryonal_group', 'glioma_group', 'ependymoma_family', 'cns_tumour_nos'];
    const singles = [
      ...dxs.map((d) => ({ diagnosis: [d] })), { diagnosis: ['mb_wnt', 'mb_shh'] }, { diagnosis: ['dmg_h3k27', 'pilocytic_astrocytoma'] }, { diagnosis: ['dmg_h3k27', 'cns_tumour_nos'] },
      { sex: ['female'] }, { sex: ['male'] }, { centerId: [C.A] }, { centerId: [C.B] }, { centerId: [C.C] }, { centerId: [C.A, C.B] },
      { ageBand: ['1_lt3'] }, { ageBand: ['3_lt6'] }, { ageBand: ['6_lt10'] }, { ageBand: ['1_lt3', '3_lt6'] }, { sampleType: ['ffpe'] }, { sampleType: ['frozen'] }, { sampleType: ['ffpe', 'frozen'] },
    ];
    const queries = [{}, ...singles];
    for (const a of singles) for (const b of singles) {
      const ka = Object.keys(a)[0], kb = Object.keys(b)[0];
      if (ka < kb) queries.push({ ...a, ...b });
    }
    const answers = [];                                                // {set, n}
    for (const f of queries) {
      const t = await total('resA', f);
      if (t.n != null) answers.push({ f, set: donorsOf(f), n: t.n });
      for (const facetName of ['sex', 'ageBand', 'center', 'diagnosis']) {
        if (Object.keys(f).length > 2) continue;
        const rows = await facet('resA', f, facetName);
        const base = donorsOf(f);
        const key = { sex: 'sex', ageBand: 'age_band', center: 'center_id', diagnosis: 'diagnosis_code' }[facetName];
        const shown = rows.filter((r) => r.n != null && r.bucket_level === 'value');
        for (const r of shown) answers.push({ f: { ...f, [facetName]: r.bucket }, set: new Set(snap.filter((x) => base.has(x.donor_ref) && x[key] === r.bucket && matches(x, f)).map((x) => x.donor_ref)), n: r.n });
        const other = rows.find((r) => r.bucket === 'other' && r.n != null);
        if (other) {
          const inShown = new Set(rows.filter((r) => r.bucket_level === 'value' && !r.masked).map((r) => r.bucket));
          const fam = rows.filter((r) => r.bucket_level !== 'value' && r.bucket !== 'other' && r.n != null);
          if (!fam.length && facetName !== 'diagnosis') answers.push({ f: { ...f, [facetName]: 'OTHER' }, n: other.n,
            set: new Set(snap.filter((x) => matches(x, f) && !inShown.has(x[key])).map((x) => x.donor_ref)) });
        }
      }
    }
    for (const a of answers) if (a.set.size !== a.n) throw new Error(`untruthful: ${JSON.stringify(a.f)} shown ${a.n} true ${a.set.size}`);
    let pairs = 0;
    for (const a of answers) for (const b of answers) {
      if (a.set.size >= b.set.size) continue;
      let sub = true; for (const d of a.set) if (!b.set.has(d)) { sub = false; break; }
      if (!sub) continue;
      pairs++;
      const diff = b.set.size - a.set.size;
      if (diff >= 1 && diff <= 4) throw new Error(`LEAK: ${JSON.stringify(b.f)}=${b.n} minus ${JSON.stringify(a.f)}=${a.n} reveals a group of ${diff}`);
    }
    expect(queries.length).toBeGreaterThan(300);
    expect(answers.length).toBeGreaterThan(150);
    expect(pairs).toBeGreaterThan(100);
  });
});

describe('inputs, roles, epochs, k', () => {
  it('filter limits are enforced and never reveal k (P-12)', async () => {
    const bad = [{ sex: ['female'], ageBand: ['1_lt3'], centerId: [C.A], sampleType: ['ffpe'], timepoint: ['diagnosis'] }, { diagnosis: ['a', 'b', 'c', 'd'] },
      { nonsense: ['x'] }, { sex: [] }, { sex: ['fe male'] }, { sex: 'female' }, []];
    for (const f of bad) {
      const e = await fails(total('resA', f));
      expect(e.message).not.toMatch(/\b5\b|threshold/);
    }
    await fails(facet('resA', {}, 'bogus'), 'unknown_facet');
  });
  it('allowed roles can query; admin and anonymous cannot', async () => {
    for (const who of ['resA', 'intl', 'clinA', 'coordA', 'comA']) expect((await total(who, {})).masked).toBe(false);
    for (const who of ['adminA', 'anonymous']) await fails(total(who, {}), 'forbidden');
  });
  it('canonical: filter value order and key order do not change the answer (P-07)', async () => {
    const a = await facet('resA', { diagnosis: ['dmg_h3k27', 'pilocytic_astrocytoma'], sex: ['female'] }, 'ageBand');
    const b = await facet('resA', { sex: ['female'], diagnosis: ['pilocytic_astrocytoma', 'dmg_h3k27'] }, 'ageBand');
    expect(a).toEqual(b);
  });
  it('identical query, identical answer (P-06)', async () => {
    expect(await facet('resA', { sex: ['male'] }, 'diagnosis')).toEqual(await facet('resA', { sex: ['male'] }, 'diagnosis'));
  });
  it('epoch: a new sample is invisible until the next snapshot (P-08)', async () => {
    const before = await total('resA', { diagnosis: ['dmg_h3k27'] });
    newDonor = donor();
    await addSamples([{ center: C.A, dx: 'dmg_h3k27', donor: newDonor, sex: 'male', age: '1_lt3' }]);
    expect(await total('resA', { diagnosis: ['dmg_h3k27'] })).toEqual(before);
    const e1 = await as('resA', async (c) => (await q(c, 'SELECT agg.current_epoch() e'))[0].e);
    const e2 = await refreshSnapshot();
    expect(e2).toBe(e1 + 1);
    expect((await total('resA', { diagnosis: ['dmg_h3k27'] })).n).toBe(15);
  });
  it('soft-deleted samples drop out at the next epoch', async () => {
    await admin().query(`UPDATE portal.samples SET availability='depleted', deleted_at=now() WHERE donor_ref=$1`, [newDonor]);
    await refreshSnapshot();
    expect((await total('resA', { diagnosis: ['dmg_h3k27'] })).n).toBe(14);
  });
  it('monotone: raising k never makes a masked cell visible (P-09)', async () => {
    const visible = async () => {
      const out = new Set();
      for (const f of ['diagnosis', 'ageBand', 'sex', 'center', 'sampleType']) for (const flt of [{}, { sex: ['female'] }, { centerId: [C.B] }])
        for (const r of await facet('resA', flt, f)) if (!r.masked && r.bucket_level === 'value') out.add(`${f}|${JSON.stringify(flt)}|${r.bucket}`);
      return out;
    };
    const k5 = await visible();
    await admin().query(`UPDATE portal.k_policies SET k=8 WHERE field_set='default'`);
    try {
      const k8 = await visible();
      for (const x of k8) expect(k5.has(x)).toBe(true);
      expect(k8.size).toBeLessThan(k5.size);
    } finally { await admin().query(`UPDATE portal.k_policies SET k=5 WHERE field_set='default'`); }
  });
  it('attachedData: zero and small flags look identical; large flags are shown', async () => {
    const flag = async (type, donors) => { for (const d of donors) await admin().query(`INSERT INTO portal.sample_attached_data (sample_id, data_type) SELECT id,$2 FROM portal.samples WHERE donor_ref=$1 ON CONFLICT DO NOTHING`, [d, type]); };
    const ds = (await q(admin(), `SELECT DISTINCT donor_ref FROM portal.samples WHERE diagnosis_code='dmg_h3k27' AND deleted_at IS NULL`)).map((r) => r.donor_ref);
    await flag('wes', ds.slice(0, 3)); await flag('rna_seq', ds.slice(0, 12));
    await refreshSnapshot();
    const rows = Object.fromEntries((await facet('resA', {}, 'attachedData')).map((r) => [r.bucket, r]));
    expect(Object.keys(rows).sort()).toEqual(['digital_pathology', 'mri', 'redcap_clinical', 'rna_seq', 'wes', 'wgs']);
    expect(JSON.stringify({ ...rows.wes, bucket: '' })).toBe(JSON.stringify({ ...rows.mri, bucket: '' }));
    expect(rows.rna_seq).toMatchObject({ n: 12, masked: false });
  });
});
