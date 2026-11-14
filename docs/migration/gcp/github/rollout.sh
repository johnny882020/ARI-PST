#!/usr/bin/env bash
# Rollout of one image digest to one environment (Cloud Run). Called by deploy-gcp.yml; also usable by hand.
# Order (same as Render: pre-deploy first, then the new version, then crons):
#   1. predeploy job gets the new image and runs to completion (roles, forward-only migrations, optional seed).
#      A failure stops here. The old revision keeps serving (migrations are expand/contract, so it stays compatible).
#   2. ari-api: new revision with NO traffic. Its startup probe (/readyz) must pass, else the revision fails.
#   3. traffic: optional canary (CANARY_PERCENT), then 100 %.
#   4. cron jobs get the new image.
# Env: PROJECT REGION IMAGE (repo/ari-api@sha256:...) SHA [CANARY_PERCENT] [CANARY_SECONDS=300] [BASE_URL]
set -euo pipefail
: "${PROJECT:?}" "${REGION:?}" "${IMAGE:?}" "${SHA:?}"
CRON_JOBS=${CRON_JOBS:-"ari-job-staleness ari-job-audit-verify ari-job-purge ari-job-export ari-job-snapshot"}
G=(--project "$PROJECT" --region "$REGION" --quiet)
tag="sha-${SHA:0:12}"

echo "1/4 predeploy"
gcloud run jobs update ari-job-predeploy "${G[@]}" --image "$IMAGE" --update-env-vars "APP_VERSION=$SHA"
gcloud run jobs execute ari-job-predeploy "${G[@]}" --wait

echo "2/4 new revision without traffic"
gcloud run deploy ari-api "${G[@]}" --image "$IMAGE" --update-env-vars "APP_VERSION=$SHA" --no-traffic --tag "$tag"
new=$(gcloud run services describe ari-api "${G[@]}" --format='value(status.latestCreatedRevisionName)')
ready=$(gcloud run revisions describe "$new" "${G[@]}" --format='value(status.conditions[0].status)')
[ "$ready" = "True" ] || { echo "revision $new is not ready (startup probe /readyz failed?)"; exit 1; }

echo "3/4 traffic"
pct=${CANARY_PERCENT:-0}
if [ "$pct" -gt 0 ] 2>/dev/null && [ "$pct" -lt 100 ]; then
  gcloud run services update-traffic ari-api "${G[@]}" --to-tags "$tag=$pct"
  echo "canary $pct % on $new for ${CANARY_SECONDS:-300} s. Watch the error-rate alert (section 7)."
  sleep "${CANARY_SECONDS:-300}"
  if [ -n "${BASE_URL:-}" ]; then bash scripts/smoke.sh --wait 30; fi
fi
gcloud run services update-traffic ari-api "${G[@]}" --to-revisions "$new=100"

echo "4/4 cron jobs"
for j in $CRON_JOBS; do
  gcloud run jobs update "$j" "${G[@]}" --image "$IMAGE" --update-env-vars "APP_VERSION=$SHA"
done
echo "rolled out $SHA as $new"
