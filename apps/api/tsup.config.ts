import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
// Highest migration number in db/migrations at build time. /readyz compares the database to it.
const migs = existsSync('../../db/migrations') ? readdirSync('../../db/migrations').filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).map((f) => f.slice(0, 4)).sort() : [];
const expected = migs.length ? migs[migs.length - 1]! : '';
export default defineConfig({
  entry: { server: 'src/server.ts', 'jobs/staleness': 'src/jobs/staleness.ts', 'jobs/audit-verify': 'src/jobs/audit-verify.ts', 'jobs/purge': 'src/jobs/purge.ts', 'jobs/export': 'src/jobs/export.ts', 'jobs/snapshot': 'src/jobs/snapshot.ts', 'jobs/seed-synthetic': 'src/jobs/seed-synthetic.ts' }, format: ['esm'], platform: 'node', target: 'node22', outDir: 'dist', clean: true, sourcemap: true,
  noExternal: ['@ari/domain', '@ari/synthetic-data'],
  define: { __EXPECTED_MIGRATION__: JSON.stringify(expected) },
  external: ['argon2', 'pg-native', 'exceljs', '@aws-sdk/client-s3', 'nodemailer', 'pg', 'fastify', '@fastify/cookie', '@fastify/multipart', '@fastify/static', '@simplewebauthn/server', 'ajv', 'ajv-formats', 'yaml'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  onSuccess: async () => {
    mkdirSync('dist', { recursive: true });
    const src = '../../packages/contracts/openapi.yaml';
    if (existsSync(src)) copyFileSync(src, 'dist/openapi.yaml');
  },
});
