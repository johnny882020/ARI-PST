# ADR-201 — k-anonymity threshold (GATE-K)

Status: PROPOSED (default in force until GATE-K is closed by the owner). Date: 2026-11-13.
Needs legal and clinical-lead review.

## Context
The Doc §6.3 says counts below a threshold are not shown. The threshold is "to be set". The cohort is pediatric oncology. Cohorts are small and diagnoses are rare. A wrong threshold either leaks a child or makes the tool useless.

## Options
| Option | k | Effect |
|---|---|---|
| A | 3 | Common in some data releases. Weak for rare pediatric cases. |
| B | **5** | Common default in health statistics and data-sharing practice. Moderate. |
| C | 10 | Strong. Many cells masked in a small pilot. |
| D | Differential privacy | Needs a privacy budget and noise. Hard to explain to clinicians. Out of scope Phase 1. |

(Statement that k=5 is a common practice: general knowledge, UNVERIFIED for any specific Israeli rule. No Israeli binding threshold was found. Needs legal review.)

## Decision
1. Default **k = 5** for all aggregate counts shown to `researcher_il`, `researcher_intl`, and other-center views of `center_clinician`.
2. k is configurable **per field set** (a named group of facets). A field set can raise k. It can never go below 5 without a new ADR.
3. Effective k for a query = max of k of all facets used in it.
4. Suggested higher k (proposal): `k = 10` for field sets that include `source_center_id` together with `collection_year` and an `entity`-level diagnosis. To be confirmed.
5. The k check uses distinct donors. Algorithms: file 02.
6. Changing k:
   - Raising: `system_admin` can propose. One `national_coordinator` approves. Audited.
   - Lowering toward 5: same, plus `committee_member` approval. Audited. Below 5: forbidden in code (floor).
7. Review: re-evaluate k each time a new center joins (Phase 2) and after the first pen-test.

## Consequences
- With the pilot's two centers, many cells will be masked. Accepted (RISK-S01). The UI explains "counts below 5 are hidden to protect patients" (A5/A6 wording).
- Utility metric is tracked (P-18).
- k is a minimum. It does not protect alone. The other rules in file 02 are required.

## Test links
P-01, P-02, P-09, P-16.
