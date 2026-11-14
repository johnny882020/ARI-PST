import { describe, it, expect } from 'vitest';
import { HttpApiMailer, parseFrom } from './index.js';

type Call = { url: string; init: RequestInit };
function fakeFetch(status = 201) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status }); }) as unknown as typeof fetch;
  return { f, calls };
}
const msg = { to: 'user@example.test', subject: 'Verify', text: 'Open https://x.test/verify-email?token=abc' };

describe('parseFrom', () => {
  it('splits name and address', () => expect(parseFrom('ARI-PST <no-reply@example.test>')).toEqual({ name: 'ARI-PST', email: 'no-reply@example.test' }));
  it('accepts a bare address', () => expect(parseFrom('no-reply@example.test')).toEqual({ email: 'no-reply@example.test' }));
});

describe('HttpApiMailer', () => {
  it('sends a Brevo transactional e-mail with the api-key header', async () => {
    const { f, calls } = fakeFetch();
    await new HttpApiMailer('brevo', 'k-test', 'ARI-PST <no-reply@example.test>', f).send(msg);
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((calls[0]!.init.headers as Record<string, string>)['api-key']).toBe('k-test');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ sender: { name: 'ARI-PST', email: 'no-reply@example.test' }, to: [{ email: msg.to }], subject: 'Verify', textContent: msg.text });
  });
  it('sends a Resend e-mail with a bearer token', async () => {
    const { f, calls } = fakeFetch(200);
    await new HttpApiMailer('resend', 'k-test', 'ARI-PST <no-reply@example.test>', f).send(msg);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer k-test');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ to: [msg.to], text: msg.text });
  });
  it('throws on a provider error without the key or body in the message', async () => {
    const { f } = fakeFetch(401);
    const err = await new HttpApiMailer('brevo', 'k-secret', 'a@example.test', f).send(msg).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('HTTP 401');
    expect((err as Error).message).not.toMatch(/k-secret|token=abc/);
  });
});
