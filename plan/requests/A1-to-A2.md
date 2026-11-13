# A1 to A2 (Security and Privacy)
1. Confirm session lifetimes in ADR-004 (idle 30 min, absolute 12 h) and Argon2id parameters.
2. Own the k-anonymity ADR (GATE-K). Architecture assumes a domain policy applied after queries (ADR-005, ADR-008).
3. Define audit retention (NFR-AUD-03 default 7 years is an A1 placeholder; needs legal review).
4. Review ADR-008 RLS design and the break-glass DB role.
5. State DPA and sub-processor needs for the S3-compatible bucket and SMTP relay.
