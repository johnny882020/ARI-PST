# SHA pinning TODO

Production rule: every third-party action is pinned to a full commit SHA with the tag in a comment.
SHAs could not be verified offline when this was written. Resolve each with
`gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha` (follow annotated tags), then let Dependabot keep them fresh.
Regenerate this list: `python3 scripts/pin-actions-report.py --write`.

- [ ] `actions/attest-build-provenance@v2`  (.github/workflows/ci.yml)
- [ ] `actions/checkout@v4`  (.github/workflows/ci.yml, .github/workflows/codeql.yml, .github/workflows/dast-preview.yml, .github/workflows/deploy-protected.yml, .github/workflows/dora.yml, .github/workflows/roundtrip.yml, .github/workflows/staging-promote.yml)
- [ ] `actions/dependency-review-action@v4`  (.github/workflows/ci.yml)
- [ ] `actions/setup-node@v4`  (.github/actions/setup/action.yml)
- [ ] `actions/setup-python@v5`  (.github/workflows/ci.yml)
- [ ] `actions/upload-artifact@v4`  (.github/workflows/ci.yml, .github/workflows/dora.yml)
- [ ] `aquasecurity/trivy-action@0.28.0`  (.github/workflows/ci.yml)
- [ ] `github/codeql-action/analyze@v3`  (.github/workflows/codeql.yml)
- [ ] `github/codeql-action/init@v3`  (.github/workflows/codeql.yml)
- [ ] `gitleaks/gitleaks-action@v2`  (.github/workflows/ci.yml)
- [ ] `pnpm/action-setup@v4`  (.github/actions/setup/action.yml)
- [ ] `zaproxy/action-baseline@v0.14.0`  (.github/workflows/dast-preview.yml)
