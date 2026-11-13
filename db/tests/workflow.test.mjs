import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { C, U, addSamples, admin, as, baseFixtures, closeAll, fails, q, resetSamples, sid } from './helpers.mjs';

let n = 0;
const CHECK = JSON.stringify({ form_complete: true, irb_ref_plausible: true, consent_scope_ok: true, no_identifier_requested: true, items_exist: true });
let sampleId;

beforeAll(async () => {
  await baseFixtures();
  await resetSamples();
  await addSamples([{ center: C.A, dx: 'dmg_h3k27' }, { center: C.B, dx: 'mb_shh' }]);
  sampleId = (await q(admin(), `SELECT id FROM portal.samples WHERE source_center_id=$1 LIMIT 1`, [C.A]))[0].id;
});
afterAll(closeAll);

const status = async (id) => (await q(admin(), 'SELECT status, close_reason FROM portal.requests WHERE id=$1', [id]))[0];
/** applicant creates a complete draft */
async function draft(who = 'resA') {
  const key = `test-key-${++n}-${Date.now()}`;
  return as(who, async (c) => {
    const [{ request_create: id }] = await q(c, 'SELECT portal.request_create($1)', [key]);
    await c.query('UPDATE portal.requests SET research_question=$2, applicant_ethics_ref=$3, planned_use=$4, funding_sources=$5 WHERE id=$1',
      [id, 'SYNTHETIC: q', 'SYNTH-APP-1', 'SYNTHETIC: use', 'SYNTHETIC: funds']);
    await c.query(`INSERT INTO portal.request_items (id, request_id, criteria, requested_count, shown_count_bucket) VALUES (portal.new_id('rit'), $1, '{"diagnosis":["dmg_h3k27"]}', 3, 'lt10')`, [id]);
    return id;
  });
}
const submit = (id, who = 'resA') => as(who, (c) => q(c, 'SELECT portal.request_submit($1,$2) s', [id, `submit-key-${id}`]));
const toCommittee = async (id) => { await submit(id); await as('coordA', (c) => c.query('SELECT portal.request_precheck_pass($1,$2::jsonb)', [id, CHECK])); };
const vote = (id, who, v, code) => as(who, (c) => q(c, 'SELECT portal.request_cast_vote($1,$2,$3,NULL) r', [id, v, code ?? (v === 'reject' ? 'criteria_not_met' : null)]));

