import type { Handler } from '../../../http/route.js';
import { body, params, setSessionCookie, sess } from '../../../http/helpers.js';
import { CSRF_COOKIE, cookieOptions } from '../../../http/core.js';
import { sessionExpiry } from '../../../http/core.js';
import type { Config } from '../../../config.js';
import type { IdentityService } from '../service.js';
import type { Ctx } from '@ari/domain';

export function identityHandlers(svc: IdentityService, cfg: Config): Record<string, Handler> {
  const view = (req: Parameters<Handler>[0]) => svc.view(sess(req));
  return {
    csrfBootstrap: async (req) => ({ csrfToken: (req as unknown as { csrfCookie: string }).csrfCookie }),
    login: async (req) => { const b = body<{ email: string; password: string }>(req); return svc.login(b.email, b.password, req.id, req.ipHashValue); },
    webauthnOptions: async (req) => svc.webauthnOptions(body<{ challengeToken: string }>(req).challengeToken),
    verifyMfa: async (req, reply) => {
      const s = await svc.verifyMfa(body(req), req.id, req.ipHashValue);
      setSessionCookie(reply, cfg, s); reply.setCookie(CSRF_COOKIE, s.csrfToken, cookieOptions(cfg.secureCookies, false));   // fresh CSRF token per session
      return svc.view(s);
    },
    logout: async (req, reply) => { await svc.logout(req.ctx, sess(req)); reply.clearCookie('__Host-sid', { path: '/', secure: cfg.secureCookies, httpOnly: true, sameSite: 'strict' }); return reply.code(204).send(); },
    getAuthSession: async (req) => view(req),
    getSessionInfo: async (req) => view(req),
    extendSession: async (req) => svc.view(await svc.extend(sess(req))),
    register: async (req, reply) => { await svc.register(body(req), req.id); return reply.code(202).send({ accepted: true }); },
    verifyEmail: async (req, reply) => { const b = body<{ token: string; password?: string }>(req); await svc.verifyEmail(b.token, b.password, req.id); return reply.code(204).send(); },
    changePassword: async (req, reply) => {
      const b = body<{ currentPassword: string; newPassword: string }>(req);
      const fresh = await svc.changePassword(sess(req), b.currentPassword, b.newPassword, req.id, req.ipHashValue);
      setSessionCookie(reply, cfg, fresh); reply.setCookie(CSRF_COOKIE, fresh.csrfToken, cookieOptions(cfg.secureCookies, false)); return reply.code(204).send();
    },
    stepUp: async (req) => svc.view(await svc.stepUp(sess(req), body(req), req.id)),
    enrollTotpStart: async (req) => { const t = await svc.enrollTotpStart(sess(req)); return { otpauthUri: t.otpauthUri, secret: t.secretBase32 }; },
    enrollTotpConfirm: async (req) => svc.enrollTotpConfirm(sess(req), body<{ code: string }>(req).code, req.id),
    webauthnRegisterOptions: async (req) => svc.webauthnRegisterOptions(sess(req)),
    webauthnRegisterVerify: async (req) => { const b = body<{ name: string; attestation: unknown }>(req); return svc.webauthnRegisterVerify(sess(req), b.attestation, b.name, req.id); },
    recoverMfa: async (req, reply) => { const b = body<{ challengeToken: string; recoveryCode: string }>(req); const s = await svc.verifyMfa(b, req.id, req.ipHashValue); setSessionCookie(reply, cfg, s); reply.setCookie(CSRF_COOKIE, s.csrfToken, cookieOptions(cfg.secureCookies, false)); return svc.view(s); },
    listAuthMethods: async (req) => ({ items: await svc.methods(sess(req)) }),
    regenerateRecoveryCodes: async (req) => svc.regenerateRecoveryCodes(sess(req)),
    getMe: async (req) => svc.me(req.ctx, sess(req)),
    updateMe: async (req) => svc.updateMe(req.ctx, sess(req), body(req)),
    listPendingRegistrations: async (req) => ({ items: await svc.registrations(req.ctx) }),
    decideRegistration: async (req) => svc.decideRegistration(req.ctx, params<{ id: string }>(req).id, body<{ outcome: 'approved' | 'rejected' }>(req).outcome),
  };
}
void sessionExpiry; export type { Ctx };
