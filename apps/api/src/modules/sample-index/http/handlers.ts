import { DomainError } from '@ari/domain';
import type { Handler } from '../../../http/route.js';
import { body, params, query } from '../../../http/helpers.js';
import { etagOf } from '../../../lib/util.js';
import type { SampleService } from '../service.js';

export function sampleHandlers(svc: SampleService): Record<string, Handler> {
  return {
    listSamples: async (req) => svc.list(req.ctx, query(req)),
    createSample: async (req, reply) => { const r = await svc.create(req.ctx, body(req)); reply.header('ETag', etagOf(r.updatedAt)); return reply.code(201).send(r); },
    getSample: async (req, reply) => { const r = await svc.get(req.ctx, params<{ sampleId: string }>(req).sampleId); reply.header('ETag', r.etag); return r.sample; },
    updateSample: async (req, reply) => {
      const m = req.headers['if-match']; if (typeof m !== 'string') throw new DomainError('VALIDATION_FAILED', [{ field: 'If-Match', rule: 'REQUIRED' }]);
      const r = await svc.update(req.ctx, params<{ sampleId: string }>(req).sampleId, body(req), m); reply.header('ETag', r.etag); return r.sample;
    },
    verifySample: async (req) => svc.verify(req.ctx, params<{ sampleId: string }>(req).sampleId),
    flagSample: async (req, reply) => { await svc.flag(req.ctx, params<{ sampleId: string }>(req).sampleId, body<{ reasonCode: string }>(req).reasonCode); return reply.code(204).send(); },
    retireSample: async (req, reply) => { await svc.retire(req.ctx, params<{ sampleId: string }>(req).sampleId); return reply.code(204).send(); },
    listCenters: async (req) => ({ items: (await svc.listCenters(req.ctx)).map(({ localSystemRef: _l, ...c }) => c) }),
    getCenter: async (req) => { const { localSystemRef: _l, ...c } = await svc.getCenter(req.ctx, params<{ centerId: string }>(req).centerId); return c; },
    listEthicsApprovals: async (req) => ({ items: await svc.listEthics(req.ctx, query<{ centerId?: string }>(req).centerId) }),
    createEthicsApproval: async (req, reply) => reply.code(201).send(await svc.createEthics(req.ctx, body(req))),
  };
}
