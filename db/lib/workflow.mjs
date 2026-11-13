// Drives synthetic access requests through the REAL database functions (so votes, events and audit rows are genuine).
import { withSession } from './session.mjs';

export async function seedRequests(runtimePool, ds) {
  const byEmail = new Map(ds.users.map((u) => [u.email, u]));
  const pick = (role, n = 0) => ds.users.filter((u) => u.role === role)[n];
  const coord = pick('national_coordinator'); const [c1, c2, c3] = [0, 1, 2].map((i) => pick('committee_member', i));
  const sample = ds.samples[0];
  const clinician = ds.users.find((u) => u.role === 'center_clinician' && u.centerId === sample.sourceCenterId);
  const out = {};
  const S = (u, fn, opts) => withSession(runtimePool, { userId: u.id, role: u.role }, fn, opts);
  const one = async (c, sql, p = []) => (await c.query(sql, p)).rows;

  for (const plan of ds.requestPlans) {
    const app = byEmail.get(plan.applicantEmail);
    const criteria = JSON.stringify({ diagnosis: [sample.diagnosisCode] });
    const id = await S(app, async (c) => {
      const [{ request_create: rid }] = await one(c, 'SELECT portal.request_create($1)', [`seed-${plan.key}-00`]);
      await c.query('UPDATE portal.requests SET research_question=$2, applicant_ethics_ref=$3, planned_use=$4, funding_sources=$5 WHERE id=$1',
        [rid, plan.researchQuestion, plan.ethicsRef, plan.plannedUse, plan.fundingSources]);
      await c.query('INSERT INTO portal.request_items (id, request_id, criteria, requested_count, shown_count_bucket) VALUES (portal.new_id($3), $1, $2::jsonb, 5, $4)',
        [rid, criteria, 'rit', 'lt10']);
      return rid;
    });
    out[plan.key] = id;
    if (plan.target === 'draft') continue;
    await S(app, (c) => c.query('SELECT portal.request_submit($1, $2)', [id, `seed-submit-${plan.key}`]));
    if (plan.target === 'precheck') continue;
    if (plan.target === 'withdrawn') { await S(app, (c) => c.query('SELECT portal.request_withdraw($1)', [id])); continue; }
    if (plan.target === 'needs_info') { await S(coord, (c) => c.query(`SELECT portal.request_ask_info($1, 'more_information', 'SYNTHETIC: please clarify')`, [id])); continue; }
    await S(coord, (c) => c.query('SELECT portal.request_precheck_pass($1, $2::jsonb)', [id, JSON.stringify({ form_complete: true, irb_ref_plausible: true, consent_scope_ok: true, no_identifier_requested: true, items_exist: true })]));
    if (plan.target === 'committee_review') continue;
    const vote = (u, v) => S(u, (c) => c.query(`SELECT portal.request_cast_vote($1, $2, $3, NULL)`, [id, v, v === 'reject' ? 'criteria_not_met' : null]));
    if (plan.target === 'quorum_not_met') { await vote(c1, 'approve'); continue; }
    if (plan.target === 'rejected') { await vote(c1, 'reject'); await vote(c2, 'reject'); continue; }
    await vote(c1, 'approve'); await vote(c2, 'approve');
    if (plan.target === 'approved') continue;
    // delivered: full path
    await S(coord, async (c) => {
      const [{ id: item }] = await one(c, 'SELECT id FROM portal.request_items WHERE request_id=$1', [id]);
      await c.query('INSERT INTO portal.request_item_samples (request_item_id, sample_id) VALUES ($1,$2)', [item, sample.id]);
      await c.query('SELECT portal.request_start_center_coordination($1)', [id]);
    });
    await S(clinician, (c) => c.query(`SELECT portal.request_center_respond($1, $2, true, 'SYNTHETIC: accepted')`, [id, sample.sourceCenterId]));
    await S(coord, async (c) => {
      await c.query(`SELECT portal.request_record_agreement($1, $2, 'mta', 'SYNTH-MTA-001')`, [id, sample.sourceCenterId]);
      await c.query('SELECT portal.request_start_delivery($1)', [id]);
    });
    await S(clinician, (c) => c.query('SELECT portal.request_center_delivered($1, $2)', [id, sample.sourceCenterId]));
  }
  return out;
}
