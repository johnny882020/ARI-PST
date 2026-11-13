# A1 to A7 (DevOps / CI-CD)
1. Confirm Render key for "After CI Checks Pass" in Blueprint spec (we saw `autoDeployTrigger: checksPass`, UNVERIFIED).
2. Design the manual approval gate for protected-area production (Deploy Hook + GitHub Environment reviewers) and confirm Render has no native gate.
3. Decide where migrations run (pre-deploy command or CI job).
4. Choose the S3-compatible bucket provider and OAuth proxy for Decap CMS (ADR-006).
5. Implement dependency-cruiser CI step from doc 03 and the portability CI job (ADR-010).
6. Confirm which Render domains/regions list is current (our fetch of render.com was blocked).
