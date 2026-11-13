import type { Handler } from '../../../http/route.js';
import type { Health } from '../index.js';
export function healthHandlers(h: Health): Record<string, Handler> {
  return {
    livez: async () => h.livez(),
    readyz: async (_req, reply) => { const r = await h.readyz(); return reply.code(r.code).send(r.body); },
  };
}
