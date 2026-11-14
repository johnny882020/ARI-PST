// Small in-memory mock of the ARI-PST API (same origin, /api/v1) for e2e and local UI work.
// SERVE_DIST=1 also serves apps/web/dist with SPA fallback and the app's security headers.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { centers, diagnoses, seedSamples, seedUsers, staleness, ulid, PASSWORD, TOTP, RECOVERY, VERIFY_TOKEN } from "./data.mjs";

const PORT = Number(process.env.PORT ?? 3000);
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const K = 5;
const REQUIRED_APPROVALS = 2;
const COMMITTEE_SIZE = 3;

const state = {};
function reset() {
  state.users = seedUsers();
  state.samples = seedSamples();
  state.sessions = new Map(); // sid -> {userId, csrf, expiresAt}
  state.challenges = new Map(); // token -> {userId}
  state.resetTokens = new Map(); // single use
  state.emailTokens = new Map([[VERIFY_TOKEN, { userId: state.users.find((u) => u.email === "newuser@example.test").id }]]); // single use
  state.carts = new Map(); // userId -> items
  state.requests = [];
  state.votes = new Map(); // reqId -> Map(userId -> {vote, votedAt})
  state.decisions = new Map();
  state.jobs = new Map();
  state.audit = [];
  state.registrations = [
    { id: ulid("reg"), displayName: "Dr. Pending Applicant", institution: "Synthetic University", email: "pending@example.test", status: "pending", requestedAt: "2026-11-10T09:00:00Z" },
  ];
  state.kPolicies = [
    { id: "kp_default", fieldSet: "default", k: K, pendingChange: null },
    { id: "kp_center", fieldSet: "center_breakdown", k: 7, pendingChange: null },
  ];
  state.roleGrants = [];
  state.methods = [{ id: "mth_1", kind: "totp", name: "Authenticator app", addedAt: "2026-09-02T10:00:00Z", lastUsedAt: null }];
  const researcher = state.users[0];
  const mkReq = (status, extra = {}) => {
    const id = ulid("req");
    const r = {
      id, status, applicantUserId: researcher.id,
      researchQuestion: "Synthetic question about outcomes", applicantEthicsRef: "HEL-SYN-900",
      plannedUse: "Synthetic planned use", fundingSources: "Synthetic foundation",
      items: [{ id: ulid("itm"), criteria: { sampleType: ["ffpe"] }, shownCountBucket: "10-14" }],
      submittedAt: "2026-11-01T08:00:00Z", decidedAt: null, deliveredAt: null, createdAt: "2026-10-30T08:00:00Z", internal: {}, ...extra,
    };
    state.requests.push(r);
    return r;
  };
  mkReq("committee_review");
  mkReq("precheck");
  mkReq("closed", { closeReason: "delivered", deliveredAt: "2026-10-20T08:00:00Z", decidedAt: "2026-10-10T08:00:00Z" });
  // Approved and waiting for the coordinator: sample links, center answers, MTA/DTA and delivery (coordination screen).
  mkReq("approved", { decidedAt: "2026-11-05T08:00:00Z", items: [{ id: ulid("itm"), criteria: { sampleType: ["ffpe"] }, shownCountBucket: "10_plus" }] });
}
reset();

const now = () => new Date().toISOString();

