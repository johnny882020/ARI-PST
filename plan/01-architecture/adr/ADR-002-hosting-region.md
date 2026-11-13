# ADR-002 — Hosting region
Status: Proposed (GATE-REGION open). Date: 2026-11-13. Covers: REQ-043, REQ-052.

## Context
Doc §7 needs a region decision. Users are in Israel. Render has no Israel region known to us (UNVERIFIED; official region page could not be fetched on 2026-11-13). Known Render regions from prior knowledge: Oregon, Ohio, Virginia, Frankfurt, Singapore (UNVERIFIED).

## Decision
- Default: Frankfurt (EU) for all services, DB, and object store.
- All services of one environment share one region (private network is regional, UNVERIFIED).
- Region is a variable in `render.yaml` and Terraform. Not hard-coded in app code.
- Final choice waits for legal review (needs legal review) and the DPA.

## Consequences
- Latency Israel to Frankfurt is roughly 60-90 ms RTT (ASSUMPTION; measure in staging).
- GDPR-style transfer posture is simpler than US. Israeli rules: needs legal review.
- Changing region later = DB migration (dump/restore). Plan for it (doc 07).

## Trade-off
Israel-resident hosting would be best for data residency but is UNVERIFIED on Render. Frankfurt gives low latency and EU-law familiarity. If legal requires Israel, trigger the exit plan or a hybrid (doc 07).
