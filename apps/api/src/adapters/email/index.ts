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
export function createMailer(cfg: Config): Mailer {
  if (cfg.mail.kind === 'smtp' && cfg.mail.smtpUrl) return new SmtpMailer(cfg.mail.smtpUrl, cfg.mail.from);
  return new ConsoleMailer();
}
