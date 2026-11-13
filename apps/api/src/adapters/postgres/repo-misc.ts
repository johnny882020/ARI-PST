import type { ApprovalRecord, AuditRepo, AuditRow, Ctx, GovernanceRepo, ImportJobRecord, ImportRepo, ImportRowRecord, OutboxRepo } from '@ari/domain';
import { iso, type Q } from './db-types.js';

// ---------- imports ----------
const jobOf = (j: any): ImportJobRecord => ({
  id: j.id, createdBy: j.created_by, centerId: j.center_id ?? null, mode: j.mode, format: j.format, status: j.status, parentJobId: j.parent_job_id ?? null,
  fileSha256: j.file_sha256 ? Buffer.from(j.file_sha256).toString('hex') : null, stagingKey: j.staging_key ?? null, totalRows: j.total_rows ?? null, acceptedRows: j.accepted_rows ?? null,
  warningRows: j.warning_rows ?? null, rejectedRows: j.rejected_rows ?? null, createdAt: iso(j.created_at)!, finishedAt: iso(j.finished_at), expiresAt: iso(j.expires_at)!,
});
const JCOLS = 'id, created_by, center_id, mode::text AS mode, format::text AS format, status::text AS status, parent_job_id, file_sha256, staging_key, total_rows, accepted_rows, warning_rows, rejected_rows, created_at, finished_at, expires_at';
export function makeImportRepo(q: Q): ImportRepo {
  const setStatus = (id: string, s: string, extra = '') => q.query(`UPDATE portal.import_jobs SET status = $2::portal.import_status${extra} WHERE id = $1`, [id, s]);
  return {
    async createJob(j) {
      await q.query(`INSERT INTO portal.import_jobs (id, created_by, center_id, mode, format, file_name_safe, staging_key, file_sha256, parent_job_id) VALUES ($1,$2,$3,$4::portal.import_mode,$5::portal.import_format,$6,$7,decode($8,'hex'),$9)`,
        [j.id, j.createdBy, j.centerId, j.mode, j.format, j.fileName, j.stagingKey, j.fileSha256, j.parentJobId ?? null]);
      await setStatus(j.id, 'validating', ', started_at = now()');
      return jobOf((await q.query(`SELECT ${JCOLS} FROM portal.import_jobs WHERE id = $1`, [j.id])).rows[0]);
    },
    async getJob(id) { const r = await q.query(`SELECT ${JCOLS} FROM portal.import_jobs WHERE id = $1`, [id]); return r.rows[0] ? jobOf(r.rows[0]) : null; },
    async listJobs(p) {
      const params: unknown[] = []; let w = '';
      if (p.cursor) { try { const c = JSON.parse(Buffer.from(p.cursor, 'base64url').toString()); params.push(c.c, c.i); w = `WHERE (created_at, id) < ($1::timestamptz, $2)`; } catch { /* ignore */ } }
      params.push(p.limit + 1);
      const r = await q.query(`SELECT ${JCOLS} FROM portal.import_jobs ${w} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`, params);
      const rows = r.rows.slice(0, p.limit); const last = rows[rows.length - 1];
      return { items: rows.map(jobOf), nextCursor: r.rows.length > p.limit && last ? Buffer.from(JSON.stringify({ c: iso(last.created_at), i: last.id })).toString('base64url') : null };
    },
    async finishJob(id, p) {
      const counts = ', total_rows = $3, accepted_rows = $4, warning_rows = $5, rejected_rows = $6, finished_at = now()';
      const params = [id, p.status, p.total, p.accepted, p.warnings, p.rejected];
      if (p.status === 'committed') {
        await setStatus(id, 'validated'); await setStatus(id, 'committing');
        await q.query(`UPDATE portal.import_jobs SET status = 'committed'${counts} WHERE id = $1 AND $2 = $2`, params);
      } else await q.query(`UPDATE portal.import_jobs SET status = $2::portal.import_status${counts} WHERE id = $1`, params);
    },
    async saveRows(jobId, rows) {
      for (const r of rows) await q.query('INSERT INTO portal.import_job_rows (job_id, row_no, outcome, sample_id, action, issues) VALUES ($1,$2,$3::portal.row_outcome,$4,$5,$6::jsonb) ON CONFLICT (job_id, row_no) DO UPDATE SET outcome = EXCLUDED.outcome, sample_id = EXCLUDED.sample_id, action = EXCLUDED.action, issues = EXCLUDED.issues',
        [jobId, r.rowNo, r.outcome, r.sampleCode, r.action, JSON.stringify(r.issues)]);
    },
    async listRows(jobId, p) {
      const params: unknown[] = [jobId]; const w = ['job_id = $1'];
      if (p.outcome) { params.push(p.outcome); w.push(`outcome = $${params.length}::portal.row_outcome`); }
      if (p.cursor) { params.push(Number(p.cursor) || 0); w.push(`row_no > $${params.length}`); }
      params.push(p.limit + 1);
      const r = await q.query(`SELECT row_no, outcome::text AS outcome, action, sample_id, issues FROM portal.import_job_rows WHERE ${w.join(' AND ')} ORDER BY row_no LIMIT $${params.length}`, params);
      const rows = r.rows.slice(0, p.limit);
      return { items: rows.map(rowOf), nextCursor: r.rows.length > p.limit ? String(rows[rows.length - 1].row_no) : null };
    },
    async allRows(jobId) { return (await q.query('SELECT row_no, outcome::text AS outcome, action, sample_id, issues FROM portal.import_job_rows WHERE job_id = $1 ORDER BY row_no', [jobId])).rows.map(rowOf); },
    async hasCommitChild(parentId) { return (await q.query(`SELECT 1 FROM portal.import_jobs WHERE parent_job_id = $1 AND mode = 'commit'`, [parentId])).rows.length > 0; },
  };
}
const rowOf = (x: any): ImportRowRecord => ({ rowNo: x.row_no, outcome: x.outcome, action: x.action ?? 'none', sampleCode: x.sample_id ?? null, issues: x.issues ?? [] });

