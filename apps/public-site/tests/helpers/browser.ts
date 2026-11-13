import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';

/** Uses the preinstalled chromium (PLAYWRIGHT_BROWSERS_PATH or /opt/pw-browsers) when the bundled revision is absent. */
export async function launch(): Promise<Browser | null> {
  const attempts: (() => Promise<Browser>)[] = [() => chromium.launch()];
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean) as string[];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
      const exe = path.join(r, d, 'chrome-linux64/chrome');
      if (fs.existsSync(exe)) attempts.push(() => chromium.launch({ executablePath: exe, args: ['--no-sandbox'] }));
    }
  }
  for (const a of attempts) { try { return await a(); } catch { /* try next */ } }
  return null;
}
