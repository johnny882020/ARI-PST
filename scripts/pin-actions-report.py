#!/usr/bin/env python3
"""List third-party actions that are not pinned to a 40-char SHA. Writes .github/SHA-PINNING-TODO.md with --write."""
import re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
pat = re.compile(r"uses:\s*([^\s#]+)")
rows = {}
for f in sorted(list((ROOT/".github").rglob("*.yml"))):
    for ln in f.read_text().splitlines():
        m = pat.search(ln)
        if not m or m.group(1).startswith("./"):
            continue
        ref = m.group(1)
        if not re.search(r"@[0-9a-f]{40}$", ref):
            rows.setdefault(ref, set()).add(str(f.relative_to(ROOT)))
body = ["# SHA pinning TODO", "",
        "Production rule: every third-party action is pinned to a full commit SHA with the tag in a comment.",
        "SHAs could not be verified offline when this was written. Resolve each with",
        "`gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha` (follow annotated tags), then let Dependabot keep them fresh.",
        "Regenerate this list: `python3 scripts/pin-actions-report.py --write`.", ""]
body += [f"- [ ] `{r}`  ({', '.join(sorted(v))})" for r, v in sorted(rows.items())]
text = "\n".join(body) + "\n"
if "--write" in sys.argv:
    (ROOT/".github"/"SHA-PINNING-TODO.md").write_text(text)
print(text)
sys.exit(1 if rows and "--strict" in sys.argv else 0)