// ---------- governance (two-person changes live in portal.change_requests) ----------
const KIND_OUT: Record<string, ApprovalRecord['kind']> = { role_grant: 'role_grant', k_policy: 'k_change', committee_config: 'committee_config' };
const camel = (kind: string, p: any): Record<string, unknown> => kind === 'role_grant' ? { userId: p.user_id, role: p.role, centerId: p.center_id ?? null, reason: p.reason ?? '' } : kind === 'k_policy' ? { fieldSet: p.field_set, k: p.k, reason: p.reason ?? '' } : { votesNeeded: p.votes_needed, membersTotal: p.members_total };
const approvalOf = (c: any): ApprovalRecord => ({ id: c.id, kind: KIND_OUT[c.kind]!, payload: camel(c.kind, c.payload), proposedBy: c.proposed_by, status: c.status === 'pending' || c.status === 'approved' || c.status === 'rejected' ? c.status : 'rejected', approvedBy: c.status === 'approved' ? c.decided_by : null, createdAt: iso(c.proposed_at)! });
export function makeGovernanceRepo(q: Q): GovernanceRepo {
  const get = async (id: string) => { const r = await q.query('SELECT id, kind, payload, status, proposed_by, decided_by, proposed_at FROM portal.change_requests WHERE id = $1', [id]); return r.rows[0] ? approvalOf(r.rows[0]) : null; };
  return {
    async propose(a) {
      const p = a.payload as Record<string, unknown>;
      const kind = a.kind === 'k_change' ? 'k_policy' : a.kind;
      const payload = kind === 'role_grant' ? { user_id: p.userId, role: p.role, ...(p.centerId ? { center_id: p.centerId } : {}), ...(p.reason ? { reason: p.reason } : {}) } : kind === 'k_policy' ? { field_set: p.fieldSet, k: p.k, ...(p.reason ? { reason: p.reason } : {}) } : { votes_needed: p.votesNeeded, members_total: p.membersTotal };
      const id = (await q.query('SELECT portal.change_propose($1,$2::jsonb) AS id', [kind, JSON.stringify(payload)])).rows[0].id as string;
      return (await get(id))!;
    },
    getApproval: get,
    async listApprovals(status) {
      const r = await q.query(`SELECT id, kind, payload, status, proposed_by, decided_by, proposed_at FROM portal.change_requests ${status ? 'WHERE status = $1' : ''} ORDER BY proposed_at DESC LIMIT 200`, status ? [status] : []);
      return r.rows.map(approvalOf);
    },
    async decide(id, _by, approve, stepUpAgeS) {
      if (approve) await q.query('SELECT portal.change_approve($1,$2)', [id, stepUpAgeS]); else await q.query('SELECT portal.change_reject($1)', [id]);
      return get(id);
    },
    async getKPolicies() { return (await q.query('SELECT field_set, k FROM portal.k_policies ORDER BY field_set')).rows.map((x) => ({ fieldSet: x.field_set, k: x.k })); },
    async metrics() {
      const r = (await q.query('SELECT samples_total, centers_feeding, registered_researchers, searches_30d, entered_share::float AS share FROM ops.metrics()')).rows[0];
      return { samplesTotal: r.samples_total, centersFeeding: r.centers_feeding, registeredResearchers: r.registered_researchers, searchesLast30d: r.searches_30d, coordinatorEnteredShare: Number(r.share) };
    },
  };
}

