import nodemailer from 'nodemailer';
import type { Mailer, MailMessage } from '@ari/domain';
import type { Config } from '../../config.js';

/** Dev mailer. Keeps messages in memory for tests. Never prints bodies (tokens) in production. */
export class ConsoleMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  constructor(private readonly log: (m: string) => void = () => undefined) {}
  async send(m: MailMessage): Promise<void> { this.sent.push(m); this.log(`mail queued subject-length=${m.subject.length}`); }
}
export class SmtpMailer implements Mailer {
  private t;
  constructor(url: string, private readonly from: string) { this.t = nodemailer.createTransport(url); }
  async send(m: MailMessage): Promise<void> { await this.t.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) }); }
}
/** Splits 'Name <addr@x>' into parts. A bare address is allowed. */
export function parseFrom(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { ...(m[1] ? { name: m[1].replace(/^"|"$/g, '') } : {}), email: m[2]!.trim() } : { email: from.trim() };
}

/**
 * HTTPS e-mail API (Brevo or Resend). Used where outbound SMTP ports are not available (for example free hosting plans).
 * Never logs the message body (it can hold a one-time link) or the API key.
 */
export class HttpApiMailer implements Mailer {
  constructor(private readonly provider: 'brevo' | 'resend', private readonly apiKey: string, private readonly from: string,
              private readonly fetchImpl: typeof fetch = fetch) {}
  async send(m: MailMessage): Promise<void> {
    const f = parseFrom(this.from);
    const req: { url: string; headers: Record<string, string>; body: unknown } = this.provider === 'brevo'
      ? { url: 'https://api.brevo.com/v3/smtp/email', headers: { 'api-key': this.apiKey },
          body: { sender: f, to: [{ email: m.to }], subject: m.subject, textContent: m.text, ...(m.html ? { htmlContent: m.html } : {}) } }
      : { url: 'https://api.resend.com/emails', headers: { authorization: `Bearer ${this.apiKey}` },
          body: { from: this.from, to: [m.to], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) } };
    const res = await this.fetchImpl(req.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...req.headers },
      body: JSON.stringify(req.body), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`mail provider ${this.provider} rejected the message: HTTP ${res.status}`);
  }
}

export function createMailer(cfg: Config): Mailer {
  if (cfg.mail.kind === 'smtp' && cfg.mail.smtpUrl) return new SmtpMailer(cfg.mail.smtpUrl, cfg.mail.from);
  if ((cfg.mail.kind === 'brevo' || cfg.mail.kind === 'resend') && cfg.mail.apiKey) return new HttpApiMailer(cfg.mail.kind, cfg.mail.apiKey, cfg.mail.from);
  return new ConsoleMailer();
}
