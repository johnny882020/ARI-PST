import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { failureAlert, safeErrorName, sendFailureAlert } from './alert.js';
import { failJob } from './run.js';

let server: Server; let base = ''; const got: Array<{ path: string; type: string | undefined; body: string }> = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      got.push({ path: req.url ?? '', type: req.headers['content-type'], body });
      if (req.url === '/hang') return;                       // never answers: the 5 s timeout must end the POST
      res.writeHead(req.url === '/fail' ? 500 : 204).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });

describe('ALERT_WEBHOOK_URL failure alert (L-4)', () => {
  it('the JSON holds only the job name, ok:false, the error name and the time', () => {
    const a = failureAlert('purge', '42501', new Date('2026-11-14T03:00:00Z'));
    expect(a).toEqual({ job: 'purge', ok: false, error: '42501', at: '2026-11-14T03:00:00.000Z' });
    expect(Object.keys(a).sort()).toEqual(['at', 'error', 'job', 'ok']);
    // free text never passes as the error name
    expect(failureAlert('purge', 'relation "portal.users" user@example.invalid').error).toBe('Error');
    expect(safeErrorName(Object.assign(new Error('secret text usr_01ABC'), { code: '28P01' }))).toBe('28P01');
    expect(safeErrorName(new TypeError('value 052-1234567'))).toBe('TypeError');
    expect(safeErrorName('plain string')).toBe('Error');
  });
  it('posts to the webhook; no URL means no call', async () => {
    const fetchSpy = vi.fn(fetch);
    expect(await sendFailureAlert('snapshot', 'TypeError', {}, fetchSpy)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    got.length = 0;
    expect(await sendFailureAlert('snapshot', 'TypeError', { ALERT_WEBHOOK_URL: `${base}/ok` })).toBe(true);
    expect(got).toHaveLength(1); expect(got[0]!.type).toBe('application/json');
    expect(JSON.parse(got[0]!.body)).toMatchObject({ job: 'snapshot', ok: false, error: 'TypeError' });
  });
  it('a failed or hanging webhook never throws; the POST times out', async () => {
    expect(await sendFailureAlert('purge', 'Error', { ALERT_WEBHOOK_URL: `${base}/fail` })).toBe(false);
    expect(await sendFailureAlert('purge', 'Error', { ALERT_WEBHOOK_URL: 'http://127.0.0.1:1/closed' })).toBe(false);
    expect(await sendFailureAlert('purge', 'Error', { ALERT_WEBHOOK_URL: 'not a url' })).toBe(false);
    const t0 = Date.now();
    expect(await sendFailureAlert('purge', 'Error', { ALERT_WEBHOOK_URL: `${base}/hang` }, fetch, 200)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  it('failJob logs, alerts and then exits non-zero', async () => {
    got.length = 0;
    const prev = process.env.ALERT_WEBHOOK_URL; process.env.ALERT_WEBHOOK_URL = `${base}/job`;
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await failJob('audit-verify', 'AuditChainBroken', 3);
      expect(exit).toHaveBeenCalledWith(3);
      expect(got).toHaveLength(1);
      expect(JSON.parse(got[0]!.body)).toMatchObject({ job: 'audit-verify', ok: false, error: 'AuditChainBroken' });
    } finally { exit.mockRestore(); err.mockRestore(); if (prev === undefined) delete process.env.ALERT_WEBHOOK_URL; else process.env.ALERT_WEBHOOK_URL = prev; }
  });
});