// ---------- outbox ----------
export function makeOutboxRepo(q: Q): OutboxRepo {
  return {
    async enqueue(o) { await q.query('SELECT ops.outbox_enqueue($1,$2,$3,$4,$5,$6,$7::jsonb)', [o.id, o.template, o.toRole ?? null, o.toUserId, o.toEmail, o.locale, JSON.stringify(o.params)]); },
    async claimPending(limit) { return (await q.query('SELECT id, template, to_email, locale, params, attempts FROM ops.outbox_claim($1)', [limit])).rows.map((x) => ({ id: x.id, template: x.template, toEmail: x.to_email ?? null, locale: x.locale, params: x.params ?? {}, attempts: x.attempts })); },
    async markSent(id) { await q.query('SELECT ops.outbox_mark($1,true,false)', [id]); },
    async markFailed(id, giveUp) { await q.query('SELECT ops.outbox_mark($1,false,$2)', [id, giveUp]); },
    async list(limit) { return (await q.query('SELECT id, template, status, attempts, created_at, sent_at FROM ops.outbox_list($1)', [limit])).rows.map((x) => ({ id: x.id, template: x.template, toUserId: null, status: x.status, attempts: x.attempts, createdAt: iso(x.created_at)!, sentAt: iso(x.sent_at) })); },
  };
}

// ---------- audit log reads ----------
export function makeAuditRepo(q: Q, ctx: Ctx): AuditRepo {
  void ctx;
  return {
    async query(p) {
      const until = p.cursor ? new Date(Buffer.from(p.cursor, 'base64url').toString()).toISOString() : (p.to ?? new Date().toISOString());
      const since = p.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
      const r = await q.query('SELECT id, occurred_at, actor_user_id, actor_role, action, object_type, object_id, outcome, details FROM audit.read_events($1::timestamptz,$2::timestamptz,$3,$4)', [since, until, p.action ?? null, Math.min(1000, (p.limit + 1) * 4)]);
      const OUT: Record<string, 'success' | 'denied' | 'error'> = { allow: 'success', deny: 'denied', error: 'error' };
      let rows = r.rows.filter((x) => (!p.actorUserId || x.actor_user_id === p.actorUserId) && (!p.objectType || x.object_type === p.objectType) && (!p.objectId || x.object_id === p.objectId) && (!p.outcome || OUT[x.outcome] === p.outcome));
      const more = rows.length > p.limit; rows = rows.slice(0, p.limit);
      const items: AuditRow[] = rows.map((x) => ({ seq: 0, id: x.id, occurredAt: iso(x.occurred_at)!, actorUserId: x.actor_user_id ?? null, actorRole: x.actor_role ?? null, action: x.action, objectType: x.object_type ?? null, objectId: x.object_id ?? null, outcome: OUT[x.outcome] ?? 'error', details: x.details ?? {}, traceId: null, hash: '' }));
      const last = rows[rows.length - 1];
      return { items, nextCursor: more && last ? Buffer.from(iso(last.occurred_at)!).toString('base64url') : null };
    },
    async verify() {
      const r = await q.query('SELECT lane, broken_seq, reason FROM audit.verify_chain()');
      return r.rows.length ? Number(r.rows[0].broken_seq) : null;
    },
  };
}
