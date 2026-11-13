# RB-04 Credential or key compromise
Trigger: secret in Git (gitleaks), suspicious admin login, vendor breach notice, lost laptop. Severity: Sev1 for a production secret or admin account, else Sev2.

## Steps
1. Identify the secret: Render API key, GitHub token, deploy hooks, DB password, `SESSION_SECRET`, `AUDIT_HMAC_KEY`, SMTP, object store keys, backup key.
2. Revoke or rotate at the source first. Then update the Render Dashboard value (secrets are never in Git). Redeploy through the normal path.
3. Order: Render API key and GitHub tokens, deploy hooks (Render, Settings, Deploy Hook, regenerate; update GitHub Environment secrets), DB password, `SESSION_SECRET` (forces re-login), object store keys, backup keys.
4. Rotating `AUDIT_HMAC_KEY` needs key versioning so the old chain still verifies. Ask the security lead before changing it.
5. Force logout of all sessions. Require MFA re-check for admins.
6. Review the audit log, GitHub audit log and Render event log for use of the secret since exposure.
7. A secret that was in Git is public. Removing it from history is not enough.
8. If the age private key may be exposed: create a new key pair, update `BACKUP_AGE_PUBLIC_KEY`, start a new backup chain.
9. Privacy lead decides if data was reachable (RB-03).

Note: the API reads `IP_HASH_SALT` and `SECRETS_KEY` (TOTP secrets at rest) in `apps/api/src/config.ts`. Treat them like `SESSION_SECRET`. Rotating `SECRETS_KEY` would make stored TOTP secrets unreadable unless they are re-encrypted. No rotation tool was found in the repo (UNVERIFIED; see `docs/KNOWN-ISSUES.md`). Secret names in the Blueprint and in the code differ today (`docs/deployment.md` section 12).

## Verify
Old secret fails. Health green. No unknown sessions.
