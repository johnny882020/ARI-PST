# 08 — Compliance map

**Not legal advice. Needs legal review by Israeli privacy counsel before `GATE-PROD-DATA`.** (REQ-049, GATE-COMPLIANCE: treated as NOT confirmed → synthetic data only.)
Web check date: 2026-11-13 (WebSearch, secondary sources only; no official Hebrew statute text was read). Items are marked **VERIFIED-SECONDARY** (found in ≥1 law-firm or news source) or **UNVERIFIED**.

## 1. Israel — privacy law
| # | Topic | Finding | Status | Source (retrieved 2026-11-13) |
|---|---|---|---|---|
| L1 | Privacy Protection Law 1981, Amendment 13 | Knesset passed it Aug 2024. In force **14 Aug 2025** (a few sources say 6 or 15 Aug; 14 Aug is the common date). Aligns Israel closer to GDPR. Bigger Privacy Protection Authority (PPA) powers, administrative fines, compensation without proof of damage. | VERIFIED-SECONDARY | Pearl Cohen "Israel: significant amendment to the privacy law takes effect" (pearlcohen.com); IAPP "Israel marks a new era in privacy law" (iapp.org); Mondaq "Major amendment to privacy law in Israel" |
| L2 | Data Protection Officer | Entities whose main activity is processing especially sensitive data at scale (incl. medical institutions), public bodies, data brokers must appoint a privacy protection officer. Whether the portal operator is covered: depends on scale and role. | VERIFIED-SECONDARY for rule; applicability UNVERIFIED | IAPP and Mondaq above |
| L3 | Database reporting | Databases with highly sensitive information on > 100,000 people must be reported to the PPA (replaces old registration). Exact thresholds and forms: check statute. | VERIFIED-SECONDARY (one summary); thresholds UNVERIFIED | Mondaq / IAPP above |
| L4 | "Especially sensitive information" | Amendment 13 expands this category (medical, genetic expected). Exact definition and effect on a coded index: UNVERIFIED. | UNVERIFIED | — |
| L5 | De-identified / coded data | Whether k-anonymized aggregates and coded records still count as "information about a person" (identifiability test). Central to the portal. | UNVERIFIED — **key legal question** | — |
| L6 | Privacy Protection (Data Security) Regulations 2017 | In force **8 May 2018**. Database security levels: basic, medium, high (and individual). Medical data is in categories that need at least medium. High level is medium plus ≥ 100,000 data subjects or > 100 authorized staff (secondary summary). Duties by level: access control, logging, periodic training, security meetings (annual medium, quarterly high), external audit every 2 years for medium/high, breach notification to PPA for severe events. | VERIFIED-SECONDARY | techpolicy.org.il "The New Israeli Privacy Protection (Data Security) Regulations"; IAPP "Israel enacts landmark data security, notification regulations"; Meitar summary PDF; Mondaq "Dramatic overhaul of Israeli data security regulations" |
| L7 | Design stance for L6 | Build to **high-level** controls (access control, MFA, logging, encryption, backup, audit, incident process) regardless of the legal tier. Map to this plan: file 05, 06, 07, 09. | Design decision | — |
| L8 | Cross-border transfer (EU region hosting; Israeli data abroad) | Privacy Protection (Transfer of Data to Databases Abroad) Regulations 2001 — conditions for transfers abroad. Israel has an EU adequacy decision (2011; reconfirmed in the Commission's 2024 review — from model knowledge). Current status of rules and any change from Amendment 13: needs check. | UNVERIFIED | — |

## 2. Israel — health research and medical information
| # | Topic | Finding | Status | Source |
|---|---|---|---|---|
| H1 | Public Health Regulations (Clinical Trials in Human Subjects) 1980 | Human experiments must follow the Helsinki Declaration. Local institutional Helsinki Committee approval is generally required. | VERIFIED-SECONDARY | Springer chapter (rd.springer.com); CASRAI guide "Israel clinical trials Helsinki committee pathway"; Tel Aviv Sourasky MC procedures PDF (2013) |
| H2 | Supreme Helsinki Committee | Genetic research and some trial types go to a supreme committee. Relevance to the index (genomics flag only): check. | VERIFIED-SECONDARY (partial) | Thomson Reuters-based summary via search |
| H3 | Patient's Rights Law 1996 | Privacy and confidentiality duty in research use. Applies to the centers. | VERIFIED-SECONDARY | Lexology-type summary via search; Meitar PDF |
| H4 | Genetic Information Law 2000 | Applies to genetic information. In Phase 1 only an availability flag is stored (GATE-GENOMICS). Revisit before genomic data. | VERIFIED-SECONDARY (title) | jewishvirtuallibrary.org text |
| H5 | Secondary use of health data for research without consent | Draft Health Data Research Regulations (2020, ITPI brief). Enacted status in Nov 2026: **UNVERIFIED**. MoH circulars on secondary use and on health-data sharing: **UNVERIFIED**. | UNVERIFIED | techpolicy.org.il ITPI brief (2020) |
| H6 | Helsinki approval per record | Each record carries `ethics_approval_ref` (opaque ID). The portal does not decide if approval is sufficient. Center Helsinki committee decides. The researcher also needs their own approval (REQ-035). | Design | — |
| H7 | Does a de-identified index need a Helsinki approval of its own? | Likely yes for the creating study/registry. Ask counsel and the center committees. | UNVERIFIED | — |

## 3. HIPAA and GDPR (as applicable)
| # | Topic | Position | Status |
|---|---|---|---|
| G1 | HIPAA | Applies to US covered entities and business associates. Israeli centers are not covered by default. Applies if US partners share PHI or if a US entity operates the portal. Design is aligned to the HIPAA Security Rule safeguards anyway (access control, audit, integrity, transmission security). Render offers a BAA for HIPAA-enabled workspaces: Render docs "HIPAA best practices" and "HIPAA on Render" (render.com/docs), retrieved 2026-11-13. HIPAA workspaces can use all regions except Singapore per the same docs (via search summary). **Whether the portal needs it: needs legal review.** | VERIFIED-SECONDARY (Render) / applicability UNVERIFIED |
| G2 | GDPR | Applies if EU/EEA researchers' or partners' personal data is processed (researcher accounts of `researcher_intl`), or EU data subjects' health data. The researcher account data (name, email, institution) is personal data → lawful basis, notice, rights, retention. Patient index data is coded; whether it is "anonymous" under GDPR is the same legal question as L5. | UNVERIFIED applicability |
| G3 | GDPR Art. 9 and 89 | Health data is special-category. Research safeguards (pseudonymization, minimization). Design follows these ideas. | Design |
| G4 | Controller / processor roles | Operator (GATE-OPERATOR: assume Tech4Cancer), centers, Render (processor), email provider (processor). Roles must be written down. | Needs legal review |

## 4. Agreements
| Agreement | Purpose | Platform tie-in | Owner |
|---|---|---|---|
| **DPA** (data processing agreement) with Render and other processors (email, KMS, anchor store) | REQ-050. Covers processing, sub-processors, breach notice, deletion, region. | Gate item for `GATE-PROD-DATA`. Check Render's DPA terms and sub-processor list. UNVERIFIED. | Operator + counsel |
| **DTA** (data transfer/use agreement) per center | REQ-051. Center commits: only coded data uploaded, own mapping kept safe, link-out use rules, update duty (freshness). | Maps to "Never in the portal" (file 10) and link-out (file 04). | Operator + each center |
| **MTA** (material transfer agreement) | Governs sample delivery after committee approval (REQ-034). Portal tracks status only. | `request.mta_status` event. No MTA text in portal. | Centers + counsel |
| Researcher terms of use | No re-identification, no linking with other data, no sharing of access, breach reporting | Accepted at onboarding (file 05). | Operator + counsel |
| Data-use rules for committee members | Confidentiality, recusal | Onboarding | Operator |
These contracts are **not drafted by us** (GATE-OPERATOR default). Needs legal review.

## 5. Control-to-law crosswalk (design intent)
| Obligation theme | Where in plan |
|---|---|
| Access control, least privilege | file 05 |
| Authentication strength | file 05 |
| Logging and monitoring | file 07 |
| Encryption | file 06 |
| Backup and recovery | A7/A9; file 06 for encryption of backups |
| Incident response and breach notice | file 09 section 7 (72-hour internal target; legal timeline UNVERIFIED) |
| Data minimization, no identifiers | files 04, 10 |
| Retention and deletion | file 07; A3 for data lifecycle |
| Staff training, security meetings, external audit | file 09 (annual) |
| Vendor management | file 09 and DPA |
| Data subject rights (researcher accounts; any index record) | A4 to design request handling; legal review |

## 6. Open legal questions (for counsel)
- LQ-1: Is the coded index with k-anonymized aggregate output "personal information" under the amended law? (L5)
- LQ-2: Which database security level applies, and is a DPO required for the operator? (L2, L3, L6)
- LQ-3: May EU-region hosting (Frankfurt) hold Israeli health-derived coded data? What transfer rules apply? (L8, GATE-REGION)
- LQ-4: Is a Helsinki approval needed for the index itself, and who holds it? (H7)
- LQ-5: Are the Health Data Research Regulations in force? (H5)
- LQ-6: HIPAA/BAA need, if any US partner is involved. (G1)
- LQ-7: Breach-notification timelines and recipients (PPA, centers, data subjects). 
- LQ-8: Legal retention periods for audit logs and requests.
