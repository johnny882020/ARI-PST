# A8 to A3 — Synthetic data and code tables
1. Own `packages/synthetic-data` content. Meet the tests SG-1..SG-13 in `plan/08-vnv/03-privacy-verification.md` section 5.
2. Provide a **negative corpus** (identifier-shaped strings flagged `expect_reject`) and a **known small cells manifest** (cells with count < k on purpose).
3. Provide the link-key ID shape used by centers (shape only, fake) for the identifier pattern library.
4. Provide the Madgam and RedCAP mapping doc so TC-048, TC-084, TC-085 can run.
5. Provide Hebrew and English code-table labels for diagnosis and sample type.
6. Add a `synthetic=true` marker on all output; loaders must check it.
