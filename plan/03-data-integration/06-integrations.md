# 06 Integrations by phase (ports and adapters)

Covers REQ-055 to REQ-060, REQ-029, REQ-039, REQ-070. Hexagonal rule: `packages/domain` defines the port (TypeScript interface). Adapters live in `apps/api/src/adapters/*`. The domain never imports an adapter. An architecture test (dependency-cruiser) enforces it.

Overview
| Integration | Phase | Port | Adapter (first) | Data direction | Identifiers? |
|---|---|---|---|---|---|
| RedCAP | 1 | `ClinicalReferencePort` | `redcap-reference` (file/metadata based) | Definitions in; code lists in; pointers out | Never |
| Madgam | 1 | `BaseDataImportPort` | `madgam-import` (uses the CSV/XLSX importer) | Files in | Never |
| Digital pathology | 2 | `PathologyScanPort` | `pathology-objectstore-viewer` | Pointer + viewer token | Never |
| Genomics | 1 flag, later TBD | `GenomicsAvailabilityPort` | `flag-only` | Flag in | Never |
| Institutional SSO | 2 | `AuthPort` (exists) | `auth-oidc` | Login | User identity only (staff) |
| Partner API | 3 | `PartnerAggregatePort` | `partner-rest` | Aggregate out | Never |

Common rules: no patient identifier crosses any port (REQ-042). Every call is audited. Every adapter has a contract test with a fake and a synthetic fixture. Feature flag per integration (`FEATURE_<NAME>`), off by default for Phase 2 and 3.

## 1. RedCAP (REQ-055, REQ-039) - Phase 1: field mapping and reference only
**Stance.** The center's RedCAP holds identified clinical data. The portal does not connect to it in Phase 1 and does not pull records. It aligns **definitions** and stores **references**.

**Port**
```ts
interface ClinicalReferencePort {
  getFieldMapping(centerId: CenterId): Promise<FieldMapping>;      // definition level
  getCodeList(centerId: CenterId, field: string): Promise<CodeList>;
  buildLocalReference(centerId: CenterId): LocalReference;         // opaque pointer text for the center project
}
```
**Adapter (Phase 1):** reads a **data dictionary export file** (REDCap's "metadata" export as CSV, UNVERIFIED version details; confirm with each center's RedCAP admin) that the coordinator uploads once per center and on change. It extracts field names and code lists only. No records. It produces the mapping table below and the `diagnosis_map` and enum maps used by the importer.

**Field mapping (portal field -> RedCAP side)**
| Portal field | RedCAP side (to define per center in Phase 0) | Transform |
|---|---|---|
| `diagnosis_code` | diagnosis field code list | `diagnosis_map` (many to one) |
| `age_band_at_diagnosis` | derived from age at diagnosis | band function, computed **inside the center** before export |
| `sex` | sex field | enum map |
| `sample_type`, `availability`, `quantity_class` | biobank module or sample log | enum map |
| `clinical_timepoint` | event name | map from event to enum |
| `collection_month` | collection date | truncate to `YYYY-MM` **inside the center** |
| `attached_data` | presence of imaging, sequencing records | boolean flags |
| `ethics_approval_ref` | approval ID field | copy opaque ID |
| link key | record ID | **never leaves the center**; the center keeps `sample_code` <-> record ID |

**Two-step coding (REQ-038).** Step 1: the center codes the patient locally. Step 2: the portal assigns `sample_code` on create. The center stores the pair in its RedCAP (field `portal_sample_code`). The portal stores neither the local record ID nor any key. Result-map file (see 05) carries `row_no` -> `sample_code` only.

**Reference to RedCAP:** `centers.local_system_ref` is a text pointer to the center's project (name or ID, no URL with tokens). `sample_attached_data.reference_kind='redcap_pointer'` with `reference_ref` an opaque project/instrument label. The clinician UI shows "Open in your center's RedCAP" as a hint text (GATE-CLINICIAN-ID: no deep link with a patient ID).

**Phase 2+ option (not built):** a center-run script (inside the center) produces the import CSV from RedCAP using the API, then the coordinator uploads it. Data-entry-trigger or API pulls from the portal side are rejected (they need credentials and network paths into the center).

Risks: RedCAP versions and field names differ per center. Mitigation: mapping file per center, versioned in Git (`mappings/redcap/<center>.yaml`), tested with synthetic dictionary fixtures. OPEN-A3-05 for A4/clinical: who owns each mapping.

## 2. Madgam (REQ-056, REQ-003) - Phase 1: schema alignment and update process
Facts about Madgam's current schema are **UNVERIFIED** (not in the Doc beyond its name). ASSUMPTION-A3-08: Madgam is an existing sample base held by a partner, available as spreadsheet or database export, with a base set of fields that overlap schema v1.

**Port**
```ts
interface BaseDataImportPort {
  describeSource(): SourceDescriptor;                       // name, version, columns
  toImportRows(file: UploadedFile): AsyncIterable<ImportRow> // yields rows in schema v1 shape
}
```
**Adapter:** `madgam-import`. Converts a Madgam export to the v1 template, then hands it to the standard importer (same validation, dry run, report). So there is one write path.

