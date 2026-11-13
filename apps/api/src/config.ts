// Runtime configuration from the environment. No secrets have defaults in production.
// THIS FILE IS THE SINGLE SOURCE for variable names. render.yaml, infra/render.free.yaml and apps/api/.env.example follow it
// (scripts/verify-render-yaml.py checks that the Blueprints set every variable that is required in production).
import { roleUrl } from './lib/db-url.js';
export interface Config {
  env: 'development' | 'test' | 'production';
  port: number; host: string;
  databaseUrl: string;
  publicOrigin: string;                 // e.g. https://portal.example.org (same origin for SPA and API, decision C-03)
  secureCookies: boolean;
  webauthn: { rpId: string; rpName: string; origin: string };
  objectStore: { kind: 'memory' | 'localfs' | 's3'; localDir: string; s3?: { bucket: string; region: string; endpoint?: string; forcePathStyle: boolean } };
  mail: { kind: 'console' | 'smtp'; smtpUrl?: string; from: string };
  ipHashSalt: string;
  secretsKey: string;                   // encrypts TOTP secrets at rest (AES-256-GCM)
  contactInbox: string;
  validateResponses: boolean;
  webDistDir: string | null;
  setLocalRole: boolean;                // adapter option: also SET LOCAL ROLE per transaction (baseline DB model)
  outboxIntervalMs: number;             // 0 disables the in-process outbox worker
  rate: { tightPerMin: number; generalPerMin: number };
  argon: { memoryCost: number; timeCost: number; parallelism: number };
  appVersion: string;
  dataClassification: string;          // 'synthetic' until GATE-PROD-DATA closes
  demoMode: boolean;                    // DEMO_MODE=true: free-plan demo, the UI shows a banner
  publicSiteOrigin: string | null;      // the ONLY cross-origin caller, and only for POST /api/v1/public/forms/* (no credentials)
}
const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = (env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development') as Config['env'];
  const prod = nodeEnv === 'production';
  const need = (k: string, dev?: string): string => {
    const v = env[k] ?? (prod ? undefined : dev);
    if (v === undefined || v === '') throw new Error(`Missing required environment variable ${k}`);
    return v;
  };
  // Data guard (hard rule): anything but synthetic data needs the explicit gate variable. Checked before anything else.
  const dataClassification = (env.DATA_CLASSIFICATION ?? 'synthetic').toLowerCase();
  if (dataClassification !== 'synthetic' && env.GATE_PROD_DATA_CLOSED !== 'true') {
    throw new Error('DATA_CLASSIFICATION is not "synthetic" and GATE_PROD_DATA_CLOSED is not "true". Refusing to start (GATE-PROD-DATA).');
  }
  const synthetic = dataClassification === 'synthetic';
  // PUBLIC_ORIGIN wins. RENDER_EXTERNAL_URL is set by Render on every web service (also in PR previews).
  const publicOrigin = (env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || need('PUBLIC_ORIGIN', 'http://localhost:8080')).replace(/\/$/, '');
  const originOf = (v: string | undefined): string | null => { if (!v) return null; const u = new URL(v); return u.origin; };
  const host = new URL(publicOrigin).hostname;
  // Object store and mail: with synthetic data the API may run without a bucket or SMTP (previews, demo). Never with other data.
  const store = (env.OBJECT_STORE ?? (env.S3_BUCKET ? 's3' : prod && !synthetic ? 's3' : 'memory')) as 'memory' | 'localfs' | 's3';
  const mailKind = (env.MAIL_TRANSPORT ?? (env.SMTP_URL ? 'smtp' : prod && !synthetic ? 'smtp' : 'console')) as 'console' | 'smtp';
  if (mailKind === 'smtp' && !env.SMTP_URL) throw new Error('Missing required environment variable SMTP_URL');
  const databaseUrl = roleUrl(env, 'app_runtime', 'DATABASE_URL') ?? (prod ? undefined : 'postgres://postgres@127.0.0.1:55433/ari_pst');
  if (!databaseUrl) throw new Error('Missing database settings: set DATABASE_URL, or DB_HOST + DB_NAME + DB_PASSWORD_RUNTIME');
  return {
    env: nodeEnv, port: Number(env.PORT ?? 8080), host: env.HOST ?? '0.0.0.0',
    databaseUrl,
    publicOrigin, secureCookies: bool(env.COOKIE_SECURE, true),
    webauthn: { rpId: env.WEBAUTHN_RP_ID ?? host, rpName: env.WEBAUTHN_RP_NAME ?? 'ARI-PST Portal', origin: env.WEBAUTHN_ORIGIN ?? publicOrigin },
    objectStore: {
      kind: store, localDir: env.OBJECT_STORE_DIR ?? '/tmp/ari-pst-objects',
      ...(store === 's3' ? { s3: { bucket: need('S3_BUCKET'), region: env.S3_REGION ?? 'eu-central-1', ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}), forcePathStyle: bool(env.S3_FORCE_PATH_STYLE, false) } } : {}),
    },
    mail: { kind: mailKind, ...(env.SMTP_URL ? { smtpUrl: env.SMTP_URL } : {}), from: env.MAIL_FROM ?? 'ARI-PST Portal <no-reply@portal.invalid>' },
    ipHashSalt: need('IP_HASH_SALT', 'dev-only-salt-change-me'),
    secretsKey: need('SECRETS_KEY', 'dev-only-secrets-key-change-me'),
    contactInbox: env.CONTACT_INBOX ?? 'contact@portal.invalid',
    validateResponses: bool(env.VALIDATE_RESPONSES, !prod),
    webDistDir: env.WEB_DIST_DIR ?? null,
    setLocalRole: bool(env.DB_SET_LOCAL_ROLE, false),
    outboxIntervalMs: Number(env.OUTBOX_INTERVAL_MS ?? (nodeEnv === 'test' ? 0 : 15_000)),
    rate: { tightPerMin: Number(env.RATE_TIGHT_PER_MIN ?? 20), generalPerMin: Number(env.RATE_GENERAL_PER_MIN ?? 600) },
    argon: { memoryCost: Number(env.ARGON_MEMORY_KIB ?? 19456), timeCost: Number(env.ARGON_TIME_COST ?? 2), parallelism: Number(env.ARGON_PARALLELISM ?? 1) },
    appVersion: env.RENDER_GIT_COMMIT || env.APP_VERSION || '0.1.0',
    dataClassification, demoMode: bool(env.DEMO_MODE, false),
    publicSiteOrigin: originOf(env.PUBLIC_SITE_ORIGIN),
  };
}
