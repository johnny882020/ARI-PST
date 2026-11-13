import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.png': 'image/png', '.yml': 'text/yaml',
};

/** Parses a Netlify-style _headers file into [pattern, headers] rules. */
export function parseHeaders(text: string): { re: RegExp; headers: Record<string, string> }[] {
  const rules: { re: RegExp; headers: Record<string, string> }[] = [];
  let cur: { re: RegExp; headers: Record<string, string> } | null = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      const re = new RegExp('^' + raw.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      cur = { re, headers: {} };
      rules.push(cur);
    } else if (cur) {
      const i = raw.indexOf(':');
      cur.headers[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim();
    }
  }
  return rules;
}

/** Static server for a built dist that applies dist/_headers (so tests see the real CSP). Later, more specific rules override. */
export async function serve(dir: string) {
  const hdrFile = path.join(dir, '_headers');
  const rules = fs.existsSync(hdrFile) ? parseHeaders(fs.readFileSync(hdrFile, 'utf8')) : [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let p = decodeURIComponent(url.pathname);
    let file = path.join(dir, p);
    if (!file.startsWith(dir)) { res.writeHead(400).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const ok = fs.existsSync(file);
    if (!ok) file = path.join(dir, '404.html');
    const headers: Record<string, string> = { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' };
    for (const r of rules) if (r.re.test(p)) Object.assign(headers, r.headers);
    res.writeHead(ok ? 200 : 404, headers);
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
