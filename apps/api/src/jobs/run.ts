// Shared job runner. Jobs log counts only (no identifiers) and exit non-zero on failure so the scheduler alerts.
import pg from 'pg';
import { roleUrl } from '../lib/db-url.js';
export async function runJob(name: string, urlVar: string, fn: (c: pg.Client) => Promise<Record<string, unknown>>): Promise<void> {
  // Explicit URL first; else built for app_readonly_bg from DB_HOST/DB_NAME/DB_PASSWORD_BG (Render). Break-glass has no derived URL.
  const url = process.env[urlVar] || (urlVar === 'DATABASE_URL_BREAKGLASS' ? undefined : roleUrl(process.env, 'app_readonly_bg', 'DATABASE_URL_BG'));
  if (!url) { console.error(JSON.stringify({ job: name, ok: false, error: `${urlVar} missing` })); process.exit(2); }
  const c = new pg.Client({ connectionString: url });
  const t0 = Date.now();
  try { await c.connect(); const res = await fn(c); console.log(JSON.stringify({ job: name, ok: true, ms: Date.now() - t0, ...res })); await c.end(); await heartbeat(name); }
  catch (e) { console.error(JSON.stringify({ job: name, ok: false, error: (e as { code?: string }).code ?? (e as Error).name })); try { await c.end(); } catch { /* ignore */ } process.exit(1); }
}

/** Optional outside monitor: HEARTBEAT_URL_<JOB> (e.g. HEARTBEAT_URL_AUDIT_VERIFY) is pinged after a successful run. Failures of the ping are ignored. */
async function heartbeat(name: string): Promise<void> {
  const url = process.env[`HEARTBEAT_URL_${name.toUpperCase().replace(/-/g, '_')}`];
  if (!url) return;
  try { await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) }); } catch { /* monitor is best effort */ }
}
