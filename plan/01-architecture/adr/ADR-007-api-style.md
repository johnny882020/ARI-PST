# ADR-007 — API style
Status: Proposed. Date: 2026-11-13. Covers: REQ-069, REQ-070.

## Context
Contracts first. Portable. Small team. Generated client.

## Decision
- REST, JSON, `/api/v1`, OpenAPI 3.1 as source of truth in `packages/contracts`.
- Cursor pagination. Idempotency-Key on POST that creates requests.
- Errors: RFC 9457 `application/problem+json` with `code`, `traceId`.
- Fastify with schema validation from the contract. Client generated into `packages/api-client`.
- Breaking changes = new `/v2`. Additive changes allowed in `/v1`. Spectral lint in CI.
- No GraphQL. No tRPC.

## Consequences
- Any backend (Base44 functions, other host) can implement the same contract.
- Some over-fetching. Acceptable for this size.

## Trade-off
GraphQL/tRPC give flexible queries or type sharing but tie us to a stack and weaken the contract-first rule.
