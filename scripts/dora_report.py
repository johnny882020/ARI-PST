#!/usr/bin/env python3
"""Weekly DORA summary from GitHub deployments and issues labelled 'incident'. Team level only.
Needs the gh CLI and GH_TOKEN / GH_REPO. Output: Markdown."""
import argparse, datetime as dt, json, os, subprocess, statistics

def gh(path):
    out = subprocess.run(["gh", "api", "--paginate", path], capture_output=True, text=True, check=True).stdout
    # --paginate concatenates JSON arrays; normalise
    out = out.replace("][", ",")
    return json.loads(out or "[]")

def parse(ts):
    return dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=28)
    ap.add_argument("--out", default="dora.md")
    a = ap.parse_args()
    repo = os.environ["GH_REPO"]
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=a.days)
    deps = [d for d in gh(f"repos/{repo}/deployments?per_page=100") if parse(d["created_at"]) >= since]
    prod = [d for d in deps if d.get("environment") == "production-protected"]
    incidents = [i for i in gh(f"repos/{repo}/issues?labels=incident&state=all&since={since.isoformat()}&per_page=100") if "pull_request" not in i]
    ttr = [(parse(i["closed_at"]) - parse(i["created_at"])).total_seconds() / 3600 for i in incidents if i.get("closed_at")]
    lines = [f"# DORA summary, last {a.days} days", "",
             f"- Protected deployments: {len(prod)} ({len(prod) / (a.days / 7):.1f} per week)",
             f"- All deployments seen: {len(deps)}",
             f"- Incidents: {len(incidents)}",
             f"- Median time to restore (h): {statistics.median(ttr):.1f}" if ttr else "- Median time to restore (h): n/a",
             "- Change failure rate: count deploys followed by a rollback/hotfix label manually (not automated yet)",
             "- Public site deploys come from Render and may not appear as GitHub deployments (UNVERIFIED).",
             "", "Cost review: monthly, manual line. Add the figure here by hand."]
    open(a.out, "w").write("\n".join(lines) + "\n")

if __name__ == "__main__":
    main()
