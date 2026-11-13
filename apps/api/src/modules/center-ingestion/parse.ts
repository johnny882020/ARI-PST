// CSV and XLSX parsing for the import. No cell value ever leaves this module except into validators.
import ExcelJS from 'exceljs';
import { IMPORT_COLUMNS, IMPORT_MAX_ROWS } from '@ari/domain';

export interface ParsedFile { headers: string[]; rows: Array<Record<string, string>>; tooManyRows: boolean; hasFormula: boolean }

export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}
export function csvToFile(buf: Uint8Array): ParsedFile {
  const all = parseCsv(Buffer.from(buf).toString('utf8'));
  const headers = (all[0] ?? []).map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (const r of all.slice(1, IMPORT_MAX_ROWS + 2)) { const o: Record<string, string> = {}; headers.forEach((h, i) => { o[h.toLowerCase()] = r[i] ?? ''; }); rows.push(o); }
  return { headers, rows: rows.slice(0, IMPORT_MAX_ROWS), tooManyRows: rows.length > IMPORT_MAX_ROWS, hasFormula: false };
}
const HEBREW = /[֐-׿]/;
export async function xlsxToFile(buf: Uint8Array): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buf) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('samples') ?? wb.worksheets[0];
  if (!ws) return { headers: [], rows: [], tooManyRows: false, hasFormula: false };
  let hasFormula = false;
  const cellText = (v: ExcelJS.CellValue): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) { hasFormula = true; return ''; }
    if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
    if (typeof v === 'object' && 'text' in v) return String((v as { text: string }).text);
    return '\u0000NONTEXT';   // numbers, dates, booleans: month must be text (doc 05). Fails FORMAT/VOCAB downstream.
  };
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) vals.push(cellText(row.getCell(c).value));
    grid.push(vals);
  });
  const headers = (grid[0] ?? []).map((h) => h.trim());
  let start = 1;
  if (grid[1] && grid[1].some((v) => HEBREW.test(v)) && !grid[1].some((v, i) => /^(smp_|ctr_)/.test(v) || (headers[i] === 'sex' && ['female', 'male', 'other_or_unknown'].includes(v)))) start = 2;
  const rows: Array<Record<string, string>> = [];
  for (const r of grid.slice(start)) { const o: Record<string, string> = {}; headers.forEach((h, i) => { o[h.toLowerCase()] = r[i] ?? ''; }); rows.push(o); }
  return { headers, rows: rows.slice(0, IMPORT_MAX_ROWS), tooManyRows: rows.length > IMPORT_MAX_ROWS, hasFormula };
}
export function csvTemplate(): string { return IMPORT_COLUMNS.join(',') + '\n'; }
export async function xlsxTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('samples'); ws.addRow([...IMPORT_COLUMNS]);
  ws.getColumn(IMPORT_COLUMNS.indexOf('collection_month') + 1).numFmt = '@';
  const dict = wb.addWorksheet('dictionary');
  dict.addRow(['column', 'rule']);
  const rules: Record<string, string> = {
    sample_code: 'empty = create; filled = update', source_center_code: 'center code', diagnosis_source_value: 'source code mapped to portal diagnosis',
    age_band_at_diagnosis: '0_lt1 1_lt3 3_lt6 6_lt10 10_lt15 15_lt18', sex: 'female male other_or_unknown', sample_type: 'ffpe frozen csf plasma_or_liquid_biopsy isolated_dna_rna',
    availability: 'available limited depleted', quantity_class: 'small medium large', clinical_timepoint: 'diagnosis during_treatment relapse',
    collection_month: 'text YYYY-MM', attached_data: 'separator ; values wes wgs rna_seq mri digital_pathology redcap_clinical',
    consent_status: 'consent_obtained broad_consent waiver_by_committee restricted unknown', ethics_approval_ref: 'opaque approval id', verified: 'true or false',
  };
  for (const c of IMPORT_COLUMNS) dict.addRow([c, rules[c] ?? '']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
