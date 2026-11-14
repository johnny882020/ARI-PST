import { loadConfig } from './config.js';
import { Contract } from './http/openapi.js';
import { PgRepository } from './adapters/postgres/db.js';
import { PgAuth } from './adapters/auth-local/index.js';
import { createObjectStore } from './adapters/objectstore/index.js';
import { createMailer } from './adapters/email/index.js';
import { systemClock } from './adapters/clock/index.js';
import { createNotifyPort, createOutboxWorker } from './modules/notifications/index.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  // The pre-deploy step shares this service's environment on Render. The running API has no use for the owner or
  // migrator credentials: drop them from the process environment (defence in depth; they stay in the service settings).
  for (const k of ['DATABASE_URL_OWNER', 'DATABASE_URL_MIGRATOR', 'DB_PASSWORD_MIGRATOR', 'SEED_USER_PASSWORD']) delete process.env[k];
  const repo = new PgRepository(config.databaseUrl, { max: Number(process.env.DB_POOL_MAX ?? 10) });
  if (config.env === 'production') await assertRuntimeRole(repo);
  const auth = new PgAuth(repo.pool, { rpId: config.webauthn.rpId, rpName: config.webauthn.rpName, origin: config.webauthn.origin, secretsKey: config.secretsKey, argon: config.argon }, systemClock);
  const mailer = createMailer(config);
  const { app } = await buildApp({ config, contract: new Contract(), repo, auth, store: createObjectStore(config), mailer, clock: systemClock, notify: createNotifyPort(systemClock) });
  const worker = createOutboxWorker(repo, mailer, systemClock, (o, m) => app.log.warn(o, m));
  worker.start(config.outboxIntervalMs);
  const stop = async (sig: string) => { app.log.info({ sig }, 'shutting down'); worker.stop(); await app.close(); await repo.close(); process.exit(0); };
  process.on('SIGTERM', () => void stop('SIGTERM')); process.on('SIGINT', () => void stop('SIGINT'));
  if (config.mail.kind === 'console') app.log.warn({ mailTransport: 'console' }, 'mail transport is console: e-mails are not delivered (set MAIL_TRANSPORT and MAIL_API_KEY or SMTP_URL)');
  else app.log.info({ mailTransport: config.mail.kind }, 'mail transport ready');
  await app.listen({ port: config.port, host: config.host });
}
/** C-06: in production the API must log in as a plain role (app_runtime). A superuser, a BYPASSRLS role or the table owner would switch the privacy model off. */
async function assertRuntimeRole(repo: PgRepository): Promise<void> {
  const r = (await repo.pool.query(`SELECT current_user AS u, rolsuper OR rolbypassrls OR rolcreaterole AS elevated FROM pg_roles WHERE rolname = current_user`)).rows[0];
  if (!r || r.elevated || r.u === 'app_migrator') throw new ConfigError('the API database login must be app_runtime (not a superuser, not the owner, not app_migrator)');
}
class ConfigError extends Error {}
// Configuration errors name a variable or a rule, never a value, so the message is safe to print.
main().catch((e) => {
  const err = e as Error & { code?: string };
  const safe = err instanceof ConfigError || /environment variable|DATABASE|DATA_CLASSIFICATION|Missing|not found/.test(err.message);
  console.error(JSON.stringify({ level: 'fatal', msg: 'startup failed', errName: err.name, errCode: err.code, ...(safe ? { detail: err.message } : {}), ...(process.env.DEBUG_FATAL === '1' ? { stack: err.stack } : {}) }));
  process.exit(1);
});
