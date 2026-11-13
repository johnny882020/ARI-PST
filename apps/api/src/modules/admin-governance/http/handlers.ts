import type { Handler } from '../../../http/route.js';
import { body, params, query, sess } from '../../../http/helpers.js';
import type { AdminService } from '../service.js';

export function adminHandlers(svc: AdminService): Record<string, Handler> {
  const age = (req: Parameters<Handler>[0]) => Math.max(0, Math.floor((Date.now() - (sess(req).mfaAt ?? 0)) / 1000));
  return {
    listUsers: async (req) => svc.listUsers(req.ctx, query(req)),
    inviteUser: async (req, reply) => reply.code(201).send(await svc.invite(req.ctx, body(req))),
    getUser: async (req) => svc.getUser(req.ctx, params<{ userId: string }>(req).userId),
    updateUser: async (req) => svc.updateUser(req.ctx, params<{ userId: string }>(req).userId, body(req)),
    grantRole: async (req, reply) => reply.code(202).send((await svc.grantRole(req.ctx, params<{ userId: string }>(req).userId, body(req))).approval),
    revokeRole: async (req, reply) => { const p = params<{ userId: string; assignmentId: string }>(req); await svc.revokeRole(req.ctx, p.userId, p.assignmentId); return reply.code(204).send(); },
    createCenter: async (req, reply) => reply.code(201).send(await svc.createCenter(req.ctx, body(req))),
    updateCenter: async (req) => svc.updateCenter(req.ctx, params<{ centerId: string }>(req).centerId, body(req)),
    getGovernanceConfig: async (req) => svc.config(req.ctx),
    proposeKChange: async (req, reply) => reply.code(202).send(await svc.proposeK(req.ctx, body(req))),
    proposeCommitteeConfigChange: async (req, reply) => reply.code(202).send(await svc.proposeCommittee(req.ctx, body(req))),
    listApprovals: async (req) => ({ items: await svc.approvals(req.ctx) }),
    approveGovernanceChange: async (req) => svc.decide(req.ctx, params<{ approvalId: string }>(req).approvalId, body<{ approve: boolean }>(req).approve, Math.max(0, Math.floor((Date.now() - (sess(req).mfaAt ?? 0)) / 1000))),
    listKPolicies: async (req) => ({ items: await svc.kPolicies(req.ctx) }),
    proposeKPolicyChange: async (req, reply) => reply.code(202).send(await svc.proposeKPolicy(req.ctx, params<{ id: string }>(req).id, body(req))),
    approveKPolicyChange: async (req) => svc.approveKChange(req.ctx, params<{ id: string }>(req).id, age(req)),
    listRoleGrantRequests: async (req) => ({ items: await svc.roleGrants(req.ctx) }),
    createRoleGrantRequest: async (req, reply) => reply.code(202).send(await svc.createRoleGrant(req.ctx, body(req))),
    decideRoleGrantRequest: async (req) => svc.decideRoleGrant(req.ctx, params<{ id: string }>(req).id, body<{ outcome: 'approved' | 'rejected' }>(req).outcome, age(req)),
    getMetrics: async (req) => svc.metrics(req.ctx),
    listOutbox: async (req) => ({ items: await svc.outbox(req.ctx) }),
  };
}
