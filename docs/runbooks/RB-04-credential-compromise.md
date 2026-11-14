# RB-04 Credential or key compromise

## When to use
- A secret is found in Git (gitleaks).
- A suspicious admin sign-in.
- A vendor breach notice.
- A lost laptop.

Severity: Sev1 for a production secret or an admin account. Otherwise Sev2.

## Prerequisites
- Access to the Render Dashboard, GitHub settings and the provider of the secret.
- The list of secrets:

| Secret | Where |
|---|---|
| Render API key, GitHub tokens | Render, GitHub |
| Deploy hooks | Render service, Settings, Deploy Hook; GitHub Environment secrets |
| `DB_PASSWORD_MIGRATOR`, `DB_PASSWORD_RUNTIME`, `DB_PASSWORD_BG`, Render owner user | Render environment |
| `SECRETS_KEY` (TOTP secrets at rest, AES-256-GCM), `IP_HASH_SALT` | Render environment |
| `SEED_USER_PASSWORD` (synthetic users) | Render environment |
| SMTP and object store keys | Provider |
| Backup age key | Key holders |
| Audit chain key | Inside the database (`audit.chain_key`) |

## Steps
1. Identify the secret.
2. Revoke or rotate it at the source first. Then update the value in the Render Dashboard (secrets are never in Git). Redeploy through the normal path.
3. Rotate in this order:
   1. Render API key and GitHub tokens.
   2. Deploy hooks: regenerate, then update the GitHub Environment secrets.
   3. Database passwords: change the `DB_PASSWORD_*` value and redeploy. `scripts/render-predeploy.mjs` runs `ALTER ROLE ... PASSWORD`.
   4. Object store keys.
   5. Backup keys.
4. Audit chain key: there is no rotation function yet (the `key_version` column is ready). Ask the security lead before any change.
5. `SECRETS_KEY`: there is no rotation tool. A new value locks out every TOTP user unless the secrets are re-encrypted.
6. End sessions. Sessions are server-side rows in `authn.sessions`. Suspending a user ends that user's sessions. For everybody, a database admin sets `revoked_at` on all rows. Require an MFA re-check for admins.
7. Review the portal audit log, the GitHub audit log and the Render event log for use of the secret since exposure.
8. A secret that was in Git is public. Removing it from history is not enough.
9. If the age private key may be exposed: create a new key pair, update `BACKUP_AGE_PUBLIC_KEY`, start a new backup chain. Only `scripts/backup-export.sh` uses this key today.
10. Privacy lead decides whether data was reachable (RB-03).

## Verify
- The old secret fails.
- `/readyz` is green.
- No unknown sessions exist.

## Rollback
None for a compromised secret: never restore an old value. If a new value breaks a service, fix forward with another new value.

## Escalation
Security lead and incident commander. Privacy lead if data may have been reachable.