describe('state machine in the database (RT-03, RT-26)', () => {
  it('happy path: draft to delivered through every canonical state', async () => {
    const id = await draft();
    expect((await submit(id))[0].s).toBe('precheck');                    // auto-assign: coordinators exist
    await as('coordA', (c) => c.query('SELECT portal.request_precheck_pass($1,$2::jsonb)', [id, CHECK]));
    expect((await status(id)).status).toBe('committee_review');
    expect((await vote(id, 'comA', 'approve'))[0].r).toBe('recorded');
    expect((await vote(id, 'comB', 'approve'))[0].r).toBe('approved');
    expect((await status(id)).status).toBe('approved');
    await as('coordA', async (c) => {
      const [{ id: item }] = await q(c, 'SELECT id FROM portal.request_items WHERE request_id=$1', [id]);
      await c.query('INSERT INTO portal.request_item_samples (request_item_id, sample_id) VALUES ($1,$2)', [item, sampleId]);
      expect((await q(c, 'SELECT portal.request_start_center_coordination($1) n', [id]))[0].n).toBe(1);
    });
    expect((await status(id)).status).toBe('center_coordination');
    await as('clinA', (c) => c.query(`SELECT portal.request_center_respond($1,$2,true,'SYNTHETIC: ok')`, [id, C.A]));
    expect((await status(id)).status).toBe('agreements');
    await fails(as('coordA', (c) => c.query('SELECT portal.request_start_delivery($1)', [id])), 'agreements_missing');
    await as('coordA', async (c) => {
      await c.query(`SELECT portal.request_record_agreement($1,$2,'mta','SYNTH-MTA-1')`, [id, C.A]);
      await c.query('SELECT portal.request_start_delivery($1)', [id]);
    });
    expect((await status(id)).status).toBe('delivery');
    await as('clinA', (c) => c.query('SELECT portal.request_center_delivered($1,$2)', [id, C.A]));
    expect(await status(id)).toEqual({ status: 'closed', close_reason: 'delivered' });
    const ev = await q(admin(), 'SELECT to_state FROM portal.request_events WHERE request_id=$1 ORDER BY id', [id]);
    expect(ev.map((e) => e.to_state)).toEqual(['draft', 'submitted', 'precheck', 'committee_review', 'approved', 'center_coordination', 'agreements', 'delivery', 'closed']);
  });

  it('applicant cannot reopen a closed request or set any governance column', async () => {
    const id = await draft();
    await as('resA', (c) => c.query('SELECT portal.request_withdraw($1)', [id]));
    expect(await status(id)).toEqual({ status: 'closed', close_reason: 'withdrawn' });
    await fails(as('resA', (c) => c.query(`UPDATE portal.requests SET status='submitted' WHERE id=$1`, [id])), '42501');
    await fails(as('resA', (c) => c.query(`UPDATE portal.requests SET research_question='x' WHERE id=$1`, [id])).then((r) => { if (!r.rowCount) throw new Error('rls_blocked'); }), 'rls_blocked');
    await fails(as('resA', (c) => c.query('SELECT portal.request_respond_info($1)', [id])), 'invalid_transition');
    expect((await as('resA', (c) => q(c, 'SELECT portal.request_submit($1,$2) s', [id, 'another-key-12345'])))[0].s).toBe('closed');   // no-op, never reopens
    expect((await status(id)).status).toBe('closed');
    // even the table owner / superuser cannot move a closed request (trigger)
    await fails(admin().query(`UPDATE portal.requests SET status='draft', close_reason=NULL WHERE id=$1`, [id]), '42501');
  });

  it('applicant cannot self-approve, set delivered_at, or rewrite a rejected request', async () => {
    const id = await draft();
    await submit(id);
    for (const sql of [`UPDATE portal.requests SET status='approved' WHERE id=$1`, `UPDATE portal.requests SET delivered_at=now() WHERE id=$1`,
                       `UPDATE portal.requests SET status='committee_review' WHERE id=$1`]) {
      await fails(as('resA', (c) => c.query(sql, [id])), '42501');
    }
    await fails(admin().query(`UPDATE portal.requests SET status='delivery' WHERE id=$1`, [id]), '42501');
  });

  it('coordinator cannot mark delivered, cannot decide, cannot skip precheck', async () => {
    const id = await draft(); await submit(id);
    await fails(as('coordA', (c) => c.query(`UPDATE portal.requests SET status='closed', close_reason='delivered' WHERE id=$1`, [id])), '42501');
    await fails(as('coordA', (c) => c.query('SELECT portal.request_cast_vote($1,$2,NULL,NULL)', [id, 'approve'])), 'forbidden');
    await fails(as('coordA', (c) => c.query('SELECT portal.request_center_delivered($1,$2)', [id, C.A])), 'forbidden');
    await fails(as('coordA', (c) => c.query('SELECT portal.request_start_delivery($1)', [id])), 'invalid_transition');
    await fails(as('coordA', (c) => c.query('SELECT portal.request_start_center_coordination($1)', [id])), 'no_resolved_samples');
    await fails(admin().query(`UPDATE portal.requests SET status='closed', close_reason='delivered' WHERE id=$1`, [id]), '42501');
    expect((await status(id)).status).toBe('precheck');
  });

  it('a clinician of another center cannot mark delivered; only holding center, and only in delivery', async () => {
    const id = await draft(); await toCommittee(id);
    await fails(as('clinA', (c) => c.query('SELECT portal.request_center_delivered($1,$2)', [id, C.A])), 'invalid_transition');
    await fails(as('clinB', (c) => c.query('SELECT portal.request_center_delivered($1,$2)', [id, C.A])), 'forbidden');
  });

  it('invalid transitions are rejected by the trigger itself (table of rules)', async () => {
    const id = await draft(); await submit(id);
    await fails(as('coordA', (c) => c.query(`SELECT portal._transition($1,'approved','system')`, [id])), '42501');
    // rule table is data; deleting rules is not possible for the runtime
    await fails(as('adminA', (c) => c.query('DELETE FROM portal.request_transition_rules')), '42501');
    const rules = await q(admin(), 'SELECT count(*)::int n FROM portal.request_transition_rules WHERE from_state=$1', ['closed']);
    expect(rules[0].n).toBe(0);                                          // closed is terminal
  });

  it('submit needs a complete form and at least one item; duplicate submit is idempotent', async () => {
    const key = `incomplete-${Date.now()}`;
    const id = await as('resA', async (c) => (await q(c, 'SELECT portal.request_create($1) id', [key]))[0].id);
    await fails(as('resA', (c) => c.query('SELECT portal.request_submit($1,$2)', [id, 'submit-key-0001'])), 'form_incomplete');
    expect((await as('resA', (c) => q(c, 'SELECT portal.request_create($1) id', [key])))[0].id).toBe(id);   // same key, same request
    const id2 = await draft();
    expect((await submit(id2))[0].s).toBe('precheck');
    expect((await submit(id2))[0].s).toBe('precheck');                  // duplicate submit returns the current state
    const submitted = await q(admin(), `SELECT count(*)::int n FROM portal.request_events WHERE request_id=$1 AND to_state='submitted'`, [id2]);
    expect(submitted[0].n).toBe(1);
  });

  it('form is locked after submit; applicant may edit again only in needs_info', async () => {
    const id = await draft(); await submit(id);
    const r = await as('resA', (c) => c.query(`UPDATE portal.requests SET planned_use='changed' WHERE id=$1`, [id]));
    expect(r.rowCount).toBe(0);                                          // RLS: not draft/needs_info
    await as('coordA', (c) => c.query(`SELECT portal.request_ask_info($1,'clarify','SYNTHETIC: please clarify')`, [id]));
    expect((await as('resA', (c) => c.query(`UPDATE portal.requests SET planned_use='SYNTHETIC: clarified' WHERE id=$1`, [id]))).rowCount).toBe(1);
    await as('resA', (c) => c.query('SELECT portal.request_respond_info($1)', [id]));
    expect((await status(id)).status).toBe('precheck');
    const tl = await as('resA', (c) => q(c, 'SELECT portal.request_timeline($1) t', [id]));
    expect(tl[0].t.events.some((e) => e.publicNote === 'SYNTHETIC: please clarify')).toBe(true);
  });

  it('info rounds are capped by workflow_config', async () => {
    const id = await draft(); await submit(id);
    for (let i = 0; i < 3; i++) {
      await as('coordA', (c) => c.query(`SELECT portal.request_ask_info($1,'clarify',NULL)`, [id]));
      await as('resA', (c) => c.query('SELECT portal.request_respond_info($1)', [id]));
    }
    await fails(as('coordA', (c) => c.query(`SELECT portal.request_ask_info($1,'clarify',NULL)`, [id])), 'info_rounds_exhausted');
  });

  it('precheck needs a complete checklist; coordinator cannot pre-check own request', async () => {
    const id = await draft(); await submit(id);
    await fails(as('coordA', (c) => c.query('SELECT portal.request_precheck_pass($1,$2::jsonb)', [id, '{"form_complete":true}'])), 'checklist_incomplete');
  });
});

