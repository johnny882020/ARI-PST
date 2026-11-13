import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { startHarness, type Harness, type Session } from './support/harness.js';
import { buildFixture, type Fixture } from './support/fixture.js';

let h: Harness; let f: Fixture; let co: Session;
beforeAll(async () => { h = await startHarness(); f = await buildFixture(h); co = await h.session(f.coord); });
afterAll(async () => { await h.close(); });

const HEADER = 'source_center_code,diagnosis_source_value,age_band_at_diagnosis,sex,sample_type,availability,clinical_timepoint,collection_month,attached_data,verified';
const good = (n = 1) => Array.from({ length: n }, (_, i) => `syn_a,mb_shh,${['0_lt1', '1_lt3', '3_lt6'][i % 3]},female,ffpe,available,diagnosis,2024-0${(i % 9) + 1},wes;mri,true`);
function multipart(name: string, content: Buffer | string, field = 'file') {
  const b = '----ariboundary7e3';
  const head = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  return { raw: Buffer.concat([head, Buffer.from(content), Buffer.from(`\r\n--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}
const upload = (name: string, content: Buffer | string) => h.call(co, 'POST', '/api/v1/import-jobs', { ...multipart(name, content), headers: { ...multipart(name, content).headers, 'idempotency-key': 'import-key-0001' } });

describe('CSV/XLSX import: dry run, value-free report, commit', () => {
  it('dry run writes nothing, commit creates the samples once', async () => {
    const csv = [HEADER, ...good(3)].join('\n');
    const before = await h.admin.query('SELECT count(*)::int n FROM portal.samples');
    const up = await upload('batch.csv', csv);
    expect(up.status, up.body).toBe(202); expect(up.json.status).toBe('validated'); expect(up.json.warningRows).toBe(3); expect(up.json.mode).toBe('dry_run');
    expect((await h.admin.query('SELECT count(*)::int n FROM portal.samples')).rows[0].n).toBe(before.rows[0].n);   // nothing written in a dry run
    const sha = createHash('sha256').update(csv).digest('hex');
    expect((await h.call(co, 'POST', `/api/v1/import-jobs/${up.json.id}/commit`, { body: { fileSha256: 'a'.repeat(64) } })).status).toBe(409);
    expect((await h.call(co, 'POST', `/api/v1/import-jobs/${up.json.id}/commit`, { body: { fileSha256: sha } })).status).toBe(422);   // warnings (ethics ref missing) need acceptWarnings
    const c = await h.call(co, 'POST', `/api/v1/import-jobs/${up.json.id}/commit`, { body: { fileSha256: sha, acceptWarnings: true } });
    expect(c.status, c.body).toBe(202); expect(c.json.status).toBe('committed'); expect(c.json.mode).toBe('commit');
    expect((await h.admin.query('SELECT count(*)::int n FROM portal.samples')).rows[0].n).toBe(before.rows[0].n + 3);
    expect((await h.call(co, 'POST', `/api/v1/import-jobs/${up.json.id}/commit`, { body: { fileSha256: sha, acceptWarnings: true } })).status).toBe(409);   // no double commit
    const map = await h.call(co, 'GET', `/api/v1/import-jobs/${c.json.id}/result-map`); expect(map.status, map.body).toBe(200); expect(map.body.split('\n')[0]).toBe('row_no,sample_code'); expect(map.body).toMatch(/smp_/);
    const rows = await h.call(co, 'GET', `/api/v1/import-jobs/${up.json.id}/rows`); expect(rows.status).toBe(200); expect(rows.json.items).toHaveLength(3);
  });
  it('rejects identifier-shaped cells, never echoes values, and refuses to commit a file with errors', async () => {
    const csv = [HEADER, ...good(1), 'syn_a,mb_shh,0_lt1,female,ffpe,available,diagnosis,2024-01,wes,true'.replace('wes', 'wes').replace('2024-01', '2024-01') + '', 'syn_a,123456789,3_lt6,male,ffpe,available,diagnosis,15/03/2024,wes,true'].join('\n');
    const up = await upload('bad.csv', csv);
    expect(up.status, up.body).toBe(202); expect(up.json.rejectedRows).toBe(1);
    const rep = await h.call(co, 'GET', `/api/v1/import-jobs/${up.json.id}/report`);
    expect(rep.status).toBe(200); expect(rep.body).toContain('IDENTIFIER_SUSPECTED');
    expect(rep.body).not.toContain('123456789'); expect(rep.body).not.toContain('15/03/2024');
    expect(rep.body.split('\n')[0]).toBe('row_no,outcome,field,rule,severity');
    const c = await h.call(co, 'POST', `/api/v1/import-jobs/${up.json.id}/commit`, { body: { fileSha256: createHash('sha256').update(csv).digest('hex') } });
    expect(c.status).toBe(422);
  });
  it('unknown columns reject the whole file (patient name, MRN, local id)', async () => {
    const up = await upload('cols.csv', `${HEADER},mrn\n${good(1)[0]},00112233`);
    expect(up.json.status).toBe('rejected');
    const rows = await h.call(co, 'GET', `/api/v1/import-jobs/${up.json.id}/rows`);
    expect(JSON.stringify(rows.json)).toContain('UNKNOWN_COLUMN'); expect(JSON.stringify(rows.json)).not.toContain('00112233'); expect(JSON.stringify(rows.json)).not.toContain('mrn');
  });
  it('xlsx works; numeric month cells and formulas are rejected', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('samples');
    ws.addRow(HEADER.split(',')); ws.addRow(['syn_a', 'mb_shh', '3_lt6', 'male', 'frozen', 'limited', 'relapse', '2023-11', 'rna_seq', 'false']);
    const ok = await upload('batch.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
    expect(ok.status, ok.body).toBe(202); expect(ok.json.format).toBe('xlsx'); expect(ok.json.warningRows).toBe(1);
    const wb2 = new ExcelJS.Workbook(); const ws2 = wb2.addWorksheet('samples');
    ws2.addRow(HEADER.split(',')); ws2.addRow(['syn_a', 'mb_shh', '3_lt6', 'male', 'frozen', 'limited', 'relapse', new Date(Date.UTC(2023, 10, 1)), 'rna_seq', 'false']);
    const bad = await upload('date.xlsx', Buffer.from(await wb2.xlsx.writeBuffer())); expect(bad.json.rejectedRows).toBe(1);
    const wb3 = new ExcelJS.Workbook(); const ws3 = wb3.addWorksheet('samples');
    ws3.addRow(HEADER.split(',')); ws3.addRow(['syn_a', 'mb_shh', '3_lt6', 'male', 'frozen', 'limited', 'relapse', { formula: '"2023-"&"11"' }, 'rna_seq', 'false']);
    expect((await upload('f.xlsx', Buffer.from(await wb3.xlsx.writeBuffer()))).json.status).toBe('rejected');
  });
  it('size, type and role checks', async () => {
    expect((await upload('x.csv', Buffer.alloc(11 * 1024 * 1024, 97))).status).toBe(413);
    expect((await upload('x.exe', 'MZ')).status).toBe(422);
    expect((await upload('x.csv', Buffer.from([0, 1, 2, 3]))).status).toBe(422);
    const res = await h.session(f.resIl); expect((await h.call(res, 'GET', '/api/v1/import-jobs')).status).toBe(403);
    const clin = await h.session(f.clinA); expect((await h.call(clin, 'POST', '/api/v1/import-jobs', multipart('a.csv', HEADER))).status).toBe(403);
    expect((await h.call(co, 'GET', '/api/v1/import-templates/csv')).body.startsWith('sample_code,')).toBe(true);
    const xt = await h.call(co, 'GET', '/api/v1/import-templates/xlsx'); expect(xt.status, xt.headers['x-debug-error'] as string).toBe(200);
  });
});
