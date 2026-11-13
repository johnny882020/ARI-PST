// Copies the Decap CMS bundle (npm package, version-pinned in package.json) into public/admin/vendor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules/decap-cms/dist');
const dest = path.join(root, 'public/admin/vendor');
if (!fs.existsSync(src)) { console.warn('decap-cms not installed; /admin will not load'); process.exit(0); }
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(src)) {
  if (/\.(js|css|wasm)$/.test(f) && !/^cms\./.test(f) && !/^\d+\.cms\./.test(f)) fs.copyFileSync(path.join(src, f), path.join(dest, f));
}
console.log('decap-cms vendored');
