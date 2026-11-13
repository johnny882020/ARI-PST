// After build: (1) copy CMS media from src/content/uploads to dist/uploads (editors may only touch src/content, RT-10),
// (2) add the analytics origin to the CSP in dist/_headers when analytics is configured,
// (3) add the API origin (PUBLIC_API_BASE, cross-origin join/contact forms) to connect-src and form-action in dist/_headers.
//     Render ignores _headers: the same origin is written in render.yaml `headers:` (checked by scripts/verify-render-yaml.py).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default function postBuild() {
  return {
    name: 'ari-post-build',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const out = fileURLToPath(dir);
        const root = process.cwd();
        const media = path.join(root, 'src/content/uploads');
        if (fs.existsSync(media)) fs.cpSync(media, path.join(out, 'uploads'), { recursive: true, filter: (s) => !s.endsWith('.gitkeep') });

        const apiBase = process.env.PUBLIC_API_BASE;
        const hdr = path.join(out, '_headers');
        if (apiBase && /^https:\/\//.test(apiBase) && fs.existsSync(hdr)) {
          const origin = new URL(apiBase).origin;
          const lines = fs.readFileSync(hdr, 'utf8').split('\n');
          const i = lines.findIndex((l) => l.includes('Content-Security-Policy'));      // first rule = site-wide policy (not /admin)
          if (i >= 0 && !lines[i].includes(origin)) lines[i] = lines[i].replace(/(connect-src 'self')(?=[;\s])/, `$1 ${origin}`).replace(/(form-action 'self')(?=[;\s])/, `$1 ${origin}`);
          fs.writeFileSync(hdr, lines.join('\n'));
        }
        const home = path.join(out, 'he/index.html');
        const headers = path.join(out, '_headers');
        if (fs.existsSync(home) && fs.existsSync(headers)) {
          const m = fs.readFileSync(home, 'utf8').match(/data-umami-src="(https:\/\/[^"]+)"/);
          if (m) {
            const origin = new URL(m[1]).origin;
            let h = fs.readFileSync(headers, 'utf8');
            h = h.replace(/(script-src 'self')(?=;)/, `$1 ${origin}`).replace(/(connect-src 'self')(?=[;\s])/, `$1 ${origin}`);
            fs.writeFileSync(headers, h);
          }
        }
      },
    },
  };
}
