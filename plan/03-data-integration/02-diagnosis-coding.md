# 02 Diagnosis coding and sample-type enums

Covers REQ-028, REQ-029, REQ-031. Seed file: `sql/seed/010_diagnosis_vocabulary_starter.sql`.

## Strategy
1. **Primary classification:** WHO Classification of Tumours of the Central Nervous System, 5th edition (WHO CNS5, 2021). It defines "pediatric-type" diffuse gliomas and other pediatric entities, and uses molecular criteria. Source (checked 2026-11-13): braintumor.org summary and the Frontiers in Molecular Neuroscience review of CNS5 pediatric types (search results, not the Blue Book itself). The Blue Book (IARC, 2021) is the authority. **UNVERIFIED against the book** until a clinical lead confirms each term.
2. **Portal code is ours.** `diagnosis_code` is a stable snake_case key in table `diagnosis_terms`. Reason: ICD-O-3 is not one-to-one with CNS5 entities.
3. **ICD-O-3.2 is a reference attribute** (`icdo3_morph`, pattern `NNNN/N`). It is not unique and not a key.
   - Evidence: the NAACCR ICD-O-3.2 update and the ICCR CNS table (search results 2026-11-13) show code `9385/3` shared by several pediatric-type diffuse high-grade glioma entities (H3 K27-altered diffuse midline glioma, H3 G34-mutant diffuse hemispheric glioma, diffuse pediatric-type high-grade glioma H3-wildtype/IDH-wildtype, infant-type hemispheric glioma). So one ICD-O code cannot identify one entity.
   - Only codes seen in such a source are filled in the seed (`9385/3`). All others are NULL = **UNVERIFIED**. Do not guess codes.
   - Sources: NAACCR "2023 ICD-O numerical table" (naaccr.org); ICCR "CNS integrated diagnosis 2nd ed" (iccr-cancer.org); PMC9629428. Fetched via search only. Not read in full. UNVERIFIED in detail.
4. **Three levels:** `group` (e.g. embryonal tumours) > `family` (e.g. medulloblastoma) > `type` (e.g. WNT-activated). Levels give the roll-up path for k-anonymity (see 04).
5. **Pending and unknown:** `cns_tumour_pending_dx` and `cns_tumour_nos` exist, so a sample is never blocked by a missing final diagnosis. They are visible in counts.
6. **Integrated diagnosis:** CNS5 uses layered reports (histology, grade, molecular). The portal stores one `diagnosis_code` only. Grade and molecular markers are out of Phase 1 (they raise re-identification risk and complexity). Hook: a future `sample_molecular_flags` table.
7. **Sarcomas and non-CNS pediatric tumours** (Phase 3, REQ-065): add a second `classification` value (for example `who_soft_tissue_5`) in the same table. The column `classification` exists for this. No other change.
8. **Versioning:** `who_edition`, `valid_from`, `valid_to`. A retired term is never deleted. It is end-dated and mapped by a `diagnosis_term_map` migration. Old samples keep their code until the coordinator remaps.
9. **Clinical sign-off:** The list in the seed is a draft. Hebrew labels are drafts. Owner: clinical lead under GATE-SCHEMA. Needs expert review. ASSUMPTION-A3-05.
10. **Madgam and RedCAP mapping:** each source code list is mapped once to `diagnosis_code` in `yaml/import-columns.yaml` (`diagnosis_map`). Unmapped source values are rejected with rule VOCAB. They are never guessed.

## Level semantics in code
| Level | Selectable | Example |
|---|---|---|
| group | no (browse only) | `embryonal_group` |
| family | yes (when type unknown) | `medulloblastoma_family` |
| type | yes | `mb_wnt` |

## Sample-type enum
| Code | EN | HE (draft) | Note |
|---|---|---|---|
| `ffpe` | FFPE tissue block or slides | רקמה מקובעת בפורמלין ומוטבעת בפרפין | Most common archive form |
| `frozen` | Fresh-frozen tissue | רקמה קפואה | |
| `csf` | Cerebrospinal fluid | נוזל מוחי שדרתי | |
| `plasma_or_liquid_biopsy` | Plasma or other liquid biopsy | פלזמה / ביופסיה נוזלית | |
| `isolated_dna_rna` | Isolated DNA or RNA | DNA / RNA מבודד | |

Other enums:
- `availability`: `available` (can be requested), `limited` (may not meet a large request), `depleted` (none left, kept for the record).
- `clinical_timepoint`: `diagnosis`, `during_treatment`, `relapse`.
- `attached_data`: `wes`, `wgs`, `rna_seq`, `mri`, `digital_pathology`, `redcap_clinical`.

Adding a sample type: expand migration (`ALTER TYPE ... ADD VALUE`), update OpenAPI enum, i18n keys, importer dictionary. Needs an ADR only if it changes k-rules.
