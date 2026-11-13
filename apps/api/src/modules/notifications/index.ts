// notifications module: outbox + templates. Leaf module. Bodies hold no identifiers beyond what the recipient needs (token links).
import type { Clock, Mailer, NotifyPort, Repository, Tx, Ctx } from '@ari/domain';
import { ANON_ACTOR } from '@ari/domain';
import { nid } from '../../lib/util.js';

type Locale = 'he' | 'en';
const T: Record<string, Record<Locale, { subject: string; body: string }>> = {
  verify_email: { he: { subject: 'אימות כתובת דוא"ל - ARI-PST', body: 'להשלמת ההרשמה היכנסו לקישור: {link}' }, en: { subject: 'Verify your email - ARI-PST', body: 'Open this link to finish registration: {link}' } },
  invite: { he: { subject: 'הזמנה לפורטל ARI-PST', body: 'להפעלת החשבון והגדרת סיסמה: {link}' }, en: { subject: 'Invitation to the ARI-PST Portal', body: 'Activate your account and set a password: {link}' } },
  registration_approved: { he: { subject: 'החשבון אושר', body: 'החשבון שלכם אושר. אפשר להתחבר.' }, en: { subject: 'Account approved', body: 'Your account is approved. You can sign in.' } },
  registration_rejected: { he: { subject: 'הבקשה לא אושרה', body: 'בקשת ההרשמה לא אושרה.' }, en: { subject: 'Registration not approved', body: 'Your registration request was not approved.' } },
  request_status: { he: { subject: 'עדכון בבקשת הגישה', body: 'סטטוס הבקשה עודכן. היכנסו לפורטל לפרטים.' }, en: { subject: 'Access request update', body: 'Your request status changed. Sign in for details.' } },
  committee_assigned: { he: { subject: 'בקשה ממתינה להצבעה', body: 'בקשה חדשה ממתינה להצבעת הוועדה.' }, en: { subject: 'Request awaiting committee vote', body: 'A request is waiting for your committee vote.' } },
  coordinator_precheck: { he: { subject: 'בקשה חדשה לבדיקה מקדימה', body: 'הוגשה בקשה חדשה.' }, en: { subject: 'New request to pre-check', body: 'A new request was submitted.' } },
  staleness_digest: { he: { subject: 'סיכום רעננות נתונים', body: 'יש רשומות שדורשות אימות. היכנסו לפורטל.' }, en: { subject: 'Data freshness digest', body: 'Some records need verification. Sign in to the portal.' } },
  contact_form: { he: { subject: 'פנייה חדשה מהאתר', body: '{message}' }, en: { subject: 'New website inquiry', body: '{message}' } },
};
export function renderTemplate(template: string, locale: Locale, params: Record<string, string>): { subject: string; text: string } {
  const t = T[template]?.[locale] ?? T[template]?.en;
  if (!t) return { subject: 'ARI-PST', text: '' };
  return { subject: t.subject, text: t.body.replace(/\{(\w+)\}/g, (_m, k: string) => params[k] ?? '') };
}
export function createNotifyPort(clock: Clock): NotifyPort {
  return {
    async enqueue(tx, n) {
      await tx.outbox.enqueue({ id: nid(clock, 'outbox'), template: n.template, toRole: n.toRole ?? null, toUserId: n.toUserId ?? null, toEmail: n.toEmail ?? null, locale: n.locale ?? 'he', params: n.params ?? {} });
    },
  };
}
export interface OutboxWorker { tick(): Promise<number>; start(ms: number): void; stop(): void }
export function createOutboxWorker(repo: Repository, mailer: Mailer, clock: Clock, log: (o: object, m: string) => void): OutboxWorker {
  let timer: NodeJS.Timeout | null = null;
  const ctx: Ctx = { actor: { ...ANON_ACTOR, role: 'system_admin', roles: ['system_admin'] }, traceId: 'outbox-worker' };
  async function tick(): Promise<number> {
    let sent = 0;
    const batch = await repo.tx(ctx, (tx) => tx.outbox.claimPending(20));
    for (const m of batch) {
      try {
        if (!m.toEmail) throw new Error('no recipient');
        const r = renderTemplate(m.template, m.locale, m.params);
        await mailer.send({ to: m.toEmail, subject: r.subject, text: r.text });
        await repo.tx(ctx, (tx) => tx.outbox.markSent(m.id)); sent++;
      } catch {
        log({ outboxId: m.id }, 'outbox send failed');
        await repo.tx(ctx, (tx) => tx.outbox.markFailed(m.id, m.attempts + 1 >= 5));
      }
    }
    void clock; return sent;
  }
  return { tick, start(ms) { if (ms > 0 && !timer) { timer = setInterval(() => { void tick().catch(() => undefined); }, ms); timer.unref(); } }, stop() { if (timer) clearInterval(timer); timer = null; } };
}
export type { Tx };
