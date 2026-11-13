# conftest policy for render.yaml. Run: conftest test infra/render.yaml infra/render.staging.yaml -p infra/policy
package main

import rego.v1

allowed_regions := {"frankfurt"}   # GATE-REGION. Change only through ADR.

deny contains msg if {
	some s in input.services
	s.region
	not s.region in allowed_regions
	msg := sprintf("service %s: region %s not allowed", [s.name, s.region])
}

deny contains msg if {
	some d in input.databases
	not d.region in allowed_regions
	msg := sprintf("database %s: region must be one of allowed regions", [d.name])
}

deny contains msg if {
	some d in input.databases
	count(d.ipAllowList) > 0
	msg := sprintf("database %s: must not allow public IPs", [d.name])
}

deny contains msg if {
	some s in input.services
	s.type in {"web", "pserv", "cron"}
	s.runtime != "static"
	s.autoDeployTrigger == "commit"
	msg := sprintf("service %s: autoDeployTrigger=commit is forbidden. Use checksPass or off", [s.name])
}

deny contains msg if {
	some s in input.services
	s.name in {"ari-api", "ari-app", "ari-internal"}
	s.autoDeployTrigger != "off"
	msg := sprintf("protected service %s must use autoDeployTrigger=off (manual gate)", [s.name])
}

deny contains msg if {
	some s in input.services
	s.name == "ari-api"
	not s.healthCheckPath
	msg := "ari-api needs healthCheckPath"
}

deny contains msg if {
	some s in input.services
	s.name == "ari-api"
	not s.preDeployCommand
	msg := "ari-api needs preDeployCommand for migrations"
}

deny contains msg if {
	some g in input.envVarGroups
	some e in g.envVars
	e.value
	regex.match(`(?i)(password|secret|token|key)`, e.key)
	msg := sprintf("group %s: secret-like key %s has a literal value", [g.name, e.key])
}
