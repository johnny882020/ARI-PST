# 04 Search design

Covers REQ-030, REQ-031, REQ-032, REQ-033. Code: `sql/003_search.sql`. Rules for k come from A2 (default k = 5, GATE-K).

## Principles
1. Samples hold no free text. So "free-text search" searches the **vocabulary** (diagnosis labels, synonyms, sample type names, center names). The result is a set of filters. The filters then run against the structured columns.
2. External roles never run a query on `samples`. They call `SECURITY DEFINER` functions owned by role `portal_agg`. The functions return counts only.
3. The k-rule is applied **inside the database function**. The API cannot forget it. API tests (A8) check it again.

## Query path
```
UI text box  --GET /search/suggest?q=...-->  search.expand_query(q)  --> diagnosis codes (+ labels)
UI filters   --POST /search/facets {filters, facets[]}-->  search.facet_counts(filters, facet)   (one call per facet)
UI total     --POST /search/aggregate-->  search.total_count(filters)
```
Filter object (same as OpenAPI `SearchFilters`): `diagnosis[]`, `sampleType[]`, `ageBand[]`, `sex[]`, `centerId[]`, `timepoint[]`, `availability[]`, `attachedData[]`. Keys AND. Values inside a key OR. `attachedData` is all-of. A diagnosis filter on a group or family code includes all its descendants.

## Facet-count SQL (path used by the API)
```sql
-- run inside: BEGIN; SET LOCAL ROLE portal_external; ... COMMIT;
SELECT bucket, bucket_level, n, suppressed
FROM search.facet_counts('{"sampleType":["ffpe"],"ageBand":["3_lt6","6_lt10"]}'::jsonb, 'diagnosis');

SELECT * FROM search.total_count('{"sampleType":["ffpe"]}'::jsonb);   -- n, suppressed, label
```
API runs it for each requested facet, joins bucket labels from `diagnosis_terms` (public data), and returns `FacetResult`. Facet counts are "disjunctive" in the UI sense: the API calls the function with the current filters minus the facet's own key, so a user can widen a facet. (API detail for A1/A6.)

Index support for the inner filter (`search.filtered`): partial B-tree and GIN indexes on `samples` (see 03). The function is `STABLE`. Phase 1 data size makes a seq scan acceptable. A9 re-checks at 100k rows.

## How k-anonymity is applied (exact rules)
Let `k` = `k_policies.k` for the facet (field set `diagnosis`, `center`, else `default`; falls back to `default` = 5).
1. **Gate.** Count the rows after all filters. If the count is below k, the function returns one row `bucket='all', suppressed=true, n=NULL`. No facet shows anything. `total_count` returns `n=NULL` and label `<k`. This blocks narrowing a filter down to a tiny group.
2. **Partition facets** (`sampleType`, `ageBand`, `sex`, `center`, `timepoint`, `availability`): each row falls in exactly one bucket.
   - Buckets with n >= k are shown.
   - Buckets with n < k are summed into `rest` and shown as one bucket `other` (level `other`).
   - If `0 < rest < k`: complementary suppression. The smallest shown bucket is merged into `other` so that `other >= k`. Without this, `total - sum(shown)` would reveal a small cell.
   - If `rest` is still `< k` (nothing left to merge): `other` is returned with `n=NULL, suppressed=true`.
3. **Diagnosis facet** (hierarchy `type` > `family` > `group`): merge into a broader category, as REQ-033 requires.
   - Type cells with n >= k are shown (`level=type`).
   - Small type cells are summed per family. If the family sum >= k it is shown as `<family>` with level `family_other` ("other types in this family").
   - Remaining small cells are summed per group. If the group sum >= k, shown with level `group_other`.
   - Anything left goes to `other`, with the same complementary rule as step 2.
4. **Overlapping facet** (`attachedData`): one sample can be in many buckets, so no merge is possible. Each bucket is shown if n >= k, otherwise `n=NULL, suppressed=true`.
5. **Display option** (A2 to decide): `search.count_label(n,k)` shows `k-9` for counts from k to 9 and the exact number from 10. It reduces differencing between two nearby queries. Off by default for facets; on for request-cart counts (`shown_count_bucket`).
6. **Same k for all external roles.** `researcher_il` and `researcher_intl` get the same function. Clinician and coordinator can call the same functions (useful for a preview) but also have row access, so no k applies to their row views.
7. **Not covered by SQL (A2 / API):** query-rate limits per user, a cap on the number of distinct filter combinations per hour, audit of every aggregate search (`search.aggregate` event with filter hash, no raw text), and a rule that a request-cart item below k cannot be added. These handle repeated-query differencing. SQL alone cannot stop it. Needs A2 sign-off. Residual risk RISK to list in A2's register.
8. **Config.** `k` is data (`k_policies`). Changing it is an admin action with an audit event. A change takes effect on the next call. No cache holds counts.

Executable checks: `sql/tests/test_rls_k.sql` sections 2 to 4 (no cell below 5; bucket sums equal the total; roll-up result `other=10`; gate on a 3-row filter).

## Smart search ("smart" without AI, REQ-011 keeps AI out of Phase 1)
Function `search.expand_query(q, limit)`. Layers, in order of score:
| Layer | Score | What it does |
|---|---|---|
| Exact | 1.0 | Normalised text equals a label or synonym |
| FTS prefix | 0.8 | `to_tsvector('simple')` with `word:*` AND-ed. Works for partial words in he and en |
| Trigram | similarity | `pg_trgm` `%` on normalised label and synonym. Tolerates typos (`medulobastoma` finds medulloblastoma) |

Normalisation `search.norm()`: lower case, strip accents, strip Hebrew niqqud (U+0591..U+05C7), keep letters and digits. Hebrew has no stemmer in stock PostgreSQL. So:
- The `simple` config is used for both languages.
- Hebrew one-letter prefixes (ה ב ל ו מ ש כ) are stripped in a second query variant (`n2`): `במדולובלסטומה` finds `מדולובלסטומה`.
- Plural, construct forms and spelling variants (חסר/מלא) go in the **synonym dictionary**.

### Synonym dictionary
- Table `diagnosis_synonyms(diagnosis_code, lang, term, kind)`. Kinds: `synonym`, `abbreviation`, `legacy_name`, `spelling_variant`.
- Examples (seed): `DIPG` and `diffuse intrinsic pontine glioma` map to `dmg_h3k27`; `pHGG` maps to the pediatric high-grade family; `MB` to medulloblastoma. English terms are for he users too (clinicians type Latin abbreviations).
- Owner: national coordinator with clinical review. Change = vocabulary import file in Git (PR) or admin screen with audit. Test: every synonym returns its term in the top 3 (A8 property test).
- Bilingual rule: a term may exist in he and en. Search is language-agnostic. `lang` in the request only picks the display label.
- Legacy names (pre-CNS5, such as DIPG) are kept as synonyms so old habits still work.

### UX options (A6)
- Suggest-as-you-type from `/search/suggest` (debounce 200 ms). Shows matched term and its parent family.
- "Did you mean" when only trigram matches exist.
- Facet chip with the resolved term, so the user sees what free text became.
- Free text that matches nothing returns an empty suggestion list and a hint to browse the tree. It never falls back to a row search.
- Option for Phase 2: Hebrew morphological analyser (for example HebMorph) as an external component. Not Phase 1 (no external search engine).

## Pagination, sorting
Aggregate results are small. No pagination. Row lists for clinician and coordinator use cursor pagination on `(updated_at, id)`.
