import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

/** Security headers for every response. API responses are never cached. */
export function registerSecurityHeaders(app: FastifyInstance, cfg: Config): void {
  const csp = [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
    "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
    'report-uri /api/v1/csp-report',
  ].join('; ');
  app.addHook('onSend', async (req, reply) => {
    reply.header('Content-Security-Policy', csp);
    reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    if (req.url.startsWith('/api/')) { reply.header('Cache-Control', 'no-store'); reply.header('Pragma', 'no-cache'); }
    reply.removeHeader('X-Powered-By');
  });
  void cfg;
}
