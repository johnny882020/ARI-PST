// Core hooks: cookies, trace id, origin check, session load, CSRF, rate limits, problem+json errors, response validation.
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { DomainError, evaluateSession, sessionExpiresAt, type SessionRecord } from '@ari/domain';
import { ipHash, randomToken, safeEqual } from '../lib/crypto.js';
import type { Deps } from './deps.js';
import { HttpProblem, problemFor, toProblem } from './problem.js';

export const SID_COOKIE = '__Host-sid';
export const CSRF_COOKIE = '__Host-csrf';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT = new Set(['reportCsp', 'reportClientError', 'submitPublicForm']);

class Limiter {
  private hits = new Map<string, { n: number; reset: number }>();
  hit(key: string, max: number, windowMs: number, now: number): number {
    const e = this.hits.get(key);
    if (!e || e.reset <= now) { this.hits.set(key, { n: 1, reset: now + windowMs }); if (this.hits.size > 50_000) this.gc(now); return 0; }
    e.n++; return e.n > max ? Math.ceil((e.reset - now) / 1000) : 0;
  }
  private gc(now: number) { for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k); }
}
export function cookieOptions(secure: boolean, httpOnly: boolean) {
  return { path: '/', secure, httpOnly, sameSite: 'strict' as const };
}

export async function registerCore(app: FastifyInstance, deps: Deps): Promise<void> {
  const { config, auth, clock } = deps;
  await app.register(cookie);
  const limiter = new Limiter();

  app.addContentTypeParser('application/merge-patch+json', { parseAs: 'string' }, (_req, body, done) => {
    try { done(null, body ? JSON.parse(body as string) : undefined); } catch { done(new HttpProblem('MALFORMED_REQUEST'), undefined); }
  });
  for (const ct of ['application/csp-report', 'application/reports+json']) {
    app.addContentTypeParser(ct, { parseAs: 'string' }, (_req, body, done) => {
      try { done(null, body ? JSON.parse(body as string) : {}); } catch { done(null, {}); }
    });
  }

  app.decorateRequest('ctx', undefined as never);
  app.decorateRequest('session', null);
  app.decorateRequest('opId', '');
  app.decorateRequest('ipHashValue', null);

  app.addHook('onRequest', async (req, reply) => {
    const now = clock.now().getTime();
    req.ipHashValue = ipHash(config.ipHashSalt, req.ip);
    reply.header('X-Trace-Id', req.id);
    const path = req.url.split('?')[0] ?? '';
    // Coarse per-address rate limit. Login and registration are tighter.
    const tight = path.endsWith('/auth/login') || path.endsWith('/auth/register') || path.endsWith('/auth/mfa/verify') || path.includes('/auth/password-reset/') || path.includes('/public/forms/');
    const retry = limiter.hit(`ip:${req.ipHashValue}:${tight ? 't' : 'g'}`, tight ? config.rate.tightPerMin : config.rate.generalPerMin, 60_000, now);
    if (retry) throw new HttpProblem('RATE_LIMITED', { 'Retry-After': String(retry) });

    // The ONLY cross-origin rule (amends C-03): the static public site may POST the join/contact forms. Exact origin match,
    // POST only, no credentials, no cookies set, rate-limited above. Every other route stays same-origin with no CORS headers.
    const crossForm = isPublicFormPath(path) && !!config.publicSiteOrigin && req.headers.origin === config.publicSiteOrigin;
    if (crossForm) {
      reply.header('Access-Control-Allow-Origin', config.publicSiteOrigin!); reply.header('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        reply.header('Access-Control-Allow-Methods', 'POST'); reply.header('Access-Control-Allow-Headers', 'content-type'); reply.header('Access-Control-Max-Age', '600');
        return reply.code(204).send();
      }
    }

    const sid = crossForm ? undefined : req.cookies[SID_COOKIE];
    req.session = null;
    if (sid) {
      const s = await auth.getSession(sid);
      if (s) {
        const roles = s.roles.map((r) => r.role);
        const verdict = evaluateSession(s, roles, now);
        if (verdict === 'ok') {
          req.session = s;
          if (now - s.lastSeenAt > 30_000) { await auth.touchSession(s.id, now); s.lastSeenAt = now; }
        } else { await auth.revokeSession(s.id); }
      }
      if (!req.session) reply.clearCookie(SID_COOKIE, cookieOptions(config.secureCookies, true));
    }
    // CSRF cookie for everyone (double submit). Readable by the SPA.
    let csrf = req.cookies[CSRF_COOKIE];
    if (crossForm) csrf = csrf ?? '';
    else if (!csrf || csrf.length < 20) { csrf = randomToken(24); reply.setCookie(CSRF_COOKIE, csrf, cookieOptions(config.secureCookies, false)); }
    (req as unknown as { csrfCookie: string }).csrfCookie = csrf;

    if (UNSAFE.has(req.method) && path.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (origin && origin !== config.publicOrigin && !crossForm) throw new HttpProblem('CSRF_INVALID');
      if (!origin && !crossForm && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin' && req.headers['sec-fetch-site'] !== 'none') throw new HttpProblem('CSRF_INVALID');
      const exempt = CSRF_EXEMPT.has(opIdForPath(path));
      if (!exempt) {
        const hdr = req.headers['x-csrf-token'];
        const ok = typeof hdr === 'string' && safeEqual(hdr, csrf) && (!req.session || safeEqual(hdr, req.session.csrfToken));
        if (!ok) throw new HttpProblem('CSRF_INVALID');
      }
    }
  });

  app.setErrorHandler(async (err: any, req, reply) => {
    const traceId = req.id;
    let status: number; let body: unknown; const headers: Record<string, string> = {};
    if (err instanceof HttpProblem || err instanceof DomainError) {
      const p = toProblem(err, traceId); status = p.status; body = p;
      if (err instanceof HttpProblem) Object.assign(headers, err.headers);
    } else if ((err as { statusCode?: number }).statusCode === 413) {
      const p = problemFor('IMPORT_FILE_TOO_LARGE', traceId); status = 413; body = p;
    } else if ((err as { statusCode?: number }).statusCode === 400) {
      // R-10: Fastify parser errors (bad JSON, empty JSON body, bad content length) get their own code, not 422.
      const p = problemFor('MALFORMED_REQUEST', traceId); status = 400; body = p;
    } else if ((err as { statusCode?: number }).statusCode === 415) {
      const p = problemFor('UNSUPPORTED_MEDIA_TYPE', traceId); status = 415; body = p;
    } else if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) {
      const p = problemFor('VALIDATION_FAILED', traceId, [{ field: '$', rule: 'FORMAT' }]); status = 422; body = p;
    } else {
      const code = (err as { code?: string }).code;
      // Log class only. Never the message (could carry values) and never the body.
      req.log.error({ traceId, errName: err.name, errCode: code }, 'unhandled error');
      const p = problemFor('INTERNAL', traceId); status = 500; body = p;
      if (config.env === 'test') reply.header('X-Debug-Error', `${err.name}: ${String(err.message).slice(0, 300)}`);
    }
    for (const [k, v] of Object.entries(headers)) reply.header(k, v);
    return reply.code(status).type('application/problem+json').send(body);
  });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && app.hasDecorator('spaFallback')) return (reply as unknown as { sendFile(f: string): unknown }).sendFile('index.html');
    return reply.code(404).type('application/problem+json').send(problemFor('NOT_FOUND', req.id));
  });

  if (config.validateResponses) {
    app.addHook('preSerialization', async (req, reply, payload) => {
      if (!req.opId || reply.statusCode >= 400 || payload === undefined || payload === null || typeof payload === 'string' || Buffer.isBuffer(payload)) return payload;
      const bad = deps.contract.validateResponse(req.opId, reply.statusCode, JSON.parse(JSON.stringify(payload)));
      if (bad && bad.length) { req.log.error({ op: req.opId, bad }, 'response contract violation'); throw new Error('response contract violation: ' + req.opId + ' ' + bad.join(';')); }
      return payload;
    });
  }
  app.addHook('onResponse', async (req, reply) => {
    req.log.info({ traceId: req.id, method: req.method, route: req.routeOptions?.url, op: req.opId || undefined, status: reply.statusCode, ms: Math.round(reply.elapsedTime), role: req.ctx?.actor?.role, user: req.ctx?.actor?.userId ?? undefined }, 'request');
  });
}

const PUBLIC_FORM_RE = /^\/api\/v1\/public\/forms\/[a-z]+$/;
export const isPublicFormPath = (path: string): boolean => PUBLIC_FORM_RE.test(path);
function opIdForPath(path: string): string {
  if (path.endsWith('/csp-report')) return 'reportCsp';
  if (path.endsWith('/client-errors')) return 'reportClientError';
  if (path.includes('/public/forms/')) return 'submitPublicForm';
  return '';
}
export function sessionExpiry(s: SessionRecord): Date { return new Date(sessionExpiresAt(s, s.roles.map((r) => r.role))); }
