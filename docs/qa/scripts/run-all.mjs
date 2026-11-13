#!/usr/bin/env node
// Runs every QA stage in order. Prereqs: pnpm install done; for web stages the mock server must be up:
//   (cd apps/web && npx vite build && PORT=3010 SERVE_DIST=1 node mock-server/server.mjs &)
// Set SKIP_WEB=1 to skip stages 3. Full-stack (stage 4) is manual, see README.md.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const stages = ["01-gallery.mjs", "02-public-site.mjs", ...(process.env.SKIP_WEB ? [] : ["03-web-sweep.mjs", "03b-web-flows.mjs"]), "05-report-stats.mjs"];
let failed = 0;
for (const s of stages) { console.log(`\n=== ${s} ===`); const r = spawnSync("node", [join(here, s)], { stdio: "inherit" }); if (r.status) { failed++; console.log(`${s} exited ${r.status}`); } }
process.exit(failed ? 1 : 0);
