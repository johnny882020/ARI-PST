// Prints the pass/fail counts used in docs/qa/REPORT.md from docs/qa/results/*.json
import { readFileSync } from "node:fs"; import { join } from "node:path"; import { RESULTS } from "./lib.mjs";
const J = (n) => JSON.parse(readFileSync(join(RESULTS, n), "utf8"));
const g = J("gallery.json"), p = J("public-site.json"), w = J("web-sweep.json"), f = J("web-flows.json");
const c = (arr, fn) => `${arr.filter(fn).length}/${arr.length} pass`;
console.log("GALLERY runs (he/en x light/dark x desktop/mobile)");
console.log(" axe:", c(g.matrix, (m) => !m.axe.length), "| contrast:", c(g.matrix, (m) => !m.contrast.length), "| targets>=24:", c(g.matrix, (m) => !m.targets24.length), "| targets>=44 (mobile only):", c(g.matrix.filter((m) => m.vp === "mobile"), (m) => !m.targets.length), "| no h-scroll:", c(g.matrix, (m) => !m.hscroll));
const kb = g.keyboard.flatMap((k) => [k.dialogOpen === 1, k.dialogFocusInside, k.focusTrapped, k.shiftTabInside, k.dialogClosedByEsc, k.focusRestored === "Open dialog", k.checkboxSpace, k.switchSpace, k.tabsSelected[1] === "true", k.radioArrow.endsWith("true"), k.tooltipOnFocus === 1, k.tooltipEsc === 0, k.tableSortAria[0] === "descending", k.sessionDialog?.role === "alertdialog", k.sessionEscCloses === false]);
console.log(" keyboard/overlay checks:", `${kb.filter(Boolean).length}/${kb.length} pass`);
const P = p.pages; console.log("PUBLIC SITE page runs (43 pages x 2 variants)");
console.log(" axe:", c(P, (x) => !x.axe.length), "| contrast:", c(P, (x) => !x.contrast.length), "| no h-scroll:", c(P, (x) => !x.hscroll), "| console/network clean:", c(P, (x) => !x.console.length && !x.failed.length), "| no third-party:", c(P, (x) => !x.thirdParty.length), "| targets>=24:", c(P, (x) => !x.targets24.length), "| 1 h1 & no heading jumps (desktop):", c(P.filter((x) => x.vp === "desktop" && x.path !== "/"), (x) => x.struct.h1 === 1 && !x.struct.jumps.length));
const cs = p.consent; console.log(" consent: no request before consent", cs.requestsBeforeConsent === 0, "| decline loads nothing", cs.requestsAfterDecline === 0, "| accept loads script", cs.requestsAfterAccept === 1, "| DNT honoured", cs.dntNoBanner && cs.dntNoRequests, "| equal-prominence buttons", cs.buttonsEqualProminence.same);
console.log(" forms:", p.forms.length, "forms; broken internal links excluding /app/:", p.links.broken.filter((b) => b.href !== "/app/").length, "; /app/ links:", p.links.broken.filter((b) => b.href === "/app/").length);
const V = Object.values(w.roles).flatMap((r) => r.variants); console.log("WEB route audits (mock API):", V.length);
console.log(" axe:", c(V, (x) => !x.axe.length), "| contrast:", c(V, (x) => !x.contrast.length), "| no h-scroll:", c(V, (x) => !x.hscroll), "| console/network clean:", c(V, (x) => !x.console.length && !x.failed.length), "| targets>=24:", c(V, (x) => !x.targets24.length));
console.log(" role guards (forbidden page, no content, no redirect loop):", `${w.guards.filter((x) => x.showsContent < 300).length}/${w.guards.length} pass`, "| anonymous redirects to /login:", `${w.anon.filter((a) => a.final && /^\/login\?next=/.test(a.final)).length}/${w.anon.filter((a) => a.final).length}`);
console.log("WEB flows:", `${f.steps.filter((s) => s.ok).length}/${f.steps.length} pass`, f.steps.filter((s) => !s.ok).map((s) => s.name));
