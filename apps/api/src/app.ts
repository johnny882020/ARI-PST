import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { Deps } from './http/deps.js';
import { registerCore } from './http/core.js';
import { registerSecurityHeaders } from './http/security.js';
import { registerContractRoutes, type Handler } from './http/route.js';
import { IdentityService } from './modules/identity-access/index.js';
import { identityHandlers } from './modules/identity-access/http/handlers.js';
import { SampleService } from './modules/sample-index/index.js';
import { sampleHandlers } from './modules/sample-index/http/handlers.js';
import { SearchService } from './modules/search-discovery/index.js';
import { searchHandlers } from './modules/search-discovery/http/handlers.js';
import { RequestService } from './modules/access-requests/index.js';
import { requestHandlers } from './modules/access-requests/http/handlers.js';
import { AuditService } from './modules/audit-log/index.js';
import { auditHandlers } from './modules/audit-log/http/handlers.js';
import { IngestionService } from './modules/center-ingestion/index.js';
import { ingestionHandlers } from './modules/center-ingestion/http/handlers.js';
import { AdminService } from './modules/admin-governance/index.js';
import { adminHandlers } from './modules/admin-governance/http/handlers.js';
import { PublicService } from './modules/public-site/index.js';
import { publicHandlers } from './modules/public-site/http/handlers.js';
import { Counters, Health } from './modules/observability/index.js';
import { healthHandlers } from './modules/observability/http/handlers.js';

export interface BuiltApp { app: FastifyInstance; counters: Counters }

export async function buildApp(deps: Deps, opts: { logger?: boolean } = {}): Promise<BuiltApp> {
  const { config } = deps;
  const app = Fastify({
    logger: opts.logger === false ? false : {
      level: config.env === 'test' ? 'silent' : 'info',
      serializers: { req: (r: { method: string; routeOptions?: { url?: string } }) => ({ method: r.method, route: r.routeOptions?.url }) },
      redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', '*.password', '*.email', '*.token'], censor: '[redacted]' },
    },
    genReqId: () => randomUUID(), trustProxy: true, bodyLimit: 1_048_576, routerOptions: { ignoreTrailingSlash: true },
  } as never) as unknown as FastifyInstance;
  registerSecurityHeaders(app, config);
  await registerCore(app, deps);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, parts: 8 } });

  const counters = new Counters();
  const repo = deps.repo;
  const identity = new IdentityService(repo, deps.auth, deps.notify, deps.clock, config.publicOrigin);
  const samples = new SampleService(repo, deps.clock);
  const search = new SearchService(repo, deps.clock, async (uid) => (await deps.auth.profileFor(uid))?.email ?? null);
  const requests = new RequestService(repo, deps.clock, deps.notify, search);
  const audit = new AuditService(repo);
  const ingestion = new IngestionService(repo, deps.store, deps.clock);
  const admin = new AdminService(repo, deps.auth, deps.notify, deps.clock, config.publicOrigin);
  const pub = new PublicService(repo, deps.notify, deps.clock, config.contactInbox);
  const health = new Health(repo, config.appVersion);

  const handlers: Record<string, Handler> = {
    ...identityHandlers(identity, config), ...sampleHandlers(samples), ...searchHandlers(search), ...requestHandlers(requests),
    ...auditHandlers(audit), ...ingestionHandlers(ingestion), ...adminHandlers(admin), ...publicHandlers(pub, counters), ...healthHandlers(health),
  };
  registerContractRoutes(app, deps, handlers);

  const dist = config.webDistDir ?? resolve(process.cwd(), '../web/dist');
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, wildcard: false, index: ['index.html'], cacheControl: true, maxAge: '1h' });
    app.decorate('spaFallback', true);
  }
  return { app, counters };
}
