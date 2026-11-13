import { DomainError } from '@ari/domain';
import type { Handler } from '../../../http/route.js';
import { body, idemKey, params, query } from '../../../http/helpers.js';
import type { IngestionService } from '../service.js';

export function ingestionHandlers(svc: IngestionService): Record<string, Handler> {
  const jid = (req: Parameters<Handler>[0]) => params<{ jobId: string }>(req).jobId;
  return {
    listImportJobs: async (req) => svc.list(req.ctx, query(req)),
    createImportJob: async (req, reply) => {
      const parts = (req as any).parts?.() as AsyncIterable<any> | undefined;
      if (!parts || !req.isMultipart()) throw new DomainError('IMPORT_FILE_INVALID');
      let data: Buffer | null = null; let name = ''; let centerId: string | null = null;
      for await (const p of parts) {
        if (p.type === 'file') { name = p.filename ?? ''; data = await p.toBuffer(); if (p.file.truncated) throw new DomainError('IMPORT_FILE_TOO_LARGE'); }
        else if (p.fieldname === 'centerId') centerId = String(p.value);
      }
      if (!data) throw new DomainError('IMPORT_FILE_INVALID');
      if (centerId && !/^ctr_[0-9A-HJKMNP-TV-Z]{26}$/.test(centerId)) throw new DomainError('VALIDATION_FAILED', [{ field: 'centerId', rule: 'FORMAT' }]);
      return reply.code(202).send(await svc.createDryRun(req.ctx, { fileName: name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100), data, centerId }, idemKey(req)));
    },
    getImportJob: async (req) => svc.get(req.ctx, jid(req)),
    listImportRows: async (req) => svc.rows(req.ctx, jid(req), query(req)),
    downloadImportReport: async (req, reply) => reply.type('text/csv').header('Content-Disposition', 'attachment; filename="import-report.csv"').send(await svc.report(req.ctx, jid(req))),
    downloadImportResultMap: async (req, reply) => reply.type('text/csv').header('Content-Disposition', 'attachment; filename="result-map.csv"').send(await svc.resultMap(req.ctx, jid(req))),
    commitImportJob: async (req, reply) => reply.code(202).send(await svc.commit(req.ctx, jid(req), body(req))),
    downloadImportTemplate: async (req, reply) => { const t = await svc.template(req.ctx, params<{ format: 'csv' | 'xlsx' }>(req).format); return reply.type(t.type).header('Content-Disposition', 'attachment; filename="import-template"').send(t.body); },
    getCenterStaleness: async (req) => svc.staleness(req.ctx, params<{ centerId: string }>(req).centerId),
    listStaleness: async (req) => ({ items: await svc.stalenessAll(req.ctx) }),
  };
}
