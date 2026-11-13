#!/usr/bin/env python3
"""Offline structural checks for the Render Blueprints. Not a replacement for `render blueprints validate`.
Usage: python3 scripts/verify-render-yaml.py [files...]   (default: render.yaml infra/render.staging.yaml)"""
import re, sys, pathlib, yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
ALLOWED_REGIONS = {"frankfurt"}  # GATE-REGION
TRIGGERS = {"commit", "checksPass", "off"}
DEPRECATED = {"env", "autoDeploy", "pullRequestPreviewsEnabled"}
SECRET_KEY = re.compile(r"(password|secret|token|key|url)", re.I)
errors = []


def err(file, msg):
    errors.append(f"{file}: {msg}")


def check(path):
    f = path.name
    d = yaml.safe_load(path.read_text())
    if not isinstance(d, dict):
        return err(f, "not a mapping")
    services = d.get("services", [])
    dbs = d.get("databases", [])
    groups = {g["name"]: g for g in d.get("envVarGroups", [])}
    names = [s["name"] for s in services] + [x["name"] for x in dbs]
    if len(names) != len(set(names)):
        err(f, "duplicate resource names")
    staging = "staging" in f
    for db in dbs:
        if db.get("region") not in ALLOWED_REGIONS:
            err(f, f"db {db['name']} region not allowed")
        if db.get("ipAllowList") != []:
            err(f, f"db {db['name']} must have ipAllowList: [] (private only)")
    byname = {s["name"]: s for s in services}
    for s in services:
        n = s["name"]
        for k in DEPRECATED & set(s):
            err(f, f"{n}: deprecated key {k}")
        if s.get("region") not in ALLOWED_REGIONS:
            err(f, f"{n}: region not allowed")
        if s.get("autoDeployTrigger") not in TRIGGERS:
            err(f, f"{n}: autoDeployTrigger missing or invalid")
        if s.get("autoDeployTrigger") == "commit":
            err(f, f"{n}: autoDeployTrigger commit is forbidden")
        if s["type"] == "web" and s.get("runtime") == "static" and "staticPublishPath" not in s:
            err(f, f"{n}: static site needs staticPublishPath")
        if s["type"] == "cron" and "schedule" not in s:
            err(f, f"{n}: cron needs schedule")
        for e in s.get("envVars", []):
            if "fromGroup" in e and e["fromGroup"] not in groups:
                err(f, f"{n}: unknown group {e['fromGroup']}")
            if "fromDatabase" in e and e["fromDatabase"]["name"] not in {x["name"] for x in dbs}:
                err(f, f"{n}: unknown database {e['fromDatabase']['name']}")
            if "value" in e and SECRET_KEY.search(e["key"]) and not e["key"].endswith("_PIN"):
                err(f, f"{n}: secret-like key {e['key']} has a literal value")
    # group rules: no sync:false in groups; no literal secrets
    for g in groups.values():
        for e in g["envVars"]:
            if "sync" in e:
                err(f, f"group {g['name']}: sync is not valid in env groups ({e['key']})")
            if "value" in e and SECRET_KEY.search(e["key"]) and e["key"] != "REGION_PIN":
                err(f, f"group {g['name']}: secret-like key {e['key']} has a literal value")
    # data classification must be synthetic (GATE-PROD-DATA)
    for g in groups.values():
        for e in g["envVars"]:
            if e["key"] == "DATA_CLASSIFICATION" and e.get("value") != "synthetic":
                err(f, "DATA_CLASSIFICATION must be synthetic until GATE-PROD-DATA closes")
    # topology
    api = next((s for n, s in byname.items() if n.endswith("-api")), None)
    if not api:
        return err(f, "no api service")
    for k in ("healthCheckPath", "preDeployCommand", "startCommand", "buildCommand"):
        if not api.get(k):
            err(f, f"api: missing {k}")
    if api.get("healthCheckPath") != "/readyz":
        err(f, "api: healthCheckPath must be /readyz")
    if "@ari/web" not in api.get("buildCommand", ""):
        err(f, "api: buildCommand must also build @ari/web (same-origin SPA)")
    if staging:
        if api.get("autoDeployTrigger") != "checksPass":
            err(f, "staging api must be checksPass")
        if api.get("branch") != "staging":
            err(f, "staging services must track branch staging")
    else:
        if api.get("autoDeployTrigger") != "off":
            err(f, "production api must have autoDeployTrigger off (deploy via approved hook)")
        if api.get("numInstances", 1) < 2:
            err(f, "production api needs numInstances >= 2 (C-04)")
        pub = byname.get("ari-public")
        if not pub or pub.get("autoDeployTrigger") != "checksPass":
            err(f, "ari-public must exist with checksPass")
        if "ari-app" in byname:
            err(f, "ari-app must not exist: SPA is served by ari-api (same origin, C-03)")
        if d.get("previews", {}).get("generation") != "automatic":
            err(f, "previews.generation must be automatic")
        for c in ("staleness", "audit-verify", "purge", "export"):
            if f"ari-cron-{c}" not in byname:
                err(f, f"missing cron ari-cron-{c}")
        for s in services:
            if s["type"] == "cron" and s.get("autoDeployTrigger") != "off":
                err(f, f"{s['name']}: cron autoDeployTrigger should be off (deployed with the API hook)")
    cron_audit = next((s for n, s in byname.items() if n.endswith("cron-audit-verify")), None)
    if cron_audit and cron_audit.get("schedule", "").split()[1:2] != ["*"]:
        err(f, "audit-verify must run hourly")
    if not staging:
        if any("DATA_CLASSIFICATION" in str(g) and "index" in str(g) for g in groups.values()):
            err(f, "index classification not allowed yet")


def main():
    files = [pathlib.Path(a) for a in sys.argv[1:]] or [ROOT / "render.yaml", ROOT / "infra" / "render.staging.yaml"]
    for p in files:
        if not p.exists():
            err(p.name, "file not found")
            continue
        check(p)
    if errors:
        print("FAIL")
        for e in errors:
            print(" -", e)
        return 1
    print("OK:", ", ".join(p.name for p in files))
    return 0


if __name__ == "__main__":
    sys.exit(main())
