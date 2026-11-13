// Shared helpers for QA scripts. Run from repo root. Playwright is resolved from /opt/node-tools or repo node_modules.
import { createRequire } from "node:module";
import http from "node:http";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
let pw;
for (const p of ["playwright", "/opt/node-tools/node_modules/playwright"]) { try { pw = require(p); break; } catch {} }
export const { chromium } = pw;
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const QA = join(ROOT, "docs", "qa");
export const SHOTS = join(QA, "screenshots");
export const RESULTS = join(QA, "results");
let axeSrc;
export async function axeSource() {
  if (axeSrc) return axeSrc;
  const { readdirSync } = await import("node:fs");
  const base = join(ROOT, "node_modules/.pnpm");
  const d = readdirSync(base).find((x) => x.startsWith("axe-core@"));
  axeSrc = await readFile(join(base, d, "node_modules/axe-core/axe.min.js"), "utf8");
  return axeSrc;
}
export async function runAxe(page, label) {
  await page.evaluate(await axeSource());
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(" ") + " :: " + (n.failureSummary || "").split("\n").slice(1, 2).join("")) }));
  });
  return { label, violations: r };
}
export function serveStatic(dir, port, { spaFallback = false, prefix = "" } = {}) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain", ".ico": "image/x-icon", ".webp": "image/webp" };
  const srv = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (prefix && p.startsWith(prefix)) p = p.slice(prefix.length) || "/";
      p = normalize(p).replace(/^(\.\.[/\\])+/, "");
      let f = join(dir, p);
      let s = await stat(f).catch(() => null);
      if (s?.isDirectory()) { f = join(f, "index.html"); s = await stat(f).catch(() => null); }
      if (!s && !extname(p) ) { const f2 = join(dir, p, "index.html"); s = await stat(f2).catch(() => null); if (s) f = f2; }
      if (!s) { if (spaFallback) { f = join(dir, "index.html"); } else { const nf = await readFile(join(dir, "404.html")).catch(() => null); res.writeHead(404, { "content-type": "text/html" }); return res.end(nf ?? "404"); } }
      res.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" });
      res.end(await readFile(f));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}
export const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
export async function newCtx(browser, { vp = "desktop", scheme = "light", reducedMotion = "no-preference", locale = "en", extra = {} } = {}) {
  return browser.newContext({ viewport: VIEWPORTS[vp], deviceScaleFactor: 2, colorScheme: scheme, reducedMotion, locale, ignoreHTTPSErrors: true, ...extra });
}
export function collect(page, bucket) {
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) bucket.console.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => bucket.console.push("[pageerror] " + String(e).slice(0, 300)));
  page.on("requestfailed", (r) => bucket.failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 400) bucket.failed.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  page.on("request", (r) => bucket.requests.push(r.url()));
}
export const newBucket = () => ({ console: [], failed: [], requests: [] });
// In-page helper source: contrast + target-size audit. Returns arrays of failures.
export const AUDIT_FN = `(() => {
  function parse(c){const m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]};}
  function lum({r,g,b}){const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);}
  function blend(fg,bg){const a=fg.a;return {r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a),a:1};}
  function bgOf(el){const stack=[];let e=el;while(e){const cs=getComputedStyle(e);const c=parse(cs.backgroundColor);if(c&&c.a>0){stack.push(c);if(c.a>=1)break;}if(cs.backgroundImage&&cs.backgroundImage!=='none'&&!/gradient/.test(cs.backgroundImage)){}e=e.parentElement;}
    let base={r:255,g:255,b:255,a:1};const root=parse(getComputedStyle(document.body).backgroundColor);if(root&&root.a>0)base=root;
    if(stack.length&&stack[stack.length-1].a>=1)base=stack.pop();
    while(stack.length){base=blend(stack.pop(),base);}return base;}
  function ratio(a,b){const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);}
  window.__auditContrast=function(){
    const out=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const seen=new Set();
    while(walker.nextNode()){const t=walker.currentNode;if(!t.textContent.trim())continue;const el=t.parentElement;if(!el||seen.has(el))continue;seen.add(el);
      const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)===0)continue;const r=el.getBoundingClientRect();if(r.width===0||r.height===0)continue;
      let fg=parse(cs.color);if(!fg)continue;const bg=bgOf(el);if(fg.a<1)fg=blend(fg,bg);
      const fs=parseFloat(cs.fontSize);const bold=parseInt(cs.fontWeight)>=700;const large=fs>=24||(fs>=18.66&&bold);const need=large?3:4.5;
      const cr=ratio(fg,bg);const disabled=el.closest('[disabled],[aria-disabled="true"]');
      if(cr<need)out.push({text:t.textContent.trim().slice(0,40),sel:(el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.split(' ').join('.'):'')).slice(0,80),ratio:+cr.toFixed(2),need,fs,disabled:!!disabled,fg:cs.color,bg:'rgb('+[bg.r,bg.g,bg.b].map(Math.round)+')'});}
    return out;};
  window.__auditTargets=function(min){
    const out=[];document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=switch],[role=checkbox],[role=radio],summary').forEach(el=>{
      const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden')return;let r=el.getBoundingClientRect();
      if(el.tagName==='INPUT'&&['checkbox','radio'].includes(el.type)){const l=el.closest('label');if(l)r=l.getBoundingClientRect();}
      if(r.width===0||r.height===0)return;
      // inline links in running text are exempt (WCAG 2.5.8 inline exception)
      if(el.tagName==='A'&&cs.display==='inline'&&el.closest('p,li,span,div:not([class])')&&el.parentElement&&el.parentElement.textContent.trim().length>el.textContent.trim().length+5)return;
      if(r.width<min||r.height<min)out.push({sel:(el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.split(' ')[0]:'')),text:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,30),w:Math.round(r.width),h:Math.round(r.height)});});
    return out;};
  window.__hscroll=()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1?{sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}:null;
  return true;})()`;
export async function installAudit(page) { await page.evaluate(AUDIT_FN); }
export async function shot(page, area, name, opts = {}) {
  const f = join(SHOTS, area, name + ".png");
  await mkdir(dirname(f), { recursive: true });
  await page.screenshot({ path: f, fullPage: opts.fullPage ?? true });
  return f.replace(ROOT + "/", "");
}
export async function saveJson(name, data) { await mkdir(RESULTS, { recursive: true }); await writeFile(join(RESULTS, name), JSON.stringify(data, null, 2)); }
export function shortPort(srv) { return srv.address().port; }
