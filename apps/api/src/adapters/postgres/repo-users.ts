import type { CenterRecord, CenterRepo, CenterStaleness, Ctx, EthicsApprovalRecord, RoleAssignmentRecord, Role, UserRecord, UserRepo } from '@ari/domain';
import { iso, type Q } from './db-types.js';

const roleOf = (r: any): RoleAssignmentRecord => ({ id: r.id, role: r.role, centerId: r.center_id ?? null, grantedAt: iso(r.granted_at)! });
const userOf = (u: any, roles: RoleAssignmentRecord[]): UserRecord => ({
  id: u.id, email: u.email, displayName: u.display_name, locale: u.locale, status: u.status, emailVerifiedAt: iso(u.email_verified_at),
  lastLoginAt: iso(u.last_login_at), createdAt: iso(u.created_at)!, roles,
});
export function makeUserRepo(q: Q, ctx: Ctx): UserRepo {
  const rolesFor = async (ids: string[]) => {
    if (!ids.length) return new Map<string, RoleAssignmentRecord[]>();
    const r = await q.query('SELECT id, user_id, role::text AS role, center_id, granted_at FROM portal.role_assignments WHERE user_id = ANY($1) AND revoked_at IS NULL ORDER BY granted_at', [ids]);
    const m = new Map<string, RoleAssignmentRecord[]>();
    for (const x of r.rows) (m.get(x.user_id) ?? m.set(x.user_id, []).get(x.user_id)!).push(roleOf(x));
    return m;
  };
  const one = async (where: string, param: string): Promise<UserRecord | null> => {
    const r = await q.query(`SELECT id, email, display_name, locale, status::text AS status, email_verified_at, last_login_at, created_at FROM portal.users WHERE ${where}`, [param]);
    if (!r.rows[0]) return null; const m = await rolesFor([r.rows[0].id]); return userOf(r.rows[0], m.get(r.rows[0].id) ?? []);
  };
  return {
    getById: (id) => one('id = $1', id),
    getByEmail: (email) => one('email = $1', email.toLowerCase()),
    async list(p) {
      const params: unknown[] = []; const where: string[] = [];
      if (p.status) { params.push(p.status); where.push(`status = $${params.length}::portal.user_status`); }
      if (p.researchersOnly) where.push(`NOT EXISTS (SELECT 1 FROM portal.role_assignments ra WHERE ra.user_id = users.id AND ra.revoked_at IS NULL AND ra.role NOT IN ('researcher_il','researcher_intl'))`);
      if (p.cursor) { try { const c = JSON.parse(Buffer.from(p.cursor, 'base64url').toString()); params.push(c.c, c.i); where.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length})`); } catch { /* ignore bad cursor */ } }
      params.push(p.limit + 1);
      const r = await q.query(`SELECT id, email, display_name, locale, status::text AS status, email_verified_at, last_login_at, created_at FROM portal.users ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`, params);
      const rows = r.rows.slice(0, p.limit); const m = await rolesFor(rows.map((x) => x.id));
      const last = rows[rows.length - 1];
      return { items: rows.map((u) => userOf(u, m.get(u.id) ?? [])), nextCursor: r.rows.length > p.limit && last ? Buffer.from(JSON.stringify({ c: iso(last.created_at), i: last.id })).toString('base64url') : null };
    },
    async create(u) {
      const r = await q.query('SELECT portal.user_invite($1,$2,$3) AS id', [u.email, u.displayName, u.locale]);   // the database generates the id
      return (await one('id = $1', r.rows[0].id))!;
    },
    async update(id, p) {
      if (p.status) await q.query('SELECT portal.user_set_status($1,$2)', [id, p.status]);
      if (p.displayName !== undefined) await q.query('SELECT portal.user_admin_rename($1,$2)', [id, p.displayName]);
      return one('id = $1', id);
    },
    async grantRole(a) {
      // Privileged grants go through portal.change_propose/change_approve. Only researcher roles use researcher_approve.
      throw new Error('grantRole is not a direct operation: ' + a.role);
    },
    async revokeRole(userId, assignmentId) {
      const own = await q.query('SELECT 1 FROM portal.role_assignments WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [assignmentId, userId]);
      if (!own.rows[0]) return false;
      await q.query('SELECT portal.role_revoke($1)', [assignmentId]); return true;
    },
    async activeRoles(userId) { return (await rolesFor([userId])).get(userId) ?? []; },
    async registerResearcher(r) {
      try {
        await q.query('SAVEPOINT reg');
        const res = await q.query('SELECT user_id, verification_token FROM portal.user_register($1,$2,$3,$4)', [r.email, r.displayName, r.locale, r.isIsraeliAcademic ? 'researcher_il' : 'researcher_intl']);
        await q.query('RELEASE SAVEPOINT reg');
        return { userId: res.rows[0].user_id as string, verificationToken: res.rows[0].verification_token as string };
      } catch (e) { if ((e as { code?: string }).code === '23505') { await q.query('ROLLBACK TO SAVEPOINT reg'); return null; } throw e; }
    },
    async updateSelf(id, p) {
      void id; await q.query('SELECT portal.user_update_self($1,$2)', [p.displayName ?? null, p.locale ?? null]);
    },
    async verifyEmail(userId, token) { return (await q.query('SELECT portal.user_verify_email($1,$2) AS ok', [userId, token])).rows[0].ok === true; },
    async approveRegistration(userId) { await q.query('SELECT portal.researcher_approve($1)', [userId]); },
    async rejectRegistration(userId) { await q.query('SELECT portal.researcher_reject($1)', [userId]); },
    async registrations(limit) {
      const r = await q.query(`SELECT u.id, u.email, u.display_name, u.created_at, rr.requested_role::text AS requested_role, rr.status, m.institution
          FROM portal.researcher_registrations rr JOIN portal.users u ON u.id = rr.user_id LEFT JOIN authn.registration_meta m ON m.user_id = u.id
         ORDER BY (rr.status = 'pending') DESC, u.created_at DESC LIMIT $1`, [limit]);
      return r.rows.map((x) => ({ id: x.id, email: x.email, displayName: x.display_name, institution: x.institution ?? '', status: x.status, requestedAt: iso(x.created_at)!, isIsraeliAcademic: x.requested_role === 'researcher_il' }));
    },
    async registrationFlag(userId) {
      const r = await q.query(`SELECT requested_role::text AS requested_role FROM portal.researcher_registrations WHERE user_id = $1 AND status = 'pending'`, [userId]);
      return r.rows[0] ? { institution: null, isIsraeliAcademic: r.rows[0].requested_role === 'researcher_il' } : null;
    },
  };
}
const centerOf = (c: any): CenterRecord => ({ id: c.id, code: c.code, nameEn: c.name_en, nameHe: c.name_he, isActive: c.is_active, contactRole: c.contact_role, contactChannel: c.contact_channel ?? null, localSystemRef: c.local_system_ref ?? null, feedsRegularly: c.feeds_regularly });
const ethOf = (e: any): EthicsApprovalRecord => ({ id: e.id, centerId: e.center_id, approvalRef: e.approval_ref, kind: e.kind, status: e.status, validFrom: e.valid_from ? new Date(e.valid_from).toISOString().slice(0, 10) : null, validTo: e.valid_to ? new Date(e.valid_to).toISOString().slice(0, 10) : null });
export function makeCenterRepo(q: Q, ctx: Ctx): CenterRepo {
  const sel = 'id, code, name_en, name_he, is_active, contact_role, contact_channel, local_system_ref, feeds_regularly';
  const stal = async (centerId?: string): Promise<CenterStaleness[]> => {
    const r = await q.query(`
      SELECT s.source_center_id AS center_id, count(*)::int AS total, count(*) FILTER (WHERE s.availability = 'available')::int AS available,
             count(*) FILTER (WHERE v.staleness = 'stale')::int AS stale, count(*) FILTER (WHERE v.staleness = 'due_soon')::int AS due_soon,
             count(*) FILTER (WHERE s.ethics_approval_id IS NULL)::int AS no_ethics, max(s.updated_at) AS last_update,
             coalesce(max(v.sla_days), 180)::int AS sla_days,
             avg((s.quantity_class IS NOT NULL)::int)::float AS c_quantity, avg((s.ethics_approval_id IS NOT NULL)::int)::float AS c_ethics,
             avg((cardinality(s.attached_data) > 0)::int)::float AS c_attached
        FROM portal.samples s LEFT JOIN portal.v_sample_staleness v ON v.sample_id = s.id
       WHERE s.deleted_at IS NULL ${centerId ? 'AND s.source_center_id = $1' : ''} GROUP BY s.source_center_id`, centerId ? [centerId] : []);
    return r.rows.map((x) => ({ centerId: x.center_id, samplesTotal: x.total, samplesAvailable: x.available, staleCount: x.stale, dueSoonCount: x.due_soon, missingEthicsLink: x.no_ethics, slaDays: x.sla_days, lastUpdateAt: iso(x.last_update), completeness: { quantityClass: x.c_quantity, ethicsLink: x.c_ethics, attachedData: x.c_attached } }));
  };
  void ctx;
  return {
    async list() { return (await q.query(`SELECT ${sel} FROM portal.centers ORDER BY code`)).rows.map(centerOf); },
    async get(id) { const r = await q.query(`SELECT ${sel} FROM portal.centers WHERE id = $1`, [id]); return r.rows[0] ? centerOf(r.rows[0]) : null; },
    async byCode(code) { const r = await q.query(`SELECT ${sel} FROM portal.centers WHERE code = $1`, [code]); return r.rows[0] ? centerOf(r.rows[0]) : null; },
    async create(c) {
      const r = await q.query(`INSERT INTO portal.centers (id, code, name_en, name_he, is_active, contact_role, contact_channel, local_system_ref, feeds_regularly) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${sel}`,
        [c.id, c.code, c.nameEn, c.nameHe, c.isActive, c.contactRole, c.contactChannel, c.localSystemRef ?? null, c.feedsRegularly ?? false]);
      return centerOf(r.rows[0]);
    },
    async update(id, p) {
      const map: Record<string, string> = { code: 'code', nameEn: 'name_en', nameHe: 'name_he', isActive: 'is_active', contactRole: 'contact_role', contactChannel: 'contact_channel', localSystemRef: 'local_system_ref', feedsRegularly: 'feeds_regularly' };
      const sets: string[] = []; const params: unknown[] = [id];
      for (const [k, v] of Object.entries(p)) if (map[k] && v !== undefined) { params.push(v); sets.push(`${map[k]} = $${params.length}`); }
      if (!sets.length) return (await q.query(`SELECT ${sel} FROM portal.centers WHERE id = $1`, [id])).rows[0] ? centerOf((await q.query(`SELECT ${sel} FROM portal.centers WHERE id = $1`, [id])).rows[0]) : null;
      const r = await q.query(`UPDATE portal.centers SET ${sets.join(', ')} WHERE id = $1 RETURNING ${sel}`, params);
      return r.rows[0] ? centerOf(r.rows[0]) : null;
    },
    async staleness(centerId) {
      const [s] = await stal(centerId);
      if (s) return s;
      const c = await q.query('SELECT 1 FROM portal.centers WHERE id = $1', [centerId]);
      return c.rows[0] ? { centerId, samplesTotal: 0, samplesAvailable: 0, staleCount: 0, dueSoonCount: 0, missingEthicsLink: 0, slaDays: 180, lastUpdateAt: null, completeness: {} } : null;
    },
    stalenessAll: () => stal(),
    async ethicsList(centerId) {
      const r = await q.query(`SELECT id, center_id, approval_ref, kind::text AS kind, status::text AS status, valid_from, valid_to FROM portal.ethics_approvals ${centerId ? 'WHERE center_id = $1' : ''} ORDER BY approval_ref`, centerId ? [centerId] : []);
      return r.rows.map(ethOf);
    },
    async ethicsCreate(e) {
      const r = await q.query(`INSERT INTO portal.ethics_approvals (id, center_id, approval_ref, kind, valid_from, valid_to, created_by) VALUES ($1,$2,$3,$4::portal.ethics_kind,$5,$6,$7) RETURNING id, center_id, approval_ref, kind::text AS kind, status::text AS status, valid_from, valid_to`,
        [e.id, e.centerId, e.approvalRef, e.kind, e.validFrom, e.validTo, e.createdBy]);
      return ethOf(r.rows[0]);
    },
    async ethicsByRef(centerId, ref) {
      const r = await q.query(`SELECT id, center_id, approval_ref, kind::text AS kind, status::text AS status, valid_from, valid_to FROM portal.ethics_approvals WHERE center_id = $1 AND approval_ref = $2`, [centerId, ref]);
      return r.rows[0] ? ethOf(r.rows[0]) : null;
    },
  };
}
export type { Role };
