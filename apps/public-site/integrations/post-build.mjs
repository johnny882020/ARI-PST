// After build: (1) copy CMS media from src/content/uploads to dist/uploads (editors may only touch src/content, RT-10),
// (2) add the analytics origin to the CSP in dist/_headers when analytics is configured.
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
