import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
export default function setup(): void {
  if (process.env.TEST_DATABASE_URL) return;
  const out = execFileSync(resolve(__dirname, '../../scripts/test-db.sh'), { encoding: 'utf8', timeout: 180_000 });
  process.env.TEST_DATABASE_URL = out.trim().split('\n').pop()!;
  process.env.TEST_ADMIN_DATABASE_URL = process.env.TEST_DATABASE_URL.replace('app_runtime', 'postgres');
}
