# RB-01 Bad deploy or failing health check

## When to use
- A deploy failed.
- `/readyz` fails.
- The error rate rose after a deploy.

Severity: Sev2.

## Prerequisites
- Access to the Render Dashboard for the service (`ari-api`, or `ari-demo-api-7teo` for the free demo).
- Permission to set GitHub repository variables.
- The git SHA of the last good release.

## Steps
1. Open the service in Render, Events. Check if the error rate rose at the deploy time.
2. If a deploy is still building, cancel it.
3. Pause further deploys: set repository variable `DEPLOY_PAUSED=true`.
4. Roll back: Render, the service, Deploys, the last good deploy, Rollback.
5. Run `BASE_URL=https://<host> bash scripts/smoke.sh --wait 60`.
6. If a migration ran, do not roll back the schema. Check that the old code works on the new schema (expand/contract). If not, turn the feature flag off or fix forward. Use RB-02 only if data is damaged.
7. Open a revert pull request. Merge after CI.
8. Set `DEPLOY_PAUSED=false`. Deploy through the normal approval.
9. Tell the team. Start a post-mortem if the impact was over 15 minutes.

Public site: roll back `ari-public` the same way, or merge a revert pull request.

Free demo: roll back `ari-demo-api-7teo` the same way. Its start command runs `scripts/render-predeploy.mjs` first, so a failing pre-deploy step shows as a failed start in the logs. `DEPLOY_PAUSED` and `deploy-protected` do not apply to the demo.

## Verify
- `/readyz` returns 200.
- The `version` in `/readyz` equals the intended git SHA.
- Normal error rate and latency for 30 minutes.

## Rollback
If the rollback makes things worse, deploy the newest version again from Deploys. Then go to Escalation.

## Escalation
Incident commander, if the rollback fails or the old version also fails. Then suspect the database or Render: RB-02 or RB-08.
