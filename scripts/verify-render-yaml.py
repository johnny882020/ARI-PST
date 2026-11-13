#!/usr/bin/env python3
"""Offline structural checks for the Render Blueprints. Not a replacement for `render blueprints validate`.
Also checks the Blueprints against the code: env var names (single source apps/api/src/config.ts), database login
model (C-06), and that the static-site headers mirror apps/public-site/public/_headers.
Usage: python3 scripts/verify-render-yaml.py [files...]
       (default: render.yaml infra/render.staging.yaml infra/render.free.yaml)"""
import re, sys, pathlib, yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
ALLOWED_REGIONS = {"frankfurt"}  # GATE-REGION
TRIGGERS = {"commit", "checksPass", "off"}
DEPRECATED = {"env", "autoDeploy", "pullRequestPreviewsEnabled"}
SECRET_KEY = re.compile(r"(password|secret|token|key|url)", re.I)
errors = []
# Variables the API needs in production (apps/api/src/config.ts + lib/db-url.ts) and the pre-deploy step needs.
API_REQUIRED = {"NODE_ENV", "DATA_CLASSIFICATION", "IP_HASH_SALT", "SECRETS_KEY", "DB_HOST", "DB_PORT", "DB_NAME",
                "DB_PASSWORD_RUNTIME", "DATABASE_URL_OWNER", "DB_PASSWORD_MIGRATOR", "DB_PASSWORD_BG", "WEB_DIST_DIR"}
CRON_REQUIRED = {"DB_HOST", "DB_PORT", "DB_NAME", "DB_PASSWORD_BG"}
LEGACY = {"SESSION_SECRET", "AUDIT_HMAC_KEY", "CSRF_SECRET", "OBJECTSTORE_ENDPOINT", "OBJECTSTORE_ACCESS_KEY", "OBJECTSTORE_SECRET_KEY"}
PLATFORM = {"NODE_VERSION", "REGION_PIN", "LOG_FORMAT", "APP_ENV", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "BACKUP_AGE_PUBLIC_KEY"}
CODE = "".join(p.read_text() for p in list((ROOT / "apps/api/src").rglob("*.ts")) + [ROOT / "scripts/render-predeploy.mjs"])


def env_keys(service, groups):
    keys = set()
    for e in service.get("envVars", []):
        if "fromGroup" in e:
            keys |= {x["key"] for x in groups.get(e["fromGroup"], {}).get("envVars", [])}
        elif "key" in e:
            keys.add(e["key"])
    return keys


def check_headers(f, pub):
    """render.yaml headers must mirror apps/public-site/public/_headers (the API origin in the CSP is the only difference)."""
    want, path = [], None
    for line in (ROOT / "apps/public-site/public/_headers").read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line.startswith(" "):
            path = line.strip()
        else:
            name, value = line.strip().split(":", 1)
            want.append((path, name.strip(), value.strip()))
    norm = lambda v: re.sub(r" https://[a-z0-9.-]+\.onrender\.com", "", v)
    have = {(h["path"], h["name"]): norm(str(h["value"])) for h in pub.get("headers", [])}
    for path, name, value in want:
        if have.get((path, name)) != value:
            err(f, f"ari-public header {name} for {path} differs from apps/public-site/public/_headers")
    if len(have) != len(want):
        err(f, "ari-public has headers that are not in apps/public-site/public/_headers")


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
    free = "free" in f
    for db in dbs:
        if str(db.get("user", "")).startswith("app_"):
            err(f, f"db {db['name']}: the Render user must not be an app_* role (bootstrap user only, C-06)")
    for db in dbs:
        if db.get("region") not in ALLOWED_REGIONS:
            err(f, f"db {db['name']} region not allowed")
        if db.get("ipAllowList") != [] and not free:
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
            if e.get("key") in LEGACY:
                err(f, f"{n}: {e['key']} is not read by the code (see apps/api/src/config.ts)")
            if "key" in e and s.get("runtime") != "static" and e["key"] not in PLATFORM and not e["key"].startswith("HEARTBEAT_URL_") and e["key"] not in CODE:
                err(f, f"{n}: {e['key']} is not read by apps/api (unknown variable name)")
            if "value" in e and SECRET_KEY.search(e["key"]) and not e["key"].endswith("_PIN") and not e["key"].startswith("PUBLIC_"):
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
        if not api.get(k) and not (free and k == "preDeployCommand"):
            err(f, f"api: missing {k}")
    if api.get("healthCheckPath") != "/readyz":
        err(f, "api: healthCheckPath must be /readyz")
    missing = API_REQUIRED - env_keys(api, groups)
    if missing:
        err(f, f"api: missing variables required by apps/api/src/config.ts or the pre-deploy step: {sorted(missing)}")
    if "DATABASE_URL" in env_keys(api, groups):
        err(f, "api: do not set DATABASE_URL (the owner login). The API builds the app_runtime URL from DB_HOST + DB_PASSWORD_RUNTIME")
    pre = api.get("startCommand", "") if free else api.get("preDeployCommand", "")
    if "scripts/render-predeploy" not in pre:
        err(f, "api: the pre-deploy step must run scripts/render-predeploy (roles + migrations as app_migrator)")
    for s in services:
        if s["type"] == "cron" and "DATABASE_URL_BREAKGLASS" not in env_keys(s, groups):
            miss = CRON_REQUIRED - env_keys(s, groups)
            if miss:
                err(f, f"{s['name']}: missing {sorted(miss)} (crons log in as app_readonly_bg)")
            if {"DATABASE_URL_OWNER", "DB_PASSWORD_MIGRATOR", "DB_PASSWORD_RUNTIME"} & env_keys(s, groups):
                err(f, f"{s['name']}: crons must not get the owner, migrator or runtime credentials")
    pub_any = next((s for s in services if s.get("runtime") == "static"), None)
    if pub_any:
        check_headers(f, pub_any)
    if free:
        if api.get("plan") != "free" or api.get("numInstances", 1) != 1 or any(s["type"] == "cron" for s in services):
            err(f, "free blueprint: one free web service, 1 instance, no crons")
        if "DEMO_MODE" not in env_keys(api, groups):
            err(f, "free blueprint: DEMO_MODE must be set")
        return
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
        for c in ("staleness", "audit-verify", "purge", "export", "snapshot"):
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
    files = [pathlib.Path(a) for a in sys.argv[1:]] or [ROOT / "render.yaml", ROOT / "infra" / "render.staging.yaml", ROOT / "infra" / "render.free.yaml"]
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
