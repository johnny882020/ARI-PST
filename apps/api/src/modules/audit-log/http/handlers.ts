import type { Handler } from '../../../http/route.js';
import { body, query } from '../../../http/helpers.js';
import type { AuditService } from '../service.js';

export function auditHandlers(svc: AuditService): Record<string, Handler> {
  return {
    queryAuditEvents: async (req) => svc.query(req.ctx, query(req)),
    verifyAuditChain: async (req) => { const b = (body<{ fromSeq?: number; toSeq?: number } | undefined>(req)) ?? {}; return svc.verify(req.ctx, b.fromSeq, b.toSeq); },
  };
}
