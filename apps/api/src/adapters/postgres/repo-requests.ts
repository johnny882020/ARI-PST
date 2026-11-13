// Access requests. State changes go ONLY through the database functions (request_*). The database enforces the state machine,
// actors, quorum and separation of duties; this adapter maps the API facade onto those functions.
import { randomBytes } from 'node:crypto';
import { DomainError, type Ctx, type DecisionRecord, type RequestRecord, type RequestRepo, type RequestStepRecord, type VoteRecord, type StepKey } from '@ari/domain';
import { iso, type Q } from './db-types.js';

const itemOf = (i: any) => ({ createdAt: iso(i.created_at) ?? undefined, id: i.id, criteria: i.criteria, requestedCount: i.requested_count ?? null, shownCountBucket: i.shown_count_bucket ?? null });
const COLS = `id, applicant_user_id, status::text AS status, close_reason::text AS close_reason, research_question, applicant_ethics_ref, planned_use, funding_sources,
  submitted_at, decided_at, delivered_at, created_at, updated_at, appeal_count`;
const reqOf = (r: any, items: any[]): RequestRecord => ({
  id: r.id, status: r.status, closeReason: r.close_reason ?? null, applicantUserId: r.applicant_user_id, researchQuestion: r.research_question ?? null,
  applicantEthicsRef: r.applicant_ethics_ref ?? null, plannedUse: r.planned_use ?? null, fundingSources: r.funding_sources ?? null, items: items.map(itemOf),
  submittedAt: iso(r.submitted_at), decidedAt: iso(r.decided_at), deliveredAt: iso(r.delivered_at), createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, appealCount: r.appeal_count,
});
const FIELD_COLS: Record<string, string> = { researchQuestion: 'research_question', applicantEthicsRef: 'applicant_ethics_ref', plannedUse: 'planned_use', fundingSources: 'funding_sources' };

