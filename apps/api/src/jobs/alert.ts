// Failure alert for the scheduled jobs (KNOWN-ISSUES L-4). ALERT_WEBHOOK_URL, when set, gets one small JSON POST per failed run:
//   { "job": "<name>", "ok": false, "error": "<error name or code>", "at": "<ISO 8601 UTC>" }
// Nothing else: no message text, no row values, no identifiers. The POST times out after 5 seconds, and a failed POST never
// changes the job's result or crashes it (the alert is best effort; the job still exits non-zero).
export const ALERT_TIMEOUT_MS = 5000;
export interface FailureAlert { job: string; ok: false; error: string; at: string }

/** Error names and database codes only (e.g. "TypeError", "42501"). Anything else becomes "Error", so no free text can leak. */
export function safeErrorName(e: unknown): string {
  const v = (e as { code?: unknown })?.code ?? (e as { name?: unknown })?.name;
  return typeof v === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(v) ? v : 'Error';
}
const safeJob = (name: string): string => (/^[a-z0-9-]{1,40}$/.test(name) ? name : 'job');

export function failureAlert(job: string, error: string, now: Date = new Date()): FailureAlert {
  return { job: safeJob(job), ok: false, error: /^[A-Za-z0-9_]{1,64}$/.test(error) ? error : 'Error', at: now.toISOString() };
}

/** Posts the alert when ALERT_WEBHOOK_URL is set. Resolves to true when the webhook answered 2xx. Never throws. */
export async function sendFailureAlert(job: string, error: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch, timeoutMs = ALERT_TIMEOUT_MS): Promise<boolean> {
  const url = env.ALERT_WEBHOOK_URL?.trim();
  if (!url) return false;
  try {
    const res = await fetchImpl(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(failureAlert(job, error)),
      signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
    });
    return res.ok;
  } catch {
    console.error(JSON.stringify({ job: safeJob(job), alert: 'failed' }));     // the alert is best effort; log no URL and no message
    return false;
  }
}
