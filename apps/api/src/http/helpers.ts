import type { FastifyReply } from 'fastify';
import type { SessionRecord } from '@ari/domain';
import type { Config } from '../config.js';
import { SID_COOKIE, cookieOptions } from './core.js';
import type { ApiRequest } from './route.js';
import { sessionOrThrow } from './route.js';

export const body = <T>(req: ApiRequest): T => req.body as T;
export const query = <T>(req: ApiRequest): T => req.query as T;
export const params = <T>(req: ApiRequest): T => req.params as T;
export const idemKey = (req: ApiRequest): string | null => { const v = req.headers['idempotency-key']; return typeof v === 'string' ? v : null; };
export function setSessionCookie(reply: FastifyReply, cfg: Config, s: SessionRecord): void { reply.setCookie(SID_COOKIE, s.id, cookieOptions(cfg.secureCookies, true)); }
export const sess = (req: ApiRequest): SessionRecord => sessionOrThrow(req);
