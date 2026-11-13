# conftest policy for the Blueprints.
# Run: conftest test render.yaml infra/render.staging.yaml -p infra/policy
package main

import rego.v1

allowed_regions := {"frankfurt"} # GATE-REGION. Change only through ADR.

deny contains msg if {
	some s in input.services
	not s.region in allowed_regions
	msg := sprintf("service %s: region must be one of %v", [s.name, allowed_regions])
}

deny contains msg if {
	some d in input.databases
	not d.region in allowed_regions
	msg := sprintf("database %s: region must be one of %v", [d.name, allowed_regions])
}

deny contains msg if {
	some d in input.databases
	count(d.ipAllowList) > 0
	msg := sprintf("database %s: must not allow public IPs", [d.name])
}

deny contains msg if {
	some s in input.services
	s.autoDeployTrigger == "commit"
	msg := sprintf("service %s: autoDeployTrigger=commit is forbidden. Use checksPass or off", [s.name])
}

deny contains msg if {
	some s in input.services
	s.name == "ari-api"
	s.autoDeployTrigger != "off"
	msg := "production ari-api must use autoDeployTrigger=off (approval gate)"
}

deny contains msg if {
	some s in input.services
	endswith(s.name, "-api")
	not s.healthCheckPath
	msg := sprintf("%s needs healthCheckPath", [s.name])
}

deny contains msg if {
	some s in input.services
	endswith(s.name, "-api")
	not s.preDeployCommand
	msg := sprintf("%s needs preDeployCommand for migrations", [s.name])
}

deny contains msg if {
	some g in input.envVarGroups
	some e in g.envVars
	e.value
	regex.match(`(?i)(password|secret|token|key)`, e.key)
	e.key != "REGION_PIN"
	msg := sprintf("group %s: secret-like key %s has a literal value", [g.name, e.key])
}

deny contains msg if {
	some g in input.envVarGroups
	some e in g.envVars
	e.key == "DATA_CLASSIFICATION"
	e.value != "synthetic"
	msg := "DATA_CLASSIFICATION must stay synthetic until GATE-PROD-DATA closes"
}
