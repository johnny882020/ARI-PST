import { createHash } from 'node:crypto';
import {
  DomainError, IMPORT_MAX_BYTES, crossRowChecks, rejectionReportCsv, resultMapCsv, validateHeader, validateImportRow,
  type Clock, type Ctx, type ImportIssue, type ImportLookups, type ObjectStorePort, type Repository, type ValidatedRow, type Tx,
} from '@ari/domain';
import { nid, notFound } from '../../lib/util.js';
import { csvToFile, csvTemplate, xlsxTemplate, xlsxToFile, type ParsedFile } from './parse.js';

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export class IngestionService {
  constructor(private repo: Repository, private store: ObjectStorePort, private clock: Clock) {}

  private detect(name: string, buf: Uint8Array): 'csv' | 'xlsx' {
    const lower = name.toLowerCase();
    const zip = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;
    if (lower.endsWith('.xlsx') && zip) return 'xlsx';
    if (lower.endsWith('.csv') && !zip && !buf.slice(0, 2000).includes(0)) return 'csv';
    throw new DomainError('IMPORT_FILE_INVALID');
  }
  private async parse(format: 'csv' | 'xlsx', buf: Uint8Array): Promise<ParsedFile> {
    try { return format === 'csv' ? csvToFile(buf) : await xlsxToFile(buf); } catch { throw new DomainError('IMPORT_FILE_INVALID'); }
  }
  private async lookups(tx: Tx, ctx: Ctx, file: ParsedFile, allowedCenterId: string | null, strict = false): Promise<ImportLookups> {
    const centers = await tx.centers.list();
    const byCode = new Map(centers.map((c) => [c.code, { id: c.id }]));
    const eth = await tx.centers.ethicsList(undefined);
    const dxVals = [...new Set(file.rows.map((r) => (r.diagnosis_source_value ?? '').trim()).filter(Boolean))];
    const dxMap = new Map<string, string | null>();
    for (const v of dxVals) if (v.length <= 64) dxMap.set(v, await tx.samples.mapDiagnosis(v));
    const codes = [...new Set(file.rows.map((r) => (r.sample_code ?? '').trim()).filter((c) => /^smp_[0-9A-HJKMNP-TV-Z]{26}$/.test(c)))];
    const existing = new Map<string, { centerId: string }>();
    for (const c of codes) { const s = await tx.samples.get(c); if (s) existing.set(c, { centerId: s.sample.sourceCenterId }); }
    void ctx;
    return {
      centerByCode: (code) => byCode.get(code) ?? null, mapDiagnosis: (v) => dxMap.get(v) ?? null,
      ethics: (centerId, ref) => { const e = eth.find((x) => x.centerId === centerId && x.approvalRef === ref); return e ? { id: e.id, status: e.status } : null; },
      existingSample: (c) => existing.get(c) ?? null, allowedCenterId, strict,
    };
  }
  private validateAll(file: ParsedFile, lk: ImportLookups): { rows: ValidatedRow[]; headerIssues: ImportIssue[] } {
    const headerIssues = validateHeader(file.headers);
    if (file.hasFormula) headerIssues.push({ field: 'file', rule: 'FORMAT', severity: 'error' });
    if (headerIssues.length) return { rows: [], headerIssues };
    const rows = file.rows.map((r, i) => validateImportRow(i + 1, r, lk));
    crossRowChecks(rows);
    return { rows, headerIssues };
  }

  async createDryRun(ctx: Ctx, f: { fileName: string; data: Uint8Array; centerId?: string | null }, idemKey: string | null) {
    if (f.data.length > IMPORT_MAX_BYTES) throw new DomainError('IMPORT_FILE_TOO_LARGE');
    if (f.data.length === 0 || !/^[A-Za-z0-9._-]{1,100}$/.test(f.fileName)) throw new DomainError('IMPORT_FILE_INVALID');
    const format = this.detect(f.fileName, f.data);
    const file = await this.parse(format, f.data);
    if (file.tooManyRows) throw new DomainError('IMPORT_FILE_INVALID');
    const jobId = nid(this.clock, 'import'); const key = `imports/${jobId}`; const hash = sha(f.data);
    void idemKey;
    await this.store.put(key, f.data, format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return this.repo.tx(ctx, async (tx) => {
      const lk = await this.lookups(tx, ctx, file, f.centerId ?? null);
      await tx.imports.createJob({ id: jobId, createdBy: ctx.actor.userId!, centerId: f.centerId ?? null, mode: 'dry_run', format, fileName: f.fileName, stagingKey: key, fileSha256: hash });
      const { rows, headerIssues } = this.validateAll(file, lk);
      if (headerIssues.length) {
        await tx.imports.saveRows(jobId, [{ rowNo: 1, outcome: 'rejected', action: 'none', sampleCode: null, issues: headerIssues }]);
        await tx.imports.finishJob(jobId, { status: 'rejected', total: 0, accepted: 0, warnings: 0, rejected: 1 });
      } else {
        await tx.imports.saveRows(jobId, rows.map((r) => r.row));
        const c = { accepted: 0, warnings: 0, rejected: 0 };
        for (const r of rows) c[r.row.outcome === 'accepted' ? 'accepted' : r.row.outcome === 'warning' ? 'warnings' : 'rejected']++;
        await tx.imports.finishJob(jobId, { status: c.rejected === rows.length && rows.length > 0 ? 'rejected' : 'validated', total: rows.length, ...c });
      }
      await tx.audit.record(ctx, { action: 'import.upload', outcome: 'success', objectType: 'import_job', objectId: jobId, details: { format, rows: file.rows.length } });
      if (headerIssues.length) await tx.audit.record(ctx, { action: 'import.reject', outcome: 'success', objectType: 'import_job', objectId: jobId, details: { reason: 'header' } });
      return (await tx.imports.getJob(jobId))!;
    });
  }
  async commit(ctx: Ctx, parentId: string, b: { fileSha256: string; acceptWarnings?: boolean }) {
    return this.repo.tx(ctx, async (tx) => {
      const parent = await tx.imports.getJob(parentId); if (!parent) throw notFound();
      if (parent.mode !== 'dry_run' || parent.status !== 'validated') throw new DomainError('CONFLICT');
      if (!parent.fileSha256 || parent.fileSha256 !== b.fileSha256) throw new DomainError('IMPORT_HASH_MISMATCH');
      if ((parent.rejectedRows ?? 0) > 0) throw new DomainError('IMPORT_FILE_INVALID');
      if ((parent.warningRows ?? 0) > 0 && !b.acceptWarnings) throw new DomainError('VALIDATION_FAILED', [{ field: 'acceptWarnings', rule: 'REQUIRED' }]);
      const buf = parent.stagingKey ? await this.store.get(parent.stagingKey) : null;
      if (!buf || sha(buf) !== parent.fileSha256) throw new DomainError('IMPORT_HASH_MISMATCH');
      const file = await this.parse(parent.format, buf);
      const lk = await this.lookups(tx, ctx, file, parent.centerId);
      const { rows, headerIssues } = this.validateAll(file, lk);       // re-validate: reference data may have changed
      if (headerIssues.length || rows.some((r) => r.row.outcome === 'rejected')) throw new DomainError('IMPORT_FILE_INVALID');
      const jobId = nid(this.clock, 'import');
      await tx.imports.createJob({ id: jobId, createdBy: ctx.actor.userId!, centerId: parent.centerId, mode: 'commit', format: parent.format, fileName: 'commit', stagingKey: parent.stagingKey!, fileSha256: parent.fileSha256, parentJobId: parent.id });
      const created: Array<{ rowNo: number; sampleCode: string }> = [];
      for (const r of rows) {
        if (r.create) {
          const id = nid(this.clock, 'sample');
          await tx.samples.insert(id, r.create, ctx.actor.userId!, 'csv_import');
          if (r.verify) await tx.samples.verify(id);
          r.row.sampleCode = id; created.push({ rowNo: r.row.rowNo, sampleCode: id });
        } else if (r.update) {
          const upd = await tx.samples.update(r.update.code, r.update.patch, null);
          if (!upd || upd === 'etag_mismatch') throw new DomainError('CONFLICT');
          if (r.verify) await tx.samples.verify(r.update.code);
        } else if (r.verify && r.row.sampleCode) await tx.samples.verify(r.row.sampleCode);
      }
      await tx.imports.saveRows(jobId, rows.map((r) => r.row));
      await tx.imports.finishJob(jobId, { status: 'committed', total: rows.length, accepted: rows.filter((r) => r.row.outcome === 'accepted').length, warnings: rows.filter((r) => r.row.outcome === 'warning').length, rejected: 0 });
      await this.store.put(`imports/${jobId}.result-map.csv`, Buffer.from(resultMapCsv(created)), 'text/csv');
      await tx.audit.record(ctx, { action: 'import.commit', outcome: 'success', objectType: 'import_job', objectId: jobId, details: { created: created.length, rows: rows.length } });
      return (await tx.imports.getJob(jobId))!;
    });
  }
  list(ctx: Ctx, q: { cursor?: string; limit?: number }) { return this.repo.tx(ctx, (tx) => tx.imports.listJobs({ ...q, limit: q.limit ?? 25 })); }
  get(ctx: Ctx, id: string) { return this.repo.tx(ctx, async (tx) => { const j = await tx.imports.getJob(id); if (!j) throw notFound(); return j; }); }
  rows(ctx: Ctx, id: string, q: { outcome?: string; cursor?: string; limit?: number }) {
    return this.repo.tx(ctx, async (tx) => { if (!(await tx.imports.getJob(id))) throw notFound(); return tx.imports.listRows(id, { ...q, limit: q.limit ?? 50 }); });
  }
  async report(ctx: Ctx, id: string): Promise<string> {
    return this.repo.tx(ctx, async (tx) => {
      if (!(await tx.imports.getJob(id))) throw notFound();
      const rows = await tx.imports.allRows(id);
      await tx.audit.record(ctx, { action: 'export.download', outcome: 'success', objectType: 'import_report', objectId: id });
      return rejectionReportCsv(rows);
    });
  }
  async resultMap(ctx: Ctx, id: string): Promise<string> {
    return this.repo.tx(ctx, async (tx) => {
      const j = await tx.imports.getJob(id); if (!j || j.mode !== 'commit') throw notFound();
      const b = await this.store.get(`imports/${id}.result-map.csv`); if (!b) throw notFound();
      await tx.audit.record(ctx, { action: 'export.download', outcome: 'success', objectType: 'import_result_map', objectId: id });
      return Buffer.from(b).toString('utf8');
    });
  }
  async template(ctx: Ctx, format: 'csv' | 'xlsx'): Promise<{ body: Buffer | string; type: string }> {
    void ctx;
    return format === 'csv' ? { body: csvTemplate(), type: 'text/csv' } : { body: await xlsxTemplate(), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  // ----- staleness -----
  staleness(ctx: Ctx, centerId: string) {
    const target = ctx.actor.role === 'center_clinician' ? ctx.actor.centerId : centerId;
    if (ctx.actor.role === 'center_clinician' && centerId !== ctx.actor.centerId) throw notFound();
    return this.repo.tx(ctx, async (tx) => { const s = await tx.centers.staleness(target!); if (!s) throw notFound(); return s; });
  }
  stalenessAll(ctx: Ctx) { return this.repo.tx(ctx, (tx) => tx.centers.stalenessAll()); }
}
