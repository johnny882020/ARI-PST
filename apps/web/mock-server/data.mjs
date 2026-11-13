// Synthetic seed data for the mock API. Clearly fake names only. No real data.
import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function ulid(prefix) {
  const bytes = randomBytes(26);
  let s = "";
  for (let i = 0; i < 26; i++) s += CROCKFORD[bytes[i] % 32];
  return `${prefix}_${s}`;
}
const fixed = (prefix, n) => `${prefix}_${String(n).padStart(26, "0")}`;

export const centers = [
  { id: fixed("ctr", 1), code: "synthetic_a", nameEn: "Synthetic Center A", nameHe: "מרכז סינתטי א׳", isActive: true, contactRole: "Center research coordinator", contactChannel: "coordination-desk", feedsRegularly: true },
  { id: fixed("ctr", 2), code: "synthetic_b", nameEn: "Synthetic Center B", nameHe: "מרכז סינתטי ב׳", isActive: true, contactRole: "Center research coordinator", contactChannel: "coordination-desk", feedsRegularly: false },
];

export const diagnoses = [
  { diagnosisCode: "grp_glioma", parentCode: null, level: "group", icdo3Morph: null, labelHe: "גליומות", labelEn: "Gliomas" },
  { diagnosisCode: "fam_lgg", parentCode: "grp_glioma", level: "family", icdo3Morph: null, labelHe: "גליומה בדרגה נמוכה", labelEn: "Low-grade glioma" },
  { diagnosisCode: "typ_pilocytic", parentCode: "fam_lgg", level: "type", icdo3Morph: "9421/1", labelHe: "אסטרוציטומה פילוציטית", labelEn: "Pilocytic astrocytoma" },
  { diagnosisCode: "fam_hgg", parentCode: "grp_glioma", level: "family", icdo3Morph: null, labelHe: "גליומה בדרגה גבוהה", labelEn: "High-grade glioma" },
  { diagnosisCode: "typ_dipg", parentCode: "fam_hgg", level: "type", icdo3Morph: "9385/3", labelHe: "גליומה פונטינית מפושטת", labelEn: "Diffuse midline glioma" },
  { diagnosisCode: "grp_embryonal", parentCode: null, level: "group", icdo3Morph: null, labelHe: "גידולים עובריים", labelEn: "Embryonal tumors" },
  { diagnosisCode: "typ_medullo", parentCode: "grp_embryonal", level: "type", icdo3Morph: "9470/3", labelHe: "מדולובלסטומה", labelEn: "Medulloblastoma" },
  { diagnosisCode: "typ_ependymoma", parentCode: "grp_glioma", level: "type", icdo3Morph: "9391/3", labelHe: "אפנדימומה", labelEn: "Ependymoma" },
];

const types = ["ffpe", "frozen", "csf", "plasma_or_liquid_biopsy", "isolated_dna_rna"];
const ages = ["0_lt1", "1_lt3", "3_lt6", "6_lt10", "10_lt15", "15_lt18"];
const dx = ["typ_pilocytic", "typ_dipg", "typ_medullo", "typ_ependymoma"];
const tps = ["diagnosis", "during_treatment", "relapse"];
const avail = ["available", "available", "limited", "depleted"];

export function seedSamples() {
  const out = [];
  const now = Date.now();
  for (let i = 1; i <= 64; i++) {
    // Deterministic spread. typ_dipg + csf is deliberately tiny so it is suppressed.
    let diag = dx[i % 4];
    let st = types[i % 5];
    if (diag === "typ_dipg" && st === "csf") st = "ffpe";
    if (i === 7 || i === 8) { diag = "typ_dipg"; st = "csf"; }
    out.push({
      sampleCode: fixed("smp", i),
      sourceCenterId: centers[i % 3 === 0 ? 1 : 0].id,
      diagnosisCode: diag,
      ageBandAtDiagnosis: ages[i % 6],
      sex: i % 2 ? "female" : "male",
      sampleType: st,
      availability: avail[i % 4],
      quantityClass: ["small", "medium", "large"][i % 3],
      clinicalTimepoint: tps[i % 3],
      collectionMonth: `20${20 + (i % 5)}-${String((i % 12) + 1).padStart(2, "0")}`,
      attachedData: i % 3 === 0 ? ["wes", "mri"] : i % 5 === 0 ? ["rna_seq"] : [],
      consentStatus: "broad_consent",
      ethicsApprovalRef: `HEL-SYN-${100 + (i % 3)}`,
      contactRef: "Center research coordinator",
      createdAt: new Date(now - 90 * 864e5).toISOString(),
      updatedAt: new Date(now - (i % 40) * 864e5).toISOString(),
      lastVerifiedAt: new Date(now - (i * 4 % 200) * 864e5).toISOString(),
    });
  }
  return out;
}

export function staleness(s) {
  const age = (Date.now() - new Date(s.lastVerifiedAt).getTime()) / 864e5;
  return age > 150 ? "stale" : age > 120 ? "due_soon" : "fresh";
}

export const PASSWORD = "Synthetic-Passw0rd!";
export const TOTP = "123456";
export const RECOVERY = "SYNTH-RECOV-0001";
/** Synthetic e-mail verification / invitation token for newuser@example.test. */
export const VERIFY_TOKEN = "synthetic-verify-token-0001";

export function seedUsers() {
  const mk = (n, email, displayName, role, centerId = null, extra = {}) => ({
    id: fixed("usr", n), email, displayName, locale: "he", status: "active",
    roles: [{ id: fixed("rol", n), role, centerId, grantedAt: "2026-09-01T10:00:00Z" }], lastLoginAt: null, ...extra,
  });
  return [
    mk(1, "researcher@example.test", "Dr. Synthetic Researcher", "researcher_il"),
    mk(2, "intl@example.test", "Dr. Synthetic Partner", "researcher_intl"),
    mk(3, "clinician@example.test", "Synthetic Clinician", "center_clinician", centers[0].id),
    mk(4, "coordinator@example.test", "Synthetic Coordinator", "national_coordinator"),
    mk(5, "committee@example.test", "Synthetic Committee Member", "committee_member"),
    mk(6, "admin@example.test", "Synthetic Admin", "system_admin"),
    mk(7, "admin2@example.test", "Synthetic Admin Two", "system_admin"),
    mk(8, "shortsession@example.test", "Dr. Short Session", "researcher_il", null, { shortSession: true }),
    mk(9, "committee2@example.test", "Synthetic Committee Two", "committee_member"),
    // Approved but not yet activated: no password, no second factor. Activates through /verify-email?token=VERIFY_TOKEN.
    mk(10, "newuser@example.test", "Dr. New Researcher", "researcher_il", null, { status: "invited", mfaEnrolled: false }),
  ];
}
