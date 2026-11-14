// Contract-driven route registration. Every operation in openapi.yaml must be registered exactly once.
// Authorization comes from the one role-capability table in packages/domain (decision RT-07).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ANON_ACTOR, AUTHENTICATED_ROLES, DomainError, OPERATION_ACCESS, evaluateSession, stepUpFresh, type Actor, type Ctx, type Role,
} from '@ari/domain';
import type { Deps } from './deps.js';
import { toFieldIssues } from './openapi.js';
import { HttpProblem } from './problem.js';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: Ctx;
    session: import('@ari/domain').SessionRecord | null;
    opId: string;
    ipHashValue: string | null;
  }
}
export type ApiRequest = FastifyRequest;
export type Handler = (req: ApiRequest, reply: FastifyReply) => Promise<unknown> | unknown;

const PRIORITY: Role[] = ['system_admin', 'national_coordinator', 'committee_member', 'center_clinician', 'researcher_il', 'researcher_intl'];
/** Operations that need a second factor no older than 5 minutes (decision C-02, doc 05 step-up). */
export const STEP_UP_OPS = new Set([
  'grantRole', 'revokeRole', 'proposeKChange', 'proposeCommitteeConfigChange', 'approveGovernanceChange', 'castVote', 'recordDecision',
  'createCenter', 'decideRegistration', 'verifyAuditChain', 'proposeKPolicyChange', 'approveKPolicyChange', 'createRoleGrantRequest', 'decideRoleGrantRequest',
]);

export const ENROLLMENT_OPS = new Set(['enrollTotpStart', 'enrollTotpConfirm', 'webauthnRegisterOptions', 'webauthnRegisterVerify', 'logout', 'getMe', 'getSessionInfo', 'getAuthSession']);
export function pickRole(held: readonly Role[], allowed: readonly Role[]): Role | null {
  for (const r of PRIORITY) if (held.includes(r) && allowed.includes(r)) return r;
  return null;
}
export function actorFromSession(sess: NonNullable<ApiRequest['session']>, role: Role): Actor {
  const roles = [...new Set(sess.roles.map((r) => r.role))];
  const centerId = role === 'center_clinician' ? (sess.roles.find((r) => r.role === 'center_clinician')?.centerId ?? null) : null;
  return { userId: sess.userId, role, roles, centerId, sessionId: sess.id };
}

export function registerContractRoutes(app: FastifyInstance, deps: Deps, handlers: Record<string, Handler>): void {
  const { contract } = deps;
  const known = new Set(contract.operations.map((o) => o.operationId));
  const missing = [...known].filter((id) => !handlers[id]);
  const extra = Object.keys(handlers).filter((id) => !known.has(id));
  if (missing.length || extra.length) throw new Error(`contract/handler mismatch. missing=[${missing.join(',')}] extra=[${extra.join(',')}]`);

  for (const op of contract.operations) {
    const access = OPERATION_ACCESS[op.operationId];
    if (access === undefined) throw new Error(`no access entry for ${op.operationId}`);
    const handler = handlers[op.operationId]!;
    const url = op.fullPath.replace(/\{(\w+)\}/g, ':$1');
    const bodySchema = op.op.requestBody?.content?.['application/json']?.schema ?? op.op.requestBody?.content?.['application/merge-patch+json']?.schema ?? null;
    const bodyRequired = Boolean(op.op.requestBody?.required);
    const isMultipart = Boolean(op.op.requestBody?.content?.['multipart/form-data']);
    const queryParams: Array<{ name: string; required?: boolean; schema: any }> = (op.op.parameters ?? [])
      .map((p: any) => (p.$ref ? contract.doc.components.parameters[p.$ref.split('/').pop()] : p))
      .filter((p: any) => p.in === 'query');

    app.route({
      method: op.method as 'GET', url, config: { operationId: op.operationId },
      preHandler: async (req, reply) => {
        req.opId = op.operationId;
        // ---- authentication and authorization ----
        const sess = req.session;
        if (access === 'public') {
          if (sess) {
            const held = sess.roles.map((r) => r.role);
            const role = pickRole(held, AUTHENTICATED_ROLES);
            req.ctx = { actor: role ? actorFromSession(sess, role) : ANON_ACTOR, traceId: req.id, ipHash: req.ipHashValue };
          } else req.ctx = { actor: ANON_ACTOR, traceId: req.id, ipHash: req.ipHashValue };
        } else {
          if (!sess) throw new HttpProblem('UNAUTHENTICATED');
          const allowed = access === 'auth' ? AUTHENTICATED_ROLES : access;
          const held = sess.roles.map((r) => r.role);
          const role = pickRole(held, allowed);
          if (!role) {
            const prelim: Ctx = { actor: actorFromSession(sess, pickRole(held, AUTHENTICATED_ROLES) ?? 'researcher_il'), traceId: req.id, ipHash: req.ipHashValue };
            req.ctx = prelim;
            await deps.repo.auditStandalone(prelim, { action: 'authz.deny', outcome: 'denied', objectType: 'operation', objectId: null, details: { operation: op.operationId, method: op.method } });
            throw new HttpProblem('FORBIDDEN');
          }
          req.ctx = { actor: actorFromSession(sess, role), traceId: req.id, ipHash: req.ipHashValue };
          if (sess.mfaAt === null && !ENROLLMENT_OPS.has(op.operationId)) throw new HttpProblem('STEP_UP_REQUIRED');   // enrolment-only session
          if (STEP_UP_OPS.has(op.operationId) && !stepUpFresh(sess.mfaAt, deps.clock.now().getTime())) throw new HttpProblem('STEP_UP_REQUIRED');
        }
        // ---- query validation ----
        const q = req.query as Record<string, unknown>;
        const issues = [];
        for (const p of queryParams) {
          let v = q[p.name];
          if (v === undefined) { if (p.required) issues.push({ field: p.name, rule: 'REQUIRED' }); continue; }
          const t = p.schema?.type ?? (p.schema?.$ref ? undefined : undefined);
          if (t === 'integer' && typeof v === 'string' && /^-?\d+$/.test(v)) { v = Number(v); q[p.name] = v; }
          const errs = contract.validateAgainst(p.schema, v);
          if (errs) issues.push(...toFieldIssues(errs).map((e) => ({ field: p.name, rule: e.rule })));
        }
        if (issues.length) throw new DomainError('VALIDATION_FAILED', issues);
        // ---- body validation ----
        if (bodySchema && !isMultipart) {
          if (req.body === undefined || req.body === null) { if (bodyRequired) throw new DomainError('VALIDATION_FAILED', [{ field: '$', rule: 'REQUIRED' }]); }
          else {
            const errs = contract.validateAgainst(bodySchema, req.body);
            if (errs) throw new DomainError('VALIDATION_FAILED', toFieldIssues(errs));
          }
        }
        void reply;
      },
      handler: async (req, reply) => handler(req, reply),
    });
  }
}
export function sessionOrThrow(req: ApiRequest): NonNullable<ApiRequest['session']> {
  if (!req.session) throw new HttpProblem('UNAUTHENTICATED');
  return req.session;
}
export { evaluateSession };
