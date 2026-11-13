// Shared job runner. Jobs log counts only (no identifiers) and exit non-zero on failure so the scheduler alerts.
import pg from 'pg';
export async function runJob(name: string, urlVar: string, fn: (c: pg.Client) => Promise<Record<string, unknown>>): Promise<void> {
  const url = process.env[urlVar] ?? process.env.DATABASE_URL_BG;
  if (!url) { console.error(JSON.stringify({ job: name, ok: false, error: `${urlVar} missing` })); process.exit(2); }
  const c = new pg.Client({ connectionString: url });
  const t0 = Date.now();
  try { await c.connect(); const res = await fn(c); console.log(JSON.stringify({ job: name, ok: true, ms: Date.now() - t0, ...res })); await c.end(); }
  catch (e) { console.error(JSON.stringify({ job: name, ok: false, error: (e as { code?: string }).code ?? (e as Error).name })); try { await c.end(); } catch { /* ignore */ } process.exit(1); }
}
