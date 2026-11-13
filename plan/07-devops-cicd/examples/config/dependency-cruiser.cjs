// Architecture test: domain must not import platform libraries (contract pack section 1, hexagonal core).
const PLATFORM_LIBS = '^(pg|postgres|knex|kysely|drizzle-orm|argon2|@simplewebauthn|otplib|@aws-sdk|minio|nodemailer|fastify|@fastify|meilisearch|typesense|@elastic)(/|$)';
module.exports = {
  forbidden: [
    { name: 'domain-no-named-platform-libs', severity: 'error',
      from: { path: '^packages/domain' }, to: { path: PLATFORM_LIBS } },
    { name: 'domain-no-apps', severity: 'error',
      from: { path: '^packages/domain' }, to: { path: '^(apps|adapters)/' } },
    { name: 'web-only-api-client', severity: 'error',
      from: { path: '^apps/web' }, to: { path: '^(apps/api|packages/domain)' } },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: { doNotFollow: { path: 'node_modules' }, tsConfig: { fileName: 'tsconfig.base.json' } },
};
