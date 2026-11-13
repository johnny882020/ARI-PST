# 08 - Research log (Render facts)

Date of research: 2026-11-13. Direct fetch of render.com docs failed (host not allowed in this session). Facts come from a web search summary and the bundled Render Blueprint skill docs. Status: V = seen in a secondary source, UNVERIFIED = must check live docs.

| Fact | Source | Status |
|---|---|---|
| `autoDeployTrigger` values: `commit`, `checksPass`, `off`. Replaces `autoDeploy` | Render Blueprint skill docs (local plugin) and web search result 2026-11-13; render.com/docs/deploys | V (secondary) |
| Dashboard name "After CI Checks Pass" | web search snippet from render.com article 2026-11-13 | V (secondary) |
| `previews.generation`: `off`, `manual`, `automatic`. `previews.expireAfterDays` | render.com/docs/preview-environments via search 2026-11-13; skill docs | V (secondary) |
| Per-service preview override, `previewPlan`, DB `previewDiskSizeGB`, `sync: false` vars excluded in previews | skill docs `preview-environments.md` | V (secondary) |
| `preDeployCommand`, `healthCheckPath`, `maxShutdownDelaySeconds` (1-300, default 30) | skill docs | V (secondary) |
| `render blueprints validate` needs CLI >= 2.7.0. JSON schema at render.com/schema/render.yaml.json | skill docs | V (secondary) |
| Projects/environments, env group scoping, environment isolation on Professional+ | skill docs | V (secondary) |
| Immutable DB fields: name, databaseName, user, region, postgresMajorVersion | skill docs | V (secondary) |
| Pre-deploy runs before start; failure aborts deploy | general Render knowledge | UNVERIFIED |
| Zero-downtime: new instance health check before traffic switch. Not available with persistent disk | general knowledge | UNVERIFIED |
| Rollback to earlier deploy in Dashboard and via API; rollback disables auto-deploy | general knowledge | UNVERIFIED |
| Deploy hook accepts `ref` parameter and returns deploy ID | general knowledge | UNVERIFIED |
| Postgres plan slugs (`basic-256mb`, `basic-1gb`), PITR availability and retention per plan, HA, read replicas | slug `basic-256mb` appears in skill example. Rest not seen | UNVERIFIED |
| Frankfurt region exists. Israel region | general knowledge. Israel not known | UNVERIFIED |
| Render env var `IS_PULL_REQUEST` in previews | general knowledge | UNVERIFIED |
| Render role names, SSO, audit log, JIT access | not checked | UNVERIFIED |
| DPA and compliance statements | not checked, needs legal review | UNVERIFIED |
| Action versions and SHAs in examples | not checked | UNVERIFIED |

Next step: someone with network access runs `render blueprints validate` and checks each UNVERIFIED line (OPEN-A7-01..03).
