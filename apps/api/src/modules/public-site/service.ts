import { DomainError, scanValue, type Clock, type Repository, ANON_ACTOR } from '@ari/domain';
import { nid } from '../../lib/util.js';
import type { NotifyPort } from '@ari/domain';

export class PublicService {
  readonly counters = { clientErrors: 0, cspReports: 0 };
  constructor(private repo: Repository, private notify: NotifyPort, private clock: Clock, private inbox: string) {}
  /** Join/contact form. Delivered to the operator mailbox through the outbox. The message is wiped from the outbox after sending. */
  async submitForm(form: 'join' | 'contact', b: { name: string; email: string; organization?: string; message: string; locale?: 'he' | 'en'; website?: string }, traceId: string): Promise<void> {
    if (b.website && b.website.trim() !== '') return;                       // honeypot: pretend success
    void scanValue; void DomainError;
    const text = `[${form}] ${b.name.slice(0, 100)} <${b.email}>${b.organization ? ` (${b.organization.slice(0, 120)})` : ''}\n\n${b.message}`;
    await this.repo.tx({ actor: ANON_ACTOR, traceId }, (tx) => this.notify.enqueue(tx, { template: 'contact_form', toEmail: this.inbox, locale: 'en', params: { message: text } }));
    void this.clock; void nid;
  }
}