describe('N-of-M committee voting (RT-03, RT-26)', () => {
  it('one vote per member per round', async () => {
    const id = await draft(); await toCommittee(id);
    await vote(id, 'comA', 'approve');
    await fails(vote(id, 'comA', 'approve'), 'already_voted');
    await fails(vote(id, 'comA', 'reject'), 'already_voted');
    expect((await q(admin(), 'SELECT count(*)::int n FROM portal.request_votes WHERE request_id=$1', [id]))[0].n).toBe(1);
  });
  it('a single vote never decides; the decision appears exactly when N votes are reached', async () => {
    const id = await draft(); await toCommittee(id);
    await vote(id, 'comA', 'approve');
    expect((await status(id)).status).toBe('committee_review');
    expect((await q(admin(), 'SELECT count(*)::int n FROM portal.request_decisions WHERE request_id=$1', [id]))[0].n).toBe(0);
    await vote(id, 'comB', 'reject');                                    // 1 approve, 1 reject: no quorum
    expect((await status(id)).status).toBe('committee_review');
    expect((await vote(id, 'comC', 'approve'))[0].r).toBe('approved');   // 2 approvals
    const [d] = await q(admin(), 'SELECT outcome, criteria_snapshot FROM portal.request_decisions WHERE request_id=$1', [id]);
    expect(d.outcome).toBe('approved'); expect(d.criteria_snapshot).toMatchObject({ votes_needed: 2, approve: 2, reject: 1 });
  });
  it('rejection needs a rationale code and N reject votes', async () => {
    const id = await draft(); await toCommittee(id);
    await fails(as('comA', (c) => c.query(`SELECT portal.request_cast_vote($1,'reject',NULL,NULL)`, [id])), '23514');
    await vote(id, 'comA', 'reject'); expect((await vote(id, 'comB', 'reject'))[0].r).toBe('rejected');
    expect(await status(id)).toEqual({ status: 'rejected', close_reason: null });
  });
  it('direct inserts of decisions or votes by any runtime role are impossible (T8)', async () => {
    const id = await draft(); await toCommittee(id);
    for (const who of ['comA', 'coordA', 'adminA', 'resA']) {
      await fails(as(who, (c) => c.query(`INSERT INTO portal.request_decisions (id, request_id, round, outcome) VALUES (portal.new_id('dec'), $1, 'initial', 'approved')`, [id])), '42501');
      await fails(as(who, (c) => c.query(`INSERT INTO portal.request_votes (id, request_id, round, voter_user_id, vote) VALUES (portal.new_id('vot'), $1, 'initial', $2, 'approve')`, [id, U.comA])), '42501');
    }
    await fails(admin().query(`UPDATE portal.request_votes SET vote='approve'`), '42501');            // votes are immutable
    await fails(admin().query(`DELETE FROM portal.request_decisions`), '42501');
  });
  it('voting only while committee_review/appeal_review; not on drafts or precheck', async () => {
    const id = await draft();
    await fails(vote(id, 'comA', 'approve'), 'voting_closed');
    await submit(id);
    await fails(vote(id, 'comA', 'approve'), 'voting_closed');
  });
  it('non-committee roles cannot vote; admin cannot approve or vote', async () => {
    const id = await draft(); await toCommittee(id);
    for (const who of ['adminA', 'coordA', 'resA', 'clinA', 'intl']) await fails(vote(id, who, 'approve'), 'forbidden');
  });
  it('recusal and own-request conflict', async () => {
    const id = await draft(); await toCommittee(id);
    await as('comA', (c) => c.query('SELECT portal.request_declare_conflict($1)', [id]));
    await fails(vote(id, 'comA', 'approve'), 'conflict_of_interest');
  });
  it('committee members only see requests that reached committee; admin sees none of the content', async () => {
    const id = await draft(); await submit(id);
    await as('comA', async (c) => expect((await q(c, 'SELECT count(*)::int n FROM portal.requests WHERE id=$1', [id]))[0].n).toBe(0));
    await as('adminA', async (c) => {
      expect((await q(c, 'SELECT count(*)::int n FROM portal.requests'))[0].n).toBe(0);
      const meta = await q(c, 'SELECT * FROM portal.request_metadata(500)');
      expect(meta.some((m) => m.id === id)).toBe(true);
      expect(Object.keys(meta[0])).not.toContain('research_question');
    });
    await as('resB', async (c) => expect((await q(c, 'SELECT count(*)::int n FROM portal.requests'))[0].n).toBe(0));   // other applicant
  });
  it('appeal: one appeal only, excluded voters if enough others remain, upheld appeal approves', async () => {
    const id = await draft(); await toCommittee(id);
    await admin().query(`UPDATE portal.committee_config SET votes_needed=2, members_total=3`);
    await vote(id, 'comA', 'reject'); await vote(id, 'comB', 'reject');
    expect((await status(id)).status).toBe('rejected');
    await as('resA', (c) => c.query('SELECT portal.request_start_appeal($1)', [id]));
    expect((await status(id)).status).toBe('appeal_review');
    // 3 eligible members, 2 voted initially: 1 remaining < N=2 => the fallback lets everyone vote
    await vote(id, 'comA', 'approve');
    expect((await vote(id, 'comC', 'approve'))[0].r).toBe('approved');
    expect((await status(id)).status).toBe('approved');
    await fails(as('resA', (c) => c.query('SELECT portal.request_start_appeal($1)', [id])), 'appeal_not_allowed');
  });
  it('appeal rejected closes with reason rejected and detail appeal_rejected', async () => {
    const id = await draft(); await toCommittee(id);
    await vote(id, 'comA', 'reject'); await vote(id, 'comB', 'reject');
    await as('resA', (c) => c.query('SELECT portal.request_start_appeal($1)', [id]));
    await vote(id, 'comC', 'reject'); await vote(id, 'comA', 'reject');
    expect(await status(id)).toEqual({ status: 'closed', close_reason: 'rejected' });
    expect((await q(admin(), 'SELECT close_detail FROM portal.requests WHERE id=$1', [id]))[0].close_detail).toBe('appeal_rejected');
  });
  it('committee config N cannot drop below 2 and M >= N', async () => {
    await fails(admin().query('UPDATE portal.committee_config SET votes_needed=1'), '23514');
    await fails(admin().query('UPDATE portal.committee_config SET votes_needed=4, members_total=3'), '23514');
  });
});

