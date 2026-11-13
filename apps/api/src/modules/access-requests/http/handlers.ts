import type { Handler } from '../../../http/route.js';
import { body, idemKey, params, query } from '../../../http/helpers.js';
import type { RequestService } from '../service.js';

export function requestHandlers(svc: RequestService): Record<string, Handler> {
  const rid = (req: Parameters<Handler>[0]) => params<{ requestId: string }>(req).requestId;
  return {
    getRequestCart: async (req) => svc.getCart(req.ctx),
    addCartItem: async (req, reply) => reply.code(201).send(await svc.addCartItem(req.ctx, body(req))),
    removeCartItem: async (req) => svc.removeCartItem(req.ctx, params<{ itemId: string }>(req).itemId),
    startRequestFromCart: async (req, reply) => reply.code(201).send(await svc.startFromCart(req.ctx)),
    precheckRequest: async (req) => svc.precheck(req.ctx, rid(req), body(req)),
    respondToInfoRequest: async (req) => svc.respond(req.ctx, rid(req), body<{ message: string }>(req).message),
    getVoteTally: async (req) => svc.voteTally(req.ctx, rid(req)),
    listRequests: async (req) => svc.list(req.ctx, query(req)),
    createRequest: async (req, reply) => { const r = await svc.create(req.ctx, body(req), idemKey(req)); return reply.code(r.replay ? 200 : 201).send(r.request); },
    getRequest: async (req) => svc.get(req.ctx, rid(req)),
    updateRequestDraft: async (req) => svc.updateDraft(req.ctx, rid(req), body(req)),
    addRequestItem: async (req, reply) => reply.code(201).send(await svc.addItem(req.ctx, rid(req), body(req))),
    removeRequestItem: async (req, reply) => { await svc.removeItem(req.ctx, rid(req), params<{ itemId: string }>(req).itemId); return reply.code(204).send(); },
    submitRequest: async (req) => svc.submit(req.ctx, rid(req), idemKey(req)),
    transitionRequest: async (req) => { const b = body<{ to: any; closeReason?: any; reasonCode?: string; publicNote?: string; checklist?: Record<string, boolean> }>(req); return svc.transition(req.ctx, rid(req), b.to, b.closeReason, { ...(b.reasonCode ? { reasonCode: b.reasonCode } : {}), ...(b.publicNote ? { note: b.publicNote } : {}), ...(b.checklist ? { checklist: b.checklist } : {}) }); },
    listRequestSteps: async (req) => ({ items: await svc.steps(req.ctx, rid(req)) }),
    updateRequestStep: async (req) => svc.updateStep(req.ctx, rid(req), params<{ stepKey: any }>(req).stepKey, body(req)),
    resolveRequestSamples: async (req, reply) => { const b = body<{ itemId: string; sampleIds: string[] }>(req); await svc.resolveSamples(req.ctx, rid(req), b.itemId, b.sampleIds); return reply.code(204).send(); },
    castVote: async (req) => svc.castVote(req.ctx, rid(req), body(req)),
    listVotes: async (req) => ({ items: (await svc.listVotes(req.ctx, rid(req))).map(({ voterUserId: _v, ...v }) => v) }),
    listDecisions: async (req) => ({ items: await svc.decisions(req.ctx, rid(req)) }),
    recordDecision: async (req, reply) => reply.code(201).send(await svc.recordDecision(req.ctx, rid(req), body(req))),
  };
}
