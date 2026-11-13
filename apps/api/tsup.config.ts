import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
export default defineConfig({
  entry: { server: 'src/server.ts', 'jobs/staleness': 'src/jobs/staleness.ts', 'jobs/audit-verify': 'src/jobs/audit-verify.ts', 'jobs/purge': 'src/jobs/purge.ts', 'jobs/export': 'src/jobs/export.ts' }, format: ['esm'], platform: 'node', target: 'node22', outDir: 'dist', clean: true, sourcemap: true,
  noExternal: ['@ari/domain'],
  external: ['argon2', 'pg-native', 'exceljs', '@aws-sdk/client-s3', 'nodemailer', 'pg', 'fastify', '@fastify/cookie', '@fastify/multipart', '@fastify/static', '@simplewebauthn/server', 'ajv', 'ajv-formats', 'yaml'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  onSuccess: async () => {
    mkdirSync('dist', { recursive: true });
    const src = '../../packages/contracts/openapi.yaml';
    if (existsSync(src)) copyFileSync(src, 'dist/openapi.yaml');
  },
});
