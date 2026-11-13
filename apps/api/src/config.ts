// Runtime configuration from the environment. No secrets have defaults in production.
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
  validateResponses: boolean;
  webDistDir: string | null;
  setLocalRole: boolean;                // adapter option: also SET LOCAL ROLE per transaction (baseline DB model)
  outboxIntervalMs: number;             // 0 disables the in-process outbox worker
  argon: { memoryCost: number; timeCost: number; parallelism: number };
  appVersion: string;
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
  const publicOrigin = need('PUBLIC_ORIGIN', 'http://localhost:8080').replace(/\/$/, '');
  const host = new URL(publicOrigin).hostname;
  const store = (env.OBJECT_STORE ?? (prod ? 's3' : 'memory')) as 'memory' | 'localfs' | 's3';
  return {
    env: nodeEnv, port: Number(env.PORT ?? 8080), host: env.HOST ?? '0.0.0.0',
    databaseUrl: need('DATABASE_URL', 'postgres://postgres@127.0.0.1:55433/ari_pst'),
    publicOrigin, secureCookies: bool(env.COOKIE_SECURE, true),
    webauthn: { rpId: env.WEBAUTHN_RP_ID ?? host, rpName: env.WEBAUTHN_RP_NAME ?? 'ARI-PST Portal', origin: env.WEBAUTHN_ORIGIN ?? publicOrigin },
    objectStore: {
      kind: store, localDir: env.OBJECT_STORE_DIR ?? '/tmp/ari-pst-objects',
      ...(store === 's3' ? { s3: { bucket: need('S3_BUCKET'), region: env.S3_REGION ?? 'eu-central-1', ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}), forcePathStyle: bool(env.S3_FORCE_PATH_STYLE, false) } } : {}),
    },
    mail: { kind: (env.MAIL_TRANSPORT ?? (prod ? 'smtp' : 'console')) as 'console' | 'smtp', ...(env.SMTP_URL ? { smtpUrl: env.SMTP_URL } : {}), from: env.MAIL_FROM ?? 'ARI-PST Portal <no-reply@portal.invalid>' },
    ipHashSalt: need('IP_HASH_SALT', 'dev-only-salt-change-me'),
    validateResponses: bool(env.VALIDATE_RESPONSES, !prod),
    webDistDir: env.WEB_DIST_DIR ?? null,
    setLocalRole: bool(env.DB_SET_LOCAL_ROLE, false),
    outboxIntervalMs: Number(env.OUTBOX_INTERVAL_MS ?? (nodeEnv === 'test' ? 0 : 15_000)),
    argon: { memoryCost: Number(env.ARGON_MEMORY_KIB ?? 19456), timeCost: Number(env.ARGON_TIME_COST ?? 2), parallelism: Number(env.ARGON_PARALLELISM ?? 1) },
    appVersion: env.APP_VERSION ?? env.RENDER_GIT_COMMIT ?? '0.1.0',
  };
}
