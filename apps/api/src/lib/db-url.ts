// Builds a PostgreSQL URL for one of the C-06 login roles.
// Render gives ONE connection string (the database user). The API never uses it: it connects as app_runtime,
// jobs as app_readonly_bg. So the URL is built from DB_HOST / DB_PORT / DB_NAME plus that role's password.
// An explicit URL variable (DATABASE_URL, DATABASE_URL_BG, ...) wins when it is set (local dev, tests, CI).
export type DbRole = 'app_runtime' | 'app_readonly_bg' | 'app_migrator';
const PASSWORD_VAR: Record<DbRole, string> = { app_runtime: 'DB_PASSWORD_RUNTIME', app_readonly_bg: 'DB_PASSWORD_BG', app_migrator: 'DB_PASSWORD_MIGRATOR' };

export function roleUrl(env: NodeJS.ProcessEnv, role: DbRole, explicitVar?: string): string | undefined {
  if (explicitVar && env[explicitVar]) return env[explicitVar];
  const host = env.DB_HOST, name = env.DB_NAME, pw = env[PASSWORD_VAR[role]];
  if (!host || !name || !pw) return undefined;
  const ssl = env.DB_SSLMODE ? `?sslmode=${encodeURIComponent(env.DB_SSLMODE)}` : '';
  return `postgres://${role}:${encodeURIComponent(pw)}@${host}:${env.DB_PORT ?? '5432'}/${encodeURIComponent(name)}${ssl}`;
}