**Schema alignment (Phase 0 workshop, output = `mappings/madgam.yaml`)**
1. List Madgam fields. Classify each: maps 1:1, maps with transform, not needed, **forbidden** (identifier or free text).
2. Fill `diagnosis_map.madgam` (source value -> `diagnosis_code`). Clinical lead signs.
3. Mark gaps: fields in v1 that Madgam lacks (likely `availability`, `quantity_class`, `ethics_approval_ref`, `attached_data`). The coordinator fills these in the file or after import.
4. Forbidden fields are dropped **before** upload, in the Madgam-side export. The importer still rejects them (UNKNOWN_COLUMN, guards).
**Update process.** Madgam is not a live feed. Cadence: monthly (owner decides, GATE-INGEST) file export -> coordinator runs a dry run -> reviews report -> commits. Rows match by `sample_code` only if Madgam stores the portal code after first import (the coordinator returns the result map to the Madgam owner). Without that, the Madgam owner must keep a stable local row key and the coordinator keeps the portal code beside it in the **center-side** copy, never in the portal. `source_system = 'madgam'` marks provenance. Conflicts (record changed in both places): last verified write wins; the importer warns STALE_OVERWRITE when the portal row is newer than the file's export date (a file-level field `export_date` in the job, not a row field).
Owner: OPEN-A3-06 (who exports at Madgam).

## 3. Digital pathology (REQ-057, Phase 2)
Design hooks in Phase 1: enum value `digital_pathology`, table column `reference_kind='object_store_key'`, `ObjectStorePort`. No UI, no storage use.
**Port**
```ts
interface PathologyScanPort {
  registerScan(sampleId: SampleId, scan: ScanMeta): Promise<ScanRef>;   // size, format, stain, magnification
  getViewerAccess(scanRef: ScanRef, actor: Actor): Promise<ViewerSession>; // short-lived signed access
}
```
**Adapter (Phase 2):** `pathology-objectstore-viewer`. Slides (WSI: SVS, NDPI, OME-TIFF, converted to DZI or OME-Zarr tiles) in a **separate bucket** from imports and exports, same region (GATE-REGION), SSE encryption, private. Viewer: an embedded open-source viewer (for example OpenSeadragon-based; choice = ADR). Tiles are served through the API with a short-lived signed URL (5 min), per request, audited (`pathology.view`).
Rules: slides must be label-free (barcode and label strips removed **before** upload; identifier risk). Automatic label-crop check plus a coordinator confirm step. Access: coordinator and clinician (own center) always; external researcher only after an approved request that includes the sample and only for the request's lifetime (Phase 2 decision, needs committee rule, GATE-COMMITTEE). Storage cost and bandwidth are the main cost drivers (GATE-BUDGET); GATE-PATHOLOGY decides which centers upload. Upload path: browser direct-to-bucket with presigned multipart. Large-file resumable.

## 4. Genomics (REQ-058, GATE-GENOMICS) - flag only
**Port:** `GenomicsAvailabilityPort { setFlags(sampleId, flags) }`. Adapter `flag-only` writes `sample_attached_data` rows for `wes`, `wgs`, `rna_seq` with `reference_kind in ('none','external_repo_pointer')`. No sequence, variant or file is held. `external_repo_pointer` is an opaque accession-style label the center chooses (for example, a controlled-access repository accession). Whether to hold more is GATE-GENOMICS. Any future variant-level hook must be a new port (not a column).
Re-identification note: genomic data is inherently identifying. Needs legal review before any move beyond flags.

## 5. Institutional SSO (REQ-059, Phase 2)
Port `AuthPort` already exists. Adapter `auth-oidc` (OpenID Connect, authorization code + PKCE). Data model hooks exist: `users.external_idp_subject` (unique), `status`. Rules: SSO proves identity, **roles still come from `role_assignments`** (no role from the IdP). MFA: accept IdP assurance claim (`acr`/`amr`) only if the center is on an allow-list; else step-up with portal TOTP/passkey (REQ-044). Account linking by verified email with admin approval (no silent merge). Federation (for example Israeli academic federation) is UNVERIFIED; choose after talking to the IT of each institution. Logout and session lifetime stay under portal control.

## 6. Partner API (REQ-060, Phase 3)
Port `PartnerAggregatePort { facetCounts(filters, facets), totalCount(filters) }` — the same functions as `search.*`, so the k-rule is shared.
Adapter `partner-rest`: `/partner/v1/...`, separate OpenAPI file, **read-only aggregate**, client-credentials OAuth 2.0 tokens per partner, scopes `aggregate:read`, per-partner rate limit and quota, stricter k (field set `partner`, e.g. 10, A2 to set), audit per call, no row endpoint ever. Contract: signed DTA/MTA per partner (REQ-051), needs legal review. Versioning as in 07. Partner onboarding is by admin, not self-service. Feature flag off in Phase 1.
