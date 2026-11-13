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
  const repo = new PgRepository(config.databaseUrl, { max: Number(process.env.DB_POOL_MAX ?? 10) });
  const auth = new PgAuth(repo.pool, { rpId: config.webauthn.rpId, rpName: config.webauthn.rpName, origin: config.webauthn.origin, secretsKey: config.secretsKey, argon: config.argon }, systemClock);
  const mailer = createMailer(config);
  const { app } = await buildApp({ config, contract: new Contract(), repo, auth, store: createObjectStore(config), mailer, clock: systemClock, notify: createNotifyPort(systemClock) });
  const worker = createOutboxWorker(repo, mailer, systemClock, (o, m) => app.log.warn(o, m));
  worker.start(config.outboxIntervalMs);
  const stop = async (sig: string) => { app.log.info({ sig }, 'shutting down'); worker.stop(); await app.close(); await repo.close(); process.exit(0); };
  process.on('SIGTERM', () => void stop('SIGTERM')); process.on('SIGINT', () => void stop('SIGINT'));
  await app.listen({ port: config.port, host: config.host });
}
main().catch((e) => { console.error('fatal', (e as Error).name); process.exit(1); });