export function makeRequestRepo(q: Q, ctx: Ctx): RequestRepo {
  const itemsFor = async (ids: string[]) => {
    if (!ids.length) return new Map<string, any[]>();
    const r = await q.query('SELECT id, request_id, criteria, requested_count, shown_count_bucket, created_at FROM portal.request_items WHERE request_id = ANY($1) ORDER BY created_at, id', [ids]);
    const m = new Map<string, any[]>(); for (const x of r.rows) (m.get(x.request_id) ?? m.set(x.request_id, []).get(x.request_id)!).push(x); return m;
  };
  const get = async (id: string): Promise<RequestRecord | null> => {
    const r = await q.query(`SELECT ${COLS} FROM portal.requests WHERE id = $1`, [id]);
    if (!r.rows[0]) return null; const it = await itemsFor([id]); return reqOf(r.rows[0], it.get(id) ?? []);
  };
  const stepOf = (s: any): RequestStepRecord => ({ stepKey: s.step_key, centerId: s.center_id, status: s.status, publicNote: s.public_note ?? null, internalNote: s.internal_note ?? null, startedAt: iso(s.started_at), completedAt: iso(s.completed_at) });
  return {
    async getDraftFor(userId) {
      const r = await q.query(`SELECT id FROM portal.requests WHERE applicant_user_id = $1 AND status = 'draft' ORDER BY created_at DESC LIMIT 1`, [userId]);
      return r.rows[0] ? get(r.rows[0].id) : null;
    },
    async create(r) {
      const id = (await q.query('SELECT portal.request_create($1) AS id', [r.idempotencyKey])).rows[0].id as string;
      if (Object.keys(r.fields).length) await this.updateFields(id, r.fields);
      return (await get(id))!;
    },
    get,
    async list(p) {
      const params: unknown[] = []; const w: string[] = [];
      if (p.status) { params.push(p.status); w.push(`status = $${params.length}::portal.request_status`); }
      if (p.cursor) { try { const c = JSON.parse(Buffer.from(p.cursor, 'base64url').toString()); params.push(c.c, c.i); w.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length})`); } catch { /* ignore */ } }
      params.push(p.limit + 1);
      const r = await q.query(`SELECT ${COLS} FROM portal.requests ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`, params);
      const rows = r.rows.slice(0, p.limit); const it = await itemsFor(rows.map((x) => x.id)); const last = rows[rows.length - 1];
      return { items: rows.map((x) => reqOf(x, it.get(x.id) ?? [])), nextCursor: r.rows.length > p.limit && last ? Buffer.from(JSON.stringify({ c: iso(last.created_at), i: last.id })).toString('base64url') : null };
    },
    async updateFields(id, f) {
      const sets: string[] = []; const params: unknown[] = [id];
      for (const [k, v] of Object.entries(f)) if (FIELD_COLS[k] && v !== undefined) { params.push(v); sets.push(`${FIELD_COLS[k]} = $${params.length}`); }
      if (sets.length) { const r = await q.query(`UPDATE portal.requests SET ${sets.join(', ')} WHERE id = $1`, params); if (!r.rowCount) throw new DomainError('NOT_FOUND'); }
      return get(id);
    },
    async setItems(id, items) {
      await q.query('DELETE FROM portal.request_items WHERE request_id = $1', [id]);
      for (const i of items) await q.query('INSERT INTO portal.request_items (id, request_id, criteria, requested_count, shown_count_bucket) VALUES ($1,$2,$3::jsonb,$4,$5)', [i.id, id, JSON.stringify(i.criteria), i.requestedCount, i.shownCountBucket]);
    },
    async addItem(id, i) {
      const r = await q.query('INSERT INTO portal.request_items (id, request_id, criteria, requested_count, shown_count_bucket) VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING id, criteria, requested_count, shown_count_bucket, created_at', [i.id, id, JSON.stringify(i.criteria), i.requestedCount, i.shownCountBucket]);
      return itemOf(r.rows[0]);
    },
    async removeItem(requestId, itemId) { return ((await q.query('DELETE FROM portal.request_items WHERE id = $1 AND request_id = $2', [itemId, requestId])).rowCount ?? 0) > 0; },
    async findByIdempotency(userId, key) {
      const r = await q.query('SELECT encode(request_hash, \'hex\') AS h, response_ref FROM portal.idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]);
      return r.rows[0] ? { requestHash: r.rows[0].h, requestId: r.rows[0].response_ref } : null;
    },
    async saveIdempotency(userId, key, methodPath, hash, status, requestId) {
      await q.query('INSERT INTO portal.idempotency_keys (user_id, key, method_path, request_hash, response_status, response_ref) VALUES ($1,$2,$3,decode($4,\'hex\'),$5,$6) ON CONFLICT DO NOTHING', [userId, key, methodPath, hash, status, requestId]);
    },
    async transition(id, to, closeReason, extra) {
      const cur = await get(id); if (!cur) return null;
      const from = cur.status; const reason = extra?.reasonCode ?? null; const note = extra?.note ?? null;
      const bad = () => new DomainError('REQUEST_STATE_INVALID');
      if (to === 'submitted') await q.query('SELECT portal.request_submit($1,$2)', [id, extra?.idempotencyKey ?? randomBytes(12).toString('hex')]);
      else if (to === 'precheck') { if (from === 'submitted') await q.query('SELECT portal.request_start_precheck($1)', [id]); else if (from === 'needs_info') await q.query('SELECT portal.request_respond_info($1)', [id]); else throw bad(); }
      else if (to === 'needs_info') await q.query('SELECT portal.request_ask_info($1,$2,$3)', [id, reason ?? 'info_needed', note]);
      else if (to === 'committee_review') await q.query('SELECT portal.request_precheck_pass($1,$2::jsonb)', [id, JSON.stringify(extra?.checklist ?? {})]);
      else if (to === 'appeal_review') await q.query('SELECT portal.request_start_appeal($1)', [id]);
      else if (to === 'center_coordination') await q.query('SELECT portal.request_start_center_coordination($1)', [id]);
      else if (to === 'delivery') await q.query('SELECT portal.request_start_delivery($1)', [id]);
      else if (to === 'closed') {
        if (closeReason === 'withdrawn') await q.query('SELECT portal.request_withdraw($1)', [id]);
        else if (closeReason === 'policy_cancelled') await q.query('SELECT portal.request_cancel_policy($1,$2)', [id, reason ?? 'policy']);
        else if (closeReason === 'rejected' && from === 'precheck') await q.query('SELECT portal.request_precheck_reject($1,$2)', [id, reason ?? 'precheck_failed']);
        else throw bad();   // delivered: only the holding centers confirm. expired: only the system timer.
      } else throw bad();   // approved, rejected, agreements: only the voting rule and center responses move there
      return get(id);
    },
    async steps(id, includeInternal) {
      if (ctx.actor.role === 'researcher_il') {
        const t = (await q.query('SELECT portal.request_timeline($1) AS t', [id])).rows[0]?.t as { centers?: Array<{ step: StepKey; status: any; publicNote: string | null }> } | undefined;
        return (t?.centers ?? []).map((c) => ({ stepKey: c.step, centerId: null, status: c.status, publicNote: c.publicNote ?? null, startedAt: null, completedAt: null }));
      }
      const r = await q.query('SELECT step_key::text AS step_key, center_id, status::text AS status, public_note, internal_note, started_at, completed_at FROM portal.request_steps WHERE request_id = $1 ORDER BY created_at', [id]);
      return r.rows.map((s) => { const x = stepOf(s); if (!includeInternal) delete x.internalNote; return x; });
    },
    async updateStep(id, key, centerId, p) {
      if (key === 'center_coordination') await q.query('SELECT portal.request_center_respond($1,$2,$3,$4)', [id, centerId, p.accepted ?? false, p.publicNote ?? null]);
      else if (key === 'mta_dta') {
        if (!p.agreement) throw new DomainError('VALIDATION_FAILED', [{ field: 'agreement', rule: 'REQUIRED' }]);
        await q.query('SELECT portal.request_record_agreement($1,$2,$3,$4)', [id, centerId, p.agreement.kind, p.agreement.docRef]);
      } else if (key === 'delivery') await q.query('SELECT portal.request_center_delivered($1,$2)', [id, centerId]);
      else throw new DomainError('VALIDATION_FAILED', [{ field: 'stepKey', rule: 'VOCAB' }]);
      if (p.internalNote !== undefined && key !== 'mta_dta') await q.query(`UPDATE portal.request_steps SET internal_note = $4 WHERE request_id = $1 AND step_key = $2::portal.step_key AND center_id = $3`, [id, key, centerId, p.internalNote]);
      const r = await q.query('SELECT step_key::text AS step_key, center_id, status::text AS status, public_note, internal_note, started_at, completed_at FROM portal.request_steps WHERE request_id = $1 AND center_id = $2 ORDER BY created_at DESC LIMIT 1', [id, centerId]);
      return r.rows[0] ? stepOf(r.rows[0]) : { stepKey: key, centerId, status: 'done', publicNote: null, startedAt: null, completedAt: null };
    },
    async resolveSamples(requestId, itemId, sampleIds) {
      const own = await q.query('SELECT 1 FROM portal.request_items WHERE id = $1 AND request_id = $2', [itemId, requestId]);
      if (!own.rows[0]) return false;
      await q.query('DELETE FROM portal.request_item_samples WHERE request_item_id = $1', [itemId]);
      for (const s of sampleIds) await q.query('INSERT INTO portal.request_item_samples (request_item_id, sample_id) VALUES ($1,$2)', [itemId, s]);
      return true;
    },
    async castVote(requestId, voter, vote, comment, rationaleCode) {
      const r = await q.query('SELECT portal.request_cast_vote($1,$2,$3,$4) AS res', [requestId, vote, rationaleCode, comment]);
      void r;
      const v = await q.query('SELECT vote::text AS vote, comment, voted_at FROM portal.request_votes WHERE request_id = $1 AND voter_user_id = $2 ORDER BY voted_at DESC LIMIT 1', [requestId, voter]);
      return { requestId, voterUserId: voter, vote: v.rows[0].vote, comment: v.rows[0].comment ?? null, votedAt: iso(v.rows[0].voted_at)! } as VoteRecord;
    },
    async votes(requestId) {
      const r = await q.query('SELECT voter_user_id, vote::text AS vote, comment, voted_at FROM portal.request_votes WHERE request_id = $1 ORDER BY voted_at', [requestId]);
      return r.rows.map((v) => ({ requestId, voterUserId: v.voter_user_id, vote: v.vote, comment: v.comment ?? null, votedAt: iso(v.voted_at)! }));
    },
    async tally(requestId, userId) {
      if (!(await get(requestId))) return null;
      const r = await q.query(`SELECT count(*) FILTER (WHERE vote = 'approve')::int AS a, count(*) FILTER (WHERE vote = 'reject')::int AS r, count(*) FILTER (WHERE vote = 'abstain')::int AS b,
          max(vote::text) FILTER (WHERE voter_user_id = $2) AS mine
        FROM portal.request_votes WHERE request_id = $1 AND round = (SELECT CASE WHEN status = 'appeal_review' THEN 'appeal' ELSE 'initial' END::portal.vote_round FROM portal.requests WHERE id = $1)`, [requestId, userId]);
      const c = await q.query('SELECT 1 FROM portal.request_recusals WHERE request_id = $1 AND user_id = $2', [requestId, userId]);
      const x = r.rows[0];
      return { approve: x.a, reject: x.r, abstain: x.b, myVote: x.mine ?? null, conflictDeclared: c.rows.length > 0 };
    },
    async committeeConfig() {
      const r = await q.query('SELECT votes_needed, members_total FROM portal.committee_config WHERE id = 1');
      return r.rows[0] ? { votesNeeded: r.rows[0].votes_needed, membersTotal: r.rows[0].members_total } : { votesNeeded: 2, membersTotal: 3 };
    },
    async latestDecision(requestId) {
      const r = await q.query('SELECT id, outcome::text AS outcome, rationale, rationale_codes, decided_at FROM portal.request_decisions WHERE request_id = $1 ORDER BY decided_at DESC LIMIT 1', [requestId]);
      const d = r.rows[0]; return d ? { id: d.id, requestId, outcome: d.outcome, rationale: d.rationale ?? (d.rationale_codes?.length ? d.rationale_codes.join(',') : null), decidedAt: iso(d.decided_at)! } as DecisionRecord : null;
    },
    async decisions(requestId) {
      const r = await q.query('SELECT id, outcome::text AS outcome, rationale, rationale_codes, decided_at FROM portal.request_decisions WHERE request_id = $1 ORDER BY decided_at', [requestId]);
      return r.rows.map((d) => ({ id: d.id, requestId, outcome: d.outcome, rationale: d.rationale ?? (d.rationale_codes?.length ? d.rationale_codes.join(',') : null), decidedAt: iso(d.decided_at)! }));
    },
    async countsByStatus() {
      const r = ctx.actor.role === 'system_admin'
        ? await q.query('SELECT status, count(*)::int AS n FROM portal.request_metadata(500) GROUP BY status')
        : await q.query('SELECT status::text AS status, count(*)::int AS n FROM portal.requests GROUP BY status');
      return Object.fromEntries(r.rows.map((x) => [x.status, x.n]));
    },
  };
}
