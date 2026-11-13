# 08 — Non-functional requirements

Base targets from ASSUMPTION-05. Other numbers are A1 proposals (ASSUMPTION-A1-xx) for A8/A9 to confirm.
Load assumption (ASSUMPTION-A1-01): up to 500 registered users, 50 concurrent, 20 req/s peak, index up to 100,000 records.

| ID | Requirement | Target | Measure | REQ |
|---|---|---|---|---|
| NFR-AVL-01 | Public site availability | 99.9% monthly (ASSUMPTION-05) | Uptime probe | REQ-072, REQ-053 |
| NFR-AVL-02 | Protected area availability | 99.5% monthly (ASSUMPTION-05) | Uptime probe, excl. planned window | REQ-072 |
| NFR-BCK-01 | RPO protected DB | 15 min (ASSUMPTION-05); needs PITR; verify on plan | Restore drill: data loss measured | REQ-048 |
| NFR-BCK-02 | RTO protected DB | 4 h (ASSUMPTION-05) | Timed restore drill | REQ-048 |
| NFR-BCK-03 | Restore drill frequency | Monthly in staging; quarterly full rehearsal | Drill log | REQ-048, REQ-072 |
| NFR-BCK-04 | Portable export | Nightly logical dump; retain 30 days; import tested weekly in CI | CI job green | REQ-054 |
| NFR-PRF-01 | Public page LCP (mobile, 4G) | <= 2.5 s p75 | Lighthouse CI | REQ-021 |
| NFR-PRF-02 | Public page total JS | <= 100 KB gz per page | Bundle budget | REQ-021 |
| NFR-PRF-03 | API p95 latency (non-search) | <= 300 ms at 20 req/s | k6 | REQ-072 |
| NFR-PRF-04 | Search p95 latency | <= 800 ms at 100,000 records | k6 | REQ-030 |
| NFR-PRF-05 | SPA initial load | <= 250 KB gz JS; TTI <= 3.5 s on mid phone | Lighthouse CI | REQ-021 |
| NFR-PRF-06 | CSV import | 5,000 rows <= 60 s, no API timeout | k6/integration | REQ-067 |
| NFR-SCL-01 | Headroom | 5x the load assumption without redesign | k6 stress | REQ-072 |
| NFR-SEC-01 | 2FA coverage | 100% protected-role accounts | Query | REQ-044 |
| NFR-SEC-02 | Encryption | TLS 1.2+ in transit; at rest by managed DB/bucket | Config check | REQ-043 |
| NFR-SEC-03 | Cross-center read leaks | 0 in RLS test suite | Vitest + SQL tests | REQ-015, REQ-041 |
| NFR-SEC-04 | k-anonymity | No count below k (default 5) in any external response | Property tests (fast-check) | REQ-033 |
| NFR-SEC-05 | Identifier leakage | 0 identifier-like fields in schema or logs | Schema + log scan | REQ-042 |
| NFR-SEC-06 | Dependency vulnerabilities | 0 critical/high unresolved > 7 days | CI audit | REQ-072 |
| NFR-AUD-01 | Audit completeness | 100% of sample reads, exports, approvals logged | Integration test | REQ-046 |
| NFR-AUD-02 | Audit write latency | In same transaction; adds <= 10 ms p95 | k6 | REQ-046 |
| NFR-AUD-03 | Audit retention | Per A2 policy; default 7 years (ASSUMPTION-A1-02, needs legal review) | Config | REQ-047 |
| NFR-A11Y-01 | Accessibility | WCAG 2.1 AA; 0 axe serious/critical | axe + manual | REQ-022 |
| NFR-I18N-01 | Locale parity | he and en: 100% keys translated; full RTL | CI key check, Playwright | REQ-020 |
| NFR-REL-01 | Deploy safety | Deploy only after CI pass; rollback <= 15 min | Deploy log, drill | REQ-069 |
| NFR-REL-02 | Change failure rate | <= 15% of releases | DORA metric | REQ-072 |
| NFR-OPS-01 | MTTR SEV-1 | <= 4 h | Incident log | REQ-072 |
| NFR-OPS-02 | Alert response | Page within 5 min of SLO burn | Alert test | REQ-072 |
| NFR-OPS-03 | Ops load | <= 4 h/week routine ops for the team | Time log | REQ-072 |
| NFR-PRT-01 | Portability | Full suite passes on plain Postgres container | CI job | REQ-070 |
| NFR-PRT-02 | Arch rules | 0 dependency-cruiser errors | CI | REQ-070 |
| NFR-PRT-03 | Export/import round trip | Row counts and hashes equal after import | CI | REQ-054 |
| NFR-DAT-01 | Data freshness | Records not verified for 180 days flagged stale (config) | Cron report | REQ-067 |
| NFR-DAT-02 | Data in non-prod | 100% synthetic until GATE-PROD-DATA closes | Env check, scan | REQ-054 |
| NFR-MNT-01 | Test coverage | Domain >= 90% lines; modules >= 80% | Vitest | REQ-072 |
| NFR-MNT-02 | Module coupling | No cycles; deep imports 0 | dependency-cruiser | REQ-072 |

Notes:
- Render plan limits for RPO/RTO and HA are UNVERIFIED (see ADR-003).
- NFR-SCL-01 and load numbers are ASSUMPTION-A1-01.
