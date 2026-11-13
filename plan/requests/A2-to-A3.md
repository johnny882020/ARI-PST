# A2 to A3 — requests

1. Add internal field `donor_ref` (opaque random, `don_` prefix, never exposed by any API) to the sample model. Used for distinct-donor counts. Not a link key. See `plan/02-security-privacy/04-two-step-coding-and-clinician.md`. If A3 rejects it, tell A2: count unit falls back to samples and k-risk rises.
2. Add table `code_block` (`code`, `center_id`, `block_id`, `state`) and a code-issue workflow. No column may reference local center records.
3. Provide hierarchies for aggregate generalization: diagnosis (`entity → group → family → all`), sample type groups, center, year ranges. Age bands per ASSUMPTION-01. Used by `plan/02-security-privacy/02-reidentification-controls.md`.
4. Provide a `schema-allowlist.json` source (every table/column, data_class, free_text:false). A2 enforces by CI test.
5. Create schema `agg` with a nightly generalized snapshot (epoch swap). A2 algorithm in file 02, section 5.7.
6. CSV/XLSX import: exact header allow-list, reject whole file on any identifier-pattern hit, staging auto-delete in 24 h.
7. Store `center.local_url_template` (https, one `{sample_code}` placeholder, validated).
8. Draft DB roles and RLS policies as in file 05 section 5.
