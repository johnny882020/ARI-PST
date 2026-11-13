// RT-10 `content-only-diff`: a CMS-origin change may only touch src/content/**.
// Usage: node scripts/check-content-only.mjs [base-ref]   (default origin/main). Used in CI for branches `cms/*`.
// Exit 1 and list offending files when any path is outside apps/public-site/src/content/.
import { execFileSync } from 'node:child_process';

export const ALLOWED = /^apps\/public-site\/src\/content\/(?!.*\.\.)[^/].*$/;
export const violations = (files) => files.filter((f) => f && !ALLOWED.test(f));

if (process.argv[1]?.endsWith('check-content-only.mjs')) {
  const base = process.argv[2] || 'origin/main';
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  const bad = violations(out.split('\n').map((s) => s.trim()));
  if (bad.length) { console.error('content-only-diff FAILED. CMS changes outside src/content:\n' + bad.join('\n')); process.exit(1); }
  console.log('content-only-diff ok');
}
