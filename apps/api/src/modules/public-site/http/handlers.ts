import type { Handler } from '../../../http/route.js';
import { body, params } from '../../../http/helpers.js';
import type { PublicService } from '../service.js';
import type { Counters } from '../../observability/index.js';

export function publicHandlers(svc: PublicService, counters: Counters): Record<string, Handler> {
  return {
    submitPublicForm: async (req, reply) => { await svc.submitForm(params<{ form: 'join' | 'contact' }>(req).form, body(req), req.id); return reply.code(202).send({ accepted: true }); },
    reportClientError: async (req, reply) => { const b = body<{ name: string; route: string; version: string; traceId?: string }>(req); counters.inc('client_error'); req.log.warn({ name: b.name, route: b.route, version: b.version, clientTrace: b.traceId }, 'client error'); return reply.code(204).send(); },
    reportCsp: async (req, reply) => {
      counters.inc('csp_report');
      const r = (body<any>(req)?.['csp-report'] ?? body<any>(req)) as Record<string, unknown>;
      const strip = (v: unknown) => (typeof v === 'string' ? v.split(/[?#]/)[0]!.slice(0, 120) : undefined);
      req.log.warn({ directive: strip(r?.['violated-directive'] ?? r?.effectiveDirective), blocked: strip(r?.['blocked-uri'] ?? r?.blockedURL) }, 'csp violation');
      return reply.code(204).send();
    },
  };
}
