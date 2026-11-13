# A9 to A2 (Security & Privacy)
1. Approve log schema and redaction rules in `plan/09-sre/02-observability.md`. Decide if `actorRef` pseudonym is allowed (OPEN-A9-02) and log retention periods.
2. Decide how backup retention (35 days, 12 weeks, 12 months) fits the retention/deletion policy (REQ-047) and erasure requests (OPEN-A9-04).
3. Provide breach-notification rules with legal counsel (V-09, V-11); confirm the working rule in `07-incident-response.md`.
4. Provide key custody design for the offsite backup key (2-of-3 split) and the TOTP encryption key versioning.
5. Define role "security lead" and the reviewed audit-query script (system_admin cannot read sample data).
6. Audit log needs: hash chain, `verify-audit-chain` command, signed hourly export, "chain re-anchor" event.
