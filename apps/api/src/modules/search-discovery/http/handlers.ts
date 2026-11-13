import type { Handler } from '../../../http/route.js';
import { body, query } from '../../../http/helpers.js';
import type { SearchService } from '../service.js';

export function searchHandlers(svc: SearchService): Record<string, Handler> {
  return {
    searchAggregate: async (req) => svc.aggregate(req.ctx, body(req)),
    searchFacets: async (req) => svc.facets(req.ctx, body(req)),
    suggestTerms: async (req) => ({ items: await svc.suggest(req.ctx, query<{ q: string }>(req).q) }),
    listDiagnoses: async (req) => ({ items: await svc.diagnoses(req.ctx) }),
  };
}
