# RB-01 Bad deploy or failing health check
Trigger: deploy failed, `/readyz` failing, error rate up after a deploy marker. Severity: Sev2.

## Steps
1. Look at the latest deploy of `ari-api` in Render (Events). Did the error rate jump at the deploy time?
2. If a deploy is still building: cancel it in Render.
3. Pause further deploys: set GitHub repo variable `DEPLOY_PAUSED=true`. Production auto-deploy is already off for `ari-api`.
4. Roll back: Render, `ari-api`, Deploys, choose the last good deploy, Rollback. The workflow `deploy-protected` also rolls back by itself when its smoke step fails and rollback credentials exist.
5. Run `BASE_URL=https://<host> bash scripts/smoke.sh --wait 60`. Check login probe and error rate.
6. If a migration ran: do not roll back the schema. Check the old code works on the new schema (expand/contract). If not, switch the feature flag off or fix forward. Use RB-02 only if data is damaged.
7. Open a revert PR. Merge after CI. Set `DEPLOY_PAUSED=false`. Deploy through the normal approval.
8. Post in chat. Start a post-mortem if impact was over 15 minutes.

Public site: roll back `ari-public` the same way, or merge a `git revert` PR (checksPass redeploys).

## Verify
30 minutes of normal SLIs. `/readyz` OK. Version in `/readyz` equals the intended git SHA.

## Escalate
Incident commander, if rollback fails or the old version also fails. Then suspect the database or Render: RB-02 or RB-08.