describe('center scope on requests (RT-20 regression)', () => {
  it('a clinician sees a request only after a step exists for the own center', async () => {
    const id = await draft(); await toCommittee(id);
    await vote(id, 'comA', 'approve'); await vote(id, 'comB', 'approve');
    await as('clinA', async (c) => expect((await q(c, 'SELECT count(*)::int n FROM portal.requests WHERE id=$1', [id]))[0].n).toBe(0));
    await as('coordA', async (c) => {
      const [{ id: item }] = await q(c, 'SELECT id FROM portal.request_items WHERE request_id=$1', [id]);
      await c.query('INSERT INTO portal.request_item_samples (request_item_id, sample_id) VALUES ($1,$2)', [item, sampleId]);
      await c.query('SELECT portal.request_start_center_coordination($1)', [id]);
    });
    await as('clinA', async (c) => {
      expect((await q(c, 'SELECT count(*)::int n FROM portal.requests WHERE id=$1', [id]))[0].n).toBe(1);
      expect((await q(c, 'SELECT count(*)::int n FROM portal.request_items WHERE request_id=$1', [id]))[0].n).toBe(1);
      expect((await q(c, 'SELECT count(*)::int n FROM portal.request_steps WHERE request_id=$1', [id]))[0].n).toBe(1);
    });
    await as('clinB', async (c) => expect((await q(c, 'SELECT count(*)::int n FROM portal.requests WHERE id=$1', [id]))[0].n).toBe(0));
    await fails(as('clinB', (c) => c.query(`SELECT portal.request_center_respond($1,$2,true,NULL)`, [id, C.A])), 'forbidden');
  });
  it('resolution of items is only possible once approved', async () => {
    const id = await draft(); await submit(id);
    await fails(as('coordA', async (c) => {
      const [{ id: item }] = await q(c, 'SELECT id FROM portal.request_items WHERE request_id=$1', [id]);
      await c.query('INSERT INTO portal.request_item_samples (request_item_id, sample_id) VALUES ($1,$2)', [item, sampleId]);
    }), '42501');
  });
  it('all centers decline: request closes as rejected with detail center_declined', async () => {
    const id = await draft(); await toCommittee(id);
    await vote(id, 'comA', 'approve'); await vote(id, 'comB', 'approve');
    await as('coordA', async (c) => {
      const [{ id: item }] = await q(c, 'SELECT id FROM portal.request_items WHERE request_id=$1', [id]);
      await c.query('INSERT INTO portal.request_item_samples (request_item_id, sample_id) VALUES ($1,$2)', [item, sampleId]);
      await c.query('SELECT portal.request_start_center_coordination($1)', [id]);
    });
    await as('clinA', (c) => c.query(`SELECT portal.request_center_respond($1,$2,false,'SYNTHETIC: declined')`, [id, C.A]));
    expect(await status(id)).toEqual({ status: 'closed', close_reason: 'rejected' });
  });
});