// Identifier guard, same patterns as packages/domain/src/identifier-guard.ts (G1..G5). The mock answers like the API.
const ID_GUARDS = [
  /(?<![0-9])[0-9]{9}(?![0-9])/,
  /(?<![0-9])(\+?972|0)[- ]?[0-9]{1,2}[- ]?[0-9]{3}[- ]?[0-9]{4}(?![0-9])/,
  /[^\s@]+@[^\s@]+\.[^\s@]+/,
  /(?<![0-9])([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})(?![0-9])/,
  /(?<![0-9])[0-9]{7,}(?![0-9])/,
];
const looksIdentifying = (v) => typeof v === "string" && ID_GUARDS.some((re) => re.test(v.normalize("NFKC")));
const identifierProblem = (res, fields) => problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: fields.map((field) => ({ field, rule: "IDENTIFIER_SUSPECTED" })) });
// What an enrolment-only session (no second factor yet) may call. Mirrors ENROLLMENT_OPS in apps/api/src/http/route.ts.
const ENROLMENT_PATHS = new Set(["/auth/logout", "/auth/session", "/auth/enrol/totp", "/auth/enrol/totp/confirm", "/auth/enrol/webauthn/options", "/auth/enrol/webauthn/verify", "/me", "/session"]);
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function parseCookies(h) {
  const out = {};
  for (const p of (h ?? "").split(";")) {
    const [k, ...v] = p.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}
function send(res, status, body, headers = {}) {
  const isProblem = status >= 400;
  const data = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": isProblem ? "application/problem+json" : "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(data);
}
const problem = (res, status, code, title, extra = {}, headers = {}) =>
  send(res, status, { type: `/problems/${code.toLowerCase().replace(/_/g, "-")}`, title, status, code, traceId: `trace-${randomBytes(4).toString("hex")}`, ...extra }, headers);

function audit(actor, action, objectType, objectId, outcome = "success") {
  state.audit.unshift({
    seq: state.audit.length + 1, id: ulid("aud"), occurredAt: now(), actorUserId: actor?.id ?? null,
    actorRole: actor?.roles?.[0]?.role ?? null, action, objectType: objectType ?? null, objectId: objectId ?? null,
    centerId: null, outcome, traceId: null, details: {}, hash: createHash("sha256").update(String(state.audit.length) + action).digest("hex"),
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const b = await readBody(req);
  if (!b.length) return {};
  try { return JSON.parse(b.toString("utf8")); } catch { return {}; }
}

function sessionOf(req) {
  const sid = parseCookies(req.headers.cookie)["__Host-sid"];
  const s = sid && state.sessions.get(sid);
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) { state.sessions.delete(sid); return null; }
  return { sid, ...s, user: state.users.find((u) => u.id === s.userId) };
}
const rolesOf = (s) => s.user.roles.map((r) => r.role);
const has = (s, ...r) => rolesOf(s).some((x) => r.includes(x));
const sessionDto = (s) => ({
  userId: s.user.id, displayName: s.user.displayName, locale: s.user.locale, roles: s.user.roles,
  activeCenterId: s.user.roles.find((r) => r.centerId)?.centerId ?? null, expiresAt: s.expiresAt, csrfToken: s.csrf,
  mfaEnrolled: s.user.mfaEnrolled !== false,
});
function createSession(res, user) {
  const sid = randomBytes(16).toString("hex");
  const csrf = randomBytes(12).toString("hex");
  const ttl = user.shortSession ? 125_000 : 15 * 60_000;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  state.sessions.set(sid, { userId: user.id, csrf, expiresAt, ttl });
  res.setHeader("Set-Cookie", [
    `__Host-sid=${sid}; Path=/; Secure; HttpOnly; SameSite=Strict`,
    `__Host-csrf=${csrf}; Path=/; Secure; SameSite=Strict`,
  ]);
  return sessionDto({ user, csrf, expiresAt });
}

/* ------------------------------ search ------------------------------ */
function matches(s, f = {}) {
  const inList = (arr, v) => !arr || arr.length === 0 || arr.includes(v);
  const dxOk = !f.diagnosis?.length || f.diagnosis.some((d) => {
    if (d === s.diagnosisCode) return true;
    const t = diagnoses.find((x) => x.diagnosisCode === s.diagnosisCode);
    return t && (t.parentCode === d || diagnoses.find((x) => x.diagnosisCode === t.parentCode)?.parentCode === d);
  });
  return dxOk && inList(f.sampleType, s.sampleType) && inList(f.ageBand, s.ageBandAtDiagnosis) && inList(f.sex, s.sex) &&
    inList(f.centerId, s.sourceCenterId) && inList(f.timepoint, s.clinicalTimepoint) && inList(f.availability, s.availability) &&
    (!f.attachedData?.length || f.attachedData.every((a) => s.attachedData.includes(a)));
}
function freeText(s, q) {
  if (!q) return true;
  const ql = q.toLowerCase();
  const t = diagnoses.find((x) => x.diagnosisCode === s.diagnosisCode);
  return [t?.labelEn, t?.labelHe, s.sampleType].some((x) => x && x.toLowerCase().includes(ql));
}
function aggregate(body) {
  const n = state.samples.filter((s) => matches(s, body.filters) && freeText(s, body.q)).length;
  if (n < K) return { count: null, suppressed: true, label: "", k: K, resolvedFilters: body.filters ?? {} };
  // Coarsen: 5-9 band and then rounded to 5 above 100 (illustrative; server owns the rule).
  const exact = true;
  return { count: n, suppressed: false, label: String(n), k: K, resolvedFilters: body.filters ?? {}, exact };
}
function facets(body) {
  const base = state.samples.filter((s) => matches(s, body.filters) && freeText(s, body.q));
  const keyFor = { diagnosis: (s) => s.diagnosisCode, sampleType: (s) => s.sampleType, ageBand: (s) => s.ageBandAtDiagnosis, sex: (s) => s.sex, center: (s) => s.sourceCenterId, timepoint: (s) => s.clinicalTimepoint, availability: (s) => s.availability };
  const out = {};
  for (const f of body.facets) {
    if (f === "attachedData") {
      out[f] = ["wes", "wgs", "rna_seq", "mri", "digital_pathology", "redcap_clinical"].map((a) => bucket(a, base.filter((s) => s.attachedData.includes(a)).length));
      continue;
    }
    const counts = new Map();
    for (const s of base) counts.set(keyFor[f](s), (counts.get(keyFor[f](s)) ?? 0) + 1);
    const buckets = [];
    let merged = 0;
    for (const [k, c] of [...counts].sort((a, b) => b[1] - a[1])) {
      if (c >= K) buckets.push({ bucket: k, level: "value", count: c, suppressed: false });
      else { merged += c; buckets.push({ bucket: k, level: "value", count: null, suppressed: true }); }
    }
    if (merged >= K) buckets.push({ bucket: "other", level: "group_other", count: merged, suppressed: false });
    out[f] = buckets;
  }
  return { k: K, facets: out };
}
const bucket = (b, c) => (c >= K ? { bucket: b, level: "value", count: c, suppressed: false } : { bucket: b, level: "value", count: null, suppressed: true });

/* ------------------------------ requests ------------------------------ */
const STEPS = ["submitted", "precheck", "committee_review", "decision", "center_coordination", "mta_dta", "delivery", "closed"];
function stepsFor(r, forApplicant, viewerCenter = null) {
  const order = { submitted: 1, precheck: 2, needs_info: 2, committee_review: 3, appeal_review: 3, approved: 4, rejected: 4, center_coordination: 5, agreements: 6, delivery: 7, closed: 8 };
  const cur = r.status === "draft" ? 0 : order[r.status] ?? 0;
  return STEPS.map((k, i) => {
    const n = i + 1;
    let status = n < cur ? "done" : n === cur ? "in_progress" : "pending";
    if (r.status === "needs_info" && n === 2) status = "blocked";
    if (r.status === "closed" && n === 8) status = "done";
    if (r.status === "rejected" && n === 4) status = "done";
    if (r.status === "rejected" && n > 4) status = "skipped";
    const step = { stepKey: k, centerId: null, status, publicNote: r.publicNotes?.[k] ?? null, startedAt: status !== "pending" ? r.submittedAt : null, completedAt: status === "done" ? r.decidedAt ?? r.submittedAt : null };
    if (!forApplicant) step.internalNote = r.internal?.[k] ?? null;
    // Center-level rows replace the generic step for staff and the holding clinician (like apps/api buildSteps + RLS).
    const rows = !forApplicant && viewerCenter !== undefined ? Object.entries(r.centerSteps?.[k] ?? {}).filter(([c]) => viewerCenter === null || c === viewerCenter) : [];
    if (rows.length) return rows.map(([c, x]) => ({ stepKey: k, centerId: c, status: x.status, accepted: x.accepted ?? null, publicNote: x.publicNote ?? null, startedAt: x.startedAt, completedAt: x.completedAt ?? null, internalNote: null }));
    return [step];
  }).flat();
}
/** Center scope of a viewer: null = all centers (coordinator, committee), a center id = clinician, undefined = applicant. */
function centerScope(s) {
  if (has(s, "national_coordinator", "committee_member")) return null;
  if (has(s, "center_clinician")) return clinicianCenter(s);
  return undefined;
}
const clinicianCenter = (s) => s.user.roles.find((x) => x.role === "center_clinician")?.centerId ?? null;
const involves = (r, centerId) => !!r.centerSteps?.center_coordination?.[centerId];
function requestDto(r, s) {
  const applicant = has(s, "researcher_il", "researcher_intl");
  const { internal: _i, publicNotes: _p, ...rest } = r;
  const { links: _l, agreements: _a, centerSteps: _c, ...pub } = rest;
  return { ...pub, steps: stepsFor(r, applicant, applicant ? undefined : centerScope(s)) };
}
function canSeeRequest(r, s) {
  if (has(s, "national_coordinator", "committee_member")) return r.status !== "draft";
  if (has(s, "center_clinician")) return involves(r, clinicianCenter(s));
  return has(s, "researcher_il") && r.applicantUserId === s.user.id;
}
const reqById = (id) => state.requests.find((r) => r.id === id);

function csvRows(text) {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(","));
}

/* ------------------------------ router ------------------------------ */
async function handleApi(req, res, url) {
  const method = req.method;
  const path = url.pathname.replace(/^\/api\/v1/, "") || "/";
  const q = url.searchParams;
  const cookies = parseCookies(req.headers.cookie);
  // Pre-session CSRF cookie so login can double-submit as well.
  if (!cookies["__Host-csrf"]) res.setHeader("Set-Cookie", `__Host-csrf=${randomBytes(12).toString("hex")}; Path=/; Secure; SameSite=Strict`);

  if (path === "/readyz" || path === "/livez") return send(res, 200, { status: "ok", version: "mock-0.1.0" });
  if (path === "/__reset" && method === "POST") { reset(); return send(res, 200, { ok: true }); }
  if (path === "/csp-report" || path === "/client-errors") { await readBody(req); res.writeHead(204); return res.end(); }

  // Public: diagnoses vocab; registration; auth.
  if (path === "/diagnoses" && method === "GET") return send(res, 200, { items: diagnoses });
  if (path === "/auth/register" && method === "POST") {
    const b = await readJson(req);
    if (!b.email || !b.displayName || !b.institution) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: !b.email ? "email" : !b.displayName ? "displayName" : "institution", rule: "REQUIRED" }] });
    state.registrations.push({ id: ulid("reg"), displayName: b.displayName, institution: b.institution, email: b.email, status: "pending", requestedAt: now() });
    res.writeHead(202); return res.end();
  }
  if (path === "/auth/verify-email" && method === "POST") {
    // Confirms the address with the emailed token and sets the first password. Single use.
    const b = await readJson(req);
    const t = typeof b.token === "string" ? state.emailTokens.get(b.token) : undefined;
    if (!t) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "token", rule: "FORMAT" }] });
    if (!b.password) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "password", rule: "REQUIRED" }] });
    if (typeof b.password !== "string" || b.password.length < 12 || b.password.length > 128) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "password", rule: "LENGTH" }] });
    if (/^(.)\1+$/.test(b.password)) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "password", rule: "REPEATED" }] });
    state.emailTokens.delete(b.token);
    const u = state.users.find((x) => x.id === t.userId);
    u.password = b.password; u.status = "active";
    audit(u, "auth.password.change", "user", u.id);
    res.writeHead(204, { "cache-control": "no-store" }); return res.end();
  }
  // Password reset: always 202, never tells whether the address exists. The mock prints the link to the console.
  if (path === "/auth/password-reset/request" && method === "POST") {
    const b = await readJson(req);
    const u = state.users.find((x) => x.email === String(b.email ?? "").toLowerCase() && x.status === "active");
    if (u) { const tok = randomBytes(16).toString("hex"); state.resetTokens.set(tok, { userId: u.id }); console.log(`[mock mail] /reset-password?token=${tok}`); }
    return send(res, 202, { accepted: true });
  }
  if (path === "/auth/password-reset/confirm" && method === "POST") {
    const b = await readJson(req);
    const t = typeof b.token === "string" ? state.resetTokens.get(b.token) : undefined;
    if (!t) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "token", rule: "FORMAT" }] });
    if (typeof b.password !== "string" || b.password.length < 12 || b.password.length > 128) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "password", rule: "LENGTH" }] });
    state.resetTokens.delete(b.token);
    const u = state.users.find((x) => x.id === t.userId); u.password = b.password;
    for (const [sid, rec] of state.sessions) if (rec.userId === u.id) state.sessions.delete(sid);
    res.writeHead(204, { "cache-control": "no-store" }); return res.end();
  }
  if (path === "/auth/login" && method === "POST") {
    const b = await readJson(req);
    const u = state.users.find((x) => x.email === String(b.email).toLowerCase());
    if (!u || u.status !== "active" || b.password !== (u.password ?? PASSWORD)) return problem(res, 401, "INVALID_CREDENTIALS", "Invalid credentials");
    const token = randomBytes(12).toString("hex");
    state.challenges.set(token, { userId: u.id });
    // No second factor yet: the client completes verifyMfa with only the token and gets an enrolment-only session.
    if (u.mfaEnrolled === false) return send(res, 200, { challengeToken: token, factors: [], enrollmentRequired: true });
    return send(res, 200, { challengeToken: token, factors: ["totp", "webauthn"] });
  }
  if (path === "/auth/mfa/verify" && method === "POST") {
    const b = await readJson(req);
    const c = state.challenges.get(b.challengeToken);
    if (!c) return problem(res, 401, "UNAUTHENTICATED", "Not authenticated");
    const u = state.users.find((x) => x.id === c.userId);
    if (u.mfaEnrolled === false) { if (b.totpCode || b.webauthnAssertion || b.recoveryCode) return problem(res, 401, "UNAUTHENTICATED", "Not authenticated"); }
    else if (b.totpCode !== TOTP && !b.webauthnAssertion) return problem(res, 401, "INVALID_MFA_CODE", "Invalid code");
    state.challenges.delete(b.challengeToken);
    audit(u, "auth.login", "user", u.id);
    return send(res, 200, createSession(res, u));
  }
  if (path === "/auth/mfa/recovery" && method === "POST") {
    const b = await readJson(req);
    const c = state.challenges.get(b.challengeToken);
    if (!c || b.recoveryCode !== RECOVERY) return problem(res, 401, "INVALID_MFA_CODE", "Invalid code");
    state.challenges.delete(b.challengeToken);
    return send(res, 200, createSession(res, state.users.find((x) => x.id === c.userId)));
  }
  if (path === "/auth/webauthn/options" && method === "POST") {
    return send(res, 200, { challenge: Buffer.from("synthetic-challenge").toString("base64url"), timeout: 60000, rpId: "localhost", userVerification: "preferred", allowCredentials: [] });
  }

  const s = sessionOf(req);
  if (!s) return problem(res, 401, "UNAUTHENTICATED", "Not authenticated");

  // CSRF double-submit on unsafe methods.
  if (!SAFE.has(method) && req.headers["x-csrf-token"] !== s.csrf) return problem(res, 403, "CSRF_INVALID", "CSRF token missing or invalid");
  if (s.user.mfaEnrolled === false && !ENROLMENT_PATHS.has(path)) return problem(res, 401, "STEP_UP_REQUIRED", "Re-authentication required");

  if (path === "/auth/logout" && method === "POST") {
    state.sessions.delete(s.sid);
    res.writeHead(204, { "set-cookie": ["__Host-sid=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0"], "clear-site-data": '"cache", "storage"' });
    return res.end();
  }
  if (path === "/auth/session" && method === "GET") return send(res, 200, sessionDto(s));
  if (path === "/session/extend" && method === "POST") {
    const rec = state.sessions.get(s.sid);
    rec.expiresAt = new Date(Date.now() + (rec.ttl ?? 900_000)).toISOString();
    return send(res, 200, sessionDto({ user: s.user, csrf: s.csrf, expiresAt: rec.expiresAt }));
  }
  if (path === "/auth/methods" && method === "GET") return send(res, 200, { items: state.methods });
  if (path === "/auth/recovery-codes" && method === "GET") return send(res, 200, { unused: state.recoveryUnused ?? 10 });
  if (path === "/auth/recovery-codes" && method === "POST") { state.recoveryUnused = 10; return send(res, 200, { recoveryCodes: Array.from({ length: 10 }, (_, i) => `SYNTH-${String(i + 1).padStart(4, "0")}-CODE`) }); }
  if (path === "/auth/password" && method === "POST") {
    const b = await readJson(req);
    if (b.currentPassword !== (s.user.password ?? PASSWORD)) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "currentPassword", rule: "FORMAT" }] });
    s.user.password = b.newPassword; res.writeHead(204); return res.end();
  }
  if (path === "/auth/enrol/totp" && method === "POST") return send(res, 200, { otpauthUri: "otpauth://totp/ARI-PST:synthetic?secret=JBSWY3DPEHPK3PXP&issuer=ARI-PST", secret: "JBSWY3DPEHPK3PXP" });
  if (path === "/auth/enrol/totp/confirm" && method === "POST") {
    const b = await readJson(req);
    if (b.code !== TOTP) return problem(res, 422, "INVALID_MFA_CODE", "Invalid code");
    s.user.mfaEnrolled = true;
    return send(res, 200, { recoveryCodes: Array.from({ length: 10 }, (_, i) => `SYNTH-${String(i + 1).padStart(4, "0")}-CODE`) });
  }
  if (path === "/auth/enrol/webauthn/options" && method === "POST") return send(res, 200, { challenge: "c3ludGg", rp: { name: "ARI-PST" }, user: { id: "dXNy", name: "synthetic", displayName: "Synthetic" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }] });
  if (path === "/auth/enrol/webauthn/verify" && method === "POST") { s.user.mfaEnrolled = true; return send(res, 200, { recoveryCodes: ["SYNTH-0001-CODE"] }); }

  /* samples */
  if (path === "/samples" && method === "GET") {
    if (!has(s, "center_clinician", "national_coordinator")) { audit(s.user, "sample.list", "sample", null, "denied"); return problem(res, 403, "FORBIDDEN", "Role not allowed"); }
    const own = rolesOf(s).includes("national_coordinator") ? null : s.user.roles.find((r) => r.centerId)?.centerId;
    let items = state.samples.filter((x) => !own || x.sourceCenterId === own);
    if (q.get("diagnosisCode")) items = items.filter((x) => x.diagnosisCode === q.get("diagnosisCode"));
    if (q.get("sampleType")) items = items.filter((x) => x.sampleType === q.get("sampleType"));
    if (q.get("availability")) items = items.filter((x) => x.availability === q.get("availability"));
    if (q.get("staleness")) items = items.filter((x) => staleness(x) === q.get("staleness"));
    if (q.get("centerId")) items = items.filter((x) => x.sourceCenterId === q.get("centerId"));
    const limit = Number(q.get("limit") ?? 25);
    const off = Number(q.get("cursor") ?? 0);
    const page = items.slice(off, off + limit).map((x) => ({ ...x, staleness: staleness(x) }));
    audit(s.user, "sample.list", "sample", null);
    return send(res, 200, { items: page, nextCursor: off + limit < items.length ? String(off + limit) : null });
  }
  if (path === "/samples" && method === "POST") {
    if (!has(s, "national_coordinator")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    const b = await readJson(req);
    const missing = ["sourceCenterId", "diagnosisCode", "ageBandAtDiagnosis", "sex", "sampleType", "availability", "clinicalTimepoint", "collectionMonth"].filter((f) => !b[f]);
    if (missing.length) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: missing.map((field) => ({ field, rule: "REQUIRED" })) });
    const sm = { sampleCode: ulid("smp"), consentStatus: "unknown", attachedData: [], contactRef: "Center research coordinator", ethicsApprovalRef: null, ...b, createdAt: now(), updatedAt: now(), lastVerifiedAt: now() };
    state.samples.unshift(sm);
    audit(s.user, "sample.create", "sample", sm.sampleCode);
    return send(res, 201, { ...sm, staleness: "fresh" });
  }
  let m;
  if ((m = path.match(/^\/samples\/(smp_[0-9A-Z]+)$/)) && method === "GET") {
    const sm = state.samples.find((x) => x.sampleCode === m[1]);
    const own = rolesOf(s).includes("national_coordinator") ? null : s.user.roles.find((r) => r.centerId)?.centerId;
    if (!has(s, "center_clinician", "national_coordinator") || !sm || (own && sm.sourceCenterId !== own)) return problem(res, 404, "NOT_FOUND", "Not found");
    return send(res, 200, { ...sm, staleness: staleness(sm) }, { etag: `"${sm.updatedAt}"` });
  }
  if ((m = path.match(/^\/samples\/(smp_[0-9A-Z]+)\/verify$/)) && method === "POST") {
    const sm = state.samples.find((x) => x.sampleCode === m[1]);
    if (!sm || !has(s, "center_clinician", "national_coordinator")) return problem(res, 404, "NOT_FOUND", "Not found");
    sm.lastVerifiedAt = now();
    audit(s.user, "sample.verify", "sample", sm.sampleCode);
    return send(res, 200, { ...sm, staleness: staleness(sm) });
  }
  if ((m = path.match(/^\/samples\/(smp_[0-9A-Z]+)\/flag$/)) && method === "POST") {
    await readBody(req); audit(s.user, "sample.flag", "sample", m[1]); res.writeHead(204); return res.end();
  }
  if ((m = path.match(/^\/centers\/(ctr_[0-9A-Z]+)\/staleness$/)) && method === "GET") {
    const list = state.samples.filter((x) => x.sourceCenterId === m[1]);
    return send(res, 200, { centerId: m[1], samplesTotal: list.length, samplesAvailable: list.filter((x) => x.availability === "available").length, staleCount: list.filter((x) => staleness(x) === "stale").length, dueSoonCount: list.filter((x) => staleness(x) === "due_soon").length, missingEthicsLink: 0, slaDays: 180, lastUpdateAt: list[0]?.updatedAt ?? null });
  }
  if (path === "/centers" && method === "GET") return send(res, 200, { items: centers });
  if (path === "/ethics-approvals" && method === "GET") return send(res, 200, { items: [{ id: "eth_1", centerId: centers[0].id, approvalRef: "HEL-SYN-100", kind: "helsinki_committee", status: "active" }] });

  /* search */
  if (path === "/search/aggregate" && method === "POST") {
    if (has(s, "system_admin")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    audit(s.user, "search.aggregate", "search", null);
    return send(res, 200, aggregate(await readJson(req)));
  }
  if (path === "/search/facets" && method === "POST") {
    if (has(s, "system_admin")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    return send(res, 200, facets(await readJson(req)));
  }
  if (path === "/search/suggest" && method === "GET") {
    const term = (q.get("q") ?? "").toLowerCase();
    const items = diagnoses.filter((d) => d.level !== "group" && (d.labelEn.toLowerCase().includes(term) || d.labelHe.includes(term))).map((d) => ({ diagnosisCode: d.diagnosisCode, score: 0.9, matchedVia: "fts", labelHe: d.labelHe, labelEn: d.labelEn }));
    return send(res, 200, { items });
  }

  /* cart (server side) */
  if (path === "/request-cart" && method === "GET") {
    if (!has(s, "researcher_il")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    return send(res, 200, { items: state.carts.get(s.user.id) ?? [], limit: 10 });
  }
  if (path === "/request-cart/items" && method === "POST") {
    if (!has(s, "researcher_il")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    const b = await readJson(req);
    const items = state.carts.get(s.user.id) ?? [];
    if (items.length >= 10) return problem(res, 409, "CART_LIMIT", "Cart limit reached");
    const agg = aggregate({ filters: b.criteria, q: b.q });
    items.push({ id: ulid("itm"), criteria: b.criteria ?? {}, snapshot: { count: agg.count, suppressed: agg.suppressed, label: agg.label }, addedAt: now() });
    state.carts.set(s.user.id, items);
    return send(res, 201, { items, limit: 10 });
  }
  if ((m = path.match(/^\/request-cart\/items\/(itm_[0-9A-Z]+)$/)) && method === "DELETE") {
    const items = (state.carts.get(s.user.id) ?? []).filter((i) => i.id !== m[1]);
    state.carts.set(s.user.id, items);
    return send(res, 200, { items, limit: 10 });
  }
  if (path === "/request-cart/start" && method === "POST") {
    const items = state.carts.get(s.user.id) ?? [];
    if (!items.length) return problem(res, 409, "CART_EMPTY", "Cart is empty");
    const r = { id: ulid("req"), status: "draft", applicantUserId: s.user.id, items: items.map((i) => ({ id: i.id, criteria: i.criteria, shownCountBucket: i.snapshot.label })), submittedAt: null, decidedAt: null, deliveredAt: null, createdAt: now(), internal: {} };
    state.requests.push(r);
    state.carts.set(s.user.id, []);
    return send(res, 201, requestDto(r, s));
  }

  /* requests */
  if (path === "/requests" && method === "GET") {
    const list0 = state.requests.filter((r) => (has(s, "researcher_il") ? r.applicantUserId === s.user.id : canSeeRequest(r, s)));
    const list = q.get("status") ? list0.filter((r) => r.status === q.get("status")) : list0;
    return send(res, 200, { items: list.map((r) => requestDto(r, s)), nextCursor: null });
  }
  if (path === "/requests" && method === "POST") {
    if (!has(s, "researcher_il")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    const b = await readJson(req);
    const r = { id: ulid("req"), status: "draft", applicantUserId: s.user.id, ...b, items: [], submittedAt: null, decidedAt: null, deliveredAt: null, createdAt: now(), internal: {} };
    state.requests.push(r);
    return send(res, 201, requestDto(r, s));
  }
  if ((m = path.match(/^\/requests\/(req_[0-9A-Z]+)(\/.*)?$/))) {
    const r = reqById(m[1]);
    const sub = m[2] ?? "";
    if (!r || (!canSeeRequest(r, s) && !(r.status === "draft" && r.applicantUserId === s.user.id))) return problem(res, 404, "NOT_FOUND", "Not found");
    if (sub === "" && method === "GET") return send(res, 200, requestDto(r, s));
    if (sub === "" && method === "PATCH") {
      if (r.status !== "draft") return problem(res, 409, "CONFLICT", "Request is not a draft");
      const b = await readJson(req);
      const hits = ["researchQuestion", "plannedUse", "fundingSources"].filter((f) => looksIdentifying(b[f]));
      if (hits.length) return identifierProblem(res, hits);
      for (const f of ["researchQuestion", "applicantEthicsRef", "plannedUse", "fundingSources"]) if (f in b) r[f] = b[f];
      return send(res, 200, requestDto(r, s));
    }
    if (sub === "/submit" && method === "POST") {
      const missing = ["researchQuestion", "applicantEthicsRef", "plannedUse", "fundingSources"].filter((f) => !r[f]);
      if (missing.length) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: missing.map((field) => ({ field, rule: "REQUIRED" })) });
      if (r.status === "draft") { r.status = "precheck"; r.submittedAt = now(); audit(s.user, "request.submit", "request", r.id); }
      return send(res, 200, requestDto(r, s));
    }
    if (sub === "/steps" && method === "GET") return send(res, 200, { items: stepsFor(r, has(s, "researcher_il"), has(s, "researcher_il") ? undefined : centerScope(s)) });
    if ((m = sub.match(/^\/steps\/(\w+)$/)) && method === "PATCH") {
      // Same rules as the API + database: coordinator answers on behalf (needs centerId), records MTA/DTA; only the holding clinician delivers.
      if (!has(s, "national_coordinator", "center_clinician")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
      const key = m[1];
      const b = await readJson(req);
      if (looksIdentifying(b.publicNote) || looksIdentifying(b.internalNote) || looksIdentifying(b.agreement?.docRef)) return identifierProblem(res, ["publicNote"]);
      const centerId = has(s, "center_clinician") ? clinicianCenter(s) : b.centerId;
      if (!centerId) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "centerId", rule: "REQUIRED" }] });
      const invalid = () => problem(res, 409, "REQUEST_STATE_INVALID", "Not allowed in this state");
      const rows = (r.centerSteps ??= { center_coordination: {}, delivery: {} });
      if (key === "center_coordination") {
        if (r.status !== "center_coordination") return invalid();
        const row = rows.center_coordination[centerId];
        if (!row || row.status === "done") return problem(res, 404, "NOT_FOUND", "Not found");
        if (typeof b.accepted !== "boolean") return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "accepted", rule: "REQUIRED" }] });
        Object.assign(row, { status: "done", accepted: b.accepted, publicNote: b.publicNote ?? null, completedAt: now() });
        const all = Object.values(rows.center_coordination);
        if (all.every((x) => x.status === "done")) {
          if (all.some((x) => x.accepted)) r.status = "agreements";
          else { r.status = "closed"; r.closeReason = "rejected"; }
        }
        return send(res, 200, { stepKey: key, centerId, status: "done", accepted: b.accepted, publicNote: row.publicNote, startedAt: row.startedAt, completedAt: row.completedAt });
      }
      if (key === "mta_dta") {
        if (!has(s, "national_coordinator")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
        if (r.status !== "agreements") return invalid();
        if (!rows.center_coordination[centerId]?.accepted) return invalid();
        const a = b.agreement ?? {};
        const status = a.status ?? "signed";
        const month = a.signedMonth ?? (status === "signed" ? now().slice(0, 7) : null);
        if (!/^[A-Za-z0-9._/-]{3,64}$/.test(a.docRef ?? "") || !["mta", "dta"].includes(a.kind) || (month && month > now().slice(0, 7))) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "agreement", rule: "FORMAT" }] });
        r.agreements = (r.agreements ?? []).filter((x) => !(x.centerId === centerId && x.kind === a.kind));
        r.agreements.push({ centerId, kind: a.kind, docRef: a.docRef, status, signedMonth: month });
        return send(res, 200, { stepKey: key, centerId, status: status === "signed" ? "done" : "in_progress", publicNote: null, startedAt: null, completedAt: null });
      }
      if (key === "delivery") {
        if (!has(s, "center_clinician")) return problem(res, 403, "FORBIDDEN", "Only the holding center confirms delivery");
        if (r.status !== "delivery") return invalid();
        const row = rows.delivery[centerId];
        if (!row || row.status === "done") return problem(res, 404, "NOT_FOUND", "Not found");
        Object.assign(row, { status: "done", completedAt: now() });
        if (Object.values(rows.delivery).every((x) => x.status === "done")) { r.status = "closed"; r.closeReason = "delivered"; r.deliveredAt = now(); audit(s.user, "request.deliver", "request", r.id); }
        return send(res, 200, { stepKey: key, centerId, status: "done", publicNote: null, startedAt: row.startedAt, completedAt: row.completedAt });
      }
      return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "stepKey", rule: "VOCAB" }] });
    }
    if (sub === "/resolved-samples" && method === "GET") {
      if (!has(s, "national_coordinator", "center_clinician")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
      const scope = centerScope(s);
      return send(res, 200, { items: (r.links ?? []).filter((l) => scope === null || l.centerId === scope) });
    }
    if (sub === "/resolved-samples" && method === "PUT") {
      if (!has(s, "national_coordinator")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
      if (!["approved", "center_coordination"].includes(r.status)) return problem(res, 409, "REQUEST_STATE_INVALID", "Not allowed in this state");
      const b = await readJson(req);
      if (!r.items.some((i) => i.id === b.itemId)) return problem(res, 404, "NOT_FOUND", "Not found");
      const found = (b.sampleIds ?? []).map((id) => state.samples.find((x) => x.sampleCode === id));
      if (found.some((x) => !x)) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "sampleIds", rule: "VOCAB" }] });
      r.links = [...(r.links ?? []).filter((l) => l.itemId !== b.itemId), ...found.map((x) => ({ itemId: b.itemId, sampleId: x.sampleCode, centerId: x.sourceCenterId }))];
      res.writeHead(204); return res.end();
    }
    if (sub === "/agreements" && method === "GET") {
      if (!has(s, "national_coordinator", "committee_member", "center_clinician")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
      const scope = centerScope(s);
      return send(res, 200, { items: (r.agreements ?? []).filter((a) => scope === null || a.centerId === scope) });
    }
    if (sub === "/transition" && method === "POST") {
      if (!has(s, "national_coordinator")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
      const b = await readJson(req);
      const rows = (r.centerSteps ??= { center_coordination: {}, delivery: {} });
      if (b.to === "center_coordination" && r.status === "approved") {
        if (!(r.links ?? []).length) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "$", rule: "FORMAT" }] });
        for (const c of new Set(r.links.map((l) => l.centerId))) rows.center_coordination[c] = { status: "pending", accepted: null, startedAt: now() };
        r.status = "center_coordination";
        return send(res, 200, requestDto(r, s));
      }
      if (b.to === "delivery" && r.status === "agreements") {
        const acc = Object.entries(rows.center_coordination).filter(([, x]) => x.accepted).map(([c]) => c);
        if (acc.some((c) => !(r.agreements ?? []).some((a) => a.centerId === c && a.status === "signed"))) return problem(res, 409, "REQUEST_STATE_INVALID", "Agreements missing");
        for (const c of acc) rows.delivery[c] = { status: "pending", startedAt: now() };
        r.status = "delivery";
        return send(res, 200, requestDto(r, s));
      }
      return problem(res, 409, "REQUEST_STATE_INVALID", "Not allowed in this state");
    }
    if (sub === "/precheck" && method === "POST") {
      if (!has(s, "national_coordinator")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
      const b = await readJson(req);
      if (looksIdentifying(b.note)) return identifierProblem(res, ["note"]);
      if (b.outcome === "reject" && !b.reasonCode) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "reasonCode", rule: "REQUIRED" }] });
      r.status = { forward: "committee_review", ask_info: "needs_info", reject: "rejected" }[b.outcome] ?? r.status;
      if (b.note) r.publicNotes = { ...(r.publicNotes ?? {}), precheck: b.note };
      audit(s.user, "request.precheck", "request", r.id);
      return send(res, 200, requestDto(r, s));
    }
    if (sub === "/respond" && method === "POST") {
      const b = await readJson(req);
      if (looksIdentifying(b.message)) return identifierProblem(res, ["message"]);
      if (r.status === "needs_info") r.status = "precheck";
      return send(res, 200, requestDto(r, s));
    }
    if (sub === "/vote-tally" && method === "GET") {
      if (!has(s, "committee_member", "national_coordinator")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
      return send(res, 200, tally(r.id, s.user.id));
    }
    if (sub === "/votes" && method === "PUT") {
      if (!has(s, "committee_member")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
      if (r.status !== "committee_review") return problem(res, 409, "CONFLICT", "Request is not in committee review");
      const b = await readJson(req);
      const vm = state.votes.get(r.id) ?? new Map();
      vm.set(s.user.id, { vote: b.vote, votedAt: now() });
      state.votes.set(r.id, vm);
      audit(s.user, "request.vote", "request", r.id);
      return send(res, 200, { requestId: r.id, vote: b.vote, votedAt: now() });
    }
    if (sub === "/decisions" && method === "GET") return send(res, 200, { items: state.decisions.get(r.id) ?? [] });
    if (sub === "/decisions" && method === "POST") {
      if (!has(s, "committee_member")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
      const b = await readJson(req);
      const t = tally(r.id, s.user.id);
      if (b.outcome === "approved" && t.approve < REQUIRED_APPROVALS) return problem(res, 409, "QUORUM_NOT_MET", "Not enough approving votes");
      r.status = { approved: "approved", rejected: "rejected", needs_info: "needs_info" }[b.outcome];
      r.decidedAt = now();
      const d = { id: ulid("dec"), outcome: b.outcome, rationale: b.rationale, decidedAt: now() };
      state.decisions.set(r.id, [...(state.decisions.get(r.id) ?? []), d]);
      audit(s.user, "request.decide", "request", r.id);
      return send(res, 201, d);
    }
  }
  function tally(reqId, uid) {
    const vm = state.votes.get(reqId) ?? new Map();
    const c = { approve: 0, reject: 0, abstain: 0 };
    for (const v of vm.values()) c[v.vote]++;
    return { required: REQUIRED_APPROVALS, members: COMMITTEE_SIZE, ...c, myVote: vm.get(uid)?.vote ?? null, conflictDeclared: false };
  }

  /* import */
  if (path === "/import-jobs" && method === "GET") {
    if (!has(s, "national_coordinator")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    return send(res, 200, { items: [...state.jobs.values()].map((j) => j.dto).reverse(), nextCursor: null });
  }
  if (path === "/import-jobs" && method === "POST") {
    if (!has(s, "national_coordinator")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    const raw = await readBody(req);
    const ct = req.headers["content-type"] ?? "";
    const bm = ct.match(/boundary=(.+)$/);
    const text = raw.toString("utf8");
    if (raw.length > 10 * 1024 * 1024) return problem(res, 413, "TOO_LARGE", "File too large");
    let content = "";
    if (bm) {
      const part = text.split(`--${bm[1]}`).find((p) => /name="file"/.test(p)) ?? "";
      content = part.split(/\r?\n\r?\n/).slice(1).join("\n\n").replace(/\r?\n$/, "");
    }
    const rows = csvRows(content);
    const header = rows[0] ?? [];
    const body = rows.slice(1);
    if (!header.length || body.length === 0) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "file", rule: "FORMAT" }] });
    const results = body.map((cells, i) => {
      const rec = Object.fromEntries(header.map((h, j) => [h.trim(), (cells[j] ?? "").trim()]));
      const issues = [];
      if (!rec.diagnosis_code) issues.push({ field: "diagnosis_code", rule: "REQUIRED", severity: "error" });
      if (rec.sample_type && !["ffpe", "frozen", "csf", "plasma_or_liquid_biopsy", "isolated_dna_rna"].includes(rec.sample_type)) issues.push({ field: "sample_type", rule: "VOCAB", severity: "error" });
      if (rec.ethics_ref === "") issues.push({ field: "ethics_ref", rule: "ETHICS_MISSING", severity: "warning" });
      const outcome = issues.some((x) => x.severity === "error") ? "rejected" : issues.length ? "warning" : "accepted";
      return { rowNo: i + 1, outcome, action: outcome === "rejected" ? "none" : "create", sampleCode: null, issues };
    });
    const id = ulid("imp");
    const dto = { id, mode: "dry_run", format: "csv", status: "validated", parentJobId: null, fileSha256: createHash("sha256").update(content).digest("hex"), totalRows: results.length, acceptedRows: results.filter((x) => x.outcome === "accepted").length, warningRows: results.filter((x) => x.outcome === "warning").length, rejectedRows: results.filter((x) => x.outcome === "rejected").length, createdAt: now(), finishedAt: now(), expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() };
    state.jobs.set(id, { dto, results });
    audit(s.user, "import.dry_run", "import_job", id);
    return send(res, 202, dto);
  }
  if ((m = path.match(/^\/import-jobs\/(imp_[0-9A-Z]+)(\/.*)?$/))) {
    const j = state.jobs.get(m[1]);
    if (!has(s, "national_coordinator") || !j) return problem(res, 404, "NOT_FOUND", "Not found");
    const sub = m[2] ?? "";
    if (sub === "" && method === "GET") return send(res, 200, j.dto);
    if (sub === "/rows" && method === "GET") {
      const items = j.results.filter((r) => !q.get("outcome") || r.outcome === q.get("outcome"));
      return send(res, 200, { items, nextCursor: null });
    }
    if (sub === "/report" && method === "GET") {
      const csv = ["row_no,field,rule", ...j.results.flatMap((r) => r.issues.map((i) => `${r.rowNo},${i.field},${i.rule}`))].join("\n");
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ari-import-report-${m[1].slice(4, 12)}.csv"`, "x-content-type-options": "nosniff", "cache-control": "no-store" });
      audit(s.user, "import.report_download", "import_job", j.dto.id);
      return res.end(csv);
    }
    if (sub === "/commit" && method === "POST") {
      const b = await readJson(req);
      if (b.fileSha256 !== j.dto.fileSha256) return problem(res, 409, "CONFLICT", "File changed");
      const id = ulid("imp");
      const dto = { ...j.dto, id, mode: "commit", status: "committed", parentJobId: j.dto.id };
      state.jobs.set(id, { dto, results: j.results });
      return send(res, 202, dto);
    }
  }
  if ((m = path.match(/^\/import-templates\/(csv|xlsx)$/)) && method === "GET") {
    res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="ari-import-template.csv"', "x-content-type-options": "nosniff" });
    return res.end("diagnosis_code,sample_type,age_band,sex,availability,timepoint,collection_month,ethics_ref\n");
  }

  /* admin */
  if (path === "/audit-events" && method === "GET") {
    if (!has(s, "system_admin")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    let items = state.audit;
    if (q.get("action")) items = items.filter((e) => e.action === q.get("action"));
    if (q.get("outcome")) items = items.filter((e) => e.outcome === q.get("outcome"));
    return send(res, 200, { items: items.slice(0, 100), nextCursor: null });
  }
  if (path === "/audit-events/verify" && method === "POST") { await readBody(req); return send(res, 200, { intact: true, firstBrokenSeq: null }); }
  if (path === "/users" && method === "GET") {
    if (!has(s, "system_admin", "national_coordinator")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    return send(res, 200, { items: state.users.map(({ shortSession: _s, ...u }) => u), nextCursor: null });
  }
  if (path === "/users" && method === "POST") {
    if (!has(s, "system_admin")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    const b = await readJson(req);
    const u = { id: ulid("usr"), email: b.email, displayName: b.displayName, locale: b.locale ?? "he", status: "invited", roles: [{ id: ulid("rol"), role: b.role, centerId: b.centerId ?? null }], lastLoginAt: null };
    state.users.push(u);
    return send(res, 201, u);
  }
  if ((m = path.match(/^\/users\/(usr_[0-9A-Z]+)$/)) && method === "PATCH") {
    if (!has(s, "system_admin")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    const u = state.users.find((x) => x.id === m[1]);
    if (!u) return problem(res, 404, "NOT_FOUND", "Not found");
    Object.assign(u, await readJson(req));
    return send(res, 200, u);
  }
  if (path === "/registrations" && method === "GET") {
    if (!has(s, "national_coordinator")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    return send(res, 200, { items: state.registrations });
  }
  if ((m = path.match(/^\/registrations\/([\w-]+)\/decision$/)) && method === "POST") {
    if (!has(s, "national_coordinator")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    const r = state.registrations.find((x) => x.id === m[1]);
    if (!r || r.status !== "pending") return problem(res, 409, "CONFLICT", "Already decided");
    r.status = (await readJson(req)).outcome;
    audit(s.user, "registration.decide", "registration", r.id);
    return send(res, 200, r);
  }
  if (path === "/k-policies" && method === "GET") {
    if (!has(s, "system_admin")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    return send(res, 200, { items: state.kPolicies });
  }
  if ((m = path.match(/^\/k-policies\/([\w]+)\/changes$/)) && method === "POST") {
    if (!has(s, "system_admin")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    const b = await readJson(req);
    if (!Number.isInteger(b.k) || b.k < 5 || !b.reason) return problem(res, 422, "VALIDATION_FAILED", "Validation failed", { errors: [{ field: "k", rule: "RANGE" }] });
    const p = state.kPolicies.find((x) => x.id === m[1]);
    p.pendingChange = { id: ulid("kpc"), proposedK: b.k, proposedByUserId: s.user.id, reason: b.reason };
    audit(s.user, "k_policy.propose", "k_policy", p.id);
    return send(res, 202, p);
  }
  if ((m = path.match(/^\/k-policy-changes\/(kpc_[0-9A-Z]+)\/approve$/)) && method === "POST") {
    const p = state.kPolicies.find((x) => x.pendingChange?.id === m[1]);
    if (!has(s, "system_admin") || !p) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    if (p.pendingChange.proposedByUserId === s.user.id) return problem(res, 409, "SOD_VIOLATION", "Second approver must be a different person");
    p.k = p.pendingChange.proposedK; p.pendingChange = null;
    audit(s.user, "k_policy.approve", "k_policy", p.id);
    return send(res, 200, p);
  }
  if (path === "/role-grant-requests" && method === "GET") {
    if (!has(s, "system_admin")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    return send(res, 200, { items: state.roleGrants });
  }
  if (path === "/role-grant-requests" && method === "POST") {
    if (!has(s, "system_admin")) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    const b = await readJson(req);
    if (b.role === "committee_member" && state.users.find((u) => u.id === b.userId)?.roles.some((r) => r.role === "system_admin")) return problem(res, 409, "SOD_VIOLATION", "Separation of duties");
    const g = { id: ulid("rgr"), userId: b.userId, role: b.role, centerId: b.centerId ?? null, reason: b.reason, requestedByUserId: s.user.id, status: "pending", requestedAt: now() };
    state.roleGrants.push(g);
    return send(res, 202, g);
  }
  if ((m = path.match(/^\/role-grant-requests\/(rgr_[0-9A-Z]+)\/decision$/)) && method === "POST") {
    const g = state.roleGrants.find((x) => x.id === m[1]);
    if (!has(s, "system_admin") || !g) return problem(res, 403, "FORBIDDEN", "Role not allowed");
    if (g.requestedByUserId === s.user.id) return problem(res, 409, "SOD_VIOLATION", "Second approver must be a different person");
    g.status = (await readJson(req)).outcome;
    if (g.status === "approved") state.users.find((u) => u.id === g.userId)?.roles.push({ id: ulid("rol"), role: g.role, centerId: g.centerId, grantedAt: now() });
    return send(res, 200, g);
  }
  return problem(res, 404, "NOT_FOUND", "Not found");
}

/* ------------------------------ static ------------------------------ */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".map": "application/json", ".woff2": "font/woff2" };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'";
async function serveStatic(req, res, url) {
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, p);
  let isAsset = true;
  try { if (!(await stat(file)).isFile()) throw new Error(); } catch { file = join(DIST, "index.html"); isAsset = false; }
  const ext = extname(file);
  const headers = {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": ext === ".html" ? "no-store" : isAsset && /-[\w-]{8}\./.test(file) ? "public, max-age=31536000, immutable" : "no-cache",
  };
  res.writeHead(200, headers);
  res.end(await readFile(file));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/v1")) return await handleApi(req, res, url);
    if (process.env.SERVE_DIST) return await serveStatic(req, res, url);
    res.writeHead(404); res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) problem(res, 500, "INTERNAL", "Internal error");
    else res.end();
  }
}).listen(PORT, () => console.log(`mock API on http://localhost:${PORT}/api/v1 (dist: ${Boolean(process.env.SERVE_DIST)})`));
