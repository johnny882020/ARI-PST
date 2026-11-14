# RB-04 Credential or key compromise
Trigger: secret in Git (gitleaks), suspicious admin login, vendor breach notice, lost laptop. Severity: Sev1 for a production secret or admin account, else Sev2.

## Steps
1. Identify the secret: Render API key, GitHub token, deploy hooks, DB passwords (`DB_PASSWORD_MIGRATOR`, `DB_PASSWORD_RUNTIME`, `DB_PASSWORD_BG`, the Render owner user), `SECRETS_KEY`, `IP_HASH_SALT`, `SEED_USER_PASSWORD` (synthetic users), SMTP, object store keys, backup key, the audit chain key (`audit.chain_key`, inside the database).
2. Revoke or rotate at the source first. Then update the Render Dashboard value (secrets are never in Git). Redeploy through the normal path.
3. Order: Render API key and GitHub tokens, deploy hooks (Render, Settings, Deploy Hook, regenerate; update GitHub Environment secrets), DB passwords (change the `DB_PASSWORD_*` value and redeploy: `scripts/render-predeploy.mjs` runs `ALTER ROLE ... PASSWORD`), object store keys, backup keys.
4. The audit chain key lives in the database (`audit.chain_key`), not in an environment variable. There is no rotation function yet (the `key_version` column is ready, `db/README.md`). Ask the security lead before any change.
5. Force logout of all sessions. Sessions are server-side rows (`authn.sessions`); there is no session signing secret. Suspending a user ends that user's sessions. For everybody, a database admin sets `revoked_at` on all rows (no API or tool for this yet). Require MFA re-check for admins.
6. Review the audit log, GitHub audit log and Render event log for use of the secret since exposure.
7. A secret that was in Git is public. Removing it from history is not enough.
8. If the age private key may be exposed: create a new key pair, update `BACKUP_AGE_PUBLIC_KEY`, start a new backup chain. Note: today only `scripts/backup-export.sh` can use this key; the API export job does not read it (`docs/KNOWN-ISSUES.md`, item 6).
9. Privacy lead decides if data was reachable (RB-03).

Note: the API reads `IP_HASH_SALT` and `SECRETS_KEY` (TOTP secrets at rest, AES-256-GCM) in `apps/api/src/config.ts`. Rotating `SECRETS_KEY` makes stored TOTP secrets unreadable unless they are re-encrypted. There is no rotation tool (`docs/KNOWN-ISSUES.md`, item 8). Blueprint and code use the same variable names; `python3 scripts/verify-render-yaml.py` checks this and rejects the old names `SESSION_SECRET` and `AUDIT_HMAC_KEY`.

## Verify
Old secret fails. Health green. No unknown sessions.