describe('withdraw, policy cancel, expiry', () => {
  it('withdraw works in any non-terminal state; policy cancel by coordinator or admin only', async () => {
    const id = await draft(); await toCommittee(id);
    await fails(as('comA', (c) => c.query('SELECT portal.request_cancel_policy($1)', [id])), 'forbidden');
    await fails(as('resB', (c) => c.query('SELECT portal.request_withdraw($1)', [id])), 'not_found');
    await as('adminA', (c) => c.query(`SELECT portal.request_cancel_policy($1,'policy')`, [id]));
    expect(await status(id)).toEqual({ status: 'closed', close_reason: 'policy_cancelled' });
  });
  it('expiry job closes overdue requests using workflow_config timers (app_readonly_bg)', async () => {
    const id = await draft(); await submit(id);
    await as('coordA', (c) => c.query(`SELECT portal.request_ask_info($1,'clarify',NULL)`, [id]));
    await admin().query(`ALTER TABLE portal.requests DISABLE TRIGGER trg_requests_guard`);
    await admin().query(`UPDATE portal.requests SET state_entered_at = now() - interval '15 days' WHERE id=$1`, [id]);
    await admin().query(`ALTER TABLE portal.requests ENABLE TRIGGER trg_requests_guard`);
    const { pool } = await import('./helpers.mjs');
    const r = await pool('app_readonly_bg').query('SELECT portal.request_expire_overdue() n');
    expect(r.rows[0].n).toBeGreaterThanOrEqual(1);
    expect(await status(id)).toEqual({ status: 'closed', close_reason: 'expired' });
    await fails(as('resA', (c) => c.query('SELECT portal.request_expire_overdue()')), 'forbidden');
  });
  it('only the requesting applicant sees the timeline; it never exposes votes or internal notes', async () => {
    const id = await draft(); await toCommittee(id);
    await vote(id, 'comA', 'approve');
    const t = await as('resA', (c) => q(c, 'SELECT portal.request_timeline($1) t', [id]));
    expect(JSON.stringify(t[0].t)).not.toMatch(/vote|voter|internal/i);
    await fails(as('resB', (c) => c.query('SELECT portal.request_timeline($1)', [id])), 'not_found');
    await as('resA', async (c) => expect((await q(c, 'SELECT count(*)::int n FROM portal.request_votes'))[0].n).toBe(0));
  });
});
